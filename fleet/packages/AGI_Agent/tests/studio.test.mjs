import {makeRevision,validateStudioRevision} from '../src/studio.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
import {STUDIO_TEMPLATES,composeStudio,makeHandoff,validateHandoff,studioDownload} from '../src/studio.mjs';
import {buildBundle,inspectZIP} from '../src/artifacts.mjs';
import {canonical,sha256} from '../src/util.mjs';

const role = JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).name.endsWith('agent') ? 'agent' : 'node';
const spec = {schema:'agi-node-job/v1',profile:'computer-work/v1',dataPolicy:'public',title:'Fixture task',prompt:'Return the exact answer 42.',inputs:[],outputs:[{name:'answer.txt',mediaType:'text/plain',maxBytes:100,requirement:'42'}],criteria:[{id:'answer',requirement:'The answer is 42.'}]};
const delivery = buildBundle(spec,new Map([['answer.txt',Buffer.from('42')]]));
const handoff = makeHandoff(spec,delivery);
const goodReview = () => ({safeToReview:true,checks:[{id:'answer',status:'pass',method:'Fixture read of answer.txt',observed:'The file contains 42.',files:['answer.txt']}]});
const reply = value => Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const input = () => role === 'agent' ? {specification:structuredClone(spec)} : {handoff:structuredClone(handoff)};
async function fixture(handler) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'agi-studio-test-'));
  let clock = Date.now(); const calls = [];
  const c = new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,options) => {
    if (url.endsWith('/health')) return Response.json({policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,tools:true,auth:'chatgpt-oauth',capabilities:['browser','desktop','files','computer-review','revision'],policyHash:'a'.repeat(64),gatewayReady:true,stopped:false});
    const kind = options.headers['x-agi-kind'], payload = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    calls.push({kind,payload});
    const value = handler ? await handler(kind,payload,options.signal) : kind === 'generate' ? {status:'complete',content:delivery} : kind === 'computer-review' ? goodReview() : {status:'ready'};
    clock += 31000; return reply(value);
  }}});
  await c.createVault('Fixture-only Studio password 123!');
  c.vault.set({openclawToken:'a'.repeat(64)});
  c.companion.config = {...c.companion.config,mode:'workstation',enabled:true,acknowledged:true,timeoutMs:720000};
  c.companion.state.testedAt = clock; c.companion.state.computePolicy = 'a'.repeat(64); c.companion.save(); c.companion.persist();
  return {c,home,calls,close:async()=>{await c.close();fs.rmSync(home,{recursive:true,force:true});}};
}
test('all nine editable task templates compile into the shared supported formats',()=>{
  for (const t of STUDIO_TEMPLATES) {
    const s = composeStudio({template:t.id,title:t.title,prompt:t.prompt,outputs:t.outputs,criteria:t.criteria});
    assert.equal(s.dataPolicy,'public'); assert.ok(s.criteria.length > 0);
    if (s.outputs) assert.ok(s.outputs.reduce((sum,f)=>sum+f.maxBytes,0)<=4194304);
  }
  assert.equal(STUDIO_TEMPLATES.length,19);
  assert.equal(STUDIO_TEMPLATES.filter(t=>t.category==='professional').length,10);
});
test('brief composition rejects unsafe filenames, unsupported output types, missing criteria and injected authority',()=>{
  const base={template:'data',title:'Task',prompt:'Calculate',outputs:['result.json'],criteria:['Correct result']};
  for (const patch of [{outputs:['../vault.json']},{outputs:['script.exe']},{outputs:['A.txt','a.txt']},{criteria:[]},{wallet:'private key'},{outputs:Array(25).fill('a.txt')}]) assert.throws(()=>composeStudio({...base,...patch}));
});
test('portable handoff verifies exact file bytes and task binding, ignores no extra author verdict',()=>{
  assert.deepEqual(validateHandoff(handoff),handoff);
  assert.equal(inspectZIP(Buffer.from(studioDownload(handoff).content,'base64')).length,1);
  for (const change of [h=>h.deliveryHash='0'.repeat(64),h=>h.specification.prompt='Another task',h=>h.verdict='approve',h=>h.delivery=h.delivery.replace('NDI=','NDE=')]) {
    const h=structuredClone(handoff);change(h);assert.throws(()=>validateHandoff(h));
  }
});
test('real controller and companion run produces files and criterion evidence without financial changes',async()=>{
  const f=await fixture();try {
    const settings=canonical(f.c.config),stop=path.join(f.c.config.dataDir,'STOP');fs.writeFileSync(stop,'Preserve this financial stop');
    const run=f.c.studio.start(input());await f.c.studio.task;
    const r=f.c.studio.status().runs[0];assert.equal(r.status,'checked');assert.equal(r.currentScope,true);assert.equal(r.independent,false);
    assert.equal(r.requests,role==='agent'?2:1);assert.equal(r.review.checks[0].observed,'The file contains 42.');
    assert.deepEqual(f.c.studio.export(run.id,'handoff'),handoff);
    assert.equal(f.c.studio.export(run.id,'receipt').evidenceType,'local-controller-record');
    assert.equal(canonical(f.c.config),settings);assert.equal(fs.readFileSync(stop,'utf8'),'Preserve this financial stop');
    assert.equal(fs.existsSync(path.join(f.c.config.dataDir,role+'.sqlite')),false);
    assert.ok(f.calls.every(c=>!Object.hasOwn(c.payload,'review')&&!Object.hasOwn(c.payload,'wallet')));
  }finally{await f.close();}
});
test('uncertain model review retains files and never reports a successful check',async()=>{
  const f=await fixture(kind=>{if(kind==='generate')return {status:'complete',content:delivery};const v=goodReview();v.checks[0].status='uncertain';return v;});
  try{f.c.studio.start(input());await f.c.studio.task;assert.equal(f.c.studio.status().runs[0].status,'needs-review');assert.equal(f.c.studio.status().runs[0].hasFiles,true);}finally{await f.close();}
});
test('busy Studio blocks ordinary settings and worker starts, while Lock & stop cancels and preserves usage',async()=>{
  let entered;const waiting=new Promise(r=>entered=r);
  const f=await fixture(async(kind,data,signal)=>{entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled fixture')),{once:true}));});
  try{
    f.c.studio.start(input());await waiting;
    await assert.rejects(f.c.mutate('Change settings',()=>{}),/STUDIO_BUSY/);
    await assert.rejects(f.c.start('observe'),/STUDIO_BUSY/);
    assert.throws(()=>f.c.requireStopped(),/STUDIO_BUSY/);
    await f.c.mutate('Lock',()=>f.c.lock(),{interruptStudio:true});
    assert.equal(f.c.vault.unlocked,false);assert.equal(f.c.studio.busy,false);assert.equal(f.c.companion.state.calls.length,1);
    assert.deepEqual(f.c.studio.status().runs,[]);
    await f.c.unlock('Fixture-only Studio password 123!');assert.equal(f.c.studio.status().runs[0].status,'cancelled');
  }finally{await f.close();}
});
test('pending signing state and insufficient model quota stop a Studio run before inference',async()=>{
  const f=await fixture();try{
    const status=f.c.status.bind(f.c);f.c.status=()=>({...status(),pending:{hash:'fixture'}});
    assert.throws(()=>f.c.studio.start(input()),/PENDING_TRANSACTION/);assert.equal(f.calls.length,0);
    f.c.status=status;f.c.companion.config.maxCalls24h=1;f.c.companion.state.calls=[f.c.companion.now()];
    assert.throws(()=>f.c.studio.start(input()),/COMPANION_DAILY_LIMIT/);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});
test('changed compute policy marks previous evidence stale without rebinding files',async()=>{
  const f=await fixture();try{
    const run=f.c.studio.start(input());await f.c.studio.task;const before=f.c.studio.export(run.id,'handoff');
    f.c.companion.state.computePolicy='b'.repeat(64);
    assert.equal(f.c.studio.status().runs[0].currentScope,false);assert.deepEqual(f.c.studio.export(run.id,'handoff'),before);
  }finally{await f.close();}
});
test('reopening a saved interrupted run marks it interrupted and never repeats an inference',async()=>{
  const f=await fixture();let second;try{
    const run=f.c.studio.start(input());await f.c.studio.task;
    const filename=path.join(f.home,'work-studio',run.id+'.json'),saved=JSON.parse(fs.readFileSync(filename));saved.status='running';saved.phase='reviewing';fs.writeFileSync(filename,JSON.stringify(saved));
    await f.c.close();second=new Controller(f.home);await second.unlock('Fixture-only Studio password 123!');
    assert.equal(second.studio.status().runs[0].status,'interrupted');assert.equal(second.studio.busy,false);assert.equal(second.studio.export(run.id,'handoff').deliveryHash,sha256(delivery));
    assert.equal(f.calls.length,role==='agent'?2:1);
  }finally{await second?.close();await f.close();}
});
test('Studio has a bounded shelf with explicit removal and no automatic loss of completed work',async()=>{
  const f=await fixture();try{
    const ids=[];for(let i=0;i<5;i++){ids.push(f.c.studio.start(input()).id);await f.c.studio.task;}
    assert.throws(()=>f.c.studio.start(input()),/STUDIO_HISTORY_FULL/);assert.equal(f.c.studio.status().runs.length,5);
    f.c.studio.remove(ids[0]);assert.throws(()=>f.c.studio.export(ids[0],'receipt'),/STUDIO_RUN_UNKNOWN/);assert.equal(f.c.studio.status().runs.length,4);
    f.c.studio.start(input());await f.c.studio.task;assert.equal(f.c.studio.status().runs.length,5);
  }finally{await f.close();}
});
test('a damaged optional Studio notebook does not block wallet recovery or rewrite its evidence',async()=>{
  const f=await fixture();let second;try{
    await f.c.close();const broken=path.join(f.home,'work-studio','broken.json');fs.writeFileSync(broken,'Keep this damaged evidence');
    second=new Controller(f.home);await second.unlock('Fixture-only Studio password 123!');
    assert.equal(second.vault.unlocked,true);assert.equal(second.studio.status().ready,false);assert.equal(second.studio.status().historyError.code,'STUDIO_HISTORY_DAMAGED');
    assert.throws(()=>second.studio.start(input()),/STUDIO_HISTORY_DAMAGED/);assert.equal(fs.readFileSync(broken,'utf8'),'Keep this damaged evidence');
    assert.equal(second.status().unlocked,true);
  }finally{await second?.close();await f.close();}
});
test('malformed and role-inappropriate task requests are rejected before inference',async()=>{
  const f=await fixture();try{
    if(role==='agent') {
      assert.throws(()=>f.c.studio.start({handoff}),/STUDIO_BRIEF_INVALID/);
      assert.throws(()=>f.c.studio.start({specification:{...spec,dataPolicy:'private'}}));
    } else {
      assert.throws(()=>f.c.studio.start({specification:spec}),/STUDIO_HANDOFF_INVALID/);
      assert.throws(()=>f.c.studio.start({handoff:{...handoff,deliveryHash:'0'.repeat(64)}}),/STUDIO_HANDOFF_HASH/);
    }
    assert.equal(f.calls.length,0);assert.equal(f.c.studio.records.length,0);
  }finally{await f.close();}
});
test('operator HTTP routes require session, CSRF and same origin; read-only monitoring cannot run or export work',async()=>{
  const f=await fixture();const app=await createControlServer(f.c,{port:0});
  try{
    const url=new URL(app.url),origin=url.origin,token=url.hash.slice(1);
    const s=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});
    const {csrf}=await s.json(),cookie=s.headers.get('set-cookie').split(';')[0];
    const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-AGI-CSRF':csrf};
    for(const change of [{Cookie:''},{'X-AGI-CSRF':''},{Origin:'https://example.com'}]) {
      const r=await fetch(origin+'/api/studio/start',{method:'POST',headers:{...headers,...change},body:JSON.stringify(input())});assert.ok([401,403].includes(r.status));
    }
    const monitor=f.c.companion.mintReadToken();assert.equal((await fetch(origin+'/api/studio',{headers:{Authorization:'Bearer '+monitor}})).status,401);
    const start=await fetch(origin+'/api/studio/start',{method:'POST',headers,body:JSON.stringify(input())});assert.equal(start.status,200);const r=await start.json();await f.c.studio.task;
    assert.equal((await fetch(origin+`/api/studio/export?id=${r.id}&kind=handoff`,{headers:{Authorization:'Bearer '+monitor}})).status,401);
    const exported=await fetch(origin+`/api/studio/export?id=${r.id}&kind=handoff`,{headers:{Cookie:cookie}});assert.deepEqual(await exported.json(),handoff);
    await f.c.lock();assert.equal((await fetch(origin+`/api/studio/export?id=${r.id}&kind=files`,{headers:{Cookie:cookie}})).status,400);
  }finally{await app.close();await f.close();}
});

const failureReview=()=>{const v=goodReview();v.checks[0].status='fail';v.checks[0].observed='Expected 42, found 41.';return v;};
const wrongDelivery=buildBundle(spec,new Map([['answer.txt',Buffer.from('41')]]));
const revisionInput=()=>makeRevision(makeHandoff(spec,wrongDelivery),failureReview());
test('revision package binds original actual bytes and unchanged criteria; unsafe, uncertain or positive reviews are not repair authority',()=>{
 const rev=revisionInput();assert.deepEqual(validateStudioRevision(rev),rev);
 for(const mutate of [v=>v.handoff.deliveryHash='0'.repeat(64),v=>v.handoff.specification.prompt='Change the job',v=>v.review.safeToReview=false,v=>v.review.checks[0].status='uncertain',v=>v.review.checks[0].status='pass',v=>v.review.checks[0].files=['secrets.txt'],v=>v.wallet='sign']) {const r=structuredClone(rev);mutate(r);assert.throws(()=>validateStudioRevision(r));}
});
test('review exports actionable feedback for these files only, and stale scope cannot authorize reuse',async()=>{
 const f=await fixture(kind=>kind==='generate'?{status:'complete',content:delivery}:failureReview());try{
  const r=f.c.studio.start(input());await f.c.studio.task;
  const rev=f.c.studio.export(r.id,'revision');assert.equal(rev.schema,'agi-studio-revision/v1');assert.equal(rev.handoff.delivery,delivery);assert.equal(rev.review.checks[0].status,'fail');
  f.c.companion.state.computePolicy='b'.repeat(64);assert.throws(()=>f.c.studio.export(r.id,'revision'),/REVISION_INVALID/);
 }finally{await f.close();}
});
test('revision creates new checked files, preserves originals, and never passes author feedback to the new reviewer',async()=>{
 const f=await fixture();try{
  if(role==='node'){assert.throws(()=>f.c.studio.start({revision:revisionInput()}),/HANDOFF_INVALID/);assert.equal(f.calls.length,0);return;}
  const r=f.c.studio.start({revision:revisionInput()});await f.c.studio.task;
  const receipt=f.c.studio.export(r.id,'receipt');assert.equal(receipt.status,'checked');assert.equal(receipt.isRevision,true);assert.equal(receipt.requests,2);
  assert.equal(f.c.studio.export(r.id,'handoff').delivery,delivery);
  assert.deepEqual(f.c.studio.export(r.id,'original-files'),studioDownload(makeHandoff(spec,wrongDelivery)));
  assert.equal(receipt.revisionSource.deliveryHash,sha256(wrongDelivery));
  assert.equal(f.calls[0].payload.revision.delivery,wrongDelivery);assert.equal(f.calls[0].payload.attempt,2);
  assert.equal(Object.hasOwn(f.calls[1].payload,'revision'),false);assert.equal(Object.hasOwn(f.calls[1].payload,'review'),false);
 }finally{await f.close();}
});
test('revision cannot automatically repeat after another failed review',async()=>{
 const f=await fixture(kind=>kind==='generate'?{status:'complete',content:delivery}:failureReview());try{
  if(role==='node'){const r=f.c.studio.start(input());await f.c.studio.task;assert.equal(f.c.studio.export(r.id,'receipt').requests,1);return;}
  const r=f.c.studio.start({revision:revisionInput()});await f.c.studio.task;assert.equal(f.c.studio.export(r.id,'receipt').status,'needs-review');assert.equal(f.calls.length,2);assert.equal(f.c.studio.busy,false);
 }finally{await f.close();}
});
test('failed revision retains downloadable original files and no unearned positive result',async()=>{
 const f=await fixture(()=>{throw Error('fixture provider outage');});try{
  if(role==='node'){assert.throws(()=>f.c.studio.start({revision:revisionInput()}));return;}
  const r=f.c.studio.start({revision:revisionInput()});await f.c.studio.task;
  assert.equal(f.c.studio.export(r.id,'receipt').status,'failed');assert.deepEqual(f.c.studio.export(r.id,'original-files'),studioDownload(makeHandoff(spec,wrongDelivery)));assert.throws(()=>f.c.studio.export(r.id,'files'),/FILES_UNAVAILABLE/);
 }finally{await f.close();}
});
test('reopened revision keeps both original and revised bytes without replaying work',async()=>{
 const f=await fixture();let second;try{
  if(role==='node'){assert.throws(()=>f.c.studio.start({revision:revisionInput()}));return;}
  const r=f.c.studio.start({revision:revisionInput()});await f.c.studio.task;await f.c.close();
  second=new Controller(f.home);await second.unlock('Fixture-only Studio password 123!');
  assert.equal(second.studio.export(r.id,'handoff').delivery,delivery);assert.deepEqual(second.studio.export(r.id,'original-files'),studioDownload(makeHandoff(spec,wrongDelivery)));assert.equal(f.calls.length,2);
 }finally{await second?.close();await f.close();}
});
test('old compute services cannot silently ignore revision feedback',async()=>{
 const f=await fixture();try{
  const originalFetch=f.c.companion.fetch;
  f.c.companion.fetch=async(url,options)=>{const r=await originalFetch(url,options);if(!url.endsWith('/health'))return r;const h=await r.json();h.capabilities=h.capabilities.filter(v=>v!=='revision');return Response.json(h);};
  const r=f.c.studio.start({revision:revisionInput()});await f.c.studio.task;
  const receipt=f.c.studio.export(r.id,'receipt');assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'COMPANION_COMPUTE_UPGRADE_REQUIRED');assert.equal(f.calls.length,0);assert.equal(f.c.companion.state.calls.length,1);
  assert.deepEqual(f.c.studio.export(r.id,'original-files'),studioDownload(makeHandoff(spec,wrongDelivery)));
 }finally{await f.close();}
});
