// SPDX-License-Identifier: MIT
// Offline semantic replay. Artifact bytes alone do not attest actual execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sha256,inspectComputerJourney,createComputerJourney} from './bridge.mjs';
import {checkAllocation,extractObservedAllocation} from './independent-checker.mjs';
import {verifyModuleClosure} from './verify-source.mjs';
export function requireNativeArtifacts(root,prefix,returned){
  assert.equal(returned.authority,'none');assert.equal(returned.verified,false);
  assert.equal(returned.receipt?.state,'review');assert.equal(returned.receipt?.cleanup,'VERIFIED');
  assert.equal(returned.execution?.provider?.model,'SCRIPTED_COMPUTER_FIXTURE_NOT_LIVE_MODEL');
  assert.equal(returned.execution.provider.endpoint,'http://127.0.0.1/fixture-no-network');
  assert(returned.receipt.actions_reserved>=14);assert(returned.receipt.screenshots.length>=15);
  const seen=new Set();
  for(const screenshot of returned.receipt.screenshots){
    assert.match(screenshot.file,/^screen-[0-9]{3}\.png$/);assert(!seen.has(screenshot.file));seen.add(screenshot.file);
    const file=path.join(root,prefix,'native',screenshot.file),info=fs.lstatSync(file);
    assert(info.isFile()&&!info.isSymbolicLink());assert.equal(fs.realpathSync(file),file);assert(info.size<=2_000_000);
    const image=fs.readFileSync(file);assert(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.equal(sha256(image),screenshot.sha256);
  }
  assert.equal(fs.readFileSync(path.join(root,prefix,'native/visible-text.txt'),'utf8'),returned.observedText);
}
export function requireRejectedAllocation(report,returned){
  const result=extractObservedAllocation(returned.observedText);
  assert.equal(result.reportDigest,report.digest);assert.equal(result.frozenProgramDigest,report.frozen.programDigest);
  assert.equal(checkAllocation(report.mission,result).accepted,false,'Positive raw results cannot prove a negative browser case');return result;
}
export async function verifyEvidence({root,alphaRoot,jobsRoot,managerRoot,readOnly=false,expectedContext}) {
  for(const selected of [root,alphaRoot,jobsRoot,managerRoot])assert(path.isAbsolute(selected??''),'Supply absolute evidence and three source roots');
  const bytes=name=>fs.readFileSync(path.join(root,name)),read=name=>JSON.parse(bytes(name));
  const producer=read('execution-context.json');assert(expectedContext&&typeof expectedContext==='object','An independently supplied expected producer context is required');assert.deepEqual(producer,expectedContext);
  assert.match(producer.commit,/^[a-f0-9]{40}$/);assert.equal(producer.repository,'MontrealAI/AGI-Fleet-Linux');assert.match(String(producer.workflowRun),/^[1-9][0-9]*$/);assert.match(String(producer.workflowAttempt),/^[1-9][0-9]*$/);
  const integration=read('accepted/integration-evidence.json'),browser=read('accepted/browser-evidence.json'),jobs=read('jobs-local-lifecycle.json'),manager=read('manager-local-lifecycle.json'),negative=read('rejected-late/rejection-evidence.json');
  const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url)));
  const entries={alpha:['examples/successor-alpha/computer.mjs'],jobs:['integrations/alpha-agent/four-repo-computer-receipt.mjs','packages/successor-core/src/computer-mission.mjs'],manager:['scripts/integrations/four-repo-computer-receipt.mjs']};
  const scopes={alpha:[['examples/successor-alpha',true],['examples/successor-workbench',true],['examples/build-successor',true],['examples/alpha-discovery',true],['docs/assets/successor',true]],jobs:[['packages/successor-core/src',true],['scripts/pages',false],['website/assets',false],['integrations/alpha-agent',false]],manager:[['scripts/integrations',false],['site/assets/successor',true]]};
  for(const [name,directory] of [['alpha',alphaRoot],['jobs',jobsRoot],['manager',managerRoot]])verifyModuleClosure(directory,lock[name],scopes[name]);
  const load=(directory,relative)=>import(pathToFileURL(path.join(directory,relative)).href);
  const alpha=await load(alphaRoot,entries.alpha[0]),jobsInspector=await load(jobsRoot,entries.jobs[0]),managerInspector=await load(managerRoot,entries.manager[0]),jobsEngine=await load(jobsRoot,entries.jobs[1]);
  const installed={inspectAlphaReturn:alpha.inspectComputerReturn,inspectComputerEvidence:jobsInspector.inspectComputerReceiptEvidence,reviewObservedAllocation:jobsEngine.reviewObservedAllocation,createManagerDraft:managerInspector.createComputerReceiptDraft,inspectManagerDraft:managerInspector.inspectComputerReceiptDraft,createJobsDraft:jobsInspector.createComputerReceiptDraft,inspectJobsDraft:jobsInspector.inspectComputerReceiptDraft,retainHistory:alpha.retainComputerHandoff,importReturn:alpha.importComputerReturn,inspectHistory:alpha.inspectComputerHistory};
  const journeyRaw=bytes('accepted/complete-journey.json').toString('utf8'),journey=await inspectComputerJourney(journeyRaw,installed);
  assert.equal(sha256(journeyRaw),integration.journeySha256);
  for(const [key,file] of [['handoffRaw','handoff.json'],['returnRaw','computer-return.json'],['reportRaw','frozen-mission-report.json']])assert.equal(journey.inputs[key],bytes('accepted/'+file).toString('utf8'));
  assert.equal(journey.routes.managerRaw,bytes('accepted/manager-usdc-draft.json').toString('utf8'));assert.equal(journey.routes.jobsRaw,bytes('accepted/jobs-agialpha-draft.json').toString('utf8'));assert.equal(journey.historyRaw,bytes('accepted/alpha-retained-history.json').toString('utf8'));
  assert.equal(journey.constraintCheck.accepted,true);assert.equal(journey.constraintCheck.independentlyImplementedConstraintCheck,true);assert.equal(journey.constraintCheck.independentlyControlledEconomicReview,false);
  const returned=read('accepted/computer-return.json');requireNativeArtifacts(root,'accepted',returned);
  assert.equal(returned.execution.image,read('worker-image-inspect.json')[0].Id);assert.equal(browser.nativeSession.actions,returned.receipt.actions_reserved);assert.equal(browser.nativeSession.screenshots,returned.receipt.screenshots.length);
  const negativeHandoff=bytes('rejected-late/handoff.json').toString('utf8'),negativeRaw=bytes('rejected-late/computer-return.json').toString('utf8'),negativeNative=await alpha.inspectComputerReturn(negativeHandoff,negativeRaw),negativeBrowser=read('rejected-late/browser-evidence.json'),negativeReport=read('rejected-late/frozen-mission-report.json');
  await jobsEngine.verifyComputerMissionReport(negativeReport);requireNativeArtifacts(root,'rejected-late',negativeNative.returned);
  assert.equal(negativeBrowser.realBrowser,true);assert.equal(negativeBrowser.dockerIsolation,true);assert.equal(negativeNative.returned.execution.image,returned.execution.image);
  const rejectedResult=requireRejectedAllocation(negativeReport,negativeNative.returned);assert.equal((await jobsEngine.reviewObservedAllocation(negativeReport,rejectedResult)).accepted,false);
  let rejection;try {await createComputerJourney({handoffRaw:negativeHandoff,returnRaw:negativeRaw,reportRaw:bytes('rejected-late/frozen-mission-report.json').toString('utf8')},{...installed,...journey.planning});}catch(error){rejection=error;}
  assert(rejection,'Negative raw inputs must be rejected by the installed complete bridge');assert.equal(negative.errorCode,rejection.code??rejection.message);assert.equal(negative.actualBrowserResultRejected,true);
  assert.equal(integration.realBrowser,true);assert.equal(browser.realBrowser,true);assert.equal(browser.dockerIsolation,true);assert.equal(browser.actuator,'docker');
  assert.equal(integration.scope,'ACTUAL_NATIVE_BROWSER_ENGINEERING_REHEARSAL');assert.equal(integration.productionQualified,false);assert.equal(integration.independentlyImplementedConstraintCheck,true);assert.equal(integration.independentlyControlledEconomicReview,false);
  for(const key of ['alpha','jobs','manager'])assert.equal(integration.sourceCommits[key],lock[key]);assert.equal(integration.sourceCommits.fleet,producer.commit);
  assert.equal(jobs.alphaSourceCommit,lock.alpha);assert.equal(manager.sourceCommit,lock.manager);
  assert.equal(jobs.draftSha256,sha256(bytes('accepted/jobs-agialpha-draft.json')));assert.equal(manager.draftSha256,sha256(bytes('accepted/manager-usdc-draft.json')));
  const returnSha=sha256(bytes('accepted/computer-return.json'));assert.equal(jobs.nativeReturnSha256,returnSha);assert.equal(manager.bindings.returnRawSha256,'sha256:'+returnSha);assert.deepEqual(jobs.project,manager.project);assert.deepEqual(jobs.bindings,manager.bindings);
  assert.equal(jobs.scope,'fresh-in-process-hardhat-31337');assert.equal(jobs.deployment.chainId,31337);assert.equal(jobs.accepted.state,'Finalized');assert.equal(jobs.accepted.settlementPerformed,true);assert(BigInt(jobs.accepted.workerPayoutBaseUnits)>0n);assert.equal(jobs.rejected.workerPayoutBaseUnits,'0');assert.equal(jobs.rejected.settlementPerformed,false);
  assert.equal(manager.chainId,31337);assert.equal(manager.realWallets,false);assert.equal(manager.publicNetwork,false);assert.equal(manager.fork,false);assert.equal(manager.successfulMockPayoutObserved,true);assert.equal(manager.rejectedWorkRefunded,true);assert.equal(manager.rejectedWorkerNetPayout,false);
  assert.equal(manager.receipts.length,14);assert(manager.receipts.every(receipt=>/^0x[a-f0-9]{64}$/.test(receipt.transactionHash)&&receipt.status===1&&BigInt(receipt.gasUsed)>0n));assert.equal(manager.deployments.length,10);assert(manager.deployments.every(deployment=>/^0x[a-f0-9]{64}$/.test(deployment.transactionHash)&&deployment.runtimeBytes>0&&deployment.runtimeBytes<=24576));assert(manager.settlementTransfers.some(transfer=>transfer.label==='finalize-approved'&&BigInt(transfer.amountBaseUnits)>0n));
  const selectedFiles=[];
  for(const directory of ['','accepted','accepted/native','rejected-late','rejected-late/native'])for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){if(!entry.isFile()||entry.name==='compatibility-evidence.json'||!(/\.(?:json|png|zip|txt)$/.test(entry.name)))continue;const name=path.join(directory,entry.name);selectedFiles.push({name,bytes:bytes(name).length,sha256:sha256(bytes(name))});}
  selectedFiles.sort((a,b)=>a.name.localeCompare(b.name));
  const evidence={schema:'agi-fleet/four-repository-qualified-compatibility-observation/v1',verificationClass:'OFFLINE_SEMANTIC_REPLAY_WITH_CALLER_SUPPLIED_PRODUCER_BINDING',importedFilesAloneProveExecution:false,producer,scope:'REAL_NATIVE_DOCKER_BROWSER_PLUS_TWO_DISPOSABLE_MOCK_TOKEN_LIFECYCLES',sourceCommits:integration.sourceCommits,nativeAndMockChainJourneyPassed:true,browser:{actions:browser.nativeSession.actions,screenshots:browser.nativeSession.screenshots,nativeElapsedSeconds:browser.elapsedSeconds,scriptedAdvice:true,liveProvider:false},routes:{USDC:{scope:manager.scope,payoutBaseUnits:manager.payoutBaseUnits,lifecycleTransactions:manager.receipts.length,accepted:true,rejectedWorkerPayout:false,rejectedBuyerRefund:true},AGIALPHA:{scope:jobs.scope,acceptedMockPayoutBaseUnits:jobs.accepted.workerPayoutBaseUnits,rejectedMockPayoutBaseUnits:'0',rejectedState:jobs.rejected.state}},humanMinutes:null,providerBilledCost:null,deviceCost:null,independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false,independentEconomicReview:false,protectedEvaluation:false,productionQualified:false,liveWallets:false,mainnetTransactions:0,authority:'none',artifacts:selectedFiles,limitations:integration.remaining.concat(jobs.limitations)};
  if(readOnly)assert.deepEqual(read('compatibility-evidence.json'),evidence,'Retained aggregate differs from independently replayed bytes');else fs.writeFileSync(path.join(root,'compatibility-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return evidence;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const [root,alphaRoot,jobsRoot,managerRoot,...flags]=process.argv.slice(2),index=flags.indexOf('--expected-context');assert(index>=0&&flags[index+1],'Supply --expected-context with independent exact-run JSON');
  const evidence=await verifyEvidence({root,alphaRoot,jobsRoot,managerRoot,readOnly:flags.includes('--read-only'),expectedContext:JSON.parse(flags[index+1])});
  console.log(JSON.stringify({schema:evidence.schema,sourceCommits:evidence.sourceCommits,semanticallyConsistent:true,importedFilesAloneProveExecution:false,artifacts:evidence.artifacts.length}));
}
