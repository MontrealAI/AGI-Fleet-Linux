#!/bin/sh
set -eu
case "${AGI_PUBLIC_WEB_PROXY_IPV4:-}" in
  ''|*[!0-9.]*|.*|*.) printf '%s\n' 'PUBLIC_WEB_PROXY_ADDRESS_REQUIRED' >&2; exit 1 ;;
esac
AGI_PROXY_OCTETS=$(printf '%s' "$AGI_PUBLIC_WEB_PROXY_IPV4" | tr . ' ')
AGI_PROXY_COUNT=0
for AGI_PROXY_OCTET in $AGI_PROXY_OCTETS; do
  AGI_PROXY_COUNT=$((AGI_PROXY_COUNT + 1))
  [ "$AGI_PROXY_OCTET" -ge 0 ] && [ "$AGI_PROXY_OCTET" -le 255 ] || exit 1
done
[ "$AGI_PROXY_COUNT" -eq 4 ] || exit 1
AGI_CHROME_DISABLED_FEATURES=EncryptedClientHello
for AGI_CHROME_ARGUMENT do
  # Chromium accepts single-hyphen switches and trims surrounding whitespace.
  # Reject ambiguous framing, including the terminator that would hide our final guards.
  case "$AGI_CHROME_ARGUMENT" in
    --|[[:space:]]*|*[[:space:]]) printf '%s\n' 'PUBLIC_WEB_BROWSER_OVERRIDE_REFUSED' >&2; exit 1 ;;
    --*) AGI_CHROME_SWITCH="$AGI_CHROME_ARGUMENT" ;;
    -*) AGI_CHROME_SWITCH="-$AGI_CHROME_ARGUMENT" ;;
    *) AGI_CHROME_SWITCH="$AGI_CHROME_ARGUMENT" ;;
  esac
  case "$AGI_CHROME_SWITCH" in
    --proxy-*|--no-proxy-server|--no-proxy-server=*|--host-resolver-rules*|--force-webrtc-ip-handling-policy*|--enable-quic*|--enable-http2*|--ignore-certificate-errors*|--disable-web-security*|--no-sandbox|--no-sandbox=*|--disable-setuid-sandbox|--disable-setuid-sandbox=*|--enable-features=*EncryptedClientHello*)
      printf '%s\n' 'PUBLIC_WEB_BROWSER_OVERRIDE_REFUSED' >&2; exit 1 ;;
    --disable-features=*) AGI_CHROME_DISABLED_FEATURES="$AGI_CHROME_DISABLED_FEATURES,${AGI_CHROME_SWITCH#--disable-features=}" ;;
  esac
done
exec /usr/bin/chromium \
  "--proxy-server=http://${AGI_PUBLIC_WEB_PROXY_IPV4}:18080" \
  '--proxy-bypass-list=<-loopback>' \
  '--host-resolver-rules=MAP * ~NOTFOUND' \
  --disable-quic --disable-http2 \
  --force-webrtc-ip-handling-policy=disable_non_proxied_udp \
  --disable-extensions --disable-background-networking \
  "$@" "--disable-features=$AGI_CHROME_DISABLED_FEATURES"
