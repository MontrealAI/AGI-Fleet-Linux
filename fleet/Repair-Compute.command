#!/bin/sh
AGI_REPAIR_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
. "$AGI_REPAIR_ROOT/scripts/node-runtime.sh"
agi_require_node_24 || exit 1
"$AGI_RUNTIME_NODE" "$AGI_REPAIR_ROOT/scripts/repair-compute.mjs" --interactive "$@"
AGI_REPAIR_STATUS=$?
if [ -t 0 ]; then printf '\n%s\n' 'Repair window finished. Press Return to close.'; read -r AGI_REPAIR_CLOSE; fi
exit "$AGI_REPAIR_STATUS"
