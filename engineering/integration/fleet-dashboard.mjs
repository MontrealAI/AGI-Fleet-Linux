// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {sha256} from './bridge.mjs';
import {inspectDashboardControlObservation} from './verify-dashboard.mjs';
export function privateDashboardDriver(file,args,options){try{return execFileSync(file,args,{...options,stdio:['pipe','pipe','pipe']});}catch{throw Error('DASHBOARD_DRIVER_FAILED');}}
const LIMIT=8_000_000;
export async function privateDashboardControlDriver(file,args,{input,handlers={},expectedPhases,timeout=210000,...options}){
  const phases=[...expectedPhases],abort=new AbortController(),decoder=new TextDecoder('utf-8',{fatal:true});
  let child,timer,killTimer,stdout='',stderrBytes=0,total=0,linesSeen=0,processing=Promise.resolve(),complete=null,failure=null;
  const fail=()=>{if(failure)return;failure=Error('DASHBOARD_DRIVER_FAILED');abort.abort();child?.kill('SIGTERM');child?.stdin.destroy();killTimer=setTimeout(()=>child?.kill('SIGKILL'),1000);};
  async function step(handler,event){
    let cancel;
    const stopped=new Promise((_,reject)=>{cancel=()=>reject(Error('DASHBOARD_DRIVER_FAILED'));abort.signal.addEventListener('abort',cancel,{once:true});if(abort.signal.aborted)cancel();});
    try{return await Promise.race([handler(event,{signal:abort.signal}),stopped]);}
    finally{abort.signal.removeEventListener('abort',cancel);}
  }
  try{
    child=spawn(file,args,{...options,stdio:['pipe','pipe','pipe']});
    timer=setTimeout(fail,timeout);
    child.stdin.on('error',fail);child.on('error',fail);
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>20000)fail();});
    child.stdout.on('data',chunk=>{
      total+=chunk.length;if(total>LIMIT){fail();return;}try{stdout+=decoder.decode(chunk,{stream:true});}catch{fail();return;}
      if(stdout.length>LIMIT){fail();return;}
      let newline;
      while((newline=stdout.indexOf('\n'))>=0){if(++linesSeen>expectedPhases.length){fail();return;}const line=stdout.slice(0,newline);stdout=stdout.slice(newline+1);
        processing=processing.then(async()=>{
          if(failure||complete)throw Error('DASHBOARD_DRIVER_FAILED');const event=JSON.parse(line);
          assert(event&&typeof event==='object'&&!Array.isArray(event));
          assert.equal(event.phase,phases.shift());
          if(event.phase==='complete'){
            assert.deepEqual(Object.keys(event).sort(),['phase','reconciled','stop','terminal']);complete=event;child.stdin.end();return;
          }
          const fields={prepared:['actor','commitment','grant','phase','taskSha256'],authorized:['commitment','grant','phase'],'run-started':['commitment','grant','phase'],'reconciliation-ready':['commitment','eligible','kind','observationSha256','phase','replayAllowed','run']}[event.phase];
          assert(fields&&typeof handlers[event.phase]==='function');assert.deepEqual(Object.keys(event).sort(),fields);
          const permission=await step(handlers[event.phase],event);assert(permission&&typeof permission==='object');
          const raw=JSON.stringify(permission)+'\n';assert(Buffer.byteLength(raw)<=16000);if(failure)throw failure;child.stdin.write(raw);
        }).catch(fail);
      }
    });
    child.stdin.write(JSON.stringify(input)+'\n');
    const status=await new Promise(resolve=>child.once('close',(code,signal)=>{if(!complete)fail();resolve({code,signal});}));
    await processing;try{stdout+=decoder.decode();}catch{fail();}if(failure||status.code!==0||status.signal!==null||stdout!==''||!complete||phases.length)throw Error('DASHBOARD_DRIVER_FAILED');
    return complete;
  }catch{throw Error('DASHBOARD_DRIVER_FAILED');}
  finally{clearTimeout(timer);clearTimeout(killTimer);if(child?.exitCode===null)child.kill('SIGKILL');}
}
function dashboardArguments(name,script,output,image,handoff=null){
  return ['run','--name',name,'--rm','--interactive','--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--user',String(process.getuid())+':'+String(process.getgid()),'--env','PYTHONDONTWRITEBYTECODE=1','--mount','type=bind,source='+script+',target=/kit/fleet-dashboard-export.py,readonly','--mount','type=bind,source='+output+',target=/output',...(handoff?['--mount','type=bind,source='+handoff+',target=/input/handoff.json,readonly']:[]),'--entrypoint','python',image,'/kit/fleet-dashboard-export.py'];
}
function requireDashboardClosed(name){
  spawnSync('/usr/bin/docker',['rm','--force',name],{timeout:15000,env:{PATH:'/usr/bin:/bin'},stdio:'ignore'});
  const retained=spawnSync('/usr/bin/docker',['container','ls','--all','--quiet','--filter','name=^/'+name+'$'],{timeout:5000,maxBuffer:8192,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
  if(retained.status!==0||retained.stdout.trim())throw Error('DASHBOARD_CONTAINER_CLEANUP_UNCONFIRMED');
}
export async function driveFleetDashboardControls({url,token,actor,actorName,run=null,image,output,mode,language,handoffFile=null,resume=false,handlers={}}){
  assert(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token));assert.match(actor,/^[a-f0-9-]{36}$/);assert.match(image,/^sha256:[a-f0-9]{64}$/);
  assert(['execute','interrupt','stop','reconcile'].includes(mode));assert(['en','fr'].includes(language));assert(path.isAbsolute(output));
  try{fs.lstatSync(output);throw Error('DASHBOARD_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(['execute','interrupt'].includes(mode)){assert(path.isAbsolute(handoffFile??''));const info=fs.lstatSync(handoffFile);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=1_000_000&&fs.realpathSync(handoffFile)===handoffFile);}
  if(mode==='reconcile')assert.match(run,/^[a-f0-9-]{36}$/);
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-dashboard-controls-private-')),name='fleet-dashboard-'+crypto.randomUUID(),script=new URL('./fleet-dashboard-export.py',import.meta.url).pathname;
  let value;const events={};
  try{
    const expectedPhases={execute:['prepared','authorized','complete'],interrupt:['prepared','authorized','run-started','complete'],stop:['complete'],reconcile:['reconciliation-ready','complete']}[mode];
    const checkedHandlers=Object.fromEntries(Object.entries(handlers).map(([phase,handler])=>[phase,async(event,context)=>{events[phase]=event;return handler(event,context);} ]));
    try{value=await privateDashboardControlDriver('/usr/bin/docker',dashboardArguments(name,script,staging,image,handoffFile),{input:{url,token,actor,actorName,run,image,mode,language,resume},handlers:checkedHandlers,expectedPhases,env:{PATH:'/usr/bin:/bin'}});}
    finally{requireDashboardClosed(name);}
    requireNoDashboardCredential(staging,token);assert(!JSON.stringify(value).includes(token));
    const file=path.join(staging,'dashboard-controls.json'),raw=fs.readFileSync(file);assert(raw.length>0&&raw.length<LIMIT);
    const observation=inspectDashboardControlObservation(JSON.parse(raw),{mode,language,resume,actor,image,grant:events.prepared,taskSha256:events.prepared?.taskSha256,terminal:value.terminal,stop:value.stop,plan:events['reconciliation-ready'],reconciled:value.reconciled});
    fs.writeFileSync(output,raw,{flag:'wx',mode:0o600});return {...value,observation,observationSha256:sha256(raw)};
  }catch{throw Error('DASHBOARD_DRIVER_FAILED');}
  finally{fs.rmSync(staging,{recursive:true,force:true});}
}
export function requireNoDashboardCredential(directory,token){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);assert(!entry.isSymbolicLink(),'DASHBOARD_ARTIFACT_LINK');if(entry.isDirectory())requireNoDashboardCredential(file,token);else if(fs.readFileSync(file).includes(Buffer.from(token)))throw Error('DASHBOARD_CREDENTIAL_LEAK');}}
export function withPrivateDashboardOutput(output,executeAndVerify){
  try{fs.lstatSync(output);throw Error('Choose an absent dashboard evidence directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-dashboard-private-'));let created=false;
  try{const value=executeAndVerify(staging);fs.mkdirSync(output,{mode:0o700});created=true;for(const name of fs.readdirSync(staging))fs.cpSync(path.join(staging,name),path.join(output,name),{recursive:true,errorOnExist:true,force:false});return value;}
  catch(error){if(created)fs.rmSync(output,{recursive:true,force:true});throw error;}
  finally{fs.rmSync(staging,{recursive:true,force:true});}
}
export function captureFleetDashboard({url,token,actor,run,image,output,nativeReturnSha256,artifact}){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('DASHBOARD_CREDENTIAL_SHAPE');
  assert(path.isAbsolute(output));assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.match(run,/^[a-f0-9-]{36}$/);assert.match(artifact.name,/^screen-[0-9]{3}\.png$/);
  return withPrivateDashboardOutput(output,privateOutput=>captureInto({url,token,actor,run,image,output:privateOutput,nativeReturnSha256,artifact}));
}
function captureInto({url,token,actor,run,image,output,nativeReturnSha256,artifact}){
  const script=new URL('./fleet-dashboard-export.py',import.meta.url).pathname;
  const input=JSON.stringify({url,token,actor,run,image,nativeReturnSha256,artifact});
  // Credentials are never command arguments, environment values or public files.
  const name='fleet-dashboard-'+crypto.randomUUID();let result;
  try{result=privateDashboardDriver('/usr/bin/docker',dashboardArguments(name,script,output,image),{input,encoding:'utf8',timeout:150000,maxBuffer:20000,env:{PATH:'/usr/bin:/bin'}});}finally{requireDashboardClosed(name);}
  requireNoDashboardCredential(output,token);
  if(result.includes(token))throw Error('DASHBOARD_CREDENTIAL_LEAK');
  let summary;try{summary=JSON.parse(result);}catch{throw Error('DASHBOARD_SUMMARY_INVALID');}
  if(Object.keys(summary).sort().join('|')!=='actualDashboardExports|credentialRetainedInEvidence|realWallets'||summary.actualDashboardExports!==2||summary.credentialRetainedInEvidence!==false||summary.realWallets!==false)throw Error('DASHBOARD_SUMMARY_INVALID');
  const observed=JSON.parse(fs.readFileSync(path.join(output,'dashboard-export-evidence.json')));assert.equal(observed.image,image);assert.equal(observed.driverSha256,sha256(fs.readFileSync(script)));assert.equal(observed.cases.length,2);
  for(const language of ['en','fr']){assert.equal(sha256(fs.readFileSync(path.join(output,language,'computer-return.json'))),nativeReturnSha256);assert.equal(sha256(fs.readFileSync(path.join(output,language,artifact.name))),artifact.sha256);}
  return {observationSha256:sha256(fs.readFileSync(path.join(output,'dashboard-export-evidence.json'))),nativeReturnSha256,artifactSha256:artifact.sha256,cases:observed.cases.length,containerClosed:true,publicSummary:summary};
}
