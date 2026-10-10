#!/bin/sh
set -eu
AGI_LINUX_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$AGI_LINUX_ROOT/packages/AGI_Agent/Launch.sh" "$@"
