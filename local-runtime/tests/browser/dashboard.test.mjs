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

test('real EN/FR dashboard: authenticated onboarding, keyboard, mobile reflow and axe; native execution when ready',async()=>{
  const browser=await chromium.launch({headless:true}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-dashboard-'));fs.chmodSync(directory,0o700);
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
  const browser=await chromium.launch({headless:true});
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
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
    }finally{if(context)await context.close();s.server.closeAllConnections();if(s.server.listening)await new Promise(r=>s.server.close(r));f.close();}
  }}finally{await browser.close();}
});
