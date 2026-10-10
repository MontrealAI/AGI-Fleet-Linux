import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {beginSetupTransaction,treeIdentity,snapshotProfile,restoreSetupTransaction,transactionStatus} from '../compute/setup-transaction.mjs';

const stop=async()=>{};
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-generated-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,profileDir:path.join(root,'profile'),directory:path.join(root,'transaction')};};
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode:0o600});};
const get=(root,name)=>fs.readFileSync(path.join(root,name),'utf8');
const review=()=>securityReview({tools:{deny:['browser']}},{tools:{deny:['browser','web_fetch']}},{maxRuns24h:48,maxImages24h:8},{maxRuns24h:48,maxImages24h:8});
function runtime(root,target){const dir=path.join(root,'plugin-skills');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'browser-automation');fs.rmSync(file,{force:true});fs.symlinkSync(target,file);return file;}
function seed(f){put(f.profileDir,'openclaw.json','original-config');put(f.profileDir,'agents/agi-creator/agent/auth-profiles.json','private-oauth');put(f.profileDir,'compute-journal.json','accepted-work-and-allowances');put(f.profileDir,'compute-settings.json','{"maxRuns24h":48,"maxImages24h":8}');put(f.root,'bundled-browser/SKILL.md','upstream-bundled-skill');}
// The pre-v2 byte identity includes every directory name, including an empty
// generated directory. This fixture deliberately does not call the new helper.
function legacyIdentity(root){const h=crypto.createHash('sha256');const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);assert.equal(s.isSymbolicLink(),false);h.update(path.relative(root,file));h.update('\0');if(s.isDirectory())visit(file);else h.update(fs.readFileSync(file));h.update('\0');}};visit(root);return h.digest('hex');}
function legacyRecord(f,state='prepared'){
  fs.mkdirSync(f.directory,{mode:0o700});const candidate=path.join(f.directory,'candidate');fs.cpSync(f.profileDir,candidate,{recursive:true});
  const value={schema:1,id:crypto.randomUUID(),state,profileDir:f.profileDir,previousExisted:true,baseIdentity:legacyIdentity(f.profileDir),approval:state==='approved'?review().digest:null,approvedIdentity:state==='approved'?legacyIdentity(candidate):null};
  put(f.directory,'transaction.json',JSON.stringify(value));return value;
}

test('generated links are omitted without reading targets or modifying the installed profile',async t=>{
  const f=fixture(t);seed(f);const link=runtime(f.profileDir,path.join(f.root,'bundled-browser')),beforeLink=fs.lstatSync(link),beforeTarget=fs.readlinkSync(link),before=treeIdentity(f.profileDir);
  fs.symlinkSync(path.join(f.root,'does-not-exist'),path.join(f.profileDir,'plugin-skills','broken-runtime-link'));
  const tx=await beginSetupTransaction({...f,stop});assert.equal(tx.state.treeIdentityVersion,3);assert.equal(tx.state.baseIdentity,before);assert.equal(fs.existsSync(path.join(tx.candidate,'plugin-skills')),false);assert.equal(fs.lstatSync(link).ino,beforeLink.ino);assert.equal(fs.readlinkSync(link),beforeTarget);assert.equal(get(f.root,'bundled-browser/SKILL.md'),'upstream-bundled-skill');
  for(const name of ['openclaw.json','agents/agi-creator/agent/auth-profiles.json','compute-journal.json','compute-settings.json'])assert.equal(get(tx.candidate,name),get(f.profileDir,name));
});

test('only the exact generated root is excluded, not similarly named or nested durable state',async t=>{
  const f=fixture(t);seed(f);const initial=treeIdentity(f.profileDir);fs.mkdirSync(path.join(f.profileDir,'plugin-skills'));assert.equal(treeIdentity(f.profileDir),initial);
  put(f.profileDir,'plugin-skills/generated.json','runtime');assert.equal(treeIdentity(f.profileDir),initial);
  for(const name of ['workspace/plugin-skills/state.json','plugin-skills-backup/state.json','workspace/skills/browser/SKILL.md']){const before=treeIdentity(f.profileDir);put(f.profileDir,name,'durable');assert.notEqual(treeIdentity(f.profileDir),before);}
  const target=path.join(f.root,'snapshot');await snapshotProfile(f.profileDir,target);for(const name of ['workspace/plugin-skills/state.json','plugin-skills-backup/state.json','workspace/skills/browser/SKILL.md'])assert.equal(get(target,name),'durable');
});

for(const location of ['foreign','agents/auth-link','workspace/plugin-skills/browser','plugin-skills-backup/browser','state-shm','COMPUTE_STOP','plugin-skills'])test('symlink remains forbidden outside generated descendants: '+location,async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'state','database-fixture');const file=path.join(f.profileDir,location);fs.mkdirSync(path.dirname(file),{recursive:true});fs.symlinkSync(path.join(f.root,'bundled-browser'),file);
  assert.throws(()=>treeIdentity(f.profileDir,{ignoreStop:true}),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'snapshot')),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_STATE_OWNER_REQUIRED/);
});

for(const dangling of [false,true])test('profile root symlink is refused, including dangling='+dangling,async t=>{
  const f=fixture(t);const target=path.join(f.root,'real-profile');if(!dangling)put(target,'openclaw.json','preserved');fs.symlinkSync(target,f.profileDir);
  assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'snapshot')),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_STATE_OWNER_REQUIRED/);assert.equal(fs.readlinkSync(f.profileDir),target);
});

test('a dangling plugin-skills root symlink cannot masquerade as an absent runtime',async t=>{
  const f=fixture(t);seed(f);fs.symlinkSync(path.join(f.root,'absent'),path.join(f.profileDir,'plugin-skills'));assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'snapshot')),/SETUP_STATE_OWNER_REQUIRED/);
});

test('a file at the generated directory name is rejected and never silently omitted',async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'plugin-skills','operator-file');assert.throws(()=>treeIdentity(f.profileDir),/SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'snapshot')),/SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED/);assert.equal(get(f.profileDir,'plugin-skills'),'operator-file');
});

test('generated root must be owned by the profile operator',async t=>{
  const f=fixture(t);seed(f);const generated=path.join(f.profileDir,'plugin-skills');fs.mkdirSync(generated);const original=fs.lstatSync;t.mock.method(fs,'lstatSync',(file,...args)=>{const s=original(file,...args);return file===generated?new Proxy(s,{get:(v,k)=>k==='uid'?process.getuid()+1:Reflect.get(v,k)}):s;});
  assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'snapshot')),/SETUP_STATE_OWNER_REQUIRED/);
});

test('generated tree can appear or change during approval, validation and activation, then rollback',async t=>{
  const f=fixture(t);seed(f);const originalLink=runtime(f.profileDir,path.join(f.root,'bundled-browser'));const tx=await beginSetupTransaction({...f,stop}),r=review();put(tx.candidate,'openclaw.json','reviewed-config');put(tx.candidate,'seal','sealed');runtime(tx.candidate,path.join(f.root,'candidate-bundle'));Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);
  runtime(tx.candidate,path.join(f.root,'another-bundle'));runtime(f.profileDir,path.join(f.root,'rebuilt-original'));
  await tx.publish({review:r,validate:()=>runtime(f.profileDir,path.join(f.root,'validation-bundle')),seal:()=>put(f.profileDir,'seal','sealed')});
  await tx.complete(()=>runtime(f.profileDir,path.join(f.root,'verification-bundle')),()=>runtime(f.profileDir,path.join(f.root,'activation-bundle')));assert.equal(transactionStatus(f.directory).state,'complete');
  await restoreSetupTransaction(f.directory,{stop});assert.equal(get(f.profileDir,'openclaw.json'),'original-config');assert.equal(fs.existsSync(path.dirname(originalLink)),false);assert.equal(fs.readlinkSync(path.join(tx.previous,'plugin-skills/browser-automation')),path.join(f.root,'rebuilt-original'));assert.equal(get(f.profileDir,'compute-journal.json'),'accepted-work-and-allowances');
});

test('failed activation restores original state even after generated links are rebuilt',async t=>{
  const f=fixture(t);seed(f);runtime(f.profileDir,path.join(f.root,'original-bundle'));const tx=await beginSetupTransaction({...f,stop}),r=review();Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>runtime(f.profileDir,path.join(f.root,'published-bundle')),seal:()=>{}});
  await assert.rejects(tx.complete(()=>{},()=>{runtime(f.profileDir,path.join(f.root,'activation-bundle'));throw Error('ACTIVATION_FAILED');}),/ACTIVATION_FAILED/);assert.equal(transactionStatus(f.directory).state,'rolled-back');assert.equal(fs.existsSync(path.join(f.profileDir,'plugin-skills')),false);assert.equal(fs.readlinkSync(path.join(tx.previous,'plugin-skills/browser-automation')),path.join(f.root,'original-bundle'));
});

for(const changed of ['openclaw.json','compute-journal.json','agents/agi-creator/agent/auth-profiles.json'])test('generated churn never permits durable state drift: '+changed,async t=>{
  const f=fixture(t);seed(f);runtime(f.profileDir,path.join(f.root,'bundle'));const tx=await beginSetupTransaction({...f,stop}),r=review();Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);put(tx.candidate,changed,'candidate-drift');runtime(tx.candidate,path.join(f.root,'rebuilt-bundle'));
  await assert.rejects(tx.publish({review:r,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_REVIEW_STALE/);put(tx.candidate,changed,get(f.profileDir,changed));Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);put(f.profileDir,changed,'live-drift');await assert.rejects(tx.publish({review:r,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_PROFILE_CHANGED/);
  put(f.profileDir,changed,get(tx.candidate,changed));await tx.publish({review:r,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});put(f.profileDir,changed,'post-activation-drift');runtime(f.profileDir,path.join(f.root,'runtime-churn'));if(changed==='compute-journal.json'){await restoreSetupTransaction(f.directory,{stop});assert.equal(transactionStatus(f.directory).state,'rolled-back');}else await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_RUNTIME_CHANGED/);assert.equal(get(f.profileDir,changed),'post-activation-drift');
});

test('a durable previous-profile change still prevents rollback',async t=>{
  const f=fixture(t);seed(f);runtime(f.profileDir,path.join(f.root,'bundle'));const tx=await beginSetupTransaction({...f,stop}),r=review();Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});put(tx.previous,'compute-journal.json','changed-backup');runtime(tx.previous,path.join(f.root,'rebuilt'));await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_BACKUP_CHANGED/);assert.equal(get(f.profileDir,'compute-journal.json'),'accepted-work-and-allowances');
});

for(const interrupted of ['empty','partial'])test('retry archives '+interrupted+' failed preparation without touching installed generated links',async t=>{
  const f=fixture(t);seed(f);const link=runtime(f.profileDir,path.join(f.root,'bundle'));fs.mkdirSync(f.directory);if(interrupted==='partial'){put(f.directory,'candidate/openclaw.json','partial-candidate');put(f.directory,'transaction.json',JSON.stringify({schema:1,id:crypto.randomUUID(),state:'preparing',profileDir:f.profileDir,previousExisted:true,baseIdentity:'unusable-incomplete-base',approval:null}));}
  const tx=await beginSetupTransaction({...f,stop});assert.equal(tx.state.state,'prepared');assert.equal(tx.state.treeIdentityVersion,3);assert.equal(fs.readlinkSync(link),path.join(f.root,'bundle'));const archived=fs.readdirSync(f.root).filter(name=>name.startsWith('transaction-'));assert.equal(archived.length,1);if(interrupted==='partial')assert.equal(get(path.join(f.root,archived[0]),'candidate/openclaw.json'),'partial-candidate');
});

for(const state of ['prepared','approved'])test('legacy '+state+' digest is verified before archival and a fresh v3 approval',async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'plugin-skills/generated-index.json','legacy-generated-state');const old=legacyRecord(f,state);assert.notEqual(old.baseIdentity,treeIdentity(f.profileDir));put(f.directory,'candidate/staged-oauth.json','preserve-in-archive');
  const tx=await beginSetupTransaction({...f,stop});assert.notEqual(tx.state.id,old.id);assert.equal(tx.state.treeIdentityVersion,3);assert.equal(tx.state.approval,null);assert.equal(fs.existsSync(path.join(tx.candidate,'plugin-skills')),false);assert.equal(fs.existsSync(path.join(tx.candidate,'staged-oauth.json')),false);assert.equal(get(f.directory+'-archive-'+old.id,'candidate/staged-oauth.json'),'preserve-in-archive');assert.equal(get(f.profileDir,'plugin-skills/generated-index.json'),'legacy-generated-state');
  const freshReview=bindPreparedReviewFixture(tx,review());await assert.rejects(tx.publish({review:freshReview,validate:()=>assert.fail(),seal:()=>assert.fail()}),/SETUP_REVIEW_STALE/);
});

for(const drift of ['durable','generated-link'])test('unverifiable legacy '+drift+' drift is retained, never translated',async t=>{
  const f=fixture(t);seed(f);fs.mkdirSync(path.join(f.profileDir,'plugin-skills'));const old=legacyRecord(f,'approved');if(drift==='durable')put(f.profileDir,'compute-journal.json','new-work');else runtime(f.profileDir,path.join(f.root,'rebuilt-bundle'));const saved=get(f.directory,'transaction.json');await assert.rejects(beginSetupTransaction({...f,stop}),drift==='durable'?/SETUP_CANDIDATE_BASE_CHANGED/:/SETUP_STATE_OWNER_REQUIRED/);assert.equal(get(f.directory,'transaction.json'),saved);assert.equal(fs.existsSync(f.directory+'-archive-'+old.id),false);
});

test('legacy completed rollback uses its recorded full-tree identity including generated directory',async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'plugin-skills/index.json','legacy-generated');const old=legacyRecord(f,'approved');fs.renameSync(f.profileDir,path.join(f.directory,'previous'));fs.renameSync(path.join(f.directory,'candidate'),f.profileDir);put(f.profileDir,'openclaw.json','legacy-reviewed-config');old.state='complete';old.completedIdentity=legacyIdentity(f.profileDir);put(f.directory,'transaction.json',JSON.stringify(old));assert.notEqual(old.completedIdentity,treeIdentity(f.profileDir));await restoreSetupTransaction(f.directory,{stop});assert.equal(get(f.profileDir,'openclaw.json'),'original-config');assert.equal(get(f.profileDir,'plugin-skills/index.json'),'legacy-generated');
});

test('legacy rollback never erases runtime or backup drift under a new identity interpretation',async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'plugin-skills/index.json','legacy-generated');const old=legacyRecord(f,'approved');fs.renameSync(f.profileDir,path.join(f.directory,'previous'));fs.renameSync(path.join(f.directory,'candidate'),f.profileDir);old.state='complete';old.completedIdentity=legacyIdentity(f.profileDir);put(f.directory,'transaction.json',JSON.stringify(old));put(f.profileDir,'plugin-skills/index.json','changed-legacy-runtime');await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_RUNTIME_CHANGED/);assert.equal(get(f.profileDir,'plugin-skills/index.json'),'changed-legacy-runtime');
});

for(const name of ['COMPUTE_STOP','state-shm'])test('legacy rollback rejects symlinks even at historically unhashed paths: '+name,async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'state','database-fixture');const old=legacyRecord(f,'approved');fs.renameSync(f.profileDir,path.join(f.directory,'previous'));fs.renameSync(path.join(f.directory,'candidate'),f.profileDir);old.state='complete';old.completedIdentity=legacyIdentity(f.profileDir);put(f.directory,'transaction.json',JSON.stringify(old));fs.symlinkSync(path.join(f.root,'bundled-browser'),path.join(f.profileDir,name));await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_STATE_OWNER_REQUIRED/);assert.equal(fs.lstatSync(path.join(f.profileDir,name)).isSymbolicLink(),true);
});

for(const version of [1,2])for(const name of ['COMPUTE_STOP','state-shm'])test('identity v'+version+' rejects directories hiding links at unhashed path '+name,async t=>{
  const f=fixture(t);seed(f);put(f.profileDir,'state','database-fixture');
  if(version===1){const old=legacyRecord(f,'approved');fs.renameSync(f.profileDir,path.join(f.directory,'previous'));fs.renameSync(path.join(f.directory,'candidate'),f.profileDir);old.state='complete';old.completedIdentity=legacyIdentity(f.profileDir);put(f.directory,'transaction.json',JSON.stringify(old));}
  else{const tx=await beginSetupTransaction({...f,stop}),r=review();delete tx.state.runtimeSecurityVersion;Object.assign(r,bindPreparedReviewFixture(tx,r));tx.approve(r);await tx.publish({review:r,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});}
  fs.mkdirSync(path.join(f.profileDir,name));fs.symlinkSync(path.join(f.root,'bundled-browser'),path.join(f.profileDir,name,'hidden-link'));assert.throws(()=>treeIdentity(f.profileDir,{ignoreStop:true}),/SETUP_STATE_FILE_UNSUPPORTED/);await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_STATE_FILE_UNSUPPORTED/);assert.equal(fs.lstatSync(path.join(f.profileDir,name,'hidden-link')).isSymbolicLink(),true);
});

test('unknown identity versions refuse resume and rollback before service mutation',async t=>{
  const f=fixture(t);seed(f);const old=legacyRecord(f,'approved');old.treeIdentityVersion=99;put(f.directory,'transaction.json',JSON.stringify(old));const neverStop=async()=>assert.fail('must validate identity version before stopping');await assert.rejects(beginSetupTransaction({...f,stop:neverStop}),/SETUP_TREE_IDENTITY_VERSION/);await assert.rejects(restoreSetupTransaction(f.directory,{stop:neverStop}),/SETUP_TREE_IDENTITY_VERSION/);assert.equal(get(f.profileDir,'openclaw.json'),'original-config');
});
