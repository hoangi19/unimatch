# Supabase workflow

The hosted project is the only environment. There is no CI: checks, seeding and deploys run by hand on the maintainer's machine.

## Migrations

- Create with `supabase migration new <name>`. One migration file per PR.
- Migrations are applied to the hosted project by `scripts/supabase-deploy.sh` after the PR merges.

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
