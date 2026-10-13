import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture} from '../successor/fixture.mjs';
import {defaultMission} from '../successor/vendor/manager/site/assets/successor/missions.mjs';
import {createSystem,runCandidate,chooseCandidate,recordPlan,exportCapsule,inspectCapsule,restoreCapsule} from '../successor/vendor/manager/site/assets/successor/model.mjs';
import {prepareImprovement} from '../successor/vendor/manager/site/assets/successor/jobs.mjs';
import {builderArtifacts} from '../successor/vendor/manager/scripts/successor/build.mjs';
import {REQUEST,compileRequest,inspectRequest} from '../successor/project.mjs';
import {SuccessorController} from '../successor/controller.mjs';
import {exportSidecar,inspectSidecar,restoreSidecar} from '../successor/sidecar.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),source=builderArtifacts().sourceManifest;
async function request(kind='analyst'){
  let s=await createSystem(defaultMission(kind));const run=await runCandidate(s,'baseline',source.engineSha256);s=await chooseCandidate(run.state,run.candidate.id,'keep');
  const plan=await prepareImprovement(s,{budget:'100'});s=await recordPlan(s,plan);
  return {schema:REQUEST,capsule:await exportCapsule(s,source),plan};
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
    const cli=(...args)=>spawnSync(process.execPath,[path.join(root,'successor/cli.mjs'),...args],{cwd:a.dir,encoding:'utf8',timeout:30000});
    const initial=await runCandidate(await createSystem(before.mission),'baseline',source.engineSha256),unplanned=await exportCapsule(await chooseCandidate(initial.state,initial.candidate.id,'keep'),source);
    for(const [name,value] of Object.entries({'input-capsule.json':unplanned,'plan.json':req.plan,'agent.json':actual,'node.json':reviewed}))fs.writeFileSync(path.join(a.dir,name),typeof value==='string'?value:JSON.stringify(value));
    let terminal=cli('request','input-capsule.json','plan.json','request.json');assert.equal(terminal.status,0,terminal.stderr);
    terminal=cli('check-result','request.json','agent.json','node.json','checked-capsule.json');assert.equal(terminal.status,0,terminal.stderr);assert.equal(JSON.parse(terminal.stdout).outcome,'accepted');assert.equal(fs.readFileSync(path.join(a.dir,'checked-capsule.json'),'utf8'),result.capsule);
    terminal=cli('compare','checked-capsule.json',result.proposed);assert.equal(terminal.status,0,terminal.stderr);assert.equal(JSON.parse(terminal.stdout).outcome,'improvement');
    terminal=cli('check-result','request.json','agent.json','agent.json','invalid-capsule.json');assert.equal(terminal.status,1);assert.match(terminal.stderr,/FLEET_RECEIPT_SCHEMA/);assert.equal(fs.existsSync(path.join(a.dir,'invalid-capsule.json')),false);
    let state=(await inspectCapsule(result.capsule)).capsule.payload.state;state=await chooseCandidate(state,result.proposed,'replace');
    const selected=await exportCapsule(state,source),restored=await restoreCapsule(await inspectCapsule(selected),true),rerun=await runCandidate(restored,'improved',source.engineSha256);assert.equal(rerun.candidate.id,result.proposed);assert.equal(restored.authority,'none');
    const rolled=await chooseCandidate(restored,before.active,'rollback');assert.equal(rolled.active,before.active);
    const dest=path.join(a.dir,'portable');await exportSidecar(dest,selected,actual.handoff,reviewed.receipt,a.api);assert.ok((await inspectSidecar(dest)).totalBytes>0);
    assert.equal((await restoreSidecar(dest,path.join(a.dir,'restored'),false)).requiresConfirmation,true);await restoreSidecar(dest,path.join(a.dir,'restored'),true);
    assert.equal(a.controller.vault.unlocked,true);assert.equal(result.payment,'unfunded');assert.equal(result.independentController,'UNVERIFIED');
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR rejected real delivery retains incumbent and returns criterion-bound repair feedback',async()=>{
  const a=await fixture(root,'agent',{bad:true}),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}
    const ar=await run(a.bridge,{request:req,context:ctx}),delivery=await a.bridge.result(ar.p.key),nr=await run(n.bridge,{handoff:delivery.handoff}),reviewed=await n.bridge.result(nr.p.key);assert.equal(reviewed.receipt.status,'needs-review');
    const rejected=await a.bridge.result(ar.p.key,reviewed.receipt);assert.equal(rejected.outcome,'rejected');assert.equal(rejected.capsule,req.capsule);assert.equal(rejected.proposed,null);
    const revision=n.controller.studio.export(nr.started.run.id,'revision');assert.equal(revision.handoff.deliveryHash,delivery.handoff.deliveryHash);assert.equal(revision.review.checks[0].status,'fail');
    const rejectedPack=path.join(a.dir,'rejected-pack');await exportSidecar(rejectedPack,rejected.capsule,delivery.handoff,reviewed.receipt,a.api);assert.ok((await inspectSidecar(rejectedPack)).files.length>3);
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

test('SUCCESSOR sidecars retain a maximum Studio file and reject missing, traversal, aliases, overflow and extra content',async()=>{
  const {createHash}=await import('node:crypto'),{canonical}=await import('../successor/vendor/manager/site/assets/successor/safe.mjs');const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));const ar=await run(a.bridge,{request:req,context:ctx}),actual=await a.bridge.result(ar.p.key);
    const artifactName='a/b/c/d/e/f/g/h/i/j/k/artifact.bin';
    const mission=defaultMission('custom');mission.outputs=artifactName;let state=await createSystem(mission);const plan=await prepareImprovement(state,{budget:'100'});state=await recordPlan(state,plan);const capsule=await exportCapsule(state,source);
    const spec=structuredClone(actual.handoff.specification);spec.title=plan.draft.fields.title.slice(0,160);spec.prompt=plan.goal;spec.coordination.parentSpecSha256=plan.commitment;spec.inputs[0].sha256=plan.immutableInputs[0].sha256;spec.inputs[0].maxBytes=Buffer.byteLength(plan.immutableInputs[0].content);spec.outputs=[{name:artifactName,mediaType:'application/octet-stream',maxBytes:32*1024*1024,requirement:'Retain exact binary bytes.'}];for(const c of spec.criteria)c.evidence=[artifactName];
    const handoff=a.api.makeHandoff(spec,a.api.buildBundle(spec,new Map([[artifactName,Buffer.alloc(32*1024*1024,42)]])));
    const receipt={...actual.receipt,specification:spec,specHash:handoff.specHash,deliveryHash:handoff.deliveryHash,title:spec.title,criteria:spec.criteria,files:JSON.parse(handoff.delivery).files.map(({content,...meta})=>meta)};
    const dir=path.join(a.dir,'large'),name=path.join(dir,'artifacts/'+artifactName);await exportSidecar(dir,capsule,handoff,receipt,a.api);
    const {sha256,...body}=await inspectSidecar(dir);assert.ok(body.totalBytes>70*1024*1024);
    const save=v=>fs.writeFileSync(path.join(dir,'manifest.json'),canonical({...v,sha256:createHash('sha256').update(canonical(v)).digest('hex')}));
    for(const change of [v=>v.files[0].path='../outside',v=>v.files.push({...v.files.at(-1),path:'artifacts/'+artifactName.toUpperCase()}),v=>v.files[0].bytes++,v=>v.files[0].bytes=96*1024*1024+1,v=>v.totalBytes++]){const bad=structuredClone(body);change(bad);save(bad);await assert.rejects(inspectSidecar(dir));}save(body);
    fs.renameSync(name,name+'.missing');await assert.rejects(inspectSidecar(dir));fs.symlinkSync(name+'.missing',name);await assert.rejects(inspectSidecar(dir));fs.unlinkSync(name);fs.renameSync(name+'.missing',name);
    fs.writeFileSync(path.join(dir,'unexpected.txt'),'extra');await assert.rejects(inspectSidecar(dir),/EXTRA/);
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR sidecar disk-full failure leaves original and no completed destination',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),dest=path.join(a.dir,'disk-full');
    const original=fs.writeFileSync;fs.writeFileSync=(file,...args)=>{if(String(file).includes('.partial-'))throw Object.assign(Error('injected full disk'),{code:'ENOSPC'});return original(file,...args);};
    try{await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,result.receipt,a.api),/full disk/);}finally{fs.writeFileSync=original;}
    assert.equal(fs.existsSync(dest),false);assert.equal(fs.readdirSync(a.dir).some(n=>n.startsWith('disk-full')),false);assert.equal((await inspectRequest(req)).request.capsule,req.capsule);
  }finally{await a.close();await n.close();}
});


test('SUCCESSOR sidecars reject mixed or altered receipts before writing and during restore inspection',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),dest=path.join(a.dir,'mixed-receipt');
    for(const change of [r=>r.schema='unknown',r=>r.role='employer',r=>r.specHash='a'.repeat(64),r=>r.deliveryHash='b'.repeat(64),r=>r.specification.prompt+='altered',r=>r.independent=true]){
      const receipt=structuredClone(result.receipt);change(receipt);await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,receipt,a.api),/RECEIPT/);assert.equal(fs.existsSync(dest),false);
    }
    await exportSidecar(dest,req.capsule,result.handoff,result.receipt,a.api);
    const {createHash}=await import('node:crypto'),{canonical}=await import('../successor/vendor/manager/site/assets/successor/safe.mjs'),hash=b=>createHash('sha256').update(b).digest('hex');
    const bad={...result.receipt,deliveryHash:'c'.repeat(64)},raw=canonical(bad);fs.writeFileSync(path.join(dest,'receipt.json'),raw);
    const manifest=JSON.parse(fs.readFileSync(path.join(dest,'manifest.json'))),entry=manifest.files.find(f=>f.path==='receipt.json');manifest.totalBytes+=Buffer.byteLength(raw)-entry.bytes;entry.bytes=Buffer.byteLength(raw);entry.sha256=hash(raw);const {sha256,...body}=manifest;manifest.sha256=hash(canonical(body));fs.writeFileSync(path.join(dest,'manifest.json'),canonical(manifest));
    await assert.rejects(inspectSidecar(dest),/RECEIPT_BINDING/);await assert.rejects(restoreSidecar(dest,path.join(a.dir,'unsafe-restore'),true),/RECEIPT_BINDING/);assert.equal(fs.existsSync(path.join(a.dir,'unsafe-restore')),false);
    const pristine=path.join(a.dir,'pristine');await exportSidecar(pristine,req.capsule,result.handoff,result.receipt,a.api);
    const artifact=(await inspectSidecar(pristine)).files.find(f=>f.role==='deliverable').path;
    const changes=[pack=>['handoff.json','receipt.json'].forEach(f=>fs.unlinkSync(path.join(pack,f))),...['capsule.json','handoff.json','receipt.json',artifact].map(f=>pack=>fs.unlinkSync(path.join(pack,f))),pack=>fs.appendFileSync(path.join(pack,artifact),'changed')];
    for(let i=0;i<changes.length;i++){
      const pack=path.join(a.dir,'stripped-'+i);fs.cpSync(pristine,pack,{recursive:true});changes[i](pack);
      const {sha256,...body}=JSON.parse(fs.readFileSync(path.join(pack,'manifest.json')));body.files=body.files.filter(f=>fs.existsSync(path.join(pack,f.path))).map(f=>{const bytes=fs.readFileSync(path.join(pack,f.path));return {...f,bytes:bytes.length,sha256:hash(bytes)};});body.totalBytes=body.files.reduce((n,f)=>n+f.bytes,0);fs.writeFileSync(path.join(pack,'manifest.json'),canonical({...body,sha256:hash(canonical(body))}));
      await assert.rejects(inspectSidecar(pack),/SIDECAR_CORE|SIDECAR_DELIVERY/);await assert.rejects(restoreSidecar(pack,path.join(a.dir,'stripped-restore-'+i),true),/SIDECAR_CORE|SIDECAR_DELIVERY/);
    }
    const other=await request('website'),mixed=path.join(a.dir,'mixed-project');await assert.rejects(exportSidecar(mixed,other.capsule,result.handoff,result.receipt,a.api),/SIDECAR_PROJECT_PLAN/);assert.equal(fs.existsSync(mixed),false);
    const unrelatedState=await createSystem(defaultMission('analyst')),unrelated=await exportCapsule(unrelatedState,source);await assert.rejects(exportSidecar(mixed,unrelated,result.handoff,result.receipt,a.api),/SIDECAR_PROJECT_PLAN/);
    const pack=path.join(a.dir,'swapped-project');fs.cpSync(pristine,pack,{recursive:true});fs.writeFileSync(path.join(pack,'capsule.json'),other.capsule);
    const {sha256:priorHash,...mixedBody}=JSON.parse(fs.readFileSync(path.join(pack,'manifest.json')));const capsuleRow=mixedBody.files.find(f=>f.path==='capsule.json');capsuleRow.bytes=Buffer.byteLength(other.capsule);capsuleRow.sha256=hash(other.capsule);mixedBody.totalBytes=mixedBody.files.reduce((n,f)=>n+f.bytes,0);fs.writeFileSync(path.join(pack,'manifest.json'),canonical({...mixedBody,sha256:hash(canonical(mixedBody))}));
    await assert.rejects(inspectSidecar(pack),/SIDECAR_PROJECT_PLAN/);await assert.rejects(restoreSidecar(pack,path.join(a.dir,'swapped-project-restored'),true),/SIDECAR_PROJECT_PLAN/);
    const modified=structuredClone(result.handoff.specification);modified.inputs[0].sha256='f'.repeat(64);const files=a.api.validateBundle(result.handoff.specification,Buffer.from(result.handoff.delivery)).files;
    const changed=a.api.makeHandoff(modified,a.api.buildBundle(modified,files)),changedReceipt={...result.receipt,specification:modified,specHash:changed.specHash,deliveryHash:changed.deliveryHash};await assert.rejects(exportSidecar(mixed,req.capsule,changed,changedReceipt,a.api),/SIDECAR_PROJECT_INPUT/);
    files.set('method.json',Buffer.from('{}'));const altered=a.api.makeHandoff(result.handoff.specification,a.api.buildBundle(result.handoff.specification,files)),alteredReceipt={...result.receipt,deliveryHash:altered.deliveryHash};await assert.rejects(exportSidecar(mixed,req.capsule,altered,alteredReceipt,a.api),/SIDECAR_PROJECT_ARTIFACTS/);
    const changedPack=path.join(a.dir,'changed-method');fs.cpSync(pristine,changedPack,{recursive:true});fs.writeFileSync(path.join(changedPack,'handoff.json'),canonical(altered));fs.writeFileSync(path.join(changedPack,'receipt.json'),canonical(alteredReceipt));fs.writeFileSync(path.join(changedPack,'artifacts/method.json'),'{}');
    const {sha256:oldHash,...changedBody}=JSON.parse(fs.readFileSync(path.join(changedPack,'manifest.json')));changedBody.files=changedBody.files.map(f=>{const bytes=fs.readFileSync(path.join(changedPack,f.path));return {...f,bytes:bytes.length,sha256:hash(bytes)};});changedBody.totalBytes=changedBody.files.reduce((n,f)=>n+f.bytes,0);fs.writeFileSync(path.join(changedPack,'manifest.json'),canonical({...changedBody,sha256:hash(canonical(changedBody))}));
    await assert.rejects(inspectSidecar(changedPack),/SIDECAR_PROJECT_ARTIFACTS/);await assert.rejects(restoreSidecar(changedPack,path.join(a.dir,'changed-method-restore'),true),/SIDECAR_PROJECT_ARTIFACTS/);
  }finally{await a.close();await n.close();}
});
