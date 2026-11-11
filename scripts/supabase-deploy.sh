#!/usr/bin/env bash
# Links the hosted project, applies migrations, deploys all Edge Functions and regenerates types.
# Run by hand from this machine after merge. Credentials come from ~/.supabase-token and .env.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git fetch -q origin main
if [ "$(git branch --show-current)" != "main" ] || [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "error: deploy only from a clean main checkout at origin/main" >&2
  exit 1
fi

# shellcheck source=scripts/lib/env.sh
. "$REPO_ROOT/scripts/lib/env.sh"

export SUPABASE_ACCESS_TOKEN
SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase-token)
project_ref=$(env_value SUPABASE_PROJECT_REF)
export SUPABASE_DB_PASSWORD
SUPABASE_DB_PASSWORD=$(env_value SUPABASE_DB_PASSWORD)

supabase link --project-ref "$project_ref"
supabase db push --yes
supabase functions deploy --use-api --project-ref "$project_ref"

./scripts/gen-types.sh

types="web/src/lib/database.types.ts"
if ! git ls-files --error-unmatch -- "$types" >/dev/null 2>&1 || ! git diff --quiet -- "$types"; then
  echo "database.types.ts changed: review and commit it"
fi
