// Behavioral and visual checks against real local servers and disposable profiles.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {Controller as Fleet} from '../ops/controller.mjs';import {createServer} from '../ops/server.mjs';
import {Controller as Agent} from '../packages/AGI_Agent/src/control/controller.mjs';import {createControlServer as agentServer} from '../packages/AGI_Agent/src/control/server.mjs';
import {Controller as Node} from '../packages/AGI_Node/src/control/controller.mjs';import {createControlServer as nodeServer} from '../packages/AGI_Node/src/control/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)),out=process.env.BROWSER_OUTPUT;fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']}),checks=[];const password='PUBLIC ATELIER BROWSER FIXTURE ONLY';
async function checkLayout(page,label){const r=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().right>innerWidth+2&&!e.closest('svg,.table-wrap,pre,.table-scroll')).slice(0,8).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right})),unnamed:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.checkVisibility()&&!e.disabled&&e.type!=='hidden').filter(e=>!(e.textContent.trim()||e.getAttribute('aria-label')||e.getAttribute('title')||[...(e.labels??[])].map(x=>x.textContent.trim()).join(' '))).map(e=>e.id||e.tagName)}));assert.ok(r.scroll<=r.width+1,label+' overflow '+JSON.stringify(r));assert.deepEqual(r.unnamed,[],label+' unnamed controls');}
try{for(const role of ['agent','node','employer','moderator','recovery','evidence']){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-atelier-')),standalone=['agent','node'].includes(role),C=role==='agent'?Agent:role==='node'?Node:Fleet,c=new C(home,role);
 if(standalone)await c.createVault(password);else await c.unlock(password);if(role!=='evidence')await c.wallet('create',{wordCount:24});
 const app=role==='agent'?await agentServer(c,{port:0}):role==='node'?await nodeServer(c,{port:0}):await createServer(c);
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[],requests=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(req.method()==='POST')requests.push(new URL(req.url()).pathname);if(/^https?:/.test(req.url())&&new URL(req.url()).hostname!=='127.0.0.1'&&new URL(req.url()).hostname!=='localhost')external.push(req.url());});
 try{
  await page.goto(app.url);await page.waitForFunction(()=>document.querySelectorAll('.genesis-gate').length===6);assert.equal(await page.locator('.genesis-tag[data-state="verified"]').count(),0);requests.length=0;
  const nav='#workspace-navigation button',attr=standalone?'data-view':'data-fleet-view',routes=await page.locator(nav).evaluateAll((els,attr)=>els.map(x=>x.getAttribute(attr)),attr);
  assert.equal(await page.locator('.nav-group-label').count(),3);
  const firstSummary=page.locator('.genesis-gate summary').first();await firstSummary.click();await firstSummary.focus();await page.evaluate(()=>refresh());assert.equal(await page.locator('.genesis-gate details').first().getAttribute('open'),'');assert.equal(await firstSummary.evaluate(x=>document.activeElement===x),true);await firstSummary.click();
  if(role!=='evidence'){await page.locator('#next-step-action').click();assert.equal(await page.locator('#revealPassword').isVisible(),true);assert.equal(await page.locator('#revealPassword').evaluate(x=>document.activeElement===x),true);await page.locator(nav).first().click();}
  await page.screenshot({path:path.join(out,'atelier-'+role+'-desktop.png'),fullPage:false});
  await page.keyboard.press('Control+k');await page.locator('#workspace-palette').waitFor({state:'visible'});await page.locator('#palette-query').fill('no-such-section');assert.equal(await page.locator('#palette-results button').count(),0);assert.match(await page.locator('#palette-status').textContent(),/No matching/);await page.locator('#palette-query').fill('backup');assert.ok(await page.locator('#palette-results button').count()>0);await page.screenshot({path:path.join(out,'atelier-'+role+'-search.png'),fullPage:false});await page.locator('#palette-query').press('Enter');await page.locator('#workspace-palette').waitFor({state:'hidden'});assert.ok((await page.locator(nav+'[aria-current="page"]').textContent()).toLowerCase().includes('backup'));
  await page.locator(nav).first().click();await page.locator('#workspace-find').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#workspace-find').evaluate(x=>document.activeElement===x),true);
  let panels=0;
  for(const width of [320,390,768,1024,1440,1920]){
   await page.setViewportSize({width,height:1000});
   for(const route of routes){
    if(width<980)await page.locator('#workspace-menu').click();await page.locator(nav+`[${attr}="${route}"]`).click();
    if(width<980){assert.equal(await page.locator('#workspace-menu').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#workspace-navigation').isVisible(),false);}
    assert.equal(await page.locator(nav+'[aria-current="page"]').count(),1);await checkLayout(page,role+' '+route+' '+width);panels++;
    if(route==='overview'){await page.locator('.readiness-key summary').click();await checkLayout(page,role+' expanded readiness key '+width);await page.locator('.readiness-key summary').click();}
    if(width===390&&route==='overview')await page.screenshot({path:path.join(out,'atelier-'+role+'-compact.png'),fullPage:false});
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator(nav).first().click();await page.evaluate(()=>document.body.style.zoom='2');await checkLayout(page,role+' 200% zoom');await page.evaluate(()=>document.body.style.zoom='1');
  await page.emulateMedia({reducedMotion:'reduce'});const animations=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length);assert.equal(animations,0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(requests,[],'navigation must not issue mutation requests');checks.push({role,passed:true,panels,widths:[320,390,768,1024,1440,1920],groupedNavigation:true,expandedReadinessKey:true,keyboardSearch:true,noResultState:true,escapeFocusReturn:true,menuClosesAfterNavigation:true,oneCurrentSection:true,recoveryActionTarget:true,disclosureAndFocusSurviveRefresh:true,noNavigationWrites:true,noExternalRequests:true,reducedMotion:true,cssZoom:2,javascriptErrors:[]});
 }finally{await ctx.close();if(standalone)await app.close();else{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}await c.close();fs.rmSync(home,{recursive:true,force:true});}
 }
 const report={passed:true,environment:'Linux headless Chromium '+await browser.version(),scope:'Synthetic profiles; no physical Safari, VoiceOver or Mac qualification',checks};fs.writeFileSync(path.join(out,'atelier-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
