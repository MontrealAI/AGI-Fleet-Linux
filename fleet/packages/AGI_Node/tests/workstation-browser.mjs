import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
const spec=JSON.parse(fs.readFileSync(new URL('../examples/computer-smoke.json',import.meta.url)));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-capable-browser-'));
const output=process.env.BROWSER_OUTPUT??home;fs.mkdirSync(output,{recursive:true});
let clock=Date.now();
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const c=new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,opts)=>{
 if(url.endsWith('/health'))return Response.json({policyCurrent:true,protocol:'agi-compute/v2',role:'node',uid:1001+(process.getuid?.()??0),policyHash:'a'.repeat(64),tools:true,gatewayReady:true,auth:'chatgpt-oauth',capabilities:['browser','desktop','files','computer-review']});
 const b=JSON.parse(opts.body);assert.deepEqual(b.tools,[]);assert.equal(b.tool_choice,'none');
 if(opts.headers['x-agi-kind']==='computer-review'){const data=JSON.parse(b.messages[1].content);assert.equal(data.specification.profile,'computer-work/v1');assert.equal(JSON.parse(data.delivery).files.length,3);return response({safeToReview:true,checks:spec.criteria.map(x=>({id:x.id,status:'pass',method:'Fixture response',observed:'Synthetic pass',files:['report.docx','sales.xlsx','summary.pptx']}))});}
 return response({status:'ready'});
}}});
await c.createVault('Fixture-only browser password 123!');await c.wallet('create');await c.companionKit({acknowledge:true,mode:"workstation"});await c.companionTest();clock+=31000;
const app=await createControlServer(c,{port:0});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
 await page.click('nav [data-view="companion"]');await page.click('#companion-computer-test');
 await page.waitForFunction(()=>document.getElementById('feedback').textContent.includes('Computer review: consistent'));
 await page.locator('summary').filter({hasText:'Optional: require an additional cloud review'}).click();
 await page.check('#cloud-public');await page.check('#cloud-veto');await page.check('#computer-review');await page.click('#cloud-save');
 await page.waitForFunction(()=>document.getElementById('feedback').textContent.includes('Review requirement saved'));assert.equal(c.config.ai.reviewComputerWork,true);assert.equal(c.config.ai.cloudVeto,true);
 await page.screenshot({path:path.join(output,'computer-review-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(output,'computer-review-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({role:'node',browser:await browser.version(),actualOfficeBundleSent:true,mockedToolReviewResponse:true,reviewScopeSaved:true,mobileNoOverflow:true,javascriptErrors:errors,liveInference:false},null,2));
}finally{await browser?.close();await c.close();await app.close();fs.rmSync(home,{recursive:true,force:true});}
