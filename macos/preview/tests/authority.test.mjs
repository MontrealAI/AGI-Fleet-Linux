import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fixture,workspace,core,runner,authority,load,fakeGateway,previewRoot,repository} from './fixture.mjs';
const {Gateway}=await load('gateway.mjs');
const {assertMacTaskHost}=await load('task-host.mjs');

test('Mac preflight observes a non-administrator account with bounded argument-only system calls', () => {
  const host={platform:'darwin',arch:'arm64',osVersion:'15.0',translated:false,productionQualified:false};
  let calls=0;
  const result=assertMacTaskHost({host:()=>host,uid:501,run:(file,args,options)=>{
    calls++; assert.equal(file,'/usr/bin/id'); assert.deepEqual(args,['-Gn']);
    assert.equal(options.shell,false); assert.equal(options.timeout,5000);
    return {status:0,stdout:'staff everyone localaccounts _appserverusr\n'};
  }});
  assert.equal(calls,1); assert.equal(result.standardAccount,true); assert.equal(result.qualified,false); assert.equal(result.productionQualified,false);
});

test('Mac preflight fails closed for root, administrator groups, observation failures and invalid host', () => {
  const host=()=>({platform:'darwin',arch:'arm64'});
  assert.throws(()=>assertMacTaskHost({host,uid:0,run:()=>assert.fail('root rejected before id')}),/STANDARD_ACCOUNT_REQUIRED/);
  for(const group of ['admin','wheel','root','sudo'])
    assert.throws(()=>assertMacTaskHost({host,uid:501,run:()=>({status:0,stdout:'staff '+group})}),/STANDARD_ACCOUNT_REQUIRED/);
  for(const observation of [{status:1,stdout:'staff'},{status:0,stdout:''},{status:0,stdout:'staff',error:Error('spawn')},{status:0,stdout:'staff',signal:'SIGTERM'},{status:0,stdout:'staff\u0000admin'}])
    assert.throws(()=>assertMacTaskHost({host,uid:501,run:()=>observation}),/ACCOUNT_OBSERVATION_FAILED/);
  assert.throws(()=>assertMacTaskHost({host:()=>{throw Error('MAC_NATIVE_EXECUTION_REQUIRED');},uid:501,run:()=>assert.fail('invalid host rejected before account check')}),/MAC_NATIVE_EXECUTION_REQUIRED/);
});

test('materialization retains the actual Mac platform, gateway and native action implementations', () => {
  for(const name of ['platform.mjs','gateway.mjs','native.mjs'])
    assert.deepEqual(fs.readFileSync(path.join(previewRoot,'workforce',name)),fs.readFileSync(path.join(repository,'fleet/workforce',name)),name);
});

test('signed runtime source identity binds the exact native Mac host guard bytes actually imported', async t => {
  const directory=path.join(workspace(t),'workforce');
  fs.cpSync(path.join(previewRoot,'workforce'),directory,{recursive:true});
  const host=path.join(directory,'mac-host.mjs');
  assert.deepEqual(fs.readFileSync(host),fs.readFileSync(path.join(previewRoot,'shared/runtime/compute/mac-host.mjs')));
  const before=runner.sourceDigest(directory);
  fs.appendFileSync(host,'\nthrow Error("SYNTHETIC_HOST_GUARD_CHANGED");\n');
  assert.notEqual(runner.sourceDigest(directory),before);
  await assert.rejects(import(pathToFileURL(path.join(directory,'task-host.mjs'))),/SYNTHETIC_HOST_GUARD_CHANGED/);
});

test('actual Mac gateway rejects a Linux node and changed pairing or provider', async t => {
  const f=fixture(t), g=new Gateway(f.c), fake=fakeGateway(f.c);
  t.after(()=>g.close());
  let node=await fake.gateway.node(); g.request=async()=>node;
  assert.equal((await g.node()).platform,'macos');
  for(const change of [n=>{n.platform='linux';},n=>{n.nodeId='wrong-node';},n=>{n.connected=false;},n=>{n.computerUse.provider.id='wrong-provider';},n=>{n.computerUse.contractVersion=1;}]) {
    node=await fake.gateway.node(); change(node);
    await assert.rejects(g.node(),/NODE_NOT_READY|PROVIDER_CHANGED/);
  }
});

test('wrong account, role, signer or disabled authority blocks before any provider call', async t => {
  for(const change of [b=>({...b,nodeId:'different-account'}),b=>({...b,role:'reviewer'}),b=>({...b,disabled:true}),b=>({...b,expiresAt:b.issuedAt})]) {
    const f=fixture(t); f.writeAuthority(change(f.body)); let calls=0;
    await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>{calls++;throw Error('unexpected provider');}}),/AUTHORITY_RECORD|AUTHORITY_REVOKED/);
    assert.equal(calls,0);
  }
  const f=fixture(t); f.writeAuthority(f.body,crypto.generateKeyPairSync('ed25519').privateKey);
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>assert.fail('Wrong signer must not reach provider')}),/SIGNED_RECORD/);
});

test('revocation cannot be rolled back or omitted later to restore a grant', t => {
  const f=fixture(t), j=new core.Journal(f.c.dataDir);
  try {
    authority.checkAuthority(f.c,f.packet.grant.body,j,{now:f.now,required:true});
    f.writeAuthority({...f.body,sequence:2,revokedGrantNonces:[f.packet.grant.body.nonce]});
    assert.throws(()=>authority.checkAuthority(f.c,f.packet.grant.body,j,{now:f.now,required:true}),/AUTHORITY_REVOKED/);
    f.writeAuthority({...f.body,sequence:3});
    assert.throws(()=>authority.checkAuthority(f.c,f.packet.grant.body,j,{now:f.now,required:true}),/AUTHORITY_REVOKED/);
    f.writeAuthority(f.body);
    assert.throws(()=>authority.checkAuthority(f.c,f.packet.grant.body,j,{now:f.now,required:true}),/ROLLBACK/);
  } finally {j.close();}
});

test('one micro-unit below the configured whole-run reserve blocks before provider or ledger creation', async t => {
  const f=fixture(t); f.spec.budget.maxAgentCostUSDC='0.191999'; f.resign(); let constructions=0;
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>{constructions++;throw Error('must not connect');}}),/JOB_COST_LIMIT/);
  assert.equal(constructions,0); assert.equal(fs.existsSync(path.join(f.c.dataDir,'ledger.sqlite')),false);
});

test('pilot admission reserves the exact declared cost and does not label synthetic evidence qualified', async t => {
  const f=fixture(t), g=fakeGateway(f.c);
  const result=await runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>g.gateway});
  assert.equal(result.status,'declined'); assert.equal(result.productionQualified,undefined);
  assert.equal(g.calls.model,1); assert.equal(g.calls.mutation,0); assert.equal(g.calls.closeExecution,1);
  const j=new core.Journal(f.c.dataDir,{observer:true});
  try {const row=j.row(result.run); assert.equal(row.kind,'pilot'); assert.equal(row.reserved_cost_usdc,'0.192000'); assert.equal(row.model_calls,1); assert.equal(row.actions,1);}
  finally {j.close();}
});

test('signed production and legacy packets are refused through the synthetic platform seam before provider calls', async t => {
  const f=fixture(t); f.resign('production');
  assert.throws(()=>runner.checkGrant(f.c,f.spec,f.packet.grant),/MAC_PREVIEW_PILOT_ONLY/);
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>assert.fail('Preview production is always disabled')}),/MAC_PREVIEW_PILOT_ONLY/);
  f.spec.profile='computer-work/v2'; delete f.spec.privacy; delete f.spec.execution; delete f.spec.permissions; f.resign();
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>assert.fail('Legacy packets lack required v3 authority')}),/MAC_PREVIEW_V3_REQUIRED/);
});

test('missing signed live authority blocks v3 execution before provider creation', async t => {
  const f=fixture(t); fs.unlinkSync(f.c.revocationFile);
  await assert.rejects(runner.runNative(f.c,f.packet,{allowTestPlatform:true,gatewayFactory:()=>assert.fail('Missing authority must block provider')}),error=>error.code==='ENOENT'||/AUTHORITY/.test(error.message));
});
