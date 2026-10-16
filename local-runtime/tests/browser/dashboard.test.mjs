import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../../../engineering/browser-tests/node_modules/@playwright/test/index.mjs';
import AxeBuilder from '../../../engineering/browser-tests/node_modules/@axe-core/playwright/dist/index.mjs';
import {LocalRuntime} from '../../supervisor/runtime.mjs';
import {createServer} from '../../supervisor/server.mjs';
import {fixture,task} from '../helpers.mjs';
import {nativeProject} from '../fixtures/project.mjs';
import {createProjectRequest,inspectProjectReturn} from '../../project/transfer.mjs';

const launch=()=>chromium.launch({headless:true,...(process.env.AGI_QA_CHROMIUM?{executablePath:process.env.AGI_QA_CHROMIUM}:{})});

test('real EN/FR dashboard: authenticated onboarding, keyboard, mobile reflow and axe; native execution when ready',async()=>{
  const browser=await launch(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-dashboard-'));fs.chmodSync(directory,0o700);
  const runtime=new LocalRuntime(directory,{create:true}),s=createServer(runtime);
  try{
    const {url}=await s.start();
    for(const lang of ['en','fr']){
      const {token}=runtime.issueClient(),context=await browser.newContext(),page=await context.newPage();await page.goto(url);if(lang==='fr')await page.locator('#language').click();
      await page.locator('#token').fill(token);await page.locator('#connect').click();await page.locator('#connected').waitFor({state:'visible'});
      assert.equal(await page.locator('html').getAttribute('lang'),lang);assert.equal(await page.evaluate(()=>localStorage.length),0);
      await page.locator('#doctor').click();await page.waitForFunction(()=>document.getElementById('diagnostic').textContent.includes('agi-fleet/local-host/v1'));
      await page.locator('#name').fill('Public '+lang);await page.locator('#add').click();await page.waitForFunction(()=>document.getElementById('actors').textContent.includes('Public'));
      const ready=runtime.doctor();
      if(ready.supported){await page.locator('#actors .actor').last().locator('button').first().click();await page.locator('#prepare').click();await page.locator('#grant').waitFor({state:'visible'});await page.locator('#authorize').click();await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('output').textContent.includes('"state": "complete"'));}
      else {assert.match(await page.locator('#diagnostic').textContent(),/SANDBOX_|PLATFORM_|NODE_/);assert.match(await page.locator('#readiness').innerText(),lang==='fr'?/ordinateur|installation|logiciel/:/computer|installation|software/);}
      await page.locator('#supportPreview').click();
      await page.locator('#supportReport').waitFor({state:'visible'});
      const support=JSON.parse(await page.locator('#supportDetails').textContent());
      assert.equal(support.schema,'agi-fleet/local-diagnostics/v1');
      assert.equal(support.productionQualified,false);
      assert.equal(JSON.stringify(support).includes(token),false);
      assert.equal(JSON.stringify(support).includes('Public '+lang),false);
      assert.match(await page.locator('#supportSave').textContent(),lang==='fr'?/Enregistrer/:/Save/);
      assert.equal(await page.locator('#supportDetails').evaluate(e=>e===document.activeElement),true);
      const download=page.waitForEvent('download');await page.locator('#supportSave').click();
      const saved=await download;assert.equal(saved.suggestedFilename(),'fleet-local-support.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(await saved.path(),'utf8')),support);
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement!==document.body),true);
      const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(a.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
      const evidence=process.env.RUNNER_TEMP&&path.join(process.env.RUNNER_TEMP,'local-dashboard-evidence');
      if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,lang+'-desktop.png'),fullPage:true});}
      await page.setViewportSize({width:360,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      if(evidence)await page.screenshot({path:path.join(evidence,lang+'-mobile.png'),fullPage:true});
      await context.close();
    }
  }finally{s.server.closeAllConnections();await new Promise(r=>s.server.close(r));runtime.close();fs.rmSync(directory,{recursive:true,force:true});await browser.close();}
});
test('EN/FR operator can inspect and approve an assistant request; execution stays with its scoped client (synthetic worker boundary)',async()=>{
  const browser=await launch();
  try{for(const language of ['en','fr']){
    const f=fixture(),s=createServer(f.runtime);let context;
    try{
      const actor=f.create(),scoped=f.runtime.issueClient(actor.id),grant=f.prepare(actor,task(language),scoped.principal);
      const {url}=await s.start(),operator=f.runtime.issueClient();context=await browser.newContext();const page=await context.newPage();
      await page.goto(url);if(language==='fr')await page.locator('#language').click();
      await page.locator('#token').fill(operator.token);await page.locator('#connect').click();
      await page.locator('#pending .run').waitFor();await page.locator('#pending .run button').first().click();
      await page.waitForFunction(()=>document.getElementById('grantDetails').textContent.includes('scoped-client'));
      assert.match(await page.locator('#grantDetails').textContent(),new RegExp(grant.commitment));
      await page.locator('#authorize').click();
      await page.waitForFunction(()=>document.getElementById('pending').textContent.includes('authorized'));
      assert.equal(await page.locator('#run').isDisabled(),true);
      const run=await f.run(actor,grant,scoped.principal);assert.equal(run.state,'complete');
      await page.locator('#refresh').click();await page.locator('#runs .run').waitFor();
      await page.locator('#stop').click();await page.locator('#resume').waitFor({state:'visible'});
      await page.locator('#resume').click();await page.locator('#resume').waitFor({state:'hidden'});
      assert.equal(f.runtime.store.actor(actor.id).active,false);
      // Reconnecting must preserve the ability of the original operator client
      // to execute its already-authorized grant, without authorizing it twice.
      f.runtime.activate({actor:actor.id,confirm:true},f.operator);
      await page.locator('#refresh').click();await page.locator('#actor option').waitFor({state:'attached'});
      await page.locator('#prepare').click();await page.locator('#authorize').waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.getElementById('authorize').disabled);
      await page.locator('#authorize').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);
      await page.reload();if(language==='fr')await page.locator('#language').click();
      await page.locator('#token').fill(operator.token);await page.locator('#connect').click();
      await page.locator('#pending .run button').first().click();
      await page.waitForFunction(()=>document.getElementById('grantDetails').textContent.includes('this-operator'));
      assert.equal(await page.locator('#authorize').isDisabled(),true);assert.equal(await page.locator('#run').isDisabled(),false);
      assert.equal(await page.locator('#grantDetails').getAttribute('tabindex'),'0');
      await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('output').textContent.includes('"state": "complete"'));
      // Real deterministic work and separate grants; declared synthetic OS boundary.
      const node=f.create('node'),original=await nativeProject(),request=await createProjectRequest(original,{language,route:'agijobsv0-jobregistry-v2'});
      await page.locator('#refresh').click();
      await page.locator('#journeyFile').setInputFiles({name:'bom.json',mimeType:'application/json',buffer:Buffer.concat([Buffer.from([239,187,191]),Buffer.from(request)])});
      await page.locator('#journeyImport').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('JSON'));
      assert.equal(await page.locator('#journey option').count(),0);
      await page.locator('#journeyFile').setInputFiles({name:'invalid-utf8.json',mimeType:'application/json',buffer:Buffer.from([255])});
      await page.locator('#journeyImport').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('PROJECT_UTF8_REQUIRED'));
      assert.equal(await page.locator('#journey option').count(),0);
      // Valid request with retained JSON whitespace: it fits transport but not
      // the complete return/history budget. Refusal must precede any mutation.
      const beforeImport={journeys:f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM journeys').get().n,grants:f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,runs:f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n};
      await page.locator('#journeyFile').setInputFiles({name:'too-large-request.json',mimeType:'application/json',buffer:Buffer.from(' '.repeat(2_000_000)+request)});
      await page.locator('#journeyImport').click();
      await page.waitForFunction(()=>/saved no project|enregistré aucun projet/.test(document.getElementById('status').textContent));
      const refusal=await page.locator('#status').textContent();
      assert.match(refusal,language==='fr'?/Conservez le fichier original/:/Keep the original file/);
      assert.match(refusal,language==='fr'?/aucun historique n’a été tronqué/:/no history was truncated/);
      assert.equal(await page.locator('#journeyFile').evaluate(e=>e.files[0].name),'too-large-request.json');
      for(const table of ['journeys','grants','runs'])assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,beforeImport[table]);
      await page.locator('#journeyFile').setInputFiles({name:'fleet-request.json',mimeType:'application/json',buffer:Buffer.from(request)});
      await page.locator('#journeyImport').click();await page.waitForFunction(()=>document.getElementById('journey').options.length===1);
      assert.match(await page.locator('#journey').textContent(),/AGIALPHA/);
      await page.locator('#journeyPrepare').click();await page.waitForFunction(()=>!document.getElementById('authorize').disabled);
      await page.locator('#authorize').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);
      await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('output').textContent.includes('Énergie'));
      await page.locator('#journeyNode').selectOption(node.id);await page.locator('#journeyReviewPrepare').click();
      await page.waitForFunction(()=>!document.getElementById('authorize').disabled);
      await page.locator('#authorize').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);
      await page.locator('#run').click();await page.waitForFunction(()=>document.getElementById('journeyReview').options.length===1);
      const download=page.waitForEvent('download');await page.locator('#journeyExport').click();const file=await download;
      const returned=await inspectProjectReturn(fs.readFileSync(await file.path(),'utf8'));
      assert.equal(returned.request.upstream.raw,original);assert.equal(returned.request.route.asset,'AGIALPHA');assert.equal(returned.independentReview,false);
      assert.equal(returned.reviewClass,'historical-internal');assert.equal(returned.productionQualified,false);
      assert.match(await page.locator('#journeyExport').textContent(),language==='fr'?/retour pour Alpha/:/return for Alpha/);
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
    }finally{if(context)await context.close();s.server.closeAllConnections();if(s.server.listening)await new Promise(r=>s.server.close(r));f.close();}
  }}finally{await browser.close();}
});
