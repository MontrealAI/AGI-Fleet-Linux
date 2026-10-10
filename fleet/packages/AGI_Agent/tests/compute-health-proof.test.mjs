import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {ComputeWorker,createComputeServer} from '../compute/server.mjs';
test('health and observation exports require authenticated exact-host requests and distinguish inference from tool proof',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-health-proof-')),id=crypto.randomUUID(),token='a'.repeat(64),c={profileDir:dir,token,role:'agent',policyHash:'b'.repeat(64),maxRuns24h:3,maxImages24h:1};
 const worker=new ComputeWorker(c,{verifyPolicy:false,fetchImpl:async()=>Response.json({data:[{id:'openclaw/agi-checker'}]})}),server=createComputeServer(worker);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));c.port=server.address().port;const url=`http://127.0.0.1:${c.port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const headers={Authorization:'Bearer '+token};assert.equal((await fetch(url+'/health')).status,401);assert.equal((await fetch(url+'/health',{headers:{...headers,Origin:'http://example.com'}})).status,401);
 let h=await (await fetch(url+'/health',{headers})).json();assert.equal(h.dependencyMode,'test-double');assert.equal(h.qualification.tools.status,'NOT_TESTED');assert.equal(h.qualification.browser.status,'BLOCKED');assert.equal(h.qualification.production.status,'NOT_TESTED');
 worker.state.requests.push({id,at:123,kind:'generate',status:'complete',policyHash:c.policyHash});assert.equal((await fetch(url+'/commissioning/requests/'+id,{headers})).status,404);
 const folder=path.join(dir,'commissioning-observations');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify({status:'BLOCKED',code:'FIXTURE_NOT_LIVE'}));
 assert.equal((await fetch(url+'/commissioning/requests/'+id)).status,401);let r=await fetch(url+'/commissioning/requests/'+id,{headers});assert.equal(r.status,200);const body=await r.json();assert.equal(body.observation.status,'BLOCKED');assert.deepEqual(body.journal.requests.map(x=>x.id),[id]);assert.equal(body.journal.requests.length,1);assert.deepEqual(body.journal.calls,[]);worker.state.calls.push(123);assert.deepEqual((await (await fetch(url+'/commissioning/requests/'+id,{headers})).json()).journal.calls,[123]);
 fs.unlinkSync(path.join(folder,id+'.json'));fs.symlinkSync(path.join(dir,'outside.json'),path.join(folder,id+'.json'));fs.writeFileSync(path.join(dir,'outside.json'),'{}');assert.equal((await fetch(url+'/commissioning/requests/'+id,{headers})).status,404);
 worker.assertPolicy=()=>{throw Error('COMPUTE_SETTINGS_CHANGED');};h=await (await fetch(url+'/health',{headers})).json();assert.equal(h.policyCurrent,false);assert.equal(h.stopped,true);assert.equal(h.policyFailure,'COMPUTE_SETTINGS_CHANGED');
});
