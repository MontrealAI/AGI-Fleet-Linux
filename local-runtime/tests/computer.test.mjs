// These boundary fixtures make no Docker, browser, provider or economic qualification claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import {fixture,task} from './helpers.mjs';
import {canonical,digest,parseStrict,id} from '../contracts.mjs';
import {LocalRuntime} from '../supervisor/runtime.mjs';
import {LinuxSandbox} from '../platforms/linux.mjs';
import {validateComputerInput,inspectComputerInstallation,verifyAlphaImportClosure,createComputerProfile,callComputer,ALPHA_COMPUTER_SOURCE,LAUNCHER,COMPUTER_LIMITS} from '../computer/profile.mjs';
import {computerArtifactInventory} from '../computer/backend.mjs';

const raw=canonical({schema:'successor-alpha-computer-handoff/v1',authority:'none',settlement:'not_connected',task:{input_rights:'synthetic'}});
const computerTask=()=>({...task(),action:'alpha-computer-run',input:{handoffRaw:raw,publicNonpersonal:true}});
const preparation={runtimeIdentity:'a'.repeat(64),permit:'b'.repeat(64),handoffSha256:digest(raw),maxSeconds:20,maxActions:2,maxTurns:2,artifactReservationBytes:80_000_000,provider:{model:'SCRIPTED_TEST_DOUBLE'},providerRequests:0,scriptedAdvice:true};
function synthetic(options={}){return fixture({inspect:()=>({supported:true,backend:'synthetic-boundary',identity:'synthetic-host',alphaComputer:{mode:'scripted-zero-cost',runtimeIdentity:preparation.runtimeIdentity,evidenceClass:'SYNTHETIC_COMPUTER_REHEARSAL',preparation}}),execute:async()=>({result:{files:[],scriptedAdvice:true,providerRequests:0,authority:'none',independentReview:false},observation:{processGroupGone:true,providerCalls:0,runtimeIdentity:preparation.runtimeIdentity,evidenceClass:'SYNTHETIC_COMPUTER_REHEARSAL'}}),...options});}
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'fleet-computer-test-'));
const write=(file,bytes)=>fs.writeFileSync(file,bytes,{mode:0o600});

test('Computer Use is disabled by default; public assertion, exact keys and live cost modes fail closed',()=>{
  assert.equal(inspectComputerInstallation(null).code,'COMPUTER_DISABLED');
  assert.throws(()=>validateComputerInput({handoffRaw:raw,publicNonpersonal:false}),/COMPUTER_PUBLIC_NONPERSONAL_REQUIRED/);
  assert.throws(()=>validateComputerInput({handoffRaw:raw,publicNonpersonal:true,image:'attacker'}),/FIELDS_INVALID/);
  assert.throws(()=>createComputerProfile({handoffRaw:raw,actions:[{type:'type',text:'password=synthetic-placeholder'}]}),/PRIVATE_INPUT/);
  assert.throws(()=>validateComputerInput({handoffRaw:'x'.repeat(COMPUTER_LIMITS.handoffBytes+1),publicNonpersonal:true}),/COMPUTER_HANDOFF_SIZE/);
  const f=fixture();try{const a=f.create();assert.throws(()=>f.prepare(a,computerTask()),/COMPUTER_DISABLED/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);const native=new LinuxSandbox();native.inspect=()=>({supported:true,backend:'synthetic-readonly-descriptor',identity:'synthetic-host'});f.runtime.backend=native;assert.equal(f.runtime.admission({actor:a.id,task:null},f.operator).status,'OUTSIDE_SCOPE');}finally{f.close();}
  const directory=temporary();try{
    const profile={schema:'agi-fleet/alpha-computer-installation/v1',enabled:true,alphaRoot:'/unused',source:ALPHA_COMPUTER_SOURCE,python:'/unused',pythonSha256:'',image:'',dockerSha256:'',provider:{mode:'live-paid'},fixture:{},fixtureSha256:'',runtimeFiles:{}};
    const file=path.join(directory,'profile.json');write(file,canonical(profile));assert.equal(inspectComputerInstallation(file).code,'UNCOMMISSIONED_PROVIDER_COST');
    fs.chmodSync(file,0o644);assert.equal(inspectComputerInstallation(file).code,'PRIVATE_FILE_REQUIRED');
    fs.chmodSync(file,0o600);fs.symlinkSync(file,path.join(directory,'alias.json'));assert.equal(inspectComputerInstallation(path.join(directory,'alias.json')).code,'COMPUTER_PROFILE_PATH');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('synthetic Computer Use admission is labelled, exact authorized and one use; it cannot acquire native evidence',async()=>{
  const f=synthetic();try{
    const a=f.create(),g=f.prepare(a,computerTask());assert.equal(g.admission.binding.computer.evidenceClass,'SYNTHETIC_COMPUTER_REHEARSAL');assert.equal(g.admission.binding.tools.network,'exact-public-read-broker');assert.equal(g.limits.modelCalls,0);
    assert.equal(g.admission.qualification.productionQualified,false);assert.match(g.admission.acceptedContract.checks,/do not establish economic acceptance/);
    await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);f.authorize(g);assert.equal((await f.run(a,g)).state,'complete');await assert.rejects(f.run(a,g),/GRANT_UNAVAILABLE/);
    const next=f.prepare(a,computerTask());f.authorize(next);f.backend.execute=async()=>({result:{scriptedAdvice:true,providerRequests:0,authority:'none',independentReview:false},observation:{processGroupGone:true,providerCalls:0,runtimeIdentity:preparation.runtimeIdentity,evidenceClass:'NATIVE_ALPHA_SCRIPTED_REHEARSAL'}});
    await assert.rejects(f.run(a,next),/COMPUTER_EVIDENCE_CLASS/);assert.equal(f.runtime.store.meta('stopped'),true);
  }finally{f.close();}
});

test('source/model/image/fixture drift blocks authorization without consuming a Computer Use grant',()=>{
  const f=synthetic();try{const a=f.create(),g=f.prepare(a,computerTask()),inspect=f.backend.inspect;f.backend.inspect=()=>{const h=inspect();h.alphaComputer.preparation={...preparation,permit:'c'.repeat(64)};return h;};assert.throws(()=>f.authorize(g),/CAPABILITY_DRIFT_REAUTHORIZE/);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'prepared');}finally{f.close();}
});

test('Computer Use STOP interrupts active work, consumes reservations and refuses replay after restart',async()=>{
  let started;const ready=new Promise(resolve=>started=resolve);const f=synthetic({execute:({signal,revalidate})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('RUN_CANCELLED')),{once:true});})});
  try{const a=f.create(),g=f.prepare(a,computerTask());f.authorize(g);const running=f.run(a,g);await ready;f.runtime.stop({actor:null},f.operator);await assert.rejects(running,/RUN_CANCELLED/);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');assert.equal(f.runtime.status(f.operator).runs[0].state,'uncertain');f.runtime.close();const reopened=new LocalRuntime(f.directory,{backend:f.backend});try{await assert.rejects(reopened.run({actor:a.id,grant:g.grant},f.operator),/STOP_RECONCILIATION_REQUIRED/);assert.equal(reopened.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,1);}finally{reopened.close();}}finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('Computer Use pending and consumed artifact reservations are bounded without pruning history',()=>{
  const f=synthetic();try{const a=f.create();for(let i=0;i<4;i++)f.prepare(a,computerTask());assert.throws(()=>f.prepare(a,computerTask()),/COMPUTER_HISTORY_CAPACITY/);assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,4);}finally{f.close();}
});

test('native artifact exports retain actor scope, fixed names and exact hashes after STOP and configuration removal',async()=>{
  const f=synthetic();try{
    const a=f.create(),b=f.create(),own=f.runtime.issueClient(a.id).principal,other=f.runtime.issueClient(b.id).principal,g=f.prepare(a,computerTask()),run=id(),directory=path.join(f.directory,'runs',run+'-fixture','computer');fs.mkdirSync(directory,{recursive:true,mode:0o700});
    write(path.join(directory,'computer-return.json'),'{"authority":"none"}');write(path.join(directory,'screen-000.png'),Buffer.from('89504e470d0a1a0a00000000','hex'));
    const artifacts=computerArtifactInventory(directory),observation={backend:'native-alpha-computer-scripted/v1',artifactDirectory:run+'-fixture/computer',artifacts};
    f.runtime.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'complete',?,?)").run(run,a.id,g.grant,canonical({reservedAt:Date.now()}),canonical({observation}));f.runtime.stop({actor:null},f.operator);f.backend.inspect=()=>({supported:false,code:'COMPUTER_DISABLED'});
    const returned=await f.runtime.dispatch('computer-export',{actor:a.id,run},own);assert.equal(returned.sha256,digest(returned.content));const png=await f.runtime.dispatch('computer-artifact',{actor:a.id,run,name:'screen-000.png'},own);assert.equal(digest(Buffer.from(png.contentBase64,'base64')),png.sha256);
    const saved=[],context={document:{querySelectorAll:()=>[],getElementById:()=>({})},TextEncoder,Uint8Array,crypto:webcrypto,atob,
      dispatch:(action,input)=>f.runtime.dispatch(action,input,own),retain:(...value)=>saved.push(value)};
    const script=fs.readFileSync(new URL('../../local-dashboard/app.js',import.meta.url),'utf8');
    vm.runInNewContext(script+';button=(label,fn)=>({label,run:fn});api=dispatch;save=retain;globalThis.outputs=appendComputerOutputs;globalThis.setLanguage=value=>{language=value;};',context);
    for(const language of ['en','fr']){
      context.setLanguage(language);const buttons=[],row={append:value=>buttons.push(value)};
      context.outputs(row,{actor:a.id,id:run},{files:[],artifacts,nativeState:'review'});
      assert.equal(buttons.length,2,'actual backend result shape exposes native return and screenshot');
      assert.equal(buttons[0].label,language==='fr'?'Enregistrer le retour natif pour Alpha':'Save native return for Alpha');
      assert.equal(buttons[1].label,(language==='fr'?'Enregistrer la capture ':'Save screenshot ')+'screen-000.png');
      await buttons[0].run();assert.equal(saved.at(-1)[0],'computer-return.json');assert.equal(saved.at(-1)[1],returned.content);
      await buttons[1].run();assert.equal(saved.at(-1)[0],'screen-000.png');assert.deepEqual(Buffer.from(saved.at(-1)[1]),Buffer.from(png.contentBase64,'base64'));
    }
    for(const result of [null,{files:[{name:'computer-return.json'}]},{files:[],artifacts:[]},{files:[],artifacts:[{name:'computer-return.json',mediaType:'image/png'}]}]){
      const buttons=[];context.outputs({append:value=>buttons.push(value)},{actor:a.id,id:run},result);assert.equal(buttons.length,0,'missing native-return JSON inventory cannot offer computer downloads');
    }
    await assert.rejects(f.runtime.dispatch('computer-export',{actor:a.id,run},other),/CLIENT_SCOPE_DENIED/);await assert.rejects(f.runtime.dispatch('computer-export',{actor:b.id,run},own),/CLIENT_SCOPE_DENIED/);
    await assert.rejects(f.runtime.dispatch('computer-artifact',{actor:a.id,run,name:'../computer-return.json'},own),/COMPUTER_ARTIFACT_NAME/);
    write(path.join(directory,'screen-000.png'),'changed');await assert.rejects(f.runtime.dispatch('computer-artifact',{actor:a.id,run,name:'screen-000.png'},own),/COMPUTER_ARTIFACT_CHANGED/);
    fs.unlinkSync(path.join(directory,'computer-return.json'));fs.symlinkSync('/etc/hostname',path.join(directory,'computer-return.json'));await assert.rejects(f.runtime.dispatch('computer-export',{actor:a.id,run},own),/ELOOP/);
  }finally{f.close();}
});

test('artifact inventories reject forged PNG MIME, unknown filenames, public permissions and hardlinks',()=>{
  const directory=temporary();try{write(path.join(directory,'screen-000.png'),'not-png');assert.throws(()=>computerArtifactInventory(directory),/COMPUTER_ARTIFACT_MIME/);fs.unlinkSync(path.join(directory,'screen-000.png'));write(path.join(directory,'unexpected.html'),'x');assert.throws(()=>computerArtifactInventory(directory),/COMPUTER_ARTIFACT_NAME/);fs.unlinkSync(path.join(directory,'unexpected.html'));write(path.join(directory,'visible-text.txt'),'public');fs.chmodSync(path.join(directory,'visible-text.txt'),0o644);assert.throws(()=>computerArtifactInventory(directory),/COMPUTER_ARTIFACT_INVALID/);fs.chmodSync(path.join(directory,'visible-text.txt'),0o600);fs.linkSync(path.join(directory,'visible-text.txt'),path.join(directory,'receipt.json'));assert.throws(()=>computerArtifactInventory(directory),/COMPUTER_ARTIFACT_INVALID/);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Alpha import closure rejects masked tracked edits, untracked import packages and linked source directories',()=>{
  const root=temporary(),tracked=new Map();const add=(relative,content)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});write(file,content);tracked.set(relative,createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0').update(content).digest('hex'));};
  try{add('alpha_factory_v1/__init__.py','VALUE=1\n');add('requirements-agent.lock','locked\n');verifyAlphaImportClosure(root,tracked);write(path.join(root,'alpha_factory_v1/__init__.py'),'VALUE=2\n');assert.throws(()=>verifyAlphaImportClosure(root,tracked),/COMPUTER_ALPHA_SOURCE/);write(path.join(root,'alpha_factory_v1/__init__.py'),'VALUE=1\n');fs.mkdirSync(path.join(root,'alpha_factory_v1/shadow'));write(path.join(root,'alpha_factory_v1/shadow/__init__.py'),'');assert.throws(()=>verifyAlphaImportClosure(root,tracked),/COMPUTER_UNTRACKED_IMPORT/);fs.rmSync(path.join(root,'alpha_factory_v1/shadow'),{recursive:true});fs.symlinkSync(path.join(root,'alpha_factory_v1'),path.join(root,'linked'));assert.throws(()=>verifyAlphaImportClosure(root,tracked),/COMPUTER_ALPHA_SOURCE/);fs.unlinkSync(path.join(root,'linked'));fs.mkdirSync(path.join(root,'pydantic_core'));write(path.join(root,'pydantic_core/__init__.so'),'synthetic non-executable extension fixture');const selected=spawnSync('python',['-I','-S','-B','-c','import importlib.machinery,sys; finder=importlib.machinery.FileFinder(sys.argv[1],(importlib.machinery.ExtensionFileLoader,importlib.machinery.EXTENSION_SUFFIXES)); print(type(finder.find_spec("pydantic_core").loader).__name__)',root],{encoding:'utf8'});assert.equal(selected.status,0,selected.stderr);assert.equal(selected.stdout.trim(),'ExtensionFileLoader');assert.throws(()=>verifyAlphaImportClosure(root,tracked),/COMPUTER_UNTRACKED_IMPORT/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('native launcher executes committed Python source even with timestamp-valid malicious cached bytecode',()=>{
  const root=temporary();try{const script=`import importlib.util, py_compile, pathlib, os\np=pathlib.Path(${JSON.stringify(root)})/'cached_fixture.py'\np.write_text('VALUE=2\\n'); stamp=p.stat().st_mtime\npy_compile.compile(str(p),doraise=True)\np.write_text('VALUE=1\\n');os.utime(p,(stamp,stamp))\nspec=importlib.util.spec_from_file_location('fleet_launcher',${JSON.stringify(LAUNCHER)})\nmodule=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\nmodule.install_source_only_imports(p.parent)\nimport cached_fixture\nassert cached_fixture.VALUE==1, 'malicious timestamp-valid cache executed'\nprint('source-only')\n`;const result=spawnSync('python',['-B','-c',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'source-only');
    const environment=path.join(root,'environment'),venv=spawnSync('python',['-m','venv','--copies','--without-pip',environment],{encoding:'utf8'});assert.equal(venv.status,0,venv.stderr);
    const version=spawnSync(path.join(environment,'bin/python'),['-I','-S','-c','import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'],{encoding:'utf8'}).stdout.trim(),site=path.join(environment,'lib','python'+version,'site-packages'),sentinel=path.join(root,'STARTUP_EXECUTED');
    write(path.join(site,'unsafe.pth'),`import pathlib; pathlib.Path(${JSON.stringify(sentinel)}).write_text('unsafe')\n`);write(path.join(site,'sitecustomize.py'),`from pathlib import Path; Path(${JSON.stringify(sentinel)}).write_text('unsafe')\n`);
    const modules={'alpha_factory_v1/__init__.py':'','alpha_factory_v1/core/__init__.py':'','alpha_factory_v1/core/runtime/__init__.py':'','alpha_factory_v1/core/runtime/store.py':'Journal = None\n','alpha_factory_v1/core/runtime/successor/__init__.py':'','alpha_factory_v1/core/runtime/successor/computer.py':'import sys\nassert sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode\n','alpha_factory_v1/core/runtime/successor/computer_handoff.py':'ComputerHandoff = write_computer_return = None\n','alpha_factory_v1/core/runtime/successor/protocol.py':'safe_json_loads = None\n'};
    for(const [relative,content] of Object.entries(modules)){const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});write(file,content);}
    const probe=callComputer({alphaRoot:root,python:path.join(environment,'bin/python')},'probe');assert.ok(Object.keys(probe.files).length>0);assert.equal(fs.existsSync(sentinel),false,'untracked .pth/sitecustomize startup executed');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Computer Use reconciliation requires exact native closure and retains STOP, consumed budget and historical exports',async()=>{
  for(const invalid of [null,'synthetic','provider','open-container','wrong-runtime','paid']){
    const f=synthetic({execute:async()=>{throw Error('RUN_CANCELLED');}});try{
      const a=f.create(),g=f.prepare(a,computerTask());f.authorize(g);await assert.rejects(f.run(a,g),/RUN_CANCELLED/);const row=f.runtime.store.db.prepare('SELECT * FROM runs').get(),value=parseStrict(row.value);
      value.admission.binding.computer.evidenceClass=invalid==='synthetic'?'SYNTHETIC_COMPUTER_REHEARSAL':'NATIVE_ALPHA_SCRIPTED_REHEARSAL';if(invalid==='paid')value.spendUSDC='1';
      const observation={backend:'native-alpha-computer-scripted/v1',evidenceClass:'NATIVE_ALPHA_SCRIPTED_REHEARSAL',runtimeIdentity:invalid==='wrong-runtime'?'e'.repeat(64):preparation.runtimeIdentity,processGroupGone:true,containerClosed:invalid!=='open-container',providerCalls:invalid==='provider'?1:0};
      f.runtime.store.db.prepare('UPDATE runs SET value=?,result=? WHERE id=?').run(canonical(value),canonical({error:'RUN_CANCELLED',observation}),row.id);
      const plan=await f.runtime.dispatch('reconciliation',{run:row.id},f.operator);assert.equal(plan.eligible,invalid===null);
      if(invalid===null){await f.runtime.dispatch('reconcile',{run:row.id,commitment:plan.commitment,confirm:true},f.operator);assert.equal(f.runtime.store.meta('stopped'),true);assert.equal(f.runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(g.grant).state,'consumed');}
    }finally{f.close();}
  }
});
