#!/bin/sh
set -eu
AGI_VERIFY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$AGI_VERIFY_ROOT/scripts/node-runtime.sh"
agi_require_node_24
AGI_VERIFY_SCRIPT=$("$AGI_RUNTIME_NODE" -e 'const fs=require("node:fs"),path=require("node:path"),root=process.argv[1],name=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).name;if(name==="montreal-ai-autonomous-fleet")process.stdout.write("verify.mjs");else if(["montreal-ai-private-agi-agent","montreal-ai-private-agi-node","montreal-ai-agi-moderator","montreal-ai-agi-employer","montreal-ai-agi-evidence","montreal-ai-agi-recovery"].includes(name))process.stdout.write("verify-package.mjs");else{console.error("UNRECOGNIZED_PACKAGE_ROLE");process.exit(1)}' "$AGI_VERIFY_ROOT")
"$AGI_RUNTIME_NODE" "$AGI_VERIFY_ROOT/scripts/$AGI_VERIFY_SCRIPT"
printf '%s\n' 'This is an integrity check, not a developer signature.'
if [ -t 0 ]; then
  printf '%s' 'Press Return to close. '
  IFS= read -r AGI_VERIFY_CLOSE || true
fi
