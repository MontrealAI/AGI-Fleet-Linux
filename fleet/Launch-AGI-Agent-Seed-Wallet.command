#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$AGI_ROOT/packages/AGI_Agent/Launch-Seed-Wallet.command"
