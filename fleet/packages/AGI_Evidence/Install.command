#!/bin/bash
set -eu
cd "$(dirname "$0")"
. "./scripts/node-runtime.sh"
. "./scripts/standard-node.sh"
agi_standard_node
export PATH="$(dirname "$AGI_RUNTIME_NODE"):/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$AGI_RUNTIME_NODE" scripts/setup-openclaw.mjs --standard-install "$@"
