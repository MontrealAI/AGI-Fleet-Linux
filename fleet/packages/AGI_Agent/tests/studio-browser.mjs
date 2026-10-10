import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
import {STUDIO_TEMPLATES,composeStudio,makeHandoff,validateHandoff,validateStudioRevision} from '../src/studio.mjs';
import {buildBundle,bundleZIP} from '../src/artifacts.mjs';

const role=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).name.endsWith('agent')?'agent':'node';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-studio-browser-')),output=process.env.BROWSER_OUTPUT??home;fs.mkdirSync(output,{recursive:true});
const t=STUDIO_TEMPLATES.find(t=>t.id==='data');
const spec=composeStudio({template:t.id,title:t.title,prompt:t.prompt,outputs:t.outputs,criteria:t.criteria});
const files=new Map([['clean.csv',Buffer.from('name,quantity\nerasers,3\npaper,5\npencils,12\n')],['summary.json',Buffer.from('{"rows":3,"totalQuantity":20}')],['changes.md',Buffer.from('Names were lowercased. Duplicate rows were removed. Rows were sorted by name.\n')]]);
const delivery=buildBundle(spec,files),handoff=makeHandoff(spec,delivery);
let clock=Date.now(),browser,failNextReview=false,releaseFirst;const firstResponse=new Promise(r=>releaseFirst=r);let held=false;
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const c=new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,options)=>{
  if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v2',role,uid:(process.getuid?.()??0)+1001,tools:true,gatewayReady:true,auth:'chatgpt-oauth',capabilities:['browser','desktop','files','computer-review','revision'],policyHash:'a'.repeat(64)});
  if(!held){held=true;await firstResponse;}
  clock+=31000;const kind=options.headers['x-agi-kind'];
  if(kind==='generate'){const payload=JSON.parse(JSON.parse(options.body).messages.at(-1).content);assert.deepEqual(payload.specification.acceptance,spec);return response({status:'complete',content:delivery});}
  if(kind==='computer-review'){const status=failNextReview?'fail':'pass';failNextReview=false;return response({safeToReview:true,checks:spec.criteria.map(v=>({id:v.id,status,method:'Mocked provider response for browser testing.',observed:'Synthetic fixture result; no live model inference.',files:spec.outputs.map(f=>f.name)}))});}
  return response({status:'ready'});
}}});
await c.createVault('Fixture-only Studio browser password!');
c.vault.set({openclawToken:'a'.repeat(64)});c.companion.config={...c.companion.config,mode:'workstation',enabled:true,acknowledged:true,timeoutMs:720000};c.companion.state.testedAt=clock;c.companion.state.computePolicy='a'.repeat(64);c.companion.save();c.companion.persist();
const app=await createControlServer(c,{port:0});
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',...(process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[])]});
  const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
  await page.waitForFunction(()=>typeof state!=='undefined'&&state?.unlocked);
  await page.click('[data-view="studio"]');await page.waitForSelector('#studio-shelf-count:has-text("0 of 5")');
  if(role==='agent'){await page.locator('#studio-format-templates').locator('..').locator('summary').click();await page.click('[data-template="data"]');}
  else{
    const malformed=path.join(home,'invalid-handoff.json');fs.writeFileSync(malformed,JSON.stringify({...handoff,specification:{...spec,criteria:Array(17).fill(spec.criteria[0])}}));
    await page.setInputFiles('#studio-handoff-file',malformed);await page.waitForSelector('#studio-message:has-text("complete review handoff")');assert.equal(await page.isDisabled('#studio-run'),true);assert.equal(c.companion.state.calls.length,0);
    const f=path.join(home,'review-handoff.json');fs.writeFileSync(f,JSON.stringify(handoff));await page.setInputFiles('#studio-handoff-file',f);
    await page.waitForSelector('#studio-handoff-preview h3');
  }
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,role+'-studio-desktop.png'),fullPage:true});
  await page.click('#studio-run');await page.locator('#studio-cancel').waitFor({state:'visible'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,role+'-studio-running.png'),fullPage:true});if(role==='node')assert.equal(await page.locator('#studio-steps li').nth(2).getAttribute('data-state'),'current');releaseFirst();await page.waitForSelector('.studio-state[data-state="checked"]');
  const d=page.waitForEvent('download');await page.getByRole('button',{name:'Download files',exact:true}).click();const downloaded=await d;const zip=path.join(output,role+'-studio-files.zip');await downloaded.saveAs(zip);
  assert.deepEqual(fs.readFileSync(zip),bundleZIP(spec,Buffer.from(delivery)));
  const h=page.waitForEvent('download');await page.getByRole('button',{name:'Review handoff',exact:true}).click();const exported=await h;const hf=path.join(output,role+'-studio-handoff.json');await exported.saveAs(hf);assert.deepEqual(validateHandoff(JSON.parse(fs.readFileSync(hf))),handoff);
  await page.getByText('View the review evidence',{exact:true}).click();assert.equal(await page.locator('.studio-check').count(),3);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,role+'-studio-result.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No mobile horizontal overflow');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,role+'-studio-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Remove local copy',exact:true}).click();await page.getByRole('button',{name:'Keep it',exact:true}).click();assert.equal(c.studio.records.length,1);
  await page.getByRole('button',{name:'Remove local copy',exact:true}).click();await page.getByRole('button',{name:'Remove this run',exact:true}).click();await page.waitForSelector('#studio-shelf-count:has-text("0 of 5")');assert.equal(c.studio.records.length,0);
  await page.setViewportSize({width:1280,height:1000});
  failNextReview=true;await page.click('#studio-run');await page.waitForSelector('.studio-state[data-state="needs-review"]');
  const feedbackDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Revision feedback',exact:true}).click();
  const feedbackPath=path.join(output,role+'-revision-feedback.json');await (await feedbackDownload).saveAs(feedbackPath);validateStudioRevision(JSON.parse(fs.readFileSync(feedbackPath)));
  if(role==='agent') {
    await page.getByRole('button',{name:'Improve & check again',exact:true}).click();await page.waitForSelector('.studio-state[data-state="checked"]');
    const originalDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download original files',exact:true}).click();
    const originalPath=path.join(output,'original-files.zip');await(await originalDownload).saveAs(originalPath);assert.deepEqual(fs.readFileSync(originalPath),bundleZIP(spec,Buffer.from(delivery)));
    await page.setInputFiles('#studio-revision-file',feedbackPath);await page.waitForSelector('#studio-import-note:has-text("Revise:")');await page.click('#studio-run');await page.waitForFunction(()=>document.querySelectorAll('.studio-state[data-state="checked"]').length===2);
  }
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,role+'-studio-revision.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({role,browser:await browser.version(),runtime:process.version,taskUI:true,actualFileZIPDownload:true,verifiedHandoffDownload:true,criterionEvidence:true,revisionFeedbackDownload:true,revisionWorkflow:role==='agent',explicitRemoval:true,mobileNoOverflow:true,javascriptErrors:errors,provider:'mocked',liveInference:false,macOrDockerQualification:false},null,2));
}finally{await browser?.close();await c.close();await app.close();fs.rmSync(home,{recursive:true,force:true});}
