# Sourced by other scripts. Reads one KEY from the repo .env without executing it or printing it.
env_value() {
  local key="$1" line
  line=$(grep -E "^${key}=" "$REPO_ROOT/.env" | tail -n 1) || true
  if [ -z "$line" ]; then
    echo "error: ${key} missing from .env" >&2
    return 1
  fi
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  printf '%s' "$line"
}
