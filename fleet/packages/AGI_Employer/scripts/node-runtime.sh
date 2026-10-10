#!/bin/sh
# Source this file, then call agi_require_node_24 before launching Node.
agi_select_node_24() {
  AGI_RUNTIME_NODE=''
  if [ "$#" -eq 0 ]; then
    set -- "$HOME/.agi-genesis-runtime/node-24.21.0/bin/node" /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node "$(command -v node 2>/dev/null || true)"
  fi
  for agi_runtime_candidate do
    if [ -n "$agi_runtime_candidate" ] && [ -x "$agi_runtime_candidate" ] && "$agi_runtime_candidate" -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number);process.exit(major===24&&Number.isInteger(minor)&&minor>=19&&Number.isInteger(patch)&&patch>=0?0:1)' >/dev/null 2>&1; then
      AGI_RUNTIME_NODE=$agi_runtime_candidate
      return 0
    fi
  done
  return 1
}
agi_require_node_24() {
  if agi_select_node_24 "$@"; then return 0; fi
  printf '%s\n' 'Node.js 24.19.0 or later within 24.x is required. No compatible Node executable was found.' 'Install Node.js 24 LTS from https://nodejs.org/en/download, then open this launcher again. See START_HERE.html.' >&2
  return 1
}
