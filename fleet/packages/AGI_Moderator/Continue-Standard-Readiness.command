#!/bin/bash
set -eu
cd "$(dirname "$0")"
. "./scripts/node-runtime.sh"
agi_require_node_24
export PATH="$(dirname "$AGI_RUNTIME_NODE"):/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$AGI_RUNTIME_NODE" scripts/setup-openclaw.mjs --continue-standard-readiness "$@"
