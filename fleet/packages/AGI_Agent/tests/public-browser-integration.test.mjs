import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import {startFixtureChild,stopFixtureChild} from './child-fixture.mjs';
import {WebSocketServer} from 'ws';
import plugin,{protectedBrowserTool} from '../compute/openclaw-public-browser/index.mjs';
import {startPublicBrowserBroker,requestPublicBrowser} from '../compute/public-browser-broker.mjs';
import {connectProtectedCDP,createPublicBrowserSession,authorizedBrowserURL} from '../compute/public-browser-session.mjs';
import {makePublicBrowserPolicy,installPublicBrowserPlugin,publicBrowserPluginDigest,publicBrowserPolicyReady,applyPublicBrowserProfile} from '../compute/public-browser-config.mjs';
import {inspectionExpression,interactionExpression} from '../compute/public-browser-dom.mjs';
import {approvePublicWebGrant,grantDigest} from '../compute/public-web-policy.mjs';
import {computeProfile,mergeRolePolicy} from '../compute/profile.mjs';
import {effectiveToolAllowed,runtimeManifest} from '../compute/runtime.mjs';

const keys=crypto.generateKeyPairSync('ed25519'),authority=keys.publicKey.export({format:'pem',type:'spki'}),privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'}),id=crypto.randomUUID(),context={agentId:'agi-creator',sessionKey:'agent:agi-creator:agi-work-'+id,sandboxed:true};
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-web-'));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function unixSocketAvailable(t,directory){const server=net.createServer();try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path.join(directory,'probe.sock'),resolve);});await new Promise(resolve=>server.close(resolve));return true;}catch(error){if(['EPERM','EACCES','ENOSYS'].includes(error.code)){t.skip('Environment denies Unix-domain socket bind; physical/local socket test NOT TESTED here.');return false;}throw error;}}
function grant(overrides={}){return {schema:'agi-public-web-grant/v2',purpose:'commissioning',taskHash:'a'.repeat(64),sourceSpecSha256:'f'.repeat(64),runtimeSha256:'e'.repeat(64),chainId:1,manager:'0x'+'1'.repeat(40),jobID:'1',role:'agent',interactions:['inspect','navigate'],runtimePolicyHash:'b'.repeat(64),sessionID:id,browserContainerID:'c'.repeat(64),browserImageID:'sha256:'+'d'.repeat(64),proxyImageID:'sha256:'+'e'.repeat(64),browserIPv4:'172.30.80.3',proxyIPv4:'172.30.80.2',issuedAt:Date.now()-10,expiresAt:Date.now()+120000,hosts:[{hostname:'example.com',ports:[80,443]}],limits:{maxRequests:64,maxConnections:8,maxBytes:1048576},...overrides};}
async function sessionFixture(t,{interactions=['inspect','navigate'],verifyHook,checkPolicy=()=>{},responses={}}={}){
 const directory=temporary(t),g=grant({interactions}),calls=[];let closed=false,currentURL='about:blank',checks=0;
 fs.writeFileSync(path.join(directory,'grant.json'),JSON.stringify(approvePublicWebGrant(g,privateKey)),{mode:0o600});fs.writeFileSync(path.join(directory,'browser.env'),'OPENCLAW_BROWSER_CDP_AUTH_TOKEN='+'9'.repeat(64)+'\n',{mode:0o600});
 const connection={async call(method,params,sessionID){calls.push({method,params,sessionID});if(responses[method])return responses[method](params);if(method==='Target.createBrowserContext')return {browserContextId:'owned-context'};if(method==='Target.createTarget')return {targetId:'owned-target'};if(method==='Target.attachToTarget')return {sessionId:'owned-session'};if(method==='Page.navigate'){currentURL=params.url;return {};}if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame',url:currentURL}}};if(method==='Page.createIsolatedWorld')return {executionContextId:7};if(method==='Runtime.evaluate')return {result:{value:JSON.stringify({title:'Fixture',text:'Untrusted public text',links:[{text:'Allowed link',url:'https://example.com/next'},{text:'Forbidden link',url:'http://127.0.0.1/private'}],forms:[]})}};if(method==='Page.captureScreenshot')return {data:Buffer.from('synthetic-png').toString('base64')};return {};},close(){closed=true;}};
 const session=await createPublicBrowserSession({prepared:{plan:{spec:{sessionDirectory:directory}}},operatorPublicKey:authority,expectedGrantHash:grantDigest(g),checkPolicy,dependencies:{publicWebCDPCommand:async()=>{checks++;if(verifyHook)await verifyHook(checks);return {executable:'/fixture/docker',args:[]};},connectCDP:async()=>connection}});
 t.after(()=>session.close());return {session,calls,grant:g,get closed(){return closed;},get checks(){return checks;}};
}
test('pinned plugin registration uses trusted factory identity and rejects model-owned identity fields',async()=>{
 let factory,options;plugin.register({pluginConfig:{socketPath:'/private/web.sock'},registerTool(f,o){factory=f;options=o;}});assert.equal(options.optional,true);assert.deepEqual(options.names,['agi_public_browser']);
 assert.equal(factory({...context,agentId:'agi-checker'}),null);assert.equal(factory({...context,sandboxed:false}),null);assert.equal(factory({...context,sessionKey:'agent:agi-reviewer:agi-work-'+id}),null);
 const calls=[],tool=protectedBrowserTool(context,{socketPath:'/private/web.sock'},{request:async options=>{calls.push(options);return {text:'page data',untrusted:true};}});await tool.execute('one',{action:'snapshot'});assert.deepEqual(calls[0].context,{agentId:context.agentId,sessionKey:context.sessionKey});assert.equal(calls[0].command.action,'snapshot');
});
test('actual private Unix broker routes exact context, enforces strict arguments, and keeps a live socket',async t=>{
 const directory=temporary(t),socketPath=path.join(directory,'web.sock'),seen=[];if(!await unixSocketAvailable(t,directory))return;
 const broker=await startPublicBrowserBroker({socketPath,execute:async value=>{seen.push(value);assert.equal(value.sessionKey,context.sessionKey);return {text:'fixture'};}});t.after(()=>broker.close());
 assert.equal(fs.statSync(socketPath).mode&0o777,0o600);
 const tool=protectedBrowserTool(context,{socketPath});assert.match((await tool.execute('one',{action:'snapshot'})).content[0].text,/UNTRUSTED_PUBLIC_PAGE/);assert.equal(seen.length,1);
 assert.throws(()=>requestPublicBrowser({socketPath,context,command:{action:'snapshot',sessionKey:'forged'}}),/COMMAND_INVALID/);
 await assert.rejects(startPublicBrowserBroker({socketPath,execute:async()=>({})}),/SOCKET_EXISTS/);
 assert.equal((await requestPublicBrowser({socketPath,context,command:{action:'snapshot'}})).text,'fixture');
 await broker.close();assert.equal(fs.existsSync(socketPath),false);
});
test('an owned crash-left socket is reclaimed; regular files and symlinks are preserved',async t=>{
 const directory=temporary(t),socketPath=path.join(directory,'crash.sock');if(!await unixSocketAvailable(t,directory))return;
 const child=await startFixtureChild(process.execPath,['--input-type=module','-e',"import net from 'node:net';import fs from 'node:fs';const s=net.createServer();s.listen(process.argv[1],()=>{fs.chmodSync(process.argv[1],0o600);process.stdout.write('READY');});",socketPath],{ready:'READY'});
 await stopFixtureChild(child,{signal:'SIGKILL'});assert.ok(fs.lstatSync(socketPath).isSocket());
 const broker=await startPublicBrowserBroker({socketPath,execute:async()=>({status:'ok'})});await broker.close();
 fs.writeFileSync(socketPath,'keep',{mode:0o600});await assert.rejects(startPublicBrowserBroker({socketPath,execute:async()=>({})}),/SOCKET_EXISTS/);assert.equal(fs.readFileSync(socketPath,'utf8'),'keep');
 fs.unlinkSync(socketPath);fs.symlinkSync(path.join(directory,'missing'),socketPath);await assert.rejects(startPublicBrowserBroker({socketPath,execute:async()=>({})}),/SOCKET_EXISTS/);assert.ok(fs.lstatSync(socketPath).isSymbolicLink());
});
test('CDP HTTP discovery and WebSocket both use the injected relay with authentication, never advertised TCP endpoint',async t=>{
 const auth='Basic '+Buffer.from('openclaw:'+'9'.repeat(64)).toString('base64'),seen=[];
 const server=http.createServer((req,res)=>{seen.push(req.headers.authorization);assert.equal(req.url,'/json/version');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:65432/devtools/browser/test-fixture'}));}),wss=new WebSocketServer({noServer:true});
 server.on('upgrade',(req,socket,head)=>{seen.push(req.headers.authorization);assert.equal(req.url,'/devtools/browser/test-fixture');wss.handleUpgrade(req,socket,head,ws=>{ws.on('message',bytes=>{const m=JSON.parse(bytes);ws.send(JSON.stringify({id:m.id,result:{method:m.method}}));});});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const ws of wss.clients)ws.terminate();wss.close();server.closeAllConnections();server.close();});
 let opened=0;const connection=await connectProtectedCDP({token:'9'.repeat(64),openStream:()=>{opened++;return net.connect({host:'127.0.0.1',port:server.address().port});}});
 assert.deepEqual(await connection.call('Page.enable'),{method:'Page.enable'});assert.equal(opened,2);assert.deepEqual(seen,[auth,auth]);connection.close();
});
test('session creates fresh context, denies downloads, enforces destination scope, and rechecks every operation',async t=>{
 const f=await sessionFixture(t);await f.session.execute({action:'navigate',url:'https://example.com/start'});const result=await f.session.execute({action:'snapshot'});
 assert.equal(result.text,'Untrusted public text');assert.equal(result.links.length,1);assert.equal(result.links[0].url,'https://example.com/next');assert.ok(f.calls.some(c=>c.method==='Browser.setDownloadBehavior'&&c.params.behavior==='deny'));assert.equal(f.checks,3);
 const before=f.calls.length;await assert.rejects(f.session.execute({action:'navigate',url:'http://127.0.0.1/'}),/HOST_INVALID|HOST_NOT_APPROVED/);assert.equal(f.calls.length,before);
 await assert.rejects(f.session.execute({action:'type',ref:id+':0',text:'hello'}),/FORM_NOT_APPROVED/);await assert.rejects(f.session.execute({action:'click',ref:id+':0'}),/FORM_NOT_APPROVED/);
 await assert.rejects(f.session.execute({action:'navigate',url:'https://example.com/',targetId:'another'}),/COMMAND_INVALID/);
});
test('a stalled WebSocket upgrade has an independent deadline even when the relay timeout method is inert',async t=>{
 const sockets=new Set(),server=http.createServer((_req,res)=>res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/browser/stalled'})));server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});server.on('upgrade',()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const socket of sockets)socket.destroy();server.close();});
 const started=Date.now();await assert.rejects(connectProtectedCDP({token:'9'.repeat(64),handshakeTimeoutMs:30,openStream:()=>{const socket=net.connect({host:'127.0.0.1',port:server.address().port});socket.setTimeout=()=>socket;return socket;}}),/HANDSHAKE_TIMEOUT/);assert.ok(Date.now()-started<2000);
});
test('inspection-only approval denies navigation and form actions before CDP side effects',async t=>{
 const f=await sessionFixture(t,{interactions:['inspect']}),count=f.calls.length;await assert.rejects(f.session.execute({action:'navigate',url:'https://example.com/'}),/NAVIGATION_NOT_APPROVED/);assert.equal(f.calls.length,count);
});
test('cancellation while Docker identity is being checked prevents later navigation',async t=>{
 let release,started;const waiting=new Promise(resolve=>started=resolve),f=await sessionFixture(t,{verifyHook:async count=>{if(count===2){started();await new Promise(resolve=>release=resolve);}}}),controller=new AbortController();
 const task=f.session.execute({action:'navigate',url:'https://example.com/'},{signal:controller.signal});await waiting;controller.abort();release();await assert.rejects(task,/CANCELLED/);assert.ok(f.closed);assert.equal(f.calls.filter(c=>c.method==='Page.navigate').length,0);
});
test('public URL parser denies credentials, alternate protocols, private literals and unapproved ports',()=>{
 for(const url of ['https://user:pass@example.com/','file:///etc/passwd','javascript:alert(1)','http://127.1/','https://example.com:8080/','https://other.example/'])assert.throws(()=>authorizedBrowserURL(grant(),url),/PUBLIC_/);
});
test('form references exclude passwords/files/hidden fields and expire on document mutation',()=>{
 let clicked=0,focused=0,mutation=false;
 const node=(type)=>({tagName:'INPUT',type,id:type,name:type,disabled:false,readOnly:false,isConnected:true,labels:[],innerText:'',textContent:'',getAttribute:()=>null,form:{action:'https://example.com/search',method:'get'},getBoundingClientRect:()=>({width:120,height:30}),focus(){focused++;},click(){clicked++;}}),nodes=['text','password','file','hidden','submit'].map(node);
 const ctx=vm.createContext({document:{title:'Test',body:{innerText:'fixture'},querySelectorAll:selector=>selector==='input,textarea,button'?nodes:[]},location:{href:'https://example.com/'},getComputedStyle:()=>({display:'block',visibility:'visible'}),MutationObserver:class{observe(){}disconnect(){}takeRecords(){return mutation?[{}]:[];}}});
 const snapshot=JSON.parse(vm.runInContext(inspectionExpression(id,true),ctx));assert.deepEqual(snapshot.forms.map(f=>f.type),['text','submit']);
 assert.equal(JSON.parse(vm.runInContext(interactionExpression(snapshot.forms[0].ref,'focus'),ctx)).ok,true);assert.equal(focused,1);
 nodes[0].type='password';assert.equal(JSON.parse(vm.runInContext(interactionExpression(snapshot.forms[0].ref,'focus'),ctx)).ok,false);assert.equal(focused,1);
 mutation=true;assert.equal(JSON.parse(vm.runInContext(interactionExpression(snapshot.forms[1].ref,'click'),ctx)).ok,false);assert.equal(clicked,0);
});
test('form scope permits only freshly inspected controls and fixed CDP input; no tool expression is accepted',async t=>{
 let snapshots=0;const f=await sessionFixture(t,{interactions:['inspect','navigate','form'],responses:{'Runtime.evaluate':params=>{if(params.expression.includes('const nonce=')){snapshots++;return {result:{value:JSON.stringify({title:'Form',text:'form',links:[],forms:[{ref:id+':0',tag:'input',type:'text',label:'Search'}]})}};}return {result:{value:JSON.stringify({ok:true,text:true,click:false,formAction:'https://example.com/search'})}};}}});
 await f.session.execute({action:'navigate',url:'https://example.com/'});await f.session.execute({action:'snapshot'});await f.session.execute({action:'type',ref:id+':0',text:'public search'});assert.equal(snapshots,1);assert.equal(f.calls.filter(c=>c.method==='Input.insertText'||c.method==='Input.dispatchKeyEvent').length,0);assert.ok(f.calls.some(c=>c.method==='Runtime.evaluate'&&c.params.expression.includes('public search')));
 await assert.rejects(f.session.execute({action:'type',ref:id+':0',text:'again'}),/FORM_NOT_APPROVED/);await assert.rejects(f.session.execute({action:'type',ref:id+':0',text:'x',expression:'evil()'}),/COMMAND_INVALID/);
});
test('atomic text entry is bound to the approved element even when page focus would redirect to a password',()=>{
 let focusCalls=0;const values=new Map(),allowed={tagName:'INPUT',type:'text',id:'search',name:'search',disabled:false,readOnly:false,isConnected:true,labels:[],getAttribute:()=>null,form:{action:'https://example.com/search',method:'get'},getBoundingClientRect:()=>({width:100,height:20}),focus(){focusCalls++;context.document.activeElement=denied;},dispatchEvent(){}},denied={...allowed,type:'password',id:'secret'};
 class Input{};Object.defineProperty(Input.prototype,'value',{set(value){values.set(this,value);}});
 const context={document:{title:'Fixture',body:{innerText:'fixture'},activeElement:denied,querySelectorAll:selector=>selector==='input,textarea,button'?[allowed,denied]:[]},location:{href:'https://example.com/'},getComputedStyle:()=>({display:'block',visibility:'visible'}),MutationObserver:class{observe(){}disconnect(){}takeRecords(){return [];}},HTMLInputElement:Input,HTMLTextAreaElement:class{},InputEvent:class{},Event:class{}};
 const runtime=vm.createContext(context),snapshot=JSON.parse(vm.runInContext(inspectionExpression(id,true),runtime));assert.equal(snapshot.forms.length,1);
 assert.equal(JSON.parse(vm.runInContext(interactionExpression(snapshot.forms[0].ref,'type','public query'),runtime)).ok,true);assert.equal(values.get(allowed),'public query');assert.equal(values.has(denied),false);assert.equal(focusCalls,0);
});
test('stopped policy proposals cannot self-qualify, static plugin bytes are checked, checker remains tool-less',t=>{
 const directory=temporary(t),p=makePublicBrowserPolicy({profileDir:directory,operatorPublicKey:authority,proposal:{schema:'agi-public-browser-policy-proposal/v1',mode:'commissioning',browserImageID:'sha256:'+'d'.repeat(64),proxyImageID:'sha256:'+'e'.repeat(64)}});installPublicBrowserPlugin(p.pluginDirectory);
 assert.throws(()=>makePublicBrowserPolicy({profileDir:directory,proposal:{schema:'agi-public-browser-policy-proposal/v1',mode:'qualified'}}),/QUALIFICATION_IMPORT_REQUIRED/);assert.throws(()=>publicBrowserPolicyReady({publicWebPolicy:{...p,mode:'qualified',qualificationEvidenceSha256:'f'.repeat(64)},profileDir:directory}),/RECEIPT_REQUIRED/);
 const config=computeProfile({token:'a'.repeat(64),port:18896,model:'openai/gpt-6-astra',workspace:directory,imageID:'sha256:'+'b'.repeat(64),workstation:true,jobRoot:path.join(directory,'jobs'),inputRoot:path.join(directory,'input'),browserImageID:'sha256:'+'c'.repeat(64)}),enabled=applyPublicBrowserProfile(config,p,{grantTool:true,explicitApproval:true});
 assert.equal(effectiveToolAllowed(enabled,enabled.agents.entries['agi-creator'],'agi_public_browser'),true);assert.equal(effectiveToolAllowed(enabled,enabled.agents.entries['agi-checker'],'agi_public_browser'),false);assert.equal(effectiveToolAllowed(enabled,enabled.agents.entries['agi-creator'],'browser'),false);assert.equal(enabled.agents.entries['agi-creator'].sandbox.docker.network,'none');
 const configFile=path.join(directory,'gateway.json');fs.writeFileSync(configFile,JSON.stringify(enabled));const c={publicWebPolicy:p,workstation:true,imageID:'sha256:'+'b'.repeat(64),browserImageID:'sha256:'+'c'.repeat(64),policyHash:'a'.repeat(64),gatewayConfig:configFile};assert.equal(publicBrowserPolicyReady(c,{commissioning:true}),true);assert.equal(runtimeManifest(c).capabilities.includes('browser'),false);assert.equal(runtimeManifest(c,'agent',{commissioning:true}).capabilities.includes('browser'),true);
 fs.appendFileSync(path.join(p.pluginDirectory,'index.mjs'),'\n// drift');assert.notEqual(publicBrowserPluginDigest(p.pluginDirectory),p.pluginSha256);assert.throws(()=>publicBrowserPolicyReady(c,{commissioning:true}),/PLUGIN_CHANGED/);
});
test('configuration accepts only canonical public SPKI keys and never persists private or appended secret material',t=>{
 const directory=temporary(t),proposal={schema:'agi-public-browser-policy-proposal/v1',mode:'disabled'};
 for(const value of [privateKey,authority+'\n'+privateKey,authority+'\nSYNTHETIC-SECRET']){assert.throws(()=>makePublicBrowserPolicy({profileDir:directory,operatorPublicKey:value,proposal}),/AUTHORITY_INVALID/);assert.throws(()=>makePublicBrowserPolicy({profileDir:directory,operatorPublicKey:authority,proposal:{...proposal,reviewerPublicKey:value}}),/REVIEWER_INVALID/);}
 assert.equal(makePublicBrowserPolicy({profileDir:directory,operatorPublicKey:authority.replaceAll('\n','\r\n'),proposal}).operatorPublicKey,authority);
 assert.throws(()=>makePublicBrowserPolicy({profileDir:directory,operatorPublicKey:authority,proposal:{...proposal,reviewerPublicKey:authority}}),/INDEPENDENT_REVIEWER_REQUIRED/);
});
