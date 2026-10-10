#!/bin/sh
set -eu
umask 077
AGI_LINUX_APP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGI_LINUX_ROOT=$(CDPATH= cd -- "$AGI_LINUX_APP/../.." && pwd)
case "${1:-}" in --help) printf '%s\n' 'Start the local Linux signer. Use a fresh separate signer account; see Linux-Guide.html.'; exit 0;; esac
AGI_LINUX_NODE=$(python3 "$AGI_LINUX_ROOT/scripts/linux-platform.py" node)
cd "$AGI_LINUX_APP"
exec "$AGI_LINUX_NODE" src/launch.mjs --seed-profile "$@"
