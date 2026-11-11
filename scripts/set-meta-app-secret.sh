#!/usr/bin/env zsh
# Prompts for the Meta app secret (hidden) and stores it as the META_APP_SECRET Edge Function secret.
set -e
read -s "S?Meta app secret: "; echo
SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase-token) supabase secrets set --project-ref hsuxhzalvshmbmiuyhwl META_APP_SECRET="$S"
unset S
