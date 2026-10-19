// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from './bridge.mjs';
const [root]=process.argv.slice(2);assert(path.isAbsolute(root??''),'Supply the absolute hosted evidence root');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const bytes=name=>fs.readFileSync(path.join(root,name));
const integration=read('accepted/integration-evidence.json'),browser=read('accepted/browser-evidence.json');
const jobs=read('jobs-local-lifecycle.json'),manager=read('manager-local-lifecycle.json'),negative=read('rejected-late/rejection-evidence.json');
const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url)));
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const journeyRaw=bytes('accepted/complete-journey.json').toString('utf8'),journey=JSON.parse(journeyRaw),{sha256:journeyDigest,...journeyBody}=journey;
assert.equal(sha256(journeyRaw),integration.journeySha256);assert.equal(sha256(canonical(journeyBody)),journeyDigest);assert.equal(canonical(journey),journeyRaw);
assert.equal(journey.inputs.handoffRaw,bytes('accepted/handoff.json').toString('utf8'));assert.equal(journey.inputs.returnRaw,bytes('accepted/computer-return.json').toString('utf8'));assert.equal(journey.inputs.reportRaw,bytes('accepted/frozen-mission-report.json').toString('utf8'));
assert.equal(journey.routes.managerRaw,bytes('accepted/manager-usdc-draft.json').toString('utf8'));assert.equal(journey.routes.jobsRaw,bytes('accepted/jobs-agialpha-draft.json').toString('utf8'));assert.equal(journey.historyRaw,bytes('accepted/alpha-retained-history.json').toString('utf8'));
assert.equal(journey.constraintCheck.accepted,true);assert.equal(journey.constraintCheck.independentlyImplementedConstraintCheck,true);assert.equal(journey.constraintCheck.independentlyControlledEconomicReview,false);
const returned=read('accepted/computer-return.json');assert.equal(returned.authority,'none');assert.equal(returned.verified,false);assert.equal(returned.receipt.state,'review');assert.equal(returned.receipt.cleanup,'VERIFIED');
assert.equal(returned.execution.image,read('worker-image-inspect.json')[0].Id);
assert.equal(browser.nativeSession.actions,returned.receipt.actions_reserved);assert.equal(browser.nativeSession.screenshots,returned.receipt.screenshots.length);
for(const screenshot of returned.receipt.screenshots){assert.match(screenshot.file,/^screen-[0-9]{3}\.png$/);assert.equal(sha256(bytes('accepted/native/'+screenshot.file)),screenshot.sha256);}
assert.equal(bytes('accepted/native/visible-text.txt').toString('utf8'),returned.observedText);
assert.equal(integration.realBrowser,true);assert.equal(browser.realBrowser,true);assert.equal(browser.dockerIsolation,true);assert.equal(browser.actuator,'docker');
assert.equal(integration.scope,'ACTUAL_NATIVE_BROWSER_ENGINEERING_REHEARSAL');
assert.equal(integration.productionQualified,false);assert.equal(integration.independentlyImplementedConstraintCheck,true);assert.equal(integration.independentlyControlledEconomicReview,false);
for(const key of ['alpha','jobs','manager'])assert.equal(integration.sourceCommits[key],lock[key],'Evidence must bind the selected exact source set');
assert.equal(jobs.alphaSourceCommit,lock.alpha);assert.equal(manager.sourceCommit,lock.manager);
assert.equal(jobs.draftSha256,sha256(bytes('accepted/jobs-agialpha-draft.json')));assert.equal(manager.draftSha256,sha256(bytes('accepted/manager-usdc-draft.json')));
const returnSha=sha256(bytes('accepted/computer-return.json'));
assert.equal(jobs.nativeReturnSha256,returnSha);assert.equal(manager.bindings.returnRawSha256,'sha256:'+returnSha);
assert.deepEqual(jobs.project,manager.project);assert.deepEqual(jobs.bindings,manager.bindings);
assert.equal(jobs.scope,'fresh-in-process-hardhat-31337');assert.equal(jobs.deployment.chainId,31337);
assert.equal(jobs.accepted.state,'Finalized');assert.equal(jobs.accepted.settlementPerformed,true);assert(BigInt(jobs.accepted.workerPayoutBaseUnits)>0n);
assert.equal(jobs.rejected.workerPayoutBaseUnits,'0');assert.equal(jobs.rejected.settlementPerformed,false);
assert.equal(manager.chainId,31337);assert.equal(manager.realWallets,false);assert.equal(manager.publicNetwork,false);assert.equal(manager.fork,false);
assert.equal(manager.successfulMockPayoutObserved,true);assert.equal(manager.rejectedWorkRefunded,true);assert.equal(manager.rejectedWorkerNetPayout,false);
assert.equal(negative.actualBrowserResultRejected,true);
const selectedFiles=[];
for(const directory of ['','accepted','accepted/native','rejected-late','rejected-late/native']){
  const absolute=path.join(root,directory);if(!fs.existsSync(absolute))continue;
  for(const entry of fs.readdirSync(absolute,{withFileTypes:true})){if(!entry.isFile()||!(/\.(?:json|png|zip|txt)$/.test(entry.name)))continue;const name=path.join(directory,entry.name);selectedFiles.push({name,bytes:bytes(name).length,sha256:sha256(bytes(name))});}
}
selectedFiles.sort((a,b)=>a.name.localeCompare(b.name));
const evidence={schema:'agi-fleet/four-repository-qualified-compatibility-observation/v1',scope:'REAL_NATIVE_DOCKER_BROWSER_PLUS_TWO_DISPOSABLE_MOCK_TOKEN_LIFECYCLES',sourceCommits:integration.sourceCommits,
  nativeAndMockChainJourneyPassed:true,browser:{actions:browser.nativeSession.actions,screenshots:browser.nativeSession.screenshots,nativeElapsedSeconds:browser.elapsedSeconds,scriptedAdvice:true,liveProvider:false},
  routes:{USDC:{scope:manager.scope,payoutBaseUnits:manager.payoutBaseUnits,lifecycleTransactions:manager.receipts.length,accepted:true,rejectedWorkerPayout:false,rejectedBuyerRefund:true},AGIALPHA:{scope:jobs.scope,acceptedMockPayoutBaseUnits:jobs.accepted.workerPayoutBaseUnits,rejectedMockPayoutBaseUnits:'0',rejectedState:jobs.rejected.state}},
  humanMinutes:null,providerBilledCost:null,deviceCost:null,independentlyImplementedConstraintCheck:true,independentlyControlledEconomicReview:false,independentEconomicReview:false,protectedEvaluation:false,productionQualified:false,liveWallets:false,mainnetTransactions:0,authority:'none',artifacts:selectedFiles,
  limitations:integration.remaining.concat(jobs.limitations)};
fs.writeFileSync(path.join(root,'compatibility-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({schema:evidence.schema,sourceCommits:evidence.sourceCommits,nativeAndMockChainJourneyPassed:true,realBrowser:true,realWallets:false,productionQualified:false,artifacts:selectedFiles.length},null,2));
