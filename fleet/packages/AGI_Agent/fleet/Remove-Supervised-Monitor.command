#!/bin/sh
set -eu
AGI_FLEET_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_FLEET_ROOT/../scripts/node-runtime.sh"
agi_require_node_24
exec "$AGI_RUNTIME_NODE" "$AGI_FLEET_ROOT/supervised.mjs" --remove
