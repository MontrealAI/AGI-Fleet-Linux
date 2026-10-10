import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {beginCleanupEvidence,finishCleanupEvidence,readCleanupEvidence,safeCleanupEvidence,evidenceBlocksWork,CLEANUP_EVIDENCE_DIRECTORY,CLEANUP_EVIDENCE_LIMITS} from '../shared/runtime/compute/cleanup-evidence.mjs';

function profile(t){const profileDir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'cleanup-evidence-'));fs.chmodSync(profileDir,0o700);t.after(()=>fs.rmSync(profileDir,{recursive:true,force:true}));return {profileDir};}
function context(overrides={}){const requestId=crypto.randomUUID();return {requestId,sessionId:`agent:agi-creator:agi-work-${requestId}`,sandboxScopeKey:`agent:agi-creator:agi-work-${requestId}:workspace:${'a'.repeat(32)}`,agent:'agi-creator',phase:'post-run',stage:'sandbox-recreate',target:'base',trigger:'finalize',...overrides};}
const passed=()=>({result:'PASS',commandResult:'PASS',postcondition:'PASS',exitStatus:0,signal:null,elapsedMs:25,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true,failureCode:null,dockerBefore:{status:'CAPTURED',containerIDs:['a'.repeat(64)]},dockerAfter:{status:'CAPTURED',containerIDs:[]},stopReason:null,stopMarker:'NOT_REQUIRED'});
const directory=c=>path.join(c.profileDir,CLEANUP_EVIDENCE_DIRECTORY);

test('legacy absence is explicit and does not by itself stop work',t=>{
 const c=profile(t),report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'ABSENT');assert.equal(evidenceBlocksWork(report),false);assert.equal(fs.existsSync(directory(c)),false);
});

test('durable intent precedes work and restart sees an interrupted attempt',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context()),report=readCleanupEvidence(c.profileDir);
 assert.equal(report.status,'BLOCKED');assert.equal(report.pending.length,1);assert.equal(report.pending[0].attemptId,attempt.attemptId);assert.deepEqual(report.issues,['COMPUTE_CLEANUP_INTERRUPTED']);assert.equal(evidenceBlocksWork(report),true);
 assert.equal(fs.statSync(directory(c)).mode&0o777,0o700);assert.equal(fs.statSync(path.join(directory(c),attempt.attemptId+'.start.json')).mode&0o777,0o600);
});

test('completed commands are retained with explicit sanitized attribution',t=>{
 const c=profile(t),ctx=context(),attempt=beginCleanupEvidence(c,ctx),finished=finishCleanupEvidence(c,attempt,passed()),report=readCleanupEvidence(c.profileDir);
 assert.equal(report.status,'PASS');assert.equal(evidenceBlocksWork(report),false);assert.equal(report.pending.length,0);assert.deepEqual(report.records,[finished]);assert.equal(finished.sessionId,ctx.sessionId);
 assert.equal(finished.commandClass,'openclaw-sandbox-recreate');assert.equal(finished.commandClassification,'openclaw-sandbox-recreate-base');assert.equal(finished.openclawFailureCode,null);
 assert.deepEqual(finished.dockerBefore,{status:'CAPTURED',containerIDs:['a'.repeat(64)]});assert.equal(report.retention,'append-only-no-pruning');assert.equal(report.valuesIncluded,false);
 for(const name of fs.readdirSync(directory(c))){const s=fs.statSync(path.join(directory(c),name));assert.equal(s.mode&0o777,0o600);assert.equal(s.nlink,1);}
});

test('failed browser cleanup survives successful later cleanup and empty repair logs',t=>{
 const c=profile(t),ctx=context({target:'browser'}),attempt=beginCleanupEvidence(c,ctx);
 finishCleanupEvidence(c,attempt,{...passed(),result:'FAIL',commandResult:'FAIL',postcondition:'UNKNOWN',exitStatus:null,signal:'SIGKILL',elapsedMs:32000,timedOut:true,failureCode:'COMPUTE_CLI_TIMEOUT',stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker:'PRESENT'});
 const second=beginCleanupEvidence(c,context());finishCleanupEvidence(c,second,passed());
 const report=safeCleanupEvidence({...readCleanupEvidence(c.profileDir),currentLogs:{bytes:0}}),failure=report.records.find(record=>record.attemptId===attempt.attemptId);
 assert.equal(report.status,'BLOCKED');assert.equal(report.records.length,2);assert.equal(failure.target,'browser');assert.equal(failure.failureCode,'COMPUTE_CLI_TIMEOUT');assert.equal(failure.failureCodeSource,'wrapper-allowlist');assert.equal(failure.openclawFailureCode,null);assert.equal(evidenceBlocksWork(report),true);
});

test('secrets and arbitrary upstream text cannot cross the durable or export boundaries',t=>{
 const c=profile(t),secret='oauth-secret-provider-text-user-content',attempt=beginCleanupEvidence(c,{...context(),stderr:secret,accessToken:secret});
 const finished=finishCleanupEvidence(c,attempt,{...passed(),result:'FAIL',failureCode:secret,stderr:secret,stack:secret,signal:secret,openclawFailureCode:secret,exitStatus:secret,elapsedMs:Infinity,stopReason:secret,dockerBefore:{status:'CAPTURED',containerIDs:[secret]},dockerAfter:{status:secret,containerIDs:[]}});
 assert.equal(finished.failureCode,'CLEANUP_FAILURE_UNCLASSIFIED');assert.equal(finished.stopReason,'CLEANUP_FAILURE_UNCLASSIFIED');assert.equal(finished.signal,null);assert.equal(finished.elapsedMs,null);assert.equal(finished.exitStatus,null);assert.equal(finished.openclawFailureCode,null);assert.equal(finished.dockerBefore.status,'UNAVAILABLE');
 const report=readCleanupEvidence(c.profileDir),safe=safeCleanupEvidence({...report,raw:secret,records:report.records.map(record=>({...record,stderr:secret,authorization:secret}))});
 assert.equal(JSON.stringify(safe).includes(secret),false);for(const file of fs.readdirSync(directory(c)))assert.equal(fs.readFileSync(path.join(directory(c),file),'utf8').includes(secret),false);
});

test('scope requires one exact request session and known phase/stage/target',t=>{
 const c=profile(t);
 for(const bad of [{sessionId:'agent:agi-creator:default'},{requestId:'------------------------------------'},{agent:'agi-checker'},{phase:'provider-secret'},{stage:'sandbox-recreate',target:'workspace'},{stage:'observer-finalize',target:'base'},{trigger:'anything'}])assert.throws(()=>beginCleanupEvidence(c,context(bad)),/COMPUTE_CLEANUP_EVIDENCE_FAILED/);
 assert.equal(fs.existsSync(directory(c)),false);
});

test('immutable finish refuses replacement and validates identity against durable start',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context());assert.throws(()=>finishCleanupEvidence(c,{...attempt,target:'browser'},passed()),/COMPUTE_CLEANUP_EVIDENCE_FAILED/);
 finishCleanupEvidence(c,attempt,passed());const file=path.join(directory(c),attempt.attemptId+'.finish.json'),before=fs.readFileSync(file);
 assert.throws(()=>finishCleanupEvidence(c,attempt,{...passed(),result:'FAIL'}),/COMPUTE_CLEANUP_EVIDENCE_FAILED/);assert.deepEqual(fs.readFileSync(file),before);assert.equal(readCleanupEvidence(c.profileDir).status,'PASS');
});

test('editing the durable start invalidates its finished record commitment',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context());finishCleanupEvidence(c,attempt,passed());const file=path.join(directory(c),attempt.attemptId+'.start.json');const value=JSON.parse(fs.readFileSync(file));value.target='browser';value.commandClassification='openclaw-sandbox-recreate-browser';fs.writeFileSync(file,JSON.stringify(value));
 const report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'CORRUPT');assert.equal(evidenceBlocksWork(report),true);
});

test('truncated records, unknown filenames, missing starts and unexpected raw fields fail closed',t=>{
 for(const change of ['truncated','unknown-name','missing-start','raw-field']){
  const c=profile(t),attempt=beginCleanupEvidence(c,context());finishCleanupEvidence(c,attempt,passed());const file=path.join(directory(c),attempt.attemptId+'.finish.json');
  if(change==='truncated')fs.writeFileSync(file,'{"');
  if(change==='unknown-name')fs.writeFileSync(path.join(directory(c),'private-provider-text'),'',{mode:0o600});
  if(change==='missing-start')fs.unlinkSync(path.join(directory(c),attempt.attemptId+'.start.json'));
  if(change==='raw-field'){const v=JSON.parse(fs.readFileSync(file));v.stderr='private-provider-text';fs.writeFileSync(file,JSON.stringify(v));}
  const report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'CORRUPT',change);assert.equal(evidenceBlocksWork(report),true);assert.equal(JSON.stringify(report).includes('private-provider-text'),false);
 }
});

test('symlinks, hardlinks and public file modes are rejected without following payloads',t=>{
 for(const attack of ['file-symlink','hardlink','public-file','directory-symlink','profile-symlink']){
  const c=profile(t),attempt=beginCleanupEvidence(c,context()),file=path.join(directory(c),attempt.attemptId+'.start.json'),outside=profile(t),payload=path.join(outside.profileDir,'payload');fs.writeFileSync(payload,'secret',{mode:0o600});
  if(attack==='file-symlink'){fs.unlinkSync(file);fs.symlinkSync(payload,file);}
  if(attack==='hardlink')fs.linkSync(file,path.join(outside.profileDir,'alias'));
  if(attack==='public-file')fs.chmodSync(file,0o644);
  if(attack==='directory-symlink'){fs.renameSync(directory(c),path.join(c.profileDir,'original'));fs.symlinkSync(outside.profileDir,directory(c));}
  let readPath=c.profileDir;if(attack==='profile-symlink'){readPath=path.join(outside.profileDir,'profile');fs.symlinkSync(c.profileDir,readPath);}
  const report=readCleanupEvidence(readPath);assert.equal(report.status,'CORRUPT',attack);assert.equal(evidenceBlocksWork(report),true);assert.equal(JSON.stringify(report).includes('secret'),false);assert.equal(fs.readFileSync(payload,'utf8'),'secret');
 }
});

test('writes fsync both files and directories; failed finish fsync retains blocked evidence',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context()),original=fs.fsyncSync;let fileSyncs=0,directorySyncs=0;
 fs.fsyncSync=fd=>{if(fs.fstatSync(fd).isDirectory())directorySyncs++;else fileSyncs++;return original(fd);};
 try{finishCleanupEvidence(c,attempt,passed());}finally{fs.fsyncSync=original;}
 assert.ok(fileSyncs>=1);assert.ok(directorySyncs>=1);
 const next=beginCleanupEvidence(c,context());fs.fsyncSync=fd=>{if(fs.fstatSync(fd).isFile())throw Object.assign(Error('private-disk-error'),{code:'EIO'});return original(fd);};
 try{assert.throws(()=>finishCleanupEvidence(c,next,passed()),/^Error: COMPUTE_CLEANUP_EVIDENCE_FAILED$/);}finally{fs.fsyncSync=original;}
 assert.equal(fs.existsSync(path.join(directory(c),next.attemptId+'.finish.json')),false);const report=readCleanupEvidence(c.profileDir);assert.equal(evidenceBlocksWork(report),true);assert.equal(JSON.stringify(report).includes('private-disk-error'),false);
});

test('quota blocks a new attempt without deleting historical evidence',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context()),first=path.join(directory(c),attempt.attemptId+'.start.json'),original=fs.readFileSync(first);
 for(let i=1;i<CLEANUP_EVIDENCE_LIMITS.attempts;i++)fs.writeFileSync(path.join(directory(c),crypto.randomUUID()+'.start.json'),'{}',{mode:0o600});
 assert.throws(()=>beginCleanupEvidence(c,context()),/COMPUTE_CLEANUP_EVIDENCE_LIMIT/);assert.equal(fs.readdirSync(directory(c)).length,CLEANUP_EVIDENCE_LIMITS.attempts);assert.deepEqual(fs.readFileSync(first),original);
});

test('untrusted support summaries cannot downgrade a failure or interrupted attempt',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context()),pending=readCleanupEvidence(c.profileDir);assert.equal(safeCleanupEvidence({...pending,status:'PASS',issues:[]}).status,'BLOCKED');
 finishCleanupEvidence(c,attempt,{...passed(),result:'FAIL',failureCode:'COMPUTE_CLEANUP_POSTCONDITION_FAILED'});const failed=readCleanupEvidence(c.profileDir);assert.equal(evidenceBlocksWork({...failed,status:'PASS',issues:[]}),true);
 assert.equal(evidenceBlocksWork({schema:'agi-cleanup-evidence/v1',status:'PASS',records:'secret',pending:[]}),true);assert.equal(evidenceBlocksWork({...failed,status:'ABSENT'}),true);
});

test('a claimed sandbox PASS requires confirmed command exit, termination and empty captured inventory',t=>{
 const invalid=[{commandResult:'UNKNOWN'},{commandResult:'NOT_RUN'},{postcondition:'UNKNOWN'},{postcondition:'NOT_RUN'},{processTerminationConfirmed:false},{processTerminationConfirmed:null},{started:false},{started:null},{exitStatus:1},{exitStatus:null},{signal:'SIGTERM'},{timedOut:true},{timedOut:null},{dockerBefore:{status:'UNAVAILABLE',containerIDs:[]}},{dockerBefore:{status:'NOT_REQUESTED',containerIDs:[]}},{dockerAfter:{status:'UNAVAILABLE',containerIDs:[]}},{dockerAfter:{status:'NOT_REQUESTED',containerIDs:[]}},{dockerAfter:{status:'CAPTURED',containerIDs:['b'.repeat(64)]}},{stopMarker:'UNKNOWN'}];
 for(const change of invalid){
  const c=profile(t),attempt=beginCleanupEvidence(c,context());finishCleanupEvidence(c,attempt,{...passed(),...change});
  const report=readCleanupEvidence(c.profileDir);assert.equal(report.status,'BLOCKED',JSON.stringify(change));assert.ok(report.issues.includes('COMPUTE_CLEANUP_EVIDENCE_INVALID'));assert.equal(evidenceBlocksWork(report),true);assert.equal(safeCleanupEvidence({...report,status:'PASS',issues:[]}).status,'BLOCKED');
 }
});

test('observer and workspace passes require positively confirmed postconditions',t=>{
 for(const [stage,target]of [['observer-finalize','observer'],['workspace-remove','workspace']]){
  for(const postcondition of ['FAIL','UNKNOWN','NOT_RUN',null]){
   const c=profile(t),attempt=beginCleanupEvidence(c,context({stage,target}));finishCleanupEvidence(c,attempt,{result:'PASS',commandResult:'NOT_RUN',postcondition,stopMarker:'NOT_REQUIRED'});assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),true,stage+':'+postcondition);
  }
  const c=profile(t),attempt=beginCleanupEvidence(c,context({stage,target}));finishCleanupEvidence(c,attempt,{result:'PASS',commandResult:'NOT_RUN',postcondition:'PASS',stopMarker:'NOT_REQUIRED'});assert.equal(evidenceBlocksWork(readCleanupEvidence(c.profileDir)),false);
 }
});

test('unconfirmed process termination retains its fixed wrapper failure code',t=>{
 const c=profile(t),attempt=beginCleanupEvidence(c,context());finishCleanupEvidence(c,attempt,{...passed(),result:'FAIL',commandResult:'FAIL',postcondition:'UNKNOWN',processTerminationConfirmed:false,failureCode:'COMPUTE_CLI_TERMINATION_UNCONFIRMED',stopReason:'COMPUTE_SANDBOX_CLEANUP_FAILED',stopMarker:'PRESENT'});
 const report=readCleanupEvidence(c.profileDir);assert.equal(report.records[0].failureCode,'COMPUTE_CLI_TERMINATION_UNCONFIRMED');assert.equal(report.records[0].failureCodeSource,'wrapper-allowlist');assert.equal(evidenceBlocksWork(report),true);
});
