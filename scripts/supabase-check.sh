#!/usr/bin/env bash
# Local checks for Supabase code: lint, type check and unit tests. Runs without network or secrets.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

deno lint supabase/functions scripts

for fn in supabase/functions/*/index.ts; do
  deno check "$fn"
done

deno check scripts/seed.ts scripts/import-jobs.ts scripts/embed-jobs.ts

deno test --permit-no-files scripts supabase/functions
