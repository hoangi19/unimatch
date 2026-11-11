# Supabase workflow

The hosted project is the only environment. There is no CI: checks, seeding and deploys run by hand on the maintainer's machine. Operations (rotating credentials, reconnecting a Page, the bot not replying, replaying events) are in `docs/runbook.md`.

## Migrations

- Create with `supabase migration new <name>`. One migration file per PR.
- Migrations are applied to the hosted project by `scripts/supabase-deploy.sh` after the PR merges.
- Before merge, test a new migration against hosted with `scripts/sql-test.sh <migration.sql> supabase/tests/<name>_test.sql`. It runs all files in one transaction that is always rolled back. Test files raise on any failed `assert`.

## AI provider keys

- Keys are stored in Supabase Vault, one secret per provider named `ai_provider_key:<kind>`. `ai_providers` keeps only `key_hint` (vendor prefix plus last 4 characters), `key_saved_at` and the secret id.
- The browser saves, replaces and removes keys only through `set_provider_key(kind, key)` and `remove_provider_key(kind)`, which check `is_admin()`. Admins cannot write the key columns directly.
- Edge Functions read a key with the service role: `rpc("get_provider_key", { p_kind })`. No browser role can execute it.
- `extra_headers` is readable by admins. Never put credentials there.

## Access rules

- Single tenant, admins only. RLS is on for every table. The admin check is `public.is_admin()`: an authenticated user whose JWT has `app_metadata.role = 'admin'`. Policies call it; do not inline the check.
- Edge Functions use the service role and bypass RLS.
- Page access tokens live in Vault. `pages.access_token_secret_id` holds only the secret id. Write a token with `set_page_token(page_id, token, expires_at)` and read it with `get_page_token(page_id)`. Only `service_role` may call them. Deleting a page deletes its secret.
- `conversations` and `messages` are in the `supabase_realtime` publication. Realtime applies RLS, so only admins receive changes.

## Edge Functions

- Functions live in `supabase/functions/<name>/index.ts`.
- JWT verification per function is set in `supabase/config.toml` (`meta-webhook` has `verify_jwt = false`).
- Set secrets through a hidden prompt, as `scripts/set-meta-app-secret.sh` does. Never type a value on the command line or commit it.
- `scripts/supabase-deploy.sh` deploys all functions.

## Types

- `web/src/lib/database.types.ts` is generated from the hosted schema by `scripts/gen-types.sh`.
- The deploy script regenerates it. If the file changes, it prints a reminder: review and commit the diff.

## Seed and clean

- Demo rows are defined in `scripts/seed_registry.ts`. Each entry names a table, its upsert conflict column, its rows and the filters that identify them.
- `deno run --env-file=.env -A scripts/seed.ts` inserts the seed rows. Re-running is safe.
- `deno run --env-file=.env -A scripts/seed.ts --clean` deletes only rows matching each entry's filters, in reverse order.
- To seed another table, add one entry to `REGISTRY` and cover it with the existing tests in `scripts/seed.test.ts`.

## Check

- `scripts/supabase-check.sh` runs `deno lint`, `deno check` on each function and on `scripts/seed.ts`, and the unit tests (`*.test.ts`). It needs no network or secrets beyond the Deno module cache.

## Deploy

- `scripts/supabase-deploy.sh` links the project, runs `supabase db push`, deploys functions and runs `gen-types.sh`.
- Credentials: the Supabase access token is read from `~/.supabase-token`; the project ref and database password from the repo `.env` (git-ignored). The script never prints them.
- The maintainer runs the deploy after merging.
