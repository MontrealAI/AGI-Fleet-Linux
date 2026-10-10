#!/bin/sh
AGI_RESTART_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
. "$AGI_RESTART_ROOT/scripts/node-runtime.sh"
agi_require_node_24 || exit 1
"$AGI_RUNTIME_NODE" "$AGI_RESTART_ROOT/scripts/restart-compute.mjs" "$@"
AGI_RESTART_STATUS=$?
if [ -t 0 ]; then printf '\n%s\n' 'Restart window finished. Press Return to close.'; read -r AGI_RESTART_CLOSE; fi
exit "$AGI_RESTART_STATUS"
