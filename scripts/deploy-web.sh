#!/usr/bin/env bash
# Checks, builds and deploys web/ to Cloudflare Pages. main deploys to production, any other branch to a preview.
# Run by hand from this machine. Credentials come from ~/.cloudflare-token and .env.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

branch=$(git branch --show-current)
if [ -z "$branch" ] || [ -n "$(git status --porcelain)" ]; then
  echo "error: deploy only from a clean checkout on a branch" >&2
  exit 1
fi
if [ "$branch" = "main" ]; then
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "error: local main does not match origin/main" >&2
    exit 1
  fi
fi

# shellcheck source=scripts/lib/env.sh
. "$REPO_ROOT/scripts/lib/env.sh"

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY
CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token)
CLOUDFLARE_ACCOUNT_ID=$(env_value CLOUDFLARE_ACCOUNT_ID)
VITE_SUPABASE_URL=$(env_value SUPABASE_URL)
VITE_SUPABASE_PUBLISHABLE_KEY=$(env_value SUPABASE_PUBLISHABLE_KEY)
project=$(env_value CLOUDFLARE_PAGES_PROJECT)

cd web
npm ci
npm run check
npx wrangler pages deploy dist --project-name "$project" --branch "$branch" --commit-hash "$(git rev-parse HEAD)" --commit-dirty=false
