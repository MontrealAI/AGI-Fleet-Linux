// SPDX-License-Identifier: MIT
// Offline semantic replay. Artifact bytes alone do not attest actual execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sha256,inspectComputerJourney,createComputerJourney} from './bridge.mjs';
import {checkAllocation,extractObservedAllocation} from './independent-checker.mjs';
import {inspectDashboardEvidence} from './verify-dashboard.mjs';
import {inspectGuiEvidence} from './verify-gui.mjs';
import {inspectMockGas} from './mock-gas.mjs';
import {createVerifiedModuleLoader,verifyModuleClosure,INSPECTOR_SCOPES} from './verify-source.mjs';
export function deriveNativeSourceCapture(root,commit){
  assert(path.isAbsolute(root));assert.match(commit,/^[a-f0-9]{40}$/);
  const env={PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
  const git=(args,options={})=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false','-C',root,...args],{env,timeout:15000,maxBuffer:4_000_000,...options});
  assert.equal(git(['rev-parse','HEAD']).toString().trim(),commit);
  const tree=new TextDecoder('utf-8',{fatal:true}).decode(git(['ls-tree','-r','-z',commit,'--','alpha_factory_v1']));
  const entries=tree.split('\0').filter(Boolean).map(row=>{const tab=row.indexOf('\t');assert(tab>0);const [mode,kind,id]=row.slice(0,tab).split(' '),name=row.slice(tab+1);return {mode,kind,id,name};}).filter(row=>row.name.endsWith('.py'));
  assert(entries.length>0&&entries.length<=4096);assert(entries.some(row=>row.name==='alpha_factory_v1/__init__.py'));
  for(const row of entries){assert(['100644','100755'].includes(row.mode));assert.equal(row.kind,'blob');assert.match(row.id,/^[a-f0-9]{40}$/);}
  const batch=git(['cat-file','--batch'],{input:entries.map(row=>row.id).join('\n')+'\n',maxBuffer:34*1024*1024});let offset=0,total=0;const hashes=[];
  for(const row of entries){const newline=batch.indexOf(10,offset);assert(newline>=offset);const [id,kind,sizeRaw]=batch.subarray(offset,newline).toString('ascii').split(' ');assert.equal(id,row.id);assert.equal(kind,'blob');assert.match(sizeRaw,/^(?:0|[1-9][0-9]*)$/);const size=Number(sizeRaw);assert(size<=8*1024*1024);offset=newline+1;assert(offset+size<batch.length);const raw=batch.subarray(offset,offset+size);offset+=size;assert.equal(batch[offset++],10);total+=size;assert(total<=32*1024*1024);assert.equal(createHash('sha1').update('blob '+size+'\0').update(raw).digest('hex'),row.id);hashes.push([row.name,sha256(raw)]);}
  assert.equal(offset,batch.length);hashes.sort((a,b)=>Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0])));
  const ascii=JSON.stringify(Object.fromEntries(hashes)).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  return {mode:'CAPTURED_ALPHA_GIT_SOURCE',commit,moduleCount:entries.length,sourceBytes:total,sourceSha256:sha256(ascii)};
}
export function requireNativeSourceCapture(capture,expected){
  assert.deepEqual(capture,expected,'Native capture must equal the independently derived pinned Git source inventory');
}
export function requireNativeArtifacts(root,prefix,returned,{completed=true}={}){
  assert.equal(returned.authority,'none');assert.equal(returned.verified,false);
  if(completed)assert.equal(returned.receipt?.state,'review');else assert(['interrupted','stopped'].includes(returned.receipt?.state));assert.equal(returned.receipt?.cleanup,'VERIFIED');
  const profileFile=path.join(root,prefix,'service-profile.json');
  if(fs.existsSync(profileFile)){
    const profile=JSON.parse(fs.readFileSync(profileFile));const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
    assert.equal(profile.provider.mode,'scripted-zero-cost');assert.equal(profile.fixtureSha256,sha256(canonical(profile.fixture)));assert.equal(returned.execution?.provider?.model,'SCRIPTED_ZERO_COST_REHEARSAL_'+profile.fixtureSha256);assert.equal(profile.fixture.handoffSha256,sha256(fs.readFileSync(path.join(root,prefix,'handoff.json'))));assert.equal(returned.execution.image,profile.image);
  }else assert.equal(returned.execution?.provider?.model,'SCRIPTED_COMPUTER_FIXTURE_NOT_LIVE_MODEL');
  assert.equal(returned.execution.provider.endpoint,'http://127.0.0.1/fixture-no-network');
  assert(returned.receipt.actions_reserved>=(completed?14:1));assert(returned.receipt.screenshots.length>=(completed?15:2));
  const seen=new Set();
  for(const screenshot of returned.receipt.screenshots){
    assert.match(screenshot.file,/^screen-[0-9]{3}\.png$/);assert(!seen.has(screenshot.file));seen.add(screenshot.file);
    const file=path.join(root,prefix,'native',screenshot.file),info=fs.lstatSync(file);
    assert(info.isFile()&&!info.isSymbolicLink());assert.equal(fs.realpathSync(file),file);assert(info.size<=2_000_000);
    const image=fs.readFileSync(file);assert(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.equal(sha256(image),screenshot.sha256);
  }
  if(completed||returned.observedText!==null)assert.equal(fs.readFileSync(path.join(root,prefix,'native/visible-text.txt'),'utf8'),returned.observedText);
}
export function requireRejectedAllocation(report,returned){
  const result=extractObservedAllocation(returned.observedText);
  assert.equal(result.reportDigest,report.digest);assert.equal(result.frozenProgramDigest,report.frozen.programDigest);
  assert.equal(checkAllocation(report.mission,result).accepted,false,'Positive raw results cannot prove a negative browser case');return result;
}
// Match the public upload contract. Native journal auxiliaries are deliberately
// excluded before opening files, including key-labeled files omitted by upload.
export function collectPublicEvidenceArtifacts(root,{service=false}={}){
  const native=/^(?:run\.json|receipt\.json|signed-receipt\.json|handoff\.json|computer-return\.json|visible-text\.txt|screen-[0-9]{3}\.png)$/;
  const groups=[['',/\.(?:json|txt|zip)$/],...['accepted','rejected-late'].flatMap(name=>[[name,/\.json$/],[name+'/native',native]])];
  if(service)groups.push(['forward',/\.(?:json|png)$/],...['interrupted','recovered'].flatMap(name=>[[name,/\.json$/],[name+'/native',native]]),...['accepted/dashboard','accepted/dashboard/en','accepted/dashboard/fr'].map(name=>[name,/\.(?:json|png)$/]),...['gui','gui/alpha-en','gui/alpha-fr','gui/jobs-en','gui/jobs-fr','gui/manager-en','gui/manager-fr','gui/reverse-jobs','gui/reverse-manager'].map(name=>[name,/\.(?:json|png|html)$/]));
  const files=[];
  for(const [directory,allowed] of groups)for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){
    if(!entry.isFile()||entry.name==='compatibility-evidence.json'||!allowed.test(entry.name))continue;
    const name=path.posix.join(directory,entry.name),raw=fs.readFileSync(path.join(root,name));
    files.push({name,bytes:raw.length,sha256:sha256(raw)});
  }
  return files.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function verifyEvidence({root,alphaRoot,jobsRoot,managerRoot,readOnly=false,expectedContext}) {
  for(const selected of [root,alphaRoot,jobsRoot,managerRoot])assert(path.isAbsolute(selected??''),'Supply absolute evidence and three source roots');
  const bytes=name=>fs.readFileSync(path.join(root,name)),read=name=>JSON.parse(bytes(name));
  let gui,dashboard;
  const producer=read('execution-context.json');assert(expectedContext&&typeof expectedContext==='object','An independently supplied expected producer context is required');assert.deepEqual(producer,expectedContext);
  assert.match(producer.commit,/^[a-f0-9]{40}$/);assert.equal(producer.repository,'MontrealAI/AGI-Fleet-Linux');assert.match(String(producer.workflowRun),/^[1-9][0-9]*$/);assert.match(String(producer.workflowAttempt),/^[1-9][0-9]*$/);
  const integration=read('accepted/integration-evidence.json'),browser=read('accepted/browser-evidence.json'),jobs=read('jobs-local-lifecycle.json'),manager=read('manager-local-lifecycle.json'),negative=read('rejected-late/rejection-evidence.json');
  const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url)));
  const entries={alpha:['examples/successor-alpha/computer.mjs'],jobs:['integrations/alpha-agent/four-repo-computer-receipt.mjs','packages/successor-core/src/computer-mission.mjs'],manager:['scripts/integrations/four-repo-computer-receipt.mjs']};
  const selected=[['alpha',alphaRoot],['jobs',jobsRoot],['manager',managerRoot]],loaders=new Map();
  try{
  for(const [name,directory]of selected)loaders.set(directory,createVerifiedModuleLoader(directory,lock[name],INSPECTOR_SCOPES[name]));
  const expectedCapture=deriveNativeSourceCapture(alphaRoot,lock.alpha);
  const load=(directory,relative)=>loaders.get(directory).importModule(relative);
  const alpha=await load(alphaRoot,entries.alpha[0]),jobsInspector=await load(jobsRoot,entries.jobs[0]),managerInspector=await load(managerRoot,entries.manager[0]),jobsEngine=await load(jobsRoot,entries.jobs[1]);
  const installed={inspectAlphaReturn:alpha.inspectComputerReturn,inspectComputerEvidence:jobsInspector.inspectComputerReceiptEvidence,reviewObservedAllocation:jobsEngine.reviewObservedAllocation,createManagerDraft:managerInspector.createComputerReceiptDraft,inspectManagerDraft:managerInspector.inspectComputerReceiptDraft,createJobsDraft:jobsInspector.createComputerReceiptDraft,inspectJobsDraft:jobsInspector.inspectComputerReceiptDraft,retainHistory:alpha.retainComputerHandoff,importReturn:alpha.importComputerReturn,inspectHistory:alpha.inspectComputerHistory};
  const journeyRaw=bytes('accepted/complete-journey.json').toString('utf8'),journey=await inspectComputerJourney(journeyRaw,installed);
  assert.equal(sha256(journeyRaw),integration.journeySha256);
  for(const [key,file] of [['handoffRaw','handoff.json'],['returnRaw','computer-return.json'],['reportRaw','frozen-mission-report.json']])assert.equal(journey.inputs[key],bytes('accepted/'+file).toString('utf8'));
  assert.equal(journey.routes.managerRaw,bytes('accepted/manager-usdc-draft.json').toString('utf8'));assert.equal(journey.routes.jobsRaw,bytes('accepted/jobs-agialpha-draft.json').toString('utf8'));assert.equal(journey.historyRaw,bytes('accepted/alpha-retained-history.json').toString('utf8'));
  assert.equal(journey.constraintCheck.accepted,true);assert.equal(journey.constraintCheck.independentlyImplementedConstraintCheck,true);assert.equal(journey.constraintCheck.independentlyControlledEconomicReview,false);
  const returned=read('accepted/computer-return.json');requireNativeArtifacts(root,'accepted',returned);
  requireNativeSourceCapture(browser.nativeSourceCapture,expectedCapture);
  assert.equal(returned.execution.image,read('worker-image-inspect.json')[0].Id);assert.equal(browser.nativeSession.actions,returned.receipt.actions_reserved);assert.equal(browser.nativeSession.screenshots,returned.receipt.screenshots.length);
  if(producer.architecture){
    const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
    for(const prefix of ['accepted','rejected-late']){const proof=read(prefix+'/service-case.json'),native=read(prefix+'/computer-return.json'),profile=read(prefix+'/service-profile.json'),observation=read(prefix+'/browser-evidence.json');assert.equal(profile.source.commit,lock.alpha);requireNativeSourceCapture(proof.preparation.admission.binding.computer.nativeSourceCapture,expectedCapture);assert.deepEqual(observation.nativeSourceCapture,proof.preparation.admission.binding.computer.nativeSourceCapture);assert.equal(proof.exactGrant,true);assert.equal(proof.oneUse,true);assert.equal(proof.actualIPC,true);assert.equal(proof.preparation.grant,proof.grant);assert.equal(proof.preparation.commitment,proof.commitment);assert.equal(proof.preparation.task.input.handoffRaw,bytes(prefix+'/handoff.json').toString('utf8'));assert.equal(sha256(canonical(proof.preparation.task)),proof.taskSha256);assert.equal(proof.serviceReceipt.inputSha256,proof.taskSha256);assert.equal(proof.serviceReceipt.outputSha256,sha256(canonical(proof.serviceReceipt.result)));assert.equal(proof.serviceReceipt.observation.backend,'native-alpha-computer-scripted/v1');assert.equal(proof.serviceReceipt.observation.providerCalls,0);assert.equal(proof.serviceReceipt.observation.processGroupGone,true);assert.equal(proof.serviceReceipt.observation.containerClosed,true);assert.equal(proof.serviceReceipt.result.handoffSha256,sha256(bytes(prefix+'/handoff.json')));assert.equal(proof.preparation.admission.binding.computer.permit,native.taskCommitment);assert.equal(proof.nativeAlphaReturnSha256,sha256(bytes(prefix+'/computer-return.json')));assert.equal(proof.returnExportSha256,proof.nativeAlphaReturnSha256);assert.equal(observation.serviceCaseSha256,sha256(bytes(prefix+'/service-case.json')));}
    const stop=read('service-stop-recovery.json'),stoppedHandoff=bytes('interrupted/handoff.json').toString('utf8'),stoppedRaw=bytes('interrupted/computer-return.json').toString('utf8'),recoveredHandoff=bytes('recovered/handoff.json').toString('utf8'),recoveredRaw=bytes('recovered/computer-return.json').toString('utf8');
    const original=await alpha.inspectComputerReturn(journey.inputs.handoffRaw,journey.inputs.returnRaw),stopped=await alpha.inspectComputerReturn(stoppedHandoff,stoppedRaw),recovered=await alpha.inspectComputerReturn(recoveredHandoff,recoveredRaw);
    requireNativeArtifacts(root,'interrupted',stopped.returned,{completed:false});requireNativeArtifacts(root,'recovered',recovered.returned);
    assert.equal(original.handoff.projectSha256,stopped.handoff.projectSha256);assert.equal(original.handoff.projectSha256,recovered.handoff.projectSha256);assert.notEqual(stopped.handoff.attemptId,recovered.handoff.attemptId);
    assert.match(stop.actualDockerObservedBeforeStop.container,/^[a-f0-9]{12,64}$/);assert(stop.actualDockerObservedBeforeStop.screenshotsBeforeStop>=2);assert.equal(stop.stop.state,'STOP');assert.equal(stop.stop.cleanup,'in-progress');assert.equal(stop.outcome.state,'uncertain');assert.equal(stop.outcome.receipt.observation.processGroupGone,true);assert.equal(stop.outcome.receipt.observation.containerClosed,true);assert.equal(stop.outcome.receipt.observation.providerCalls,0);
    requireNativeSourceCapture(stop.stoppedGrant.admission.binding.computer.nativeSourceCapture,expectedCapture);requireNativeSourceCapture(stop.freshGrant.admission.binding.computer.nativeSourceCapture,expectedCapture);assert.equal(stop.stoppedReturnSha256,sha256(stoppedRaw));assert.equal(stop.recoveredReturnSha256,sha256(recoveredRaw));assert.equal(stop.stoppedGrant.task.input.handoffRaw,stoppedHandoff);assert.equal(stop.freshGrant.task.input.handoffRaw,recoveredHandoff);assert.notEqual(stop.stoppedGrant.grant,stop.freshGrant.grant);
    assert.equal(stop.reconciliation.eligible,true);assert.equal(stop.reconciliation.kind,'recorded-scripted-computer-closure');assert.equal(stop.reconciliation.replayAllowed,false);assert.equal(stop.reconciliation.observationSha256,sha256(canonical(stop.outcome.receipt.observation)));assert.equal(stop.reconciled.state,'reconciled');assert.equal(stop.reconciled.receipt.disposition,'closed-without-success');assert.equal(stop.reconciled.receipt.priorCommitment,stop.reconciliation.commitment);assert.deepEqual(stop.reconciled.receipt.priorOutcome,stop.outcome.receipt);
    assert.equal(stop.freshRun.state,'complete');assert.equal(stop.freshRun.receipt.inputSha256,sha256(canonical(stop.freshGrant.task)));assert.equal(stop.freshRun.receipt.outputSha256,sha256(canonical(stop.freshRun.receipt.result)));assert.equal(stop.freshGrant.admission.binding.computer.permit,recovered.returned.taskCommitment);assert.equal(stop.stoppedGrant.admission.binding.computer.permit,stopped.returned.taskCommitment);
    for(const key of ['refusedAfterRestart','refusedAfterResume','refusedFreshReplay'])assert.match(stop[key].error,/STOP_RECONCILIATION_REQUIRED|GRANT_UNAVAILABLE/);
    assert.deepEqual(stop.completedAndReconciledStates.map(row=>row.state).sort(),['complete','complete','reconciled']);
    let history=await alpha.retainComputerHandoff(original.project,journey.inputs.handoffRaw);history=await alpha.importComputerReturn(original.project,journey.inputs.handoffRaw,journey.inputs.returnRaw,{priorRecord:history});
    for(const [handoff,returned] of [[stoppedHandoff,stoppedRaw],[recoveredHandoff,recoveredRaw]]){history=await alpha.retainComputerHandoff(original.project,handoff,{priorRecord:history});history=await alpha.importComputerReturn(original.project,handoff,returned,{priorRecord:history});}
    assert.equal(history,bytes('recovery-retained-history.json').toString('utf8'));const inspected=await alpha.inspectComputerHistory(history);assert.equal(inspected.records.length,3);assert(inspected.records.every(record=>record.review===null));
    const service=read('service-observation.json');assert.equal(service.negativeCaseScope,'SEPARATE_COUNTERFACTUAL_SANDBOX_SAME_HANDOFF_NOT_A_SECOND_PROJECT_HISTORY_RECORD');assert.equal(service.recovery.proofSha256,sha256(bytes('service-stop-recovery.json')));assert.equal(service.recovery.historySha256,sha256(history));
    dashboard=inspectDashboardEvidence(root,producer);gui=await inspectGuiEvidence({root,alphaRoot,jobsRoot,managerRoot,producer,sourceCommits:lock});assert.deepEqual(read('complete-journey-index.json'),gui);
  }
  const negativeHandoff=bytes('rejected-late/handoff.json').toString('utf8'),negativeRaw=bytes('rejected-late/computer-return.json').toString('utf8'),negativeNative=await alpha.inspectComputerReturn(negativeHandoff,negativeRaw),negativeBrowser=read('rejected-late/browser-evidence.json'),negativeReport=read('rejected-late/frozen-mission-report.json');
  requireNativeSourceCapture(negativeBrowser.nativeSourceCapture,expectedCapture);
  await jobsEngine.verifyComputerMissionReport(negativeReport);requireNativeArtifacts(root,'rejected-late',negativeNative.returned);
  assert.equal(negativeBrowser.realBrowser,true);assert.equal(negativeBrowser.dockerIsolation,true);assert.equal(negativeNative.returned.execution.image,returned.execution.image);
  const rejectedResult=requireRejectedAllocation(negativeReport,negativeNative.returned);assert.equal((await jobsEngine.reviewObservedAllocation(negativeReport,rejectedResult)).accepted,false);
  let rejection;try {await createComputerJourney({handoffRaw:negativeHandoff,returnRaw:negativeRaw,reportRaw:bytes('rejected-late/frozen-mission-report.json').toString('utf8')},{...installed,...journey.planning});}catch(error){rejection=error;}
  assert(rejection,'Negative raw inputs must be rejected by the installed complete bridge');assert.equal(negative.errorCode,rejection.code??rejection.message);assert.equal(negative.actualBrowserResultRejected,true);
  assert.equal(integration.realBrowser,true);assert.equal(browser.realBrowser,true);assert.equal(browser.dockerIsolation,true);assert.equal(browser.actuator,'docker');
  assert.equal(integration.scope,'ACTUAL_NATIVE_BROWSER_ENGINEERING_REHEARSAL');assert.equal(integration.productionQualified,false);assert.equal(integration.independentlyImplementedConstraintCheck,true);assert.equal(integration.independentlyControlledEconomicReview,false);
  for(const key of ['alpha','jobs','manager'])assert.equal(integration.sourceCommits[key],lock[key]);assert.equal(integration.sourceCommits.fleet,producer.commit);
  assert.equal(jobs.alphaSourceCommit,lock.alpha);assert.equal(jobs.reviewedSourceExecution,'IMMUTABLE_CAPTURED_ESM_GRAPH');assert.equal(manager.sourceCommit,lock.manager);assert.deepEqual(manager.reviewedSourceCommits,{alpha:lock.alpha,jobs:lock.jobs});assert.equal(manager.reviewedSourceExecution,'IMMUTABLE_CAPTURED_ESM_GRAPH');
  assert.equal(jobs.draftSha256,sha256(bytes(producer.architecture?'gui/jobs-en/proposal.json':'accepted/jobs-agialpha-draft.json')));assert.equal(manager.draftSha256,sha256(bytes(producer.architecture?'gui/manager-en/proposal.json':'accepted/manager-usdc-draft.json')));
  const returnSha=sha256(bytes('accepted/computer-return.json'));assert.equal(jobs.nativeReturnSha256,returnSha);assert.equal(manager.bindings.returnRawSha256,'sha256:'+returnSha);assert.deepEqual(jobs.project,manager.project);assert.deepEqual(jobs.bindings,manager.bindings);
  inspectMockGas(jobs);
  assert.equal(jobs.scope,'fresh-in-process-hardhat-31337');assert.equal(jobs.deployment.chainId,31337);assert.equal(jobs.accepted.state,'Finalized');assert.equal(jobs.accepted.settlementPerformed,true);assert(BigInt(jobs.accepted.workerPayoutBaseUnits)>0n);assert.equal(jobs.rejected.workerPayoutBaseUnits,'0');assert.equal(jobs.rejected.settlementPerformed,false);
  assert.equal(manager.chainId,31337);assert.equal(manager.realWallets,false);assert.equal(manager.publicNetwork,false);assert.equal(manager.fork,false);assert.equal(manager.successfulMockPayoutObserved,true);assert.equal(manager.rejectedWorkRefunded,true);assert.equal(manager.rejectedWorkerNetPayout,false);
  assert.equal(manager.receipts.length,14);assert(manager.receipts.every(receipt=>/^0x[a-f0-9]{64}$/.test(receipt.transactionHash)&&receipt.status===1&&BigInt(receipt.gasUsed)>0n));assert.equal(manager.deployments.length,10);assert(manager.deployments.every(deployment=>/^0x[a-f0-9]{64}$/.test(deployment.transactionHash)&&deployment.runtimeBytes>0&&deployment.runtimeBytes<=24576));assert(manager.settlementTransfers.some(transfer=>transfer.label==='finalize-approved'&&BigInt(transfer.amountBaseUnits)>0n));
  const selectedFiles=collectPublicEvidenceArtifacts(root,{service:Boolean(producer.architecture)});
  const evidence={schema:'agi-fleet/four-repository-qualified-compatibility-observation/v1',verificationClass:'OFFLINE_SEMANTIC_REPLAY_WITH_CALLER_SUPPLIED_PRODUCER_BINDING',importedFilesAloneProveExecution:false,producer,scope:'REAL_NATIVE_DOCKER_BROWSER_PLUS_TWO_DISPOSABLE_MOCK_TOKEN_LIFECYCLES',sourceCommits:integration.sourceCommits,nativeAndMockChainJourneyPassed:true,...(producer.architecture?{dashboard,gui}:{}),browser:{actions:browser.nativeSession.actions,screenshots:browser.nativeSession.screenshots,nativeElapsedSeconds:browser.elapsedSeconds,nativeSourceCapture:browser.nativeSourceCapture,scriptedAdvice:true,liveProvider:false},routes:{USDC:{scope:manager.scope,payoutBaseUnits:manager.payoutBaseUnits,lifecycleTransactions:manager.receipts.length,accepted:true,rejectedWorkerPayout:false,rejectedBuyerRefund:true},AGIALPHA:{scope:jobs.scope,acceptedMockPayoutBaseUnits:jobs.accepted.workerPayoutBaseUnits,rejectedMockPayoutBaseUnits:'0',rejectedState:jobs.rejected.state}},history:{sameProjectRetained:true,nativeHistoryReopened:true,incumbentRetained:JSON.parse(journey.inputs.reportRaw).decision.state==='INCUMBENT_RETAINED_PENDING_INDEPENDENT_REVIEW',humanReviewPending:true},costs:{currency:'USD',providerRequests:0,scriptedProviderCost:0,deviceCost:null,humanElapsedMinutes:null,realTokenSpend:0,mockManagerGasScope:'14 lifecycle transactions only; deployment and setup excluded',mockManagerGasReceiptCount:manager.receipts.length,mockManagerGasUsed:manager.receipts.reduce((sum,item)=>sum+BigInt(item.gasUsed),0n).toString(),mockJobsGasScope:'all mined fixture transactions including deployment and setup',mockJobsGasReceiptCount:jobs.gasObservation.receipts.length,mockJobsGasUsed:jobs.gasObservation.totalGasUsed},humanMinutes:null,providerBilledCost:0,deviceCost:null,independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false,independentEconomicReview:false,protectedEvaluation:false,productionQualified:false,liveWallets:false,mainnetTransactions:0,authority:'none',artifacts:selectedFiles,limitations:integration.remaining.concat(jobs.limitations)};
  for(const [name,directory]of selected)verifyModuleClosure(directory,lock[name],INSPECTOR_SCOPES[name]);
  if(readOnly)assert.deepEqual(read('compatibility-evidence.json'),evidence,'Retained aggregate differs from independently replayed bytes');else fs.writeFileSync(path.join(root,'compatibility-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return evidence;
  }finally{for(const loader of [...loaders.values()].reverse())loader.dispose();}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const [root,alphaRoot,jobsRoot,managerRoot,...flags]=process.argv.slice(2),index=flags.indexOf('--expected-context');assert(index>=0&&flags[index+1],'Supply --expected-context with independent exact-run JSON');
  const evidence=await verifyEvidence({root,alphaRoot,jobsRoot,managerRoot,readOnly:flags.includes('--read-only'),expectedContext:JSON.parse(flags[index+1])});
  console.log(JSON.stringify({schema:evidence.schema,sourceCommits:evidence.sourceCommits,semanticallyConsistent:true,importedFilesAloneProveExecution:false,artifacts:evidence.artifacts.length}));
}
