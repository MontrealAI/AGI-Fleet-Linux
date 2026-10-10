#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_ROOT/scripts/node-runtime.sh"
agi_require_node_24
cd "$AGI_ROOT"
exec "$AGI_RUNTIME_NODE" src/launch.mjs
