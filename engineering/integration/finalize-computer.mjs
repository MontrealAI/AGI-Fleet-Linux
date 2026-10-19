// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createComputerJourney,inspectComputerJourney,sha256} from './bridge.mjs';
import {createVerifiedModuleLoader,verifyModuleClosure,INSPECTOR_SCOPES} from './verify-source.mjs';
const [alphaRoot,jobsRoot,managerRoot,evidenceRoot,mode='accepted',fleetRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..')]=process.argv.slice(2);
for(const directory of [alphaRoot,jobsRoot,managerRoot,evidenceRoot])if(!path.isAbsolute(directory??''))throw Error('Absolute reviewed checkout and evidence paths required');
if(!['accepted','rejected','protocol'].includes(mode))throw Error('Unsupported evidence mode');
const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url)));
const selected=[['alpha',alphaRoot],['jobs',jobsRoot],['manager',managerRoot]],loaders=new Map();
try{
for(const [name,root]of selected)loaders.set(root,createVerifiedModuleLoader(root,lock[name],INSPECTOR_SCOPES[name]));
const load=(root,relative)=>loaders.get(root).importModule(relative);
const alpha=await load(alphaRoot,'examples/successor-alpha/computer.mjs');
const jobs=await load(jobsRoot,'integrations/alpha-agent/four-repo-computer-receipt.mjs');
const manager=await load(managerRoot,'scripts/integrations/four-repo-computer-receipt.mjs');
const nativeJobs=await load(jobsRoot,'packages/successor-core/src/computer-mission.mjs');
const options={inspectAlphaReturn:alpha.inspectComputerReturn,inspectComputerEvidence:jobs.inspectComputerReceiptEvidence,reviewObservedAllocation:nativeJobs.reviewObservedAllocation,
  createManagerDraft:manager.createComputerReceiptDraft,inspectManagerDraft:manager.inspectComputerReceiptDraft,
  createJobsDraft:jobs.createComputerReceiptDraft,inspectJobsDraft:jobs.inspectComputerReceiptDraft,
  retainHistory:alpha.retainComputerHandoff,importReturn:alpha.importComputerReturn,inspectHistory:alpha.inspectComputerHistory,
  budgetUSDC:'25.00',amountBaseUnits:'7000000000000000000',createdAt:new Date().toISOString()};
const read=name=>fs.readFileSync(path.join(evidenceRoot,name),'utf8');
const inputs={handoffRaw:read('handoff.json'),returnRaw:read('computer-return.json'),reportRaw:read('frozen-mission-report.json')};
const browser=JSON.parse(read('browser-evidence.json'));
if(mode!=='protocol'&&browser.realBrowser!==true)throw Error('Actual browser execution required; protocol fixtures do not satisfy this gate');
if(mode!=='protocol'){
  const native=await alpha.inspectComputerReturn(inputs.handoffRaw,inputs.returnRaw);
  if(browser.nativeSession.actions!==native.returned.receipt.actions_reserved||browser.nativeSession.screenshots!==native.returned.receipt.screenshots.length)throw Error('Browser evidence differs from native action and screenshot reservations');
  for(const screenshot of native.returned.receipt.screenshots){
    const file=path.join(evidenceRoot,'native',screenshot.file),info=fs.lstatSync(file);
    if(!info.isFile()||info.size>2_000_000||fs.realpathSync(file)!==file)throw Error('Retained screenshot must be a bounded regular artifact');
    const bytes=fs.readFileSync(file);
    if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||sha256(bytes)!==screenshot.sha256)throw Error('Retained actual PNG differs from native receipt');
  }
  if(read('native/visible-text.txt')!==native.returned.observedText)throw Error('Visible browser text differs from the bound native return');
}
if(mode==='rejected'){
  let failure;try{await createComputerJourney(inputs,options);}catch(error){failure=error;}
  if(!failure)throw Error('Invalid actual browser allocation was accepted');
  const result={schema:'agi-fleet/four-repository-negative-observation/v1',actualBrowserResultRejected:true,errorCode:failure.code??failure.message,authority:'none',settlement:'not-connected'};
  for(const [name,root]of selected)verifyModuleClosure(root,lock[name],INSPECTOR_SCOPES[name]);
  fs.writeFileSync(path.join(evidenceRoot,'rejection-evidence.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}else{
  const started=performance.now(),raw=await createComputerJourney(inputs,options),journey=await inspectComputerJourney(raw,options);
  for(const [name,root]of selected)verifyModuleClosure(root,lock[name],INSPECTOR_SCOPES[name]);
  fs.writeFileSync(path.join(evidenceRoot,'complete-journey.json'),raw,{flag:'wx'});
  fs.writeFileSync(path.join(evidenceRoot,'manager-usdc-draft.json'),journey.routes.managerRaw,{flag:'wx'});
  fs.writeFileSync(path.join(evidenceRoot,'jobs-agialpha-draft.json'),journey.routes.jobsRaw,{flag:'wx'});
  fs.writeFileSync(path.join(evidenceRoot,'alpha-retained-history.json'),journey.historyRaw,{flag:'wx'});
  const report=JSON.parse(inputs.reportRaw);
  const result={schema:'agi-fleet/four-repository-integration-evidence/v1',scope:mode==='protocol'?'PROTOCOL_DOUBLE_NO_BROWSER':'ACTUAL_NATIVE_BROWSER_ENGINEERING_REHEARSAL',realBrowser:browser.realBrowser,sourceCommits:Object.fromEntries([['alpha',alphaRoot],['jobs',jobsRoot],['manager',managerRoot],['fleet',fleetRoot]].map(([name,root])=>[name,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()])),
    journeySha256:sha256(raw),journeyBytes:Buffer.byteLength(raw),semanticReplayMilliseconds:performance.now()-started,
    result:{procurementQuoteCurrency:'USD',syntheticCandidateQuoteCents:report.frozen.plan.costCents,syntheticIncumbentQuoteCents:report.decision.retainedPlan?.costCents??null,syntheticQuoteDifferenceCents:report.decision.quotedCostDifferenceFromIncumbentCents,developmentAttempts:report.development.attempts.length,publicGeneratedConfirmationCases:report.confirmation.cases.length,incumbentRetained:true,sameTaskSuperiority:report.decision.sameTaskSuperiority,actualPaidProcurement:0,actualBrowserActions:browser.realBrowser?browser.nativeSession.actions:null,actualScreenshots:browser.realBrowser?browser.nativeSession.screenshots:null,providerRequests:0,providerBilledCost:0,deviceCost:null,humanMinutes:null},
    sameProjectRetained:true,paymentRoutes:['USDC unsigned proposed budget','AGIALPHA unsigned proposed allowance'],currencyConversion:false,actualSettlement:false,independentlyImplementedConstraintCheck:journey.constraintCheck.independentlyImplementedConstraintCheck,independentlyControlledEconomicReview:false,independentEconomicReview:false,protectedEvaluation:false,fleetProductionDispatch:false,productionQualified:false,authority:'none',remaining:['Scripted advice does not establish live model quality.','Quoted synthetic allocation is not realized savings.','Device cost and human effort remain unmeasured.','Local arithmetic checks are not independently controlled economic review.','Fleet engineering orchestrates this rehearsal; production browser dispatch remains unavailable.','No real-wallet signing, Mainnet transaction, funded admission or activation occurred.']};
  fs.writeFileSync(path.join(evidenceRoot,'integration-evidence.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
}

for(const [name,root]of selected)verifyModuleClosure(root,lock[name],INSPECTOR_SCOPES[name]);
}finally{for(const loader of [...loaders.values()].reverse())loader.dispose();}
