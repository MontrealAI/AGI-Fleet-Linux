import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ComputeWorker,createComputeServer,runCLI} from '../compute/server.mjs';
test('CLI Docker failure crosses the authenticated Compute HTTP boundary as an enum without raw stderr',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-cli-error-wire-')),node=path.join(dir,'node'),docker=path.join(dir,'docker'),openclaw=path.join(dir,'openclaw');
 fs.writeFileSync(node,`\x23!/bin/sh\nexec '${process.execPath}' "$@"\n`,{mode:0o700});fs.writeFileSync(docker,'\x23!/bin/sh\nexit 0\n',{mode:0o700});
 const secret='SYNTHETIC_PROVIDER_ACCOUNT_PRIVATE';
 fs.writeFileSync(openclaw,`\x23!/bin/sh\nprintf '%s\\n' 'Cannot connect to Docker daemon. ${secret}' >&2\nexit 1\n`,{mode:0o700});
 const c={role:'agent',home:dir,profileDir:dir,node,docker,openclaw,gatewayConfig:path.join(dir,'unused.json'),token:'a'.repeat(64),maxRuns24h:10,maxImages24h:1};
 const worker=new ComputeWorker(c,{verifyPolicy:false});worker.chat=async()=>runCLI(c,[],AbortSignal.timeout(5000));
 const server=createComputeServer(worker);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));c.port=server.address().port;
 const call=async()=>fetch(`http://127.0.0.1:${c.port}/v1/chat/completions`,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json','x-agi-kind':'test','x-agi-request-id':crypto.randomUUID()},body:JSON.stringify({messages:[{role:'system',content:'synthetic test'},{role:'user',content:'{}'}]})});
 try{
  const r=await call();assert.equal(r.status,503);const body=await r.text();assert.deepEqual(JSON.parse(body),{error:'COMPUTE_DOCKER_ENGINE_UNAVAILABLE'});assert.equal(body.includes(secret),false);assert.equal(worker.state.calls.length,1);assert.equal(worker.state.requests[0].status,'failed-or-uncertain');
  fs.writeFileSync(openclaw,`\x23!/bin/sh\nprintf '%s\\n' '${secret}' >&2\nexit 1\n`,{mode:0o700});const generic=await call();assert.deepEqual(await generic.json(),{error:'COMPUTE_INFERENCE_FAILED'});assert.equal(JSON.stringify(worker.state).includes(secret),false);assert.equal(worker.state.calls.length,2);
  worker.assertPolicy=()=>{throw Error('COMPUTE_RUNTIME_EXECUTABLE_CHANGED');};const drift=await call();assert.equal(drift.status,503);assert.deepEqual(await drift.json(),{error:'COMPUTE_RUNTIME_EXECUTABLE_CHANGED'});assert.equal(worker.state.calls.length,2);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
