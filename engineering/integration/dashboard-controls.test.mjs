// SPDX-License-Identifier: MIT
// Benign protocol/parser fixtures only: no browser, Docker, provider or native execution proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {privateDashboardControlDriver} from './fleet-dashboard.mjs';
import {inspectDashboardControlObservation,inspectDashboardPng} from './verify-dashboard.mjs';
import {sha256} from './bridge.mjs';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const event={phase:'prepared',actor:'public-actor',grant:'public-grant',commitment:'1'.repeat(64),taskSha256:'2'.repeat(64)};
const emit=value=>'process.stdout.write('+JSON.stringify(JSON.stringify(value)+'\n')+');';
const complete={phase:'complete',terminal:{run:'public-run',state:'complete',receipt:{summary:'répétition'}},stop:null,reconciled:null};
test('private NDJSON protocol waits for inspected preparation and authorization before the next permission',async()=>{
  const code=`import readline from 'node:readline';const lines=readline.createInterface({input:process.stdin})[Symbol.asyncIterator]();await lines.next();${emit(event)}const first=JSON.parse((await lines.next()).value);if(first.continue!=='authorize')process.exit(2);${emit({phase:'authorized',grant:event.grant,commitment:event.commitment})}const second=JSON.parse((await lines.next()).value);if(second.continue!=='run')process.exit(3);${emit(complete)}process.exit(0);`,seen=[];
  const actual=await privateDashboardControlDriver(process.execPath,['--input-type=module','-e',code],{input:{publicProtocolFixture:true},expectedPhases:['prepared','authorized','complete'],handlers:{prepared:async value=>{seen.push(value.phase);return {continue:'authorize'};},authorized:async value=>{seen.push(value.phase);return {continue:'run'};}}});
  assert.deepEqual(seen,['prepared','authorized']);assert.deepEqual(actual,complete);
});
test('early child exit cancels a pending step and returns only a generic error',async()=>{
  let signal;await assert.rejects(privateDashboardControlDriver(process.execPath,['-e',emit(event)+'setTimeout(()=>process.exit(0),25);'],{input:{publicProtocolFixture:true},timeout:2000,expectedPhases:['prepared','complete'],handlers:{prepared:async(_,context)=>{signal=context.signal;return new Promise(()=>{});}}}),error=>error.message==='DASHBOARD_DRIVER_FAILED'&&error.cause===undefined&&error.stderr===undefined);assert.equal(signal.aborted,true);
});
test('bounded idle protocol timeout cancels a pending step',{timeout:15000},async context=>{
  // Child startup uses real time; advance the existing deadline only after handler entry.
  context.mock.timers.enable({apis:['setTimeout']});
  let signal,beforeDeadline,atDeadline;
  await assert.rejects(privateDashboardControlDriver(process.execPath,['-e',emit(event)+'setInterval(()=>{},1000);'],{
    input:{publicProtocolFixture:true},timeout:200,signal:AbortSignal.timeout(10000),expectedPhases:['prepared','complete'],
    handlers:{prepared:async(_,stepContext)=>{
      signal=stepContext.signal;context.mock.timers.tick(199);beforeDeadline=signal.aborted;
      context.mock.timers.tick(1);atDeadline=signal.aborted;return new Promise(()=>{});
    }}
  }),/DASHBOARD_DRIVER_FAILED/);
  assert.equal(beforeDeadline,false);assert.equal(atDeadline,true);assert.equal(signal.aborted,true);
});
function crc32(raw){let crc=0xffffffff;for(const byte of raw){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(name,raw){const kind=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(raw.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,raw])));return Buffer.concat([size,kind,raw,crc]);}
function publicWhitePng(width=1440,height=1100){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const row=width*3+1,pixels=Buffer.alloc(row*height,255);for(let y=0;y<height;y++)pixels[y*row]=0;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
test('bounded PNG inspection decodes actual ordinary pixel bytes and dimensions',()=>{
  assert.deepEqual(inspectDashboardPng(publicWhitePng()),{width:1440,height:1100});assert.deepEqual(inspectDashboardPng(publicWhitePng(1,1),{width:1,height:1}),{width:1,height:1});
  assert.throws(()=>inspectDashboardPng(publicWhitePng(1,1)));
});
const image='sha256:'+'3'.repeat(64),actor='public-actor',grant={grant:'public-grant',commitment:'4'.repeat(64)},taskSha256='5'.repeat(64),terminal={run:'public-run',state:'complete',receipt:{publicFixture:true}},interrupted={run:'public-stopped-run',error:'STOPPED'},stop={state:'STOP',cleanup:'in-progress'},plan={run:interrupted.run,commitment:'6'.repeat(64),eligible:true,kind:'recorded-scripted-computer-closure',replayAllowed:false,observationSha256:'7'.repeat(64)},reconciled={state:'reconciled',receipt:{disposition:'closed-without-success'}};
const raw=publicWhitePng();
for(const [mode,language,resume]of [['execute','en',false],['execute','fr',true],['interrupt','fr',true],['stop','en',false],['reconcile','fr',false]])test('ordinary '+mode+'/'+language+' observation binds exact sequence, public identifiers and retained PNG',()=>{
  const executing=['execute','interrupt'].includes(mode),expected=['connect',...(language==='fr'?['language-fr']:[])],stages=executing?(mode==='interrupt'?['prepared','before-stop','terminal']:['prepared','terminal']):mode==='stop'?['stopped']:['reconciliation','reconciled'];
  expected.push(...(executing?[...(resume?['resume']:[]),'activate','doctor','select-actor','upload-exact-handoff','confirm-public-inputs','computerPrepare','authorize','run',...(mode==='interrupt'?['stop']:[]),'refresh']:mode==='stop'?['stop']:['inspect-recovery','reconcile','refresh']));
  const value={schema:'agi-fleet/real-dashboard-control-observation/v1',evidenceClass:'REAL_CHROMIUM_ACTUAL_SAVED_SERVICE_CONTROLS',driverSha256:'8'.repeat(64),mode,language,actor,image,networkMode:'host; driver restricts every request to the existing loopback service origin',osNetworkIsolationClaim:false,nativeWorkerNetwork:'none',credentialFieldMasked:true,credentialFieldCleared:true,credentialRetainedInEvidence:false,traceRecorded:false,providerRequests:0,realWallets:false,unexpectedExternalRequests:[],pageErrors:[],browserVersion:'public-parser-fixture',playwrightVersion:'public-parser-fixture',automationSteps:expected,automationStepCount:expected.length,guiAutomatedElapsedSeconds:2,runRequestElapsedSeconds:executing?1:null,humanElapsedMinutes:null,deviceCost:null,screenshots:stages.map(stage=>({stage,mediaType:'image/png',bytes:raw.length,sha256:sha256(raw),contentBase64:raw.toString('base64')}))};
  if(executing){value.preparation={...grant,actor,taskSha256};value.authorization={grant:grant.grant,state:'authorized'};const actual=mode==='interrupt'?interrupted:terminal;value.run={id:actual.run,state:actual.state??null,error:actual.error??null,receiptSha256:actual.receipt?sha256(canonical(actual.receipt)):null};}
  if(['stop','interrupt'].includes(mode))value.stop=stop;if(mode==='reconcile'){value.reconciliation=plan;value.reconciled={run:plan.run,state:reconciled.state,receiptSha256:sha256(canonical(reconciled.receipt))};}
  const context={mode,language,resume,actor,image,grant,taskSha256,terminal:mode==='interrupt'?interrupted:terminal,stop:['stop','interrupt'].includes(mode)?stop:null,plan,reconciled,driverSha256:'8'.repeat(64)};
  assert.equal(inspectDashboardControlObservation(value,context),value);assert.throws(()=>inspectDashboardControlObservation({...value,humanElapsedMinutes:1},context));
  if(executing)assert.throws(()=>inspectDashboardControlObservation({...value,preparation:{...value.preparation,taskSha256:'9'.repeat(64)}},context));
});
test('Python public task digest uses the same exact UTF-8 canonical JSON as the Node inspector',()=>{
  const input={schema:'public-parser-fixture',input:{handoffRaw:'Public café\r\nline',publicNonpersonal:true},review:null},driver=new URL('./fleet-dashboard-export.py',import.meta.url).pathname;
  const code='import ast,hashlib,json,pathlib,sys; source=ast.parse(pathlib.Path(sys.argv[1]).read_text()); selected=ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name in {"sha","json_sha"}],type_ignores=[]); exec(compile(selected,"public-digest-functions","exec")); print(json_sha(json.load(sys.stdin)))';
  const actual=execFileSync('python3',['-B','-c',code,driver],{input:JSON.stringify(input),encoding:'utf8'}).trim();assert.equal(actual,sha256(canonical(input)));
});
