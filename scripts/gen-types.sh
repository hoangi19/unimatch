#!/usr/bin/env bash
# Generates web/src/lib/database.types.ts from the hosted project schema.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/env.sh
. "$REPO_ROOT/scripts/lib/env.sh"

out="web/src/lib/database.types.ts"
mkdir -p "$(dirname "$out")"
tmp=$(mktemp "$out.XXXXXX")
trap 'rm -f "$tmp"' EXIT

SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase-token) \
  supabase gen types typescript --project-id "$(env_value SUPABASE_PROJECT_REF)" --schema public > "$tmp"

mv "$tmp" "$out"
trap - EXIT
echo "wrote $out"
