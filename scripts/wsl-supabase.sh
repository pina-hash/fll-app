#!/usr/bin/env bash
# Runs one Supabase CLI command inside WSL, from the repo root, with this
# repo's own access token in the environment. See CLAUDE.md > Supabase CLI
# credentials: a bare `supabase` call falls through to the machine's global
# login, which is ambient state shared by every repo on this machine.
#
#   MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/fll-app-sk/scripts/wsl-supabase.sh db reset
set -euo pipefail
cd /mnt/c/fll-app-sk
export SUPABASE_ACCESS_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n"')"
exec supabase "$@"
