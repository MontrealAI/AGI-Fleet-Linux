#!/bin/bash
set -eu
cd "$(dirname "$0")"
. "./scripts/node-runtime.sh"
agi_require_node_24
exec "$AGI_RUNTIME_NODE" workforce/cli.mjs menu
