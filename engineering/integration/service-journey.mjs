// SPDX-License-Identifier: MIT
// Real saved-package service/IPC -> native Docker/Chromium -> exact exported return.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sha256} from './bridge.mjs';
import {captureFleetDashboard,driveFleetDashboardControls} from './fleet-dashboard.mjs';
import {rehearseRecovery} from './service-recovery.mjs';
const [application,alphaRoot,python,image,evidence]=process.argv.slice(2);
for(const value of [application,alphaRoot,python,evidence])assert(path.isAbsolute(value??''));
assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.equal(fs.realpathSync(python),python);process.umask(0o077);
const {canonical}=await import(pathToFileURL(path.join(application,'local-runtime/contracts.mjs')));
const {createComputerProfile}=await import(pathToFileURL(path.join(application,'local-runtime/computer/profile.mjs')));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-saved-computer-'));let child,exit,address,state,operator;
async function start(profile){
  child=spawn(process.execPath,[new URL('./service-host.mjs',import.meta.url).pathname,application,state,profile],{stdio:['ignore','pipe','pipe'],env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LANG:'C.UTF-8',HOME:os.homedir()}});
  exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let errors='';child.stderr.on('data',chunk=>{errors+=chunk;if(errors.length>20000)child.kill('SIGTERM');});
  address=await new Promise((resolve,reject)=>{let buffer='';const timeout=setTimeout(()=>reject(Error('SAVED_SERVICE_START_TIMEOUT')),45000);child.once('exit',()=>{clearTimeout(timeout);reject(Error('SAVED_SERVICE_EXITED_'+errors.slice(-1000)));});child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){clearTimeout(timeout);try{resolve(JSON.parse(buffer.split('\n')[0]));}catch(error){reject(error);}}});});
  operator=fs.readFileSync(path.join(state,'operator.token'),'utf8');
}
async function request(action,input={},credential=operator,{failure=false}={}){
  const response=await fetch(address.url+'/v1/'+action,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(210000)}),value=await response.json();
  if(failure){assert.equal(response.status,400);return value;}
  assert.equal(response.status,200,JSON.stringify(value));return value;
}
async function stopChild(){if(!child)return;child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});child=null;}
const dashboardConnection=()=>({url:address.url,token:operator});
// Metadata only: never copy interpreter/runtime contents or private journal data.
function readinessFileMetadata(file,role){
  try{
    const stat=fs.lstatSync(file);
    return {role,file,bytes:stat.size,mode:'0o'+(stat.mode&0o7777).toString(8),
      owner:stat.uid===0?'root':stat.uid===process.getuid()?'current-process':'other',
      regular:stat.isFile(),physicalPath:fs.realpathSync(file)===file,
      sharedWritable:Boolean(stat.mode&0o022),executable:Boolean(stat.mode&0o111)};
  }catch{return {role,file,unavailable:true};}
}
const executablePrerequisites=[['python',python],['docker','/usr/bin/docker']].map(([role,file])=>{const stat=fs.lstatSync(file);return {role,bytes:stat.size,mode:stat.mode&0o777,owner:stat.uid===0?'root':stat.uid===process.getuid()?'current-process':'other',regular:stat.isFile(),physicalPath:fs.realpathSync(file)===file,executable:Boolean(stat.mode&0o111),legacy32MBThresholdExceeded:stat.size>32_000_000};});
fs.writeFileSync(path.join(evidence,'runtime-executable-prerequisites.json'),JSON.stringify({schema:'agi-fleet/runtime-executable-prerequisites/v1',architecture:process.arch,maximumExecutableBytes:128*1024*1024,executables:executablePrerequisites},null,2)+'\n',{flag:'wx',mode:0o600});
const all=[],controlFiles=[];let recovery,dashboard;
try{
  for(const name of ['accepted','rejected-late']){
    const directory=path.join(evidence,name),handoffRaw=fs.readFileSync(path.join(directory,'handoff.json'),'utf8'),actions=JSON.parse(fs.readFileSync(path.join(directory,'actions.json')));
    const privateRoot=path.join(temporary,name);fs.mkdirSync(privateRoot,{mode:0o700});state=path.join(privateRoot,'state');const profile=path.join(privateRoot,'installation.json');
    await createComputerProfile({alphaRoot,python,image,handoffRaw,actions,output:profile});
    // This profile has public synthetic inputs and no credential fields. Journals stay private.
    fs.copyFileSync(profile,path.join(directory,'service-profile.json'));
    await start(profile);const host=await request('doctor');
    const runtimeFiles=Object.keys(JSON.parse(fs.readFileSync(profile,'utf8')).runtimeFiles);
    const runtimeMetadata=runtimeFiles.map(file=>readinessFileMetadata(file,'computer-runtime'));
    const readiness={schema:'agi-fleet/saved-service-readiness/v1',case:name,architecture:process.arch,
      host:{supported:host.supported,code:host.code??null},
      alphaComputer:{supported:host.alphaComputer?.supported??false,code:host.alphaComputer?.code??null},
      executableFiles:[['node',process.execPath],['python',python],['docker','/usr/bin/docker'],
        ['bubblewrap','/usr/bin/bwrap'],['limiter','/usr/bin/prlimit']].map(([role,file])=>readinessFileMetadata(file,role)),
      computerRuntimeFilesInspected:runtimeMetadata.length,
      computerRuntimeFileFailures:runtimeMetadata.filter(file=>file.unavailable||!file.regular||!file.physicalPath||
        file.owner==='other'||file.sharedWritable||file.bytes>32_000_000)};
    fs.writeFileSync(path.join(directory,'service-readiness.json'),JSON.stringify(readiness,null,2)+'\n',{flag:'wx',mode:0o600});
    assert.equal(host.supported,true,JSON.stringify(readiness));assert.equal(host.alphaComputer.supported,true,JSON.stringify(readiness));
    const actor=await request('create',{role:'agent',name:'Disposable saved-package Computer Use rehearsal'});if(name!=='accepted')await request('activate',{actor:actor.id,confirm:true});
    const scoped=await request('client',{actor:actor.id});
    const task={schema:'agi-fleet/local-task/v1',action:'alpha-computer-run',workspace:'files',input:{handoffRaw,publicNonpersonal:true},review:'none',sourceActor:null,sourceController:null};
    let grant,run,nativeElapsedSeconds;const started=performance.now(),controlLanguage=process.arch==='arm64'?'fr':'en';
    if(name==='accepted'){
      const output=path.join(directory,'dashboard-control-execution.json');
      const driven=await driveFleetDashboardControls({...dashboardConnection(),actor:actor.id,actorName:actor.name,image,output,mode:'execute',language:controlLanguage,handoffFile:path.join(directory,'handoff.json'),handlers:{
        prepared:async event=>{
          grant=await request('grant-inspect',{grant:event.grant});assert.equal(grant.state,'prepared');assert.equal(grant.preparingClient,'this-operator');assert.equal(grant.actor,actor.id);assert.equal(grant.commitment,event.commitment);assert.deepEqual(grant.task,task);assert.equal(event.taskSha256,sha256(canonical(task)));
          assert.match((await request('run',{actor:actor.id,grant:grant.grant},scoped.token,{failure:true})).error,/GRANT_UNAVAILABLE/);
          assert.match((await request('authorize',{grant:grant.grant,commitment:'0'.repeat(64),confirm:true},operator,{failure:true})).error,/GRANT_CHANGED/);
          return {continue:'authorize',grant:grant.grant,commitment:grant.commitment};
        },
        authorized:async event=>{const actual=await request('grant-inspect',{grant:event.grant});assert.equal(actual.state,'authorized');assert.equal(actual.commitment,grant.commitment);return {continue:'run',grant:grant.grant};}
      }});
      run=driven.terminal;nativeElapsedSeconds=driven.observation.runRequestElapsedSeconds;assert(nativeElapsedSeconds>0);controlFiles.push({file:path.relative(evidence,output),sha256:driven.observationSha256});
      const observed=await request('output',{actor:actor.id,run:run.run},scoped.token);assert.equal(observed.state,run.state);assert.deepEqual(observed.receipt,run.receipt);
    }else{
      grant=await request('prepare',{actor:actor.id,task},scoped.token);
      assert.match((await request('run',{actor:actor.id,grant:grant.grant},scoped.token,{failure:true})).error,/GRANT_UNAVAILABLE/);
      assert.match((await request('authorize',{grant:grant.grant,commitment:'0'.repeat(64),confirm:true},operator,{failure:true})).error,/GRANT_CHANGED/);
      await request('authorize',{grant:grant.grant,commitment:grant.commitment,confirm:true});
      const runStarted=performance.now();run=await request('run',{actor:actor.id,grant:grant.grant},scoped.token);nativeElapsedSeconds=(performance.now()-runStarted)/1000;
    }
    assert.equal(run.state,'complete');
    assert.equal(run.receipt.observation.backend,'native-alpha-computer-scripted/v1');assert.equal(run.receipt.observation.processGroupGone,true);assert.equal(run.receipt.observation.containerClosed,true);assert.equal(run.receipt.result.providerRequests,0);
    const exported=await request('computer-export',{actor:actor.id,run:run.run},scoped.token);assert.equal(sha256(exported.content),exported.sha256);
    const returned=JSON.parse(exported.content);assert.equal(returned.receipt.state,'review');assert.equal(returned.receipt.cleanup,'VERIFIED');assert.equal(returned.execution.image,image);
    fs.writeFileSync(path.join(directory,'computer-return.json'),exported.content,{flag:'wx',mode:0o600});fs.mkdirSync(path.join(directory,'native'),{mode:0o700});
    for(const record of run.receipt.result.artifacts){assert.match(record.name,/^(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-\d{3}\.png)$/);const artifact=await request('computer-artifact',{actor:actor.id,run:run.run,name:record.name},scoped.token),raw=Buffer.from(artifact.contentBase64,'base64');assert.equal(sha256(raw),record.sha256);assert.equal(artifact.sha256,record.sha256);assert.equal(raw.length,record.bytes);fs.writeFileSync(path.join(directory,'native',record.name),raw,{flag:'wx',mode:0o600});}
    assert.equal(fs.readFileSync(path.join(directory,'native/computer-return.json'),'utf8'),exported.content);
    if(name==='accepted'){const artifact=run.receipt.result.artifacts.find(entry=>entry.mediaType==='image/png');assert(artifact);dashboard=captureFleetDashboard({url:address.url,token:operator,actor:actor.id,run:run.run,image,output:path.join(directory,'dashboard'),nativeReturnSha256:exported.sha256,artifact});}
    assert.match((await request('run',{actor:actor.id,grant:grant.grant},scoped.token,{failure:true})).error,/GRANT_UNAVAILABLE/);
    const proof={schema:'agi-fleet/saved-service-native-case/v1',case:name,actor:actor.id,grant:grant.grant,commitment:grant.commitment,run:run.run,taskSha256:sha256(canonical(task)),preparation:grant,nativeAlphaReturnSha256:exported.sha256,returnExportSha256:exported.sha256,serviceReceipt:run.receipt,exactGrant:true,oneUse:true,actualIPC:true};
    fs.writeFileSync(path.join(directory,'service-case.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
    const browser={schema:'agi-fleet/four-repository-computer-observation/v1',actuator:'docker',realBrowser:true,scriptedAdvice:true,liveProvider:false,dockerIsolation:true,providerRequests:0,providerBilledCost:0,deviceCost:null,humanMinutes:null,elapsedSeconds:nativeElapsedSeconds,elapsedScope:'RUN_HTTP_REQUEST_RESPONSE_ONLY',throughDashboardExportElapsedSeconds:(performance.now()-started)/1000,throughDashboardExportScope:name==='accepted'?'AUTOMATED_GUI_PREPARE_AUTHORIZE_RUN_AND_READONLY_EXPORT':'AUTOMATED_IPC_PREPARE_AUTHORIZE_RUN_AND_EXPORT',productionQualified:false,authority:'none',nativeSourceCapture:grant.admission.binding.computer.nativeSourceCapture,nativeSession:{state:returned.receipt.state,actions:returned.receipt.actions_reserved,turns:returned.receipt.turns_reserved,screenshots:returned.receipt.screenshots.length},serviceCaseSha256:sha256(fs.readFileSync(path.join(directory,'service-case.json')))};
    fs.writeFileSync(path.join(directory,'browser-evidence.json'),JSON.stringify(browser,null,2)+'\n',{flag:'wx',mode:0o600});
    const beforeStop=await request('status');assert.equal(beforeStop.runs.length,1);assert.equal(beforeStop.runs[0].id,run.run);
    if(name==='accepted'){const output=path.join(directory,'dashboard-control-stop.json'),driven=await driveFleetDashboardControls({...dashboardConnection(),actor:actor.id,actorName:actor.name,run:run.run,image,output,mode:'stop',language:controlLanguage});assert.equal(driven.stop.state,'STOP');controlFiles.push({file:path.relative(evidence,output),sha256:driven.observationSha256});}
    else await request('stop',{actor:null});
    await stopChild();await start(profile);
    assert.equal((await request('status')).stopped,true);assert.match((await request('run',{actor:actor.id,grant:grant.grant},scoped.token,{failure:true})).error,/STOP_RECONCILIATION_REQUIRED|GRANT_UNAVAILABLE/);
    const again=await request('computer-export',{actor:actor.id,run:run.run},scoped.token);assert.equal(again.content,exported.content);const afterRestart=await request('status');assert.equal(afterRestart.runs.length,1);assert.equal(afterRestart.runs[0].id,run.run);await stopChild();if(name==='accepted')recovery=await rehearseRecovery({application,alphaRoot,python,image,evidence,privateRoot,state,actor,scopedToken:scoped.token,handoffRaw,actions,start,stopChild,request,dashboardConnection,controlLanguage,controlFiles});all.push({case:name,nativeAlphaReturnSha256:exported.sha256,returnExportSha256:exported.sha256,serviceCaseSha256:browser.serviceCaseSha256,restartPreservedReturn:true,oldGrantReplayed:false,completedRunCount:1,stopPreservedHistory:true});
  }
  const controls=controlFiles.map(record=>({...record,observation:JSON.parse(fs.readFileSync(path.join(evidence,record.file)))}));
  const dashboardAutomation={scope:'AUTOMATED_SAVED_SERVICE_GUI_CONTROLS_ONLY_EXCLUDES_PROFILE_SETUP_AND_OTHER_SITES',observations:controlFiles,automationStepCount:controls.reduce((sum,row)=>sum+row.observation.automationStepCount,0),guiAutomatedElapsedSeconds:controls.reduce((sum,row)=>sum+row.observation.guiAutomatedElapsedSeconds,0),humanElapsedMinutes:null,deviceCost:null};
  fs.writeFileSync(path.join(evidence,'service-observation.json'),JSON.stringify({schema:'agi-fleet/saved-service-observation/v1',negativeCaseScope:'SEPARATE_COUNTERFACTUAL_SANDBOX_SAME_HANDOFF_NOT_A_SECOND_PROJECT_HISTORY_RECORD',node:process.version,architecture:process.arch,actualIPC:true,prepare:true,exactGrant:true,oneUse:true,actualDocker:true,actualBrowser:true,...all[0],cases:all,recovery,dashboard,dashboardAutomation,operatorEffort:{scope:'CONCEPTUAL_SERVICE_CLI_ALTERNATIVE_ONLY_EXCLUDES_GUI_AND_RECOVERY',completeJourneyManualStepCount:null,conceptualOperatorCommands:['install-exact-profile','start-service','create-actor','activate-actor','issue-scoped-client','prepare-task','authorize-exact-grant','run-one-use-grant','export-native-return'],commandCount:9,authorizingCommandCount:2,measuredHumanCommands:false,humanElapsedMinutes:null,manualEconomicReview:'NOT_RUN'},providerRequests:0,productionQualified:false},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({savedPackageServiceExecuted:true,cases:all.map(item=>item.case),realWallets:false,productionQualified:false}));
}finally{if(child){child.kill('SIGTERM');await exit;}fs.rmSync(temporary,{recursive:true,force:true});}
