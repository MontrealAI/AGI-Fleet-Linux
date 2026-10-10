import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {waitForDocker,ensureImage,safeDesktopReport,requireStandardComputeAccount} from '../compute/setup-support.mjs';
import {sanitizeDiagnostics} from '../src/control/system-preflight.mjs';
test('Docker startup wait is bounded and tolerates a slow daemon',async()=>{let time=0,n=0;const opts={now:()=>time,pause:async ms=>time+=ms,timeoutMs:5000,intervalMs:1000};const r=await waitForDocker(()=>++n===3,opts);assert.equal(r.attempts,3);assert.equal(time,2000);n=0;await assert.rejects(waitForDocker(()=>false,opts),/START_TIMEOUT/);assert.equal(time,7000);});
test('support diagnostics never traverse arbitrary records or preserve secret-shaped values',()=>{const canaries=['abandon '.repeat(23)+'art','0x'+'ab'.repeat(32),'Bearer '+ 'd'.repeat(64),'https://rpc.test/?key=secret','oauth-access-token','password123456'];const r=sanitizeDiagnostics({facts:{platform:'darwin',architecture:'arm64',uid:502,openclawVersion:'2026.9.5',failure:canaries.join(' '),token:canaries[2],privateKey:canaries[1],raw:canaries,role:'agent'},vault:canaries});const text=JSON.stringify(r);for(const c of canaries)assert.ok(!text.includes(c));assert.equal(r.facts.openclawVersion,'2026.9.5');assert.ok(!Object.hasOwn(r.facts,'failure'));assert.ok(!JSON.stringify(safeDesktopReport({detail:{stdout:canaries.join(' ')},passed:false})).includes('abandon'));});
test('cached image needs matching recipe label and immutable image ID',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-build-test-'));try{fs.writeFileSync(path.join(dir,'Dockerfile'),'FROM scratch');let label,builds=0;const id='sha256:'+'a'.repeat(64);const run=(exe,args)=>{if(args[0]==='build'){builds++;label=args[args.indexOf('--label')+1].split('=')[1];return {status:0};}return {status:0,stdout:JSON.stringify([{Id:id,Config:{Labels:{'ai.montreal.agi.recipe':label}}}])};};assert.equal(ensureImage(run,'docker',dir,'fixture'),id);assert.equal(ensureImage(run,'docker',dir,'fixture'),id);assert.equal(builds,1);fs.writeFileSync(path.join(dir,'Dockerfile'),'FROM changed');ensureImage(run,'docker',dir,'fixture');assert.equal(builds,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('diagnostics retain the observed Node version with its conventional v prefix',()=>{assert.equal(sanitizeDiagnostics({facts:{nodeVersion:'v24.19.0'}}).facts.nodeVersion,'24.19.0');});

test('macOS two-component versions remain exact in sanitized diagnostics',()=>{
 for(const osVersion of ['15.6','15.6.1','26.0'])assert.equal(sanitizeDiagnostics({facts:{osVersion}}).facts.osVersion,osVersion);
 for(const osVersion of ['15.6 secret','token 15.6.1','15'])assert.equal(sanitizeDiagnostics({facts:{osVersion}}).facts.osVersion,null);
});

test('Mac installer rejects unknown account membership as well as admin and root',()=>{
 for(const account of ['unknown','admin','root',undefined])assert.throws(()=>requireStandardComputeAccount({platform:'darwin',account}),/COMPUTE_STANDARD_ACCOUNT_REQUIRED/);
 assert.doesNotThrow(()=>requireStandardComputeAccount({platform:'darwin',account:'standard'}));
});
