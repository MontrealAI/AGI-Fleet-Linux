#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_ROOT/scripts/node-runtime.sh"
. "$AGI_ROOT/scripts/standard-node.sh"
agi_standard_node
export PATH="$(dirname "$AGI_RUNTIME_NODE"):/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$AGI_RUNTIME_NODE" "$AGI_ROOT/scripts/setup-openclaw.mjs" --standard-install "$@"
