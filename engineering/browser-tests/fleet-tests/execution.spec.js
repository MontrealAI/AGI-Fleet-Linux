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

test('Saved Fleet: explicit method reuse and mapped changed data retain lineage, fresh checks and whole mobile numbers',async({browser},info)=>{
  for(const lang of ['en','fr']){
    const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();
    try{
      await page.goto(pathToFileURL(path.join(root,`docs/successor/My-SUCCESSOR-Omega-${lang}.html`)).href);
      await page.locator('#data').fill('id,category,value\na,Software,1200.5\nb,Software,-100.5\nc,Research,1000\nc,Research,1000\nd,Documentation,300');
      await page.locator('#public-consent').check();await page.locator('#run').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();await page.locator('#improve-local').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
      await restore(page,await download(page,'#download-capsule'));await page.locator('#reuse-method').click();
      await page.locator('#data').fill('order_id,product,amount\na,Software,1400\nb,Software,-50\nc,Research,920.10\nc,Research,920.10\nd,Documentation,250');
      await page.locator('#map-columns').evaluate(el=>el.closest('details').open=true);await page.locator('#map-columns').click();for(const [target,source] of [['id','order_id'],['category','product'],['value','amount']])await page.locator('#map-'+target).selectOption(source);
      await page.locator('#preview-mapping').click();await expect(page.locator('#mapping-preview')).toContainText('920.10');await page.locator('#mapping-consent').check();await page.locator('#apply-mapping').click();await page.locator('#public-consent').check();await page.locator('#new-mission').check();await page.locator('#run').click();await expect(page.locator('#keep-version')).toBeEnabled();await page.locator('#keep-version').click();
      const model=await load('successor/vendor/manager/site/assets/successor/model.mjs'),state=(await model.inspectCapsule(await download(page,'#download-capsule'))).capsule.payload.state,candidate=state.candidates.find(c=>c.id===state.active);expect(candidate.manifest.variant).toBe('improved');expect(state.authority).toBe('none');expect(state.plans).toEqual([]);expect(state.chronicle.map(e=>e.action)).toContain('method-reused');expect(state.chronicle.map(e=>e.action)).toContain('input-mapped');expect(JSON.parse(candidate.files.find(f=>f.name==='result.json').content).groups.map(g=>g.total)).toEqual(['250','920.1','1350']);
      const report=info.outputPath(`mapped-report-${lang}.html`);fs.writeFileSync(report,candidate.files.find(f=>f.name==='report.html').content);const artifact=await context.newPage();await artifact.goto(pathToFileURL(report).href);await artifact.setViewportSize({width:390,height:1000});expect(await artifact.locator('td:not(:first-child)').evaluateAll(c=>c.every(el=>getComputedStyle(el).whiteSpace==='nowrap'))).toBe(true);expect(await artifact.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await artifact.screenshot({path:info.outputPath(`mapped-report-${lang}-390.png`),fullPage:true});
      await artifact.evaluate(()=>document.documentElement.style.fontSize='225%');expect(await artifact.locator('td:not(:first-child)').evaluateAll(c=>c.every(el=>getComputedStyle(el).whiteSpace==='nowrap'))).toBe(true);await artifact.screenshot({path:info.outputPath(`mapped-report-${lang}-text-zoom.png`),fullPage:true});await artifact.emulateMedia({media:'print'});await expect(artifact.locator('table')).toBeVisible();
    }finally{await context.close();}
  }
});

test('Saved Fleet: EN/FR history at 98/99/100 remains recoverable with bounded archival continuation',async({browser},info)=>{
  test.setTimeout(60000);
  const model=await load('successor/vendor/manager/site/assets/successor/model.mjs');
  const {defaultMission}=await load('successor/vendor/manager/site/assets/successor/missions.mjs');
  const {sha256}=await load('successor/vendor/manager/site/assets/successor/safe.mjs');
  const contexts=[],errors=[],network=[],results=[];
  async function offlinePage(){
    const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:390,height:844}});contexts.push(context);
    await context.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
    await context.addInitScript(()=>{window.__historyWalletCalls=0;window.ethereum={request(){window.__historyWalletCalls++;throw Error('Unexpected authority');}};});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await context.setOffline(true);return page;
  }
  try{
    for(const lang of ['en','fr'])for(const count of [98,99,100]){
      const page=await offlinePage();await page.goto(pathToFileURL(path.join(root,`docs/successor/My-SUCCESSOR-Omega-${lang}.html`)).href);
      const source=await page.locator('#successor-source').evaluate(el=>JSON.parse(el.textContent));
      let run=await model.runCandidate(await model.createSystem(defaultMission('analyst',lang)),'baseline',source.engineSha256),state=await model.chooseCandidate(run.state,run.candidate.id,'keep');
      run=await model.runCandidate(state,'improved',source.engineSha256);state=await model.chooseCandidate(run.state,run.candidate.id,'replace');
      while(state.chronicle.length<count)await model.appendEvent(state,'restored','0'.repeat(64));
      const originalRaw=await model.exportCapsule(state,source);await restore(page,originalRaw);
      expect(JSON.parse(await download(page,'#download-capsule')).payload.state).toEqual(state);
      await expect(page.locator('#history-warning')).toHaveAttribute('role','alert');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      if(count===100){
        await expect(page.locator('#improve-local')).toBeDisabled();await expect(page.locator('#rollback')).toBeDisabled();
        await page.locator('#public-consent').check();await page.locator('#run').click();await expect(page.locator('#error')).toContainText('HISTORY_LIMIT');
        await expect(page.locator('#download-capsule')).toBeEnabled();
      }
      await page.locator('#history-consent').check();const previousRaw=await download(page,'#continue-history');
      expect(JSON.parse(previousRaw).payload.state).toEqual(state);await expect(page.locator('#history-warning')).toContainText('1/100');
      const continued=JSON.parse(await download(page,'#download-capsule'));
      expect(continued.format).toBe('successor-portable/2');expect(model.historyEvents(continued.payload.state).slice(0,count)).toEqual(state.chronicle);
      expect(continued.payload.state.candidates).toEqual(state.candidates);expect(continued.payload.state.active).toBe(state.active);expect(continued.payload.state.authority).toBe('none');
      await page.locator('#public-consent').check();await page.locator('#run').click();await expect(page.locator('#history-warning')).toContainText('2/100');
      await expect(page.frameLocator('#preview').getByText(/identical-id-once/)).toBeVisible();
      await page.locator('#rollback').click();await expect(page.frameLocator('#preview').getByText(/every-row/)).toBeVisible();
      const savedHTML=await download(page,'#download-html'),htmlPath=info.outputPath(`history-${lang}-${count}.html`);fs.writeFileSync(htmlPath,savedHTML);
      const fresh=await offlinePage();await fresh.goto(pathToFileURL(htmlPath).href);await expect(fresh.locator('#restore-preview')).toBeVisible();
      await fresh.locator('#restore-consent').check();await fresh.locator('#restore').click();await expect(fresh.locator('#restore-preview')).toBeHidden();
      await fresh.locator('#public-consent').check();await fresh.locator('#run').click();await expect(fresh.locator('#history-warning')).toContainText('4/100');await expect(fresh.locator('#error')).toBeHidden();
      const rerunRaw=await download(fresh,'#download-capsule'),rerun=(await model.inspectCapsule(rerunRaw)).capsule.payload.state;
      expect(rerun.archives[0].events).toEqual(state.chronicle);expect(rerun.active).toBe(state.candidates[0].id);expect(rerun.authority).toBe('none');
      if(count===100){
        const overflow=structuredClone(state),record={sequence:100,action:'restored',subject:'0'.repeat(64),previous:state.chronicle.at(-1).sha256};overflow.chronicle.push({...record,sha256:await sha256(record)});
        const payload={state:overflow,sourceManifest:source},invalid={format:'successor-portable/1',payload,sha256:await sha256(payload)};
        await page.locator('#import-file').setInputFiles({name:'overflow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await expect(page.locator('#error')).toContainText('CHRONICLE');await expect(page.locator('#restore-preview')).toBeHidden();
        await page.screenshot({path:info.outputPath(`history-${lang}-100.png`),fullPage:true});
      }
      expect(await page.evaluate(()=>window.__historyWalletCalls)).toBe(0);
      results.push({language:lang,originalEvents:count,originalCapsuleSHA256:digest(originalRaw),savedHTMLSHA256:digest(savedHTML),rerunCapsuleSHA256:digest(rerunRaw),restorationConsumesNoSlot:true,allEventsPreserved:true,archivalContinuationExplicit:true,rollbackReferencesPreserved:true,downloadedOfflineRerun:true,authority:'none'});
    }
    expect(errors).toEqual([]);expect(network).toEqual([]);
    fs.writeFileSync(info.outputPath('history-journey.json'),JSON.stringify({schema:'agi-fleet/history-browser-journey/v1',browserVersion:browser.version(),archiveIdentity:process.env.FLEET_TEST_METADATA?JSON.parse(fs.readFileSync(process.env.FLEET_TEST_METADATA,'utf8')).sha256:null,scope:'saved Fleet distribution and actual downloaded standalone HTML; deterministic local work; no provider, host or independent user qualification',results},null,2)+'\n');
  }finally{for(const context of contexts)await context.close();}
});
