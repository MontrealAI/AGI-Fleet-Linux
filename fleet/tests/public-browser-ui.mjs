// Actual local UI/server transport with a synthetic commissioning backend. No provider, Docker or funds.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {createPublicWebReport} from '../packages/AGI_Agent/src/control/public-web-report.mjs';
import {qualificationFixture} from '../packages/AGI_Agent/tests/helpers/public-web-qualification-fixture.mjs';
import {verifyPublicWebCommissioningEvidence} from '../packages/AGI_Agent/compute/public-web-evidence.mjs';
import {Controller as Agent} from '../packages/AGI_Agent/src/control/controller.mjs';
import {createControlServer as agentServer} from '../packages/AGI_Agent/src/control/server.mjs';
import {Controller as Node} from '../packages/AGI_Node/src/control/controller.mjs';
import {createControlServer as nodeServer} from '../packages/AGI_Node/src/control/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const output=process.env.BROWSER_OUTPUT??path.resolve('public-browser-ui-evidence');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']}),checks=[];
try {
 for(const role of ['agent','node']) for(const width of [390,1440]) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-browser-panel-')),controller=new (role==='agent'?Agent:Node)(home);
  await controller.createVault('PUBLIC UI REGRESSION PASSWORD ONLY');let calls=0,mode='blocked',abortPending=null;
  const q=await qualificationFixture({now:Date.now()-1000}),{now,...verification}=q.options,exported={schema:'agi-public-web-qualification-export/v1',payload:q.payload,verification};
  const reportInput={role:q.payload.executionAdmission.role,requestID:q.request.id,fixtureSha256:q.payload.executionAdmission.acceptedSpecSha256,runtimeSha256:q.payload.executionAdmission.runtimeSha256,policyHash:q.options.candidatePolicyHash,browserEvidence:verifyPublicWebCommissioningEvidence(q.payload.browserEvidence,{requestID:q.request.id,executionAdmission:q.payload.executionAdmission,policyHash:q.options.candidatePolicyHash,operatorPublicKey:q.options.operatorPublicKey})};
  controller.companionPublicWebCommissioning=async input=>{
   calls++;assert.deepEqual(input,{acknowledge:true,allowProviderCalls:true,allowLocalRuntime:true});
   if(mode==='pending')return new Promise((resolve,reject)=>{abortPending=()=>reject(Error('COMPANION_CANCELLED'));});
   if(mode==='failure')throw Error('COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
   return controller.companion.savePublicWebReport(createPublicWebReport({...reportInput,completedAt:Date.now(),qualificationStatus:mode==='success'?{status:'EXPORTED'}:{status:'BLOCKED',code:'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED'},qualificationExport:mode==='success'?exported:null}));
  };
  const cancel=controller.companion.cancel.bind(controller.companion);
  controller.companion.cancel=async()=>{abortPending?.();abortPending=null;await cancel();return {cancelled:true};};
  const app=await (role==='agent'?agentServer:nodeServer)(controller,{port:0}),context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
   await page.goto(app.url);if(width<980)await page.locator('#workspace-menu').click();
   await page.locator('nav [data-view="'+(role==='agent'?'intelligence':'companion')+'"]').click();await page.locator('#publicBrowserCommissioning summary').click();
   const consent=page.locator('#publicBrowserConsent'),run=page.locator('#publicBrowserRun'),stop=page.locator('#publicBrowserCancel'),download=page.locator('#publicBrowserDownload'),result=page.locator('#publicBrowserResult');
   assert.equal(calls,0);assert.equal(await run.isDisabled(),true);assert.equal(await download.isDisabled(),true);
   await consent.check();await consent.focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'publicBrowserRun');
   await run.evaluate(element=>{element.click();element.click();});await result.filter({hasText:'Browser execution: passed'}).waitFor();assert.equal(calls,1);assert.equal(await consent.isChecked(),false);assert.equal(await run.isDisabled(),true);
   const pendingDownload=page.waitForEvent('download');await download.click();const file=await pendingDownload,report=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(report.status,'BLOCKED');assert.equal(report.browserEvidence.status,'PASS');assert.equal(report.qualificationStatus.code,'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED');assert.match(await page.locator('#publicBrowserEvidenceStatus').textContent(),/reviewer key is not configured/);assert.equal(await page.locator('#publicBrowserEvidence').isHidden(),true);
   await page.reload();if(width<980)await page.locator('#workspace-menu').click();await page.locator('nav [data-view="'+(role==='agent'?'intelligence':'companion')+'"]').click();await page.locator('#publicBrowserCommissioning summary').click();await result.filter({hasText:'Browser execution: passed'}).waitFor();assert.equal(calls,1);assert.equal(await download.isDisabled(),false);assert.match(await page.locator('#publicBrowserSaved').textContent(),/Historical result/);
   mode='pending';await consent.check();await run.click();await page.waitForFunction(()=>!document.getElementById('publicBrowserCancel').disabled);assert.equal(calls,2);assert.equal(await consent.isDisabled(),true);assert.equal(await download.isDisabled(),true);
   await stop.click();await page.waitForFunction(()=>!document.getElementById('publicBrowserConsent').disabled);assert.equal(await run.isDisabled(),true);assert.equal(await consent.isChecked(),false);assert.match(await result.textContent(),/ended|stopped/i);
   mode='failure';await consent.check();await run.click();await result.filter({hasText:'Public browser access is not qualified'}).waitFor();assert.equal(calls,3);assert.equal(await run.isDisabled(),true);assert.equal(await download.isDisabled(),false);
   mode='success';await consent.check();await run.click();await result.filter({hasText:'Browser execution: passed'}).waitFor();assert.equal(calls,4);assert.equal(await run.isDisabled(),true);
   await page.waitForFunction(()=>!document.getElementById('publicBrowserEvidence').hidden);const pendingEvidence=page.waitForEvent('download');await page.locator('#publicBrowserEvidence').click();const evidenceFile=await pendingEvidence,evidenceJSON=JSON.parse(fs.readFileSync(await evidenceFile.path(),'utf8'));assert.equal(evidenceJSON.schema,'agi-public-web-qualification-export/v1');assert.deepEqual(evidenceJSON,exported);
   await page.reload();if(width<980)await page.locator('#workspace-menu').click();await page.locator('nav [data-view="'+(role==='agent'?'intelligence':'companion')+'"]').click();await page.locator('#publicBrowserCommissioning summary').click();await result.filter({hasText:'ready for independent review'}).waitFor();assert.equal(calls,4);
   await controller.lock();await page.evaluate(()=>refresh());assert.equal(await download.isDisabled(),true);assert.equal(await page.locator('#publicBrowserEvidence').isHidden(),true);const locked=await page.evaluate(async()=>{const response=await fetch('/api/companion/public-web-report');return {status:response.status,value:await response.json()};});assert.ok(locked.status>=400);assert.equal(JSON.stringify(locked.value).includes('agi-public-web-technical-qualification'),false);
   await controller.unlock('PUBLIC UI REGRESSION PASSWORD ONLY');await page.evaluate(()=>refresh());await result.filter({hasText:'ready for independent review'}).waitFor();assert.equal(calls,4);
   await page.evaluate(expiry=>{Date.now=()=>expiry+1;},q.payload.expiresAt);await page.evaluate(()=>refresh());await result.filter({hasText:'Review evidence: expired'}).waitFor();assert.equal(await page.locator('#publicBrowserEvidence').textContent(),'Download expired evidence');assert.equal(calls,4);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,role+'-browser-commissioning-'+width+'.png'),fullPage:true});
   checks.push({role,width,explicitConsent:true,doubleClickSingleRequest:true,cancellation:true,retryRequiresNewConsent:true,reportDownload:true,blockedExportReason:true,savedReportReloadNoCharge:true,qualificationDownload:true,lockHidesReport:true,expiryHistoricalDownload:true,keyboard:true,noHorizontalOverflow:true,javascriptErrors:[]});
  } finally {await context.close();await app.close();await controller.close();await q.close();fs.rmSync(home,{recursive:true,force:true});}
 }
 const report={passed:true,environment:'Linux Chromium '+await browser.version(),scope:'Actual local application UI and HTTP server, synthetic commissioning backend; no physical Mac, provider, Docker or settlement.',checks};fs.writeFileSync(path.join(output,'public-browser-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
