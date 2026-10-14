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
import {REQUEST,compileRequest,inspectRequest,prepareCustomProject,computer} from '../successor/project.mjs';
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
    const {compiled}=await compileRequest(req,ctx),mission=defaultMission('custom'),missionPath=path.join(a.dir,'private-mission.json');
    fs.writeFileSync(missionPath,JSON.stringify(mission));
    const privateScopes=[s=>{s.dataPolicy='scoped';for(const r of ['agent','reviewer'])s.authority[r].scope='dedicated-account';},s=>s.authority.agent.scope='dedicated-account',s=>s.authority.reviewer.scope='dedicated-account'];
    for(let i=0;i<privateScopes.length;i++){
      const spec=structuredClone(compiled.spec);privateScopes[i](spec);assert.doesNotThrow(()=>computer.validateComputerWork(spec),'The broader contract remains valid for its separate workflow.');
      await assert.rejects(prepareCustomProject(mission,spec,'100'),/FLEET_CUSTOM_PUBLIC_REQUIRED/);
      const input=path.join(a.dir,'private-spec-'+i+'.json'),output=path.join(a.dir,'private-project-'+i),raw=JSON.stringify(spec);fs.writeFileSync(input,raw);
      const terminal=spawnSync(process.execPath,[path.join(root,'successor/cli.mjs'),'prepare-custom',missionPath,input,'100',output],{encoding:'utf8',timeout:30000});
      assert.equal(terminal.status,1);assert.match(terminal.stderr,/FLEET_CUSTOM_PUBLIC_REQUIRED/);assert.equal(fs.existsSync(output),false);assert.equal(fs.readdirSync(a.dir).some(name=>name.startsWith('private-project-'+i+'.partial-')),false);
      assert.equal(fs.readFileSync(input,'utf8'),raw);assert.deepEqual(JSON.parse(fs.readFileSync(missionPath)),mission);
    }
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
    const store=path.join(a.controller.home,'successor-execution');fs.rmdirSync(store);
    const {createControlServer}=await import('../packages/AGI_Agent/src/control/server.mjs');server=await createControlServer(a.controller,{port:0});const url=new URL(server.url),origin=url.origin;
    assert.equal(fs.existsSync(store),false);
    assert.equal((await fetch(origin+'/api/successor')).status,401);
    const session=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
    const post=(body,patch={})=>fetch(origin+'/api/successor/execute',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','x-agi-csrf':csrf,...patch},body});
    for(const patch of [{Origin:'https://montrealai.github.io'},{'x-agi-csrf':'other'}]){const response=await post('{}',patch);assert.ok(response.status>=400);assert.match(JSON.stringify(await response.json()),/HOST|ORIGIN|CSRF/);}
    const http=await import('node:http');const hostile=await new Promise((resolve,reject)=>{const req=http.request(origin+'/api/successor',{headers:{Host:'attacker.invalid',Cookie:cookie}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end();});assert.equal(hostile.status,403);assert.match(hostile.text,/HOST/);
    const duplicate=await post('{"confirm":false,"confirm":true}');assert.equal(duplicate.status,400);assert.match(JSON.stringify(await duplicate.json()),/REQUEST_JSON_INVALID/);
    assert.equal(fs.existsSync(store),false);
    assert.equal((await fetch(origin+'/api/successor',{headers:{Cookie:cookie}})).status,200);assert.equal(fs.existsSync(store),true);
    assert.equal((await fetch(origin+'/successor.js')).status,200);
    assert.equal(a.worker.state.calls.length,0);
  }finally{await server?.close();await a.close();}
});

test('Studio backup size failures retain the legacy contract and actionable public guidance',async()=>{
  const {default:os}=await import('node:os'),home=fs.mkdtempSync(path.join(os.tmpdir(),'successor-backup-'));
  try{
    fs.mkdirSync(path.join(home,'data'));fs.mkdirSync(path.join(home,'work-studio'));
    const file=path.join(home,'work-studio','large');fs.writeFileSync(file,'');fs.truncateSync(file,14*1024*1024+1);
    for(const role of ['AGI_Agent','AGI_Node']){
      const {captureOperational}=await import(`../packages/${role}/src/control/operational-state.mjs`),{publicError}=await import(`../packages/${role}/src/control/messages.mjs`);
      assert.throws(()=>captureOperational({home,kind:role==='AGI_Agent'?'agent':'node'}),error=>{
        assert.match(error.message,/BACKUP_TOO_LARGE/);assert.equal(error.code,'BACKUP_STUDIO_EXPORT_REQUIRED');
        assert.equal(publicError(error).code,'BACKUP_STUDIO_EXPORT_REQUIRED');return true;
      });
      const capture=captureOperational({home,kind:role==='AGI_Agent'?'agent':'node',excludeStudio:true});
      assert.deepEqual(capture.excludedTrees,['work-studio']);assert.equal(fs.statSync(file).size,14*1024*1024+1);
    }
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('SUCCESSOR sidecars retain a maximum Studio file and reject missing, traversal, aliases, overflow and extra content',async()=>{
  const {createHash}=await import('node:crypto'),{canonical}=await import('../successor/vendor/manager/site/assets/successor/safe.mjs');const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}const ar=await run(a.bridge,{request:req,context:ctx}),actual=await a.bridge.result(ar.p.key);
    const artifactName='a/b/c/d/e/f/g/h/i/j/k/artifact.bin';
    const mission=defaultMission('custom');mission.outputs=artifactName;
    const originalSpec=structuredClone(actual.handoff.specification);originalSpec.outputs=[{name:artifactName,mediaType:'application/octet-stream',maxBytes:32*1024*1024,requirement:'Retain exact binary bytes.'}];for(const c of originalSpec.criteria)c.evidence=[artifactName];
    const missionPath=path.join(a.dir,'custom-mission.json'),specPath=path.join(a.dir,'custom-spec.json'),preparedPath=path.join(a.dir,'prepared-custom');fs.writeFileSync(missionPath,JSON.stringify(mission));fs.writeFileSync(specPath,JSON.stringify(originalSpec));
    const prepare=()=>spawnSync(process.execPath,[path.join(root,'successor/cli.mjs'),'prepare-custom',missionPath,specPath,'100',preparedPath],{encoding:'utf8',timeout:30000});
    const terminal=prepare();assert.equal(terminal.status,0,terminal.stderr);assert.equal(JSON.parse(terminal.stdout).authority,'none');assert.equal(prepare().status,1);assert.deepEqual(JSON.parse(fs.readFileSync(missionPath)),mission);assert.deepEqual(JSON.parse(fs.readFileSync(specPath)),originalSpec);
    const capsule=fs.readFileSync(path.join(preparedPath,'capsule.json'),'utf8'),spec=JSON.parse(fs.readFileSync(path.join(preparedPath,'specification.json'))),state=(await inspectCapsule(capsule)).capsule.payload.state;assert.equal(state.active,null);assert.equal(state.authority,'none');assert.equal(JSON.parse(state.mission.input).originalInput,mission.input);
    const handoff=a.api.makeHandoff(spec,a.api.buildBundle(spec,new Map([[artifactName,Buffer.alloc(32*1024*1024,42)]])));
    n.worker.chat=async(_agent,_prompt,data)=>{
      const delivered=fs.readFileSync(path.join(n.c.inputRoot,'delivery',artifactName));
      const exact=delivered.equals(Buffer.alloc(32*1024*1024,42));
      return JSON.stringify({safeToReview:true,checks:data.specification.criteria.map(c=>({id:c.id,status:exact?'pass':'fail',method:'Synthetic Node fixture compares every delivered binary byte.',observed:exact?'All 32 MiB match the fixed fixture.':'Binary bytes differ.',files:c.evidence}))});
    };
    const nr=await run(n.bridge,{handoff}),{receipt}=await n.bridge.result(nr.p.key);
    assert.equal(receipt.role,'node');assert.equal(receipt.status,'checked');
    const dir=path.join(a.dir,'large'),name=path.join(dir,'artifacts/'+artifactName);await exportSidecar(dir,capsule,handoff,receipt,a.api);
    const {sha256,...body}=await inspectSidecar(dir);assert.ok(body.totalBytes>70*1024*1024);
    const save=v=>fs.writeFileSync(path.join(dir,'manifest.json'),canonical({...v,sha256:createHash('sha256').update(canonical(v)).digest('hex')}));
    for(const change of [v=>v.files[0].path='../outside',v=>v.files.push({...v.files.at(-1),path:'artifacts/'+artifactName.toUpperCase()}),v=>v.files[0].bytes++,v=>v.files[0].bytes=96*1024*1024+1,v=>v.totalBytes++]){const bad=structuredClone(body);change(bad);save(bad);await assert.rejects(inspectSidecar(dir));}save(body);
    fs.renameSync(name,name+'.missing');await assert.rejects(inspectSidecar(dir));fs.symlinkSync(name+'.missing',name);await assert.rejects(inspectSidecar(dir));fs.unlinkSync(name);fs.renameSync(name+'.missing',name);
    fs.writeFileSync(path.join(dir,'unexpected.txt'),'extra');await assert.rejects(inspectSidecar(dir),/EXTRA/);
  }finally{await a.close();await n.close();}
});

test('SUCCESSOR sidecar disk-full failure leaves original and no completed destination',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),dest=path.join(a.dir,'disk-full');
    const nr=await run(n.bridge,{handoff:result.handoff}),reviewed=await n.bridge.result(nr.p.key);assert.equal(reviewed.receipt.status,'checked');
    const original=fs.writeFileSync;fs.writeFileSync=(file,...args)=>{if(String(file).includes('.partial-'))throw Object.assign(Error('injected full disk'),{code:'ENOSPC'});return original(file,...args);};
    try{await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,reviewed.receipt,a.api),/full disk/);}finally{fs.writeFileSync=original;}
    assert.equal(fs.existsSync(dest),false);assert.equal(fs.readdirSync(a.dir).some(n=>n.startsWith('disk-full')),false);assert.equal((await inspectRequest(req)).request.capsule,req.capsule);
  }finally{await a.close();await n.close();}
});


test('SUCCESSOR sidecars reject mixed or altered receipts before writing and during restore inspection',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),dest=path.join(a.dir,'mixed-receipt');
    const agentReceipt=result.receipt,originalChat=n.worker.chat;let releaseReview,nr,pendingReceipt;
    const reviewGate=new Promise(resolve=>{releaseReview=resolve;});n.worker.chat=async(...args)=>{await reviewGate;return originalChat(...args);};
    try{
      const p=await n.bridge.prepare({handoff:result.handoff},'test-principal'),started=await n.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'test-principal');nr={p,started};
      pendingReceipt=n.controller.studio.export(started.run.id,'receipt');assert.equal(pendingReceipt.status,'running');assert.equal(pendingReceipt.review,null);assert.equal(pendingReceipt.hasFiles,true);
    }finally{releaseReview();n.worker.chat=originalChat;}
    await n.controller.studio.task;result.receipt=(await n.bridge.result(nr.p.key)).receipt;
    assert.equal(result.receipt.role,'node');assert.equal(result.receipt.status,'checked');
    const invalidReviews=[pendingReceipt,...['cancelled','failed','declined'].map(status=>({...result.receipt,status,phase:status,review:null})),...[r=>r.finishedAt=null,r=>r.review=null,r=>r.review.checks=[],r=>r.review.checks[0].id='unrelated-criterion',r=>r.review.checks[0].files=[],r=>r.review.checks[0].method='',r=>r.review.verdict='concern'].map(change=>{const r=structuredClone(result.receipt);change(r);return r;})];
    for(const receipt of invalidReviews){await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,receipt,a.api),/FLEET_RECEIPT_REVIEW/);assert.equal(fs.existsSync(dest),false);await assert.rejects(a.bridge.result(ar.p.key,receipt),/FLEET_RECEIPT_REVIEW/);}
    await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,agentReceipt,a.api),/FLEET_RECEIPT_SCHEMA/);assert.equal(fs.existsSync(dest),false);
    for(const change of [r=>r.schema='unknown',r=>r.role='agent',r=>r.role='employer',r=>r.specHash='a'.repeat(64),r=>r.deliveryHash='b'.repeat(64),r=>r.specification.prompt+='altered',r=>r.independent=true]){
      const receipt=structuredClone(result.receipt);change(receipt);await assert.rejects(exportSidecar(dest,req.capsule,result.handoff,receipt,a.api),/RECEIPT/);assert.equal(fs.existsSync(dest),false);
    }
    await exportSidecar(dest,req.capsule,result.handoff,result.receipt,a.api);
    const {createHash}=await import('node:crypto'),{canonical}=await import('../successor/vendor/manager/site/assets/successor/safe.mjs'),hash=b=>createHash('sha256').update(b).digest('hex');
    for(const bad of [{...result.receipt,deliveryHash:'c'.repeat(64)},agentReceipt,...invalidReviews]){
      const raw=canonical(bad);fs.writeFileSync(path.join(dest,'receipt.json'),raw);
      const manifest=JSON.parse(fs.readFileSync(path.join(dest,'manifest.json'))),entry=manifest.files.find(f=>f.path==='receipt.json');manifest.totalBytes+=Buffer.byteLength(raw)-entry.bytes;entry.bytes=Buffer.byteLength(raw);entry.sha256=hash(raw);const {sha256,...body}=manifest;manifest.sha256=hash(canonical(body));fs.writeFileSync(path.join(dest,'manifest.json'),canonical(manifest));
      await assert.rejects(inspectSidecar(dest),/FLEET_RECEIPT_/);await assert.rejects(restoreSidecar(dest,path.join(a.dir,'unsafe-restore'),true),/FLEET_RECEIPT_/);assert.equal(fs.existsSync(path.join(a.dir,'unsafe-restore')),false);
    }
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
    // Recompute every delivery, receipt and manifest digest after changing a
    // valid specification. Integrity alone must not substitute for plan scope.
    const custom=await prepareCustomProject(defaultMission('custom'),result.handoff.specification,'100');
    const scopeChanges=[s=>s.outputs[0].requirement+=' Changed requirement.',s=>s.outputs[0].maxBytes++,s=>s.outputs[0].mediaType='application/octet-stream',s=>s.criteria[0].requirement='Only check that a file exists.',s=>s.criteria[0].verification='Ignore original inputs.',s=>s.criteria[0].evidence=['checker-results.json']];
    const actualFiles=a.api.validateBundle(result.handoff.specification,Buffer.from(result.handoff.delivery)).files;
    for(const [kind,capsule,baseSpec] of [['local',req.capsule,result.handoff.specification],['custom',custom.capsule,custom.specification]]){
      const baseHandoff=a.api.makeHandoff(baseSpec,a.api.buildBundle(baseSpec,actualFiles)),baseReceipt={...result.receipt,specification:baseSpec,specHash:baseHandoff.specHash,deliveryHash:baseHandoff.deliveryHash};
      const validPack=path.join(a.dir,kind+'-scope-original');await exportSidecar(validPack,capsule,baseHandoff,baseReceipt,a.api);
      const changes=kind==='custom'?[...scopeChanges,s=>s.prompt+=' Different work.',s=>s.inputs[0].uri='https://example.org/different.json',s=>s.deadline++,s=>s.budget.maxAgentCostUSDC='6']:scopeChanges;
      for(let i=0;i<changes.length;i++){
        const spec=structuredClone(baseSpec);changes[i](spec);const handoff=a.api.makeHandoff(spec,a.api.buildBundle(spec,actualFiles)),receipt={...baseReceipt,specification:spec,specHash:handoff.specHash,deliveryHash:handoff.deliveryHash,criteria:spec.criteria,files:JSON.parse(handoff.delivery).files.map(({content,...meta})=>meta)};
        const rejected=path.join(a.dir,kind+'-scope-export-'+i),tampered=path.join(a.dir,kind+'-scope-inspect-'+i),restored=path.join(a.dir,kind+'-scope-restore-'+i);
        await assert.rejects(exportSidecar(rejected,capsule,handoff,receipt,a.api),/SIDECAR_(PROJECT|CUSTOM)_SCOPE/);assert.equal(fs.existsSync(rejected),false);
        fs.cpSync(validPack,tampered,{recursive:true});fs.writeFileSync(path.join(tampered,'handoff.json'),canonical(handoff));fs.writeFileSync(path.join(tampered,'receipt.json'),canonical(receipt));
        const {sha256,...body}=JSON.parse(fs.readFileSync(path.join(tampered,'manifest.json')));body.files=body.files.map(f=>{const bytes=fs.readFileSync(path.join(tampered,f.path));return {...f,mediaType:f.role==='deliverable'?spec.outputs.find(o=>'artifacts/'+o.name===f.path).mediaType:f.mediaType,bytes:bytes.length,sha256:hash(bytes)};});body.totalBytes=body.files.reduce((n,f)=>n+f.bytes,0);fs.writeFileSync(path.join(tampered,'manifest.json'),canonical({...body,sha256:hash(canonical(body))}));
        await assert.rejects(inspectSidecar(tampered),/SIDECAR_(PROJECT|CUSTOM)_SCOPE/);await assert.rejects(restoreSidecar(tampered,restored,true),/SIDECAR_(PROJECT|CUSTOM)_SCOPE/);assert.equal(fs.existsSync(restored),false);
      }
    }
    let unbound=await createSystem(defaultMission('custom'));const unboundPlan=await prepareImprovement(unbound,{budget:'100'});unbound=await recordPlan(unbound,unboundPlan);const unboundSpec={...custom.specification,coordination:{...custom.specification.coordination,parentSpecSha256:unboundPlan.commitment}},unboundHandoff=a.api.makeHandoff(unboundSpec,a.api.buildBundle(unboundSpec,actualFiles)),unboundReceipt={...result.receipt,specification:unboundSpec,specHash:unboundHandoff.specHash,deliveryHash:unboundHandoff.deliveryHash};await assert.rejects(exportSidecar(path.join(a.dir,'unbound-custom'),await exportCapsule(unbound),unboundHandoff,unboundReceipt,a.api),/SIDECAR_CUSTOM_SCOPE/);
  }finally{await a.close();await n.close();}
});

test('outcome ledger retains failed/unknown attempts, distinct cost bases and active/waiting time without inventing independent economics',async()=>{
  const {OutcomeLedger,summarizeOutcomes}=await import('../successor/outcomes.mjs');const os=await import('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-ledger-'));
  try{const ledger=new OutcomeLedger(dir),hash='1'.repeat(64),base={attempt:hash,at:1,evidenceSha256:hash};
    ledger.append({...base,type:'attempt',data:{state:'blocked-or-uncertain',projectSha256:hash,method:'fixture',inputHashes:[hash],outputHashes:[],runtimeSha256:null}});
    ledger.append({...base,type:'cost',data:{id:'unknown',category:'provider',basis:'unknown',currency:'USD',amountMicros:null,billingReferenceSha256:null}});
    const charge={...base,type:'cost',data:{id:'invoice',category:'provider',basis:'invoiced',currency:'USD',amountMicros:'1234567',billingReferenceSha256:hash}};ledger.append(charge);assert.throws(()=>ledger.append(charge),/OUTCOME_DUPLICATE_COST/);
    ledger.append({...base,type:'human-time',data:{stage:'repair',activeSeconds:90,waitingSeconds:120,measurement:'observed'}});
    ledger.append({...base,type:'review',data:{verdict:'accepted',control:'unverified',deliverySha256:hash,eligibilityEvidenceSha256:null}});
    const summary=summarizeOutcomes(ledger.read());assert.equal(summary.attempts,1);assert.equal(summary.externallyAttestedAccepted,0);assert.equal(summary.unknownCosts.length,1);assert.equal(summary.costMicrosByCurrencyAndBasis['USD:invoiced'],'1234567');assert.equal(summary.humanTimeByStage['repair:observed'].activeSeconds,90);assert.equal(summary.costPerIndependentlyAcceptedOutcome,null);
    fs.appendFileSync(path.join(dir,'attempts.jsonl'),'{torn');assert.throws(()=>ledger.read(),/OUTCOME_TORN/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('outcome funnel keeps refusals, repeat tasks and unaudited acceptance distinct; expense bases reconcile without counting a charge twice',async()=>{
  const {OutcomeLedger,summarizeOutcomes,exportAttemptObservations,verifyLedger}=await import('../successor/outcomes.mjs'),os=await import('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-funnel-'));
  try{
    const ledger=new OutcomeLedger(dir),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),evidence='e'.repeat(64);
    const event=(attempt,type,data)=>({attempt,type,at:1,evidenceSha256:evidence,data});
    const funnel=(attempt,task,stage,ordinal=1,repeat=null)=>ledger.append(event(attempt,'funnel',{taskSha256:task,stage,family:'data-reconciliation',role:'agent',attemptOrdinal:ordinal,repeatOfTaskSha256:repeat}));
    funnel(a,a,'offered');funnel(a,a,'admissible');funnel(a,a,'attempted');funnel(b,b,'offered');
    funnel(c,c,'offered');funnel(c,c,'admissible');funnel(c,c,'attempted',2);funnel(c,c,'repaired',2);funnel(c,c,'repeated',2,a);
    const cost=(id,basis,amountMicros)=>event(a,'cost',{id,category:'provider',basis,currency:'USD',amountMicros,billingReferenceSha256:basis==='invoiced'?evidence:null});
    ledger.append(cost('same-charge','unknown',null));ledger.append(cost('same-charge','estimated','1000000'));ledger.append(cost('same-charge','metered','2000000'));ledger.append(cost('same-charge','invoiced','2300000'));
    ledger.append(cost('unresolved-review','unknown',null));
    assert.throws(()=>ledger.append(cost('same-charge','invoiced','2300000')),/OUTCOME_DUPLICATE_COST/);
    assert.throws(()=>ledger.append({...cost('same-charge','subscription-allocated','100000'),data:{...cost('same-charge','subscription-allocated','100000').data,currency:'CAD'}}),/OUTCOME_EXPENSE_CHANGED/);
    ledger.append(event(a,'human-time',{stage:'support',activeSeconds:90,waitingSeconds:600,measurement:'observed',actor:'founder'}));
    ledger.append(event(a,'review',{verdict:'accepted',control:'unverified',deliverySha256:a,eligibilityEvidenceSha256:null}));
    ledger.append(event(c,'review',{verdict:'accepted',control:'internal',deliverySha256:c,eligibilityEvidenceSha256:null}));
    const summary=summarizeOutcomes(ledger.read());assert.deepEqual(summary.funnel,{offered:3,admissible:2,attempted:2,firstPassAccepted:1,repaired:1,rejected:0,abandoned:0,repeated:1});
    assert.deepEqual(summary.acceptanceAssertionsByControl,{internal:1,unverified:1,'externally-attested':0});assert.equal(summary.costPerIndependentlyAcceptedOutcome,null);
    assert.equal(summary.selectedExpenseMicrosByCurrency.USD,'2300000');assert.equal(summary.costMicrosByCurrencyAndBasis['USD:metered'],'2000000');assert.equal(summary.unknownCosts.length,1);assert.equal(summary.unknownCosts[0].id,'unresolved-review');
    assert.equal(summary.humanTimeByActorAndStage['founder:support:observed'].activeSeconds,90);assert.equal(summary.humanTimeByActorAndStage['founder:support:observed'].waitingSeconds,600);
    const isolated=exportAttemptObservations(ledger.read(),c);verifyLedger(isolated);assert.equal(isolated[0].previous,null);assert.ok(isolated.every(r=>r.event.attempt===c));assert.equal(JSON.stringify(isolated).includes('same-charge'),false);
    const output=spawnSync(process.execPath,[path.join(root,'successor/outcome-cli.mjs'),'--store',dir,'--attempt',c,'--export'],{encoding:'utf8'});assert.equal(output.status,0,output.stderr);verifyLedger(JSON.parse(output.stdout));assert.deepEqual(JSON.parse(output.stdout),isolated);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('independent eligibility remains an explicit external audit assertion and never fabricated economics',async()=>{
  const {OutcomeLedger,summarizeOutcomes}=await import('../successor/outcomes.mjs'),os=await import('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-review-audit-'));
  try{const ledger=new OutcomeLedger(dir),hash='2'.repeat(64),reviewHash='3'.repeat(64),auditHash='4'.repeat(64),base={attempt:hash,at:1,evidenceSha256:reviewHash};
    ledger.append({...base,type:'review',data:{verdict:'accepted',control:'externally-attested',deliverySha256:hash,eligibilityEvidenceSha256:auditHash}});
    let summary=summarizeOutcomes(ledger.read());assert.equal(summary.externallyAttestedAccepted,1);assert.equal(summary.eligibilityAuditAcceptedAssertions,0);assert.equal(summary.funnel.firstPassAccepted,0);
    ledger.append({...base,type:'eligibility-audit',data:{verdict:'eligible',reviewEvidenceSha256:reviewHash,auditEvidenceSha256:auditHash}});
    summary=summarizeOutcomes(ledger.read());assert.equal(summary.eligibilityAuditAcceptedAssertions,1);assert.equal(summary.costPerIndependentlyAcceptedOutcome,null);assert.equal(summary.activeMinutesPerIndependentlyAcceptedOutcome,null);assert.equal(summary.productionQualified,false);assert.match(summary.independentControl,/verify the actual audit/);
    ledger.append({...base,type:'eligibility-audit',data:{verdict:'eligible',reviewEvidenceSha256:reviewHash,auditEvidenceSha256:'5'.repeat(64)}});assert.equal(summarizeOutcomes(ledger.read()).eligibilityAuditAcceptedAssertions,0);
    assert.throws(()=>ledger.append({...base,type:'human-time',data:{stage:'support',activeSeconds:1,waitingSeconds:0,measurement:'observed',actor:'founder',payload:'secret'}}),/OUTCOME_TIME/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('installed project view retains only selected attempt details; locked view withholds outcome observations',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));
    const ar=await run(a.bridge,{request:req,context:ctx}),result=await a.bridge.result(ar.p.key),status=a.bridge.status(),saved=status.runs.find(r=>r.key===ar.p.key);
    assert.equal(saved.projectView.goal,ar.p.specification.prompt);assert.deepEqual(saved.projectView.inputs,ar.p.specification.inputs.map(f=>f.name));assert.deepEqual(saved.projectView.outputs,ar.p.specification.outputs.map(f=>f.name));assert.deepEqual(saved.projectView.budget,ctx.budget);assert.equal(saved.outcomeSummary.funnel.attempted,1);assert.equal(saved.outcomeSummary.funnel.firstPassAccepted,0);assert.equal(saved.request,undefined);
    const {verifyLedger}=await import('../successor/outcomes.mjs');verifyLedger(result.outcomeObservations);assert.ok(result.outcomeObservations.every(row=>row.event.attempt===ar.p.key));assert.equal(result.outcomeObservations[0].previous,null);
    const raw=JSON.stringify(result.outcomeObservations);assert.equal(raw.includes(req.plan.goal),false);assert.equal(raw.includes(req.plan.immutableInputs[0].content),false);assert.equal(raw.includes('a'.repeat(64)),false);
    a.controller.vault.lock();assert.equal(a.bridge.status().outcomeSummary,null);assert.deepEqual(a.bridge.status().runs,[]);
  }finally{await a.close();await n.close();}
});

test('same-task retries reserve durable ordinals across changed bounds, stale controllers and restart; accepted retry is not first-pass',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}
    const stale=new SuccessorController(a.controller,'agent',a.api),start=a.controller.studio.start.bind(a.controller.studio);
    a.controller.studio.start=()=>{throw Error('TEST_BEFORE_DISPATCH_FAILURE');};
    const p=await a.bridge.prepare({request:req,context:ctx},'test-principal');await assert.rejects(a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'test-principal'),/TEST_BEFORE_DISPATCH_FAILURE/);
    assert.equal(a.bridge.records[0].attemptOrdinal,1);assert.equal(a.bridge.records[0].status,'blocked-or-uncertain');assert.equal(a.worker.state.calls.length,0);
    a.controller.studio.start=start;const changed=structuredClone(ctx);changed.deadline+=60;changed.budget.maxAgentCostUSDC='6';
    const before=await stale.prepare({request:req,context:changed},'test-principal'),lock=path.join(a.controller.home,'successor-attempt.lock');fs.writeFileSync(lock,'',{mode:0o600});
    await assert.rejects(stale.execute({ticket:before.ticket,key:before.key,confirm:true},'test-principal'),/FLEET_ATTEMPT_LOCKED/);assert.equal(a.worker.state.calls.length,0);fs.unlinkSync(lock);
    const retry=await run(stale,{request:req,context:changed}),actual=await stale.result(retry.p.key);assert.notEqual(retry.p.key,p.key);
    const saved=stale.records.find(r=>r.key===retry.p.key);assert.equal(saved.attemptOrdinal,2);assert.equal(saved.taskSha256,req.plan.missionSha256);assert.equal(saved.repeatOfTaskSha256,req.plan.missionSha256);
    const nr=await run(n.bridge,{handoff:actual.handoff}),review=await n.bridge.result(nr.p.key);assert.equal((await stale.result(retry.p.key,review.receipt)).outcome,'accepted');
    const reopened=new SuccessorController(a.controller,'agent',a.api),summary=reopened.status().outcomeSummary;assert.equal(summary.attempts,2);assert.equal(summary.funnel.attempted,1);assert.equal(summary.funnel.repeated,1);assert.equal(summary.funnel.firstPassAccepted,0);assert.equal(summary.acceptanceAssertionsByControl.unverified,1);
    // Later offered/admissible observations cannot rewrite a committed ordinal.
    const third=structuredClone(changed);third.deadline+=60;const prepared=await reopened.prepare({request:req,context:third},'test-principal');await reopened.execute({ticket:prepared.ticket,key:prepared.key,confirm:true},'test-principal');await a.controller.studio.task;assert.equal(reopened.records.find(r=>r.key===prepared.key).attemptOrdinal,3);
  }finally{await a.close();await n.close();}
});

test('later preparations and repetitions cannot relabel committed first-pass metadata or erase a genuine original first pass',async()=>{
  const {OutcomeLedger,summarizeOutcomes}=await import('../successor/outcomes.mjs'),os=await import('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'outcome-ordinal-'));
  try{const ledger=new OutcomeLedger(dir),task='6'.repeat(64),a='7'.repeat(64),b='8'.repeat(64),evidence='9'.repeat(64);
    const event=(attempt,type,data)=>({attempt,type,at:1,evidenceSha256:evidence,data}),funnel=(attempt,stage,ordinal,repeat)=>ledger.append(event(attempt,'funnel',{taskSha256:task,stage,family:'data-reconciliation',role:'agent',attemptOrdinal:ordinal,repeatOfTaskSha256:repeat}));
    funnel(a,'attempted',1,null);ledger.append(event(a,'review',{verdict:'accepted',control:'unverified',deliverySha256:a,eligibilityEvidenceSha256:null}));
    funnel(a,'offered',2,task);funnel(b,'attempted',2,task);funnel(b,'repeated',2,task);ledger.append(event(b,'review',{verdict:'accepted',control:'unverified',deliverySha256:b,eligibilityEvidenceSha256:null}));
    let summary=summarizeOutcomes(ledger.read());assert.equal(summary.funnel.firstPassAccepted,1);assert.equal(summary.funnel.repeated,1);assert.equal(summary.acceptanceAssertionsByControl.unverified,2);
    funnel(a,'repaired',1,null);summary=summarizeOutcomes(ledger.read());assert.equal(summary.funnel.firstPassAccepted,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

function holdHealth(f){
  const original=f.controller.companion.readComputeHealth.bind(f.controller.companion);
  let entered,release;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  f.controller.companion.readComputeHealth=async(...args)=>{entered();await gate;return original(...args);};
  return {reached,release,restore:()=>{f.controller.companion.readComputeHealth=original;}};
}
test('authenticated Stop interrupts pending inspection and dispatch through the installed HTTP operation lock',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');let server;
  try{
    const {createControlServer}=await import('../packages/AGI_Agent/src/control/server.mjs');
    server=await createControlServer(a.controller,{port:0});const url=new URL(server.url),origin=url.origin;
    const session=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});
    const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
    const post=(route,input)=>fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','x-agi-csrf':csrf},body:JSON.stringify(input)});
    const rejected=await fetch(origin+'/api/successor/stop',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','x-agi-csrf':'invalid'},body:'{}'});
    assert.equal(rejected.status,403);assert.match(JSON.stringify(await rejected.json()),/CSRF_REJECTED/);
    const req=await request(),ctx=context(req,a,n);for(const f of req.plan.immutableInputs)a.inputs.set(f.name,Buffer.from(f.content));
    for(const route of ['successor/stop','stop','studio/cancel','lock'])for(const stage of ['prepare','execute']){
      let input={request:req,context:ctx};
      if(stage==='execute'){const prepared=await post('successor/prepare',input);assert.equal(prepared.status,200);const p=await prepared.json();input={ticket:p.ticket,key:p.key,confirm:true};}
      const gate=holdHealth(a),pending=post('successor/'+stage,input);await gate.reached;
      let stopped;
      try{stopped=await post(route,{});}finally{gate.release();gate.restore();}
      const late=await pending;
      assert.equal(stopped.status,200,JSON.stringify(await stopped.json()));
      assert.ok(late.status>=400);assert.match(JSON.stringify(await late.json()),/FLEET_AUTHORIZATION_REVOKED/);
      if(route==='lock')await a.controller.unlock('Synthetic fixture password 123!');
      const view=await fetch(origin+'/api/successor',{headers:{Cookie:cookie}});assert.equal((await view.json()).runs.length,0);
      assert.equal(a.worker.state.calls.length,0);
    }
    let release;const held=a.controller.mutate('Changing settings',()=>new Promise(resolve=>{release=resolve;}));
    try{
      for(const route of ['successor/stop','stop','studio/cancel','lock']){
        const response=await post(route,{});assert.equal(response.status,409);
        assert.match(JSON.stringify(await response.json()),/OPERATION_IN_PROGRESS/);
        assert.equal(a.controller.operation,'Changing settings');
      }
    }finally{release();await held;}
  }finally{await server?.close();await a.close();await n.close();}
});
test('revocation and Stop during runtime inspection cannot create a late authorization ticket',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);
    for(const action of ['revoke','stop']){
      const gate=holdHealth(a),pending=a.bridge.prepare({request:req,context:ctx},'test-principal');await gate.reached;
      await a.bridge[action]();gate.release();
      await assert.rejects(pending,/FLEET_AUTHORIZATION_REVOKED/);gate.restore();
      assert.equal(a.bridge.tickets.size,0);assert.equal(a.bridge.records.length,0);assert.equal(a.worker.state.calls.length,0);
    }
  }finally{await a.close();await n.close();}
});
test('revocation and Stop during fresh dispatch inspection cannot reserve or start the pending attempt',async()=>{
  const a=await fixture(root),n=await fixture(root,'node');try{
    const req=await request(),ctx=context(req,a,n);for(const file of req.plan.immutableInputs)a.inputs.set(file.name,Buffer.from(file.content));
    for(const action of ['revoke','stop']){
      const p=await a.bridge.prepare({request:req,context:ctx},'test-principal'),gate=holdHealth(a);
      const pending=a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'test-principal');await gate.reached;
      await a.bridge[action]();gate.release();
      await assert.rejects(pending,/FLEET_AUTHORIZATION_REVOKED/);gate.restore();
      assert.equal(a.bridge.records.length,0);assert.equal(a.worker.state.calls.length,0);
      assert.equal(a.bridge.status().outcomeSummary.attempts,0);
    }
  }finally{await a.close();await n.close();}
});
