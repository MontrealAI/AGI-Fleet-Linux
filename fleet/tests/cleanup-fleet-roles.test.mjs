import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const roles={agent:'AGI_Agent',node:'AGI_Node',moderator:'AGI_Moderator',employer:'AGI_Employer',evidence:'AGI_Evidence',recovery:'AGI_Recovery'};
for(const [role,pkg] of Object.entries(roles))test(`${role} shipped shared cleanup retains failure and does not widen role admission`,async()=>{
 const {ComputeWorker}=await import(`../packages/${pkg}/compute/server.mjs`);
 const {readCleanupEvidence}=await import(`../packages/${pkg}/shared/runtime/compute/cleanup-evidence.mjs`);
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'agi-fleet-cleanup-'));
 try{
  const c={role,profileDir:dir,workspace:dir,workstation:true,maxRuns24h:2,maxImages24h:1};
  let failBrowser=false,commands=0;
  const worker=new ComputeWorker(c,{verifyPolicy:false,cleanupInventory:async()=>({status:'CAPTURED',containerIDs:[]}),cli:async(_c,args)=>{commands++;if(failBrowser&&args.includes('--browser'))throw Object.assign(Error('secret provider text'),{code:'COMPUTE_DOCKER_FAILED',exitStatus:1,started:true,processTerminationConfirmed:true});return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timedOut:false,started:true,processTerminationConfirmed:true};}});
  if(role!=='agent'){await assert.rejects(worker.execute('generate',{}, {id:crypto.randomUUID()}),/ROLE_REQUIRED/);assert.equal(commands,0);}
  await worker.cleanupAgent('agi-reviewer',`agent:agi-reviewer:agi-work-${crypto.randomUUID()}`,{phase:'pre-run',trigger:'preflight'});
  assert.equal(readCleanupEvidence(dir).status,'PASS');
  failBrowser=true;
  await assert.rejects(worker.cleanupAgent('agi-reviewer',`agent:agi-reviewer:agi-work-${crypto.randomUUID()}`),/CLEANUP_FAILED/);
  const evidence=readCleanupEvidence(dir);
  assert.equal(evidence.status,'BLOCKED');assert.equal(evidence.records.find(x=>x.result==='FAIL').target,'browser');assert.equal(JSON.stringify(evidence).includes('secret provider text'),false);
  assert.ok(fs.existsSync(path.join(dir,'COMPUTE_STOP')));
  await assert.rejects(worker.execute('test',{}, {id:crypto.randomUUID()}),/CLEANUP_FAILED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
