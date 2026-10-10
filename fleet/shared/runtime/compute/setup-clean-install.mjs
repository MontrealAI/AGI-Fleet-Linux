import {assertLinuxHost,linuxUnitNames} from './linux-host.mjs';
import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import {consumerRoot,consumerCompute,consumerFile} from './consumer.mjs';
import {inspectStandardOAuthResume} from './setup-standard-oauth-resume.mjs';
import {classifyLaunchctlPrint} from './service-stop.mjs';
import {fileURLToPath} from 'node:url';
import {inspectFreshReadinessResume} from './setup-fresh-readiness-resume.mjs';
import {inspectFreshOAuthResume} from './setup-fresh-oauth-resume.mjs';
import crypto from 'node:crypto';
import {VERSION} from '../src/version.mjs';
import fs from 'node:fs';
import path from 'node:path';

const need=(value,code)=>{if(!value)throw Error(code);};
const ownedDirectory=(file,uid)=>{const s=fs.lstatSync(file);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid,'CLEAN_INSTALL_HOME_REQUIRED');return s;};
/** Admission is read-only. Never open, repair, archive or adopt old profile state. */
export function inspectCleanInstallTarget({home,role,mode,uid,signerUID,fileUID=process.getuid?.()??uid,retry=false,resumeStandardOAuth=false,resumeOAuth=false,resumeReadiness=false,kit,assuranceMode,platform,runtimePlatform}){
 need(COMPUTE_ROLES.includes(role)&&mode==='workstation','CLEAN_INSTALL_WORKSTATION_REQUIRED');
 need(Number.isInteger(uid)&&uid>0&&Number.isInteger(signerUID)&&signerUID>0&&uid!==signerUID,'COMPUTE_SEPARATE_OS_USER_REQUIRED');
 need(typeof home==='string'&&path.isAbsolute(home)&&path.resolve(home)===home,'CLEAN_INSTALL_HOME_REQUIRED');
 const homeStat=ownedDirectory(home,fileUID);need(!(homeStat.mode&0o022)&&fs.realpathSync(home)===home,'CLEAN_INSTALL_HOME_REQUIRED');
 need(path.basename(home)!=='agiagentcomputev0','CLEAN_INSTALL_LEGACY_ACCOUNT_FROZEN');
 const names=fs.readdirSync(home);
 if(resumeReadiness){need(!retry&&!resumeOAuth,'CLEAN_INSTALL_ARGUMENT_CONFLICT');need(!names.some(n=>(n==='.openclaw'||n.startsWith('.openclaw-'))&&n!==('.openclaw-'+roleContract(role).profile)),'CLEAN_INSTALL_PROFILE_EXISTS');inspectFreshReadinessResume({home,role,uid,signerUID,fileUID,kit,platform,runtimePlatform},{observe:false});return {schema:'agi-clean-install-admission/v1',track:'clean-install',role,continuingFreshReadiness:true,priorSetupAbsent:false,profileAbsent:false};}
 need(!names.some(name=>name==='.openclaw'||name.startsWith('.openclaw-')),'CLEAN_INSTALL_PROFILE_EXISTS');
 const supports=names.filter(name=>name.startsWith('.agi-genesis-setup-'));
 if(resumeStandardOAuth){need(!retry&&!resumeOAuth&&!resumeReadiness&&supports.length===1&&supports[0]==='.agi-genesis-setup-'+role,'STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE');inspectStandardOAuthResume({home,role,uid,signerUID,fileUID,kit,assuranceMode,platform,runtimePlatform});}
 else if(resumeOAuth){need(!retry&&supports.length===1&&supports[0]==='.agi-genesis-setup-'+role,'CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE');inspectFreshOAuthResume({home,role,uid,signerUID,fileUID,kit,platform,runtimePlatform});}
 else if(retry){need(supports.length===1&&supports[0]==='.agi-genesis-setup-'+role,'CLEAN_INSTALL_RETRY_UNAVAILABLE');validateEarlyCleanSupport({home,role,uid,signerUID,fileUID,assuranceMode});}
 else need(supports.length===0,'CLEAN_INSTALL_EVIDENCE_EXISTS');
 let directory=home;
 for(const part of ['Library','LaunchAgents']){directory=path.join(directory,part);const s=fs.lstatSync(directory,{throwIfNoEntry:false});if(!s)return {schema:'agi-clean-install-admission/v1',track:'clean-install',role,profileAbsent:true,priorSetupAbsent:!retry&&!resumeOAuth&&!resumeStandardOAuth,continuingStandardOAuth:resumeStandardOAuth,continuingFreshOAuth:resumeOAuth};need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===fileUID,'CLEAN_INSTALL_HOME_REQUIRED');}
 need(!fs.readdirSync(directory).some(name=>/^ai\.(?:montreal|openclaw)\.agi-(?:(?:node|moderator|employer|evidence|recovery)-)?compute(?:\.|$)/.test(name)),'CLEAN_INSTALL_SERVICE_EXISTS');
 return {schema:'agi-clean-install-admission/v1',track:'clean-install',role,profileAbsent:true,priorSetupAbsent:!retry&&!resumeOAuth&&!resumeStandardOAuth,continuingStandardOAuth:resumeStandardOAuth,continuingFreshOAuth:resumeOAuth};
}
export function assertCleanInstallAdmission(options){
 const admission=inspectCleanInstallTarget(options);
 if(options.platform==='linux'){assertLinuxHost(options);for(const name of Object.values(linuxUnitNames(options.role)))need(!fs.lstatSync(path.join(options.home,'.config/systemd/user',name),{throwIfNoEntry:false}),'CLEAN_INSTALL_SERVICE_EXISTS');}
 else need(options.platform==='darwin'&&options.account==='standard','COMPUTE_STANDARD_ACCOUNT_REQUIRED');
 return {...admission,standardAccount:true,signerSeparated:true};
}
export function standardAccountFromGroups(result){
 if(result?.status!==0||result.error||result.signal||typeof result.stdout!=='string')return 'unknown';
 const groups=result.stdout.trim().split(/\s+/);if(!groups.length||groups.some(group=>!/^[A-Za-z0-9_.-]+$/.test(group)))return 'unknown';
 return groups.includes('admin')?'admin':'standard';
}

const intentName='clean-install-intent.json',archiveName='early-attempts';
const earlyFiles=new Set(['genesis-setup-progress.json','machine-preflight.json','setup-diagnostics.json','setup-result.html','desktop-diagnostics.json']);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readPrivate(file,uid){const st=fs.lstatSync(file);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===uid&&st.nlink===1&&!(st.mode&0o077)&&st.size<=4*1024*1024,'CLEAN_INSTALL_RETRY_UNAVAILABLE');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);need(opened.dev===st.dev&&opened.ino===st.ino&&opened.mode===st.mode&&opened.uid===st.uid&&opened.nlink===1,'CLEAN_INSTALL_RETRY_UNAVAILABLE');const bytes=fs.readFileSync(fd),after=fs.lstatSync(file);need(bytes.length===st.size&&['dev','ino','mode','uid','nlink','size','mtimeMs','ctimeMs'].every(key=>after[key]===st[key]),'CLEAN_INSTALL_RETRY_UNAVAILABLE');return bytes;}finally{fs.closeSync(fd);}}
function expectedIntent({home,role,uid,signerUID}){return {schema:'agi-clean-install-intent/v1',protocolVersion:1,releaseVersion:VERSION,home,role,computeUID:uid,signerUID};}
function parse(bytes){try{return JSON.parse(bytes);}catch{throw Error('CLEAN_INSTALL_RETRY_UNAVAILABLE');}}
function assertEarlyRecords(root,names,uid,options={}){
 if(names.includes('genesis-setup-progress.json')){const value=parse(readPrivate(path.join(root,'genesis-setup-progress.json'),uid));need(value.schema===2&&[null,'preflight','docker','images','desktop'].includes(value.currentStage)&&['profile','oauth','services'].every(stage=>value.stages?.[stage]==='not-attempted')&&Object.values(value.auth??{}).every(value=>value!==true),'CLEAN_INSTALL_RETRY_UNAVAILABLE');}
 if(names.includes('setup-diagnostics.json')){const value=parse(readPrivate(path.join(root,'setup-diagnostics.json'),uid));need(value.installationTrack==='clean-install'&&value.transaction===null&&value.recovery?.profile==='NOT_REQUIRED'&&value.recovery?.serviceFiles==='NOT_REQUIRED'&&['profile','oauth','services'].every(stage=>value.stages?.[stage]==='not-attempted'),'CLEAN_INSTALL_RETRY_UNAVAILABLE');}
 if(options.assuranceMode){
  need(names.includes('setup-diagnostics.json')&&names.includes('genesis-setup-progress.json'),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  const report=parse(readPrivate(path.join(root,'setup-diagnostics.json'),uid)),ledger=parse(readPrivate(path.join(root,'genesis-setup-progress.json'),uid));
  need(['standard','verified'].includes(report.assuranceMode),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  need(report.assuranceMode===options.assuranceMode,'CLEAN_INSTALL_RETRY_MODE_MISMATCH');
  const versions=JSON.parse(fs.readFileSync(consumerFile('config/companion-releases.json'),'utf8'));
  need(same(report.versions,versions)&&/^[a-f0-9]{64}$/.test(report.packageManifestSHA256??''),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  need(report.schema==='agi-setup-support/v2'&&report.passed===false&&same(report.stages,ledger.stages)&&report.runID===ledger.runID&&/^[a-f0-9-]{36}$/.test(report.runID??''),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  need(report.stages[ledger.currentStage]==='failed'&&['preflight','docker','images','desktop'].includes(ledger.currentStage),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  const stages=['preflight','docker','images','desktop','profile','oauth','services'],failed=stages.indexOf(ledger.currentStage);
  need(stages.every((stage,i)=>report.stages[stage]===(i<failed?'passed':i===failed?'failed':'not-attempted')),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  need(['walletAccessed','paidProviderCall','moneyMoved','publicOutput'].every(key=>report[key]===false)&&report.securityReviewDigest===null&&report.serviceReadiness===null&&report.statePreparation===null&&report.cleanInitialization===null&&report.rollbackFailureCode===null,'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  need(Array.isArray(report.serviceShutdown)&&report.serviceShutdown.length===0&&Object.values(ledger.auth??{}).every(value=>value===false),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  if(options.assuranceMode==='standard'){
   // Standard retry is a same-release preflight retry, never a recovery transaction.
   need(['preflight','docker'].includes(ledger.currentStage)&&report.verificationScope==='critical-execution-authority'&&report.componentEvidence===null,'CLEAN_INSTALL_RETRY_UNAVAILABLE');
   const codes=ledger.currentStage==='docker'?['COMPUTE_DOCKER_START_TIMEOUT']:['COMPUTE_DOCKER_REQUIRED','COMPUTE_SEPARATE_OS_USER_REQUIRED','COMPUTE_STANDARD_ACCOUNT_REQUIRED','COMPUTE_DISK_SPACE_REQUIRED','NODE_VERSION_UNSUPPORTED','OPENCLAW_VERSION_MISMATCH'];
   need(codes.includes(report.primaryFailureCode)&&report.failureCode===report.primaryFailureCode&&report.images?.work===null&&report.images?.browser===null&&same(report.executionImages,{}),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
  }
 }

}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function privateDirectory(file,uid){const st=ownedDirectory(file,uid);need(!(st.mode&0o077),'CLEAN_INSTALL_RETRY_UNAVAILABLE');}
function validateArchive(root,uid){
 privateDirectory(root,uid);const names=fs.readdirSync(root);need(names.length<=16,'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 for(const name of names){need(/^attempt-[a-f0-9-]{36}$/.test(name),'CLEAN_INSTALL_RETRY_UNAVAILABLE');const dir=path.join(root,name);privateDirectory(dir,uid);const manifest=parse(readPrivate(path.join(dir,'manifest.json'),uid));need(manifest?.schema==='agi-clean-early-attempt/v1'&&Array.isArray(manifest.files)&&manifest.files.length<=6,'CLEAN_INSTALL_RETRY_UNAVAILABLE');const files=fs.readdirSync(dir).sort();need(same(files,[...manifest.files.map(row=>row.name),'manifest.json'].sort()),'CLEAN_INSTALL_RETRY_UNAVAILABLE');for(const row of manifest.files){need((earlyFiles.has(row.name)||row.name===intentName)&&/^[a-f0-9]{64}$/.test(row.sha256),'CLEAN_INSTALL_RETRY_UNAVAILABLE');const bytes=readPrivate(path.join(dir,row.name),uid);need(row.bytes===bytes.length&&hash(bytes)===row.sha256,'CLEAN_INSTALL_RETRY_UNAVAILABLE');}}
}
export function validateEarlyCleanSupport(options){
 const {home,role,fileUID=process.getuid?.()??options.uid}=options,root=path.join(home,'.agi-genesis-setup-'+role);privateDirectory(root,fileUID);
 const names=fs.readdirSync(root);need(names.includes(intentName)&&names.every(name=>name===intentName||name===archiveName||earlyFiles.has(name)),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 const intent=parse(readPrivate(path.join(root,intentName),fileUID));need(same(intent,expectedIntent(options)),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 for(const name of names)if(earlyFiles.has(name))readPrivate(path.join(root,name),fileUID);
 assertEarlyRecords(root,names,fileUID,options);
 if(names.includes(archiveName))validateArchive(path.join(root,archiveName),fileUID);
 return {root,intent};
}
function syncDirectory(root){const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeExclusive(file,bytes){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
/** Called only after clean admission and the ordinary installer lock. */
export function recordCleanInstallIntent(options){
 const root=path.join(options.home,'.agi-genesis-setup-'+options.role);writeExclusive(path.join(root,intentName),JSON.stringify(expectedIntent(options)));syncDirectory(root);
}
/** Preserve a bounded early attempt before the next ledger can overwrite it. */
export function archiveEarlyCleanAttempt(options){
 const {home,role,fileUID=process.getuid?.()??options.uid}=options,root=path.join(home,'.agi-genesis-setup-'+role);privateDirectory(root,fileUID);const names=fs.readdirSync(root);
 need(names.includes('installer.lock')&&names.every(name=>name==='installer.lock'||name===intentName||name===archiveName||earlyFiles.has(name)),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 need(same(parse(readPrivate(path.join(root,intentName),fileUID)),expectedIntent(options)),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 assertEarlyRecords(root,names,fileUID,options);
 const archive=path.join(root,archiveName);if(fs.lstatSync(archive,{throwIfNoEntry:false}))validateArchive(archive,fileUID);else{fs.mkdirSync(archive,{mode:0o700});syncDirectory(root);}
 need(fs.readdirSync(archive).length<16,'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 const temp=path.join(archive,'.pending-'+crypto.randomUUID()),target=path.join(archive,'attempt-'+crypto.randomUUID());fs.mkdirSync(temp,{mode:0o700});const files=[];
 try{for(const name of names.filter(name=>name===intentName||earlyFiles.has(name)).sort()){const bytes=readPrivate(path.join(root,name),fileUID);writeExclusive(path.join(temp,name),bytes);need(hash(readPrivate(path.join(root,name),fileUID))===hash(bytes),'CLEAN_INSTALL_RETRY_UNAVAILABLE');files.push({name,sha256:hash(bytes),bytes:bytes.length});}writeExclusive(path.join(temp,'manifest.json'),JSON.stringify({schema:'agi-clean-early-attempt/v1',files}));syncDirectory(temp);fs.renameSync(temp,target);syncDirectory(archive);return {schema:'agi-clean-early-attempt/v1',path:path.relative(root,target),files:files.length};}
 catch(error){throw Error('CLEAN_INSTALL_RETRY_UNAVAILABLE',{cause:error});}
}

/** Resolve the existing retry launcher without silently changing assurance tier. */
export function recordedEarlyRetryMode(options){
 const {root}=validateEarlyCleanSupport({...options,assuranceMode:undefined});
 need(fs.existsSync(path.join(root,'setup-diagnostics.json')),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 const report=parse(readPrivate(path.join(root,'setup-diagnostics.json'),options.fileUID??process.getuid()));
 need(['standard','verified'].includes(report.assuranceMode),'CLEAN_INSTALL_RETRY_UNAVAILABLE');
 validateEarlyCleanSupport({...options,assuranceMode:report.assuranceMode});
 return report.assuranceMode;
}
/** Read-only absence checks; this retry never stops, repairs or adopts services. */
export async function assertEarlyRetryServicesAbsent({role,uid,spawn,listen}){
 const profile=roleContract(role).profile;
 for(const label of ['ai.montreal.'+profile,'ai.openclaw.'+profile]){
  const result=spawn('/bin/launchctl',['print','gui/'+uid+'/'+label],{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:8192,shell:false,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  need(classifyLaunchctlPrint(result,label,uid).classification==='absent','CLEAN_INSTALL_RETRY_SERVICE_UNCONFIRMED');
 }
 for(const port of [roleContract(role).port,roleContract(role).gatewayPort])need(!await listen(port),'CLEAN_INSTALL_RETRY_SERVICE_UNCONFIRMED');
}
