import {Controller} from '../src/control/controller.mjs';
import {createPublicWebReport} from '../src/control/public-web-report.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlServer} from '../src/control/server.mjs';
test('browser commissioning route requires authenticated consent transport and leaves stop available',async()=>{
 let calls=0,finish,entered;const started=new Promise(resolve=>{entered=resolve;});
 const controller={status:()=>({version:'fixture'}),companion:{cancel:async()=>{finish?.({status:'BLOCKED',productionQualified:false});}},companionPublicWebCommissioning:async input=>{calls++;assert.deepEqual(input,{acknowledge:true,allowProviderCalls:true,allowLocalRuntime:true});entered();return new Promise(resolve=>{finish=resolve;});},mutate:async(label,fn)=>{assert.notEqual(label,'Commissioning protected public browser','long request must not hold the controller mutation lock');return fn();}};
 const app=await createControlServer(controller,{port:0}),origin=`http://127.0.0.1:${app.port}`;
 const send=(route,body,headers={})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 let pending;
 try {
  const session=await send('/api/session',{token:app.url.split('#')[1]}),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrf,headers={Cookie:cookie,'X-AGI-CSRF':csrf};
  const input={acknowledge:true,allowProviderCalls:true,allowLocalRuntime:true};
  assert.equal((await send('/api/companion/public-web-commissioning',input,{Cookie:cookie})).status,403);assert.equal(calls,0);
  assert.equal((await send('/api/companion/public-web-commissioning',input,{...headers,Origin:'https://evil.test'})).status,403);assert.equal(calls,0);
  const asset=await fetch(origin+'/public-browser-ui.js');assert.equal(asset.status,200);assert.match(await asset.text(),/AGIPublicBrowser/);assert.match(asset.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  pending=send('/api/companion/public-web-commissioning',input,headers);await started;assert.equal(calls,1);
  const stopped=await send('/api/companion/cancel',{},headers);assert.equal(stopped.status,200);assert.deepEqual(await stopped.json(),{cancelled:true});
  const response=await pending;assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'BLOCKED',productionQualified:false});
 } finally {finish?.({status:'BLOCKED',productionQualified:false});await pending?.catch(()=>{});await app.close();}
});

test('saved report route requires session and unlocked vault without starting commissioning',async()=>{
 let unlocked=true;const stored=createPublicWebReport({completedAt:Date.now(),role:'agent',requestID:'11111111-1111-4111-8111-111111111111',fixtureSha256:'a'.repeat(64),runtimeSha256:'b'.repeat(64),policyHash:'c'.repeat(64),browserEvidence:{status:'PASS',actualBrowserInteraction:true,cleanup:'PASS',completedToolCalls:2},qualificationStatus:{status:'BLOCKED',code:'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED'},qualificationExport:null});
 const controller={vault:{get unlocked(){return unlocked;}},companion:{state:{lastPublicWebReport:stored}},companionPublicWebReport:Controller.prototype.companionPublicWebReport};const app=await createControlServer(controller,{port:0}),origin=`http://127.0.0.1:${app.port}`;
 try{assert.equal((await fetch(origin+'/api/companion/public-web-report')).status,401);const response=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.url.split('#')[1]})}),cookie=response.headers.get('set-cookie').split(';')[0];await response.json();const get=()=>fetch(origin+'/api/companion/public-web-report',{headers:{Cookie:cookie}});assert.equal((await (await get()).json()).report.requestID,stored.requestID);unlocked=false;const locked=await get();assert.equal(locked.status,400);const blocked=await locked.json();assert.equal(blocked.error.code,'NODE_LOCKED');assert.equal(JSON.stringify(blocked).includes(stored.runtimeSha256),false);unlocked=true;assert.equal((await (await get()).json()).report.requestID,stored.requestID);}finally{await app.close();}
});
