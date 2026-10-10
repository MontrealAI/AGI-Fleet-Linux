#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$AGI_ROOT/AGI Node.app/Contents/MacOS/start" --seed-profile
