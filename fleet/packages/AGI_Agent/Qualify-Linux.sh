#!/bin/sh
set -eu
umask 077
AGI_LINUX_APP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGI_LINUX_ROOT=$(CDPATH= cd -- "$AGI_LINUX_APP/../.." && pwd)
case "${1:-}" in --help) printf '%s\n' 'Follow Linux-Guide.html. Linux native execution remains subject to qualification.'; exit 0;; esac
AGI_LINUX_NODE=$(python3 "$AGI_LINUX_ROOT/scripts/linux-platform.py" node)
exec "$AGI_LINUX_NODE" "$AGI_LINUX_APP/compute/linux-cli.mjs" --role agent --action qualify "$@"
