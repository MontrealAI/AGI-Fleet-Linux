// SPDX-License-Identifier: MIT
// A real in-flight Docker STOP, closed-without-success reconciliation and fresh native attempt.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sha256} from './bridge.mjs';
import {driveFleetDashboardControls} from './fleet-dashboard.mjs';
export async function rehearseRecovery({application,alphaRoot,python,image,evidence,privateRoot,state,actor,scopedToken,handoffRaw,actions,start,stopChild,request,dashboardConnection,controlLanguage,controlFiles}){
  const {canonical}=await import(pathToFileURL(path.join(application,'local-runtime/contracts.mjs'))),{createComputerProfile}=await import(pathToFileURL(path.join(application,'local-runtime/computer/profile.mjs'))),alpha=await import(pathToFileURL(path.join(alphaRoot,'examples/successor-alpha/computer.mjs')));
  const changeAttempt=()=>canonical({...JSON.parse(handoffRaw),attemptId:crypto.randomUUID()});
  const stoppedRaw=changeAttempt(),stopProfile=path.join(privateRoot,'interruption-profile.json');
  await alpha.inspectComputerHandoff(stoppedRaw);await createComputerProfile({alphaRoot,python,image,handoffRaw:stoppedRaw,actions:Array.from({length:30},()=>({type:'wait'})),output:stopProfile});
  const interrupted=path.join(evidence,'interrupted');fs.mkdirSync(interrupted,{mode:0o700});fs.writeFileSync(path.join(interrupted,'handoff.json'),stoppedRaw,{mode:0o600});fs.copyFileSync(stopProfile,path.join(interrupted,'service-profile.json'));
  await start(stopProfile);
  const task=raw=>({schema:'agi-fleet/local-task/v1',action:'alpha-computer-run',workspace:'files',input:{handoffRaw:raw,publicNonpersonal:true},review:'none',sourceActor:null,sourceController:null});
  let stoppedGrant,observed;const opposite=controlLanguage==='en'?'fr':'en';
  const inspectPrepared=async(event,raw)=>{const grant=await request('grant-inspect',{grant:event.grant});assert.equal(grant.state,'prepared');assert.equal(grant.preparingClient,'this-operator');assert.equal(grant.actor,actor.id);assert.equal(grant.commitment,event.commitment);assert.deepEqual(grant.task,task(raw));assert.equal(event.taskSha256,sha256(canonical(task(raw))));return grant;};
  const authorizePermission=async(event,grant)=>{const actual=await request('grant-inspect',{grant:event.grant});assert.equal(actual.state,'authorized');assert.equal(actual.commitment,grant.commitment);return {continue:'run',grant:grant.grant};};
  const interruptedOutput=path.join(interrupted,'dashboard-control-execution.json');
  const interruptedControls=await driveFleetDashboardControls({...dashboardConnection(),actor:actor.id,actorName:actor.name,image,output:interruptedOutput,mode:'interrupt',language:opposite,handoffFile:path.join(interrupted,'handoff.json'),resume:true,handlers:{
    prepared:async event=>{stoppedGrant=await inspectPrepared(event,stoppedRaw);return {continue:'authorize',grant:stoppedGrant.grant,commitment:stoppedGrant.commitment};},
    authorized:async event=>authorizePermission(event,stoppedGrant),
    'run-started':async(event,{signal})=>{
      assert.equal(event.grant,stoppedGrant.grant);assert.equal(event.commitment,stoppedGrant.commitment);const started=performance.now(),deadline=Date.now()+90000;
      while(Date.now()<deadline){
        signal.throwIfAborted();
        const status=await request('status'),active=status.runs.find(run=>run.state==='running'&&run.value.grant===stoppedGrant.grant);
        const containers=execFileSync('/usr/bin/docker',['container','ls','--quiet','--filter','name=^/successor-computer-'],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin'}}).trim().split('\n').filter(Boolean);
        if(active&&containers.length===1){
          const directories=fs.readdirSync(path.join(state,'runs')).filter(name=>name.startsWith(active.id+'-'));
          if(directories.length===1){
            const native=path.join(state,'runs',directories[0],'computer');
            const screenshots=fs.existsSync(native)?fs.readdirSync(native).filter(name=>/^screen-\d{3}\.png$/.test(name)):[];
            if(screenshots.length>=2){observed={run:active.id,container:containers[0],screenshotsBeforeStop:screenshots.length,activeReservation:active.value,observedAtMilliseconds:performance.now()-started};break;}
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert(observed,'Actual running Docker plus a completed browser action required before STOP');return {continue:'stop',grant:stoppedGrant.grant};
    }
  }});
  controlFiles.push({file:path.relative(evidence,interruptedOutput),sha256:interruptedControls.observationSha256});
  const stop=interruptedControls.stop;assert.equal(stop.state,'STOP');assert.equal(stop.cleanup,'in-progress');
  const refused=interruptedControls.terminal;assert(refused&&refused.run===observed.run&&typeof refused.error==='string');
  const outcome=await request('output',{actor:actor.id,run:observed.run},scopedToken);assert.equal(outcome.state,'uncertain');assert.equal(outcome.receipt.observation.processGroupGone,true);assert.equal(outcome.receipt.observation.containerClosed,true);assert.equal(outcome.receipt.observation.providerCalls,0);
  async function retain(directory,run,records){
    const exported=await request('computer-export',{actor:actor.id,run},scopedToken);assert.equal(sha256(exported.content),exported.sha256);fs.writeFileSync(path.join(directory,'computer-return.json'),exported.content,{flag:'wx',mode:0o600});fs.mkdirSync(path.join(directory,'native'),{mode:0o700});
    for(const record of records){assert.match(record.name,/^(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-\d{3}\.png)$/);const artifact=await request('computer-artifact',{actor:actor.id,run,name:record.name},scopedToken),raw=Buffer.from(artifact.contentBase64,'base64');assert.equal(sha256(raw),record.sha256);assert.equal(raw.length,record.bytes);fs.writeFileSync(path.join(directory,'native',record.name),raw,{flag:'wx',mode:0o600});}
    return exported;
  }
  const stoppedReturn=await retain(interrupted,observed.run,outcome.receipt.observation.artifacts),stoppedNative=await alpha.inspectComputerReturn(stoppedRaw,stoppedReturn.content);assert(['interrupted','stopped'].includes(stoppedNative.returned.receipt.state));assert.equal(stoppedNative.returned.receipt.cleanup,'VERIFIED');assert(stoppedNative.returned.receipt.actions_reserved>=1);
  assert.equal(execFileSync('/usr/bin/docker',['container','ls','--all','--quiet','--filter','name=^/successor-computer-'],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin'}}).trim(),'');
  await stopChild();await start(stopProfile);assert.equal((await request('status')).stopped,true);
  const refusedAfterRestart=await request('run',{actor:actor.id,grant:stoppedGrant.grant},scopedToken,{failure:true});assert.match(refusedAfterRestart.error,/STOP_RECONCILIATION_REQUIRED|GRANT_UNAVAILABLE/);
  const plan=await request('reconciliation',{run:observed.run});assert.equal(plan.eligible,true);assert.equal(plan.kind,'recorded-scripted-computer-closure');assert.equal(plan.replayAllowed,false);
  const reconciliationOutput=path.join(interrupted,'dashboard-control-reconciliation.json');
  const recoveryControls=await driveFleetDashboardControls({...dashboardConnection(),actor:actor.id,actorName:actor.name,run:observed.run,image,output:reconciliationOutput,mode:'reconcile',language:opposite,handlers:{'reconciliation-ready':async event=>{const actual=await request('reconciliation',{run:observed.run});for(const key of ['run','commitment','eligible','kind','replayAllowed','observationSha256'])assert.deepEqual(event[key],actual[key]);assert.deepEqual(actual,plan);return {continue:'reconcile',run:observed.run,commitment:plan.commitment};}}});
  controlFiles.push({file:path.relative(evidence,reconciliationOutput),sha256:recoveryControls.observationSha256});
  const reconciled=recoveryControls.reconciled;assert.equal(reconciled.state,'reconciled');assert.equal(reconciled.receipt.disposition,'closed-without-success');const reconciledReadback=await request('output',{actor:actor.id,run:observed.run},scopedToken);assert.equal(reconciledReadback.state,'reconciled');assert.deepEqual(reconciledReadback.receipt,reconciled.receipt);await stopChild();
  const recoveryRaw=changeAttempt(),recoveryProfile=path.join(privateRoot,'recovery-profile.json'),recovered=path.join(evidence,'recovered');fs.mkdirSync(recovered,{mode:0o700});fs.writeFileSync(path.join(recovered,'handoff.json'),recoveryRaw,{mode:0o600});await createComputerProfile({alphaRoot,python,image,handoffRaw:recoveryRaw,actions,output:recoveryProfile});fs.copyFileSync(recoveryProfile,path.join(recovered,'service-profile.json'));
  await start(recoveryProfile);let freshGrant,refusedAfterResume;const freshOutput=path.join(recovered,'dashboard-control-execution.json');
  const freshControls=await driveFleetDashboardControls({...dashboardConnection(),actor:actor.id,actorName:actor.name,image,output:freshOutput,mode:'execute',language:controlLanguage,handoffFile:path.join(recovered,'handoff.json'),resume:true,handlers:{prepared:async event=>{refusedAfterResume=await request('run',{actor:actor.id,grant:stoppedGrant.grant},scopedToken,{failure:true});assert.match(refusedAfterResume.error,/GRANT_UNAVAILABLE/);freshGrant=await inspectPrepared(event,recoveryRaw);assert.notEqual(freshGrant.grant,stoppedGrant.grant);return {continue:'authorize',grant:freshGrant.grant,commitment:freshGrant.commitment};},authorized:async event=>authorizePermission(event,freshGrant)}});
  controlFiles.push({file:path.relative(evidence,freshOutput),sha256:freshControls.observationSha256});
  const fresh=freshControls.terminal;assert.equal(fresh.state,'complete');const freshReadback=await request('output',{actor:actor.id,run:fresh.run},scopedToken);assert.deepEqual(freshReadback.receipt,fresh.receipt);assert.equal(freshReadback.state,'complete');const freshReturn=await retain(recovered,fresh.run,fresh.receipt.result.artifacts),freshNative=await alpha.inspectComputerReturn(recoveryRaw,freshReturn.content);assert.equal(freshNative.returned.receipt.state,'review');assert.equal(freshNative.returned.receipt.cleanup,'VERIFIED');
  const refusedFreshReplay=await request('run',{actor:actor.id,grant:freshGrant.grant},scopedToken,{failure:true});assert.match(refusedFreshReplay.error,/GRANT_UNAVAILABLE/);
  const status=await request('status');assert.equal(status.runs.length,3);assert.deepEqual(status.runs.map(run=>run.state).sort(),['complete','complete','reconciled']);
  const originalReturn=fs.readFileSync(path.join(evidence,'accepted/computer-return.json'),'utf8'),original=await alpha.inspectComputerReturn(handoffRaw,originalReturn);assert.equal(original.handoff.projectSha256,stoppedNative.handoff.projectSha256);assert.equal(original.handoff.projectSha256,freshNative.handoff.projectSha256);
  let history=await alpha.retainComputerHandoff(original.project,handoffRaw);history=await alpha.importComputerReturn(original.project,handoffRaw,originalReturn,{priorRecord:history});
  for(const [handoff,returned] of [[stoppedRaw,stoppedReturn.content],[recoveryRaw,freshReturn.content]]){history=await alpha.retainComputerHandoff(original.project,handoff,{priorRecord:history});history=await alpha.importComputerReturn(original.project,handoff,returned,{priorRecord:history});}
  const inspected=await alpha.inspectComputerHistory(history);assert.equal(inspected.records.length,3);assert(inspected.records.every(record=>record.review===null));fs.writeFileSync(path.join(evidence,'recovery-retained-history.json'),history,{flag:'wx',mode:0o600});
  const proof={schema:'agi-fleet/saved-service-stop-recovery/v1',actualDockerObservedBeforeStop:observed,stop,stoppedGrant,refused,refusedAfterRestart,refusedAfterResume,refusedFreshReplay,outcome,stoppedReturnSha256:stoppedReturn.sha256,reconciliation:plan,reconciled,freshGrant,freshRun:fresh,recoveredReturnSha256:freshReturn.sha256,completedAndReconciledStates:status.runs.map(run=>({run:run.id,state:run.state})),nativeHistoryRecords:3,humanReviewPending:true,oldGrantReplayed:false,stopRunRequestElapsedSeconds:interruptedControls.observation.runRequestElapsedSeconds,recoveryRunRequestElapsedSeconds:freshControls.observation.runRequestElapsedSeconds,runElapsedScope:'RUN_HTTP_REQUEST_RESPONSE_ONLY',humanElapsedMinutes:null,deviceCost:null,providerRequests:0,providerBilledCost:0,productionQualified:false};
  fs.writeFileSync(path.join(evidence,'service-stop-recovery.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});await stopChild();return {actualInFlightDockerStop:true,stoppedRun:observed.run,reconciledWithoutSuccess:true,freshGrant:freshGrant.grant,freshRun:fresh.run,oldGrantReplayed:false,nativeHistoryRecords:3,historySha256:sha256(history),proofSha256:sha256(fs.readFileSync(path.join(evidence,'service-stop-recovery.json')))};
}
