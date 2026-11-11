# Runbook

Operations on the hosted project `hsuxhzalvshmbmiuyhwl`. Run commands from the repo root. Never print a secret: read values through hidden prompts or files, and never paste one into a command line that ends up in shell history.

## Running SQL on the hosted project

Use the dashboard SQL editor, or the Management API with your access token. Both run as `postgres`, so service-role-only functions such as `replay_webhook_events` work. Unlike `scripts/sql-test.sh`, these changes are **not** rolled back.

```sh
hsql() {
  curl -sS -X POST "https://api.supabase.com/v1/projects/hsuxhzalvshmbmiuyhwl/database/query" \
    -H "Authorization: Bearer $(cat ~/.supabase-token)" -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$1" '{query: $q}')" | jq .
}
hsql "select id, name, bot_enabled, token_expires_at, token_checked_at from pages"
```

## Rotate credentials

Rotate one credential at a time, then check the thing that uses it. Update the copy in the GitHub Environment `production` too (`gh secret set <NAME> -R hoangi19/unimatch --env production`, which reads the value from stdin).

| Credential | Lives in | Rotate | Check |
|------------|----------|--------|-------|
| Supabase access token | `~/.supabase-token` | supabase.com → Account → Access Tokens → generate a new token. Write it with `read -s T && printf '%s' "$T" > ~/.supabase-token && chmod 600 ~/.supabase-token; unset T`. Revoke the old token. | `hsql "select 1"` |
| Supabase secret key (`SUPABASE_SECRET_KEY`) | repo `.env` | Dashboard → Project Settings → API Keys → create a new secret key. Replace the value in `.env` with an editor. Delete the old key. Edge Functions use the platform-injected `SUPABASE_SERVICE_ROLE_KEY` and need no change. | `deno run --env-file=.env -A scripts/seed.ts` prints the seed counts |
| Database password (`SUPABASE_DB_PASSWORD`) | repo `.env` | Dashboard → Database → Settings → reset the database password, then update `.env`. | `scripts/supabase-deploy.sh` links and pushes (on `main` only) |
| Cloudflare API token | `~/.cloudflare-token` | dash.cloudflare.com → My Profile → API Tokens → roll the token (Pages edit permission). Write it like the Supabase token, into `~/.cloudflare-token`. | `scripts/deploy-web.sh` from a branch deploys a preview |
| Meta app secret (`META_APP_SECRET`) | Edge Function secret | developers.facebook.com → app `uniagent` → App settings → Basic → reset the app secret. Then right away run `scripts/set-meta-app-secret.sh` (hidden prompt). Until the new value is set, deliveries fail with 401. Meta retries them, so keep the gap short. `pages` uses the same secret to connect Pages. | A real Messenger message shows up in the Inbox. `webhook_events` gets a new row. |
| Verify token (`META_VERIFY_TOKEN`) | repo `.env` and Edge Function secret | It only protects the subscription handshake, so deliveries keep working during the change. Run the snippet below this table, then paste the clipboard into the app's Webhooks → Messenger → Edit callback → Verify token, and click Verify and save. | Meta accepts the callback |
| Page access token | Vault, per Page | Reconnect the Page (below). The old secret is replaced. | Pages tab shows the Page as healthy |
| AI provider keys | Vault, `ai_provider_key:<kind>` | Create a new key at the vendor. In the console go to Chatbot → provider → Replace key, then revoke the old key at the vendor. | Chatbot → Test connection |
| Test admin password | Keychain `unimatch-test-login` | Dashboard → Authentication → Users → the user → reset the password. Update the Keychain with `security add-generic-password -U -s unimatch-test-login -a admin@unimatch.test -w` (prompts). | Sign in to the console |

Verify token snippet:

```sh
T=$(openssl rand -hex 32)
SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase-token) supabase secrets set --project-ref hsuxhzalvshmbmiuyhwl META_VERIFY_TOKEN="$T" >/dev/null
sed -i '' "s/^META_VERIFY_TOKEN=.*/META_VERIFY_TOKEN=$T/" .env
printf '%s' "$T" | gh secret set META_VERIFY_TOKEN -R hoangi19/unimatch --env production
printf '%s' "$T" | pbcopy; unset T
```

`token_health_cron_secret` is generated in the database and never leaves it. To rotate it, update the Vault secret in the SQL editor (`select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex')) from vault.secrets where name = 'token_health_cron_secret'`). The cron job reads it on each run.

## Reconnect a Page

Reconnect when the Pages tab shows "Reconnect" (the token is expired, or `token-health` or a send marked it invalid).

1. Sign in to the console as an admin and open the Pages tab.
2. Click **Reconnect** on the Page, or **Connect** for a new one. Facebook Login for Business opens; pick the Page and grant every permission it asks for.
3. The `pages` function stores the new token in Vault (`set_page_token`) and subscribes the Page to the webhook fields. It then replays the Page's held events (`replay_webhook_events`), so messages that arrived while the Page was missing appear in the Inbox.
4. Check: the row shows as healthy, and `hsql "select status, count(*) from webhook_events where page_id = '<page id>' group by 1"` shows no `no_page` rows.

Disconnecting a Page unsubscribes it and clears its token (`clear_page_token`). The `pages` row and its conversations stay.

## The bot does not reply

Work down the list and stop at the first step that fails. `<page>` is the Page ID (`META_PAGE_ID` for the UniMatch Page) and `<psid>` the customer's ID from the conversation.

1. **Does Meta deliver?** Check `hsql "select received_at, field, status, error from webhook_events where page_id = '<page>' order by received_at desc limit 10"`.
   - No new row: check the Meta app → Webhooks. Is the callback URL `https://hsuxhzalvshmbmiuyhwl.supabase.co/functions/v1/meta-webhook`, is the Page subscribed to `messages`, and is the app live (or the sender an app tester)? Reconnecting the Page subscribes it again.
2. **Is the signature valid?** Read the `meta-webhook` logs (below), or POST without a signature: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' https://hsuxhzalvshmbmiuyhwl.supabase.co/functions/v1/meta-webhook`.
   - 401 is correct.
   - 500 "Webhook not configured" means `META_APP_SECRET` is not set.
   - 401 on Meta's own deliveries means the secret is wrong. Run `scripts/set-meta-app-secret.sh`.
3. **What did the mapping do?** Look at `webhook_events.status`:
   - `processed`: mapped; go on.
   - `ignored`: an echo, a retry or an event type we do not handle. Expected.
   - `no_page`: the Page is not in `pages`. Connect it; held events replay on connect, or replay them by hand (below).
   - `failed`: the payload broke the mapping; `error` says why. Fix the cause, then replay.
   - `received`: the trigger did not run. Replay the events.
4. **Is the Page connected?** `hsql "select bot_enabled, access_token_secret_id is not null as has_token, token_expires_at, token_checked_at from pages where id = '<page>'"`. No token, or `token_expires_at` in the past: reconnect the Page.
5. **Is the bot allowed to answer?** Check the gate:
   - `pages.bot_enabled` is true.
   - The conversation `status` is `bot`. `needs_human`, `human` and `closed` mean a person owns it; use "Return to bot" in the Inbox.
   - The reply hours: with `reply_mode = 'hours'`, the current time in `reply_hours.tz` falls inside a range. Invalid hours count as open.
   - The rate limit: fewer bot messages in the last hour than `bot_settings.rate_limit_per_hour`.

   Each turn logs one `{"event":"bot_turn", ..., "ok": false, "gate": {...}}` line that shows which check stopped it. Query: `hsql "select status, handoff_reason, bot_lock_until, bot_replied_up_to, last_customer_message_at from conversations where page_id = '<page>' and psid = '<psid>'"`.
6. **Does the AI provider work?** Chatbot → Test connection on the active provider.
   - "No API key saved for this provider" means you need to save a key.
   - When the provider fails, the bot sends `bot_settings.fallback` instead. Its trace has `fallback: <kind>`, and the log has `bot: provider failed <kind>`.
7. **Did the Send API accept it?** `hsql "select created_at, sender_kind, delivery_status, delivery_error from messages m join conversations c on c.id = m.conversation_id where c.page_id = '<page>' and c.psid = '<psid>' order by m.created_at desc limit 10"`. A failed send hands the conversation off with reason `send_failed`. `delivery_error` explains it:
   - "older than 24 hours": outside the Messenger window. Only the customer can reopen it, by writing again.
   - "token is invalid or expired": reconnect the Page.
   - "rate limit": wait.
   - "not available on Messenger": the customer blocked the Page or left.
   - "Graph error <code>/<subcode>": look up the code in Meta's Send API docs.
8. **Still nothing:** read the logs below for `bot: turn failed`, `bot: run failed` or `bot: could not hand off`.

## Edge Function logs

- Dashboard: Edge Functions → pick the function → **Logs** (console output) or **Invocations** (status codes).
- API: the logs endpoint takes one SQL query over the `logs` table, filtered by `source`, with a window of 20 hours or less. It is rate-limited; wait a minute after a "Too Many Requests" reply.

```sh
start=$(date -u -v-2H +%Y-%m-%dT%H:%M:%SZ); end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -sS -G "https://api.supabase.com/v1/projects/hsuxhzalvshmbmiuyhwl/analytics/endpoints/logs" \
  -H "Authorization: Bearer $(cat ~/.supabase-token)" \
  --data-urlencode "sql=select timestamp, event_message from logs where source = 'function_logs' order by timestamp desc limit 100" \
  --data-urlencode "iso_timestamp_start=$start" --data-urlencode "iso_timestamp_end=$end" | jq -r '.result[] | "\(.timestamp) \(.event_message)"'
```

Use `source = 'function_logs'` for console output and `'function_edge_logs'` for requests and status codes. Bot turns are JSON lines with `"event":"bot_turn"`. Errors start with `bot:`. Functions log only error kinds and IDs, never tokens or keys.

## webhook_events

One row per Meta event:

| Column | Meaning |
|--------|---------|
| `page_id` | The Page the event is for |
| `field` | The webhook field, such as `messages` |
| `external_id` | Unique dedupe key: the message `mid`, or entry + sender + timestamp + field |
| `payload` | The raw messaging object |
| `status` | `received`, `processed`, `ignored`, `no_page` or `failed` |
| `error` | Why a row is `failed` |
| `received_at` | When it was stored |

Admins can read it (RLS select policy); only the service role writes it. The app never deletes rows.

```sql
-- What is held per Page
select page_id, status, count(*) from webhook_events
where status in ('received', 'no_page', 'failed') group by 1, 2;
-- Recent failures with the reason
select received_at, page_id, error from webhook_events where status = 'failed' order by received_at desc limit 20;
```

## Replay held events

`replay_webhook_events(page_id)` re-runs a Page's `received`, `no_page` and `failed` events, oldest first, and returns how many are now `processed`. Connecting a Page already does this. Run it by hand after fixing a mapping failure:

```sh
hsql "select public.replay_webhook_events('<page id>')"
```

Replay only creates inbox rows. It does not send bot replies, because a late automatic answer to an old message is worse than none. Answer those customers from the Inbox. Do not replay the seed Page `seed-demo`; see the seed notes in the README.
