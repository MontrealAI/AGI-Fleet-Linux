import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(process.env.AGI_UI_BASELINE_SOURCE??new URL('../app/app.js',import.meta.url),'utf8');
const isNode=source.includes('async function action(button, work)');
const action=source.slice(source.indexOf(isNode?'async function action(button, work)':'function action(id, fn)'),source.indexOf(isNode?'function showView(view)':'function download(name'));
const OLD='0cab1f69064a1bc37e429fa0206ad245a0ef175f0786ce8112dc52bd91165ac8';
const PROPOSED='fff3d1c45e3545d38969684511b6c47b88b039e53abbc74498673f27ce8016be';
function setup({failure=null,defer=false,response={}}={}){
 const nodes=new Map(),calls=[];let error='',resolveApproval;
 const proposal={id:'12345678-1234-4234-8234-123456789abc',revision:7,expiresAt:Date.now()+600000,identityDigest:'a'.repeat(64)};
 const companion={config:{enabled:true,maxCalls24h:128},computePolicy:OLD,bindingRevision:7,approval:{awaitingApproval:true},pacing:{cause:'awaiting_identity_approval'},limits:{configuredSignerCalls24h:128,computeRuns24h:null,computeImages24h:null,effectiveCalls24h:null},usage:{reservedSlots24h:3,dispatchedRequests24h:1,actualProviderCalls:null}};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{id,tagName:'BUTTON',disabled:id==='approveComputeIdentity',checked:false,listeners:{},setAttribute(){},addEventListener(event,fn){this.listeners[event]=fn;}});return nodes.get(id);};
 const result={policyHash:PROPOSED,operationID:'operation-1',approvalStatus:'committed',bindingRevision:8,persisted:true,...response};
 const context=vm.createContext({$,demo:false,working:0,state:{companion},Date,notice:m=>{error=m;},say:m=>{error=m;},refresh:async()=>{},api:async(route,input)=>{calls.push({route,input});if(route.endsWith('/identity'))return {policyHash:PROPOSED,boundPolicyHash:OLD,proposal,capabilities:['files'],qualification:{tools:{status:'NOT_TESTED'}}};if(route.endsWith('/approve-identity')){if(failure)throw Object.assign(Error('Synthetic '+failure),{code:failure});if(defer)return await new Promise(resolve=>{resolveApproval=()=>resolve(result);});companion.computePolicy=PROPOSED;companion.bindingRevision=8;return result;}return {};}});
 context.request=context.api;
 const click=isNode?source.slice(source.indexOf('const click ='),source.indexOf('const submit =')):'';
 vm.runInContext(action+'\n'+click+'\n'+source.slice(source.indexOf(source.includes('function companionAvailability(')?'function companionAvailability(':'function companionStatusText('),source.indexOf('\npublicBrowserUI = window.AGIPublicBrowser')),context);
 return {$,calls,proposal,companion,error:()=>error,context,click:async id=>$(id).listeners.click({currentTarget:$(id),preventDefault(){}}),consent(){const checkbox=$('computeIdentityConsent');checkbox.checked=true;checkbox.listeners.change();},complete(){resolveApproval();},sync(){context.syncComputeIdentityState(companion);}};
}
test('local pacing retains the exact reviewed candidate and explicit consent',async()=>{
 const h=setup({failure:'COMPANION_COOLDOWN'});await h.click('inspectComputeIdentity');h.consent();await h.click('approveComputeIdentity');
 assert.equal(h.$('computeIdentityConsent').checked,true,'a local pacing rejection must not erase the reviewed consent');
 assert.match(h.$('computeIdentityResult').textContent,/retained/i);
 assert.equal(h.calls.filter(c=>c.route.endsWith('/approve-identity')).length,1);
});
test('approval sends the authenticated proposal revision and only reports persisted success',async()=>{
 const h=setup();assert.equal(h.calls.length,0);await h.click('inspectComputeIdentity');assert.equal(h.$('approveComputeIdentity').disabled,true);h.consent();await h.click('approveComputeIdentity');
 const request=h.calls.find(c=>c.route.endsWith('/approve-identity'));
 assert.equal(request.input.policyHash,PROPOSED);assert.equal(request.input.proposalID,h.proposal.id);assert.equal(request.input.revision,7);
 assert.equal(h.$('computeIdentityConsent').checked,false);assert.equal(h.$('approveComputeIdentity').disabled,true);
 assert.match(h.$('computeIdentityResult').textContent,/persisted/i);assert.match(h.$('computeIdentityResult').textContent,/operation-1/);
});
test('identity drift clears consent and requires a fresh inspection',async()=>{
 const h=setup({failure:'COMPANION_COMPUTE_APPROVAL_CHANGED'});await h.click('inspectComputeIdentity');h.consent();await h.click('approveComputeIdentity');assert.equal(h.$('computeIdentityConsent').checked,false);h.consent();assert.equal(h.$('approveComputeIdentity').disabled,true);
});
test('a binding committed by another tab invalidates a stale review',async()=>{
 const h=setup();await h.click('inspectComputeIdentity');h.consent();h.companion.bindingRevision=8;h.companion.computePolicy='b'.repeat(64);h.sync();assert.equal(h.$('computeIdentityConsent').checked,false);assert.equal(h.$('approveComputeIdentity').disabled,true);assert.match(h.$('computeIdentityResult').textContent,/another tab|changed/i);
});
test('expired proposal clears consent without a provider request',async()=>{
 const h=setup();await h.click('inspectComputeIdentity');h.consent();h.proposal.expiresAt=Date.now()-1;h.sync();assert.equal(h.$('approveComputeIdentity').disabled,true);assert.equal(h.$('computeIdentityConsent').checked,false);assert.equal(h.calls.filter(c=>c.route.endsWith('/approve-identity')).length,0);
});
test('cancellation prevents late approval response from overwriting cancelled UI',async()=>{
 const h=setup({defer:true});await h.click('inspectComputeIdentity');h.consent();const pending=h.click('approveComputeIdentity');await h.click('cancelComputeIdentity');h.complete();await pending;
 assert.match(h.$('computeIdentityResult').textContent,/cancel/i);assert.doesNotMatch(h.$('computeIdentityResult').textContent,/persisted success/i);assert.equal(h.$('approveComputeIdentity').disabled,true);
});
test('limits distinguish configured signer cap from unverified compute cap and usage',()=>{
 const h=setup();const text=h.context.companionUsageText(h.companion);assert.match(text,/128/);assert.match(text,/unknown|unreported/i);assert.match(text,/not.*provider|provider.*unknown/i);assert.doesNotMatch(text,/effective[^.]*128/i);
 h.companion.limits={configuredSignerCalls24h:128,computeRuns24h:48,computeImages24h:8,effectiveCalls24h:48};assert.match(h.context.companionUsageText(h.companion),/Effective[^.]*48/);
});
test('pacing renders cause, countdown and an exact next attempt time without model requests',()=>{
 const h=setup();h.companion.pacing={cause:'local_pacing',nextAttemptAt:Date.now()+60000};const text=h.context.companionAvailability(h.companion);assert.match(text,/Local request pacing/);assert.match(text,/seconds/);assert.match(text,/Next attempt/);assert.equal(h.calls.length,0);
});

test('a committed binding with incomplete persistence cleanup stays visibly blocked',async()=>{
 const h=setup({response:{reconciliationRequired:true}});await h.click('inspectComputeIdentity');h.consent();await h.click('approveComputeIdentity');assert.match(h.$('computeIdentityResult').textContent,/committed/);assert.match(h.$('computeIdentityResult').textContent,/inference remains blocked/);assert.equal(h.$('approveComputeIdentity').disabled,true);
});
test('an unverified success response cannot be presented as persisted approval',async()=>{
 const h=setup({response:{persisted:false}});await h.click('inspectComputeIdentity');h.consent();await h.click('approveComputeIdentity');assert.match(h.error(),/no verified persisted binding/);assert.doesNotMatch(h.$('computeIdentityResult').textContent,/Identity approval persisted/);assert.equal(h.$('computeIdentityConsent').checked,false);
});

test('approval reconciliation blocks ordinary model actions with its own cause',()=>{
 const h=setup();h.companion.pacing={cause:'approval_reconciliation_required'};h.sync();assert.match(h.context.companionAvailability(h.companion),/Approval persistence reconciliation/);for(const id of ['companion-test','companion-computer-test','companion-image-test','companion-summarize'])assert.equal(h.$(id).disabled,true);
});

test('compute daily allowance reports unknown reset separately from local retry pacing',()=>{
 const h=setup();h.companion.nextAttemptAt=Date.now()+300000;h.companion.pacing={cause:'daily_allowance_exhausted',source:'compute',nextAttemptAt:null,localRetryAt:Date.now()+30000};const text=h.context.companionAvailability(h.companion);assert.match(text,/reset time is not reported/);assert.match(text,/Local earliest retry/);assert.doesNotMatch(text,/Next attempt:/);h.sync();assert.equal(h.$('approveComputeIdentity').disabled,true);
});
