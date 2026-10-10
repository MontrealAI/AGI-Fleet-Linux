import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app/public-browser-ui.js',import.meta.url),'utf8');
function fixture(providerRequest){
 let reads=0;const request=(route,body)=>route==='/api/companion/public-web-report'?(reads++,Promise.resolve({report:null})):providerRequest(route,body);
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{id,disabled:false,checked:false,textContent:'',attributes:{role:'status'},handlers:{},addEventListener(kind,fn){this.handlers[kind]=fn;},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];}});return nodes.get(id);};
 const context={window:{},document:{getElementById:get},setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(source,context);
 let enabled=true,refreshes=0;
 const ui=context.window.AGIPublicBrowser({request,refresh:async()=>{refreshes++;},enabled:()=>enabled});
 return {get,ui,reads:()=>reads,refreshes:()=>refreshes,lock(){enabled=false;ui.sync();},consent(){get('publicBrowserConsent').checked=true;get('publicBrowserConsent').handlers.change();},run:()=>get('publicBrowserRun').handlers.click(),cancel:()=>get('publicBrowserCancel').handlers.click()};
}
test('browser panel requires explicit consent and consumes it once, including double clicks and retry',async()=>{
 let resolve,calls=[];const f=fixture((route,body)=>{calls.push({route,body});return new Promise(r=>{resolve=r;});});
 assert.equal(calls.length,0);assert.equal(f.reads(),1);assert.equal(f.get('publicBrowserRun').disabled,true);
 await f.run();assert.equal(calls.length,0);f.consent();const pending=f.run();await f.run();
 assert.equal(calls.length,1);assert.equal(JSON.stringify(calls[0].body),JSON.stringify({acknowledge:true,allowProviderCalls:true,allowLocalRuntime:true}));
 assert.equal(f.get('publicBrowserConsent').checked,false);assert.equal(f.get('publicBrowserConsent').disabled,true);
 resolve({summary:'Fixture completed; commercial browsing remains disabled.'});await pending;
 assert.equal(f.get('publicBrowserRun').disabled,true);assert.equal(f.get('publicBrowserDownload').disabled,false);assert.equal(f.refreshes(),1);
 await f.run();assert.equal(calls.length,1);f.consent();f.lock();assert.equal(f.get('publicBrowserRun').disabled,true);assert.equal(f.get('publicBrowserConsent').checked,false);
});
test('cancellation may settle before or after the request, without a stale pending or success message',async()=>{
 for(const order of ['request-first','cancel-first']){
  let rejectRun,resolveCancel;
  const f=fixture(route=>route.endsWith('/cancel')?new Promise(r=>{resolveCancel=r;}):new Promise((r,j)=>{rejectRun=j;}));
  f.consent();const pending=f.run(),cancelling=f.cancel();
  assert.equal(f.get('publicBrowserCancel').disabled,true);
  const error=Object.assign(Error('Stopped'),{code:'COMPANION_CANCELLED'});
  if(order==='request-first'){rejectRun(error);await pending;resolveCancel({cancelled:true});await cancelling;}
  else{resolveCancel({cancelled:true});await cancelling;rejectRun(error);await pending;}
  assert.match(f.get('publicBrowserResult').textContent,/ended|stopped/);assert.doesNotMatch(f.get('publicBrowserResult').textContent,/Waiting|completed/);
  assert.equal(f.get('publicBrowserRun').disabled,true);assert.equal(f.get('publicBrowserDownload').disabled,true);assert.equal(f.get('publicBrowserConsent').checked,false);
 }
});
test('cleanup failure during cancellation remains visible and cannot enable a report or retry without consent',async()=>{
 let rejectRun;const f=fixture(route=>route.endsWith('/cancel')?Promise.reject(Error('Protected browser cleanup failed. Preserve the STOP marker.')):new Promise((r,j)=>{rejectRun=j;}));
 f.consent();const pending=f.run();await f.cancel();rejectRun(Object.assign(Error('Protected browser cleanup failed. Preserve the STOP marker.'),{code:'PUBLIC_WEB_CLEANUP_FAILED'}));await pending;
 assert.equal(f.get('publicBrowserResult').getAttribute('role'),'alert');assert.match(f.get('publicBrowserResult').textContent,/cleanup failed/);assert.equal(f.get('publicBrowserDownload').disabled,true);assert.equal(f.get('publicBrowserRun').disabled,true);
});

test('incomplete commissioning evidence stays visibly blocked while its report remains downloadable',async()=>{
 const f=fixture(async()=>({status:'BLOCKED',summary:'Browser execution evidence is missing. Public browser qualification remains blocked.',productionQualified:false}));
 f.consent();await f.run();assert.match(f.get('publicBrowserResult').textContent,/^BLOCKED/);assert.equal(f.get('publicBrowserResult').getAttribute('role'),'alert');assert.equal(f.get('publicBrowserDownload').disabled,false);assert.equal(f.get('publicBrowserRun').disabled,true);
});
