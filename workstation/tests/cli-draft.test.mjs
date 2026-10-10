import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {main} from '../engine/cli.mjs';
import {open} from '../engine/envelope.mjs';
import {checkGrant,validatePacket} from '../engine/runner.mjs';
import {descriptor,draftJob} from '../engine/job-draft.mjs';
import core from '../engine/core/computer-work.cjs';
const key=(type)=>crypto.generateKeyPairSync(type).publicKey.export({format:'pem',type:'spki'});
function configs(){const recipientPublicKeys=[key('x25519'),key('x25519')],base={schema:'agi-native-config/v1',role:'agent',dataDir:'/home/worker/operations',identityDir:'/home/worker/device',gatewayURL:'http://127.0.0.1:29501',gatewayTokenFile:'/home/worker/token',gatewayConfigFile:'/home/worker/gateway',gatewayConfigSha256:'a'.repeat(64),plannerAgent:'agi-native-planner',model:'openai/gpt-6-astra',openclawVersion:'2026.9.5',nodeId:'paired-agent',provider:'cua-computer',installationSha256:'b'.repeat(64),appBundlePath:'/opt/openclaw',resources:['dedicated-account:agent'],operatorPublicKey:key('ed25519'),recipientPublicKeys,limits:{maxActions:120,maxModelCalls:80,maxSeconds:1200,maxRuns24h:20},costPolicy:{modelCallReserveUSDC:'0.10',actionReserveUSDC:'0.001',fixedRunReserveUSDC:'0.10',maxDailyReserveUSDC:'25'},qualificationPolicyFile:null,qualificationEvidenceFile:null,revocationFile:'/var/lib/agi/authority.json',receiptPublicKey:null,applications:[]};return [base,{...base,role:'reviewer',nodeId:'paired-reviewer',dataDir:'/home/reviewer/operations',resources:['dedicated-account:reviewer']}];}
const options={authority:'whole-account',chainId:1,manager:'0xCFA78f9980eA9B55c705B3E44467baE383cE1fA7',now:1800000000};
test('draft is valid v3 with both actual identities, recipient exactness, explicit account-wide draft scope and computed reserves',()=>{
 const [agent,reviewer]=configs(),d=descriptor(reviewer),spec=draftJob(agent,d,options);assert.equal(core.validateComputerWork(spec),spec);assert.equal(spec.profile,'computer-work/v3');assert.equal(spec.environment.runtimeSha256.agent,descriptor(agent).runtimeSha256);assert.equal(spec.environment.runtimeSha256.reviewer,d.runtimeSha256);assert.notEqual(spec.environment.runtimeSha256.agent,spec.environment.runtimeSha256.reviewer);assert.equal(spec.permissions.agent.enforcement,'whole-account');assert.deepEqual(spec.permissions.agent.externalEffects,['whole-account-interaction']);assert.equal(spec.permissions.agent.allowedActions.includes('type'),true);assert.equal(spec.budget.maxAgentCostUSDC,'8.220000');assert.equal(spec.deadline,options.now+86400);assert.equal(spec.budget.maxAgentSeconds,600);assert.equal(spec.grant,undefined);assert.equal(d.qualification,'PILOT_ONLY');
});
test('whole account is an explicit draft option and arbitrary deliverable types remain supported',()=>{
 const [agent,reviewer]=configs(),spec=draftJob(agent,descriptor(reviewer),{...options,authority:'whole-account',dataPolicy:'confidential',title:'Prepare a design',prompt:'Create the approved design using synthetic inputs.',output:'design.custom'});assert.equal(spec.permissions.agent.enforcement,'whole-account');assert.equal(spec.permissions.reviewer.enforcement,'whole-account');assert.deepEqual(spec.permissions.agent.externalEffects,['whole-account-interaction']);assert.ok(spec.permissions.agent.allowedActions.includes('type'));assert.equal(spec.outputs[0].mediaType,'application/octet-stream');assert.equal(spec.privacy.publicDisclosure,'commitment-only');assert.equal(spec.privacy.modelProcessing,'approved-provider');
});
test('draft rejects mismatched recipients, altered reviewer identity, unsupported permissions and missing settlement identity',()=>{
 const [agent,reviewer]=configs(),d=descriptor(reviewer);assert.throws(()=>draftJob(agent,{...d,recipientKeyIds:['a'.repeat(64)]},options),/RECIPIENTS_MUST_MATCH/);assert.throws(()=>draftJob(agent,{...d,runtime:{...d.runtime,model:'changed'}},options),/REVIEWER_DESCRIPTOR/);assert.throws(()=>draftJob(agent,d,{...options,authority:'broker-scoped'}),/DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED/);assert.throws(()=>draftJob(agent,d,{...options,authority:undefined}),/DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED/);assert.throws(()=>draftJob(agent,d,{...options,authority:'observe-only'}),/DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED/);assert.throws(()=>draftJob(agent,d,{...options,manager:undefined}),/SETTLEMENT/);assert.throws(()=>draftJob(agent,d,{...options,output:'../escape'}),/ARTIFACT_PATH/);
});
test('recipient ordering is normalized but wrong reviewer role and stale runtime capabilities are rejected',()=>{
 const [agent,reviewer]=configs(),d=descriptor({...reviewer,recipientPublicKeys:[...reviewer.recipientPublicKeys].reverse()});assert.doesNotThrow(()=>draftJob(agent,d,options));assert.throws(()=>draftJob(agent,{...d,role:'agent'},options),/REVIEWER_DESCRIPTOR/);const runtime={...d.runtime,capabilities:['desktop']};assert.throws(()=>draftJob(agent,{...d,runtime,runtimeSha256:core.digest(runtime)},options),/CAPABILITY_UNAVAILABLE/);
});

test('reviewed draft becomes an exact signed encrypted pilot packet without desktop or provider calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-draft-packet-'));fs.chmodSync(dir,0o700);
 try {
  const [agent,reviewer]=configs(),operator=crypto.generateKeyPairSync('ed25519'),recipient=crypto.generateKeyPairSync('x25519');
  agent.operatorPublicKey=operator.publicKey.export({format:'pem',type:'spki'});agent.recipientPublicKeys=[recipient.publicKey.export({format:'pem',type:'spki'})];reviewer.recipientPublicKeys=agent.recipientPublicKeys;
  const spec=draftJob(agent,descriptor(reviewer),{...options,now:Math.floor(Date.now()/1000),dataPolicy:'confidential',title:'Private pilot fixture'});
  const write=(name,value)=>{const file=path.join(dir,name);fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});return file;};
  const config=write('config.json',agent),specFile=write('job.json',spec),signer=write('operator.pem',operator.privateKey.export({format:'pem',type:'pkcs8'})),out=path.join(dir,'packet.json');
  await main(['packet','--config',config,'--spec',specFile,'--inputs',dir,'--signing-key',signer,'--mode','pilot','--out',out]);
  const serialized=fs.readFileSync(out,'utf8');assert.doesNotMatch(serialized,/Private pilot fixture|BEGIN PRIVATE KEY/);const envelope=JSON.parse(serialized),packet=validatePacket(JSON.parse(open(envelope,recipient.privateKey.export({format:'pem',type:'pkcs8'}),envelope.header.context)));
  assert.equal(core.digest(packet.specification),core.digest(spec));assert.equal(checkGrant(agent,spec,packet.grant).mode,'pilot');assert.equal(fs.statSync(out).mode&0o777,0o600);
  await assert.rejects(main(['packet','--config',config,'--spec',specFile,'--inputs',dir,'--signing-key',signer,'--mode','production','--out',path.join(dir,'production.json')]),/PREVIEW_PILOT_ONLY/);
  const legacy={...spec,profile:'computer-work/v2'};delete legacy.privacy;delete legacy.execution;delete legacy.permissions;legacy.dataPolicy='public';write('legacy.json',legacy);
  await assert.rejects(main(['packet','--config',config,'--spec',path.join(dir,'legacy.json'),'--inputs',dir,'--signing-key',signer,'--out',path.join(dir,'legacy.encrypted.json')]),/PREVIEW_V3_REQUIRED/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
