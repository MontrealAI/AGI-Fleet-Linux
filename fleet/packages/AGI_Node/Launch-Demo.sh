#!/bin/sh
cd "$(dirname "$0")" || exit 1
. "./scripts/node-runtime.sh"
agi_require_node_24 || exit 1
"$AGI_RUNTIME_NODE" src/cli.mjs demo
echo "Demo stopped. Press Enter to close."
read -r unused
