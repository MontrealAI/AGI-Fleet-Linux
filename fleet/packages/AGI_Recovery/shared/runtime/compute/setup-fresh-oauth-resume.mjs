import {withPrivateTemporary,temporaryIdentity,removePrivateTemporary} from './setup-private-temp.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {classifyLaunchctlPrint} from './service-stop.mjs';import {publicBrowserRuntimeSocketPath} from './public-browser-runtime.mjs';
import {isCandidateStatePreparationReceipt} from './setup-state-preparation.mjs';
import {VERSION} from '../src/version.mjs';import {canonical} from '../src/util.mjs';
import {computeProfile} from './profile.mjs';import {makePublicBrowserPolicy,applyPublicBrowserProfile} from './public-browser-config.mjs';
import {assertAuthorizedOAuthChanges} from './setup-oauth-delta.mjs';import {sqliteSchemaPreflight,sqliteSecurityProjection} from './setup-runtime-sqlite.mjs';import {SQLiteSnapshots} from './setup-sqlite.mjs';
const HISTORICAL_SOURCES=JSON.parse(fs.readFileSync(new URL('./fresh-oauth-historical-sources.json',import.meta.url)));
const CODE='CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE';
function need(ok,predicate='evidence-contract',facts={}){if(!ok){const e=Error(CODE);e.freshOAuthDiagnostic={schema:'agi-fresh-oauth-diagnostic/v1',substage:'continuation-admission',predicate,...facts};throw e;}}
const present=p=>Boolean(fs.lstatSync(p,{throwIfNoEntry:false}));
const BINDING='fresh-oauth-continuation.json';
const compatible=role=>role==='agent'?['1.24.1','1.24.2','1.24.3','1.24.4']:['2.25.1','2.25.2','2.25.3','2.25.4'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const same=(a,b)=>canonical(a)===canonical(b);
const reportFiles=['clean-install-intent.json','genesis-setup-progress.json','machine-preflight.json','setup-diagnostics.json','setup-result.html','desktop-diagnostics.json'];
function owned(file,uid,dir=false,privateMode=true){const s=fs.lstatSync(file);need(!s.isSymbolicLink()&&s.uid===uid&&(dir?s.isDirectory():s.isFile()&&s.nlink===1)&&!(s.mode&(privateMode?0o077:0o022)),'owned-private-object',{objectKind:dir?'directory':'file',ownerMatches:s.uid===uid,mode:s.mode&0o777,linkCount:s.nlink,symlink:s.isSymbolicLink()});return s;}
function bytes(file,uid,privateMode=true){const before=owned(file,uid,false,privateMode);need(before.size<=128*1024*1024);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino);const data=fs.readFileSync(fd),after=fs.lstatSync(file);need(['dev','ino','uid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>after[k]===before[k]));return data;}finally{fs.closeSync(fd);}}
function json(file,uid){need(present(file),'required-artifact-present',{artifact:reportFiles.includes(path.basename(file))||['transaction.json','manifest.json','state-preparation-receipt.json','compute-settings.json','openclaw.json'].includes(path.basename(file))?path.basename(file):'continuation-record'});try{return JSON.parse(bytes(file,uid));}catch(e){if(e.freshOAuthDiagnostic)throw e;need(false,'private-json-valid');}}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,data){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
// Archive members are published only after their bytes are durable. A killed
// installer may leave an uncommitted member, which is safe to regenerate from
// the still-present source report bound by the write-ahead archive manifest.
function archiveMember(file,data,uid){
 const uncommitted=file+'.uncommitted',expected=sha(data);
 if(present(file)){need(!present(uncommitted),'archive-member-ambiguous');need(sha(bytes(file,uid))===expected,'retained-archive-member-stable');return;}
 if(present(uncommitted)){
  const previous=bytes(uncommitted,uid);
  if(previous.length!==data.length||sha(previous)!==expected){fs.unlinkSync(uncommitted);sync(path.dirname(file));}
 }
 if(!present(uncommitted))write(uncommitted,data);
 need(sha(bytes(uncommitted,uid))===expected,'uncommitted-archive-member-stable');
 fs.renameSync(uncommitted,file);sync(path.dirname(file));
 need(sha(bytes(file,uid))===expected,'retained-archive-member-stable');
}
function tree(root,uid){const rows=[];let total=0;function walk(dir,rel=''){owned(dir,uid,true,false);for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),relative=rel?rel+'/'+name:name,s=fs.lstatSync(file);need(rows.length<8192);if(s.isSymbolicLink()){need((relative.startsWith('candidate/plugin-skills/')||relative.startsWith('runtime-profile/plugin-skills/')||relative.startsWith('plugin-skills/'))&&s.uid===uid);rows.push({path:relative,kind:'symlink',sha256:sha(fs.readlinkSync(file)),mode:s.mode&0o777});}else if(s.isDirectory()){owned(file,uid,true,false);rows.push({path:relative,kind:'directory',mode:s.mode&0o777});walk(file,relative);}else{const data=bytes(file,uid,false);total+=data.length;need(total<=512*1024*1024);rows.push({path:relative,kind:'file',bytes:data.length,sha256:sha(data),mode:s.mode&0o777});}}}walk(root);return {rows,sha256:sha(canonical(rows))};}
function inspectAttempt({home,role,uid,signerUID,fileUID=process.getuid?.()??uid,kit,platform=process.platform,runtimePlatform=platform,allowLock=false,recordsRoot,transactionDirectory,profileFailure=false,allowStoppedLive=false}){
 const root=path.join(home,'.agi-genesis-setup-'+role),directory=transactionDirectory??path.join(root,'transaction'),candidate=path.join(directory,'candidate'),records=recordsRoot??root,profileDir=path.join(home,role==='agent'?'.openclaw-agi-compute':'.openclaw-agi-node-compute');
 owned(root,fileUID,true);need(fs.realpathSync(root)===root&&(allowStoppedLive&&recordsRoot||!fs.lstatSync(profileDir,{throwIfNoEntry:false})));

 const intent=json(path.join(records,'clean-install-intent.json'),fileUID),allowedVersion=role==='agent'?'1.24.1':'2.25.1';need(intent.schema==='agi-clean-install-intent/v1'&&intent.protocolVersion===1&&compatible(role).includes(intent.releaseVersion)&&intent.home===home&&intent.role===role&&intent.computeUID===uid&&intent.signerUID===signerUID,'intent-release-and-identity');
 const report=json(path.join(records,'setup-diagnostics.json'),fileUID),progress=json(path.join(records,'genesis-setup-progress.json'),fileUID),state=json(path.join(directory,'transaction.json'),fileUID);
 need(report.versions?.[role]===intent.releaseVersion&&report.versions?.fleet==='1.18.'+(compatible(role).indexOf(intent.releaseVersion)+1),'reported-release-sequence');
 const roles=role==='agent'?['agi-creator','agi-checker','agi-reviewer']:['agi-checker','agi-reviewer'];
 need(report.installationTrack==='clean-install'&&report.primaryFailureCode===(profileFailure?'SETUP_STATE_OWNER_REQUIRED':'OPENCLAW_OAUTH_SECURITY_CHANGED')&&!report.rollbackFailureCode&&report.recovery?.profile==='NOT_REQUIRED'&&report.recovery?.serviceFiles==='NOT_REQUIRED'&&report.serviceReadiness===null&&report.walletAccessed===false&&report.paidProviderCall===false&&report.moneyMoved===false&&report.publicOutput===false);
 need(progress.schema===2&&progress.currentStage===(profileFailure?'profile':'oauth')&&progress.stages?.oauth===(profileFailure?'not-attempted':'failed')&&progress.stages.services==='not-attempted'&&['preflight','docker','images','desktop'].every(k=>progress.stages[k]==='passed')&&progress.stages.profile===(profileFailure?'failed':'passed')&&roles.every(r=>progress.auth?.[r]===true)&&same(Object.keys(progress.auth).sort(),[...roles].sort()),'recognized-pre-service-stage');
 need(same(report.stages,progress.stages)&&report.stages.services==='not-attempted'&&report.transaction?.id===state.id&&report.transaction.state==='prepared');
 need(state.schema===1&&state.installationTrack==='clean-install'&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.runtimeSecurityVersion===1&&state.state==='prepared'&&state.profileDir===profileDir&&state.previousExisted===false&&state.baseIdentity===null&&state.approval===null&&state.approvedIdentity===null&&state.completedIdentity===null&&state.primaryFailureCode===report.primaryFailureCode&&!state.rollbackFailureCode&&!state.cleanInitializationReceipt&&!state.runtimeSecurityRecord&&!state.approvedSecurityRecord&&state.cleanRuntimeGeneration===0&&isCandidateStatePreparationReceipt(state.preparationReceipt)&&/^[a-f0-9-]{36}$/.test(state.id));
 need(!fs.lstatSync(path.join(directory,'previous'),{throwIfNoEntry:false})&&!fs.lstatSync(path.join(directory,'approval-write-intent.json'),{throwIfNoEntry:false}));
 const c=json(path.join(candidate,'compute-settings.json'),fileUID),config=json(path.join(candidate,'openclaw.json'),fileUID);
 need(kit&&kit.signerUID===signerUID&&kit.mode==='workstation'&&c.role===role&&c.workstation===true&&c.schema===1&&c.profileDir===profileDir&&c.token===kit.token&&c.signerUID===signerUID&&c.port===kit.port&&c.gatewayPort===(role==='agent'?18896:18900)&&c.maxRuns24h===48&&c.maxImages24h===8&&c.policySealVersion===2&&!c.policyHash&&c.capabilityPolicy==='offline-public/v1'&&c.isolationAcknowledged===true&&/^[a-f0-9]{64}$/.test(c.gatewayToken)&&/^sha256:[a-f0-9]{64}$/.test(c.imageID)&&/^sha256:[a-f0-9]{64}$/.test(c.browserImageID),'kit-and-candidate-authority-match');
 const policy=makePublicBrowserPolicy({profileDir,uid:fileUID,platform:runtimePlatform,operatorPublicKey:kit.publicWebAuthority});need(same(c.publicWebPolicy,policy));
 const before=applyPublicBrowserProfile(computeProfile({token:c.gatewayToken,port:c.gatewayPort,model:kit.model,workspace:path.join(root,'transaction/candidate/workspace'),imageID:c.imageID,workstation:true,role,jobRoot:path.join(root,'transaction/candidate/jobs'),inputRoot:path.join(root,'transaction/candidate/workspace/job-input'),browserImageID:c.browserImageID}),{...policy,pluginDirectory:path.join(root,'transaction/candidate/agi-runtime/public-browser-plugin')});
 const admission=assertAuthorizedOAuthChanges(before,config,{allowPinnedFirstStart:true,allowOpenAIVisibility:true});
 need(report.images?.work===c.imageID&&report.images?.browser===c.browserImageID,'attempt-image-bindings');
 // Released installers persisted these disposable-desktop/source receipts.
 // They admit this historical credential source, never its images for execution.
 // Matching settings/report/config alone is not image provenance.
 const desktop=json(path.join(records,'desktop-diagnostics.json'),fileUID);
 need(same(desktop,report.desktop)&&desktop.passed===true&&desktop.imageID===c.imageID,'attempt-desktop-image-evidence');
 need(same(desktop.versions,Object.fromEntries(['fleet','agent','node'].map(k=>[k,report.versions?.[k]])))&&/^[a-f0-9]{64}$/.test(report.packageManifestSHA256)&&desktop.packageManifestSHA256===report.packageManifestSHA256,'attempt-release-evidence');
 need(same(report.sourceHashes,HISTORICAL_SOURCES.sourceHashes)&&same(desktop.sourceHashes,report.sourceHashes),'attempt-pinned-image-sources');
 const historicalImages={sourceVersion:intent.releaseVersion,transactionId:state.id,work:c.imageID,browser:c.browserImageID,packageManifestSHA256:report.packageManifestSHA256,sourceHashes:structuredClone(report.sourceHashes),desktopPassed:true,evidenceScope:'persisted-released-installer-not-execution-admission'};
 const backup=state.serviceBackup;need(typeof backup==='string'&&path.dirname(backup)===path.join(home,'.agi-compute-recovery',role)&&/^[a-f0-9-]{36}$/.test(path.basename(backup)));for(const dir of [path.join(home,'.agi-compute-recovery'),path.dirname(backup),backup])owned(dir,fileUID,true);const service=json(path.join(backup,'manifest.json'),fileUID);need(service.schema==='agi-service-backup/v1'&&service.role===role&&Array.isArray(service.files)&&service.files.every(row=>row.exists===false));
 need(!present(path.join(directory,'state-preparation-in-progress.json')),'preparation-finished');
 if(profileFailure){need(intent.releaseVersion===(role==='agent'?'1.24.2':'2.25.2'),'intermediate-release-supported');need(!present(path.join(candidate,'agents'))&&!state.freshOAuthResume,'released-failure-before-transfer');need(same(json(path.join(directory,'state-preparation-receipt.json'),fileUID),state.preparationReceipt)&&same(report.statePreparation,state.preparationReceipt),'preparation-receipts-match');}
 const identity=tree(directory,fileUID);if(!profileFailure)for(const r of roles){for(const part of ['agents','agents/'+r,'agents/'+r+'/agent'])owned(path.join(candidate,part),fileUID,true);owned(path.join(candidate,'agents',r,'agent/openclaw-agent.sqlite'),fileUID);}
 return {root,directory,candidate,profileDir,roles,identity,c,config,admission,historicalImages,transactionId:state.id,sourceVersion:intent.releaseVersion,fileUID,report,state,progress};
}
// A write-ahead binding precedes every archive rename. It contains no credentials.
function atomicRecord(file,value){const temp=file+'.next';if(present(temp))owned(temp,process.getuid());const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);sync(path.dirname(file));}
function archivePath(root,relative){need(typeof relative==='string'&&/^fresh-oauth-attempts\/attempt-[a-f0-9-]{36}$/.test(relative),'archive-reference');return path.join(root,relative);}
function verifyArchive(root,reference,uid){
 const archive=archivePath(root,reference.archive);owned(path.dirname(archive),uid,true);owned(archive,uid,true);
 const manifest=json(path.join(archive,'manifest.json'),uid);
 need(manifest.schema==='agi-fresh-oauth-attempt/v1'&&manifest.sourceTransactionId===reference.sourceTransactionId&&manifest.sourceVersion===reference.sourceVersion&&manifest.transactionIdentity===reference.sourceSHA256,'archive-receipt-association');
 need(Array.isArray(manifest.files)&&new Set(manifest.files.map(r=>r.name)).size===manifest.files.length&&manifest.files.every(r=>reportFiles.includes(r.name)),'archive-report-manifest');
 need(same(fs.readdirSync(archive).sort(),['manifest.json','transaction',...manifest.files.map(r=>r.name)].sort()),'archive-membership');
 for(const row of manifest.files){const data=bytes(path.join(archive,row.name),uid);need(data.length===row.bytes&&sha(data)===row.sha256,'archived-report-hash');}
 const identity=tree(path.join(archive,'transaction'),uid);need(identity.sha256===manifest.transactionIdentity&&same(identity.rows,manifest.transactionFiles),'archived-transaction-hash');return archive;
}
function sourceFromReceipt(options,receipt){
 need(receipt?.schema==='agi-fresh-oauth-continuation/v1'&&receipt.originalEvidencePreserved===true&&receipt.sourceSQLiteOpened===false&&receipt.legacyProfileImported===false,'original-archive-receipt');
 const root=path.join(options.home,'.agi-genesis-setup-'+options.role),archive=verifyArchive(root,receipt,options.fileUID),source=inspectAttempt({...options,recordsRoot:archive,transactionDirectory:path.join(archive,'transaction')});
 need(source.sourceVersion===compatible(options.role)[0]&&source.transactionId===receipt.sourceTransactionId,'original-release-and-transaction');
 need(same(source.admission,receipt.oauthConfigAdmission),'original-config-admission');return {...source,archive,receipt};
}
function cleanupCopiedTemporary(identity){need(path.dirname(identity.root)===fs.realpathSync(os.tmpdir())&&/^agi-fresh-oauth-copy-[A-Za-z0-9]+$/.test(path.basename(identity.root)),'temporary-root-classification');if(present(identity.root))removePrivateTemporary(identity);}
function cleanupTransferScratch(directory,uid){for(const name of fs.readdirSync(directory).filter(n=>/^fresh-oauth-transfer-[a-f0-9]{16}\.json$/.test(n))){const journal=json(path.join(directory,name),uid);need(journal.schema==='agi-fresh-oauth-transfer/v2','transfer-journal-format');if(journal.temporary)cleanupCopiedTemporary(journal.temporary);}}
function bindingKey(options){return sha(canonical({kit:options.kit,home:options.home,role:options.role,uid:options.uid,signerUID:options.signerUID}));}
function readBinding(options){const root=path.join(options.home,'.agi-genesis-setup-'+options.role),file=path.join(root,BINDING),binding=json(file,options.fileUID);need(binding.schema==='agi-fresh-oauth-binding/v2'&&binding.kitIdentity===bindingKey(options)&&Array.isArray(binding.retained)&&binding.retained.length<=8,'continuation-binding');return binding;}
function checkSupport(options){
 const root=path.join(options.home,'.agi-genesis-setup-'+options.role);owned(root,options.fileUID,true);need(fs.realpathSync(root)===root,'support-canonical');
 const names=fs.readdirSync(root);need(names.every(n=>reportFiles.includes(n)||['transaction','fresh-oauth-attempts',BINDING,BINDING+'.next'].includes(n)||n==='installer.lock'&&(options.allowLock||present(path.join(root,BINDING)))),'support-membership');
 if(names.includes('installer.lock')&&!options.allowLock){const lock=json(path.join(root,'installer.lock'),options.fileUID);need(Number.isSafeInteger(lock.pid)&&lock.pid>0,'installer-lock-valid');try{process.kill(lock.pid,0);need(false,'concurrent-installer');}catch(e){if(e.code!=='ESRCH')throw e;}}
 need(!present(path.join(options.home,options.role==='agent'?'.openclaw-agi-compute':'.openclaw-agi-node-compute')),'no-live-profile');return root;
}
function inspectInterruptedCleanInitialization(options,binding,source,state){
 const root=path.join(options.home,'.agi-genesis-setup-'+options.role),directory=path.join(root,'transaction'),candidate=path.join(directory,'candidate');
 const expectedVersion=options.role==='agent'?'1.24.5':'2.25.5',roles=source.roles;
 const intent=json(path.join(root,'clean-install-intent.json'),options.fileUID),report=json(path.join(root,'setup-diagnostics.json'),options.fileUID),progress=json(path.join(root,'genesis-setup-progress.json'),options.fileUID),pending=json(path.join(directory,'clean-initialization-in-progress.json'),options.fileUID);
 need(intent.schema==='agi-clean-install-intent/v1'&&intent.protocolVersion===1&&intent.releaseVersion===expectedVersion&&intent.home===options.home&&intent.role===options.role&&intent.computeUID===options.uid&&intent.signerUID===options.signerUID,'clean-initialization-known-release');
 need(report.schema==='agi-setup-support/v2'&&report.installationTrack==='clean-install'&&report.versions?.[options.role]===expectedVersion&&report.versions?.fleet==='1.18.5'&&report.passed===false&&report.failureCode==='SETUP_CLEAN_INITIALIZATION_CHANGED'&&report.primaryFailureCode==='SETUP_CLEAN_INITIALIZATION_CHANGED'&&!report.rollbackFailureCode&&report.recovery?.profile==='NOT_REQUIRED'&&report.recovery?.serviceFiles==='NOT_REQUIRED'&&report.serviceReadiness===null&&report.securityReviewDigest===null&&report.cleanInitialization===null&&report.walletAccessed===false&&report.paidProviderCall===false&&report.moneyMoved===false&&report.publicOutput===false&&report.failureRecordingFailed===false,'clean-initialization-known-pre-approval-failure');
 need(progress.schema===2&&progress.currentStage==='oauth'&&progress.stages.oauth==='failed'&&progress.stages.services==='not-attempted'&&['preflight','docker','images','desktop','profile'].every(k=>progress.stages[k]==='passed')&&same(report.stages,progress.stages)&&roles.every(r=>progress.auth?.[r]===true)&&same(Object.keys(progress.auth).sort(),[...roles].sort()),'clean-initialization-stage-boundary');
 need(state.schema===1&&state.treeIdentityVersion===3&&state.stagingProtocolVersion===2&&state.preparationProtocolVersion===1&&state.runtimeSecurityVersion===1&&state.state==='prepared'&&state.baseIdentity===null&&state.previousExisted===false&&state.profileDir===source.profileDir&&state.primaryFailureCode==='SETUP_CLEAN_INITIALIZATION_CHANGED'&&!state.rollbackFailureCode&&state.cleanRuntimeGeneration===0&&!state.runtimeSecurityRecord&&!state.approvedSecurityRecord&&report.transaction?.id===state.id&&report.transaction.state===state.state&&isCandidateStatePreparationReceipt(state.preparationReceipt),'clean-initialization-transaction-contract');
 need(pending.schema==='agi-clean-initialization-intent/v1'&&same(Object.keys(pending).sort(),['schema','sourceIdentity','transactionId'])&&pending.transactionId===state.id&&/^[a-f0-9]{64}$/.test(pending.sourceIdentity)&&!present(path.join(directory,'clean-initialization-receipt.json'))&&!present(path.join(directory,'state-preparation-in-progress.json'))&&!present(path.join(directory,'previous'))&&!present(path.join(directory,'security-review.json')),'clean-initialization-intent-bound');
 need(binding.phase==='pre-service-paused'&&/^[a-f0-9]{64}$/.test(binding.failureIdentity??'')&&tree(directory,options.fileUID).sha256===binding.failureIdentity,'clean-initialization-failed-candidate-unchanged');
 const receipt=state.freshOAuthResume;
 need(receipt&&same(receipt,report.freshOAuthResume)&&['archive','sourceVersion','sourceTransactionId','sourceSHA256'].every(k=>receipt[k]===binding.source[k])&&receipt.originalEvidencePreserved===true&&receipt.sourceSQLiteOpened===false&&receipt.legacyProfileImported===false&&receipt.roleStoresPreserved===roles.length&&receipt.committedWALIncluded===true&&receipt.publication==='atomic-role-set'&&receipt.transferVersion===2,'clean-initialization-oauth-source-binding');
 need(same(json(path.join(directory,'state-preparation-receipt.json'),options.fileUID),state.preparationReceipt)&&same(report.statePreparation,state.preparationReceipt),'clean-initialization-preparation-receipt');
 const c=json(path.join(candidate,'compute-settings.json'),options.fileUID),config=json(path.join(candidate,'openclaw.json'),options.fileUID);
 need(c.schema===1&&c.role===options.role&&c.workstation===true&&c.profileDir===source.profileDir&&c.token===options.kit.token&&c.signerUID===options.signerUID&&c.port===options.kit.port&&c.gatewayPort===(options.role==='agent'?18896:18900)&&c.maxRuns24h===48&&c.maxImages24h===8&&c.policySealVersion===2&&!c.policyHash&&c.capabilityPolicy==='offline-public/v1'&&c.isolationAcknowledged===true&&/^[a-f0-9]{64}$/.test(c.gatewayToken),'clean-initialization-authority-preserved');
 need(same(config.agents.defaults.modelPolicy,source.config.agents.defaults.modelPolicy)&&same(config.meta?.migrations,source.config.meta?.migrations),'continuation-config-associated');
 const policy=makePublicBrowserPolicy({profileDir:source.profileDir,uid:options.fileUID,platform:options.runtimePlatform??options.platform,operatorPublicKey:options.kit.publicWebAuthority});need(same(c.publicWebPolicy,policy),'clean-initialization-browser-policy');
 const generated=applyPublicBrowserProfile(computeProfile({token:c.gatewayToken,port:c.gatewayPort,model:options.kit.model,workspace:path.join(candidate,'workspace'),imageID:c.imageID,workstation:true,role:options.role,jobRoot:path.join(candidate,'jobs'),inputRoot:path.join(candidate,'workspace/job-input'),browserImageID:c.browserImageID}),{...policy,pluginDirectory:path.join(candidate,'agi-runtime/public-browser-plugin')});
 assertAuthorizedOAuthChanges(generated,config,{allowPinnedFirstStart:true,allowOpenAIVisibility:true});
 const desktop=json(path.join(root,'desktop-diagnostics.json'),options.fileUID);
 need(same(desktop,report.desktop)&&desktop.passed===true&&desktop.imageID===c.imageID&&report.images?.work===c.imageID&&report.images?.browser===c.browserImageID&&same(desktop.versions,Object.fromEntries(['fleet','agent','node'].map(k=>[k,report.versions[k]])))&&/^[a-f0-9]{64}$/.test(report.packageManifestSHA256)&&desktop.packageManifestSHA256===report.packageManifestSHA256&&same(report.sourceHashes,HISTORICAL_SOURCES.sourceHashes)&&same(desktop.sourceHashes,report.sourceHashes),'clean-initialization-release-image-evidence');
 need(c.executionImageVerification?.schema==='agi-execution-images/v1'&&c.executionImageVerification.releaseVersion===expectedVersion&&same(c.executionImageVerification.images,report.executionImages),'clean-initialization-execution-receipts');
 for(const kind of ['work','browser']){const r=report.executionImages[kind];need(r?.schema==='agi-execution-image/v1'&&r.imageID===report.images[kind]&&/^sha256:[a-f0-9]{64}$/.test(r.imageID)&&/^[a-f0-9]{64}$/.test(r.recipeSHA256)&&r.label==='ai.montreal.agi.recipe'&&['verified-cache','verified-build'].includes(r.admission),'clean-initialization-historical-image-receipt');}
 for(const role of roles)owned(path.join(candidate,'agents',role,'agent/openclaw-agent.sqlite'),options.fileUID);
 const journals=fs.readdirSync(directory).filter(n=>/^fresh-oauth-transfer-[a-f0-9]{16}\.json$/.test(n));need(journals.length===1,'clean-initialization-atomic-role-transfer');
 const transfer=json(path.join(directory,journals[0]),options.fileUID);need(transfer.schema==='agi-fresh-oauth-transfer/v2'&&transfer.phase==='published'&&transfer.candidate===candidate&&transfer.sourceIdentity===binding.source.sourceSHA256&&same(transfer.roles,roles)&&transfer.temporary===null,'clean-initialization-transfer-source-intact');
 // Inspect disposable byte copies; never open the interrupted candidate DB.
 need(!Object.hasOwn(config.plugins??{},'bundledDiscovery')&&config.meta?.lastTouchedVersion==='2026.9.5','clean-initialization-known-fresh-discovery-input');
 withPrivateTemporary('agi-fresh-oauth-copy-',temp=>{
  const relative='state/openclaw.sqlite',original=path.join(candidate,relative),copy=path.join(temp,relative);fs.mkdirSync(path.dirname(copy),{mode:0o700});
  for(const suffix of ['','-wal','-shm','-journal'])if(present(original+suffix))write(copy+suffix,bytes(original+suffix,options.fileUID));
  sqliteSchemaPreflight(copy,{root:temp,profileDir:source.profileDir,relative});sqliteSecurityProjection(copy,{root:temp,profileDir:source.profileDir,relative});
  const db=new DatabaseSync(copy,{readOnly:true});try{
   db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   need(db.prepare('PRAGMA user_version').get().user_version===17&&db.prepare('SELECT count(*) n FROM config_revision_keys').get().n===1&&db.prepare('SELECT id,length(hmac_key) n FROM config_revision_keys').get().id===1&&db.prepare('SELECT length(hmac_key) n FROM config_revision_keys').get().n===32,'clean-initialization-partial-revision-key');
   const devices=db.prepare('SELECT identity_key,length(device_id) n,created_at_ms,updated_at_ms FROM device_identities').all();need(devices.length===1&&devices[0].identity_key==='primary'&&devices[0].n===64&&Number.isSafeInteger(devices[0].created_at_ms)&&devices[0].created_at_ms>0&&devices[0].created_at_ms===devices[0].updated_at_ms,'clean-initialization-partial-device');
   const machine=db.prepare('SELECT state_key FROM config_machine_state WHERE state_key IN (?,?)').all('plugins.bundledDiscovery','plugins.installedIndex');need(same(machine.map(r=>r.state_key),['plugins.installedIndex']),'clean-initialization-known-absent-discovery-output');
   const jobs=db.prepare('SELECT agent_id,declaration_key FROM cron_jobs').all();need(jobs.length===roles.length*2&&new Set(jobs.map(r=>r.declaration_key)).size===jobs.length&&roles.every(role=>jobs.filter(r=>r.agent_id===role).length===2),'clean-initialization-partial-system-jobs');
  }finally{db.close();}
 },{uid:options.fileUID});
 for(const [relative,size,mode] of [['config-journal-fingerprint.key',32,0o600],['tmp/agent-cli/openclaw',null,0o700]]){const stat=owned(path.join(candidate,relative),options.fileUID);need((size===null||stat.size===size)&&(stat.mode&0o777)===mode,'clean-initialization-partial-private-artifacts');}
 const runtimeDirectory=path.join(candidate,'tmp/openclaw-'+options.fileUID),expectedLocks=[...new Set([candidate,source.profileDir].flatMap(base=>['device-identity.'+sha(path.join(base,'state/openclaw.sqlite')).slice(0,8)+'.lock.sqlite','gateway.'+sha(path.join(base,'openclaw.json')).slice(0,8)+'.lock.sqlite'])),'gateway.state.lock.sqlite'];
 owned(runtimeDirectory,options.fileUID,true);for(const name of expectedLocks){const stat=owned(path.join(runtimeDirectory,name),options.fileUID);need(stat.size===0&&(stat.mode&0o777)===0o600,'clean-initialization-partial-coordinator');}
 need(tree(directory,options.fileUID).sha256===binding.failureIdentity,'clean-initialization-observation-source-stable');
 return {sourceVersion:expectedVersion,interruptedCleanInitialization:true};
}
export function inspectFreshOAuthResume(options){
 need(['agent','node'].includes(options.role),'documented-role-source-required');
 options={fileUID:process.getuid?.()??options.uid,...options};const root=checkSupport(options);
 if(present(path.join(root,BINDING))){
  const binding=readBinding(options);
  if(binding.pending){const pending=binding.pending;archivePath(root,pending.archive);need(pending.manifest?.transactionIdentity===pending.sourceSHA256,'pending-archive-binding');if(pending.cleanInitializationInterrupted!==undefined)need(pending.cleanInitializationInterrupted===true&&pending.sourceVersion===(options.role==='agent'?'1.24.5':'2.25.5')&&pending.manifest.transactionFiles.some(r=>r.path==='clean-initialization-in-progress.json'),'pending-clean-initialization-binding');const current=path.join(root,'transaction'),archived=path.join(root,pending.archive,'transaction');need(present(current)!==present(archived),'archive-rename-unambiguous');need(tree(present(current)?current:archived,options.fileUID).sha256===pending.sourceSHA256,'pending-archive-identity');}
  const references=[...(binding.source?[binding.source]:[]),...binding.retained];
  need(new Set(binding.retained.map(r=>r.archive)).size===binding.retained.length,'retained-attempts-unambiguous');
  for(const reference of references)verifyArchive(root,reference,options.fileUID);
  const source=binding.source?sourceFromReceipt(options,binding.source):null;
  let currentAttempt=null;
  if(!source)need(binding.pending&&binding.pending.sourceVersion===compatible(options.role)[0],'pending-original-source');
  if(!binding.pending&&present(path.join(root,'transaction'))){
   const state=json(path.join(root,'transaction/transaction.json'),options.fileUID);
   need(binding.currentTransactionId===state.id&&state.installationTrack==='clean-install'&&['preparing','prepared'].includes(state.state)&&state.previousExisted===false&&!state.approval&&!state.approvedIdentity&&!state.completedIdentity&&!state.cleanInitializationReceipt,'bound-pre-service-transaction');
   need(!present(path.join(root,'security-review.json'))&&!present(path.join(root,'transaction/approval-write-intent.json')),'no-approval-started');
   if(binding.failureIdentity)need(tree(path.join(root,'transaction'),options.fileUID).sha256===binding.failureIdentity,'bound-failed-transaction-unchanged');
   const currentIntent=json(path.join(root,'clean-install-intent.json'),options.fileUID),currentReport=json(path.join(root,'setup-diagnostics.json'),options.fileUID);
   need(currentIntent.releaseVersion===currentReport.versions?.[options.role],'bound-attempt-release-associated');
   currentAttempt={sourceVersion:currentIntent.releaseVersion};
   if(present(path.join(root,'transaction/clean-initialization-in-progress.json')))currentAttempt=inspectInterruptedCleanInitialization(options,binding,source,state);
  }
  return {root,binding,source,currentAttempt,entry:currentAttempt?.interruptedCleanInitialization?'interrupted-1.18.5-clean-initialization':'bound-continuation'};
 }
 const report=json(path.join(root,'setup-diagnostics.json'),options.fileUID);
 if(report.primaryFailureCode==='SETUP_STATE_OWNER_REQUIRED'){
  const current=inspectAttempt({...options,profileFailure:true}),source=sourceFromReceipt(options,report.freshOAuthResume);
  need(current.transactionId!==source.transactionId,'distinct-attempts');
  // Association binds policy and authorized normalization, not build output across attempts.
  // inspectAttempt already binds each image to its own generated config, release
  // sources, completed image/desktop gates and persisted reports.
  need(same(current.config.agents.defaults.modelPolicy,source.config.agents.defaults.modelPolicy)&&same(current.config.meta?.migrations,source.config.meta?.migrations),'continuation-config-associated');
  const names=fs.readdirSync(path.join(root,'fresh-oauth-attempts'));need(same(names,[path.basename(source.archive)]),'unambiguous-original-archive');
  return {...current,source,entry:'failed-1.18.2-continuation'};
 }
 const current=inspectAttempt(options);need(current.sourceVersion===compatible(options.role)[0],'original-release-supported');
 need(!present(path.join(root,'fresh-oauth-attempts'))||fs.readdirSync(path.join(root,'fresh-oauth-attempts')).length===0,'no-unreferenced-archive');return {...current,source:null,entry:'original-oauth-pause'};
}
async function absentServices(options){
 need(typeof options.listen==='function'&&typeof options.spawn==='function'&&options.platform==='darwin','mac-quiescence-adapter');
 const suffix=options.role==='agent'?'agi-compute':'agi-node-compute';
 for(const label of ['ai.montreal.'+suffix,'ai.openclaw.'+suffix]){const result=options.spawn('/bin/launchctl',['print',`gui/${options.uid}/${label}`],{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:262144,shell:false,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});need(classifyLaunchctlPrint(result,label,options.uid,1).classification==='absent','managed-service-absent');}
 for(const port of options.role==='agent'?[18894,18896]:[18898,18900])need(await options.listen(port)===false,'managed-port-closed');
 const live=path.join(options.home,'.openclaw-'+suffix);for(const file of [publicBrowserRuntimeSocketPath(live,{uid:options.fileUID,platform:options.runtimePlatform??options.platform}),path.join(live,'web.sock')])need(!present(file),'runtime-socket-absent');
}
function planArchive(root,directory,uid,sourceVersion){
 const state=json(path.join(directory,'transaction.json'),uid),identity=tree(directory,uid),files=[];
 for(const name of reportFiles)if(present(path.join(root,name))){const data=bytes(path.join(root,name),uid);files.push({name,sha256:sha(data),bytes:data.length});}
 const archive='fresh-oauth-attempts/attempt-'+crypto.randomUUID();
 return {archive,sourceVersion,sourceTransactionId:state.id,sourceSHA256:identity.sha256,manifest:{schema:'agi-fresh-oauth-attempt/v1',sourceTransactionId:state.id,sourceVersion,transactionIdentity:identity.sha256,transactionFiles:identity.rows,files}};
}
function finishArchive(root,binding,uid){
 const pending=binding.pending,dest=archivePath(root,pending.archive),base=path.dirname(dest),directory=path.join(root,'transaction');
 if(!present(base))fs.mkdirSync(base,{mode:0o700});owned(base,uid,true);
 if(!present(dest))fs.mkdirSync(dest,{mode:0o700});owned(dest,uid,true);
 for(const row of pending.manifest.files){const data=bytes(path.join(root,row.name),uid);need(data.length===row.bytes&&sha(data)===row.sha256,'pre-archive-report-stable');archiveMember(path.join(dest,row.name),data,uid);}
 const manifestFile=path.join(dest,'manifest.json');archiveMember(manifestFile,JSON.stringify(pending.manifest),uid);need(same(json(manifestFile,uid),pending.manifest),'retained-manifest-stable');sync(dest);
 if(present(directory)){need(!present(path.join(dest,'transaction'))&&tree(directory,uid).sha256===pending.sourceSHA256,'pre-archive-transaction-stable');fs.renameSync(directory,path.join(dest,'transaction'));sync(root);sync(dest);}
 verifyArchive(root,pending,uid);sync(base);
 if(!binding.source){const report=json(path.join(dest,'setup-diagnostics.json'),uid);binding.source={schema:'agi-fresh-oauth-continuation/v1',archive:pending.archive,sourceVersion:pending.sourceVersion,sourceTransactionId:pending.sourceTransactionId,sourceSHA256:pending.sourceSHA256,originalEvidencePreserved:true,oauthConfigAdmission:binding.sourceAdmission,sourceSQLiteOpened:false,legacyProfileImported:false};}
 binding.retained.push({archive:pending.archive,sourceSHA256:pending.sourceSHA256,sourceTransactionId:pending.sourceTransactionId,sourceVersion:pending.sourceVersion});binding.pending=null;binding.currentTransactionId=null;binding.failureIdentity=null;binding.phase='ready-to-prepare';atomicRecord(path.join(root,BINDING),binding);
}
/** Preserve both released attempts; never choose an archive by age or directory order. */
export async function archiveFreshOAuthAttempt(options){
 options={fileUID:process.getuid?.()??options.uid,...options};await absentServices(options);
 const found=inspectFreshOAuthResume({...options,allowLock:true}),{root}=found;let binding=found.binding;
 if(!binding){binding={schema:'agi-fresh-oauth-binding/v2',kitIdentity:bindingKey(options),source:found.source?.receipt??null,sourceAdmission:found.admission,entry:found.entry,retained:[],pending:planArchive(root,found.directory,options.fileUID,found.sourceVersion),phase:'archiving',currentTransactionId:null};atomicRecord(path.join(root,BINDING),binding);}
 else if(!binding.pending&&present(path.join(root,'transaction'))){need(binding.retained.length<8,'continuation-attempt-limit');cleanupTransferScratch(path.join(root,'transaction'),options.fileUID);binding.pending=planArchive(root,path.join(root,'transaction'),options.fileUID,found.currentAttempt.sourceVersion);if(found.currentAttempt.interruptedCleanInitialization)binding.pending.cleanInitializationInterrupted=true;binding.phase='archiving';atomicRecord(path.join(root,BINDING),binding);}
 const interruptedCleanInitializationPreserved=found.currentAttempt?.interruptedCleanInitialization===true||binding.pending?.cleanInitializationInterrupted===true;
 if(binding.pending)finishArchive(root,binding,options.fileUID);
 const source=sourceFromReceipt(options,binding.source);
 const attemptImages=[{...source.historicalImages,archive:binding.source.archive,archiveSHA256:source.identity.sha256}];
 for(const ref of binding.retained){if(ref.sourceTransactionId===source.transactionId)continue;const archive=verifyArchive(root,ref,options.fileUID),report=json(path.join(archive,'setup-diagnostics.json'),options.fileUID);attemptImages.push({sourceVersion:ref.sourceVersion,transactionId:ref.sourceTransactionId,archive:ref.archive,archiveSHA256:ref.sourceSHA256,work:report.images?.work??null,browser:report.images?.browser??null,packageManifestSHA256:report.packageManifestSHA256??null,evidenceScope:'manifest-bound-retained-attempt-not-execution-admission'});}
 return {limits:{maxRuns24h:source.c.maxRuns24h,maxImages24h:source.c.maxImages24h},archive:source.archive,roles:source.roles,fileUID:options.fileUID,sourceIdentity:source.identity.sha256,sourceVersion:source.sourceVersion,sourceTransactionId:source.transactionId,modelPolicy:structuredClone(source.config.agents.defaults.modelPolicy??null),metaMigrations:structuredClone(source.config.meta?.migrations??null),imageID:source.c.imageID,browserImageID:source.c.browserImageID,admission:source.admission,root,receipt:{...binding.source,historicalImages:attemptImages,continuationEntry:binding.entry,...(interruptedCleanInitializationPreserved?{interruptedCleanInitializationPreserved:true}:{}),retainedAttempts:binding.retained.map(r=>({...r})),bindingVersion:2}};
}
export function bindFreshOAuthTransaction(continuation,transaction){const file=path.join(continuation.root,BINDING),binding=json(file,continuation.fileUID);need(binding.currentTransactionId===null,'continuation-ready');binding.currentTransactionId=transaction.state.id;binding.phase='preparing';atomicRecord(file,binding);}
export function recordFreshOAuthFailure(continuation,transaction){if(!continuation?.root||!transaction||!['preparing','prepared'].includes(transaction.state.state))return;const file=path.join(continuation.root,BINDING),binding=json(file,continuation.fileUID);need(binding.currentTransactionId===transaction.state.id,'failure-transaction-bound');binding.failureIdentity=tree(transaction.directory,continuation.fileUID).sha256;binding.phase='pre-service-paused';atomicRecord(file,binding);}
/** Automatic lock recovery is confined to an admitted, bound pre-service continuation. */
export function recoverFreshOAuthLock(options){const root=path.join(options.home,'.agi-genesis-setup-'+options.role),file=path.join(root,'installer.lock');if(!present(file))return;inspectFreshOAuthResume(options);const lock=json(file,options.fileUID);try{process.kill(lock.pid,0);need(false,'concurrent-installer');}catch(e){if(e.code!=='ESRCH')throw e;}fs.unlinkSync(file);sync(root);}
/** Validate copies first, then atomically activate the entire agents directory. */
export function seedFreshOAuthRoles(continuation,candidate,profileDir,{hook=()=>{}}={}){
 const uid=continuation.fileUID;owned(candidate,uid,true);need(path.isAbsolute(candidate)&&fs.realpathSync(candidate)===candidate,'destination-canonical');
 const candidateStat=fs.lstatSync(candidate),parent=path.dirname(candidate);owned(parent,uid,true);need(fs.realpathSync(parent)===parent,'destination-parent-canonical');
 const destination=path.join(candidate,'agents'),source=continuation.readinessRecovery?continuation.sourceDirectory:path.join(continuation.archive,'transaction');
 if(continuation.readinessRecovery)need(continuation.readinessRecovery.schema==='agi-fresh-readiness-recovery/v1'&&source===path.join(continuation.root,continuation.readinessRecovery.archive),'readiness-source-bound');
 const sourceProfile=continuation.readinessRecovery?'runtime-profile':'candidate';
 const stableSource=()=>need(tree(source,uid).sha256===continuation.sourceIdentity,'source-archive-unchanged');stableSource();
 const journalFile=path.join(parent,'fresh-oauth-transfer-'+sha(candidate).slice(0,16)+'.json');let journal=present(journalFile)?json(journalFile,uid):null;
 const bound=()=>{const now=owned(candidate,uid,true);need(now.dev===candidateStat.dev&&now.ino===candidateStat.ino&&fs.realpathSync(candidate)===candidate,'destination-identity-unchanged');};
 const finish=()=>({...continuation.receipt,roleStoresPreserved:continuation.roles.length,committedWALIncluded:true,publication:'atomic-role-set',transferVersion:2});
 if(journal){
  need(journal.schema==='agi-fresh-oauth-transfer/v2'&&journal.candidate===candidate&&journal.sourceIdentity===continuation.sourceIdentity&&same(journal.roles,continuation.roles),'transfer-journal-binding');
  if(journal.temporary){cleanupCopiedTemporary(journal.temporary);journal.temporary=null;atomicRecord(journalFile,journal);}
  if(present(destination)){need(['prepared','published'].includes(journal.phase)&&tree(destination,uid).sha256===journal.destinationIdentity,'complete-role-set-matches-journal');bound();stableSource();journal.phase='published';atomicRecord(journalFile,journal);return finish();}
  need(journal.phase!=='published','published-role-set-present');
  if(journal.staging){const staging=path.join(parent,journal.staging.name);need(/^fresh-oauth-roles-[a-f0-9-]{36}$/.test(journal.staging.name),'staging-reference');if(present(staging)){if(journal.staging.identity)removePrivateTemporary({root:staging,...journal.staging.identity});else{owned(staging,uid,true);need(fs.readdirSync(staging).length===0,'unregistered-stage-empty');fs.rmdirSync(staging);}}}
 }
 need(!present(destination),'destination-role-set-absent');
 journal={schema:'agi-fresh-oauth-transfer/v2',candidate,sourceIdentity:continuation.sourceIdentity,roles:continuation.roles,phase:'validating',temporary:null,staging:null,destinationIdentity:null};atomicRecord(journalFile,journal);
 try{
  return withPrivateTemporary('agi-fresh-oauth-copy-',(temp,tempFacts)=>{
   const prepared=[];
   for(const role of continuation.roles){
    const relative='agents/'+role+'/agent/openclaw-agent.sqlite',original=path.join(source,sourceProfile,relative),copy=path.join(temp,relative);
    for(const part of ['agents','agents/'+role,'agents/'+role+'/agent'])owned(path.join(source,sourceProfile,part),uid,true);
    fs.mkdirSync(path.dirname(copy),{recursive:true,mode:0o700});
    for(const suffix of ['','-wal','-shm','-journal'])if(present(original+suffix))write(copy+suffix,bytes(original+suffix,uid));
    hook('copied-role',role);sqliteSchemaPreflight(copy,{root:temp,profileDir,relative});sqliteSecurityProjection(copy,{root:temp,profileDir,relative});
    const db=new DatabaseSync(copy,{readOnly:true});try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');const rows=db.prepare('SELECT store_json FROM auth_profile_store').all();need(rows.length===1,'one-role-store',{role});const data=JSON.parse(rows[0].store_json),credential=data.profiles?.['openai:agi-compute-pro'];need(credential?.provider==='openai'&&credential.type==='oauth'&&typeof credential.access==='string'&&credential.access.length>0&&typeof credential.refresh==='string'&&credential.refresh.length>0,'local-role-oauth-required',{role});}finally{db.close();}
    const snapshots=new SQLiteSnapshots();try{const data=snapshots.initial(copy);snapshots.assertStable();prepared.push({role,data});}finally{snapshots.close();}
   }
   stableSource();bound();need(!present(destination),'destination-role-set-absent');
   const stagingName='fresh-oauth-roles-'+crypto.randomUUID(),staging=path.join(parent,stagingName);
   // Persist the name before allocation; an interrupted empty allocation has no secrets.
   journal.staging={name:stagingName,identity:null};atomicRecord(journalFile,journal);
   fs.mkdirSync(staging,{mode:0o700});const identity=temporaryIdentity(staging,uid);journal.staging.identity={dev:identity.dev,ino:identity.ino,uid};atomicRecord(journalFile,journal);
   for(const [index,{role,data}] of prepared.entries()){
    hook('before-role-write',index);const directory=path.join(staging,role,'agent');fs.mkdirSync(directory,{recursive:true,mode:0o700});write(path.join(directory,'openclaw-agent.sqlite'),data);sync(directory);sync(path.dirname(directory));hook('after-role-write',index);
   }
   sync(staging);journal.destinationIdentity=tree(staging,uid).sha256;journal.phase='prepared';atomicRecord(journalFile,journal);
   hook('before-publication');stableSource();bound();const stagedNow=temporaryIdentity(staging,uid);need(stagedNow.dev===identity.dev&&stagedNow.ino===identity.ino&&tree(staging,uid).sha256===journal.destinationIdentity,'staged-role-set-unchanged');need(!present(destination),'destination-role-set-absent');
   fs.renameSync(staging,destination);sync(candidate);sync(parent);hook('after-publication');journal.phase='published';journal.staging=null;atomicRecord(journalFile,journal);
   return {...finish(),temporaryRoot:tempFacts};
  },{uid,hook,allocated:identity=>{journal.temporary=identity;atomicRecord(journalFile,journal);},removed:()=>{journal.temporary=null;atomicRecord(journalFile,journal);}});
 }catch(error){
  if(!error.freshOAuthDiagnostic)error.freshOAuthDiagnostic={schema:'agi-fresh-oauth-diagnostic/v1',substage:'role-store-transfer',predicate:['ENOSPC','EIO','EACCES'].includes(error.code)?error.code:'role-copy-validation-or-publication',objectKind:'role-store-set',phase:journal.phase};
  throw error;
 }
}
export function carryFreshModelVisibility(config,continuation){const next=structuredClone(config);if(continuation.modelPolicy)next.agents.defaults.modelPolicy=structuredClone(continuation.modelPolicy);if(continuation.metaMigrations)next.meta={migrations:structuredClone(continuation.metaMigrations),lastTouchedVersion:'2026.9.5'};return next;}

/** Read retained associations without granting post-approval recovery. The caller
 * independently proves quiescence and compares the sealed components first. */
export function inspectRetainedFreshOAuthAssociation(options){
 const binding=readBinding(options);need(binding.source&&!binding.pending,'retained-original-source');
 for(const ref of [binding.source,...binding.retained])verifyArchive(path.join(options.home,'.agi-genesis-setup-'+options.role),ref,options.fileUID);
 const source=sourceFromReceipt({...options,allowStoppedLive:true},binding.source);return {binding,source};
}
export function freshOAuthEvidenceTree(root,uid){return tree(root,uid);}
