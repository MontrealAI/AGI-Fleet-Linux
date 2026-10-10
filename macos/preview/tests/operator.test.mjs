import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture,core,runner,cli,load,fakeGateway} from './fixture.mjs';
const {workspaceStatus,stopWorkspace,resumeWorkspace}=await load('operator.mjs');

test('STOP works before binding; explicit resume clears only STOP and never starts a worker', t => {
  const f=fixture(t), c={...f.c,installationSha256:'0'.repeat(64),gatewayConfigSha256:'0'.repeat(64)};
  assert.equal(workspaceStatus(c).bound,false);
  assert.equal(stopWorkspace(c).stopped,true);
  assert.equal(workspaceStatus(c).stopped,true);
  assert.throws(()=>resumeWorkspace(c,'false'),/ACKNOWLEDGEMENT/);
  assert.equal(workspaceStatus(c).stopped,true);
  assert.equal(resumeWorkspace(c,'true').resumed,true);
  assert.equal(workspaceStatus(c).stopped,false);
  assert.equal(fs.existsSync(path.join(c.dataDir,'ledger.sqlite')),false);
});

test('CLI status and STOP remain usable for incomplete preparation without fake successful binding', async t => {
  const f=fixture(t), config=path.join(f.dir,'unbound.json'), out=path.join(f.dir,'status.json');
  core.atomic(config,{...f.c,installationSha256:'0'.repeat(64),gatewayConfigSha256:'0'.repeat(64),costPolicy:{modelCallReserveUSDC:null,actionReserveUSDC:null,fixedRunReserveUSDC:null,maxDailyReserveUSDC:null}});
  await cli.main(['status','--config',config,'--out',out]);
  assert.equal(JSON.parse(fs.readFileSync(out)).bound,false);
  await cli.main(['stop','--config',config,'--out',out]);
  assert.equal(JSON.parse(fs.readFileSync(out)).stopped,true);
  await cli.main(['resume','--config',config,'--acknowledge','true','--out',out]);
  assert.equal(JSON.parse(fs.readFileSync(out)).resumed,true);
  assert.equal(fs.existsSync(path.join(f.c.dataDir,'ledger.sqlite')),false);
});

test('resume refuses a live lease and preserves STOP until that worker has exited', t => {
  const f=fixture(t); stopWorkspace(f.c);
  const db=new DatabaseSync(path.join(f.c.dataDir,'ledger.sqlite'));
  db.exec('CREATE TABLE lease(singleton INTEGER PRIMARY KEY,pid INTEGER)');
  db.prepare('INSERT INTO lease VALUES(1,?)').run(process.pid); db.close();
  fs.chmodSync(path.join(f.c.dataDir,'ledger.sqlite'),0o600);
  assert.throws(()=>resumeWorkspace(f.c,'true'),/WORKER_STILL_RUNNING/);
  assert.equal(workspaceStatus(f.c).stopped,true);
  const cleared=new DatabaseSync(path.join(f.c.dataDir,'ledger.sqlite')); cleared.exec('DELETE FROM lease'); cleared.close();
  assert.equal(resumeWorkspace(f.c,'true').resumed,true);
});

test('recovery marker blocks resume and is never silently removed', t => {
  const f=fixture(t); stopWorkspace(f.c);
  const marker=path.join(f.c.dataDir,'RECOVERY_REQUIRED.json'); core.atomic(marker,{reason:'cleanup-uncertain'});
  assert.throws(()=>resumeWorkspace(f.c,'true'),/RECOVERY_REQUIRED/);
  assert.equal(workspaceStatus(f.c).stopped,true);
  assert.equal(workspaceStatus(f.c).recoveryRequired,true);
  assert.equal(JSON.parse(fs.readFileSync(marker)).reason,'cleanup-uncertain');
});

for(const name of ['RECOVERY_REQUIRED.json','STOP','ledger.sqlite']) {
  test(`dangling ${name} symlink fails closed during resume`, t => {
    const f=fixture(t);
    if(name!=='STOP')stopWorkspace(f.c);
    fs.symlinkSync(path.join(f.dir,'absent-target'),path.join(f.c.dataDir,name));
    assert.throws(()=>resumeWorkspace(f.c,'true'),/RECOVERY_REQUIRED|STOP_FILE|DATABASE_FILE/);
    assert.equal(fs.lstatSync(path.join(f.c.dataDir,name)).isSymbolicLink(),true);
    if(name!=='STOP')assert.equal(workspaceStatus(f.c).stopped,true);
  });
}

test('workspace directory indirection is refused and status omits secrets and private paths', t => {
  const f=fixture(t), alias=path.join(f.dir,'linked'); fs.symlinkSync(f.c.dataDir,alias);
  assert.throws(()=>stopWorkspace({...f.c,dataDir:alias}),/DIRECTORY_LINK/);
  const result=JSON.stringify(workspaceStatus({...f.c,gatewayToken:'NEVER_DISCLOSE_TOKEN',gatewayTokenFile:'/secret/private-token',operatorPublicKey:'NEVER_DISCLOSE_KEY'}));
  assert.doesNotMatch(result,/NEVER_DISCLOSE|private-token|BEGIN PUBLIC KEY/);
});

test('STOP blocks admission before provider construction and before reserving money', async t => {
  const f=fixture(t); stopWorkspace(f.c); let constructions=0;
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>{constructions++;throw Error('must never construct');}}),/OPERATOR_STOP/);
  assert.equal(constructions,0);
  assert.equal(fs.existsSync(path.join(f.c.dataDir,'ledger.sqlite')),false);
});

test('STOP after a screenshot blocks the first model call and further desktop input', async t => {
  const f=fixture(t), g=fakeGateway(f.c,{snapshot:()=>stopWorkspace(f.c)});
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>g.gateway}),/OPERATOR_STOP/);
  assert.equal(g.calls.screenshot,1); assert.equal(g.calls.model,0); assert.equal(g.calls.mutation,0); assert.equal(g.calls.closeExecution,1);
  const journal=new core.Journal(f.c.dataDir,{observer:true});
  try {const row=journal.row('job-'+core.digest(f.packet.grant.body)); assert.equal(row.model_calls,0); assert.equal(row.actions,1);}
  finally {journal.close();}
});

test('STOP during a model response blocks the returned mutation before dispatch or action reservation', async t => {
  const f=fixture(t), g=fakeGateway(f.c,{plan:()=>{stopWorkspace(f.c);return {answer:{action:'type',args:{text:'must never type'}},usage:{total_tokens:1}};}});
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>g.gateway}),/OPERATOR_STOP/);
  assert.equal(g.calls.model,1); assert.equal(g.calls.mutation,0); assert.equal(g.calls.closeExecution,1);
  const journal=new core.Journal(f.c.dataDir,{observer:true});
  try {const row=journal.row('job-'+core.digest(f.packet.grant.body)); assert.equal(row.model_calls,1); assert.equal(row.actions,1);}
  finally {journal.close();}
});
