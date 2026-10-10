#!/bin/sh
set -eu
AGI_LINUX_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /usr/bin/python3 "$AGI_LINUX_ROOT/scripts/linux-platform.py" prepare "$@"
