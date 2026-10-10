#!/bin/sh
set -eu
AGI_UPDATE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_UPDATE_ROOT/scripts/node-runtime.sh"
agi_require_node_24
exec "$AGI_RUNTIME_NODE" "$AGI_UPDATE_ROOT/scripts/update-signer.mjs" "$@"
