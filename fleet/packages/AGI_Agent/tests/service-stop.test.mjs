import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {stopManagedServices,safeServiceStopDiagnostics} from '../compute/service-stop.mjs';
import {publicBrowserRuntimeSocketPath,ensurePublicBrowserRuntimeDirectory,inspectPublicBrowserSocket} from '../compute/public-browser-runtime.mjs';
const labels=['ai.montreal.agi-compute','ai.openclaw.agi-compute'];
const absent=(args,uid=504)=>({status:113,stderr:`Could not find service "${args[1].split('/').at(-1)}" in domain for user gui: ${uid}`});
const opts={uid:504,labels,ports:[18894,18896],probePort:async()=>false};
const stoppedRun=async(file,args)=>args[0]==='print'?absent(args):{status:0};
function clock(timeoutMs=1000){let time=0;return{timeoutMs,pollIntervalMs:100,now:()=>time,sleep:async ms=>{time+=ms;},advance:ms=>{time+=ms;}};}
test('unloaded LaunchAgents and closed ports establish quiescence even on fresh install',async()=>{const calls=[];assert.equal(await stopManagedServices({...opts,...clock(),run:async(file,args)=>{calls.push(args);return args[0]==='print'?absent(args):{status:3};}}),true);assert.deepEqual(calls.map(x=>x[0]),['bootout','bootout','print','print']);});
test('already unloaded macOS bootout status 5 is resolved only by exact absence and closed ports',async()=>{assert.equal(await stopManagedServices({...opts,...clock(),run:async(file,args)=>args[0]==='print'?absent(args):{status:5,stderr:'Boot-out failed: 5: Input/output error'}}),true);});
test('both jobs, both ports and the recognized socket may disappear at different times',async()=>{
 const timing=clock(),diagnostics={},events=[];let socketsChecked=0;
 assert.equal(await stopManagedServices({...opts,...timing,diagnostics,run:async(file,args)=>{events.push(args[0]);if(args[0]==='bootout')return {status:0};return timing.now()<(args[1].includes('montreal')?200:400)?{status:0,stdout:'state = stopping'}:absent(args);},probePort:async port=>timing.now()<(port===18894?500:600),checkSockets:()=>{socketsChecked++;assert(timing.now()>=600);return timing.now()>=800;}}),true);
 assert.equal(timing.now(),800);assert.equal(diagnostics.attempts,9);assert.equal(diagnostics.state,'passed');assert.equal(diagnostics.socketsAbsent,true);assert.deepEqual(diagnostics.servicesAbsent,{compute:true,gateway:true});assert.deepEqual(events.slice(0,2),['bootout','bootout']);assert.equal(socketsChecked,3);
});
test('closed ports do not admit a KeepAlive job between restarts',async()=>{let socketsChecked=0;const timing=clock();await assert.rejects(stopManagedServices({...opts,...timing,run:async()=>({status:0,stdout:'state = waiting'}),checkSockets:()=>{socketsChecked++;return true;}}),error=>{assert.equal(error.message,'SETUP_SERVICE_STOP_UNCONFIRMED');assert.equal(error.serviceStopDiagnostics.attempts,10);return true;});assert.equal(timing.now(),1000);assert.equal(socketsChecked,0);});
test('unknown shutdown outcomes, other job absence and live ports block publication',async()=>{
 for(const result of [{status:113,stderr:'Permission denied'},{status:113,stderr:'Could not find service "unrelated"'},{status:null,code:'TIMEOUT'},{status:1,error:Error('EPERM'),stderr:`Could not find service "${labels[0]}"`},{status:113,stderr:`Could not find service "${labels[0]}" in domain for user gui: 999`},{status:113,stderr:`Could not find service "${labels[0]}" in domain for user gui: 504\nPermission denied`}])await assert.rejects(stopManagedServices({...opts,...clock(),run:async(file,args)=>args[0]==='bootout'?{status:0}:result}),/SETUP_SERVICE_STOP_UNCONFIRMED/);
 await assert.rejects(stopManagedServices({...opts,...clock(),run:stoppedRun,probePort:async()=>true}),/COMPUTE_PROFILE_STILL_RUNNING/);
});
test('transiently open ports are retried, but socket inspection waits for all ports to close',async()=>{const timing=clock();let socketsChecked=0;await stopManagedServices({...opts,...timing,run:stoppedRun,probePort:async()=>timing.now()<300,checkSockets:()=>{socketsChecked++;assert.equal(timing.now(),300);return true;}});assert.equal(socketsChecked,1);});
test('recognized socket disappearance is bounded and reported separately',async()=>{const timing=clock();await assert.rejects(stopManagedServices({...opts,...timing,run:stoppedRun,checkSockets:()=>false}),error=>{assert.equal(error.message,'SETUP_RUNTIME_SOCKET_STILL_PRESENT');assert.deepEqual(error.serviceStopDiagnostics.servicesAbsent,{compute:true,gateway:true});assert.deepEqual(error.serviceStopDiagnostics.portsClosed,{compute:true,gateway:true});assert.equal(error.serviceStopDiagnostics.socketsAbsent,false);return true;});assert.equal(timing.now(),1000);});
test('unsafe socket ownership, permissions, type and symlink failures are not retried or hidden',async()=>{for(const code of ['PUBLIC_BROWSER_SOCKET_PERMISSIONS','PUBLIC_BROWSER_SOCKET_EXISTS','PUBLIC_BROWSER_SOCKET_SYMLINK','PUBLIC_BROWSER_SOCKET_INVALID','PUBLIC_BROWSER_SOCKET_CHANGED']){let checked=0;await assert.rejects(stopManagedServices({...opts,...clock(),run:stoppedRun,checkSockets:()=>{checked++;throw Error(code);}}),error=>{assert.equal(error.message,code);assert.equal(error.serviceStopDiagnostics.failureCode,code);return true;});assert.equal(checked,1);}});
test('cancelled repair does not unload any service and records cancellation',async()=>{let calls=0,report;await assert.rejects(stopManagedServices({...opts,signal:AbortSignal.abort(),run:async()=>{calls++;},onDiagnostics:value=>{report=value;}}),/SETUP_CANCELLED/);assert.equal(calls,0);assert.equal(report.failureCode,'SETUP_CANCELLED');});
test('cancellation during bounded waiting prevents successful stop acceptance',async()=>{const controller=new AbortController(),timing=clock();let socketsChecked=0;await assert.rejects(stopManagedServices({...opts,...timing,signal:controller.signal,run:stoppedRun,probePort:async()=>true,sleep:async ms=>{timing.advance(ms);controller.abort();},checkSockets:()=>{socketsChecked++;return true;}}),/SETUP_CANCELLED/);assert.equal(socketsChecked,0);});
test('a hung launchctl call is bounded and both labels are attempted when time remains',async()=>{const calls=[];await assert.rejects(stopManagedServices({...opts,timeoutMs:100,requestTimeoutMs:10,run:async(file,args)=>{calls.push(args);if(args[0]==='bootout'&&args[1].includes('montreal'))return {status:null,code:'TIMEOUT'};return {status:0};}}),/SETUP_SERVICE_STOP_UNCONFIRMED/);assert.equal(calls.length,2);});
test('a genuinely hung port probe is bounded even with an injected nonadvancing clock',async()=>{const started=performance.now();await assert.rejects(stopManagedServices({...opts,timeoutMs:100,requestTimeoutMs:10,now:()=>0,run:stoppedRun,probePort:()=>new Promise(()=>{})}),/COMPUTE_PROFILE_STILL_RUNNING/);assert(performance.now()-started<500);});
test('late successful probes cannot be accepted beyond the deadline',async()=>{const timing=clock(100);await assert.rejects(stopManagedServices({...opts,...timing,run:stoppedRun,probePort:async()=>{timing.advance(101);return false;}}),/COMPUTE_PROFILE_STILL_RUNNING|SETUP_RUNTIME_SOCKET_STILL_PRESENT/);});
test('service and role-port identity cannot be widened or duplicated',async()=>{for(const changed of [{labels:[labels[0],labels[0]]},{labels:[labels[0],'ai.openclaw.agi-node-compute']},{ports:[18894,18894]},{ports:[18894,1]}])await assert.rejects(stopManagedServices({...opts,...changed,run:stoppedRun}),/SETUP_SERVICE_IDENTITY/);});
test('Node service identity uses only the Node job and port pair',async()=>{const nodeLabels=['ai.montreal.agi-node-compute','ai.openclaw.agi-node-compute'];assert.equal(await stopManagedServices({...opts,labels:nodeLabels,ports:[18898,18900],run:stoppedRun}),true);});
test('nonboolean probes and invalid bounded options fail closed',async()=>{for(const changed of [{timeoutMs:0},{pollIntervalMs:Infinity},{requestTimeoutMs:120001},{now:()=>NaN}])await assert.rejects(stopManagedServices({...opts,...changed,run:stoppedRun}),/SETUP_SERVICE_STOP_OPTIONS/);await assert.rejects(stopManagedServices({...opts,...clock(),run:stoppedRun,probePort:()=>undefined}),/SETUP_SERVICE_STOP_UNCONFIRMED/);await assert.rejects(stopManagedServices({...opts,...clock(),run:stoppedRun,checkSockets:()=>undefined}),/SETUP_SERVICE_STOP_UNCONFIRMED/);});
test('diagnostics are allowlisted and reporting errors cannot replace primary failures',async()=>{
 const reports=[];await stopManagedServices({...opts,...clock(),run:stoppedRun,onDiagnostics:value=>{reports.push(value);value.state='tampered';throw Error('ignored');}});assert.equal(reports.length,1);
 await assert.rejects(stopManagedServices({...opts,...clock(),run:stoppedRun,checkSockets:()=>{throw Error('PUBLIC_BROWSER_SOCKET_SYMLINK');},onDiagnostics:()=>{throw Error('REPORT_SECRET');}}),/PUBLIC_BROWSER_SOCKET_SYMLINK/);
 const safe=safeServiceStopDiagnostics({schema:'agi-service-stop/v1',state:'failed',failureCode:'SECRET',stdout:'PRIVATE_SECRET',socketPath:'/Users/private/secret',elapsedMs:-1,attempts:3,servicesAbsent:{compute:true,gateway:'true'}});assert.equal(safe.failureCode,null);assert.equal(safe.elapsedMs,0);assert.deepEqual(safe.servicesAbsent,{compute:true,gateway:false});assert(!JSON.stringify(safe).includes('SECRET'));assert.equal(safeServiceStopDiagnostics({schema:'other'}),null);
});
test('a real Unix socket remains outside the profile and its delayed close is awaited',async t=>{
 const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-stop-')),socketPath=publicBrowserRuntimeSocketPath(profileDir),directory=ensurePublicBrowserRuntimeDirectory({profileDir,socketPath});fs.chmodSync(profileDir,0o700);const server=net.createServer();let closed=false;
 t.after(async()=>{if(!closed)await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(profileDir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});fs.chmodSync(socketPath,0o600);
 const timing=clock(),diagnostics={};await stopManagedServices({...opts,...timing,diagnostics,run:stoppedRun,checkSockets:()=>!inspectPublicBrowserSocket(socketPath,{profileDir}).exists,sleep:async ms=>{timing.advance(ms);if(timing.now()>=300&&!closed){await new Promise(resolve=>server.close(resolve));closed=true;}}});assert.equal(timing.now(),300);assert.equal(diagnostics.attempts,4);assert.equal(closed,true);assert.equal(fs.existsSync(socketPath),false);assert.deepEqual(fs.readdirSync(profileDir),[]);
});

test('physical Mac status 113 with Bad request prefix proves exact Agent jobs absent before port and socket checks',async()=>{
 const physical={
  'ai.montreal.agi-compute':'Bad request.\nCould not find service "ai.montreal.agi-compute" in domain for user gui: 504\n',
  'ai.openclaw.agi-compute':'Bad request.\nCould not find service "ai.openclaw.agi-compute" in domain for user gui: 504\n'
 },events=[],diagnostics={};
 await stopManagedServices({...opts,...clock(),diagnostics,run:async(_file,args)=>{events.push(args[0]);return args[0]==='print'?{status:113,stderr:physical[args[1].split('/').at(-1)]}:{status:5};},probePort:async port=>{events.push(port);return false;},checkSockets:()=>{events.push('sockets');return true;}});
 assert.deepEqual(events,['bootout','bootout','print','print',18894,18896,'sockets']);
 for(const role of ['compute','gateway'])assert.deepEqual(diagnostics.launchctlPrint[role],{attempt:1,status:113,classification:'absent',badRequestPrefix:true});
 assert.equal(diagnostics.state,'passed');assert.deepEqual(diagnostics.portsClosed,{compute:true,gateway:true});assert.equal(diagnostics.socketsAbsent,true);
});
test('physical Mac unloaded output proves only exact Node jobs and ports absent',async()=>{
 const physical={
  'ai.montreal.agi-node-compute':'Bad request.\nCould not find service "ai.montreal.agi-node-compute" in domain for user gui: 504\n',
  'ai.openclaw.agi-node-compute':'Bad request.\nCould not find service "ai.openclaw.agi-node-compute" in domain for user gui: 504\n'
 },diagnostics={},probed=[];
 await stopManagedServices({...opts,...clock(),labels:['ai.montreal.agi-node-compute','ai.openclaw.agi-node-compute'],ports:[18898,18900],diagnostics,run:async(_file,args)=>args[0]==='print'?{status:113,stderr:physical[args[1].split('/').at(-1)]}:{status:0},probePort:async port=>{probed.push(port);return false;}});
 assert.deepEqual(probed,[18898,18900]);for(const role of ['compute','gateway'])assert.deepEqual(diagnostics.launchctlPrint[role],{attempt:1,status:113,classification:'absent',badRequestPrefix:true});
});
test('absence parsing permits exact lines with CRLF, empty lines and stdout or split streams',async()=>{
 const layouts=[line=>({stderr:`\r\nBad request.\r\n${line}\r\n\r\n`}),line=>({stdout:`Bad request.\n${line}\n`}),line=>({stderr:'Bad request.\n',stdout:`${line}\n`}),line=>({stderr:`${line}\n`})];
 for(const layout of layouts){const diagnostics={};await stopManagedServices({...opts,...clock(),diagnostics,run:async(_file,args)=>args[0]==='print'?{status:113,...layout(absent(args).stderr)}:{status:0}});assert.equal(diagnostics.launchctlPrint.compute.classification,'absent');}
});
test('ambiguous, unrelated, contradictory or unauthorized print output cannot prove absence',async()=>{
 const exact=`Could not find service "${labels[0]}" in domain for user gui: 504`;
 const cases=[
  {status:113,stderr:`Bad request.\n${exact.replace('agi-compute','agi-node-compute')}`},
  {status:113,stderr:`Bad request.\n${exact.replace('504','505')}`},
  {status:113,stderr:`Bad request.\n${exact.replace('gui:','user:')}`},
  {status:113,stderr:`Bad request.\n${exact}\nPermission denied`},
  {status:113,stderr:`Bad request.\n${exact}`,stdout:'Operation not permitted'},
  {status:113,stderr:`Bad request.\n${exact}\nstate = running`},
  {status:113,stderr:`Bad request.\n${exact}\n${exact}`},
  {status:113,stderr:`Bad request.\nBad request.\n${exact}`},
  {status:113,stderr:`${exact}\nBad request.`},
  {status:113,stderr:exact,stdout:'Bad request.'},
  {status:113,stderr:`Bad request.\n ${exact}`},
  {status:113,stderr:`Bad request.\n${exact} `},
  {status:113,stderr:`Bad request. \n${exact}`},
  {status:113,stderr:`Bad request.\n${exact}\n\t`},
  {status:113,stderr:`Bad request.\n${exact}\u0000`},
  {status:113,stderr:'Bad request.'},
  {status:113,stdout:'state = running'},
  {status:0,stderr:`Bad request.\n${exact}`},
  {status:0,stderr:exact},
  {status:0,stderr:'Permission denied'},
  {status:0,stdout:'state = running',stderr:'Operation not permitted'}
 ];
 for(const result of cases){let ports=0,sockets=0;await assert.rejects(stopManagedServices({...opts,...clock(),run:async(_file,args)=>args[0]==='print'?result:{status:0},probePort:()=>{ports++;return false;},checkSockets:()=>{sockets++;return true;}}),error=>{assert.equal(error.message,'SETUP_SERVICE_STOP_UNCONFIRMED');assert.equal(error.serviceStopDiagnostics.launchctlPrint.compute.classification,'rejected');assert.equal(error.serviceStopDiagnostics.launchctlPrint.compute.status,result.status);assert.equal(error.serviceStopDiagnostics.launchctlPrint.gateway,null);assert.equal(error.serviceStopDiagnostics.attempts,1);return true;});assert.equal(ports,0);assert.equal(sockets,0);}
});
test('malformed print results are diagnosed before refusal without retaining arbitrary data',async()=>{
 const exact=`Could not find service "${labels[0]}" in domain for user gui: 504`;
 for(const result of [undefined,{status:null,code:'TIMEOUT',stderr:'PRIVATE_SECRET'},{status:-1,stderr:exact},{status:256,stderr:exact},{status:113,error:Error('PRIVATE_SECRET'),stderr:exact},{status:113,signal:'SIGTERM',stderr:exact},{status:113,code:'UNKNOWN',stderr:exact},{status:113,stderr:{toString:()=>exact}}]){
  await assert.rejects(stopManagedServices({...opts,...clock(),run:async(_file,args)=>args[0]==='print'?result:{status:0}}),error=>{assert.equal(error.message,'SETUP_SERVICE_STOP_UNCONFIRMED');assert.equal(error.serviceStopDiagnostics.launchctlPrint.compute.classification,'invalid-result');assert(!JSON.stringify(error.serviceStopDiagnostics).includes('PRIVATE_SECRET'));return true;});
 }
});
test('bounded loaded-to-absent transition records the last print outcome for each exact job',async()=>{
 const timing=clock(),diagnostics={},reports=[];await stopManagedServices({...opts,...timing,diagnostics,onDiagnostics:value=>reports.push(value),run:async(_file,args)=>args[0]==='bootout'?{status:0}:timing.now()<200?{status:0,stdout:'state = stopping'}:{status:113,stderr:`Bad request.\n${absent(args).stderr}`}});
 assert.equal(diagnostics.attempts,3);assert.equal(timing.now(),200);assert.equal(reports.length,1);for(const role of ['compute','gateway'])assert.deepEqual(reports[0].launchctlPrint[role],{attempt:3,status:113,classification:'absent',badRequestPrefix:true});
});
test('rejected or timed-out print commands retain a sanitized command-failed observation',async()=>{
 for(const print of [()=>Promise.reject(Error('PRIVATE_SECRET')),()=>new Promise(()=>{})])await assert.rejects(stopManagedServices({...opts,timeoutMs:100,requestTimeoutMs:10,run:async(_file,args)=>args[0]==='print'?print():{status:0}}),error=>{assert.equal(error.message,'SETUP_SERVICE_STOP_UNCONFIRMED');assert.deepEqual(error.serviceStopDiagnostics.launchctlPrint.compute,{attempt:1,status:null,classification:'command-failed',badRequestPrefix:false});assert.equal(error.serviceStopDiagnostics.launchctlPrint.gateway,null);assert(!JSON.stringify(error.serviceStopDiagnostics).includes('PRIVATE_SECRET'));return true;});
});
test('print evidence sanitizer preserves only bounded scalars and remains compatible with old reports',()=>{
 const legacy=safeServiceStopDiagnostics({schema:'agi-service-stop/v1',state:'passed'});assert.deepEqual(legacy.launchctlPrint,{compute:null,gateway:null});
 const report=safeServiceStopDiagnostics({schema:'agi-service-stop/v1',state:'failed',launchctlPrint:{compute:{attempt:1,status:113,classification:'rejected',badRequestPrefix:true,stderr:'PRIVATE_SECRET',label:'SECRET_LABEL'},gateway:{attempt:1,status:-1,classification:'command-failed',badRequestPrefix:'true',stdout:'SECRET'}}});
 assert.deepEqual(report.launchctlPrint,{compute:{attempt:1,status:113,classification:'rejected',badRequestPrefix:true},gateway:null});assert(!JSON.stringify(report).includes('SECRET'));
 for(const invalid of [{attempt:0,status:113,classification:'absent'},{attempt:1,status:113,classification:'PRIVATE_SECRET'}])assert.equal(safeServiceStopDiagnostics({schema:'agi-service-stop/v1',launchctlPrint:{compute:invalid}}).launchctlPrint.compute,null);
});
