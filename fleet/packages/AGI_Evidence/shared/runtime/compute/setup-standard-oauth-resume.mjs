import {roleContract,COMPUTE_ROLES,OPERATOR_ROLES,setupRole} from './roles.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {canonical} from '../src/util.mjs';import {VERSION} from '../src/version.mjs';
import {freshOAuthEvidenceTree,seedFreshOAuthRoles} from './setup-fresh-oauth-resume.mjs';
import {withPrivateTemporary} from './setup-private-temp.mjs';
import {sqliteStandardAuthority} from './setup-runtime-sqlite.mjs';
import {isCandidateStatePreparationReceipt} from './setup-state-preparation.mjs';
import {computeProfile} from './profile.mjs';import {makePublicBrowserPolicy,applyPublicBrowserProfile} from './public-browser-config.mjs';
import {assertAuthorizedOAuthChanges} from './setup-oauth-delta.mjs';
import {classifyLaunchctlPrint} from './service-stop.mjs';import {publicBrowserRuntimeSocketPath,inspectPublicBrowserSocket} from './public-browser-runtime.mjs';
const SOURCES=JSON.parse(fs.readFileSync(new URL('./standard-oauth-sources.json',import.meta.url)));
const CODE='STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE',BINDING='standard-oauth-continuation.json',ARCHIVES='standard-oauth-attempts';
const files=['clean-install-intent.json','genesis-setup-progress.json','machine-preflight.json','setup-diagnostics.json','setup-result.html','desktop-diagnostics.json'];
const present=file=>Boolean(fs.lstatSync(file,{throwIfNoEntry:false})),sha=data=>crypto.createHash('sha256').update(data).digest('hex'),same=(a,b)=>canonical(a)===canonical(b);
function need(ok,predicate){if(!ok){const error=Error(CODE);error.freshOAuthDiagnostic={schema:'agi-fresh-oauth-diagnostic/v1',substage:'standard-continuation-admission',predicate};throw error;}}
function owned(file,uid,directory=false){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===uid&&!(s.mode&0o077)&&(directory?s.isDirectory():s.isFile()&&s.nlink===1),'private-owned-object');return s;}
function bytes(file,uid){const before=owned(file,uid);need(before.size<=128*1024*1024,'bounded-object');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino,'opened-object-bound');const data=fs.readFileSync(fd),after=owned(file,uid);need(data.length===before.size&&['dev','ino','uid','mode','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]),'source-stable');return data;}finally{fs.closeSync(fd);}}
function json(file,uid){try{return JSON.parse(bytes(file,uid));}catch(error){if(error.freshOAuthDiagnostic)throw error;need(false,'required-private-json');}}
function sync(directory){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,data){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const next=file+'.next';need(!present(next),'pending-write-absent');write(next,JSON.stringify(value,null,2));fs.renameSync(next,file);sync(path.dirname(file));}
function bindingIdentity(o){return sha(canonical({kit:o.kit,home:o.home,role:o.role,uid:o.uid,signerUID:o.signerUID,assuranceMode:'standard'}));}
function paths(o){const root=path.join(o.home,'.agi-genesis-setup-'+o.role),profileDir=path.join(o.home,'.openclaw-'+roleContract(o.role).profile);return {root,profileDir};}
function rebase(value,from,to){return typeof value==='string'&&(value===from||value.startsWith(from+path.sep))?to+value.slice(from.length):Array.isArray(value)?value.map(x=>rebase(x,from,to)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v,from,to)])):value;}
function inspectSource(o,recordsRoot,directory){
 const {profileDir}=paths(o),uid=o.fileUID,role=o.role,roles=roleContract(role).oauth;
 const intent=json(path.join(recordsRoot,files[0]),uid),progress=json(path.join(recordsRoot,files[1]),uid),report=json(path.join(recordsRoot,files[3]),uid),state=json(path.join(directory,'transaction.json'),uid),candidate=path.join(directory,'candidate');
 need(intent.schema==='agi-clean-install-intent/v1'&&intent.protocolVersion===1&&intent.home===o.home&&intent.role===role&&intent.computeUID===o.uid&&intent.signerUID===o.signerUID,'same-release-standard-intent');
 need(report.schema==='agi-setup-support/v2'&&report.assuranceMode==='standard'&&report.verificationScope==='critical-execution-authority'&&report.installationTrack==='clean-install'&&report.statePreparationMode==='fresh-current-schema'&&report.legacyMigrationRequired===false,'standard-provenance');
 const source=SOURCES.sources.find(x=>same(x.versions,report.versions)&&x.packageManifestSHA256===report.packageManifestSHA256);need(source&&same(source.sourceHashes,report.sourceHashes)&&intent.releaseVersion===source.versions[role],'delivered-source-release');
 need(report.passed===false&&report.failureCode==='SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED'&&report.primaryFailureCode===report.failureCode&&report.rollbackFailureCode===null&&report.failureRecordingFailed===false,'exact-known-failure');
 need(report.securityReviewDigest===null&&report.serviceReadiness===null&&report.cleanInitialization===null&&report.componentEvidence===null&&report.freshOAuthResume===null&&Array.isArray(report.serviceShutdown)&&report.serviceShutdown.length<=2&&report.serviceShutdown.every(item=>item.state==='passed'&&item.failureCode===null&&item.socketsAbsent===true&&Object.values(item.servicesAbsent??{}).length===2&&Object.values(item.servicesAbsent).every(value=>value===true)&&Object.values(item.portsClosed??{}).length===2&&Object.values(item.portsClosed).every(value=>value===true))&&same(report.recovery,{profile:'NOT_REQUIRED',serviceFiles:'NOT_REQUIRED'})&&['walletAccessed','paidProviderCall','moneyMoved','publicOutput'].every(k=>report[k]===false),'pre-approval-no-effects');
 const stages={preflight:'passed',docker:'passed',images:'passed',desktop:'passed',profile:'passed',oauth:'failed',services:'not-attempted'};
 need(progress.schema===2&&progress.currentStage==='oauth'&&same(progress.stages,stages)&&same(report.stages,stages)&&report.runID===progress.runID&&/^[a-f0-9-]{36}$/.test(report.runID)&&roles.every(r=>progress.auth?.[r]===true)&&same(Object.keys(progress.auth).sort(),[...roles].sort()),'oauth-role-boundary');
 need(state.schema===1&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.id??'')&&state.assuranceMode==='standard'&&state.installationTrack==='standard-install'&&state.state==='prepared'&&state.profileDir===profileDir&&state.previousExisted===false&&state.baseIdentity===null&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.primaryFailureCode===report.primaryFailureCode&&!state.rollbackFailureCode&&state.approval===null&&state.approvedIdentity===null&&state.completedIdentity===null&&state.runtimeSecurityVersion===undefined&&state.componentEvidenceVersion===undefined&&report.transaction?.id===state.id&&report.transaction.state==='prepared','standard-prepared-transaction');
 for(const key of ['standardReviewedAuthority','standardSealedAuthority','standardManagedServiceAuthority','runtimeSecurityRecord','approvedSecurityRecord'])need(state[key]===undefined,'no-persisted-approval-authority');
 need(fs.readdirSync(directory).every(name=>['candidate','transaction.json','oauth-config-before.json','state-preparation-receipt.json'].includes(name)),'bounded-preapproval-transaction');
 need(isCandidateStatePreparationReceipt(state.preparationReceipt)&&same(state.preparationReceipt,json(path.join(directory,'state-preparation-receipt.json'),uid))&&same(report.statePreparation,state.preparationReceipt),'owner-preparation-receipt');
 const c=json(path.join(candidate,'compute-settings.json'),uid),config=json(path.join(candidate,'openclaw.json'),uid),before=json(path.join(directory,'oauth-config-before.json'),uid);
 need(c.assuranceMode==='standard'&&c.schema===1&&c.role===role&&c.workstation===true&&c.profileDir===profileDir&&c.token===o.kit.token&&c.signerUID===o.signerUID&&c.port===o.kit.port&&c.gatewayPort===(roleContract(role).gatewayPort)&&c.maxRuns24h===48&&c.maxImages24h===8&&c.gatewayHeapMiB===4096&&c.policySealVersion===2&&!c.policyHash&&!c.standardOAuthAuthority&&c.capabilityPolicy==='offline-public/v1'&&c.isolationAcknowledged===true&&/^[a-f0-9]{64}$/.test(c.gatewayToken),'setup-kit-and-authority');
 const policy=makePublicBrowserPolicy({profileDir,uid:o.fileUID,platform:o.runtimePlatform??o.platform,operatorPublicKey:o.kit.publicWebAuthority});need(same(c.publicWebPolicy,policy),'browser-policy');
 const generated=applyPublicBrowserProfile(computeProfile({token:c.gatewayToken,port:c.gatewayPort,model:o.kit.model,workspace:path.join(candidate,'workspace'),imageID:c.imageID,workstation:true,role,jobRoot:path.join(candidate,'jobs'),inputRoot:path.join(candidate,'workspace/job-input'),browserImageID:c.browserImageID}),{...policy,pluginDirectory:path.join(candidate,'agi-runtime/public-browser-plugin')});generated.models={...generated.models,mode:'replace'};
 // The source's private candidate was never published. In an archive its recorded
 // paths still name the original transaction; compare using that exact location.
 const recordedCandidate=path.join(paths(o).root,'transaction/candidate');
 need(same(rebase(generated,candidate,recordedCandidate),before),'generated-pre-oauth-config');
 assertAuthorizedOAuthChanges(rebase(before,recordedCandidate,profileDir),config,{allowPinnedFirstStart:true,allowOpenAIVisibility:true});
 const desktop=json(path.join(recordsRoot,'desktop-diagnostics.json'),uid);
 need(desktop.passed===true&&same(desktop,report.desktop)&&desktop.imageID===c.imageID&&desktop.packageManifestSHA256===report.packageManifestSHA256&&same(desktop.versions,Object.fromEntries(['fleet','agent','node'].map(key=>[key,report.versions[key]])))&&same(desktop.sourceHashes,source.sourceHashes),'desktop-release-association');
 need(c.executionImageVerification?.schema==='agi-execution-images/v1'&&c.executionImageVerification.releaseVersion===source.versions[role]&&same(c.executionImageVerification.images,report.executionImages),'historical-image-receipts');
 for(const kind of ['work','browser']){const receipt=report.executionImages[kind];need(receipt?.schema==='agi-execution-image/v1'&&receipt.imageID===report.images[kind]&&receipt.imageID===(kind==='work'?c.imageID:c.browserImageID)&&/^sha256:[a-f0-9]{64}$/.test(receipt.imageID)&&receipt.recipeSHA256===source.imageRecipes[kind]&&receipt.label==='ai.montreal.agi.recipe'&&['verified-cache','verified-build'].includes(receipt.admission),'historical-image-provenance');}
 const identity=freshOAuthEvidenceTree(directory,uid);
 const auth=withPrivateTemporary('agi-standard-auth-observe-',temp=>{
  const output={};for(const relative of ['state/openclaw.sqlite',...roles.map(r=>'agents/'+r+'/agent/openclaw-agent.sqlite')]){
   const original=path.join(candidate,relative),copy=path.join(temp,relative);fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});for(const suffix of ['','-wal','-shm','-journal'])if(present(original+suffix))write(copy+suffix,bytes(original+suffix,uid));
   output[relative]=sqliteStandardAuthority(copy,{root:temp,profileDir,relative,requiredOpenAIOrder:relative.startsWith('agents/')});
   if(relative==='state/openclaw.sqlite'){const db=new DatabaseSync(copy,{readOnly:true});try{need(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='operator_approval_standing_grants'").get(),'exact-lazy-table-failure');}finally{db.close();}}
  }return output;
 },{uid});need(freshOAuthEvidenceTree(directory,uid).sha256===identity.sha256,'failed-attempt-unchanged');
 return {state,c,roles,config,identity,auth,report};
}
function verifyArchive(o,binding){
 const {root}=paths(o),uid=o.fileUID;need(binding.schema==='agi-standard-oauth-binding/v1'&&binding.kitIdentity===bindingIdentity(o)&&/^standard-oauth-attempts\/attempt-[a-f0-9-]{36}$/.test(binding.archive),'durable-continuation-binding');
 const archive=path.join(root,binding.archive);owned(path.dirname(archive),uid,true);owned(archive,uid,true);const manifest=json(path.join(archive,'manifest.json'),uid);need(sha(bytes(path.join(archive,'manifest.json'),uid))===binding.manifestSHA256,'archive-manifest-bound');
 need(manifest.schema==='agi-standard-oauth-attempt/v1'&&manifest.transactionIdentity===binding.sourceIdentity&&same(manifest.files.map(x=>x.name),files),'archive-contract');
 for(const row of manifest.files){const data=bytes(path.join(archive,row.name),uid);need(data.length===row.bytes&&sha(data)===row.sha256,'archived-report-unchanged');}
 need(same(fs.readdirSync(archive).sort(),[...files,'manifest.json','transaction'].sort()),'archive-membership');
 const source=inspectSource(o,archive,path.join(archive,'transaction'));need(source.identity.sha256===binding.sourceIdentity&&same(source.identity.rows,manifest.transactionFiles),'archived-transaction-unchanged');return {archive,...source};
}
export function inspectStandardOAuthResume(o){
 need(o.assuranceMode==='standard','standard-mode-required');need(path.isAbsolute(o.home)&&path.resolve(o.home)===o.home&&fs.realpathSync(o.home)===o.home,'canonical-home');const homeStat=fs.lstatSync(o.home);need(homeStat.isDirectory()&&!homeStat.isSymbolicLink()&&homeStat.uid===o.fileUID&&!(homeStat.mode&0o022),'home-owner');const {root,profileDir}=paths(o);owned(root,o.fileUID,true);need(fs.realpathSync(root)===root&&!present(profileDir),'no-live-profile');
 need(fs.readdirSync(root).every(name=>[...files,'transaction','installer.lock',BINDING,ARCHIVES].includes(name)),'support-membership');
 const file=path.join(root,BINDING);if(!present(file))return {root,...inspectSource(o,root,path.join(root,'transaction'))};
 const binding=json(file,o.fileUID);need(binding.schema==='agi-standard-oauth-binding/v1'&&binding.kitIdentity===bindingIdentity(o)&&['archiving','archived'].includes(binding.phase)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding.sourceTransactionId??'')&&binding.archive===ARCHIVES+'/attempt-'+binding.sourceTransactionId&&/^[a-f0-9]{64}$/.test(binding.sourceIdentity??'')&&/^[a-f0-9]{64}$/.test(binding.manifestSHA256??''),'durable-continuation-binding');
 const archive=path.join(root,binding.archive),live=path.join(root,'transaction');
 if(present(live)){need(binding.phase==='archiving'&&!present(path.join(archive,'transaction')),'archive-state');const source=inspectSource(o,root,live);need(source.identity.sha256===binding.sourceIdentity,'pending-source-unchanged');return {root,...source,binding};}
 need(present(path.join(archive,'transaction')),'archived-source-present');return {root,...verifyArchive(o,binding),binding};
}
export async function assertStandardContinuationStopped(o){
 const labels=[roleContract(o.role).computeLabel,roleContract(o.role).gatewayLabel];
 for(const label of labels){const result=o.spawn('/bin/launchctl',['print',`gui/${o.uid}/${label}`],{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:8192,shell:false,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});need(classifyLaunchctlPrint(result,label,o.uid,1).classification==='absent','services-not-installed');}
 for(const port of [o.kit.port,roleContract(o.role).gatewayPort])need(await o.listen(port)===false,'ports-closed');
 const socketOptions={profileDir:paths(o).profileDir,uid:o.fileUID,platform:o.runtimePlatform??o.platform,allowLegacy:true};
 need([publicBrowserRuntimeSocketPath(socketOptions.profileDir,socketOptions),path.join(socketOptions.profileDir,'web.sock')].every(file=>!inspectPublicBrowserSocket(file,socketOptions).exists),'runtime-sockets-absent');
 const launchAgents=path.join(o.home,'Library/LaunchAgents');if(present(launchAgents))need(!fs.readdirSync(launchAgents).some(name=>/^ai\.(montreal|openclaw)\.agi-(node-)?compute/.test(name)),'service-files-absent');
}
export function recoverStandardOAuthLock(o){const {root}=paths(o),file=path.join(root,'installer.lock');if(!present(file))return;inspectStandardOAuthResume(o);const data=bytes(file,o.fileUID),lock=JSON.parse(data);need(Number.isSafeInteger(lock.pid)&&lock.pid>0,'installer-lock');try{process.kill(lock.pid,0);need(false,'concurrent-installer');}catch(error){if(error.code!=='ESRCH')throw error;}need(same(bytes(file,o.fileUID),data),'installer-lock-unchanged');fs.unlinkSync(file);sync(root);}
export async function archiveStandardOAuthAttempt(o,{hook=()=>{}}={}){
 await assertStandardContinuationStopped(o);let source=inspectStandardOAuthResume(o),{root}=source,uid=o.fileUID,binding=source.binding;
 if(!binding){
  need(!present(path.join(root,ARCHIVES)),'single-bounded-continuation');
  const manifest={schema:'agi-standard-oauth-attempt/v1',transactionIdentity:source.identity.sha256,transactionFiles:source.identity.rows,files:files.map(name=>{const data=bytes(path.join(root,name),uid);return {name,bytes:data.length,sha256:sha(data)};})};
  const manifestBytes=JSON.stringify(manifest,null,2);
  binding={schema:'agi-standard-oauth-binding/v1',phase:'archiving',kitIdentity:bindingIdentity(o),archive:ARCHIVES+'/attempt-'+source.state.id,sourceIdentity:source.identity.sha256,manifestSHA256:sha(manifestBytes),sourceTransactionId:source.state.id,manifest};
  // Bind the plan before allocating archive paths or copying any evidence.
  save(path.join(root,BINDING),binding);hook('archive-bound');
 }
 if(binding.phase==='archiving'&&present(path.join(root,'transaction'))){
  need(binding.manifest?.schema==='agi-standard-oauth-attempt/v1'&&sha(JSON.stringify(binding.manifest,null,2))===binding.manifestSHA256,'pending-archive-plan');
  const base=path.join(root,ARCHIVES),archive=path.join(root,binding.archive);if(!present(base))fs.mkdirSync(base,{mode:0o700});owned(base,uid,true);if(!present(archive))fs.mkdirSync(archive,{mode:0o700});owned(archive,uid,true);
  need(fs.readdirSync(base).length===1&&fs.readdirSync(base)[0]===path.basename(archive),'archive-parent-membership');
  need(fs.readdirSync(archive).every(name=>[...files,'manifest.json'].includes(name)),'pending-archive-membership');
  for(const row of binding.manifest.files){const data=bytes(path.join(root,row.name),uid);need(data.length===row.bytes&&sha(data)===row.sha256,'source-report-bound');const target=path.join(archive,row.name);if(present(target))need(same(bytes(target,uid),data),'pending-copy-bound');else write(target,data);hook('report-copied');}
  const target=path.join(archive,'manifest.json'),manifestBytes=JSON.stringify(binding.manifest,null,2);if(present(target))need(sha(bytes(target,uid))===binding.manifestSHA256,'pending-manifest-bound');else write(target,manifestBytes);sync(archive);sync(base);
 }
 const archive=path.join(root,binding.archive),live=path.join(root,'transaction');
 if(present(live)){source=inspectStandardOAuthResume(o);need(source.identity.sha256===binding.sourceIdentity,'pre-archive-source-stable');fs.renameSync(live,path.join(archive,'transaction'));sync(root);sync(archive);hook('transaction-archived');}
 const retained=verifyArchive(o,binding);binding.phase='archived';save(path.join(root,BINDING),binding);
 const receipt={schema:'agi-standard-oauth-resume/v1',assuranceMode:'standard',sourceVersion:VERSION,sourceTransactionId:retained.state.id,sourceSHA256:binding.sourceIdentity,archive:binding.archive,originalEvidencePreserved:true,sourceSQLiteOpened:false,legacyProfileImported:false,approvalRequired:true};
 return {root,archive,sourceIdentity:binding.sourceIdentity,fileUID:uid,roles:retained.roles,receipt,standardContinuation:true,limits:{maxRuns24h:retained.c.maxRuns24h,maxImages24h:retained.c.maxImages24h},modelPolicy:retained.config.agents.defaults.modelPolicy,metaMigrations:retained.config.meta?.migrations};
}
export function seedStandardOAuthRoles(continuation,candidate,profileDir){need(continuation.standardContinuation===true,'standard-transfer');return seedFreshOAuthRoles(continuation,candidate,profileDir);}

export function bindStandardOAuthTransaction(continuation,transaction){const file=path.join(continuation.root,BINDING),binding=json(file,continuation.fileUID);need(binding.phase==='archived'&&binding.sourceIdentity===continuation.sourceIdentity&&transaction.state.assuranceMode==='standard'&&transaction.state.state==='prepared'&&transaction.state.approval===null,'new-standard-transaction-bound');binding.currentTransactionId=transaction.state.id;binding.phase='preparing';save(file,binding);}

export function verifyRetainedStandardOAuthSource(o,state){const {root}=paths(o),binding=json(path.join(root,BINDING),o.fileUID);need(binding.phase==='preparing'&&binding.currentTransactionId===state.id,'retained-standard-binding');return verifyArchive(o,binding);}
