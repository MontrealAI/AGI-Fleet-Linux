#!/bin/bash
set -eu
cd "$(dirname "$0")"
. "./scripts/node-runtime.sh"
agi_require_node_24
AGI_FLEET_NODE=$AGI_RUNTIME_NODE
"$AGI_FLEET_NODE" tests/demo.mjs
read -r -p "Press Return to close. " _
