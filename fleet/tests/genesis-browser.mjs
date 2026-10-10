// Local synthetic UI verification. Requires externally installed Playwright + Chromium.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {Controller as Fleet} from '../ops/controller.mjs';import {createServer} from '../ops/server.mjs';
import {Controller as Agent} from '../packages/AGI_Agent/src/control/controller.mjs';import {createControlServer as agentServer} from '../packages/AGI_Agent/src/control/server.mjs';
import {Controller as Node} from '../packages/AGI_Node/src/control/controller.mjs';import {createControlServer as nodeServer} from '../packages/AGI_Node/src/control/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)),out=process.env.BROWSER_OUTPUT;
fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN,args:['--no-sandbox']}),checks=[],contrast=[];
const password='PUBLIC GENESIS BROWSER FIXTURE ONLY';
async function audit(page,label){
 const r=await page.evaluate(()=>{
  const missing=[];for(const e of document.querySelectorAll('button,input,textarea,select')){if(!e.checkVisibility()||e.disabled||e.type==='hidden')continue;const label=e.textContent.trim()||e.getAttribute('aria-label')||e.getAttribute('title')||[...(e.labels??[])].map(x=>x.textContent.trim()).join(' ');if(!label)missing.push(e.id||e.tagName);}
  return {overflow:document.documentElement.scrollWidth>innerWidth+1,missing};
 });if(r.overflow)console.error(label,await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right})).slice(-20)));assert.equal(r.overflow,false,label+' page overflow');assert.deepEqual(r.missing,[],label+' unnamed controls');
 // Calculated solid-background text checks are a diagnostic, not a WCAG certification.
 const low=await page.evaluate(()=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),found=[];
  for(const e of document.querySelectorAll('p,small,label,button,h1,h2,h3,h4,span,a')){
   if(!e.checkVisibility()||e.disabled||!e.textContent.trim()||e.children.length)continue;const s=getComputedStyle(e);if(Number(s.opacity)<1)continue;
   const fg=rgb(s.color);let b=e,bg;while(b){const v=rgb(getComputedStyle(b).backgroundColor);if(v.length>=3&&(v.length===3||v[3]===1)){bg=v;break;}b=b.parentElement;}if(!bg)continue;
   const ratio=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
   if(ratio<(large?3:4.5))found.push({id:e.id,tag:e.tagName,text:e.textContent.trim().slice(0,75),ratio:Number(ratio.toFixed(2)),fg:s.color,bg:getComputedStyle(b).backgroundColor});
  }return found;
 });if(low.length)contrast.push({label,low});
}
try{
 for(const role of ['agent','node','employer','moderator','recovery','evidence']){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-genesis-ui-')),standalone=['agent','node'].includes(role),C=role==='agent'?Agent:role==='node'?Node:Fleet,c=new C(home,role);
  if(standalone)await c.createVault(password);else await c.unlock(password);
  if(role!=='evidence')await c.wallet('create',{wordCount:24});
  const app=role==='agent'?await agentServer(c,{port:0}):role==='node'?await nodeServer(c,{port:0}):await createServer(c);
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(app.url);await page.waitForFunction(()=>document.querySelectorAll('.genesis-gate').length===6);
   assert.equal(await page.locator('.genesis-tag[data-state="verified"]').count(),0);
   for(const width of [390,768,1280,1440,1600]){await page.setViewportSize({width,height:1000});await audit(page,role+' readiness '+width);}
   await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'readiness-'+role+'.png'),fullPage:true});
   await page.keyboard.press('Tab');const focused=await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,outline:s.outlineWidth,style:s.outlineStyle};});assert.notEqual(focused.tag,'BODY');assert.notEqual(focused.style,'none');
   await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.body.style.zoom='2');await audit(page,role+' CSS 200% zoom');await page.evaluate(()=>document.body.style.zoom='1');
   if(standalone){await page.locator('nav [data-view="studio"]').click();if(role==='agent')await page.waitForFunction(()=>document.querySelectorAll('#studio-templates button').length===10);await page.setViewportSize({width:390,height:1000});await audit(page,role+' Studio mobile');await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'studio-'+role+'.png'),fullPage:true});}
   if(role==='agent'){
    await page.locator('nav [data-view="setup"]').click();await page.locator('#revealPassword').fill(password);await page.locator('#revealPhraseForm button').click();await page.locator('#phraseDialog').waitFor({state:'visible'});
    await page.screenshot({path:path.join(out,'recovery-words-redacted.png'),fullPage:false,mask:[page.locator('#phraseWords')]});await page.locator('#phraseVerify').click();const words=c.vault.get('walletRecovery').phrase.split(' ');for(let i=0;i<3;i++)await page.locator('#recoveryAnswer'+i).fill(words[c.recoveryChallenge.indices[i]]);
    await page.locator('#confirmPhraseForm button').click();await page.locator('#phraseComplete').waitFor({state:'visible'});assert.equal(await page.locator('#phraseWords li').count(),0);assert.equal(await page.locator('#phraseQuestions input').count(),0);
    await audit(page,'recovery success');await page.screenshot({path:path.join(out,'recovery-verified.png'),fullPage:false});await page.locator('#phraseContinue').click();
    const backup=await c.backup(password),file=path.join(home,'fixture-backup.json');fs.writeFileSync(file,JSON.stringify(backup));
    await page.locator('#verifyBackupFile').setInputFiles(file);await page.locator('#verifyBackupPassword').fill('wrong');await page.locator('#verifyBackupForm button').click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('password or encrypted file is incorrect'));
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,'backup-error.png'),fullPage:true});
    await page.locator('#verifyBackupPassword').fill(password);await page.locator('#verifyBackupForm button').click();await page.waitForFunction(()=>document.querySelector('#backupVerificationResult').textContent.includes('ENCRYPTED BACKUP VERIFIED'));await page.locator('#backupSaved').click();
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,'backup-verified.png'),fullPage:true});
    await page.locator('nav [data-view="intelligence"]').click();await page.screenshot({path:path.join(out,'openclaw-setup.png'),fullPage:true});
   }
   assert.deepEqual(errors,[]);checks.push({role,passed:true,widths:[390,768,1280,1440,1600],cssZoom:2,keyboardFocus:true,namedVisibleControls:true,javascriptErrors:[]});
  }finally{await ctx.close();if(standalone)await app.close();else{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}await c.close();fs.rmSync(home,{recursive:true,force:true});}
 }
 const report={passed:true,environment:'Linux headless Chromium '+await browser.version(),scope:'Synthetic profiles; CSS zoom; no real Safari, VoiceOver, Mac, provider or settlement',checks,contrastDiagnostics:contrast};fs.writeFileSync(path.join(out,'genesis-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
