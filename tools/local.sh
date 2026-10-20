#!/usr/bin/env bash
# local.sh — pull latest, (re)serve the studio locally, open it.
# Usage: tools/local.sh [branch]   (default: current branch)
#        PORT=8902 tools/local.sh  (override port)
# Re-runnable: kills any stale server on the port first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BRANCH="${1:-$(git branch --show-current)}"
PORT="${PORT:-8347}"

git pull origin "$BRANCH" 2>&1 | tail -2

if command -v lsof >/dev/null 2>&1 && lsof -ti :"$PORT" >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  kill $(lsof -ti :"$PORT") 2>/dev/null || true
  sleep 1
fi

python3 -m http.server "$PORT" >/tmp/appcaptures-local.log 2>&1 &
echo "serving $ROOT/app/ at http://localhost:$PORT/app/ (pid $!, log /tmp/appcaptures-local.log)"
echo "stop it: kill $!  (re-running this script also replaces it)"
if command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT/app/" || true
fi
