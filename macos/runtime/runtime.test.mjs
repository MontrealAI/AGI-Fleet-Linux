import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertMacHost} from './mac-host.mjs';
import {confirmDesktopCleanup} from './desktop-cleanup.mjs';
import {evaluateMacCleanInstall,verifyEvidence,GATES,ROLES} from './macos-clean-install.mjs';

const readTemplate=()=>JSON.parse(fs.readFileSync(new URL('./macos-clean-install.template.json',import.meta.url)));
const host=(overrides={})=>({platform:'darwin',arch:'arm64',run:(file,args,options)=>{assert.equal(options.shell,false);assert.equal(options.timeout,5000);const key=args.at(-1);return {status:0,stdout:({'sysctl.proc_translated':'0\n','hw.optional.arm64':'1\n','-productVersion':'15.0\n'})[key]};},...overrides});

test('native Apple Silicon on macOS 15 or newer passes without granting qualification',()=>{
  assert.deepEqual(assertMacHost(host()),{schema:'agi-macos-host/v1',platform:'darwin',arch:'arm64',osVersion:'15.0',translated:false,productionQualified:false});
});
test('Intel and non-Mac hosts reject before invoking any system command',()=>{
  for(const values of [{arch:'x64'},{platform:'linux'}])assert.throws(()=>assertMacHost(host({...values,run:()=>assert.fail('must not run')})),/MAC_APPLE_SILICON_REQUIRED/);
});
test('translated, unknown, failed, signaled and malformed observations fail closed',()=>{
  for(const response of [{status:0,stdout:'1\n'},{status:0,stdout:''},{status:1,stdout:'0'},{status:0,stdout:'0',signal:'SIGTERM'},{status:0,stdout:'0',error:Error('timeout')},{status:0,stdout:'garbage'}])assert.throws(()=>assertMacHost(host({run:()=>response})),/MAC_NATIVE_EXECUTION_REQUIRED|MAC_HOST_OBSERVATION_FAILED/);
  assert.throws(()=>assertMacHost(host({run:()=>{throw Error('unavailable');}})),/MAC_HOST_OBSERVATION_FAILED/);
});
test('unsupported OS and absent ARM hardware are rejected',()=>{
  for(const [key,value,code] of [['-productVersion','14.7','MACOS_15_REQUIRED'],['-productVersion','15.0 beta','MAC_HOST_OBSERVATION_FAILED'],['hw.optional.arm64','0','MAC_APPLE_SILICON_REQUIRED']]){
    const base=host();assert.throws(()=>assertMacHost({...base,run:(file,args,options)=>args.at(-1)===key?{status:0,stdout:value}:base.run(file,args,options)}),new RegExp(code));
  }
});
test('cleanup success requires successful removal AND an empty exact-name inventory',()=>{
  const calls=[];
  const result=confirmDesktopCleanup((docker,args)=>{calls.push(args);return {status:0,stdout:''};},'docker','agi-selftest-fixture');
  assert.deepEqual(calls,[['rm','--force','agi-selftest-fixture'],['ps','-aq','--filter','name=^/agi-selftest-fixture$']]);
  assert.deepEqual(result,{schema:'agi-desktop-cleanup/v1',removalConfirmed:true,exactContainerAbsent:true});
});
test('cleanup uncertainty never becomes a passing desktop check',()=>{
  const failures=[{status:1,stdout:''},{status:0,stdout:'container-id'},{status:null,stdout:''},{status:0},{status:0,stdout:'',error:Error('timeout')},{status:0,stdout:'',signal:'SIGKILL'}];
  for(const response of failures)assert.throws(()=>confirmDesktopCleanup((docker,args)=>args[0]==='ps'?response:{status:0,stdout:''},'docker','agi-selftest-fixture'),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
  for(const failure of [{status:1,stdout:''},null])assert.throws(()=>confirmDesktopCleanup((docker,args)=>{if(args[0]==='rm'){if(failure===null)throw Error('spawn');return failure;}return {status:0,stdout:''};},'docker','agi-selftest-fixture'),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
});
test('empty fresh-install template is pending and never grants production authority',()=>{
  const result=evaluateMacCleanInstall(readTemplate());assert.equal(result.evidenceComplete,false);assert.equal(result.productionQualified,false);assert.equal(result.authorization,'NONE');
  assert.ok(result.pending.includes('CLEAN_ACCOUNTS_PENDING:M1'));assert.ok(result.pending.includes('POSITIVE_CLEANUP_PENDING:M2'));
});

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mac-qualification-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('FABRICATED UNIT TEST INPUT: no physical Mac or provider observation.\n');fs.writeFileSync(path.join(root,'evidence.txt'),bytes);
  const hash=crypto.createHash('sha256').update(bytes).digest('hex'),refs=['fixture'];
  const m=readTemplate();m.frozenAt='2026-10-01T00:00:00Z';m.evidence=[{id:'fixture',path:'evidence.txt',sha256:hash,bytes:bytes.length}];Object.assign(m.release,{archiveSHA256:hash,sourceSHA256:hash,archiveEvidenceId:'fixture',sourceEvidenceId:'fixture'});
  for(const [index,machine] of m.machines.entries()){
    Object.assign(machine,{physical:true,translated:false,osVersion:'15.7',machineSHA256:String(index+1).repeat(64),evidenceIds:refs});
    Object.assign(machine.accounts,{newComputeAccount:true,computeStandard:true,signerStandard:true,computeUID:502,signerUID:501,walletSeparated:true,oldStatePreserved:true,evidenceIds:refs});
    for(const key of ROLES)Object.assign(machine.roles[key],{status:'PASS',measurement:'observed',evidenceIds:refs});
    for(const key of GATES)Object.assign(machine.gates[key],{status:'PASS',measurement:'observed',evidenceIds:refs});
    Object.assign(machine.gates.baseAndBrowserCleanup,{baseAttempts:50,basePasses:50,browserAttempts:50,browserPasses:50,remainingContainers:0,unresolvedFailures:0});
    Object.assign(machine.gates.endurance72Hours,{startedAt:'2026-10-02T00:00:00Z',finishedAt:'2026-10-05T00:00:00Z',activeSeconds:259200});
  }
  Object.assign(m.nativeTests,{passed:100,failed:0,skipped:0,timedOut:0,evidenceIds:refs});Object.assign(m.review,{decision:'ACCEPT',operatorIdentitySHA256:'a'.repeat(64),reviewerIdentitySHA256:'b'.repeat(64),independenceObserved:true,evidenceIds:refs});
  return {m,root,check:()=>evaluateMacCleanInstall(m,{root,now:Date.parse('2026-10-10T00:00:00Z')})};
}
test('complete mechanical evidence still requires substantive review, with no account-name requirement',t=>{
  const f=fixture(t),result=f.check();assert.deepEqual(result.pending,[]);assert.equal(result.evidenceComplete,true);assert.equal(result.productionQualified,false);assert.equal(result.authorization,'NONE');
});
test('migration, simulated observations, missing roles, zero cleanup and short soak remain blocked',t=>{
  const f=fixture(t);f.m.machines[0].accounts.newComputeAccount=false;f.m.machines[0].gates.liveDocuments.measurement='simulated';delete f.m.machines[0].roles.evidence;f.m.machines[1].gates.baseAndBrowserCleanup.browserAttempts=0;f.m.machines[1].gates.endurance72Hours.activeSeconds=12;
  for(const code of ['CLEAN_ACCOUNTS_PENDING:M1','GATE_PENDING:M1:liveDocuments','ROLE_PENDING:M1:evidence','POSITIVE_CLEANUP_PENDING:M2','72_HOUR_OBSERVATION_PENDING:M2'])assert.ok(f.check().pending.includes(code),code);
});
test('changed distributed bytes and non-independent acceptance remain blocked',t=>{
  const f=fixture(t);f.m.release.archiveSHA256='c'.repeat(64);f.m.review.reviewerIdentitySHA256=f.m.review.operatorIdentitySHA256;assert.ok(f.check().pending.includes('RELEASE_ARCHIVE_UNVERIFIED'));assert.ok(f.check().pending.includes('INDEPENDENT_REVIEW_PENDING'));
  fs.appendFileSync(path.join(f.root,'evidence.txt'),'altered');assert.ok(f.check().pending.includes('EVIDENCE_INVALID:fixture'));
});
test('evidence rejects traversal, links, wrong hashes and oversized files',t=>{
  const f=fixture(t),record=f.m.evidence[0];assert.equal(verifyEvidence(f.root,record),true);
  for(const changed of [{path:'../evidence.txt'},{sha256:'d'.repeat(64)},{bytes:450000000}])assert.equal(verifyEvidence(f.root,{...record,...changed}),false);
  fs.symlinkSync(path.join(f.root,'evidence.txt'),path.join(f.root,'link.txt'));assert.equal(verifyEvidence(f.root,{...record,path:'link.txt'}),false);
});
