// Read-only qualification driver. Its candidate path is supplied only by the
// independently reconstructing harness, never by LocalRuntime task dispatch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ROOT,need,digest} from '../../contracts.mjs';
import {runAlphaPhase,exerciseAlphaSequence,exerciseAlphaTransport} from '../ipc.mjs';
import {alphaAdapterIdentity,ALPHA_SOURCE_COMMIT,inspectAlphaPackage} from '../package.mjs';
import {validateManifest,verifyTree} from '../trust.mjs';
import {LocalRuntime} from '../../supervisor/runtime.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const [mode,candidate,rootfs,selector]=process.argv.slice(2);
need(process.argv.length===6&&['sequence','grant','grant-stop','refusal','probe'].includes(mode),'QUALIFICATION_ARGUMENTS');
const raw=fs.readFileSync(path.join(candidate,'manifest.json')),manifest=JSON.parse(raw);
const validated=validateManifest(raw,{...manifest,manifestBytes:raw.length,manifestSha256:digest(raw)});
let verificationCalls=0,verificationMilliseconds=0;
const verify=()=>{const start=performance.now();const current=fs.readFileSync(path.join(candidate,'manifest.json'));need(digest(current)===digest(raw),'QUALIFICATION_MANIFEST_CHANGED');validateManifest(current,{...manifest,manifestBytes:raw.length,manifestSha256:digest(raw)});verifyTree(rootfs,validated,{rootOwner:false});alphaAdapterIdentity();verificationCalls++;verificationMilliseconds+=performance.now()-start;};verify();
need(inspectAlphaPackage().code==='ALPHA_PACKAGE_UNPROVISIONED','PRODUCTION_TRUST_MUST_REMAIN_NULL');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const fixture=JSON.parse(fs.readFileSync(path.join(ROOT,'local-runtime/tests/fixtures/alpha-contract.json')));
const caseValue=fixture.cases.find(c=>c.kind===selector);
const evidence={nativeTransport:true,productionAdmissionQualified:false,productionProvisioningQualified:false,productionTrustTargets:'UNPROVISIONED',adapterSha256:alphaAdapterIdentity(),archiveSha256:manifest.archiveSha256};
async function sequence(input,signal,revalidate,{grant=false}={}){
  verify(); // Match the production dispatch's initial full package check.
  return exerciseAlphaSequence({input,signal,revalidate:async()=>{await revalidate();for(let i=0;i<(grant?3:4);i++)verify();}},options=>runAlphaPhase({...options,rootfs}),{evidenceClass:'NATIVE_CANDIDATE_IPC; no production admission'});
}
async function probeTransport(selector,externalSignal,onProbe){
  const controller=new AbortController(),hostNamespaces=Object.fromEntries(['pid','net','mnt','ipc','uts'].map(n=>[n,Number(fs.readlinkSync('/proc/self/ns/'+n).match(/\[(\d+)\]/)[1])]));
    let probeSeen=false,buffer='',child;
    const spawnProbe=(executable,args,options)=>{
      // Preserve the production transport and all its limits. Replace only the
      // fixed launcher with this reviewed test-only read-only probe mount.
      need(executable==='/usr/bin/prlimit'&&args.at(-1)==='/opt/alpha/launch-work.py','QUALIFICATION_COMMAND_CHANGED');
      const boundary=args.indexOf('--',args.indexOf('/usr/bin/bwrap')+1);need(boundary>0,'QUALIFICATION_COMMAND_CHANGED');
      const changed=[...args.slice(0,boundary),'--ro-bind',path.join(HERE,'probe.py'),'/tmp/alpha-ipc-probe.py',...args.slice(boundary,-1),'/tmp/alpha-ipc-probe.py',selector];
      child=spawn(executable,changed,options);
      if(selector==='cancel-after-exit')child.once('exit',()=>queueMicrotask(()=>controller.abort()));
      child.stdout.on('data',b=>{
        if(probeSeen)return;buffer+=b.toString('utf8');const end=buffer.indexOf('\n');if(end<0)return;
        const observation=JSON.parse(buffer.slice(0,end));need(observation.probe===selector,'QUALIFICATION_PROBE_INVALID');probeSeen=true;emit({kind:'probe',observation});
        if(onProbe)setTimeout(onProbe,100);else if(selector==='cancel')setTimeout(()=>controller.abort(),100);
        if(selector==='launcher-death')setTimeout(()=>child.kill('SIGKILL'),100);
      });return child;
    };
  try{
    const result=await exerciseAlphaTransport({rootfs,phase:'work',stdin:Buffer.alloc(0),outputLimit:4096,deadline:performance.now()+(selector==='timeout'?1500:15000),signal:externalSignal??controller.signal},{spawn:spawnProbe,kill:process.kill,now:()=>performance.now(),namespaceIds:()=>hostNamespaces,evidenceClass:'NATIVE_ADVERSARIAL_TRANSPORT_PROBE'});
    return {ok:true,probeSeen,observation:result.observation};
  }catch(error){return {ok:false,probeSeen,code:error.code||error.message,observation:error.observation??null};}
}

try{
  if(mode==='sequence'){
    need(caseValue,'QUALIFICATION_CASE_INVALID');const result=await sequence({workSpec:caseValue.workSpec},undefined,()=>{});
    need(result.result.alphaOutput===caseValue.alphaOutput&&result.result.alphaValidation===caseValue.alphaValidation,'QUALIFICATION_PARITY_FAILED');
    emit({kind:'result',ok:true,...evidence,observation:result.observation,verificationCalls,verificationMilliseconds,outputSha256:digest(result.result.alphaOutput),validationSha256:digest(result.result.alphaValidation)});
  }else if(mode==='grant'){
    need(caseValue,'QUALIFICATION_CASE_INVALID');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-grant-'));
    let runtime;
    try{
      const backend={inspect:()=>{verify();return {supported:true,backend:'synthetic-authority-native-alpha',identity:'synthetic-qualification-host',bootId:'synthetic-qualification-boot',alphaRun:{supported:true,sourceCommit:ALPHA_SOURCE_COMMIT,packageSha256:'synthetic-qualification-'+manifest.archiveSha256,trustLockSha256:'synthetic-qualification'}};},execute:args=>sequence(args.task.input,args.signal,args.revalidate,{grant:true})};
      runtime=new LocalRuntime(directory,{create:true,backend});const principal=runtime.issueClient().principal;
      const a=runtime.addActor({role:'agent',name:'Disposable native qualification'},principal);runtime.activate({actor:a.id,confirm:true},principal);
      const task={schema:'agi-fleet/local-task/v1',action:'alpha-run',workspace:'files',input:{workSpec:caseValue.workSpec},review:'none',sourceActor:null,sourceController:null};
      const g=runtime.prepare({actor:a.id,task},principal);runtime.authorize({grant:g.grant,commitment:g.commitment,confirm:true},principal);
      const runStarted=performance.now(),callsBefore=verificationCalls,timeBefore=verificationMilliseconds;
      const result=await runtime.run({actor:a.id,grant:g.grant},principal);const grantWallMilliseconds=performance.now()-runStarted,grantVerificationCalls=verificationCalls-callsBefore,grantVerificationMilliseconds=verificationMilliseconds-timeBefore;need(result.state==='complete'&&result.receipt.result.files[0].content===caseValue.alphaOutput,'QUALIFICATION_GRANT_FAILED');
      let replay=false;try{await runtime.run({actor:a.id,grant:g.grant},principal);}catch(e){replay=e.code==='GRANT_UNAVAILABLE';}need(replay,'QUALIFICATION_REPLAY_ALLOWED');
      emit({kind:'result',ok:true,...evidence,grantAuthority:'SYNTHETIC_ISOLATED_QUALIFICATION_ONLY',oneUseGrant:true,receiptChecked:true,grantWallMilliseconds,grantVerificationCalls,grantVerificationMilliseconds,observation:result.receipt.observation});
    }finally{runtime?.close();fs.rmSync(directory,{recursive:true,force:true});}
  }else if(mode==='refusal'){
    const match=/^(invalid-json|invalid-utf8|duplicate-key|wrong-market|wrong-executor|code-kind|nonfinite)-(validate|work)$/.exec(selector);need(match,'QUALIFICATION_REFUSAL_INVALID');
    const valid=JSON.parse(fixture.cases[0].workSpec),values={
      'invalid-json':Buffer.from('{'),'invalid-utf8':Buffer.from([255]),'duplicate-key':Buffer.from('{"schema":"first","schema":"second"}'),
      'wrong-market':Buffer.from(JSON.stringify({...valid,market:'manager-usdc'})),
      'wrong-executor':Buffer.from(JSON.stringify({...valid,executor:'shell'})),
      'code-kind':Buffer.from(JSON.stringify({...valid,mission:{goal:'Refuse code',work:{kind:'coding',code:'print(1)'}}})),
      'nonfinite':Buffer.from('{"value":NaN}'),
    };
    try{const result=await runAlphaPhase({rootfs,phase:match[2],stdin:values[match[1]],outputLimit:4096,deadline:performance.now()+15000});emit({kind:'result',ok:true,...evidence,observation:result.observation});}
    catch(error){emit({kind:'result',ok:false,...evidence,code:error.code||error.message,observation:error.observation??null});}
  }else if(mode==='grant-stop'){
    need(caseValue,'QUALIFICATION_CASE_INVALID');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-stop-'));
    let runtime,principal,actor,transportResult;
    try{
      const backend={inspect:()=>{verify();return {supported:true,backend:'synthetic-authority-native-alpha',identity:'synthetic-qualification-host',alphaRun:{supported:true,sourceCommit:ALPHA_SOURCE_COMMIT,packageSha256:'synthetic-qualification-'+manifest.archiveSha256,trustLockSha256:'synthetic-qualification'}};},execute:async args=>{
        await args.revalidate();verify();transportResult=await probeTransport('cancel',args.signal,()=>runtime.stop({actor:actor.id},principal));
        throw Object.assign(Error(transportResult.code||'QUALIFICATION_STOP_FAILED'),{code:transportResult.code,observation:transportResult.observation});
      }};
      runtime=new LocalRuntime(directory,{create:true,backend});principal=runtime.issueClient().principal;
      actor=runtime.addActor({role:'agent',name:'Disposable STOP qualification'},principal);runtime.activate({actor:actor.id,confirm:true},principal);
      const task={schema:'agi-fleet/local-task/v1',action:'alpha-run',workspace:'files',input:{workSpec:caseValue.workSpec},review:'none',sourceActor:null,sourceController:null};
      const grant=runtime.prepare({actor:actor.id,task},principal);runtime.authorize({grant:grant.grant,commitment:grant.commitment,confirm:true},principal);
      let refused=false;try{await runtime.run({actor:actor.id,grant:grant.grant},principal);}catch(error){refused=error.code==='RUN_CANCELLED';}
      need(refused&&runtime.store.meta('stopped')&&runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grant.grant).state==='consumed','QUALIFICATION_STOP_FAILED');
      need(runtime.status(principal).runs[0].state==='uncertain','QUALIFICATION_STOP_FAILED');
      emit({kind:'result',...evidence,...transportResult,grantAuthority:'SYNTHETIC_ISOLATED_QUALIFICATION_ONLY',stopRecorded:true,grantConsumed:true,runUncertain:true});
    }finally{runtime?.close();fs.rmSync(directory,{recursive:true,force:true});}
  }else{
    need(['isolation','detached-exit','cancel','cancel-after-exit','timeout','launcher-death','cpu','output'].includes(selector),'QUALIFICATION_PROBE_INVALID');
    emit({kind:'result',...evidence,...await probeTransport(selector)});
  }
}catch(error){emit({kind:'result',ok:false,...evidence,code:error.code||error.message,observation:error.observation??null});process.exitCode=1;}
