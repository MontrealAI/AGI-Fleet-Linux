#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
source "$HERE/scripts/node-runtime.sh"
agi_require_node_24
printf '%s\n' 'Prepare the private OpenClaw runtime — existing profiles and installation are preserved.'
agi_runtime_exit=0
"$AGI_RUNTIME_NODE" "$HERE/packages/AGI_Agent/compute/prepare-runtime.mjs" || agi_runtime_exit=$?
printf '%s\n' 'Press Return to close.'
read -r _
exit "$agi_runtime_exit"
