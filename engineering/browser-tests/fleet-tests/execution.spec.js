import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.env.FLEET_TEST_ROOT;
if(!root)throw Error('FLEET_TEST_ROOT must identify the extracted, verified candidate');
const load=p=>import(pathToFileURL(path.join(root,p)));

test('Saved Fleet Controller → ComputeWorker → real browser effects → Node reopens downloaded bytes',async({browser},info)=>{
  if(process.env.CI){const locked=JSON.parse(fs.readFileSync(new URL('../node_modules/playwright-core/browsers.json',import.meta.url)));expect(browser.version()).toBe(locked.browsers.find(b=>b.name==='chromium-headless-shell').browserVersion);}
  const {fixture}=await load('successor/fixture.mjs'),{defaultMission}=await load('successor/vendor/manager/site/assets/successor/missions.mjs'),model=await load('successor/vendor/manager/site/assets/successor/model.mjs'),{prepareImprovement}=await load('successor/vendor/manager/site/assets/successor/jobs.mjs'),{builderArtifacts}=await load('successor/vendor/manager/scripts/successor/build.mjs');
  const source=builderArtifacts().sourceManifest;let state=await model.createSystem(defaultMission('website'));const original=await model.runCandidate(state,'baseline',source.engineSha256);state=await model.chooseCandidate(original.state,original.candidate.id,'keep');
  const capsule=await model.exportCapsule(state,source),request={schema:'agi-fleet/successor-request/v1',capsule,plan:await prepareImprovement(state,{budget:'100'})};
  const browserContext=await browser.newContext({acceptDownloads:true});const page=await browserContext.newPage();const network=[];await browserContext.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
  const a=await fixture(root,'agent',{browser:async({output})=>{
    await page.goto(pathToFileURL(path.join(root,'docs/successor/My-SUCCESSOR-Omega-en.html')).href);
    await page.locator('#import-file').setInputFiles({name:'capsule.json',mimeType:'application/json',buffer:Buffer.from(capsule)});
    await page.locator('#restore-consent').check();await page.locator('#restore').click();
    await page.locator('#public-consent').focus();await page.keyboard.press('Space');await page.locator('#improve-local').click();
    await expect(page.locator('#comparison')).toContainText('measured gap');
    for(const file of output.files){const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download '+file.name,exact:true}).click()]);file.content=fs.readFileSync(await download.path(),'utf8');}
    await page.screenshot({path:info.outputPath('actual-browser-work.png'),fullPage:true});
  }}),n=await fixture(root,'node');
  try{
    for(const f of request.plan.immutableInputs){a.inputs.set(f.name,Buffer.from(f.content));n.inputs.set(f.name,Buffer.from(f.content));}
    const context={schema:'successor-runtime-context/v1',runtimes:{agent:a.health().runtime,reviewer:n.health().runtime},inputs:request.plan.immutableInputs.map(f=>({name:f.name,uri:'https://example.org/'+f.name,sha256:f.sha256,maxBytes:Buffer.byteLength(f.content)})),deadline:Math.floor(Date.now()/1000)+3600,settlement:{chainId:31337,manager:'0x1111111111111111111111111111111111111111',recovery:'Engineering browser fixture; no payment.'},budget:{maxAgentSeconds:60,maxReviewSeconds:60,maxAgentCostUSDC:'5',maxReviewCostUSDC:'3'},publicConsent:true};
    const p=await a.bridge.prepare({request,context},'browser-fixture');await a.bridge.execute({ticket:p.ticket,key:p.key,confirm:true},'browser-fixture');await a.controller.studio.task;const actual=await a.bridge.result(p.key);
    expect(actual.receipt.status,JSON.stringify(actual.receipt.error)).toBe('checked');const q=await n.bridge.prepare({handoff:actual.handoff},'separate-node');await n.bridge.execute({ticket:q.ticket,key:q.key,confirm:true},'separate-node');await n.controller.studio.task;
    const review=await n.bridge.result(q.key),checked=await a.bridge.result(p.key,review.receipt);expect(checked.outcome).toBe('accepted');expect(checked.selected).toBe(state.active);expect(network).toEqual([]);
    const metadata=process.env.FLEET_TEST_METADATA?JSON.parse(fs.readFileSync(process.env.FLEET_TEST_METADATA,'utf8')):null;
    fs.writeFileSync(info.outputPath('evidence.json'),JSON.stringify({status:'PASS',workflowCommit:process.env.GITHUB_SHA??null,workflowRun:process.env.GITHUB_RUN_ID??null,workflowAttempt:process.env.GITHUB_RUN_ATTEMPT??null,archiveSHA256:metadata?.sha256??null,sourceRevisionSHA256:JSON.parse(fs.readFileSync(path.join(root,'source-inventory.json'))).revisionSHA256,screenshotSHA256:createHash('sha256').update(fs.readFileSync(info.outputPath('actual-browser-work.png'))).digest('hex'),browserVersion:browser.version(),actualBrowserEffects:true,actualComputeWorker:true,downloadedBytesChecked:true,deliverySHA256:actual.handoff.deliveryHash,selected:checked.selected,candidate:checked.proposed,provider:'NOT_RUN_SIMULATED_PROVIDER_TRANSPORT',sandbox:'FIXTURE_NO_DOCKER_QUALIFICATION',independentController:'UNVERIFIED',authority:'none'},null,2));
  }finally{await a.close();await n.close();await browserContext.close();}
});
