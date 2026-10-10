import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runtimeDatabase} from './runtime-sqlite-fixture.mjs';
import {beginSetupTransaction,restoreSetupTransaction,treeIdentity,transactionStatus,SETUP_STAGING_PROTOCOL_VERSION} from '../compute/setup-transaction.mjs';

const PREPARED_ID='0bec1b2b-ce5a-4cae-8a49-872da9e4d7a1';
const PREPARING_ID='395fc065-bccb-4170-a398-d059acc39836';
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode:0o600});};
const read=(root,name)=>fs.readFileSync(path.join(root,name),'utf8');
const stop=async()=>{};
// Byte inspection deliberately does not open archived SQLite databases or
// follow generated runtime symlinks: even WAL/SHM evidence must remain intact.
function evidence(root){
 const entries={};
 const visit=dir=>{for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name),stat=fs.lstatSync(file),key=path.relative(root,file);
  entries[key]={mode:stat.mode,uid:stat.uid,...(stat.isSymbolicLink()?{link:fs.readlinkSync(file)}:stat.isDirectory()?{directory:true}:{hash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})};
  if(stat.isDirectory())visit(file);
 }};visit(root);return entries;
}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-staging-protocol-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const profileDir=path.join(root,'live'),directory=path.join(root,'transaction');
 put(profileDir,'openclaw.json',JSON.stringify({gateway:{bind:'loopback'},auth:{order:{openai:['openai:agi-compute-pro']}}}));
 put(profileDir,'compute-journal.json','{"accepted":["keep-existing-job"],"settlements":["keep-journal"]}');
 put(profileDir,'compute-settings.json','{"maxRuns24h":48,"maxImages24h":8}');
 for(const agent of ['agi-creator','agi-checker','agi-reviewer']){
  put(profileDir,`agents/${agent}/agent/auth-profiles.json`,JSON.stringify({profile:'openai:agi-compute-pro',token:'fixture-'+agent}));
  put(profileDir,`agents/${agent}/sessions/history.jsonl`,'{"role":"user","content":"retained-history"}\n');
  const {db}=runtimeDatabase(profileDir,'agent',agent);db.prepare('INSERT INTO memory_session_tombstones VALUES(?,?,?,?)').run('kept-session',agent,'committed-before-migration',1);db.close();
 }
 put(root,'Library/LaunchAgents/ai.openclaw.agi-compute.plist','installed-gateway-state='+profileDir);
 const v2Archive=directory+'-archive-'+PREPARING_ID;
 put(v2Archive,'transaction.json',JSON.stringify({schema:1,treeIdentityVersion:2,id:PREPARING_ID,state:'preparing'}));
 put(v2Archive,'candidate/evidence','original-v2-candidate');
 return {root,profileDir,directory,v2Archive};
}
function legacyPrepared(f,{phase='prepared',protocol}={}){
 const record={schema:1,treeIdentityVersion:3,id:PREPARED_ID,state:phase,profileDir:f.profileDir,previousExisted:true,baseIdentity:treeIdentity(f.profileDir),approval:phase==='approved'?'a'.repeat(64):null,approvedIdentity:phase==='approved'?'b'.repeat(64):null,serviceBackup:'/existing/service-backup',startedAt:'2026-10-03T12:00:00Z',...(protocol===undefined?{}:{stagingProtocolVersion:protocol})};
 fs.mkdirSync(f.directory,{mode:0o700});fs.cpSync(f.profileDir,path.join(f.directory,'candidate'),{recursive:true});
 put(f.directory,'candidate/staged-auth-evidence.json','{"agi-creator":"checked-before-order-failure"}');
 put(f.directory,'candidate/agents/agi-creator/agent/openclaw-agent.sqlite-wal','opaque-preserved-sidecar-evidence');
 put(f.directory,'candidate/agents/agi-creator/agent/openclaw-agent.sqlite-shm','opaque-preserved-shm-evidence');
 put(f.directory,'candidate/plugin-skills/generated-index.json','generated-state');
 fs.symlinkSync('/upstream/bundled/browser-skill',path.join(f.directory,'candidate/plugin-skills/browser-automation'));
 put(f.directory,'transaction.json',JSON.stringify(record,null,2));return record;
}

for(const phase of ['prepared','approved'])for(const protocol of [undefined,1])test(`legacy v3 ${phase} protocol ${protocol??'absent'} is archived intact before fresh auth staging`,async t=>{
 const f=fixture(t),old=legacyPrepared(f,{phase,protocol}),oldEvidence=evidence(f.directory),v2Evidence=evidence(f.v2Archive),before=treeIdentity(f.profileDir),liveConfig=read(f.profileDir,'openclaw.json'),service=read(f.root,'Library/LaunchAgents/ai.openclaw.agi-compute.plist');
 const tx=await beginSetupTransaction({...f,stop});
 assert.equal(tx.state.treeIdentityVersion,3);assert.equal(tx.state.stagingProtocolVersion,SETUP_STAGING_PROTOCOL_VERSION);assert.notEqual(tx.state.id,old.id);assert.equal(tx.state.state,'prepared');assert.equal(tx.state.approval,null);assert.equal(tx.state.approvedIdentity,null);
 assert.deepEqual(evidence(f.directory+'-archive-'+old.id),oldEvidence);assert.deepEqual(evidence(f.v2Archive),v2Evidence);
 assert.equal(treeIdentity(f.profileDir),before);assert.equal(treeIdentity(tx.candidate),before);assert.equal(read(f.profileDir,'openclaw.json'),liveConfig);assert.equal(read(f.root,'Library/LaunchAgents/ai.openclaw.agi-compute.plist'),service);
 assert.equal(fs.existsSync(path.join(tx.candidate,'staged-auth-evidence.json')),false);
 for(const agent of ['agi-creator','agi-checker','agi-reviewer']){
  for(const relative of [`agents/${agent}/agent/auth-profiles.json`,`agents/${agent}/sessions/history.jsonl`])assert.equal(read(tx.candidate,relative),read(f.profileDir,relative));
  const db=new DatabaseSync(path.join(tx.candidate,`agents/${agent}/agent/openclaw-agent.sqlite`),{readOnly:true});assert.equal(db.prepare('SELECT reason FROM memory_session_tombstones').get().reason,'committed-before-migration');db.close();
 }
 for(const relative of ['compute-journal.json','compute-settings.json'])assert.equal(read(tx.candidate,relative),read(f.profileDir,relative));
 const status=transactionStatus(f.directory);assert.equal(status.stagingProtocolVersion,2);assert.equal(status.treeIdentityVersion,3);assert.equal(status.id,tx.state.id);
});

test('live drift rejects legacy v3 archival without changing either transaction evidence',async t=>{
 const f=fixture(t);legacyPrepared(f);const before=evidence(f.directory),v2Before=evidence(f.v2Archive);put(f.profileDir,'compute-journal.json','new-accepted-work');
 await assert.rejects(beginSetupTransaction({...f,stop:async()=>assert.fail('must verify base before stopping')}),/SETUP_CANDIDATE_BASE_CHANGED/);
 assert.deepEqual(evidence(f.directory),before);assert.deepEqual(evidence(f.v2Archive),v2Before);assert.equal(fs.existsSync(f.directory+'-archive-'+PREPARED_ID),false);assert.equal(read(f.profileDir,'compute-journal.json'),'new-accepted-work');
});

for(const phase of ['prepared','approved'])test(`current protocol ${phase} retry preserves an unprepared candidate or archives completed preparation evidence`,async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});put(tx.candidate,'candidate-auth-order-evidence','staged-successfully');
 if(phase==='approved')tx.approve(bindPreparedReviewFixture(tx,securityReview({},{},{maxRuns24h:48},{maxRuns24h:48})));
 const before=evidence(tx.candidate),transactionBefore=evidence(f.directory),live=treeIdentity(f.profileDir),v2Before=evidence(f.v2Archive),resumed=await beginSetupTransaction({...f,stop});
 assert.equal(resumed.state.state,'prepared');assert.equal(resumed.state.stagingProtocolVersion,2);assert.equal(resumed.state.approval,null);assert.equal(resumed.state.approvedIdentity,null);assert.equal(resumed.state.completedIdentity,null);assert.equal(treeIdentity(f.profileDir),live);assert.deepEqual(evidence(f.v2Archive),v2Before);
 if(phase==='approved'){assert.notEqual(resumed.state.id,tx.state.id);assert.deepEqual(evidence(f.directory+'-archive-'+tx.state.id),transactionBefore);assert.equal(fs.existsSync(path.join(resumed.candidate,'candidate-auth-order-evidence')),false);}
 else{assert.equal(resumed.state.id,tx.state.id);assert.deepEqual(evidence(resumed.candidate),before);assert.equal(fs.existsSync(f.directory+'-archive-'+tx.state.id),false);}
});

for(const protocol of [0,3,null,'2'])test(`unsupported staging protocol ${JSON.stringify(protocol)} fails before resume, rollback or mutation`,async t=>{
 const f=fixture(t);legacyPrepared(f,{protocol});const before=evidence(f.directory),v2Before=evidence(f.v2Archive),neverStop=async()=>assert.fail('must validate protocol before service mutation');
 await assert.rejects(beginSetupTransaction({...f,stop:neverStop}),/SETUP_STAGING_PROTOCOL_VERSION/);await assert.rejects(restoreSetupTransaction(f.directory,{stop:neverStop}),/SETUP_STAGING_PROTOCOL_VERSION/);assert.deepEqual(evidence(f.directory),before);assert.deepEqual(evidence(f.v2Archive),v2Before);
});

test('failed service stop after archival keeps legacy v3 and v2 evidence recoverable',async t=>{
 const f=fixture(t);legacyPrepared(f);const before=evidence(f.directory),v2Before=evidence(f.v2Archive),live=treeIdentity(f.profileDir);
 await assert.rejects(beginSetupTransaction({...f,stop:async()=>{throw Error('STOP_REFUSED');}}),/STOP_REFUSED/);
 assert.deepEqual(evidence(f.directory+'-archive-'+PREPARED_ID),before);assert.deepEqual(evidence(f.v2Archive),v2Before);assert.equal(treeIdentity(f.profileDir),live);assert.equal(fs.existsSync(f.directory),false);
 const next=await beginSetupTransaction({...f,stop});assert.equal(next.state.state,'prepared');assert.equal(next.state.stagingProtocolVersion,2);assert.deepEqual(evidence(f.directory+'-archive-'+PREPARED_ID),before);
});

test('unprepared current-protocol resume confirms service shutdown before refreshing saved state',async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});const before=evidence(f.directory);let stopped=false;
 const resumed=await beginSetupTransaction({...f,stop:async()=>{assert.deepEqual(evidence(f.directory),before);stopped=true;}});
 assert.equal(stopped,true);assert.equal(resumed.state.id,tx.state.id);assert.equal(resumed.state.approval,null);assert.equal(resumed.state.state,'prepared');
});

for(const scenario of ['running','live-change','cancelled'])test(`unprepared current-protocol resume preserves candidate and receipt when shutdown is ${scenario}`,async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});const before=evidence(f.directory),controller=new AbortController();
 const stopAgain=async()=>{
  assert.deepEqual(evidence(f.directory),before);
  if(scenario==='running')throw Error('COMPUTE_PROFILE_STILL_RUNNING');
  if(scenario==='live-change')put(f.profileDir,'compute-journal.json','committed-after-stop-request');
  if(scenario==='cancelled')controller.abort();
 };
 const expected={running:/COMPUTE_PROFILE_STILL_RUNNING/,'live-change':/SETUP_CANDIDATE_BASE_CHANGED/,cancelled:/SETUP_CANCELLED/};
 await assert.rejects(beginSetupTransaction({...f,stop:stopAgain,signal:controller.signal}),expected[scenario]);assert.deepEqual(evidence(f.directory),before);assert.equal(fs.existsSync(f.directory+'-archive-'+tx.state.id),false);
 if(scenario==='live-change')assert.equal(read(f.profileDir,'compute-journal.json'),'committed-after-stop-request');
});

for(const target of ['workspace-link','candidate-link','candidate-missing'])test(`current-protocol ${target} is refused before setup can refresh any saved state`,async t=>{
 const f=fixture(t),tx=await beginSetupTransaction({...f,stop});
 const outside=path.join(f.root,'outside');put(outside,'sentinel','must remain untouched');
 if(target==='workspace-link')fs.symlinkSync(outside,path.join(tx.candidate,'workspace'));
 else {fs.renameSync(tx.candidate,path.join(f.root,'preserved-candidate'));if(target==='candidate-link')fs.symlinkSync(outside,tx.candidate);}
 const before=evidence(f.directory),outsideBefore=evidence(outside),live=treeIdentity(f.profileDir);
 await assert.rejects(beginSetupTransaction({...f,stop}),target==='candidate-missing'?/SETUP_STATE_FILE_UNSUPPORTED/:/SETUP_STATE_OWNER_REQUIRED/);
 assert.deepEqual(evidence(f.directory),before);assert.deepEqual(evidence(outside),outsideBefore);assert.equal(treeIdentity(f.profileDir),live);
});
