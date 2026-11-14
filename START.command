#!/bin/bash
# Twin for Mac: double-click this file. First time only, macOS may ask: right-click > Open.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Twin needs Node.js. Opening nodejs.org: install the LTS version, then double-click START again."
  open https://nodejs.org
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node scripts/start.mjs
