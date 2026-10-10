#!/bin/sh
set -eu
AGI_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' 'Advanced — Legacy Migration / Recovery · EXPERIMENTAL' 'For existing installations only. Not required for normal AGI use.' 'Do not run this maintenance track in pristine agiagentcomputev1.'
exec "$AGI_ROOT/Repair-Compute.command" "$@"
