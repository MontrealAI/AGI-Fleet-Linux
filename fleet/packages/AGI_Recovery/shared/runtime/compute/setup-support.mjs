import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {safeDesktopReport,releaseIdentity} from './desktop-evidence.mjs';
export {safeDesktopReport} from './desktop-evidence.mjs';
import {fileURLToPath} from 'node:url';
export function requireStandardComputeAccount(facts) {
  if (facts.account==='root'||facts.account==='admin'||facts.platform==='darwin'&&facts.account!=='standard') {
    throw Error('COMPUTE_STANDARD_ACCOUNT_REQUIRED');
  }
}
export {STAGES,LABELS,stageLedger} from './setup-ledger.mjs';
export async function waitForDocker(probe,{timeoutMs=90000,intervalMs=1500,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),progress=()=>{}}={}) {
  const start=now();let attempts=0;
  while(now()-start<timeoutMs){attempts++;if(await probe(Math.max(1,timeoutMs-(now()-start))))return {attempts,elapsedMs:now()-start};progress(attempts);await pause(Math.min(intervalMs,Math.max(0,timeoutMs-(now()-start))));}
  throw new Error('COMPUTE_DOCKER_START_TIMEOUT');
}
export function contextHash(root) {
  const h=crypto.createHash('sha256');
  function visit(dir){for(const name of fs.readdirSync(dir).sort()){if(['node_modules','__pycache__'].includes(name)||name.endsWith('.pyc'))continue;const p=path.join(dir,name),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('BUILD_CONTEXT_SYMLINK');if(s.isDirectory())visit(p);else if(s.isFile()){h.update(path.relative(root,p));h.update('\0');h.update(fs.readFileSync(p));}}}
  visit(root);return h.digest('hex');
}
export function ensureImage(run,docker,root,tag,{fresh=false,onVerified=()=>{}}={}) {
  const hash=contextHash(root),label='ai.montreal.agi.recipe';
  const inspect=()=>{try{const r=run(docker,['image','inspect',tag],true);const i=JSON.parse(r.stdout)[0];return r.status===0&&/^sha256:[a-f0-9]{64}$/.test(i.Id)&&i.Config?.Labels?.[label]===hash?i.Id:null;}catch{return null;}};
  const accepted=(imageID,admission)=>{const receipt={schema:'agi-execution-image/v1',imageID,tag,recipeSHA256:hash,label,admission};verifyExecutionImage(run,docker,root,receipt);onVerified(receipt);return imageID;};
  const cached=inspect();if(cached&&!fresh){console.log('Verified cached image: '+tag);return accepted(cached,'verified-cache');}
  const built=run(docker,['build','--pull',...(fresh?['--no-cache']:[]),'--label',`${label}=${hash}`,'-t',tag,root]);if(built.status!==0)throw Error('COMPUTE_SANDBOX_BUILD_FAILED');
  const id=inspect();if(!id)throw Error('COMPUTE_SANDBOX_BUILD_FAILED');return accepted(id,'verified-build');
}
// Resolve the admitted immutable ID itself, independently of a mutable tag.
export function verifyExecutionImage(run,docker,root,receipt){
  try{
    if(receipt?.schema!=='agi-execution-image/v1'||receipt.recipeSHA256!==contextHash(root)||receipt.label!=='ai.montreal.agi.recipe'||!/^sha256:[a-f0-9]{64}$/.test(receipt.imageID))throw Error();
    const result=run(docker,['image','inspect',receipt.imageID],true),values=JSON.parse(result.stdout);
    if(result.status!==0||!Array.isArray(values)||values.length!==1||values[0].Id!==receipt.imageID||values[0].Config?.Labels?.[receipt.label]!==receipt.recipeSHA256)throw Error();
    return true;
  }catch{throw Error('COMPUTE_SANDBOX_BUILD_FAILED');}
}
export function desktopCheck(run,docker,imageID,{strictCleanup=false}={}) {
  const runID=crypto.randomUUID(),identity=releaseIdentity(consumerRoot);
  const name='agi-selftest-'+crypto.randomBytes(8).toString('hex');let result,inspect;
  try{
    result=run(docker,['run','--name',name,'--network','none','--read-only','--cap-drop','ALL','--pids-limit','384','--memory','4g','--cpus','2','--tmpfs','/tmp:rw,nosuid,size=768m','--tmpfs','/workspace:rw,uid=1000,gid=1000,mode=700,size=128m',imageID,'python3','/usr/local/lib/agi-workstation-selftest.py','--capture-fixture'],true);
    try{inspect=JSON.parse(run(docker,['inspect','--format','{{json .State}}',name],true).stdout);}catch{}
    let detail;for(const line of String(result.stdout??'').split('\n')){try{const v=JSON.parse(line);if(['agi-workstation-check/v2','agi-workstation-check/v3'].includes(v.schema))detail=v;}catch{}}
    const report={schema:'agi-desktop-installer-check/v1',passed:result.status===0&&detail?.passed===true&&inspect?.OOMKilled===false&&inspect?.ExitCode===0,exitCode:result.status??124,oomKilled:typeof inspect?.OOMKilled==='boolean'?inspect.OOMKilled:null,detail:detail??null,runID,imageID,...identity,isolatedSynthetic:true,walletAccessed:false,productionFrameRuleUnchanged:true};
    if(!report.passed){console.error('Desktop self-test failed. Wallet and signer state were not accessed.');console.error('Command: docker run [bounded, network:none] IMAGE python3 /usr/local/lib/agi-workstation-selftest.py');console.error(JSON.stringify(safeDesktopReport(report),null,2));}
    return report;
  }finally{const removed=run(docker,['rm','--force',name],true);if(strictCleanup){const after=run(docker,['ps','-aq','--filter','name=^/'+name+'$'],true);if(removed.status!==0||removed.error||removed.signal||after.status!==0||after.error||after.signal||String(after.stdout??'').trim()!=='')throw Error('COMPUTE_SANDBOX_CLEANUP_FAILED');}}
}
