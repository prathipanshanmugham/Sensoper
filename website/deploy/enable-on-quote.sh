#!/usr/bin/env bash
# Puts the public website on quote.sensoper.in, next to the ERP (once). Run as root on the server:
#     bash /root/Sensoper/website/deploy/enable-on-quote.sh          # switch it on (safe to run again)
#     bash /root/Sensoper/website/deploy/enable-on-quote.sh --undo   # quote.sensoper.in back to ERP only
# It adds one `include` line to the quote.sensoper.in server block. A copy of the nginx file is kept in
# /root/nginx-backups first, and if `nginx -t` fails the file is put back and nothing is reloaded.
set -euo pipefail

HOST=${QUOTE_HOST:-quote.sensoper.in}
NGINX_DIR=${NGINX_DIR:-/etc/nginx}
SITE_DIR=${SITE_DIR:-/var/www/sensoper-site}
BACKUPS=${BACKUP_DIR:-/root/nginx-backups}
NGINX_TEST=${NGINX_TEST:-nginx -t}
NGINX_RELOAD=${NGINX_RELOAD:-systemctl reload nginx}
HERE="$(cd "$(dirname "$0")" && pwd)"
SNIP="$NGINX_DIR/snippets/sensoper-website-on-quote.conf"
LINE="include $SNIP;"

conf=$(grep -lsE "server_name[^;]*[[:space:]]$HOST[[:space:];]" "$NGINX_DIR"/sites-enabled/* "$NGINX_DIR"/conf.d/*.conf | head -1 || true)
[ -n "$conf" ] || { echo "Couldn't find the nginx file for $HOST in $NGINX_DIR/sites-enabled or conf.d. Nothing changed."; exit 1; }
conf=$(readlink -f "$conf")
mkdir -p "$BACKUPS"
backup="$BACKUPS/$(basename "$conf").$(date +%Y%m%d-%H%M%S)"

snip_backup="$backup.snippet"
restore() {
  cp -a "$backup" "$conf"
  if [ -f "$snip_backup" ]; then cp -a "$snip_backup" "$SNIP"; elif [ "${NEW_SNIP:-}" = 1 ]; then rm -f "$SNIP"; fi
}
check_and_reload() {
  if ! out=$($NGINX_TEST 2>&1); then
    restore
    echo "$out"
    echo "nginx didn't accept the change, so the old file is back and nothing was reloaded. Send me the lines above."
    exit 1
  fi
  $NGINX_RELOAD
}

if [ "${1:-}" = "--undo" ]; then
  grep -qF "$LINE" "$conf" || { echo "The website isn't switched on for $HOST. Nothing to undo."; exit 0; }
  cp -a "$conf" "$backup"
  grep -vF "$LINE" "$backup" > "$conf"
  check_and_reload
  echo "Done: $HOST is the ERP only again. (Backup: $backup)"
  exit 0
fi

[ -f "$SITE_DIR/index.html" ] || { echo "Copy the website first: bash $HERE/deploy-website.sh"; exit 1; }

# the snippet, pointed at the same backend port the ERP already uses
port=$(grep -oE "proxy_pass[[:space:]]+http://127\.0\.0\.1:[0-9]+" "$conf" | head -1 | grep -oE "[0-9]+$" || true)
mkdir -p "$(dirname "$SNIP")"
if [ -f "$SNIP" ]; then cp -a "$SNIP" "$snip_backup"; else NEW_SNIP=1; fi
sed -e "s#127\.0\.0\.1:8001#127.0.0.1:${port:-8001}#g" -e "s#/var/www/sensoper-site#$SITE_DIR#g" \
  "$HERE/nginx-website-on-quote.conf" > "$SNIP"

cp -a "$conf" "$backup"
if grep -qF "$LINE" "$conf"; then
  # only the snippet may have changed; still test before reloading
  check_and_reload
  echo "Already switched on for $HOST. Refreshed the website's nginx settings."
  exit 0
fi

# add the include right after `server_name … quote.sensoper.in;` in the https server block
# (the one that listens on 443 / ssl; if there is none, the block that has the ERP's locations)
python3 - "$conf" "$HOST" "$LINE" <<'PY'
import re, sys
path, host, line = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()

def blocks(s):
    """(start, end) of each top-level `server { … }`, skipping comments and quoted strings."""
    out, depth, i, start, q = [], 0, 0, None, None
    while i < len(s):
        c = s[i]
        if q:
            if c == "\\": i += 1
            elif c == q: q = None
        elif c in "\"'": q = c
        elif c == "#":
            j = s.find("\n", i); i = len(s) if j < 0 else j; continue
        elif c == "{":
            if depth == 0 and re.search(r"(^|[\s;}])server\s*$", s[max(0, i - 40):i]): start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and start is not None: out.append((start, i)); start = None
        i += 1
    return out

def strip_comments(b): return re.sub(r"#[^\n]*", "", b)
names = re.compile(r"^[ \t]*server_name[^;]*\s" + re.escape(host) + r"[\s;][^\n]*\n", re.M)
mine = [(a, b) for a, b in blocks(text) if names.search(strip_comments(text[a:b + 1]) + "\n")]
pick = [(a, b) for a, b in mine if re.search(r"^\s*listen\s[^;]*(443|\bssl\b)", strip_comments(text[a:b]), re.M)] \
    or [(a, b) for a, b in mine if re.search(r"^\s*location\s", strip_comments(text[a:b]), re.M)]
if not pick:
    sys.exit("Found " + host + " but not its server block with the ERP in it. Nothing changed.")
for a, b in sorted(pick, reverse=True):
    m = names.search(text, a, b)
    if not m: sys.exit("Couldn't find the server_name line for " + host + ". Nothing changed.")
    indent = re.match(r"[ \t]*", m.group(0)).group(0)
    text = text[:m.end()] + indent + line + "\n" + text[m.end():]
open(path, "w", encoding="utf-8").write(text)
PY
check_and_reload
echo "Done: the website is on https://$HOST/ and the ERP is on https://$HOST/login. (Backup: $backup)"
for u in "https://$HOST/" "https://$HOST/shop/" "https://$HOST/login"; do
  page=$(curl -s --max-time 10 "$u" || true)
  case "$page" in
    *'/assets/site.css'*) echo "  $u → website" ;;
    *'id="root"'*)        echo "  $u → ERP" ;;
    *)                    echo "  $u → no answer yet" ;;
  esac
done
