#!/usr/bin/env bash
# Runs SQL files against the hosted project inside one transaction that is always rolled back.
# Usage: scripts/sql-test.sh supabase/migrations/<new>.sql supabase/tests/<name>_test.sql
# Pass the not-yet-deployed migration first so tests see its schema. Token from ~/.supabase-token.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: $0 file.sql [file.sql ...]" >&2; exit 2; }
project_ref="${SUPABASE_PROJECT_REF:-hsuxhzalvshmbmiuyhwl}"

sql=$(printf 'begin;\n'; cat "$@"; printf '\nrollback;\n')
body=$(jq -n --arg q "$sql" '{query: $q}')
response=$(curl -sS -w '\n%{http_code}' -X POST "https://api.supabase.com/v1/projects/$project_ref/database/query" \
  -H "Authorization: Bearer $(cat ~/.supabase-token)" -H "Content-Type: application/json" -d "$body")
status="${response##*$'\n'}"
if [ "${status:0:1}" != "2" ]; then
  echo "FAILED (HTTP $status): ${response%$'\n'*}" >&2
  exit 1
fi
echo "passed, rolled back"
