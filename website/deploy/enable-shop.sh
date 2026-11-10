#!/usr/bin/env bash
# Puts the shop on https://shop.sensoper.in (once). Run as root on the server after the DNS step in DEPLOY.md:
#     bash /root/Sensoper/website/deploy/enable-shop.sh          # switch it on (safe to run again)
#     bash /root/Sensoper/website/deploy/enable-shop.sh --undo   # take shop.sensoper.in off this server
# It checks shop.sensoper.in already points here, adds one nginx site, tests it (nothing is reloaded if nginx
# doesn't accept it) and gets the https certificate with certbot.
set -euo pipefail

HOST=${SHOP_HOST:-shop.sensoper.in}
MAIN_SITE=${MAIN_SITE:-https://quote.sensoper.in}      # where the shop's "Home" and other old links go
QUOTE_HOST=${QUOTE_HOST:-quote.sensoper.in}
NGINX_DIR=${NGINX_DIR:-/etc/nginx}
SITE_DIR=${SITE_DIR:-/var/www/sensoper-site}
NGINX_TEST=${NGINX_TEST:-nginx -t}
NGINX_RELOAD=${NGINX_RELOAD:-systemctl reload nginx}
CERTBOT=${CERTBOT:-certbot}
SKIP_DNS_CHECK=${SKIP_DNS_CHECK:-}
HERE="$(cd "$(dirname "$0")" && pwd)"
AVAIL="$NGINX_DIR/sites-available/sensoper-shop"
LINK="$NGINX_DIR/sites-enabled/sensoper-shop"

if [ "${1:-}" = "--undo" ]; then
  [ -e "$LINK" ] || [ -e "$AVAIL" ] || { echo "$HOST isn't set up on this server. Nothing to undo."; exit 0; }
  rm -f "$LINK"
  $NGINX_TEST >/dev/null 2>&1 && $NGINX_RELOAD
  echo "Done: $HOST is off this server (its nginx file is kept at $AVAIL)."
  exit 0
fi

[ -f "$SITE_DIR/shop/index.html" ] || { echo "Copy the website first: bash $HERE/deploy-website.sh"; exit 1; }

# 1. DNS must already point here, or certbot can't get the certificate
if [ -z "$SKIP_DNS_CHECK" ]; then
  mine=" $(hostname -I 2>/dev/null) "
  v4=$( (getent ahostsv4 "$HOST" || true) | awk '{print $1}' | sort -u | tr '\n' ' ')
  v6=$( (getent ahostsv6 "$HOST" || true) | awk '{print $1}' | (grep ':' || true) | sort -u | tr '\n' ' ')
  ok=""
  for ip in $v4; do case "$mine" in *" $ip "*) ok=1 ;; esac; done
  if [ -z "$ok" ]; then
    echo "$HOST doesn't point to this server yet (it points to: ${v4:-nothing})."
    echo "This server is: $(hostname -I | awk '{print $1}'). Add that as the A record for 'shop' in your domain's DNS,"
    echo "wait 10–30 minutes and run this again. Nothing was changed."
    exit 1
  fi
  for ip in $v6; do
    case "$mine" in *" $ip "*) ;; *)
      echo "$HOST also has an IPv6 (AAAA) record that points elsewhere: $ip"
      echo "Delete the AAAA record for 'shop' in your DNS (certbot would check that address), then run this again. Nothing was changed."
      exit 1 ;;
    esac
  done
fi

# 2. the nginx site, with the backend port the ERP already uses
quote_conf=$(grep -lsE "server_name[^;]*[[:space:]]$QUOTE_HOST[[:space:];]" "$NGINX_DIR"/sites-enabled/* "$NGINX_DIR"/conf.d/*.conf | head -1 || true)
port=""
[ -n "$quote_conf" ] && port=$(grep -oE "proxy_pass[[:space:]]+http://127\.0\.0\.1:[0-9]+" "$quote_conf" | head -1 | grep -oE "[0-9]+$" || true)
port=${port:-8001}
if grep -qsE "server_name[^;]*[[:space:]]$HOST[[:space:];]" $(ls "$NGINX_DIR"/sites-enabled/* "$NGINX_DIR"/conf.d/*.conf 2>/dev/null | grep -v "/sensoper-shop$" || true) /dev/null; then
  echo "Another nginx site already answers for $HOST. Remove it first (or send me its name). Nothing was changed."
  exit 1
fi
new=$(mktemp)
sed -e "s#__PORT__#$port#g" -e "s#__MAIN_SITE__#${MAIN_SITE%/}#g" -e "s#/var/www/sensoper-site#$SITE_DIR#g" "$HERE/nginx-shop.conf" > "$new"
if [ -f "$AVAIL" ] && grep -q "managed by Certbot" "$AVAIL"; then
  echo "$HOST is already set up with https. Leaving its nginx file as it is."
  rm -f "$new"
  if [ ! -e "$LINK" ]; then
    ln -sf "$AVAIL" "$LINK"
    if ! out=$($NGINX_TEST 2>&1); then rm -f "$LINK"; echo "$out"; echo "nginx didn't accept it, so it's switched off again. Send me the lines above."; exit 1; fi
    $NGINX_RELOAD
  fi
else
  had_avail=""; [ -f "$AVAIL" ] && { had_avail=1; cp -a "$AVAIL" "$AVAIL.prev"; }
  had_link="";  [ -e "$LINK" ] && had_link=1
  mv "$new" "$AVAIL"; chmod 644 "$AVAIL"
  ln -sf "$AVAIL" "$LINK"
  if ! out=$($NGINX_TEST 2>&1); then
    if [ -n "$had_avail" ]; then mv "$AVAIL.prev" "$AVAIL"; else rm -f "$AVAIL"; fi
    [ -n "$had_link" ] || rm -f "$LINK"
    echo "$out"
    echo "nginx didn't accept the shop site, so it was taken out again and nothing was reloaded. Send me the lines above."
    exit 1
  fi
  rm -f "$AVAIL.prev"
  $NGINX_RELOAD
fi

# 3. https
if ! grep -q "managed by Certbot" "$AVAIL"; then
  if ! $CERTBOT --nginx -d "$HOST" --redirect --non-interactive --agree-tos; then
    echo "certbot couldn't get the certificate. The shop works on http://$HOST for now. Send me the lines above."
    exit 1
  fi
fi

echo "Done: the shop is on https://$HOST/ (backend port $port; other links go to $MAIN_SITE)."
case "$(curl -s --max-time 10 "https://$HOST/" || true)" in
  *'/assets/site.css'*) echo "  https://$HOST/ → the shop" ;;
  *)                    echo "  https://$HOST/ → no answer yet" ;;
esac
echo "Last step: in the ERP, Website → Settings, set the Shop address to https://$HOST"
