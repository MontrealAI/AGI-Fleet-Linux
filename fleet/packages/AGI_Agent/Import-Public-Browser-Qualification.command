#!/bin/sh
AGI_BROWSER_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
. "$AGI_BROWSER_ROOT/scripts/node-runtime.sh"
agi_require_node_24 || exit 1
"$AGI_RUNTIME_NODE" "$AGI_BROWSER_ROOT/compute/import-public-web-qualification.mjs" --role agent "$@"
