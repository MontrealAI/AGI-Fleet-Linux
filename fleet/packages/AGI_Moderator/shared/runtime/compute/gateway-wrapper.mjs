import fs from 'node:fs';
import path from 'node:path';
import {runtimeEnvironment,inspectExecutable} from './runtime-env.mjs';
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export function gatewayWrapperPlan(c){
  const env=runtimeEnvironment(c),entry=inspectExecutable(c.openclaw,'openclaw',{home:c.home}).realPath;
  const header=fs.readFileSync(entry,'utf8').slice(0,256);
  if(!/\.(?:mjs|cjs|js)$/.test(entry)&&!/^\x23![^\n]*\bnode(?:\s|$)/.test(header))throw Error('COMPUTE_OPENCLAW_ENTRYPOINT_UNSUPPORTED');
  const heapMiB=c.gatewayHeapMiB??4096;
  if(!Number.isInteger(heapMiB)||heapMiB<128||heapMiB>16384)throw Error('COMPUTE_GATEWAY_HEAP_INVALID');
  const filename=path.join(c.profileDir,'agi-runtime','gateway-wrapper');
  const runtimeEnv={...env,NODE_OPTIONS:`--max-old-space-size=${heapMiB}`};
  const checks=['node','openclaw','docker'].map(kind=>{const identity=c.executableIdentity?.[kind]??inspectExecutable(c[kind],kind,{home:c.home});return [...new Set([identity.path,identity.realPath])].map(file=>`actual=$(${c.deploymentPlatform==='linux'?'/usr/bin/sha256sum':'/usr/bin/shasum -a 256'} < ${quote(file)}) || exit 1\n[ \"\${actual%% *}\" = ${quote(identity.sha256)} ] || { echo COMPUTE_RUNTIME_EXECUTABLE_CHANGED >&2; exit 1; }`).join('\n');}).join('\n');
  const content=`\x23!/bin/sh\nset -eu\numask 077\n# Managed AGI Gateway entry point. Existing manual wrappers are preserved.\n${checks}\nexec /usr/bin/env -i ${Object.entries(runtimeEnv).map(([k,v])=>quote(k+'='+v)).join(' ')} ${quote(c.node)} ${quote('--max-old-space-size='+heapMiB)} ${quote(entry)} "$@"\n`;
  return {path:filename,content,mode:0o700,heapMiB,installEnvironment:{OPENCLAW_WRAPPER:filename,NODE_OPTIONS:runtimeEnv.NODE_OPTIONS},profile:env.OPENCLAW_PROFILE};
}
