import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const root=process.env.FLEET_TEST_ROOT;
if(!root)throw Error('FLEET_TEST_ROOT must identify the extracted, verified candidate');
const load=p=>import(pathToFileURL(path.join(root,p)));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function download(page,selector){
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
  return fs.readFileSync(await file.path(),'utf8');
}
async function restore(page,capsule){
  await page.locator('#import-file').setInputFiles({name:'capsule.json',mimeType:'application/json',buffer:Buffer.from(capsule)});
  await expect(page.locator('#restore-preview')).toBeVisible();
  await page.locator('#restore-consent').check();
  await page.locator('#restore').click();
  await expect(page.locator('#restore-preview')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
}
async function authenticate(fixture,role){
  const {createControlServer}=await load(`packages/AGI_${role}/src/control/server.mjs`);
  const server=await createControlServer(fixture.controller,{port:0});
  try{
    const url=new URL(server.url),origin=url.origin;
    const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:url.hash.slice(1)})});
    expect(response.status).toBe(200);
    const cookie=response.headers.get('set-cookie').split(';')[0],{csrf}=await response.json();
    return {server,post:async(action,input,expectedStatus=200)=>{
      const response=await fetch(origin+'/api/successor/'+action,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','x-agi-csrf':csrf},body:JSON.stringify(input)});
      const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(expectedStatus);return result;
    }};
  }catch(error){await server.close();throw error;}
}

test('Saved Fleet: Builder → authorized Agent → separately authorized Node → choose → offline restore and rerun',async({browser},info)=>{
  test.setTimeout(60000);
  if(process.env.CI){const locked=JSON.parse(fs.readFileSync(new URL('../node_modules/playwright-core/browsers.json',import.meta.url)));expect(browser.version()).toBe(locked.browsers.find(b=>b.name==='chromium-headless-shell').browserVersion);}
  const {fixture}=await load('successor/fixture.mjs');
  const model=await load('successor/vendor/manager/site/assets/successor/model.mjs');
  const contexts=[],network=[],errors=[];
  async function localPage(){
    const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});contexts.push(context);
    await context.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return page;
  }
  const page=await localPage(),workPage=await localPage();
  let a,n,agent,node;
  try{
    await page.goto(pathToFileURL(path.join(root,'docs/successor/My-SUCCESSOR-Omega-en.html')).href);
    await page.locator('[name="kind"][value="website"]').check();
    await page.locator('#public-consent').check();await page.locator('#run').click();
    await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
    await page.locator('#budget').evaluate(el=>el.closest('details').open=true);
    await page.locator('#budget').fill('100');await page.locator('#prepare-job').click();
    await expect(page.locator('#job-results')).toBeVisible();
    const request=JSON.parse(await download(page,'#fleet-export'));
    const original=(await model.inspectCapsule(request.capsule)).capsule.payload.state;
    expect(request.plan.payment).toBe('unfunded');expect(original.authority).toBe('none');

    a=await fixture(root,'agent',{browser:async({output})=>{
      await workPage.goto(pathToFileURL(path.join(root,'docs/successor/My-SUCCESSOR-Omega-en.html')).href);
      await restore(workPage,request.capsule);
      await workPage.locator('#public-consent').focus();await workPage.keyboard.press('Space');
      await workPage.locator('#improve-local').click();
      await expect(workPage.locator('#comparison')).toContainText('measured gap');
      await expect(workPage.frameLocator('#preview').locator('h1')).toHaveText(JSON.parse(original.mission.input).title);
      for(const file of output.files){
        const [download]=await Promise.all([workPage.waitForEvent('download'),workPage.getByRole('button',{name:'Download '+file.name,exact:true}).click()]);
        file.content=fs.readFileSync(await download.path(),'utf8');
      }
      await workPage.screenshot({path:info.outputPath('actual-browser-work.png'),fullPage:true});
    }});
    n=await fixture(root,'node');agent=await authenticate(a,'Agent');node=await authenticate(n,'Node');
    for(const file of request.plan.immutableInputs){a.inputs.set(file.name,Buffer.from(file.content));n.inputs.set(file.name,Buffer.from(file.content));}
    const context={schema:'successor-runtime-context/v1',runtimes:{agent:a.health().runtime,reviewer:n.health().runtime},inputs:request.plan.immutableInputs.map(f=>({name:f.name,uri:'https://example.org/'+f.name,sha256:f.sha256,maxBytes:Buffer.byteLength(f.content)})),deadline:Math.floor(Date.now()/1000)+3600,settlement:{chainId:31337,manager:'0x1111111111111111111111111111111111111111',recovery:'Engineering browser fixture; no payment.'},budget:{maxAgentSeconds:60,maxReviewSeconds:60,maxAgentCostUSDC:'5',maxReviewCostUSDC:'3'},publicConsent:true};
    const p=await agent.post('prepare',{request,context});expect(a.worker.state.calls).toHaveLength(0);
    await agent.post('execute',{ticket:p.ticket,key:p.key,confirm:false},400);expect(a.worker.state.calls).toHaveLength(0);
    await agent.post('execute',{ticket:p.ticket,key:p.key,confirm:true});await a.controller.studio.task;
    const actual=await agent.post('result',{key:p.key});expect(actual.receipt.status,JSON.stringify(actual.receipt.error)).toBe('checked');
    const q=await node.post('prepare',{handoff:actual.handoff});expect(n.worker.state.calls).toHaveLength(0);
    await node.post('execute',{ticket:p.ticket,key:p.key,confirm:true},400);expect(n.worker.state.calls).toHaveLength(0);
    await node.post('execute',{ticket:q.ticket,key:q.key,confirm:true});await n.controller.studio.task;
    const review=await node.post('result',{key:q.key});
    const checked=await agent.post('result',{key:p.key,review:review.receipt});
    expect(checked.outcome).toBe('accepted');expect(checked.selected).toBe(original.active);
    expect(checked.proposed).not.toBe(original.active);expect(checked.independentController).toBe('UNVERIFIED');

    await restore(page,checked.capsule);
    await page.locator('#fleet-version').selectOption(checked.proposed);
    const inspected=JSON.parse(await download(page,'#download-capsule'));
    expect(inspected.payload.state.active).toBe(original.active);
    await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
    const selectedRaw=await download(page,'#download-capsule'),selected=JSON.parse(selectedRaw);
    expect(selected.payload.state.active).toBe(checked.proposed);
    const chosen=selected.payload.state.candidates.find(c=>c.id===checked.proposed);
    const htmlPath=info.outputPath('My-SUCCESSOR-Omega-selected.html');
    fs.writeFileSync(htmlPath,await download(page,'#download-html'));

    const restored=[];
    for(const language of ['en','fr']){
      const fresh=await localPage();await fresh.context().setOffline(true);
      await fresh.goto(pathToFileURL(htmlPath).href);
      await expect(fresh.locator('#restore-preview')).toBeVisible();
      await fresh.locator('#restore-consent').check();await fresh.locator('#restore').click();
      await expect(fresh.locator('#restore-preview')).toBeHidden();
      if(language==='fr')await fresh.locator('#language').click();
      await fresh.locator('#public-consent').check();await fresh.locator('#run').click();
      await expect(fresh.locator('#result-summary')).toContainText(/Checks passed|Vérifications réussies/);
      await expect(fresh.frameLocator('#preview').locator('h1')).toHaveText(JSON.parse(original.mission.input).title);
      await expect(fresh.locator('#keep-version')).toBeDisabled();await expect(fresh.locator('#error')).toBeHidden();
      const rerunRaw=await download(fresh,'#download-capsule');
      const rerun=(await model.inspectCapsule(rerunRaw)).capsule.payload.state;
      expect(rerun.active).toBe(checked.proposed);expect(rerun.authority).toBe('none');
      expect(rerun.candidates.find(c=>c.id===rerun.active).files).toEqual(chosen.files);
      restored.push({language,active:rerun.active,capsuleSHA256:digest(rerunRaw),artifactBytesEqual:true,authority:rerun.authority});
      await fresh.screenshot({path:info.outputPath('offline-rerun-'+language+'.png'),fullPage:true});
    }
    expect(network).toEqual([]);expect(errors).toEqual([]);
    const journey={schema:'agi-fleet/successor-browser-journey/v1',original:original.active,returned:checked.proposed,selected:selected.payload.state.active,inspectionRetainedIncumbent:true,agentAuthorization:true,separateReviewAuthorization:true,offline:restored,payment:'unfunded',authority:'none'};
    const journeyPath=info.outputPath('journey.json');fs.writeFileSync(journeyPath,JSON.stringify(journey,null,2));
    const metadata=process.env.FLEET_TEST_METADATA?JSON.parse(fs.readFileSync(process.env.FLEET_TEST_METADATA,'utf8')):null;
    fs.writeFileSync(info.outputPath('evidence.json'),JSON.stringify({status:'PASS',workflowCommit:process.env.GITHUB_SHA??null,workflowRun:process.env.GITHUB_RUN_ID??null,workflowAttempt:process.env.GITHUB_RUN_ATTEMPT??null,archiveSHA256:metadata?.sha256??null,sourceRevisionSHA256:JSON.parse(fs.readFileSync(path.join(root,'source-inventory.json'))).revisionSHA256,screenshotSHA256:digest(fs.readFileSync(info.outputPath('actual-browser-work.png'))),journeySHA256:digest(fs.readFileSync(journeyPath)),browserVersion:browser.version(),actualBrowserEffects:true,actualComputeWorker:true,downloadedBytesChecked:true,authenticatedAgentDispatch:true,separatelyAuthorizedReview:true,explicitVersionChoice:true,freshOfflineRestoreAndRerun:true,deliverySHA256:actual.handoff.deliveryHash,selected:journey.selected,candidate:checked.proposed,provider:'NOT_RUN_SIMULATED_PROVIDER_TRANSPORT',sandbox:'FIXTURE_NO_DOCKER_QUALIFICATION',independentController:'UNVERIFIED',authority:'none'},null,2));
  }finally{
    await agent?.server.close();await node?.server.close();await a?.close();await n?.close();
    for(const context of contexts)await context.close();
  }
});
