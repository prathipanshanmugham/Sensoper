#!/usr/bin/env bash
# Copies the public website (sensoper.in / shop.sensoper.in) to where nginx serves it.
# Run after `git pull` — add this line to /root/Sensoper/deploy.sh:
#     bash /root/Sensoper/website/deploy/deploy-website.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/var/www/sensoper-site
mkdir -p "$DEST"
rsync -a --delete --exclude 'deploy/' --exclude 'dev-server.mjs' --exclude 'README.md' --exclude 'src/' --exclude 'node_modules/' --exclude 'package.json' --exclude 'package-lock.json' "$SRC/" "$DEST/"
echo "Website copied to $DEST ($(find "$DEST" -type f | wc -l) files)"
# quick check that nginx serves it (skips quietly before DNS/SSL are set up)
for u in https://sensoper.in/ https://shop.sensoper.in/ https://sensoper.in/api/public/site; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$u" || true)
  echo "  $u → $code"
done
