#!/bin/sh
AGI_CLEANUP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
. "$AGI_CLEANUP_ROOT/scripts/node-runtime.sh"
agi_require_node_24 || exit 1
"$AGI_RUNTIME_NODE" "$AGI_CLEANUP_ROOT/scripts/cleanup-evidence.mjs" --interactive "$@"
