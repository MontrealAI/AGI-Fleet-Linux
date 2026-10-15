// Inactive test runner. Real unchanged LinuxSandbox/LocalRuntime only.
// Run only after separately approved root provisioning on a disposable runner.
// External cancellation observes a genuine native phase; no spawn/backend shim.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import readline from 'node:readline';
import crypto from 'node:crypto';
import {interpreterIdentity,verifyCancellationTarget,requireCancelledReceipt} from './cancellation.mjs';
const [checkout,state,mode,kind]=process.argv.slice(2);
if(process.argv.length!==6||!['work','stop','revoke-grant','revoke-client','refusals','drift-prepare','drift-check'].includes(mode))throw Error('ACTUAL_ARGUMENTS');
if(process.getuid?.()===0)throw Error('ACTUAL_MUST_BE_NONROOT');
const importAt=relative=>import(pathToFileURL(path.join(checkout,relative)).href);
const {need,digest,canonical}=await importAt('local-runtime/contracts.mjs');
const {readReviewedAlphaTarget,requireAlphaRuntime}=await importAt('local-runtime/alpha/package.mjs');
const {LinuxSandbox}=await importAt('local-runtime/platforms/linux.mjs');
const {LocalRuntime}=await importAt('local-runtime/supervisor/runtime.mjs');
const {evaluateAdmission}=await importAt('local-runtime/supervisor/admission.mjs');
const {validateTarget,validateManifest,validateQualification}=await importAt('local-runtime/alpha/trust.mjs');
const {decodePinnedArchive}=await importAt('local-runtime/alpha/archive.mjs');
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const cases=JSON.parse(fs.readFileSync(path.join(checkout,'local-runtime/tests/fixtures/alpha-contract.json'))).cases;
const example=cases.find(c=>c.kind===kind);need(example,'ACTUAL_CASE');
const installed=requireAlphaRuntime(),trusted=readReviewedAlphaTarget();
need(installed.directory===path.join('/opt/agi-fleet-alpha','linux-'+process.arch,trusted.target.archiveSha256),'ACTUAL_FIXED_LOCATION');
const evidence={authority:'ISOLATED_TEST_LOCK_FROM_NATIVE_CANDIDATE_EVIDENCE; NEVER_PRODUCTION_APPROVAL',productionQualified:false,settlementAuthority:false,nativeBackend:true,fixedInstallation:installed.directory,runtimeIdentity:installed.runtimeIdentity,adapterSha256:installed.adapterSha256,fixtureLockSha256:installed.trustLockSha256};
let runtime,reader;
const expectCode=(fn,allowed)=>{try{fn();}catch(e){need(allowed.includes(e.code||e.message),'ACTUAL_WRONG_REFUSAL_'+(e.code||e.message));return e.code||e.message;}throw Error('ACTUAL_REFUSAL_MISSING');};
const taskOf=workSpec=>({schema:'agi-fleet/local-task/v1',action:'alpha-run',workspace:'files',input:{workSpec},review:'none',sourceActor:null,sourceController:null});
const task=taskOf(example.workSpec);
try{
  runtime=new LocalRuntime(state,{create:mode!=='drift-check'});
  need(runtime.backend instanceof LinuxSandbox,'ACTUAL_BACKEND_SUBSTITUTED');
  if(mode==='drift-check'){
    const saved=JSON.parse(fs.readFileSync(path.join(state,'drift.json'))),principal=runtime.authenticate(saved.token);
    const report=runtime.admission({actor:saved.actor,task},principal);
    need(report.status!=='SUPPORTABLE'&&report.issues.some(i=>['ALPHA_RUNTIME_REBIND_REQUIRED','RUNTIME_REBIND_REQUIRED','HOST_REBIND_REQUIRED'].includes(i.code)),'ACTUAL_DRIFT_ADMISSION_ALLOWED');
    const code=expectCode(()=>runtime.authorize({grant:saved.grant,commitment:saved.commitment,confirm:true},principal),['RUNTIME_REBIND_REQUIRED','HOST_REBIND_REQUIRED','ALPHA_RUNTIME_REBIND_REQUIRED']);
    need(runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(saved.grant).state==='prepared','ACTUAL_DRIFT_CONSUMED_GRANT');
    emit({kind:'result',ok:true,...evidence,mode,code,priorActivationRejected:true,priorPreparedGrantRejected:true,grantRestored:false});
  }else{
    const operator=runtime.issueClient(),principal=operator.principal;
    const doctor=runtime.doctor();need(doctor.supported&&doctor.alphaRun.supported&&doctor.alphaRun.runtimeIdentity===installed.runtimeIdentity,'ACTUAL_DOCTOR_BLOCKED_'+doctor.code);
    const actor=runtime.addActor({role:'agent',name:'Disposable fixed-path test'},principal);
    need(actor.active===false&&actor.host===null&&actor.generation===0&&runtime.status(principal).pending.length===0,'ACTUAL_INITIAL_AUTHORITY');
    const inactive=runtime.admission({actor:actor.id,task},principal);need(inactive.status!=='SUPPORTABLE'&&inactive.issues.some(i=>i.code==='ACTIVATION_REQUIRED'),'ACTUAL_INACTIVE_ADMISSION');
    expectCode(()=>runtime.activate({actor:actor.id,confirm:false},principal),['CONFIRM_REQUIRED']);
    runtime.activate({actor:actor.id,confirm:true},principal);
    const preview=runtime.admission({actor:actor.id,task},principal);
    need(preview.status==='SUPPORTABLE'&&preview.qualification.productionQualified===false&&preview.binding.alpha.evidenceClass==='REVIEWED_NATIVE_PACKAGE','ACTUAL_NATIVE_ADMISSION');
    if(mode==='refusals'){
      const refusals=[];
      // Reuse unchanged production validators against memory-only bad inputs.
      // Never mutate the root-owned installation or claim these are root writes.
      const record=trusted.target,manifestRaw=fs.readFileSync(path.join(installed.directory,'manifest.json')),qualificationRaw=fs.readFileSync(path.join(installed.directory,'qualification.json'));
      const validated=validateManifest(manifestRaw,record);
      const trustRefusals=[
        expectCode(()=>validateTarget(record,record.target,'f'.repeat(40),installed.adapterSha256),['ALPHA_TRUST_TARGET_INVALID']),
        expectCode(()=>validateTarget(record,record.target,record.sourceCommit,'f'.repeat(64)),['ALPHA_ADAPTER_REQUALIFICATION_REQUIRED']),
        expectCode(()=>validateManifest(Buffer.concat([manifestRaw,Buffer.from(' ')]),record),['ALPHA_MANIFEST_CHANGED']),
        expectCode(()=>validateQualification(Buffer.concat([qualificationRaw,Buffer.from(' ')]),record),['ALPHA_QUALIFICATION_CHANGED']),
        expectCode(()=>decodePinnedArchive(Buffer.from('SYNTHETIC_INVALID_ARCHIVE_NEVER_EXECUTED'),record,validated),['ALPHA_ARCHIVE_CHANGED']),
      ];
      const other=runtime.addActor({role:'node',name:'Role refusal fixture'},principal);runtime.activate({actor:other.id,confirm:true},principal);
      refusals.push(expectCode(()=>runtime.prepare({actor:other.id,task},principal),['ROLE_ACTION_DENIED']));
      const oversized=JSON.parse(example.workSpec);oversized.mission={goal:'Refuse predictable expansion',work:{kind:'research',sources:Array.from({length:8},(_,i)=>({id:'source-'+i,title:'Supplied control text',text:('\\\n').repeat(5000)}))}};
      for(const [spec,code] of [['{','JSON_INVALID'],[JSON.stringify({...JSON.parse(example.workSpec),market:'manager-usdc'}),'ALPHA_MARKET_DENIED'],[JSON.stringify(oversized),'ALPHA_OUTPUT_BUDGET_EXCEEDED']]){
        const report=runtime.admission({actor:actor.id,task:taskOf(spec)},principal);
        need(report.status!=='SUPPORTABLE'&&report.issues.length>0,'ACTUAL_INPUT_REFUSAL');
        if(code!=='JSON_INVALID')need(report.issues.some(i=>i.code===code),'ACTUAL_WRONG_INPUT_REFUSAL');
        refusals.push(report.issues.map(i=>i.code));
      }
      const current=runtime.store.actor(actor.id),forged=structuredClone(doctor);forged.alphaRun.runtimeIdentity='f'.repeat(64);
      const forgedReport=evaluateAdmission({actor:current,task,host:forged,source:runtime.source,currentSource:runtime.source,hostId:runtime.store.meta('host'),at:Date.now(),paused:false,stopped:false,nativeBackend:true});
      need(forgedReport.status!=='SUPPORTABLE'&&forgedReport.issues.some(i=>i.code==='ALPHA_RUNTIME_REBIND_REQUIRED'),'ACTUAL_FORGED_HOST_ACCEPTED');
      need(runtime.status(principal).runs.length===0&&runtime.status(principal).pending.length===0,'ACTUAL_REFUSAL_RESERVED_AUTHORITY');
      emit({kind:'result',ok:true,...evidence,mode,refusals,trustRefusals,trustRefusalScope:'unchanged production validators; memory-only invalid bytes; no privileged installation attempt',forgedHostRejected:true,launchAttempted:false});
    }else{
      const scoped=mode==='revoke-client'?runtime.issueClient(actor.id):operator;
      const grant=runtime.prepare({actor:actor.id,task},scoped.principal);
      need(grant.confirmationRequired&&runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grant.grant).state==='prepared','ACTUAL_GRANT_NOT_PREPARED');
      expectCode(()=>runtime.authorize({grant:grant.grant,commitment:grant.commitment,confirm:false},principal),['CONFIRM_REQUIRED']);
      if(mode==='drift-prepare'){
        fs.writeFileSync(path.join(state,'drift.json'),JSON.stringify({token:operator.token,actor:actor.id,grant:grant.grant,commitment:grant.commitment}),{flag:'wx',mode:0o600});
        emit({kind:'result',ok:true,...evidence,mode,grantState:'prepared'});
      }else{
        runtime.authorize({grant:grant.grant,commitment:grant.commitment,confirm:true},principal);
        let cancellationApplied=false,cancellationRequest=null,cancellationFailure=null;
        const nonce=crypto.randomBytes(32).toString('hex'),interpreter=interpreterIdentity(path.join(installed.rootfs,'opt/alpha/python/bin/python3.12'));
        reader=readline.createInterface({input:process.stdin,terminal:false});
        reader.on('line',line=>{
          if(mode==='work'||cancellationApplied||cancellationFailure)return;
          try{
            need(Buffer.byteLength(line)<=4096,'CANCEL_REQUEST_SIZE');
            const request=JSON.parse(line);
            need(runtime.active.size===1,'CANCEL_NO_ACTIVE_RUN');
            cancellationRequest=verifyCancellationTarget(request,{driverPid:process.pid,interpreter,nonce});
            if(mode==='stop')runtime.stop({actor:actor.id},principal);
            else if(mode==='revoke-grant')runtime.revoke({grant:grant.grant},principal);
            else if(mode==='revoke-client')runtime.revokeClient({client:scoped.principal.hash},principal);
            cancellationApplied=true;
          }catch(error){cancellationFailure=error.code||error.message;}
        });
        emit({kind:'armed',mode,nonce});
        const started=performance.now();let result,error;
        try{result=await runtime.run({actor:actor.id,grant:grant.grant},scoped.principal);}catch(e){error=e;}
        const grantWallMilliseconds=performance.now()-started;
        if(mode==='work'){
          need(!error&&result?.state==='complete','ACTUAL_GRANT_FAILED_'+(error?.code??''));
          const receipt=result.receipt,output=runtime.output({actor:actor.id,run:result.run},principal);
          need(receipt.result.files[0].content===example.alphaOutput&&receipt.result.files[1].content===example.alphaValidation,'ACTUAL_RECEIPT_PARITY');
          need(receipt.outputSha256===digest(receipt.result)&&canonical(output.receipt)===canonical(receipt),'ACTUAL_RECEIPT_HASH');
          need(receipt.observation.runtimeIdentity===installed.runtimeIdentity&&receipt.observation.phases.length===2&&receipt.observation.providerCalls===0&&receipt.authority==='none','ACTUAL_RECEIPT_BOUNDARY');
          let replay=false;try{await runtime.run({actor:actor.id,grant:grant.grant},principal);}catch(e){replay=e.code==='GRANT_UNAVAILABLE';}need(replay,'ACTUAL_GRANT_REPLAY');
          emit({kind:'result',ok:true,...evidence,mode,case:kind,grantWallMilliseconds,receiptSha256:digest(receipt),outputSha256:receipt.outputSha256,receipt,oneUseGrant:true,initialAuthorityAbsent:true,doctorActivatePreviewAuthorizeObserved:true,timing:{scope:'unchanged actual runtime.run, all full checks and sandbox probes',staticExpectedFullTreeAdapterChecks:17,staticExpectedSandboxProbes:8,countsMeasured:false,syntheticComparatorFullChecks:15}});
        }else{
          need(!cancellationFailure,'ACTUAL_CANCELLATION_REJECTED_'+cancellationFailure);
          need(cancellationApplied&&error?.code==='RUN_CANCELLED','ACTUAL_CANCELLATION_NOT_OBSERVED');
          need(runtime.store.meta('stopped')===true&&runtime.store.db.prepare('SELECT state FROM grants WHERE id=?').get(grant.grant).state==='consumed','ACTUAL_CANCELLATION_AUTHORITY');
          const run=runtime.status(principal).runs[0];need(run.state==='uncertain','ACTUAL_CANCELLATION_NOT_UNCERTAIN');
          const retained=runtime.output({actor:actor.id,run:run.id},principal);
          requireCancelledReceipt({request:cancellationRequest,errorCode:error.code,retained});
          emit({kind:'result',ok:true,...evidence,mode,case:kind,grantWallMilliseconds,code:error.code,stopRecorded:true,grantConsumed:true,runUncertain:true,cancellationApplied,cancellationRequest,retained});
        }
      }
    }
  }
}catch(error){emit({kind:'result',ok:false,...evidence,mode,code:error.code||error.message});process.exitCode=1;}
finally{reader?.close();runtime?.close();}
