// SPDX-License-Identifier: MIT
// Fresh public browser observations only; no installed/native journey is started.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [inputFile,output]=process.argv.slice(2);
assert(path.isAbsolute(inputFile??'')&&path.isAbsolute(output??''));
const input=JSON.parse(fs.readFileSync(inputFile));
assert.equal(input.schema,'agi-fleet/final-public-live-inputs/v1');
const require=createRequire(new URL('../browser-tests/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
fs.mkdirSync(output,{mode:0o700});
const fixtures={
 en:{'synthetic-title':'Public release verification','synthetic-goal':'Prepare a public synthetic draft for release verification.','zero':'0'},
 fr:{'synthetic-title':'Vérification publique de version','synthetic-goal':'Préparer un brouillon public synthétique pour vérifier la version.','zero':'0'}
};
const forbidden=/\bsign(?:ing)?\b|transaction|approve|authoriz|grant|connect.{0,20}wallet|pay(?:ment)?|send.{0,20}(?:fund|token)|provider|api.?key|password|private.?key|seed|mnemonic/i;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const pointer=(value,selected)=>selected.split('/').slice(1).reduce((item,key)=>{
 assert(item&&typeof item==='object'&&Object.hasOwn(item,key),'Build identity field is absent');return item[key];
},value);
const within=(base,relative)=>{
 assert(relative.startsWith('/')&&!relative.startsWith('//'));
 const result=new URL(relative.slice(1),base);assert(result.href.startsWith(base));return result.href;
};
const bases=Object.values(input.sites).map(site=>site.baseUrl);
const staticHosts=new Set(['fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','unpkg.com']);
const browser=await chromium.launch({headless:true}),browserVersion=browser.version();
const cases=[];let failed=false;
try{
 for(const [role,site]of Object.entries(input.sites)){
  for(const language of ['en','fr']){
   const route=site.languages[language],directory=path.join(output,role+'-'+language);
   fs.mkdirSync(directory,{mode:0o700});
   const context=await browser.newContext({viewport:{width:1280,height:900},
    locale:language==='fr'?'fr-CA':'en-CA',serviceWorkers:'block',acceptDownloads:false});
   const page=await context.newPage(),consoleMessages=[],pageErrors=[],requests=[],blocked=[];
   page.on('console',message=>consoleMessages.push({type:message.type(),text:message.text(),location:message.location()}));
   page.on('pageerror',error=>pageErrors.push(String(error)));
   await context.routeWebSocket('**/*',socket=>{blocked.push({url:socket.url(),reason:'WEBSOCKET_BLOCKED'});socket.close();});
   await context.route('**/*',async interception=>{
    const request=interception.request(),url=new URL(request.url());
    const publicSite=url.protocol==='https:'&&bases.some(base=>url.href.startsWith(base));
    const staticRead=url.protocol==='https:'&&staticHosts.has(url.hostname)&&
      ['stylesheet','font','image','script'].includes(request.resourceType());
    const allowed=request.method()==='GET'&&(publicSite||staticRead)&&!url.username&&!url.password;
    if(!allowed){
     blocked.push({url:url.href,method:request.method(),resourceType:request.resourceType(),reason:'READ_ONLY_ORIGIN_METHOD_POLICY'});
     await interception.abort('blockedbyclient');return;
    }
    requests.push({url:url.href,method:'GET',resourceType:request.resourceType()});
    await interception.continue();
   });
   const result={site:role,language,baseUrl:site.baseUrl,websiteSourceT:site.source,expectedVersion:site.version,
    console:consoleMessages,pageErrors,requests,blocked,steps:[],downloads:[],screenshots:[],status:'FAIL'};
   try{
    const identityURL=within(site.baseUrl,site.buildInfo.path);
    // APIRequestContext is constrained separately because it bypasses browser routing.
    const identityResponse=await context.request.get(identityURL,{maxRedirects:0,timeout:30000});
    assert.equal(identityResponse.status(),200,'Actual public build-info response');
    const identityRaw=await identityResponse.body();assert(identityRaw.length<=1_000_000);
    const identity=JSON.parse(identityRaw.toString('utf8'));
    assert.equal(pointer(identity,site.buildInfo.commitPointer),site.source.commit,'Observed Pages source differs');
    assert.equal(String(pointer(identity,site.buildInfo.versionPointer)),site.version,'Observed public version differs');
    result.buildInfo={url:identityURL,status:identityResponse.status(),bytes:identityRaw.length,
     sha256:sha(identityRaw),observed:identity};
    const address=within(site.baseUrl,route.path),response=await page.goto(address,{waitUntil:'networkidle',timeout:45000});
    assert(response&&response.status()===200);assert(page.url().startsWith(site.baseUrl));
    for(const [index,step]of route.steps.entries()){
     const locator=page.locator('css='+step.selector);await locator.waitFor({state:'visible',timeout:15000});
     const details=await locator.first().evaluate(element=>({
      tag:element.tagName,type:element.getAttribute('type'),name:element.getAttribute('name'),
      label:element.getAttribute('aria-label')||element.textContent||'',
      href:element.getAttribute('href'),download:element.hasAttribute('download')
     }));
     if(['click','fill','select'].includes(step.action)){
      assert(!forbidden.test([details.label,details.name,details.type,step.selector].join(' ')),
       'Authority/account/provider control excluded from public verification');
      assert(!details.download,'Download controls are checked as links without acquiring package bytes');
     }
     if(step.action==='assertVisible')assert(await locator.isVisible());
     else if(step.action==='assertText')assert((await locator.innerText()).includes(step.value));
     else if(step.action==='fill'){
      assert(['INPUT','TEXTAREA'].includes(details.tag)&&!['password','file','hidden'].includes(details.type));
      await locator.fill(fixtures[language][step.value]);
     }else if(step.action==='select')await locator.selectOption(step.value);
     else if(step.action==='click'){
      assert(['A','BUTTON'].includes(details.tag));
      if(details.tag==='A'){const href=new URL(details.href,page.url());assert(href.href.startsWith(site.baseUrl));}
      await locator.click({timeout:15000});
     }else throw Error('Unsupported reviewed UI action');
     assert(page.url().startsWith(site.baseUrl));result.steps.push({index,action:step.action,selector:step.selector});
    }
    for(const expected of route.downloads){
     const locator=page.locator('css='+expected.selector);assert(await locator.isVisible());
     const href=await locator.getAttribute('href');assert(href);
     const observed=new URL(href,page.url()).href;
     assert.equal(observed,site.downloads[expected.assetRole],'Public download link differs from authenticated immutable asset');
     result.downloads.push({selector:expected.selector,assetRole:expected.assetRole,url:observed,
      packageDownloaded:false,assetIdentityAuthenticatedBySeparateReadOnlyAPI:true});
    }
    assert.equal(blocked.length,0,'Page attempted a request outside the read-only public policy');
    assert.equal(pageErrors.length,0,'Public page runtime errors');
    assert.equal(consoleMessages.filter(message=>message.type==='error').length,0,'Public console errors');
    result.status='PASS';
   }catch(error){result.error=String(error);failed=true;}
   finally{
    const file=path.join(directory,'observed.png');
    await page.screenshot({path:file,fullPage:false,timeout:20000});
    result.screenshots.push({file:role+'-'+language+'/observed.png',sha256:sha(fs.readFileSync(file))});
    fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    cases.push(result);await context.close();
   }
  }
 }
}finally{await browser.close();}
fs.writeFileSync(path.join(output,'live-sites.json'),JSON.stringify({
 schema:'agi-fleet/final-public-live-observation/v1',
 websiteSourceT:input.websiteSource,releaseInput:input.releaseInput,connectedJourney:input.connectedJourney,
 browser:browserVersion,cases,status:failed?'FAIL':'PASS',
 scope:'FRESH_HOSTED_PUBLIC_EN_FR_BROWSER_ONLY_NOT_ANOTHER_CONNECTED_JOURNEY',
 accountsUsed:false,walletProviderUsed:false,signing:false,transactions:false,
 nativeExecuted:false,modelExecuted:false,providerExecuted:false,
 packageDownloadsRepeated:false,humanMinutes:null,deviceCost:null,productionQualified:false
},null,2)+'\n',{flag:'wx',mode:0o600});
if(failed)process.exitCode=1;
