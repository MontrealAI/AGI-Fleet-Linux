import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ComputeWorker, createComputeServer, runCLI } from '../compute/server.mjs';
import { computeProfile, WORK_TOOLS, SKILLS } from '../compute/profile.mjs';
import { servicePlist } from '../compute/setup.mjs';
import { Companion, COMPANION_DEFAULT } from '../src/control/companion.mjs';
import { normalizeWork, checkDelivery, assertPrepared, deliveryURI } from '../src/work.mjs';
import { DECLARATION } from '../src/review.mjs';
import { ContentReader } from '../src/content.mjs';
import { deliveryPlan } from '../src/delivery.mjs';
import { Publisher } from '../src/publisher.mjs';
import { DEFAULT } from '../src/config.mjs';
import { imageSpec, png } from './image-fixture.mjs';
import { sampleSpec, goodDelivery } from './fixtures.mjs';
const answer=v=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(v)}}]});
const content=png().toString('base64'), spec=normalizeWork(imageSpec,DECLARATION);
function harness({fetchImpl,cli,limit=8}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-compute-test-'));
  const c={profileDir:dir,workspace:dir,gatewayPort:18896,gatewayToken:'b'.repeat(64),token:'a'.repeat(64),maxRuns24h:48,maxImages24h:limit,policyHash:'a'.repeat(64)};
  const calls=[];
  const worker=new ComputeWorker(c,{verifyPolicy:false,cleanupInventory:async()=>({status:"CAPTURED",containerIDs:[]}),fetchImpl:async(url,o)=>{calls.push(JSON.parse(o.body));return fetchImpl?fetchImpl(url,o):answer({status:'complete',content:'Blue square on white, following all criteria.'});},cli:async(c,args,signal)=>{if(args[0]==='sandbox')return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true};return (cli??(async(c,args)=>{const dest=args[args.indexOf('--output')+1];fs.writeFileSync(dest,Buffer.from(content,'base64'));return {ok:true,provider:'openai',model:'gpt-image-2',outputs:[{path:dest}]};}))(c,args,signal);}});
  return {worker,c,dir,calls,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('capable profile exposes reviewed skills and native sandbox tools, with no host wallet or API fallback',()=>{
  const c=computeProfile({token:'a'.repeat(64),port:18896,model:'openai/gpt-6-astra',workspace:'/tmp/compute',imageID:'sha256:'+'b'.repeat(64)});
  assert.deepEqual(c.agents.entries['agi-creator'].skills,SKILLS);assert.equal(c.tools.allow,undefined);assert.ok(c.agents.entries['agi-creator'].tools.allow.includes('exec'));
  assert.equal(c.tools.exec.host,'sandbox');assert.equal(c.tools.elevated.enabled,false);
  const s=c.agents.entries['agi-creator'].sandbox;assert.equal(s.mode,'all');assert.equal(s.scope,'session');assert.equal(s.workspaceAccess,'ro');assert.equal(s.docker.network,'none');assert.equal(s.docker.binds,undefined);
  assert.deepEqual(c.agents.entries['agi-checker'].tools.deny,['*']);assert.equal(c.auth.profiles['openai:agi-compute-pro'].mode,'oauth');assert.deepEqual(c.agents.defaults.model.fallbacks,[]);
  assert.match(servicePlist({role:'agent',node:'/path/a & b/node',profileDir:'/tmp/c'}),/a &amp; b/);
});
test('tool-enabled text work omits client tool suppression; image work returns real bytes and is counted',async()=>{
  const h=harness();try {
    const result=await h.worker.execute('generate',{specification:spec,attempt:1},{id:crypto.randomUUID()});
    assert.equal(checkDelivery(spec,result.content).decision,'approve');assert.equal(h.calls[0].tools,undefined);assert.equal(h.calls[0].tool_choice,undefined);
    assert.equal(h.calls[0].model,'openclaw/agi-creator');assert.equal(h.worker.state.images.length,1);assert.equal(h.worker.state.requests[0].status,'complete');
    assert.equal(fs.readdirSync(path.join(h.dir,'outputs')).length,0);
  }finally{h.close();}
});
test('image retries count before inference, quota and duplicate IDs stop repeated work',async()=>{
  const h=harness({limit:1,cli:async()=>{throw Error('fixture interrupted');}}),id=crypto.randomUUID();
  try {
    await assert.rejects(h.worker.execute('generate',{specification:spec,attempt:1},{id}));
    assert.equal(h.worker.state.images.length,1);assert.equal(h.worker.state.requests[0].status,'failed-or-uncertain');
    await assert.rejects(h.worker.execute('generate',{specification:spec,attempt:1},{id}),/ALREADY_RECORDED/);
    await assert.rejects(h.worker.execute('generate',{specification:spec,attempt:2},{id:crypto.randomUUID()}),/IMAGE_DAILY_LIMIT/);
    assert.equal(h.calls.length,1);
  }finally{h.close();}
});
test('compute service rejects output path substitution and symlinks',async()=>{
  for(const symlink of [false,true]) {
    const h=harness({cli:async(c,args)=>{const dest=args[args.indexOf('--output')+1];const other=path.join(c.profileDir,'other');fs.writeFileSync(other,Buffer.from(content,'base64'));if(symlink)fs.symlinkSync(other,dest);return {ok:true,provider:'openai',model:'gpt-image-2',outputs:[{path:symlink?dest:other}]};}});
    try {await assert.rejects(h.worker.execute('generate',{specification:spec,attempt:1},{id:crypto.randomUUID()}));}finally{h.close();}
  }
});
test('separate visual quality run receives pixels, tools are denied and uncertainty declines',async()=>{
  const h=harness({fetchImpl:async()=>answer({safeToReview:true,checks:[{id:'blue',status:'pass'},{id:'white',status:'uncertain'}]})});
  try {
    const r=await h.worker.execute('quality',{specification:spec,delivery:content},{id:crypto.randomUUID()});assert.equal(r.verdict,'decline');
    const request=h.calls[0];assert.equal(request.model,'openclaw/agi-checker');assert.equal(request.tool_choice,'none');assert.equal(request.messages[1].content[1].image_url.url,'data:image/png;base64,'+content);
  }finally{h.close();}
});
test('chunked image publication reconstructs exact bytes and never trusts Kubo alone',async()=>{
  const large=Buffer.alloc(800000);for(let i=0;i<large.length;i++)large[i]=i%251;
  const plan=deliveryPlan(large),blocks=new Map(plan.blocks.map(b=>[b.cid,b.bytes]));
  const reader=new ContentReader({...DEFAULT,maxContentBytes:4194304},async url=>blocks.get(new URL(url).pathname.slice(6)));
  assert.equal(plan.blocks.length,5);assert.deepEqual((await reader.read(plan.uri)).bytes,large);
  blocks.set(plan.blocks[0].cid,Buffer.from('tamper'));await assert.rejects(reader.read(plan.uri),/HASH_MISMATCH/);
});
test('PNG work binds the binary CID rather than the base64 string, and publisher verifies public bytes',async()=>{
  const binary=Buffer.from(content,'base64'), plan=deliveryPlan(binary), blocks=new Map();
  const reader=new ContentReader(DEFAULT,async url=>blocks.get(new URL(url).pathname.slice(6)));
  const publisher=new Publisher({...DEFAULT,execution:{...DEFAULT.execution,publicPublishing:true}},{reader,fetchImpl:async(url,o)=>{
    const u=new URL(url);if(u.pathname.endsWith('block/put')) {const bytes=Buffer.from(await o.body.get('file').arrayBuffer());const b=deliveryPlan(bytes).blocks[0];blocks.set(b.cid,bytes);return Response.json({Key:b.cid,Size:bytes.length});}
    if(u.pathname.endsWith('block/get'))return new Response(blocks.get(u.searchParams.get('arg')));
    throw Error('unexpected route');
  }});
  const uri=await publisher.publish(content,spec);assert.equal(uri,plan.uri);assert.equal(deliveryURI(content,spec),uri);
  assertPrepared({spec,content,uri,binding:'scope',stage:'published'},'scope');
  assert.throws(()=>assertPrepared({spec,content:content.slice(4),uri,binding:'scope',stage:'published'},'scope'));
});
test('compute HTTP boundary rejects browser origins and invalid bearer credentials',async()=>{
  const h=harness(), server=createComputeServer(h.worker);await new Promise(r=>server.listen(0,'127.0.0.1',r));h.c.port=server.address().port;
  const base=`http://127.0.0.1:${h.c.port}`;
  try {
    for(const headers of [{},{Authorization:'Bearer '+'x'.repeat(64)},{Authorization:'Bearer '+h.c.token,Origin:'https://foreign.test'}])assert.equal((await fetch(base+'/health',{headers})).status,401);
    const health=await fetch(base+'/health',{headers:{Authorization:'Bearer '+h.c.token}});assert.equal(health.status,200);assert.equal((await health.json()).protocol,'agi-compute/v1');
    assert.equal((await fetch(base+'/wallet/sign',{headers:{Authorization:'Bearer '+h.c.token}})).status,404);
  }finally{await new Promise(r=>server.close(r));h.close();}
});
test('wallet client rejects same-user compute and unreviewed policy changes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-compute-client-'));let now=Date.now(), uid=process.getuid?.()??0,hash='a'.repeat(64), inference=0;
  const c=new Companion(dir,()=> 'a'.repeat(64),{now:()=>now,fetchImpl:async(url,o)=>url.endsWith('/health')?Response.json({policyCurrent:true,protocol:'agi-compute/v1',uid,policyHash:hash,tools:true,gatewayReady:true,auth:'chatgpt-oauth'}):(inference++,answer({status:'ready'}))});
  try {
    await c.configure({...COMPANION_DEFAULT,mode:'tools',port:18894,timeoutMs:720000,enabled:true,acknowledged:true});
    await assert.rejects(c.request('test',{}),/SEPARATE_COMPUTE_USER/);assert.equal(inference,0);
    now+=600000;uid=1001+(process.getuid?.()??0);await c.request('test',{}, {cacheMs:0});assert.equal(inference,1);
    now+=600000;hash='b'.repeat(64);await assert.rejects(c.request('generate',{specification:normalizeWork(sampleSpec,DECLARATION),attempt:1},{cacheMs:0}),/POLICY_CHANGED/);assert.equal(inference,1);
  }finally{await c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('sandbox cleanup failure blocks future compute without resetting usage history',async()=>{
 const h=harness({fetchImpl:async()=>answer({status:'complete',content:JSON.stringify(goodDelivery)})});
 let cleanup=0;h.worker.cli=async()=>{cleanup++;if(cleanup>1)throw Error('fixture docker outage');return {ok:true,exitStatus:0,signal:null,elapsedMs:1,timeoutMs:30000,timedOut:false,started:true,processTerminationConfirmed:true};};
 try {
  await assert.rejects(h.worker.execute('generate',{specification:normalizeWork(sampleSpec,DECLARATION),attempt:1},{id:crypto.randomUUID()}),/CLEANUP_FAILED/);
  assert.equal(h.worker.state.calls.length,1);assert.equal(h.worker.state.requests[0].status,'cleanup-required');assert.ok(fs.existsSync(path.join(h.dir,'COMPUTE_STOP')));
  await assert.rejects(h.worker.execute('test',{}, {id:crypto.randomUUID()}),/CLEANUP_FAILED/);assert.equal(h.worker.state.calls.length,1);
 }finally{h.close();}
});

test('CLI output overflow terminates even a child that ignores SIGTERM',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-compute-cli-')),file=path.join(dir,'fixture-cli');
 const node=path.join(dir,'node'),docker=path.join(dir,'docker');fs.writeFileSync(node,`\x23!/bin/sh\nexec '${process.execPath}' \"$@\"\n`,{mode:0o700});fs.writeFileSync(docker,'\x23!/bin/sh\nprintf \'29.8.0\\n\'\n',{mode:0o700});
 // This executable has no network, credentials or wallet. It deliberately ignores TERM.
 fs.writeFileSync(file,`\x23!${process.execPath}\nimport fs from 'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync('child-pid',String(process.pid));setInterval(()=>{},1000);process.stdout.write('x'.repeat(1100000));\n`,{mode:0o700});
 try {
  await assert.rejects(runCLI({role:'agent',home:dir,node,docker,openclaw:file,profileDir:dir,gatewayConfig:path.join(dir,'unused.json')},[],AbortSignal.timeout(10000)),/OUTPUT_LIMIT/);
  const pid=Number(fs.readFileSync(path.join(dir,'child-pid'),'utf8'));
  const ended=await new Promise(resolve=>{let attempts=0;const timer=setInterval(()=>{try{process.kill(pid,0);}catch{clearInterval(timer);resolve(true);}if(++attempts>40){clearInterval(timer);resolve(false);}},100);});
  assert.equal(ended,true,'overflow child must be killed, not left running');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('maximum PNG payload plus full image brief fits the bounded quality transport',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-large-image-wire-'));let now=Date.now(), sent=0;
 const c=new Companion(dir,()=> 'a'.repeat(64),{now:()=>now,fetchImpl:async(url,o)=>{
  if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v1',uid:1001+(process.getuid?.()??0),policyHash:'a'.repeat(64),tools:true,gatewayReady:true,auth:'chatgpt-oauth'});
  const body=JSON.parse(o.body);sent=Buffer.byteLength(body.messages[1].content);return answer(o.headers['x-agi-kind']==='test'?{status:'ready'}:{verdict:'pass'});
 }});
 try {
  await c.configure({...COMPANION_DEFAULT,mode:'tools',port:18894,timeoutMs:720000,enabled:true,acknowledged:true});await c.request('test',{}, {cacheMs:0});now+=31000;
  const large={...imageSpec,prompt:'p'.repeat(6000),criteria:Array.from({length:16},(_,i)=>({id:'criterion-'+i,requirement:'r'.repeat(500)}))};
  // Wire-boundary fixture: PNG validation is exercised separately before this transport.
  const result=await c.request('quality',{specification:normalizeWork(large,DECLARATION),delivery:Buffer.alloc(4194304).toString('base64')},{cacheMs:0});
  assert.equal(result.verdict,'pass');assert.ok(sent>5600000 && sent<5650000);
 }finally{await c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
