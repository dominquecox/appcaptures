#!/usr/bin/env bash
set -euo pipefail
# AppCaptures D1 migration runner
TARGET="${1:---local}"
if [[ "$TARGET" == "--local" ]]; then
  echo "Applying migrations to local D1..."
  npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
elif [[ "$TARGET" == "--dev" || "$TARGET" == "dev" ]]; then
  echo "Applying migrations to dev D1..."
  npx wrangler d1 migrations apply DB --env dev --remote --config wrangler.jsonc
elif [[ "$TARGET" == "--prod" || "$TARGET" == "prod" ]]; then
  echo "Applying migrations to prod D1..."
  npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
else
  echo "Usage: tools/migrate.sh [--local | --dev | --prod]"
  exit 1
fi
