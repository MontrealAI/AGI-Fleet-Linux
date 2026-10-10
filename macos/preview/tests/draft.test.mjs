import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fixture,core,runner,draft,cli,specCore,load,publicKey,privateKey} from './fixture.mjs';
const envelope = await load('envelope.mjs');

test('Mac draft binds both actual runtime identities and exact independent account resources', t => {
  const f=fixture(t), a=draft.descriptor(f.c), r=draft.descriptor(f.reviewer);
  assert.equal(specCore.validateComputerWork(f.spec),f.spec);
  assert.equal(f.spec.profile,'computer-work/v3');
  assert.equal(f.spec.environment.runtimeSha256.agent,a.runtimeSha256);
  assert.equal(f.spec.environment.runtimeSha256.reviewer,r.runtimeSha256);
  assert.notEqual(a.runtimeSha256,r.runtimeSha256);
  assert.deepEqual(f.spec.authority.agent.resources,f.c.resources);
  assert.deepEqual(f.spec.authority.reviewer.resources,f.reviewer.resources);
  assert.equal(a.runtime.capabilities.includes('native-apps'),true);
  assert.equal(a.qualification,'PILOT_ONLY');
  assert.equal(f.spec.grant,undefined);
  assert.equal(f.spec.permissions.agent.enforcement,'whole-account');
  assert.deepEqual(f.spec.permissions.agent.externalEffects,['whole-account-interaction']);
});

test('six-decimal costs use exact whole-run reserves for each role, without floating-point rounding', t => {
  const f=fixture(t);
  f.c.limits={...f.c.limits,maxActions:120,maxModelCalls:80,maxSeconds:1200};
  f.c.costPolicy={...f.c.costPolicy,modelCallReserveUSDC:'0.100001',actionReserveUSDC:'0.000001',fixedRunReserveUSDC:'0.100001'};
  f.reviewer.limits={...f.reviewer.limits,maxActions:3,maxModelCalls:2};
  f.reviewer.costPolicy={...f.reviewer.costPolicy,modelCallReserveUSDC:'0.000001',actionReserveUSDC:'0.000001',fixedRunReserveUSDC:'0'};
  const spec=draft.draftJob(f.c,draft.descriptor(f.reviewer),f.options);
  assert.equal(spec.budget.maxAgentCostUSDC,'8.100201');
  assert.equal(spec.budget.maxReviewCostUSDC,'0.000005');
  assert.equal(spec.budget.maxAgentSeconds,600);
  assert.equal(spec.budget.maxReviewSeconds,60);
  assert.equal(spec.deadline,f.now+86400);
});

test('draft rejects recipient additions or omissions and tampered reviewer identity; key order is immaterial', t => {
  const f=fixture(t), second=publicKey(crypto.generateKeyPairSync('x25519'));
  f.c.recipientPublicKeys.push(second); f.reviewer.recipientPublicKeys=[...f.c.recipientPublicKeys].reverse();
  const d=draft.descriptor(f.reviewer);
  assert.doesNotThrow(()=>draft.draftJob(f.c,d,f.options));
  for(const ids of [d.recipientKeyIds.slice(1),[...d.recipientKeyIds,'a'.repeat(64)]])
    assert.throws(()=>draft.draftJob(f.c,{...d,recipientKeyIds:ids},f.options),/RECIPIENTS_MUST_MATCH/);
  assert.throws(()=>draft.draftJob(f.c,{...d,role:'agent'},f.options),/REVIEWER_DESCRIPTOR/);
  assert.throws(()=>draft.draftJob(f.c,{...d,runtime:{...d.runtime,model:'altered'}},f.options),/REVIEWER_DESCRIPTOR/);
  const unavailable={...d.runtime,capabilities:['desktop']};
  assert.throws(()=>draft.draftJob(f.c,{...d,runtime:unavailable,runtimeSha256:specCore.digest(unavailable)},f.options),/CAPABILITY_UNAVAILABLE/);
});

test('draft requires explicit supported authority and settlement and rejects unsafe artifact paths', t => {
  const f=fixture(t), d=draft.descriptor(f.reviewer);
  for(const authority of [undefined,'observe-only','broker-scoped'])
    assert.throws(()=>draft.draftJob(f.c,d,{...f.options,authority}),/EXPLICIT_WHOLE_ACCOUNT_REQUIRED/);
  assert.throws(()=>draft.draftJob(f.c,d,{...f.options,manager:undefined}),/SETTLEMENT/);
  assert.throws(()=>draft.draftJob(f.c,d,{...f.options,output:'../escape'}),/ARTIFACT_PATH/);
  const spec=draft.draftJob(f.c,d,{...f.options,dataPolicy:'confidential',output:'design.custom'});
  assert.equal(spec.outputs[0].mediaType,'application/octet-stream');
  assert.equal(spec.privacy.publicDisclosure,'commitment-only');
  assert.equal(spec.privacy.modelProcessing,'approved-provider');
});

test('exact reviewed Mac draft becomes a private signed encrypted pilot packet', async t => {
  const f=fixture(t), config=path.join(f.dir,'config.json'), spec=path.join(f.dir,'spec.json'), signer=path.join(f.dir,'operator.pem'), out=path.join(f.dir,'encrypted.json');
  core.atomic(config,f.c); core.atomic(spec,f.spec); core.atomic(signer,privateKey(f.operator));
  await cli.main(['packet','--config',config,'--spec',spec,'--inputs',f.dir,'--signing-key',signer,'--mode','pilot','--out',out]);
  const serialized=fs.readFileSync(out,'utf8');
  assert.doesNotMatch(serialized,/Synthetic Mac preview test|BEGIN PRIVATE KEY/);
  const encrypted=JSON.parse(serialized), packet=runner.validatePacket(JSON.parse(envelope.open(encrypted,f.recipient.privateKey,encrypted.header.context)));
  assert.equal(core.digest(packet.specification),core.digest(f.spec));
  assert.equal(runner.checkGrant(f.c,f.spec,packet.grant).mode,'pilot');
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  assert.throws(()=>envelope.open(encrypted,crypto.generateKeyPairSync('x25519').privateKey,encrypted.header.context),/RECIPIENT_NOT_AUTHORIZED/);
});

test('CLI descriptor and draft-job preserve actual reviewer bindings without creating a grant or contacting a provider', async t => {
  const f=fixture(t), agentFile=path.join(f.dir,'agent.json'), reviewerFile=path.join(f.dir,'reviewer.json'), descriptorFile=path.join(f.dir,'descriptor.json'), out=path.join(f.dir,'draft.json');
  core.atomic(agentFile,f.c); core.atomic(reviewerFile,f.reviewer);
  await cli.main(['descriptor','--config',reviewerFile,'--out',descriptorFile]);
  const serialized=fs.readFileSync(descriptorFile,'utf8'), reviewer=JSON.parse(serialized);
  assert.doesNotMatch(serialized,/BEGIN PUBLIC KEY|BEGIN PRIVATE KEY|gatewayTokenFile|gateway-token/);
  await cli.main(['draft-job','--config',agentFile,'--reviewer-descriptor',descriptorFile,'--chain-id','31337','--manager',f.options.manager,'--authority','whole-account','--output','report.custom','--out',out]);
  const spec=JSON.parse(fs.readFileSync(out));
  assert.equal(specCore.validateComputerWork(spec),spec);
  assert.equal(spec.environment.runtimeSha256.reviewer,reviewer.runtimeSha256);
  assert.equal(spec.environment.runtimeSha256.agent,draft.descriptor(f.c).runtimeSha256);
  assert.equal(spec.outputs[0].name,'report.custom'); assert.equal(spec.grant,undefined);
  assert.equal(fs.statSync(out).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(f.c.dataDir,'ledger.sqlite')),false);
});

test('packet rejects wrong operator before reading the specification or producing output', async t => {
  const f=fixture(t), config=path.join(f.dir,'config.json'), signer=path.join(f.dir,'wrong.pem'), out=path.join(f.dir,'encrypted.json');
  core.atomic(config,f.c); core.atomic(signer,privateKey(crypto.generateKeyPairSync('ed25519')));
  await assert.rejects(cli.main(['packet','--config',config,'--spec',path.join(f.dir,'missing-spec.json'),'--inputs',f.dir,'--signing-key',signer,'--out',out]),/AUTHORITY_SIGNER/);
  assert.equal(fs.existsSync(out),false);
});

test('Mac preview cannot sign production or legacy packets and creates no output for either', async t => {
  const f=fixture(t), config=path.join(f.dir,'config.json'), signer=path.join(f.dir,'operator.pem'), spec=path.join(f.dir,'spec.json'), out=path.join(f.dir,'denied.json');
  core.atomic(config,f.c); core.atomic(signer,privateKey(f.operator)); core.atomic(spec,f.spec);
  const args=['packet','--config',config,'--spec',spec,'--inputs',f.dir,'--signing-key',signer,'--out',out];
  await assert.rejects(cli.main([...args,'--mode','production']),/MAC_PREVIEW_PILOT_ONLY/);
  assert.equal(fs.existsSync(out),false);
  const legacy={...f.spec,profile:'computer-work/v2'};
  delete legacy.privacy; delete legacy.execution; delete legacy.permissions;
  core.atomic(spec,legacy);
  await assert.rejects(cli.main(args),/MAC_PREVIEW_V3_REQUIRED/);
  assert.equal(fs.existsSync(out),false);
});
