// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createVerifiedModuleLoader,verifyModuleClosure,INSPECTOR_SCOPES} from './verify-source.mjs';

export async function prepare({alphaRoot,jobsRoot,sourceHash}) {
  const lock=JSON.parse(fs.readFileSync(new URL('./compatibility-set.json',import.meta.url))),selected=[['alpha',alphaRoot],['jobs',jobsRoot]],loaders=new Map();
  try{
  for(const [name,root]of selected)loaders.set(root,createVerifiedModuleLoader(root,lock[name],INSPECTOR_SCOPES[name]));
  const load=(root,relative)=>loaders.get(root).importModule(relative),capturedHash=loaders.get(alphaRoot).sourceSha256('examples/successor-alpha/computer.mjs');
  if(sourceHash!==undefined)assert.equal(sourceHash,capturedHash,'Prepared computer source must match captured reviewed bytes');sourceHash=capturedHash;
  const alpha=await load(alphaRoot,'examples/successor-alpha/computer.mjs');
  const project=await load(alphaRoot,'examples/successor-alpha/project.mjs');
  const jobs=await load(jobsRoot,'packages/successor-core/src/computer-mission.mjs');
  const renderer=await load(jobsRoot,'scripts/pages/computer-mission.mjs');
  const mission=await jobs.createComputerMission();
  const report=await jobs.runComputerMission(mission,{formulationApproval:{approved:true,ownerLabel:'Disposable integration fixture operator',reason:'In this synthetic fixture, preserve ten units by day seven and forty by day fourteen; this is not live owner approval.'}});
  const goal='Meet the unchanged staged delivery requirements within the stated budget using the supplied public synthetic supplier quotes.';
  const dossier=project.createProject({name:'SUCCESSOR Ω bounded computer integration',goal});
  const handoffRaw=await alpha.createComputerHandoff(dossier,{sourceHash,goal,selected:'reframe',
    valueHypothesis:'A bounded allocation may meet the actual outcome at a lower quoted cost; market savings and model quality remain unestablished.',
    hypotheses:['Order every unit from a single early supplier.','Split early demand and remaining demand among suppliers.','Enumerate bounded integer allocations with landed freight costs.'],
    combination:'Compare landed costs and exact integer allocations, then separately verify delivery constraints.',
    reframing:'Require only the actually needed early units by the early deadline; retain the original total units, final deadline and budget.',
    successCriteria:['Meet every unchanged actual delivery requirement.','Preserve exact mission and frozen program commitments.','Separate quoted procurement costs from unknown execution and human costs.'],
    html:renderer.renderComputerDeskTaskHTML(report),inputRights:report.mission.inputRights.classification,license:report.mission.inputRights.license,
    maxTurns:8,maxActions:30,maxSeconds:90,reviewMinutes:5});
  for(const [name,root]of selected)verifyModuleClosure(root,lock[name],INSPECTOR_SCOPES[name]);
  return {handoffRaw,reportRaw:JSON.stringify(report),projectRaw:JSON.parse(handoffRaw).projectRaw};
  }finally{for(const loader of [...loaders.values()].reverse())loader.dispose();}
}
if (process.argv[1]===new URL(import.meta.url).pathname) {
  const [alphaRoot,jobsRoot]=process.argv.slice(2);
  if (!path.isAbsolute(alphaRoot??'')||!path.isAbsolute(jobsRoot??''))throw Error('Absolute reviewed checkout roots required');
  console.log(JSON.stringify(await prepare({alphaRoot,jobsRoot})));
}
