import {ALL_OAUTH_ROLES} from './roles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const STAGES=['preflight','docker','images','desktop','profile','oauth','services'];
export const LABELS=['Check this computer and account','Wait for Docker','Prepare sandbox images','Test the disposable desktop','Prepare the dedicated profile','Connect ChatGPT for each role','Start and verify services'];
export function acquireSetupLock(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'installer.lock');
  try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.closeSync(fd);}catch(e){if(e.code==='EEXIST')throw Error('SETUP_ALREADY_RUNNING_OR_INTERRUPTED');throw e;}
  return ()=>fs.rmSync(file,{force:true});
}
export function clearInterruptedLock(directory){
  const file=path.join(directory,'installer.lock');if(!fs.existsSync(file))return false;
  const old=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(old.pid)||old.pid<=0)throw Error('SETUP_LOCK_INVALID');
  try{process.kill(old.pid,0);throw Error('SETUP_ALREADY_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}
  fs.rmSync(file);return true;
}
export function stageLedger(profileDir){
  fs.mkdirSync(profileDir,{recursive:true,mode:0o700});const file=path.join(profileDir,'genesis-setup-progress.json');let old={};try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const value={schema:2,runID:crypto.randomUUID(),startedAt:new Date().toISOString(),currentStage:null,stages:Object.fromEntries(STAGES.map(s=>[s,'not-attempted'])),auth:{},stageSeconds:{}};
  for(const a of ALL_OAUTH_ROLES)if(old.auth?.[a]===true)value.auth[a]=true;
  const save=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);};save();
  return {value,save,async stage(name,work){if(!STAGES.includes(name))throw Error('SETUP_STAGE_INVALID');console.log(`\n[${STAGES.indexOf(name)+1}/7] ${LABELS[STAGES.indexOf(name)]}`);value.currentStage=name;value.stages[name]='running';save();const start=performance.now();try{const r=await work();value.stages[name]='passed';return r;}catch(e){value.stages[name]='failed';throw e;}finally{value.stageSeconds[name]=(performance.now()-start)/1000;save();}}};
}
export function readSetupArguments(args){
  const allowed=new Set(['--continue-standard-readiness','--continue-standard-install','--standard-install','--verified-install','--resume-fresh-readiness','--resume-fresh-oauth','--experimental-legacy','--retry-clean-install','--retry-standard-install','--retry-verified-install','--clean-install','--selftest-only','--fresh-build','--non-interactive','--acknowledge-separation','--refresh-stopped-profile','--recover-interrupted-lock']);
  let file=null;const flags=new Set();
  for(const arg of args){if(arg.startsWith('--')){if(!allowed.has(arg))throw Error('SETUP_ARGUMENT_UNSUPPORTED');flags.add(arg);}else if(file===null)file=arg;else throw Error('SETUP_ARGUMENT_UNSUPPORTED');}
  if(flags.has('--continue-standard-readiness')&&['--continue-standard-install','--verified-install','--experimental-legacy','--resume-fresh-oauth','--resume-fresh-readiness','--retry-clean-install','--retry-standard-install','--retry-verified-install','--selftest-only','--non-interactive','--fresh-build','--refresh-stopped-profile','--recover-interrupted-lock'].some(flag=>flags.has(flag)))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(flags.has('--continue-standard-install')&&['--verified-install','--experimental-legacy','--resume-fresh-oauth','--resume-fresh-readiness','--retry-clean-install','--retry-standard-install','--retry-verified-install','--selftest-only','--non-interactive','--refresh-stopped-profile','--recover-interrupted-lock'].some(flag=>flags.has(flag)))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  const retries=['--retry-clean-install','--retry-standard-install','--retry-verified-install'];
  const retry=retries.some(f=>flags.has(f));
  if(retries.filter(f=>flags.has(f)).length>1)throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(flags.has('--standard-install')&&(flags.has('--verified-install')||flags.has('--experimental-legacy')||flags.has('--retry-verified-install')||['--resume-fresh-oauth','--resume-fresh-readiness'].some(f=>flags.has(f))))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(flags.has('--verified-install')&&(flags.has('--experimental-legacy')||flags.has('--retry-standard-install')))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(flags.has('--experimental-legacy')&&(flags.has('--clean-install')||retry||flags.has('--resume-fresh-oauth')||flags.has('--resume-fresh-readiness')))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if((flags.has('--clean-install')||retry||flags.has('--resume-fresh-oauth')||flags.has('--resume-fresh-readiness'))&&['--selftest-only','--non-interactive','--refresh-stopped-profile','--recover-interrupted-lock'].some(flag=>flags.has(flag)))throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(!flags.has('--experimental-legacy')&&['--refresh-stopped-profile','--recover-interrupted-lock'].some(flag=>flags.has(flag)))throw Error('EXPERIMENTAL_LEGACY_OPT_IN_REQUIRED');
  if([flags.has('--resume-fresh-oauth'),retry,flags.has('--resume-fresh-readiness')].filter(Boolean).length>1)throw Error('CLEAN_INSTALL_ARGUMENT_CONFLICT');
  if(flags.has('--non-interactive')&&!flags.has('--selftest-only'))throw Error('NONINTERACTIVE_DESKTOP_ONLY_REQUIRED');
  if(flags.has('--non-interactive')&&file===null)throw Error('SETUP_FILE_REQUIRED');
  if(flags.has('--non-interactive')&&!flags.has('--acknowledge-separation'))throw Error('NONINTERACTIVE_SEPARATION_REQUIRED');
  return {file,standardReadinessResume:flags.has('--continue-standard-readiness'),standardOAuthResume:flags.has('--continue-standard-install'),assuranceMode:flags.has('--retry-clean-install')&&!flags.has('--standard-install')&&!flags.has('--verified-install')?'preserve':flags.has('--verified-install')||flags.has('--retry-verified-install')||flags.has('--experimental-legacy')||['--resume-fresh-oauth','--resume-fresh-readiness','--selftest-only'].some(f=>flags.has(f))?'verified':'standard',cleanReadinessResume:flags.has('--resume-fresh-readiness'),cleanOAuthResume:flags.has('--resume-fresh-oauth'),experimentalLegacy:flags.has('--experimental-legacy'),cleanInstall:!flags.has('--experimental-legacy')&&!flags.has('--selftest-only'),cleanRetry:retry,selftestOnly:flags.has('--selftest-only'),fresh:flags.has('--fresh-build'),nonInteractive:flags.has('--non-interactive'),acknowledgeSeparation:flags.has('--acknowledge-separation'),refreshStopped:flags.has('--refresh-stopped-profile'),recoverLock:flags.has('--recover-interrupted-lock')};
}
export function validateHandoffFile(file,{repairPermissions=true}={}){
  const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>8192||process.getuid&&s.uid!==process.getuid())throw Error('SETUP_FILE_OWNER_REQUIRED');
  if(process.platform!=='win32'&&(s.mode&0o077)!==0){if(!repairPermissions)throw Error('SETUP_FILE_PRIVATE_MODE_REQUIRED');try{fs.chmodSync(file,0o600);}catch{throw Error('SETUP_FILE_PRIVATE_MODE_REQUIRED');}}
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
