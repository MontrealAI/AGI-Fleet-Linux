import test from 'node:test';import assert from 'node:assert/strict';
import {authenticateRole,safeSetupFailure} from '../compute/setup-auth.mjs';
import {completionHTML,nextSetupAction} from '../compute/setup-completion.mjs';
function run({cached=false,statuses=[0],login=0,order=0,throwAt}={}){
 const calls=[],saved=[],logs=[],auth={'agi-creator':cached},ledger={value:{auth},save(){saved.push({...auth});}},remaining=[...statuses];
 const oc=(args,capture)=>{calls.push({args,capture});const command=args[1]==='status'?'check':args[2];if(command===throwAt)throw Error('SECRET-CANARY');return{status:command==='check'?remaining.shift()??1:command==='login'?login:order,stdout:'SECRET-CANARY',stderr:'SECRET-CANARY'};};
 let result,error;try{result=authenticateRole({agent:'agi-creator',oc,ledger,log:text=>logs.push(text)});}catch(e){error=e;}
 return{calls,saved,logs,auth,result,error};
}
test('new OAuth login requires selected auth order and a successful captured status check',()=>{const r=run();assert.ifError(r.error);assert.equal(r.auth['agi-creator'],true);assert.equal(r.result.modelRequestTested,false);assert.equal(r.calls.length,3);assert.equal(r.calls.at(-1).capture,true);assert.ok(r.calls.every(x=>!x.args.includes('--probe')));assert.deepEqual(r.saved.map(x=>x['agi-creator']),[false,true]);assert.ok(!r.logs.join().includes('SECRET-CANARY'));});
test('missing or expiring auth after a successful login never gets a completion marker',()=>{for(const status of [1,2,null]){const r=run({statuses:[status]});assert.equal(r.error.message,'OPENCLAW_AUTH_CHECK_FAILED');assert.equal(r.auth['agi-creator'],false);assert.equal(r.saved.length,1);}});
test('login failure stops before order and status without retaining a stale auth marker',()=>{const r=run({login:1});assert.equal(r.error.message,'OPENCLAW_SIGN_IN_INCOMPLETE');assert.equal(r.calls.length,1);assert.equal(r.auth['agi-creator'],false);});
test('cached successful auth is rechecked after setting order and does not repeat login',()=>{const r=run({cached:true,statuses:[0,0]});assert.ifError(r.error);assert.equal(r.result.resumed,true);assert.equal(r.calls.filter(x=>x.args.includes('login')).length,0);assert.equal(r.calls.filter(x=>x.args.includes('--check')).length,2);});
test('an expired cached login must authenticate again; failed renewal stays incomplete',()=>{for(const login of [0,1]){const r=run({cached:true,statuses:[1,0],login});assert.equal(r.calls.filter(x=>x.args.includes('login')).length,1);assert.equal(r.auth['agi-creator'],login===0);}});
test('auth order failure or a post-order check failure clears even a previously successful marker',()=>{for(const opts of [{cached:true,statuses:[0],order:1},{cached:true,statuses:[0,1]}]){const r=run(opts);assert.ok(r.error);assert.equal(r.auth['agi-creator'],false);assert.deepEqual(r.saved.map(x=>x['agi-creator']),[false]);}});
test('exported setup failure is an allowlisted code and never raw auth output',()=>{for(const e of [Error('SECRET-CANARY https://localhost/?code=secret'),{message:'OPENCLAW_AUTH_CHECK_FAILED'},null]){const code=safeSetupFailure(e);assert.ok(!code.includes('SECRET'));assert.match(code,/^(SETUP_STAGE_FAILED|OPENCLAW_AUTH_CHECK_FAILED)$/);const html=completionHTML({passed:false,stages:{oauth:'failed'},failureCode:code});assert.ok(!html.includes('SECRET-CANARY'));assert.ok(html.includes('manual entry'));}});
test('unexpected command errors cannot mark authentication complete',()=>{for(const throwAt of ['login','order']){const r=run({throwAt});assert.equal(r.auth['agi-creator'],false);assert.equal(safeSetupFailure(r.error),'SETUP_STAGE_FAILED');}});
test('next actions distinguish OAuth, service setup, desktop-only and completed stages',()=>{assert.match(nextSetupAction({stages:{oauth:'failed'}}),/resume sign-in/);assert.match(nextSetupAction({stages:{services:'failed'}}),/service error/);assert.match(nextSetupAction({passed:true,stages:{desktop:'passed'}}),/full compute installer/);assert.match(nextSetupAction({passed:true,stages:{services:'passed'}}),/test the role connection/);});

test('a manually repaired valid OAuth store is reused even without an installer completion marker',()=>{const calls=[],ledger={value:{auth:{}},save(){}};const result=authenticateRole({agent:'agi-checker',ledger,reuseExisting:true,log:()=>{},oc:(args)=>{calls.push(args);return{status:0};}});assert.equal(result.resumed,true);assert.ok(calls.every(args=>!args.includes('login')));assert.equal(calls.filter(args=>args.includes('--check')).length,2);});

test('generated runtime and transaction identity failures remain explicit sanitized codes',()=>{for(const code of ['SETUP_GENERATED_RUNTIME_DIRECTORY_REQUIRED','SETUP_TREE_IDENTITY_VERSION'])assert.equal(safeSetupFailure(Error(code)),code);assert.equal(safeSetupFailure(Error('SETUP_TREE_IDENTITY_VERSION /private/profile SECRET-CANARY')),'SETUP_STAGE_FAILED');});

test('repair reuses all three valid identities through candidate auth storage without the guarded CLI write',()=>{
 for(const agent of ['agi-creator','agi-checker','agi-reviewer']){
  const calls=[],ledger={value:{auth:{}},save(){}},receipt={agent,provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true};
  const result=authenticateRole({agent,ledger,requireExisting:true,log:()=>{},oc:args=>{calls.push(args);assert.deepEqual(args,['models','status','--agent',agent,'--check']);return{status:0};},setAuthOrder:a=>{assert.equal(a,agent);return receipt;}});
  assert.equal(result.resumed,true);assert.deepEqual(result.authStaging,receipt);assert.equal(calls.length,2);assert.equal(ledger.value.auth[agent],true);
 }
});
test('repair with missing or expired identity never opens browser login or changes auth order',()=>{
 for(const status of [1,2,null]){
  const calls=[],ledger={value:{auth:{'agi-creator':true}},save(){}};
  assert.throws(()=>authenticateRole({agent:'agi-creator',ledger,requireExisting:true,log:()=>{},oc:args=>{calls.push(args);return{status};},setAuthOrder:()=>assert.fail('must not stage missing auth')}),/OPENCLAW_EXISTING_AUTH_REQUIRED/);
  assert.equal(calls.length,1);assert.equal(calls[0][1],'status');assert.equal(ledger.value.auth['agi-creator'],false);
 }
});
test('invalid candidate auth receipt fails closed before final route check and keeps ledger incomplete',()=>{
 for(const invalid of [null,{agent:'agi-checker',provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true},{agent:'agi-creator',provider:'openai',order:['other'],storage:'openclaw-agent-sqlite',verified:true}]){
  let checks=0;const ledger={value:{auth:{}},save(){}};
  assert.throws(()=>authenticateRole({agent:'agi-creator',ledger,requireExisting:true,log:()=>{},oc:()=>{checks++;return{status:0};},setAuthOrder:()=>invalid}),/OPENCLAW_AUTH_STAGING_FAILED/);
  assert.equal(checks,1);assert.equal(ledger.value.auth['agi-creator'],false);
 }
});

test("runtime socket, bounded shutdown and recovery checkpoint failures retain exact safe codes",()=>{for(const code of ['SETUP_RECOVERY_EVIDENCE_INVALID', 'SETUP_SERVICE_IDENTITY', 'SETUP_SERVICE_STOP_OPTIONS', 'SETUP_SERVICE_STOP_UNCONFIRMED', 'SETUP_RUNTIME_SOCKET_STILL_PRESENT', 'PUBLIC_BROWSER_SOCKET_INVALID', 'PUBLIC_BROWSER_SOCKET_SYMLINK', 'PUBLIC_BROWSER_SOCKET_PERMISSIONS', 'PUBLIC_BROWSER_SOCKET_EXISTS', 'PUBLIC_BROWSER_SOCKET_CHANGED', 'PUBLIC_BROWSER_SOCKET_CANCELLED'])assert.equal(safeSetupFailure(Error(code)),code);assert.equal(safeSetupFailure(Error("PUBLIC_BROWSER_SOCKET_CHANGED /private/SECRET-CANARY")),"SETUP_STAGE_FAILED");});

test('clean initialization failure codes remain explicit and reject diagnostic suffixes',()=>{for(const code of ['SETUP_CLEAN_INITIALIZATION_FAILED','SETUP_CLEAN_INITIALIZATION_CHANGED','SETUP_CLEAN_INITIALIZATION_INCOMPLETE']){assert.equal(safeSetupFailure(Error(code)),code);assert.equal(safeSetupFailure(Error(code+' /private/SECRET-CANARY')),'SETUP_STAGE_FAILED');}});

test('Standard continuation failure keeps its exact safe code',()=>{assert.equal(safeSetupFailure(Error('STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE')),'STANDARD_INSTALL_OAUTH_RESUME_UNAVAILABLE');});
