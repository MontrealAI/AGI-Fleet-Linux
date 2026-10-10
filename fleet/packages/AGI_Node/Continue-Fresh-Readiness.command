#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_ROOT/scripts/node-runtime.sh"
agi_require_node_24
export PATH="$(dirname "$AGI_RUNTIME_NODE"):/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$AGI_RUNTIME_NODE" "$AGI_ROOT/scripts/setup-openclaw.mjs" --resume-fresh-readiness "$@"
