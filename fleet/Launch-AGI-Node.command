#!/bin/bash
set -eu
cd "$(dirname "$0")/packages/AGI_Node"
exec bash Launch-AGI-Node.command
