#!/bin/sh
set -eu
printf 'Local hostname of your Node Mac (example: agi-node.local): '
IFS= read -r AGI_TUNNEL_HOST
case "$AGI_TUNNEL_HOST" in ''|-*|*[!a-zA-Z0-9.-]*) printf 'Enter a hostname or IPv4 address only.\n'; exit 1;; esac
printf 'Use the restricted agimonitor SSH account configured in FLEET_MONITOR.html.\nVerify the host fingerprint. Keep this window open; Ctrl+C disconnects monitoring only.\n'
exec ssh -N -L 127.0.0.1:18787:127.0.0.1:8787 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "agimonitor@$AGI_TUNNEL_HOST"
