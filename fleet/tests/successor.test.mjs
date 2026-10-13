import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from '../successor/fixture.mjs';
import {defaultMission} from '../successor/vendor/manager/site/assets/successor/missions.mjs';
import {createSystem,runCandidate,chooseCandidate,exportCapsule,inspectCapsule,restoreCapsule} from '../successor/vendor/manager/site/assets/successor/model.mjs';
import {prepareImprovement} from '../successor/vendor/manager/site/assets/successor/jobs.mjs';
import {builderArtifacts} from '../successor/vendor/manager/scripts/successor/build.mjs';
import {REQUEST,compileRequest,inspectRequest} from '../successor/project.mjs';
import {SuccessorController} from '../successor/controller.mjs';
import {exportSidecar,inspectSidecar,restoreSidecar} from '../successor/sidecar.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),source=builderArtifacts().sourceManifest;
async function request(kind='analyst'){
  let s=await createSystem(defaultMission(kind));const run=await runCandidate(s,'baseline',source.engineSha256);s=await chooseCandidate(run.state,run.candidate.id,'keep');
  return {schema:REQUEST,capsule:await exportCapsule(s,source),plan:await prepareImprovement(s,{budget:'100'})};
}
function context(req,a,n){return {schema:'successor-runtime-context/v1',runtimes:{agent:a.health().runtime,reviewer:n.health().runtime},inputs:req.plan.immutableInputs.map(f=>({name:f.name,uri:'https://example.org/'+f.name,sha256:f.sha256,maxBytes:Buffer.byteLength(f.content)})),deadline:Math.floor(Date.now()/1000)+3600,settlement:{chainId:31337,manager:'0x1111111111111111111111111111111111111111',recovery:'Engineering fixture; no funding. Preserve original claims.'},budget:{maxAgentSeconds:60,maxReviewSeconds:60,maxAgentCostUSDC:'5',maxReviewCostUSDC:'3'},publicConsent:true};}
async function run(bridge,input){const p=await bridge.prepare(input,'test-principal');const started=await bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'test-principal');await bridge.c.studio.task;return {p,started};}

for(const kind of ['analyst','website'])test(`SUCCESSOR ${kind}: Manager compiler -> Agent -> real ComputeWorker -> Node -> choose -> fresh restore -> rerun`,async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(kind),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}
    const before=(await inspectCapsule(req.capsule)).capsule.payload.state;
    const ar=await run(a.bridge,{request:req,context:ctx}),actual=await a.bridge.result(ar.p.key);
    assert.equal(actual.receipt.status,'checked',JSON.stringify(actual.receipt.error));assert.equal(a.worker.state.calls.length,2);assert.equal(a.worker.state.requests.every(r=>r.status==='complete'),true);
    const nr=await run(n.bridge,{handoff:actual.handoff}),reviewed=await n.bridge.result(nr.p.key);assert.equal(reviewed.receipt.status,'checked');assert.equal(n.worker.state.calls.length,1);
    const result=await a.bridge.result(ar.p.key,reviewed.receipt);assert.equal(result.outcome,'accepted');assert.equal(result.comparison.outcome,'improvement');assert.equal(result.selected,before.active);
    let state=(await inspectCapsule(result.capsule)).capsule.payload.state;state=await chooseCandidate(state,result.proposed,'replace');
    const selected=await exportCapsule(state,source),restored=await restoreCapsule(await inspectCapsule(selected),true),rerun=await runCandidate(restored,'improved',source.engineSha256);assert.equal(rerun.candidate.id,result.proposed);assert.equal(restored.authority,'none');
    const rolled=await chooseCandidate(restored,before.active,'rollback');assert.equal(rolled.active,before.active);
    const dest=path.join(a.dir,'portable');await exportSidecar(dest,selected,actual.handoff,reviewed.receipt,a.api);assert.ok(inspectSidecar(dest).totalBytes>0);
    assert.equal((await restoreSidecar(dest,path.join(a.dir,'restored'),false)).requiresConfirmation,true);await restoreSidecar(dest,path.join(a.dir,'restored'),true);
    assert.equal(a.controller.vault.unlocked,true);assert.equal(result.payment,'unfunded');assert.equal(result.independentController,'UNVERIFIED');
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR rejected real delivery retains incumbent and returns criterion-bound repair feedback',async()=>{
  const a=await fixture(root,'agent',{bad:true}),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}
    const ar=await run(a.bridge,{request:req,context:ctx}),delivery=await a.bridge.result(ar.p.key),nr=await run(n.bridge,{handoff:delivery.handoff}),reviewed=await n.bridge.result(nr.p.key);assert.equal(reviewed.receipt.status,'needs-review');
    const rejected=await a.bridge.result(ar.p.key,reviewed.receipt);assert.equal(rejected.outcome,'rejected');assert.equal(rejected.capsule,req.capsule);assert.equal(rejected.proposed,null);
    const revision=n.controller.studio.export(nr.started.run.id,'revision');assert.equal(revision.handoff.deliveryHash,delivery.handoff.deliveryHash);assert.equal(revision.review.checks[0].status,'fail');
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR refuses changed inputs, credentials, private scope, expiry and unavailable runtime before compute',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const change of [x=>x.inputs[0].sha256='0'.repeat(64),x=>x.deadline=1,x=>x.runtimes.agent.scope='dedicated-account',x=>x.runtimes.agent.capabilities=[]]){const bad=structuredClone(ctx);change(bad);await assert.rejects(a.bridge.prepare({request:req,context:bad},'principal'));}
    await assert.rejects(inspectRequest({...req,secret:'never allowed'}));const changed=structuredClone(req);changed.plan.goal+='tamper';await assert.rejects(compileRequest(changed,ctx));assert.equal(a.worker.state.calls.length,0);
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR grants bind session, scope, expiry, exact runtime, confirmation, replay and durable attempts',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));
    let p=await a.bridge.prepare({request:req,context:ctx},'alice');await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'mallory'),/TICKET_INVALID/);
    p=await a.bridge.prepare({request:req,context:ctx},'alice');await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:false},'alice'),/CONFIRM/);a.bridge.revoke();await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'alice'),/TICKET_INVALID/);
    p=await a.bridge.prepare({request:req,context:ctx},'alice');a.advance(61000);await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'alice'),/EXPIRED/);
    p=await a.bridge.prepare({request:req,context:ctx},'alice');await a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'alice');await a.controller.studio.task;
    await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'alice'),/TICKET_INVALID/);
    const reopened=new SuccessorController(a.controller,'agent',a.api);await assert.rejects(reopened.prepare({request:req,context:ctx},'alice'),/ALREADY_ATTEMPTED/);assert.equal(a.worker.state.calls.length,2);
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR installed routes retain Host, Origin, session, CSRF and strict JSON boundaries',async()=>{
  const a=await fixture(root);let server;try{
    const {createControlServer}=await import('../packages/AGI_Agent/src/control/server.mjs');server=await createControlServer(a.controller,{port:0});const url=new URL(server.url),origin=url.origin;
    assert.equal((await fetch(origin+'/api/successor')).status,401);
    const session=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
    const post=(body,patch={})=>fetch(origin+'/api/successor/execute',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','x-agi-csrf':csrf,...patch},body});
    for(const patch of [{Origin:'https://montrealai.github.io'},{'x-agi-csrf':'other'}]){const response=await post('{}',patch);assert.ok(response.status>=400);assert.match(JSON.stringify(await response.json()),/HOST|ORIGIN|CSRF/);}
    const http=await import('node:http');const hostile=await new Promise((resolve,reject)=>{const req=http.request(origin+'/api/successor',{headers:{Host:'attacker.invalid',Cookie:cookie}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end();});assert.equal(hostile.status,403);assert.match(hostile.text,/HOST/);
    const duplicate=await post('{"confirm":false,"confirm":true}');assert.equal(duplicate.status,400);assert.match(JSON.stringify(await duplicate.json()),/REQUEST_JSON_INVALID/);
    assert.equal(a.worker.state.calls.length,0);
  }finally{await server?.close();await a.close();}
});

test('SUCCESSOR sidecars stream maximum files and reject missing, traversal, aliases, overflow and extra content',async()=>{
  const {createHash}=await import('node:crypto'),{canonical}=await import('../successor/vendor/manager/site/assets/successor/safe.mjs');const a=await fixture(root);try{
    const dir=path.join(a.dir,'large');fs.mkdirSync(dir);const name=path.join(dir,'artifact.bin');fs.writeFileSync(name,Buffer.alloc(96*1024*1024,42));const bytes=fs.readFileSync(name),digest=createHash('sha256').update(bytes).digest('hex');
    const body={schema:'agi-fleet/successor-sidecar/v1',files:[{path:'artifact.bin',bytes:bytes.length,sha256:digest,mediaType:'application/octet-stream',role:'deliverable'}],totalBytes:bytes.length,walletBackup:'excluded',authority:'none'};
    const save=v=>fs.writeFileSync(path.join(dir,'manifest.json'),canonical({...v,sha256:createHash('sha256').update(canonical(v)).digest('hex')}));save(body);assert.equal(inspectSidecar(dir).totalBytes,96*1024*1024);
    for(const change of [v=>v.files[0].path='../outside',v=>v.files.push({...v.files[0],path:'ARTIFACT.bin'}),v=>v.files[0].bytes++,v=>v.totalBytes++]){const bad=structuredClone(body);change(bad);save(bad);assert.throws(()=>inspectSidecar(dir));}save(body);
    fs.renameSync(name,name+'.missing');assert.throws(()=>inspectSidecar(dir));fs.symlinkSync(name+'.missing',name);assert.throws(()=>inspectSidecar(dir));fs.unlinkSync(name);fs.renameSync(name+'.missing',name);
    fs.writeFileSync(path.join(dir,'unexpected.txt'),'extra');assert.throws(()=>inspectSidecar(dir),/EXTRA/);
  }finally{await a.close();}
});

test('SUCCESSOR sidecar disk-full failure leaves original and no completed destination',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),dest=path.join(a.dir,'disk-full');
    const original=fs.writeFileSync;fs.writeFileSync=(file,...args)=>{if(String(file).includes('.partial-'))throw Object.assign(Error('injected full disk'),{code:'ENOSPC'});return original(file,...args);};
    try{await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,result.receipt,a.api),/full disk/);}finally{fs.writeFileSync=original;}
    assert.equal(fs.existsSync(dest),false);assert.equal(fs.readdirSync(a.dir).some(n=>n.startsWith('disk-full')),false);assert.equal((await inspectRequest(req)).request.capsule,req.capsule);
  }finally{await a.close();await n.close();}
});
