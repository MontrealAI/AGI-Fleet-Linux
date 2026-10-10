#!/bin/bash
set -eu
cd "$(dirname "$0")/packages/AGI_Agent"
exec bash Launch-AGI-Agent.command
