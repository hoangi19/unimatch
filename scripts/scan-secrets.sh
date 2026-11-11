#!/usr/bin/env zsh
# Blocking secret scan: gitleaks over commits not yet on origin/main (or all history with --all),
# plus a grep for this project's known key prefixes in tracked files. Exit 1 on any hit.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
range="origin/main..HEAD"
[[ "${1:-}" == "--all" ]] && range=""
git fetch -q origin main
if [[ -n "$range" ]]; then
  gitleaks git --no-banner --redact --log-opts="$range" .
else
  gitleaks git --no-banner --redact .
fi
gitleaks dir --no-banner --redact .
# Prefixes gitleaks may not know: Supabase, Cloudflare account tokens, Meta tokens.
if git grep -nIE '(sb_secret_[A-Za-z0-9_-]{10,}|sbp_[a-f0-9]{20,}|cfat_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{40,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' -- . ':!scripts/scan-secrets.sh'; then
  echo "secret-like value found in tracked files" >&2; exit 1
fi
echo "no secrets found"
