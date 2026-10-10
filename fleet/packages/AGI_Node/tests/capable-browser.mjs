import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {Controller} from '../src/control/controller.mjs';
import {createControlServer} from '../src/control/server.mjs';
import {imageSpec,png} from './image-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-capable-browser-'));
const output=process.env.BROWSER_OUTPUT??home;fs.mkdirSync(output,{recursive:true});
let clock=Date.now();
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const c=new Controller(home,{companion:{now:()=>clock,fetchImpl:async(url,opts)=>{
 const b=JSON.parse(opts.body);assert.deepEqual(b.tools,[]);assert.equal(b.tool_choice,'none');
 if(Array.isArray(b.messages[1].content)){assert.equal(b.messages[1].content[1].image_url.url,'data:image/png;base64,'+fs.readFileSync(new URL('../examples/image-smoke.png',import.meta.url)).toString('base64'));return response({safeToReview:true,checks:imageSpec.criteria.map(x=>({id:x.id,status:'pass'}))});}
 return response({status:'ready'});
}}});
await c.createVault('Fixture-only browser password 123!');await c.wallet('create');await c.companionKit({acknowledge:true});await c.companionTest();clock+=31000;
const app=await createControlServer(c,{port:0});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
 await page.click('nav [data-view="companion"]');await page.click('#companion-image-test');
 await page.waitForFunction(()=>document.getElementById('feedback').textContent.includes('Visual test: consistent'));
 await page.locator('summary').filter({hasText:'Optional: require an additional cloud review'}).click();
 await page.check('#cloud-public');await page.check('#cloud-veto');await page.check('#image-review');await page.click('#cloud-save');
 await page.waitForFunction(()=>document.getElementById('feedback').textContent.includes('Review requirement saved'));assert.equal(c.config.ai.reviewImages,true);assert.equal(c.config.ai.cloudVeto,true);
 await page.screenshot({path:path.join(output,'image-review-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(output,'image-review-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({role:'node',browser:await browser.version(),actualFixturePixelsSent:true,mockedVisionResponse:true,reviewScopeSaved:true,mobileNoOverflow:true,javascriptErrors:errors,liveInference:false},null,2));
}finally{await browser?.close();await c.close();await app.close();fs.rmSync(home,{recursive:true,force:true});}
