#!/usr/bin/env bash
# Copies the public website (sensoper.in / shop.sensoper.in) to where nginx serves it.
# Run after `git pull` — add this line to /root/Sensoper/deploy.sh:
#     bash /root/Sensoper/website/deploy/deploy-website.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=${SITE_DIR:-/var/www/sensoper-site}
mkdir -p "$DEST"
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude 'deploy/' --exclude 'dev-server.mjs' --exclude 'README.md' --exclude 'src/' --exclude 'node_modules/' --exclude 'package.json' --exclude 'package-lock.json' "$SRC/" "$DEST/"
else   # no rsync on this server: build a fresh copy next to it, then swap it in
  rm -rf "$DEST.new" && mkdir -p "$DEST.new"
  tar -C "$SRC" --exclude=./deploy --exclude=./src --exclude=./node_modules --exclude=./dev-server.mjs \
      --exclude=./package.json --exclude=./package-lock.json --exclude=README.md -cf - . | tar -C "$DEST.new" -xf -
  rm -rf "$DEST.old" && mv "$DEST" "$DEST.old" && mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"
fi
echo "Website copied to $DEST ($(find "$DEST" -type f | wc -l) files)"
# where it's live: quote.sensoper.in once enable-on-quote.sh has run, sensoper.in once its DNS points here
for u in https://quote.sensoper.in/ https://sensoper.in/ https://shop.sensoper.in/; do
  case "$(curl -s --max-time 10 "$u" || true)" in
    *'/assets/site.css'*) echo "  $u → this website" ;;
    *)                    echo "  $u → not this website (yet)" ;;
  esac
done
