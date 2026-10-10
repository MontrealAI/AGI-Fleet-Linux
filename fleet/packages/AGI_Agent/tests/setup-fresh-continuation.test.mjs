import {initializeFreshCandidateState,finishCandidateStatePreparation} from '../compute/setup-state-preparation.mjs';
import {inspectExecutable} from '../compute/runtime-env.mjs';
import {setupCapable} from '../compute/setup.mjs';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {paused,records,edit,freshOAuthFixture} from './fresh-oauth-paused-fixture.mjs';
import {seedFreshOAuthRoles as releasedSeed} from './released-1.18.2-transfer-fixture.mjs';
import {inspectFreshOAuthResume,archiveFreshOAuthAttempt,seedFreshOAuthRoles,recoverFreshOAuthLock} from '../compute/setup-fresh-oauth-resume.mjs';
import {withPrivateTemporary} from '../compute/setup-private-temp.mjs';
import {failed182,aliasFixture} from './fresh-oauth-continuation-fixture.mjs';
for(const role of ['agent','node'])test(role+' exact failed 1.18.2 continuation preserves both attempts and reuses roles through approved readiness',async t=>{
 const f=await failed182(t,role);fs.chmodSync(f.home,0o750);const before=records(path.join(f.support,'transaction')),original=JSON.parse(fs.readFileSync(path.join(f.support,'setup-diagnostics.json'))).freshOAuthResume,oldArchive=records(path.join(f.support,original.archive)),logins=f.loginCount;
 const admission=inspectFreshOAuthResume(f.options);assert.equal(admission.entry,'failed-1.18.2-continuation');
 const result=await f.resume();assert.equal(result.supportReport.passed,true);assert.equal(f.loginCount,logins);assert.equal(fs.statSync(f.home).mode&0o777,0o750);assert.deepEqual(records(path.join(f.support,original.archive)),oldArchive);
 const receipt=result.supportReport.freshOAuthResume;assert.equal(receipt.publication,'atomic-role-set');assert.equal(receipt.retainedAttempts.length,1);assert.deepEqual(records(path.join(f.support,receipt.retainedAttempts[0].archive,'transaction')),before);assert.equal(result.supportReport.serviceReadiness.finalPolicy.state,'passed');assert.equal(receipt.roleStoresPreserved,role==='agent'?3:2);
});
for(const [name,change,predicate] of [
 ['missing original receipt',f=>edit(path.join(f.support,'setup-diagnostics.json'),v=>delete v.freshOAuthResume),'original-archive-receipt'],
 ['wrong receipt identity',f=>edit(path.join(f.support,'setup-diagnostics.json'),v=>v.freshOAuthResume.sourceSHA256='0'.repeat(64)),'archive-receipt-association'],
 ['missing preparation receipt',f=>fs.unlinkSync(path.join(f.support,'transaction/state-preparation-receipt.json')),'required-artifact-present'],
 ['modified preparation receipt',f=>edit(path.join(f.support,'transaction/state-preparation-receipt.json'),v=>v.destinationRowCount++),'preparation-receipts-match'],
 ['unrelated release',f=>edit(path.join(f.support,'clean-install-intent.json'),v=>v.releaseVersion='1.24.0'),null],
 ['unexpected role tree',f=>fs.mkdirSync(path.join(f.candidate,'agents'),{mode:0o700}),'released-failure-before-transfer'],
 ['ambiguous archive',f=>fs.mkdirSync(path.join(f.support,'fresh-oauth-attempts/attempt-11111111-1111-1111-1111-111111111111'),{mode:0o700}),'unambiguous-original-archive'],
 ['changed kit',f=>f.options.kit={...f.kit,token:'f'.repeat(64)},null],
 ['foreign UID',f=>f.options.fileUID=process.getuid()+1,'owned-private-object'],
 ['concurrent installer',f=>fs.writeFileSync(path.join(f.support,'installer.lock'),JSON.stringify({pid:process.pid}),{mode:0o600}),'support-membership']
])test('post-1.18.2 refuses '+name+' without evidence mutation',async t=>{const f=await failed182(t);change(f);const before=records(f.support);assert.throws(()=>inspectFreshOAuthResume(f.options),e=>{assert.equal(e.message,'CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE');if(predicate)assert.equal(e.freshOAuthDiagnostic.predicate,predicate);return true;});assert.deepEqual(records(f.support),before);});
for(const alias of [false,true])test('corrected transfer accepts '+(alias?'aliased':'canonical')+' OS temp base and remains idempotent',async t=>{
 const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});const a=aliasFixture(t),original=os.tmpdir;os.tmpdir=()=>alias?a.alias:a.real;
 try{const result=seedFreshOAuthRoles(continuation,next,f.profileDir);assert.equal(result.temporaryRoot.baseCanonicalized,alias);assert.equal(result.roleStoresPreserved,3);const before=records(next);assert.equal(seedFreshOAuthRoles(continuation,next,f.profileDir).roleStoresPreserved,3);assert.deepEqual(records(next),before);assert.deepEqual(fs.readdirSync(a.real),[]);}finally{os.tmpdir=original;}
});
for(const index of [0,1,2])test('disk-full on role '+index+' leaves no partial agents directory and a repeat recovers',async t=>{
 const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});const before=records(continuation.archive);
 assert.throws(()=>seedFreshOAuthRoles(continuation,next,f.profileDir,{hook:(event,i)=>{if(event==='before-role-write'&&i===index)throw Object.assign(Error('disk full'),{code:'ENOSPC'});}}),/disk full/);
 assert.equal(fs.existsSync(path.join(next,'agents')),false);assert.deepEqual(records(continuation.archive),before);assert.equal(seedFreshOAuthRoles(continuation,next,f.profileDir).roleStoresPreserved,3);
});
for(const event of ['after-role-write','after-publication'])test('real child process death at '+event+' leaves an atomic/recoverable transfer',async t=>{
 const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});const before=records(continuation.archive);
 const code=`import {seedFreshOAuthRoles} from ${JSON.stringify(new URL('../compute/setup-fresh-oauth-resume.mjs',import.meta.url).href)};seedFreshOAuthRoles(${JSON.stringify(continuation)},${JSON.stringify(next)},${JSON.stringify(f.profileDir)},{hook:(event)=>{if(event===${JSON.stringify(event)})process.kill(process.pid,'SIGKILL');}});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.signal,'SIGKILL');assert.equal(fs.existsSync(path.join(next,'agents')),event==='after-publication');assert.equal(seedFreshOAuthRoles(continuation,next,f.profileDir).roleStoresPreserved,3);assert.deepEqual(records(continuation.archive),before);
});
for(const point of ['before-allocation','after-allocation'])test('temporary '+point+' exception preserves the primary error and cleans allocations',t=>{const a=aliasFixture(t),original=os.tmpdir;os.tmpdir=()=>a.alias;try{assert.throws(()=>withPrivateTemporary('agi-fresh-oauth-copy-',()=>assert.fail(),{hook:e=>{if(e===point)throw Error('PRIMARY_FIXTURE');}}),/PRIMARY_FIXTURE/);assert.deepEqual(fs.readdirSync(a.real),[]);}finally{os.tmpdir=original;}});
test('cleanup error is separate from primary and the registered scratch can be recovered',async t=>{
 const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});const a=aliasFixture(t),original=os.tmpdir;os.tmpdir=()=>a.alias;
 try{assert.throws(()=>seedFreshOAuthRoles(continuation,next,f.profileDir,{hook:e=>{if(e==='copied-role')throw Error('PRIMARY_FIXTURE');if(e==='before-cleanup')throw Error('CLEANUP_FIXTURE');}}),e=>{assert.equal(e.message,'PRIMARY_FIXTURE');assert.equal(e.cleanupFailureCode,'SETUP_PRIVATE_TEMP_CLEANUP_REQUIRED');return true;});assert.equal(fs.readdirSync(a.real).length,1);assert.equal(seedFreshOAuthRoles(continuation,next,f.profileDir).roleStoresPreserved,3);assert.deepEqual(fs.readdirSync(a.real),[]);}finally{os.tmpdir=original;}
});
for(const [name,change] of [
 ['source mutation',(f,continuation)=>fs.appendFileSync(path.join(continuation.archive,'transaction/candidate/SETUP_PENDING'),'changed')],
 ['source hardlink',(f,continuation)=>fs.linkSync(path.join(continuation.archive,'transaction/candidate/agents/agi-checker/agent/openclaw-agent.sqlite'),path.join(f.home,'link'))],
 ['source symlink',(f,continuation)=>{const p=path.join(continuation.archive,'transaction/candidate/agents/agi-checker/agent/openclaw-agent.sqlite');fs.renameSync(p,p+'.saved');fs.symlinkSync(p+'.saved',p);}],
])test('atomic transfer rejects '+name,async t=>{const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});change(f,continuation);assert.throws(()=>seedFreshOAuthRoles(continuation,next,f.profileDir),/CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE/);assert.deepEqual(fs.readdirSync(next),[]);});
test('source mutation during disposable SQLite work is detected before role publication',async t=>{const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});let changed=false;assert.throws(()=>seedFreshOAuthRoles(continuation,next,f.profileDir,{hook:e=>{if(e==='copied-role'&&!changed){changed=true;fs.appendFileSync(path.join(continuation.archive,'transaction/candidate/SETUP_PENDING'),'changed');}}}),e=>e.freshOAuthDiagnostic.predicate==='source-archive-unchanged');assert.deepEqual(fs.readdirSync(next),[]);});
test('a failed bound transfer can be re-prepared without losing original or failed evidence',async t=>{const role=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).name.endsWith('-node')?'node':'agent',f=await paused(t,role),seed=f.dependencies.seedFreshOAuthRoles;f.dependencies.seedFreshOAuthRoles=(...args)=>seedFreshOAuthRoles(...args,{hook:e=>{if(e==='before-role-write')throw Object.assign(Error('disk full'),{code:'ENOSPC'});}});await assert.rejects(f.resume());delete f.dependencies.seedFreshOAuthRoles;const before=records(path.join(f.support,'transaction'));const result=await f.resume();assert.equal(result.supportReport.passed,true);const retained=result.supportReport.freshOAuthResume.retainedAttempts;assert.equal(retained.length,2);assert.deepEqual(records(path.join(f.support,retained[1].archive,'transaction')),before);});

for(const role of ['agent','node'])test(role+' genuinely virgin first sign-in admits only the exact supported normalization and visibility delta',async t=>{
 const f=freshOAuthFixture(t,role);delete f.dependencies.assertAuthorizedOAuthChanges;
 assert.equal(fs.existsSync(path.join(f.home,'.agi-genesis-setup-'+role)),false);
 const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies});
 assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.freshOAuthResume,null);assert.equal(f.loginCount,role==='agent'?3:2);assert.equal(result.supportReport.oauthConfigAdmission.openAIModelVisibility,'openai/*');assert.equal(result.supportReport.legacyMigrationRequired,false);
});
test('SQLite constructors only open disposable copies during transfer, never archive sources',async t=>{
 const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next');fs.mkdirSync(next,{mode:0o700});
 const proxy=`import {DatabaseSync as Original} from 'node:sqlite';export * from 'node:sqlite';export class DatabaseSync extends Original{constructor(file,...args){if(String(file).startsWith(${JSON.stringify(continuation.archive)}))throw Error('SOURCE_SQLITE_OPEN_FORBIDDEN');globalThis.sqliteOpens.push(String(file));super(file,...args);}}`;
 const url='data:text/javascript,'+encodeURIComponent(proxy),module=new URL('../compute/setup-fresh-oauth-resume.mjs',import.meta.url).href;
 const code=`import {registerHooks} from 'node:module';globalThis.sqliteOpens=[];const proxy=${JSON.stringify(url)};registerHooks({resolve(s,c,n){return s==='node:sqlite'&&c.parentURL!==proxy?{url:proxy,shortCircuit:true}:n(s,c);}});const {seedFreshOAuthRoles}=await import(${JSON.stringify(module)});seedFreshOAuthRoles(${JSON.stringify(continuation)},${JSON.stringify(next)},${JSON.stringify(f.profileDir)});console.log(JSON.stringify({count:sqliteOpens.length,allDisposable:sqliteOpens.every(p=>p.includes('agi-fresh-oauth-copy-'))}));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const observed=JSON.parse(result.stdout);assert.ok(observed.count>=3);assert.equal(observed.allDisposable,true);
});
test('a canonical protected destination cannot be replaced by a symlink during publication',async t=>{const f=await paused(t),continuation=await archiveFreshOAuthAttempt(f.options),next=path.join(f.support,'next'),outside=path.join(f.home,'outside');fs.mkdirSync(next,{mode:0o700});fs.mkdirSync(outside,{mode:0o700});assert.throws(()=>seedFreshOAuthRoles(continuation,next,f.profileDir,{hook:e=>{if(e==='before-publication'){fs.renameSync(next,next+'.held');fs.symlinkSync(outside,next);}}}),/CLEAN_INSTALL_OAUTH_RESUME_UNAVAILABLE/);assert.deepEqual(fs.readdirSync(outside),[]);});
test('bound continuation refuses a live installer, but safely recovers its dead pre-service lock',async t=>{const f=await paused(t);await archiveFreshOAuthAttempt(f.options);const lock=path.join(f.support,'installer.lock');fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{mode:0o600});assert.throws(()=>recoverFreshOAuthLock(f.options),e=>e.freshOAuthDiagnostic.predicate==='concurrent-installer');fs.unlinkSync(lock);const child=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(child.status,0);fs.writeFileSync(lock,JSON.stringify({pid:child.pid}),{mode:0o600});recoverFreshOAuthLock(f.options);assert.equal(fs.existsSync(lock),false);assert.equal((await archiveFreshOAuthAttempt(f.options)).receipt.retainedAttempts.length,1);});
test('an interrupted archive rename is resumed once from its durable binding',async t=>{
 const f=await paused(t),rename=fs.renameSync;let interrupted=false;
 fs.renameSync=(from,to)=>{const result=rename(from,to);if(from===path.join(f.support,'transaction')&&!interrupted){interrupted=true;throw Error('AFTER_RENAME_INTERRUPTION');}return result;};
 try{await assert.rejects(archiveFreshOAuthAttempt(f.options),/AFTER_RENAME_INTERRUPTION/);}finally{fs.renameSync=rename;}
 assert.equal(inspectFreshOAuthResume(f.options).entry,'bound-continuation');const resumed=await archiveFreshOAuthAttempt(f.options),again=await archiveFreshOAuthAttempt(f.options);assert.equal(again.archive,resumed.archive);assert.equal(fs.readdirSync(path.join(f.support,'fresh-oauth-attempts')).length,1);
});
for(const member of ['report','manifest'])test('partial '+member+' archive write recovers without changing the paused source',async t=>{
 const f=await paused(t),write=fs.writeFileSync,open=fs.openSync,before=records(path.join(f.support,'transaction'));let interrupted=false,targetFd=null;
 fs.openSync=(file,...args)=>{const fd=open(file,...args);if(String(file).endsWith(member==='manifest'?'manifest.json.uncommitted':'clean-install-intent.json.uncommitted'))targetFd=fd;return fd;};
 fs.writeFileSync=(fd,data,...args)=>{
  const value=String(data);
  if(!interrupted&&fd===targetFd){
   interrupted=true;write(fd,value.slice(0,Math.max(1,Math.floor(value.length/3))),...args);
   throw Object.assign(Error('INTERRUPTED_ARCHIVE_WRITE'),{code:'ENOSPC'});
  }
  return write(fd,data,...args);
 };
 try{await assert.rejects(archiveFreshOAuthAttempt(f.options),/INTERRUPTED_ARCHIVE_WRITE/);}finally{fs.writeFileSync=write;fs.openSync=open;}
 assert.equal(interrupted,true);assert.equal(inspectFreshOAuthResume(f.options).entry,'bound-continuation');
 const resumed=await archiveFreshOAuthAttempt(f.options);assert.deepEqual(records(path.join(resumed.archive,'transaction')),before);
 assert.deepEqual(fs.readdirSync(resumed.archive).filter(name=>name.endsWith('.uncommitted')),[]);
 assert.equal((await archiveFreshOAuthAttempt(f.options)).archive,resumed.archive);
});
test('canonicalization exception after allocation removes the allocation and preserves its primary cause',t=>{const a=aliasFixture(t),tmpdir=os.tmpdir,realpath=fs.realpathSync;let once=false;os.tmpdir=()=>a.alias;fs.realpathSync=p=>{if(String(p).includes('agi-fresh-oauth-copy-')&&!once){once=true;throw Error('REALPATH_FIXTURE');}return realpath(p);};try{assert.throws(()=>withPrivateTemporary('agi-fresh-oauth-copy-',()=>assert.fail()),/REALPATH_FIXTURE/);assert.deepEqual(fs.readdirSync(a.real),[]);}finally{os.tmpdir=tmpdir;fs.realpathSync=realpath;}});

test('actual pinned SDK produces the 334-object failed-continuation shape and resumes with its untouched preparation evidence',{skip:!process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT},async t=>{const f=await failed182(t,'agent',{realState:true}),state=JSON.parse(fs.readFileSync(f.txFile));assert.equal(state.preparationReceipt.destinationObjectCount,334);assert.equal(state.preparationReceipt.ownerProfileCreated,true);assert.equal(state.preparationReceipt.ownerIdentityCreated,true);assert.equal(fs.existsSync(path.join(f.support,'transaction/state-preparation-in-progress.json')),false);assert.equal(inspectFreshOAuthResume(f.options).entry,'failed-1.18.2-continuation');const result=await f.resume();assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.statePreparation.destinationObjectCount,334);});
test('stopped fresh completion panel shows the failure, exact predicate and separate cleanup result',async()=>{const {completionHTML,nextSetupAction}=await import('../compute/setup-completion.mjs');const report={installationTrack:'clean-install',passed:false,stages:{profile:'failed',oauth:'not-attempted',services:'not-attempted'},primaryFailureCode:'SETUP_PRIVATE_TEMP_FAILED',freshOAuthDiagnostic:{substage:'private-temporary-root',predicate:'allocated-child-not-redirected'},cleanupFailureCode:'SETUP_PRIVATE_TEMP_CLEANUP_REQUIRED'};const html=completionHTML(report);assert.match(html,/Setup stopped/);assert.match(html,/allocated-child-not-redirected/);assert.match(html,/SETUP_PRIVATE_TEMP_CLEANUP_REQUIRED/);assert.match(nextSetupAction(report),/without automatically opening browser login/);assert.doesNotMatch(nextSetupAction(report),/resume sign-in/);});
