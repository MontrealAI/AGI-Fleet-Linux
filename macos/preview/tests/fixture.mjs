import assert from 'node:assert/strict';
import {after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Import only the exact materialized Mac preview, never workstation/engine.
export const repository = fileURLToPath(new URL('../../../', import.meta.url));
let root = process.env.AGI_MAC_PREVIEW_FIXTURE;
if (root) {
  assert.ok(path.isAbsolute(root), 'AGI_MAC_PREVIEW_FIXTURE must be absolute');
} else {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agi-mac-preview-source-'));
  after(() => fs.rmSync(dir, {recursive:true, force:true}));
  root = path.join(dir, 'candidate');
  const result = spawnSync(process.env.PYTHON ?? 'python3', [path.join(repository, 'macos/preview/materialize.py'), '--output', root], {encoding:'utf8', timeout:180000, maxBuffer:4*1024*1024});
  assert.equal(result.status, 0, 'Mac preview materialization failed: ' + (result.stderr || result.stdout || result.error));
}
export const previewRoot = fs.realpathSync(root);
assert.ok(fs.statSync(path.join(previewRoot, 'PREVIEW-NOT-A-RELEASE.json')).isFile(), 'Tests require an explicit source preview, not an inherited release');
export const load = file => import(pathToFileURL(path.join(previewRoot, 'workforce', file)));
export const core = await load('core.mjs');
export const runner = await load('runner.mjs');
export const authority = await load('authority.mjs');
export const draft = await load('job-draft.mjs');
export const cli = await load('cli.mjs');
export const specCore = (await load('core/computer-work.cjs')).default;

export function workspace(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agi-mac-preview-test-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}
export const publicKey = key => key.publicKey.export({format:'pem', type:'spki'});
export const privateKey = key => key.privateKey.export({format:'pem', type:'pkcs8'});

export function fixture(t) {
  const dir = workspace(t), operator = crypto.generateKeyPairSync('ed25519'), recipient = crypto.generateKeyPairSync('x25519');
  const model = 'openai/test-model';
  const gatewayConfig = {
    gateway:{bind:'loopback', port:29501, auth:{mode:'token', token:'a'.repeat(64)}, http:{endpoints:{chatCompletions:{enabled:true}}}},
    agents:{entries:{'agi-native-planner':{model:{primary:model, fallbacks:[]}, tools:{deny:['*']}}}},
  };
  const c = {
    schema:'agi-native-config/v1', role:'agent', dataDir:path.join(dir,'agent-operations'), identityDir:path.join(dir,'agent-identity'),
    gatewayURL:'http://127.0.0.1:29501', gatewayTokenFile:path.join(dir,'token.txt'), gatewayConfigFile:path.join(dir,'gateway.json'),
    gatewayConfigSha256:core.digest(gatewayConfig), plannerAgent:'agi-native-planner', model, openclawVersion:'2026.9.5',
    nodeId:'paired-mac-agent', provider:'cua-computer', installationSha256:'b'.repeat(64), appBundlePath:'/Applications/OpenClaw.app',
    resources:['dedicated-account:synthetic-mac-agent'], operatorPublicKey:publicKey(operator), recipientPublicKeys:[publicKey(recipient)],
    limits:{maxActions:12, maxModelCalls:8, maxSeconds:60, maxRuns24h:20},
    costPolicy:{modelCallReserveUSDC:'0.01', actionReserveUSDC:'0.001', fixedRunReserveUSDC:'0.10', maxDailyReserveUSDC:'20'},
    qualificationPolicyFile:null, qualificationEvidenceFile:null, revocationFile:path.join(dir,'authority.json'), receiptPublicKey:null, applications:[],
  };
  core.atomic(c.gatewayTokenFile, gatewayConfig.gateway.auth.token);
  core.atomic(c.gatewayConfigFile, gatewayConfig);
  core.privateDir(c.dataDir);
  c.receiptPublicKey = crypto.createPublicKey(core.createIdentity(c.identityDir).privateKey).export({format:'pem', type:'spki'});
  const reviewer = {...c, role:'reviewer', nodeId:'paired-mac-reviewer', dataDir:path.join(dir,'reviewer-operations'), identityDir:path.join(dir,'reviewer-identity'), resources:['dedicated-account:synthetic-mac-reviewer']};
  const now = Math.floor(Date.now()/1000);
  const body = {schema:'agi-native-authority/v1', nodeId:c.nodeId, role:c.role, sequence:1, issuedAt:now-1, expiresAt:now+3600, disabled:false, revokedGrantNonces:[]};
  const writeAuthority = (value=body, signer=operator.privateKey) => core.atomic(c.revocationFile, authority.signAuthority(value, signer));
  writeAuthority();
  const options = {authority:'whole-account', chainId:31337, manager:'0x'+'1'.repeat(40), now, title:'Synthetic Mac preview test', prompt:'Save a synthetic result and inspect its exact bytes.', output:'result.json'};
  const spec = draft.draftJob(c, draft.descriptor(reviewer), options);
  const packet = {schema:'agi-native-job/v1', specification:spec, inputs:[], delivery:null, grant:runner.signGrant(runner.grantBody(c,spec),operator.privateKey)};
  const resign = (mode='pilot') => {packet.grant = runner.signGrant(runner.grantBody(c,spec,{mode}),operator.privateKey);};
  return {dir,c,reviewer,spec,packet,operator,recipient,now,body,options,writeAuthority,resign};
}

export function fakeGateway(c, {snapshot=()=>{}, plan=()=>({answer:{declined:true},usage:{total_tokens:1}}), mutate=()=>{}}={}) {
  const calls = {connect:0, screenshot:0, model:0, mutation:0, closeExecution:0};
  const gateway = {
    hello:{server:{version:c.openclawVersion}},
    connect:async()=>{calls.connect++;}, close:()=>{},
    node:async()=>({nodeId:c.nodeId, platform:'macos', connected:true, commands:['screen.snapshot','computer.act'], computerUse:{contractVersion:2, provider:{id:c.provider,generation:'mac-test-generation'}, actions:['screenshot','type']}}),
    invoke:async(command,args)=>{
      if(command==='screen.snapshot') {calls.screenshot++; await snapshot(); return {displayFrameId:'synthetic-frame-'+calls.screenshot,screenIndex:0,width:120,height:90,format:'png',base64:'AA=='};}
      if(args.action==='__close_execution') {calls.closeExecution++; return {ok:true};}
      calls.mutation++; await mutate(args); return {ok:true};
    },
    plan:async(messages)=>{calls.model++; return plan(messages);},
  };
  return {gateway,calls};
}
