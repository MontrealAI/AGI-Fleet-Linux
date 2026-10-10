import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {withCleanupHistoryLease} from '../shared/runtime/compute/cleanup-history.mjs';
import {beginCleanupEvidence,finishCleanupEvidence,readCleanupEvidence,archiveCleanupEvidence,safeCleanupEvidence,evidenceBlocksWork} from '../shared/runtime/compute/cleanup-evidence.mjs';
function fixture(t){const profileDir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cleanup-history-'));t.after(()=>fs.rmSync(profileDir,{recursive:true,force:true}));return {profileDir};}
function record(c,changes={}){const requestId=crypto.randomUUID(),sessionId=`agent:agi-creator:agi-work-${requestId}`,start=beginCleanupEvidence(c,{requestId,sessionId,sandboxScopeKey:sessionId+':workspace:'+'a'.repeat(32),agent:'agi-creator',phase:'post-run',stage:'sandbox-recreate',target:'base'});return finishCleanupEvidence(c,start,{result:'PASS',commandResult:'PASS',postcondition:'PASS',exitStatus:0,signal:null,elapsedMs:1,timedOut:false,started:true,processTerminationConfirmed:true,dockerBefore:{status:'CAPTURED',containerIDs:[]},dockerAfter:{status:'CAPTURED',containerIDs:[]},stopMarker:'NOT_REQUIRED',...changes});}
function inventory(root){return Object.fromEntries(fs.readdirSync(root).map(name=>[name,fs.readFileSync(path.join(root,name))]));}
test('rotation preserves every original byte and links successive archive generations',t=>{
 const c=fixture(t),active=path.join(c.profileDir,'cleanup-evidence'),history=path.join(c.profileDir,'cleanup-history');
 record(c);record(c);const first=inventory(active),initial=readCleanupEvidence(c.profileDir);assert.equal(initial.capacity.activeAttempts,2);
 const result=archiveCleanupEvidence(c.profileDir);assert.equal(result.status,'PASS');assert.equal(result.attemptCount,0);assert.equal(result.capacity.archivedAttempts,2);assert.equal(result.capacity.archiveSegments,1);assert.deepEqual(inventory(path.join(history,'000001')),first);assert.equal(fs.readdirSync(active).length,0);
 record(c);const second=archiveCleanupEvidence(c.profileDir);assert.equal(second.capacity.archivedAttempts,3);assert.equal(second.capacity.archiveSegments,2);assert.equal(JSON.parse(fs.readFileSync(path.join(history,'000002.json'))).previousSha256,result.capacity.archiveHeadSha256);assert.notEqual(second.capacity.archiveHeadSha256,result.capacity.archiveHeadSha256);
 assert.equal(evidenceBlocksWork(safeCleanupEvidence(second)),false);
});
test('failed and interrupted cleanup cannot be hidden by archival',t=>{
 for(const failure of [true,false]){const c=fixture(t);if(failure)record(c,{result:'FAIL',failureCode:'COMPUTE_DOCKER_FAILED',stopMarker:'PRESENT'});else{record(c);const dir=path.join(c.profileDir,'cleanup-evidence');fs.unlinkSync(path.join(dir,fs.readdirSync(dir).find(n=>n.endsWith('.finish.json'))));}const before=inventory(path.join(c.profileDir,'cleanup-evidence'));assert.throws(()=>archiveCleanupEvidence(c.profileDir));assert.deepEqual(inventory(path.join(c.profileDir,'cleanup-evidence')),before);assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),true);}
});
test('archived tampering, missing generations, extra files and public modes fail closed even after caching',t=>{
 for(const attack of ['tamper','missing','extra','public']){const c=fixture(t);record(c);archiveCleanupEvidence(c.profileDir);assert.equal(readCleanupEvidence(c.profileDir).status,'PASS');const root=path.join(c.profileDir,'cleanup-history'),segment=path.join(root,'000001'),name=fs.readdirSync(segment)[0];if(attack==='tamper')fs.appendFileSync(path.join(segment,name),' ');if(attack==='missing')fs.renameSync(segment,path.join(c.profileDir,'retained'));if(attack==='extra')fs.writeFileSync(path.join(segment,'unrecognized'),'secret',{mode:0o600});if(attack==='public')fs.chmodSync(path.join(segment,name),0o644);const report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'CORRUPT',attack);assert.equal(evidenceBlocksWork(report),true);assert.equal(JSON.stringify(report).includes('secret'),false);}
});
test('interrupted rotation blocks work and explicit resume preserves bytes after directory rename',t=>{
 const c=fixture(t);record(c);const active=path.join(c.profileDir,'cleanup-evidence'),original=inventory(active),real=fs.renameSync;let interrupted=false;
 fs.renameSync=(from,to)=>{real(from,to);if(from===active&&!interrupted){interrupted=true;throw Error('injected-power-loss');}};
 try{assert.throws(()=>archiveCleanupEvidence(c.profileDir),/injected-power-loss/);}finally{fs.renameSync=real;}
 assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),true);assert.throws(()=>archiveCleanupEvidence(c.profileDir));
 const resumed=archiveCleanupEvidence(c.profileDir,{resume:true});assert.equal(resumed.status,'PASS');assert.equal(resumed.capacity.archivedAttempts,1);assert.deepEqual(inventory(path.join(c.profileDir,'cleanup-history','000001')),original);
});
test('rotation never clears STOP or rewrites compute journal, settings or quarantined work',t=>{
 const c=fixture(t);record(c);for(const name of ['COMPUTE_STOP','compute-journal.json','compute-settings.json'])fs.writeFileSync(path.join(c.profileDir,name),'retained:'+name,{mode:0o600});fs.mkdirSync(path.join(c.profileDir,'jobs'),{mode:0o700});fs.writeFileSync(path.join(c.profileDir,'jobs','artifact'),'retained');archiveCleanupEvidence(c.profileDir);for(const name of ['COMPUTE_STOP','compute-journal.json','compute-settings.json'])assert.equal(fs.readFileSync(path.join(c.profileDir,name),'utf8'),'retained:'+name);assert.equal(fs.readFileSync(path.join(c.profileDir,'jobs','artifact'),'utf8'),'retained');
});
test('capacity export keeps scalar counts and hashes while discarding arbitrary text',t=>{
 const c=fixture(t);record(c);const report=readCleanupEvidence(c.profileDir);report.capacity.secret='private-canary';const safe=safeCleanupEvidence(report);assert.equal(safe.capacity.activeAttempts,1);assert.ok(safe.capacity.remainingAttempts>0);assert.equal(JSON.stringify(safe).includes('private-canary'),false);
});
test('automatic rotation occurs before the active cap and retains every verified attempt',t=>{
 const c=fixture(t),first=record(c),active=path.join(c.profileDir,'cleanup-evidence');
 const start=JSON.parse(fs.readFileSync(path.join(active,first.attemptId+'.start.json'))),finish=JSON.parse(fs.readFileSync(path.join(active,first.attemptId+'.finish.json')));
 for(let i=1;i<3072;i++){const attemptId=crypto.randomUUID(),value={...start,attemptId},data=Buffer.from(JSON.stringify(value)+'\n'),end={...finish,attemptId,startSha256:crypto.createHash('sha256').update(data).digest('hex')};fs.writeFileSync(path.join(active,attemptId+'.start.json'),data,{mode:0o600});fs.writeFileSync(path.join(active,attemptId+'.finish.json'),JSON.stringify(end)+'\n',{mode:0o600});}
 assert.equal(readCleanupEvidence(c.profileDir).capacity.warning,'ROTATION_DUE');record(c);const after=readCleanupEvidence(c.profileDir);assert.equal(after.status,'PASS');assert.equal(after.attemptCount,1);assert.equal(after.capacity.archivedAttempts,3072);assert.equal(after.capacity.archiveSegments,1);assert.equal(fs.readdirSync(path.join(c.profileDir,'cleanup-history','000001')).length,6144);
});
test('removal of an entire archive directory is detected by its separate retained anchor',t=>{
 const c=fixture(t);record(c);archiveCleanupEvidence(c.profileDir);fs.renameSync(path.join(c.profileDir,'cleanup-history'),path.join(c.profileDir,'retained-history'));
 assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),true);assert.throws(()=>record(c));
});
test('old unqualified cleanup PASS records remain retained but cannot authorize work or archival',t=>{
 const c=fixture(t),r=record(c),active=path.join(c.profileDir,'cleanup-evidence'),startPath=path.join(active,r.attemptId+'.start.json'),finishPath=path.join(active,r.attemptId+'.finish.json');
 const start=JSON.parse(fs.readFileSync(startPath));delete start.sandboxScopeKey;const data=Buffer.from(JSON.stringify(start)+'\n'),finish=JSON.parse(fs.readFileSync(finishPath));finish.startSha256=crypto.createHash('sha256').update(data).digest('hex');fs.writeFileSync(startPath,data);fs.writeFileSync(finishPath,JSON.stringify(finish)+'\n');const report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'BLOCKED');assert.ok(report.issues.includes('COMPUTE_CLEANUP_LEGACY_SCOPE_UNVERIFIED'));assert.equal(report.records.length,1);assert.throws(()=>archiveCleanupEvidence(c.profileDir));
});
test('OS lease prevents a second process from appending during rotation ownership',t=>{
 const c=fixture(t),moduleURL=new URL('../shared/runtime/compute/cleanup-history.mjs',import.meta.url).href;
 const script=`import {withCleanupHistoryLease} from ${JSON.stringify(moduleURL)};try{withCleanupHistoryLease(process.argv[1],()=>{});process.exitCode=2;}catch(e){if(e.message!=='COMPUTE_CLEANUP_HISTORY_BUSY')throw e;}`;
 withCleanupHistoryLease(c.profileDir,()=>{const child=spawnSync(process.execPath,['--input-type=module','-e',script,c.profileDir],{encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);});
 assert.equal(withCleanupHistoryLease(c.profileDir,()=>42),42);
});
test('unexpected SQLite sidecar links are refused without modifying their target',t=>{
 const c=fixture(t);record(c);const outside=path.join(c.profileDir,'sentinel');fs.writeFileSync(outside,'retained',{mode:0o600});fs.symlinkSync(outside,path.join(c.profileDir,'cleanup-history','lease.sqlite-journal'));assert.throws(()=>record(c));assert.equal(fs.readFileSync(outside,'utf8'),'retained');
});
test('low disk capacity is visible and prevents a new attempt before consuming the reserve',t=>{
 const c=fixture(t);record(c);const original=fs.statfsSync;fs.statfsSync=()=>({bavail:0,bsize:4096});
 try{assert.equal(readCleanupEvidence(c.profileDir).capacity.warning,'DISK_SPACE_LOW');assert.throws(()=>record(c),/COMPUTE_CLEANUP_EVIDENCE_LIMIT/);assert.equal(readCleanupEvidence(c.profileDir).attemptCount,1);}finally{fs.statfsSync=original;}
});
test('explicit resume recovers fully written staged metadata after an fsync failure',t=>{
 for(const target of ['ROTATION_PENDING.json.writing','000001.json.writing','HEAD.json.writing','cleanup-archive-head.json.writing']){
  const c=fixture(t);record(c);const open=fs.openSync,sync=fs.fsyncSync,close=fs.closeSync,handles=new Map();let failed=false;
  fs.openSync=(name,...args)=>{const fd=open(name,...args);handles.set(fd,String(name));return fd;};
  fs.closeSync=fd=>{handles.delete(fd);return close(fd);};
  fs.fsyncSync=fd=>{if(!failed&&handles.get(fd)?.endsWith('/'+target)){failed=true;throw Error('injected-fsync-failure');}return sync(fd);};
  try{assert.throws(()=>archiveCleanupEvidence(c.profileDir),/injected-fsync-failure/);}finally{fs.openSync=open;fs.fsyncSync=sync;fs.closeSync=close;}
  assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),true,target);const result=archiveCleanupEvidence(c.profileDir,{resume:true});assert.equal(result.status,'PASS',target);assert.equal(result.capacity.archivedAttempts,1);
 }
});
