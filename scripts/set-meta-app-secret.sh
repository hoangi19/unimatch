#!/usr/bin/env zsh
# Prompts for the Meta app secret (hidden) and stores it as META_APP_SECRET in Supabase and the GitHub production environment.
set -e
read -s "S?Meta app secret: "; echo
SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase-token) supabase secrets set --project-ref hsuxhzalvshmbmiuyhwl META_APP_SECRET="$S"
printf '%s' "$S" | gh secret set META_APP_SECRET -R hoangi19/unimatch --env production
unset S
