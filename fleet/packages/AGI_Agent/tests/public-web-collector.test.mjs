import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectPublicWebQualification,publicWebProbeSources} from '../compute/public-web-qualification-collector.mjs';
const execute=promisify(execFile),compute=fileURLToPath(new URL('../compute/',import.meta.url));
function fixture(t,{baseline=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-observation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const calls=[];
 const active={docker:'/fixture/docker',browserContainerID:'b'.repeat(64),proxyContainerID:'c'.repeat(64),expiresAt:Date.now()+180000,plan:{proxyIPv4:'172.30.80.2',spec:{sessionDirectory:dir,sessionID:crypto.randomUUID(),runtimePolicyHash:'a'.repeat(64),browserImageID:'sha256:'+'d'.repeat(64),proxyImageID:'sha256:'+'e'.repeat(64)}}};
 const worker={c:{policyHash:'a'.repeat(64),signerUID:1001,publicWebPolicy:{mode:'commissioning'}},assertPolicy(){}};
 const dependencies={platform:'darwin',verify:async()=>({}),identity:()=>({sourceHashes:publicWebProbeSources(),executionFingerprint:'f'.repeat(64)}),run:async(executable,args,options)=>{calls.push({executable,args,options});const egress=args.includes('node')&&args.some(x=>x.includes('egress-probe/v1'));return {status:0,code:'OK',stdout:JSON.stringify(egress?{schema:'agi-public-web-egress-probe/v1',selectedIPv4:baseline?'1.1.1.1':null}:args.includes('python3')?{schema:'agi-public-web-browser-probe/v1',directPublicTCP:{connected:true}}:{schema:'agi-public-web-enforcement-probe/v1'})};}};
 const session={async execute(command){return command.action==='navigate'?{}:{url:'https://example.com/',title:'Example Domain',text:'actual fixture',headings:[{level:'h1',text:'Example Domain'}],grantHash:'9'.repeat(64),untrusted:true};}};
 return {worker,active,session,dependencies,calls,operatorPublicKey:'fixture-only',expectedGrantHash:'9'.repeat(64),allowLocalRuntime:true};
}
test('collector requires explicit local runtime authorization and an authorized native host before dispatch',async t=>{
 const f=fixture(t);await assert.rejects(collectPublicWebQualification({...f,allowLocalRuntime:false}),/APPROVAL_REQUIRED/);await assert.rejects(collectPublicWebQualification({...f,dependencies:{...f.dependencies,platform:'linux'}}),/PUBLIC_WEB_NATIVE_HOST_REQUIRED/);assert.equal(f.calls.length,0);
});
test('collector records observed failures without converting them into success, binds exact commands, and marks injection synthetic',async t=>{
 const f=fixture(t),result=await collectPublicWebQualification(f);assert.equal(result.synthetic,true);assert.equal(result.productionQualified,false);assert.equal(result.observations.length,4);assert.equal(result.observations.find(o=>o.id==='browser-negative').stdout.directPublicTCP.connected,true);assert.ok(result.observations.every(o=>/^[a-f0-9]{64}$/.test(o.commandSha256)));assert.ok(f.calls.every(c=>c.executable===f.active.docker&&c.args[0]==='exec'&&[f.active.browserContainerID,f.active.proxyContainerID].includes(c.args[1])&&c.options.timeoutMs<=20000));assert.equal(fs.statSync(path.join(f.active.plan.spec.sessionDirectory,'physical-observations.json')).mode&0o777,0o600);assert.equal(result.requiredExternalMeasurements.length,3);
});
test('missing paired positive control blocks direct negative probe instead of interpreting an unreachable target as isolation',async t=>{
 const f=fixture(t,{baseline:false}),result=await collectPublicWebQualification(f),negative=result.observations.find(o=>o.id==='browser-negative');assert.equal(negative.code,'POSITIVE_CONTROL_UNAVAILABLE');assert.equal(negative.exitCode,null);assert.equal(negative.stdout,null);assert.ok(!f.calls.some(c=>c.args.includes('python3')));
});
test('installed proxy enforcement probe actually exercises mixed DNS, rebinding, redirects and private literals on local fixtures',async()=>{
 const source=fs.readFileSync(path.join(compute,'public-web-probes/enforcement-control.mjs'),'utf8').replaceAll("from '/opt/agi/public-web-proxy.mjs'","from "+JSON.stringify(pathToFileURL(path.join(compute,'public-web-proxy.mjs')).href)).replaceAll("from '/opt/agi/public-web-policy.mjs'","from "+JSON.stringify(pathToFileURL(path.join(compute,'public-web-policy.mjs')).href));
 const {stdout}=await execute(process.execPath,['--input-type=module','--eval',source],{timeout:10000,maxBuffer:32768});const result=JSON.parse(stdout),byId=Object.fromEntries(result.tests.map(value=>[value.id,value]));
 assert.equal(result.syntheticDNS,true);assert.equal(result.syntheticRedirect,true);assert.equal(byId['mixed-dns'].response.status,403);assert.deepEqual(byId['mixed-dns'].connects,[]);assert.equal(byId['rebind-after-public'].first.status,200);assert.equal(byId['rebind-after-public'].second.status,403);assert.equal(byId['rebind-after-public'].lookups,2);assert.deepEqual(byId['rebind-after-public'].connects,['1.1.1.1']);assert.equal(byId['redirect-reauthorization'].first.status,302);assert.equal(byId['redirect-reauthorization'].second.status,403);assert.ok(byId['literal-private'].responses.every(value=>value.status===403));assert.deepEqual(byId['literal-private'].connects,[]);
});

test('collector can measure renewal in a sealed qualified profile but still requires current grant policy and explicit runtime permission',async t=>{
 const f=fixture(t);f.worker.c.publicWebPolicy.mode='qualified';
 await assert.rejects(collectPublicWebQualification({...f,allowLocalRuntime:false}),/APPROVAL_REQUIRED/);
 f.active.plan.spec.runtimePolicyHash='0'.repeat(64);await assert.rejects(collectPublicWebQualification(f),/COMMISSIONING_POLICY_REQUIRED/);assert.equal(f.calls.length,0);
 f.active.plan.spec.runtimePolicyHash=f.worker.c.policyHash;const observed=await collectPublicWebQualification(f);assert.equal(observed.policyHash,f.worker.c.policyHash);assert.equal(observed.synthetic,true);assert.equal(observed.productionQualified,false);
});
