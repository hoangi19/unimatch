# Security checklist

Hands-on pass over `main` and the hosted project `hsuxhzalvshmbmiuyhwl`, run on 2026-11-12 for #30.
Each row: what was checked, how, the result, and what changed. Re-run the commands after any schema,
function or deploy change.

Legend: **OK** passed as found · **FIXED** fixed in this PR · **OWNER** needs the owner (tracked in #33) ·
**ACCEPTED** known residual risk.

## 1. Database: RLS and grants

How: read-only catalog queries over the Management API (`has_table_privilege`, `has_function_privilege`,
`pg_policies`), then `supabase/tests/anon_access_test.sql` through `scripts/sql-test.sh` (one
transaction, always rolled back).

| Check | Result |
|-------|--------|
| RLS enabled on every public table (`pages`, `conversations`, `messages`, `webhook_events`, `ai_providers`, `bot_settings`) | OK |
| anon reads zero rows from every public table | OK (existing test) |
| Signed-in non-admin reads zero rows from every public table | OK (existing test) |
| Admin reads the app tables | OK (new test) |
| Table grants to anon and authenticated | **FIXED.** `conversations`, `messages` and `webhook_events` (and anon on `pages`) still had Supabase's default `ALL` grants, including `TRUNCATE`, which ignores RLS. PostgREST does not expose TRUNCATE, so it was not reachable, but RLS was the only guard. Migration `security_hardening` revokes them. Admins keep `SELECT`, plus `UPDATE (unread_count, notes)` on `conversations`, the only direct writes the console makes. |
| Admin inserting `messages` rows directly | **FIXED.** The `messages_admin_insert` policy and its grant let an admin write a fake "sent" reply that never reached Messenger. Dropped: replies go through the `send-message` function. |
| Admin changing `conversations.status` directly | **FIXED.** Was allowed. Now only through `set_conversation_mode`, which records the event and the admin. |
| SECURITY DEFINER functions executable by anon | OK. None, except the platform's `rls_auto_enable`, an event-trigger function that cannot be called over RPC. |
| SECURITY DEFINER functions executable by authenticated | OK. `set_provider_key`, `remove_provider_key`, `set_conversation_mode` and `inbox_stats` each raise `42501` unless `is_admin()`. The new test checks every such function contains the `is_admin()` call, and that a non-admin is refused. |
| Service-role-only RPCs (`get_page_token`, `get_provider_key`, `set_page_token`, `clear_page_token`, `claim_bot_turn`, `record_outbound_message`, `token_health_secret_ok`, ...) | OK. EXECUTE revoked from `public`, anon and authenticated. |
| Views, materialized views, storage buckets | OK. None exist. |
| Realtime (`conversations`, `messages` in `supabase_realtime`) | OK. Realtime applies RLS, so only admins get changes. |
| `is_admin()` source of truth | OK. Reads `app_metadata.role`, which only the service role can set (not `user_metadata`). |

The test now also asserts that no public table grants INSERT, DELETE, TRUNCATE, REFERENCES or TRIGGER
to anon or authenticated, that anon has no SELECT on any public table, and that `ai_providers.base_url`
rejects `http://`. Without the migration it fails with the exact grants listed above.

## 2. Secrets

| Check | How | Result |
|-------|-----|--------|
| Repo and full git history | `zsh scripts/scan-secrets.sh --all` (gitleaks + project key prefixes) | OK: "no secrets found" |
| Built frontend bundle | `npm run build` with the real `.env` values (as `scripts/deploy-web.sh` does), then searched `web/dist` for every `.env` value, both local tokens, and key patterns (`sb_secret_`, `service_role`, `sbp_`, `EAA…`, `sk-…`, `cfat_`, private keys) | OK. Only public values: Supabase URL and project ref, publishable key, Meta app ID, login config ID, Pages project name. The one `sb_secret_` match is supabase-js code checking a key's prefix, not a key. |
| Edge Function logs | Management API `analytics/endpoints/logs` (one `logs` table, windows of 20 h or less) with a regex for key and token shapes, plus `Bearer`, `access_token=`, `x-cron-secret`, `apikey=` | OK. 0 hits in `function_logs` and `function_edge_logs`. `edge_logs` hits are the realtime websocket `apikey=` (publishable key). `postgres_logs` hits are migration and test SQL text (fake test keys, the `x-cron-secret` header name). |
| What functions log | Code read of every `console.*` call | OK. Only error kinds, `e.message` of internal errors, IDs and token counts. AI errors pass through `redact()`. Graph error text has `EA…` tokens stripped. |
| What functions return | Code read | OK. Unexpected errors return a generic message. Provider and Graph messages are redacted. No key or token is ever in a response. |
| Postgres statement logging | `log_statement` | OK. `ddl`, so RPC calls that carry keys (`set_provider_key`, `set_page_token`) are not logged. |
| Vault usage | Code read + `vault.secrets` names | OK. Page tokens and AI keys are stored only as Vault secret IDs. Decrypted only by service-role DEFINER functions. Vault has no grants to anon or authenticated. Today it holds only `token_health_cron_secret`, generated in the database. |
| Page token transport | Code read | OK. Messenger sends use the `Authorization` header. Graph GET/DELETE calls (`token-health`, `pages`) put `access_token` in the query string of the outbound request to `graph.facebook.com`, which is Meta's documented form and is not logged on our side. |

## 3. Webhook (`meta-webhook`)

| Check | How | Result |
|-------|-----|--------|
| Missing signature | `curl -X POST` with no `X-Hub-Signature-256` | OK: 401 |
| Wrong signature | `curl` with `sha256=00…` | **OWNER + FIXED.** Hosted returned **500** for any signed request, because `META_APP_SECRET` is not set (secret list checked by name only), and an empty HMAC key makes `importKey` throw. So no real Meta delivery is stored today. Setting the secret is already on #33. The handler now fails closed on purpose: 500 "Webhook not configured" plus a log line naming the missing variable. |
| Signature check itself | Unit tests | OK. HMAC-SHA256 over the raw body, constant-time compare. |
| Verify-token handshake | `curl` GET with a wrong token | OK: 403. **FIXED:** the compare is now constant-time too. |
| Payload size | `curl` with 2 MiB | **FIXED.** No limit before. Now 413 above 1 MiB, checked by `Content-Length` and by the body length, before any HMAC work. |
| Replay and duplicates | Code read + existing tests | OK. Meta's signature has no timestamp, so a captured delivery can be resent. Every row has a unique `external_id` (Meta `mid`, or entry + sender + timestamp + field), and the store uses `ignoreDuplicates`. `claim_bot_turn` makes a replayed turn a no-op once answered. A replay changes nothing. |

## 4. Rate limits

Decision (PM): no new limiter. The table below records what exists.

| Endpoint | Protection | Notes |
|----------|------------|-------|
| `meta-webhook` | Signature first | An unsigned or oversized request costs one size check or one HMAC, then 401 or 413. Supabase applies platform-level limits to Edge Functions; there is no per-IP limit in our code. |
| Bot replies | `bot_settings.rate_limit_per_hour` (default 30) per conversation, 2 s debounce, `MAX_TURNS` | Caps AI spend if a customer floods the Page. |
| Admin functions (`test-connection`, `test-chat`, `pages`, `send-message`) | Admin JWT checked with `auth.getUser()` first | Non-admins get 401 or 403 before any AI or Graph call. Only an admin can spend AI credits. |
| `token-health` | `x-cron-secret` checked against Vault | 403 otherwise. |
| Auth (hosted `GET /config/auth`, read-only) | Sign-up off, anonymous sign-in off, verify 30, OTP 30, token refresh 150, email 2 per hour, refresh-token rotation on | See the owner items below for the password policy. |

A per-IP limiter would need state (a table or KV) on every request. With these gates in place that is
not worth it now.

## 5. SSRF: AI provider base URL

| Check | Result |
|-------|--------|
| DB check on `ai_providers.base_url` | **FIXED.** Allowed `http://localhost`. Now `^https://[^/?#@\s]+` (https, a host, no userinfo). Hosted rows already complied. The console's form check and message changed to match. |
| Private, loopback, link-local and metadata hosts | **FIXED.** New `_shared/ai/host.ts` `assertPublicHost()` rejects non-https URLs, userinfo, and IP literals or DNS answers (A and AAAA) in `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4` and above, `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`, and IPv4-mapped or NAT64 forms. Error: "Base URL must be a public https address". |
| Order: guard before the key | **FIXED.** Runs in `loadProvider()` (bot, test-connection) and in test-chat's `loadBaseUrl`, before the Vault key is read. A blocked host never gets the key. |
| DNS unavailable or no answer | **FIXED (fail closed).** Error "Cannot verify provider host". After deploy, "Test connection" on Hermes with no key saved must say "No API key saved for this provider". That proves `Deno.resolveDns` works in the hosted runtime. |
| Redirects | **FIXED.** `fetch(..., { redirect: "manual" })`. Any 3xx is a `bad_config` error, so the key never follows a redirect to an unchecked host. |
| DNS rebinding | **ACCEPTED.** The guard resolves once, then `fetch` resolves again, and `fetch` cannot pin the checked IP. Only an admin can set the URL, and the key sent is that admin's own provider key. |

## 6. CORS on admin functions

| Check | How | Result |
|-------|-----|--------|
| Allowed origin | `curl -X OPTIONS -H "Origin: https://evil.example"` on all four | **FIXED.** Was `access-control-allow-origin: *`. New `_shared/cors.ts` `withCors()` echoes the origin only for `https://unimatch-1va.pages.dev`, `https://<preview>.unimatch-1va.pages.dev` and `http://localhost` / `http://127.0.0.1` on any port, with `Vary: Origin`. Any other origin gets no allow-origin header. Unit tests cover lookalikes (`unimatch-1va.pages.dev.evil.example`, `evilunimatch-1va.pages.dev`, plain `http`). |
| Not an auth layer | — | CORS only stops other sites' browser pages. Every function still requires an admin token. |

## Owner items (added to #33)

- Auth hardening in the dashboard (Authentication → Policies / URL configuration). Hosted today:
  minimum password length 6, no required characters, leaked-password check off, CAPTCHA off,
  `site_url` `http://localhost:3000`. Recommended: length at least 12; `site_url`
  `https://unimatch-1va.pages.dev`. The leaked-password check needs a paid plan, so leave it off
  unless the plan already includes it.
- `META_APP_SECRET` (already listed): until it is set, every Meta delivery fails with 500.

## After deploy (PM)

Results of the first run (2026-11-11, after #63 and #64):

1. `curl -X POST -H 'x-hub-signature-256: sha256=00' -d '{}' …/meta-webhook`: 500 "Webhook not
   configured" until the secret is set, 401 after. **Result:** 500, as expected without the secret.
2. Oversized POST to `meta-webhook`: 413. **Result: accepted deviation.** Bodies up to 900 KB get an
   answer at once. Above 1 MiB the hosted runtime never delivers the 413: curl uploads the whole body
   and then times out, even though the handler stops reading at the cap (it answers 413 in about 5 ms
   when run locally with `Deno.serve`). The same hang happens on any function that answers without
   consuming a large body (e.g. 900 KB to `test-connection`), so it comes from the hosted runtime, not
   from our code. Impact: only the sender's own connection hangs until the platform timeout; nothing is
   read into memory past the cap, and nothing reaches the database.
3. `curl -i -X OPTIONS -H 'Origin: https://evil.example' …/send-message`: no
   `access-control-allow-origin`. With `Origin: https://unimatch-1va.pages.dev` the origin is echoed.
   **Result:** as expected.
4. Console, Chatbot tab, "Test connection" on Hermes with no key saved: "No API key saved for this
   provider". "Cannot verify provider host" means DNS is unavailable in the runtime. **Result:** "No API
   key saved" for hermes, openai and anthropic, so DNS resolution works in the hosted runtime.
5. Re-run `scripts/sql-test.sh supabase/tests/anon_access_test.sql` without the migration argument: passes.
   **Result:** all 11 SQL tests pass on hosted.
6. As the test admin over REST: updating `conversations.notes` works; updating `conversations.status`,
   inserting into `messages`, and any anon read of `conversations` are denied.
