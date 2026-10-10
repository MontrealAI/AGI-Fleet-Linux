#!/bin/bash
set -eu
cd "$(dirname "$0")"
. "./scripts/node-runtime.sh"
agi_require_node_24
AGI_FLEET_NODE=$AGI_RUNTIME_NODE
exec "$AGI_FLEET_NODE" ops/launch.mjs --role moderator
