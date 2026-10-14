// Genuine saved-package install/start/isolation/output/update/remove gate.
// No live provider, physical-machine or independent economic review claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

process.umask(0o077);
const archive=process.env.AGI_LOCAL_PACKAGE_ARCHIVE,nodeArchive=process.env.AGI_LOCAL_NODE_ARCHIVE;
assert.ok(archive&&nodeArchive,'Set both exact archive paths; missing prerequisites fail this gate.');
const installer=fileURLToPath(new URL('../install.py',import.meta.url));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-installed-')),root=path.join(directory,'installation'),state=path.join(directory,'state');
const sha=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
let child,exit;
function command(...args){
  const r=spawnSync('python3',[installer,...args],{encoding:'utf8',timeout:120000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(r.status,0,r.stderr);return r.stdout;
}
try {
  const install=JSON.parse(command('install','--archive',archive,'--sha256',sha,'--node-archive',nodeArchive,'--root',root,'--state',state,'--confirm'));
  assert.equal(install.authority,'none');assert.equal(install.started,false);
  const initialized=JSON.parse(command('launch','--root',root,'--','init'));
  assert.equal(initialized.installed,true);
  const token=fs.readFileSync(path.join(state,'operator.token'),'utf8').trim();
  const metadata=JSON.parse(fs.readFileSync(path.join(root,'installation.json'),'utf8'));
  const node=path.join(root,'versions',metadata.current,'runtime/node');
  const cli=path.join(root,'versions',metadata.current,'application/local-runtime/cli/main.mjs');
  let address;
  async function start(){
    child=spawn(node,[cli,'serve'],{env:{PATH:'/usr/bin:/bin',HOME:os.homedir(),AGI_LOCAL_STATE:state},stdio:['ignore','pipe','pipe']});
    exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    let error='';child.stderr.on('data',b=>{error+=b;});
    address=await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(Error('Installed startup timeout: '+error)),15000);
      child.once('exit',code=>{clearTimeout(timer);reject(Error('Installed service exited '+code+': '+error));});
      child.stdout.on('data',b=>{text+=b;if(text.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(text.split('\n')[0]));}catch(e){reject(e);}}});
    });
  }
  await start();
  async function request(action,input={},credential=token){
    const r=await fetch(address.url+'/v1/'+action,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error'});
    const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;
  }
  const host=await request('doctor');assert.equal(host.supported,true,JSON.stringify(host));
  const actor=await request('create',{role:'agent',name:'Installed source analyst'});
  await request('activate',{actor:actor.id,confirm:true});
  const scoped=await request('client',{actor:actor.id});
  const tokenFile=path.join(directory,'scoped.token');fs.writeFileSync(tokenFile,scoped.token,{mode:0o600});
  const {invoke}=await import(pathToFileURL(path.join(path.dirname(cli),'../clients/openclaw/client.mjs')).href);
  const config={actor:actor.id,role:'agent',agentId:'fleet-'+actor.id,socket:path.join(state,'control.sock'),tokenFile};
  const mission=await request('example',{kind:'analyst',language:'fr'});
  const task={schema:'agi-fleet/local-task/v1',action:'successor-run',workspace:'files',input:{mission,variant:'improved'},review:'none',sourceActor:null,sourceController:null};
  const grant=await invoke(config,{operation:'prepare',task});
  await request('authorize',{grant:grant.grant,commitment:grant.commitment,confirm:true});
  const run=await invoke(config,{operation:'run',grant:grant.grant});
  assert.equal(run.state,'complete');assert.equal(run.receipt.result.checker.passed,true);
  assert.equal(run.receipt.observation.privateNamespacesEnded,true);
  const files=run.receipt.result.files;
  const output=path.join(directory,'operator-output');fs.mkdirSync(output);
  for(const file of files){assert.match(file.name,/^[a-z0-9-]+\.[a-z]+$/);fs.writeFileSync(path.join(output,file.name),file.content);assert.equal(fs.readFileSync(path.join(output,file.name),'utf8'),file.content);}
  assert.match(fs.readFileSync(path.join(output,'report.html'),'utf8'),/<table/);
  await request('stop',{actor:null});
  child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});child=null;
  // Reuse the unchanged assistant endpoint and credential after a genuine CLI
  // process restart. Resume is explicit; old grants and budgets do not reset.
  await start();
  const stopped=await invoke(config,{operation:'status'});assert.equal(stopped.stopped,true);assert.equal(stopped.runs.length,1);
  assert.deepEqual((await invoke(config,{operation:'output',run:run.run})).receipt,run.receipt);
  await assert.rejects(invoke(config,{operation:'run',grant:grant.grant}),/STOP_RECONCILIATION_REQUIRED|GRANT_UNAVAILABLE/);
  await request('resume',{confirm:true});await request('activate',{actor:actor.id,confirm:true});
  await assert.rejects(invoke(config,{operation:'run',grant:grant.grant}),/GRANT_UNAVAILABLE/);
  const next=await invoke(config,{operation:'prepare',task});
  await request('authorize',{grant:next.grant,commitment:next.commitment,confirm:true});
  const rerun=await invoke(config,{operation:'run',grant:next.grant});assert.equal(rerun.state,'complete');
  assert.equal(rerun.receipt.observation.privateNamespacesEnded,true);
  const history=(await invoke(config,{operation:'status'})).runs;
  assert.equal(history.length,2);assert.deepEqual(new Set(history.map(r=>r.id)),new Set([run.run,rerun.run]));
  assert.ok(history.every(r=>Number.isSafeInteger(r.value.reservedAt)));
  await request('stop',{actor:null});child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});child=null;
  const ledger=fs.readFileSync(path.join(state,'ledger.sqlite'));
  const removed=JSON.parse(command('uninstall','--root',root,'--confirm'));
  assert.equal(removed.credentialsDeleted,false);assert.equal(fs.existsSync(root),false);
  assert.deepEqual(fs.readFileSync(path.join(state,'ledger.sqlite')),ledger);
  assert.equal(fs.readFileSync(path.join(state,'operator.token'),'utf8').trim(),token);
  assert.equal(fs.readdirSync(output).length,files.length);
  const evidence={schema:'agi-fleet/installed-local-observation/v1',archiveSHA256:sha,platform:process.platform,arch:process.arch,node:install.node,
    actualInstallation:true,actualIPC:true,actualSandbox:true,stableAssistantRestart:true,restartPreservedReservations:history.length,oldGrantReplayed:false,files:files.map(f=>({name:f.name,bytes:Buffer.byteLength(f.content),sha256:crypto.createHash('sha256').update(f.content).digest('hex')})),
    removalPreservedState:true,removalPreservedOutputs:true,provider:'none',independentReview:false,physical:'NOT_RUN',productionQualified:false};
  if(process.env.AGI_LOCAL_INSTALL_EVIDENCE)fs.writeFileSync(process.env.AGI_LOCAL_INSTALL_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} finally {
  if(child){child.kill('SIGTERM');await exit;}
  fs.rmSync(directory,{recursive:true,force:true});
}
