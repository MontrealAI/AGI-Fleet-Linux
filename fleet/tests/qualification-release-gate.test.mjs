import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evaluateReleaseQualification,verifyLocalFile,sha256,MAX_FILE_BYTES,CONTRACT_SOURCE_PIN} from '../qualification/release-gate.mjs';

const template=JSON.parse(fs.readFileSync(new URL('../qualification/release-qualification-template.json',import.meta.url)));
const clone=()=>structuredClone(template);
// Deliberately fabricated unit-test inputs exercise validation mechanics only.
// They are never exported as live execution, measured soak or release evidence.
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-qualification-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('UNIT TEST ONLY; no physical observation or commercial payment.\n');
  fs.writeFileSync(path.join(root,'evidence.txt'),bytes);
  const evidence={id:'test-evidence',path:'evidence.txt',sha256:sha256(bytes),bytes:bytes.length};
  const m=clone(), refs=[evidence.id], now=Date.parse('2026-10-08T12:00:00.000Z');
  m.evidence=[evidence];m.release.archiveSha256=evidence.sha256;m.release.sourceSha256=evidence.sha256;m.release.archiveEvidenceId=evidence.id;m.release.sourceEvidenceId=evidence.id;
  m.frozenAt='2026-10-08T11:00:00.000Z';
  for(const gate of Object.values(m.gates)){gate.status='PASS';gate.measurement='observed';gate.evidenceIds=refs;}
  Object.assign(m.deployment,{chainId:11155111,manager:'0x'+'1'.repeat(40),abiSha256:CONTRACT_SOURCE_PIN.abiSha256,bytecodeSha256:'b'.repeat(64),token:'0x'+'2'.repeat(40),tokenDecimals:6,confirmations:12,observedBlock:12345,observedBlockHash:'c'.repeat(64),supportedTransitions:['applyForJob','requestJobCompletion'],evidenceIds:refs});
  Object.assign(m.environment,{physicalMac:true,newAccountCreated:false,walletPreserved:true,oauthPreserved:true,oldFailureEvidencePreserved:true});
  Object.assign(m.soak,{measurement:'observed',startedAt:'2026-10-05T10:00:00.000Z',finishedAt:'2026-10-08T10:00:00.000Z',activeSeconds:72*3600,rebootVerified:true,interruptionRecoveryVerified:true,evidenceIds:refs});
  Object.assign(m.outstandingTests,{relevantFailures:0,relevantSkips:0,relevantTimeouts:0,capableEnvironment:true,evidenceIds:refs});
  for(const c of m.cases){
    Object.assign(c,{status:'PASS',execution:'live-provider-and-tools',inputClassification:'synthetic',deliverableEvidenceIds:refs,toolEvidenceIds:refs,openedAndInspected:true,elapsedSeconds:10,humanInterventionSeconds:0});
    for(const criterion of c.criteria){criterion.status='PASS';criterion.evidenceIds=refs;}
    Object.assign(c.review,{decision:'ACCEPT',independenceVerified:true,agentController:'fixture-agent',reviewerController:'fixture-reviewer',assignmentEvidenceIds:refs,decisionEvidenceIds:refs});
    Object.assign(c.usage,{attemptedRequests:1,reservedSlots:1,providerCalls:1,toolRuns:1,images:0,evidenceIds:refs});
  }
  m.economics.measurement='observed';m.economics.metricsEvidenceIds=refs;
  for(const key of Object.keys(m.economics.ledgers))m.economics.ledgers[key]=refs;
  const evaluate=()=>evaluateReleaseQualification(m,{root,now});
  return {m,root,evaluate};
}

test('delivered template is explicitly pending, including all 24 useful-work cases',()=>{
  const result=evaluateReleaseQualification(clone());
  assert.equal(result.productionQualified,false);assert.equal(result.status,'RELEASE_CANDIDATE_ONLY');
  assert.equal(template.cases.length,24);assert.ok(template.cases.every(c=>c.status==='NOT_RUN'&&c.payment.classification==='NONE'));
  assert.ok(result.pending.includes('MEASURED_72_HOUR_SOAK_PENDING'));
  assert.ok(result.pending.includes('SELECTED_DEPLOYMENT_PENDING'));
});
test('pending, skipped or synthetic gate evidence cannot be promoted with pass labels',t=>{
  const f=fixture(t);f.m.gates.cleanup.status='NOT_RUN';f.m.gates.live_tools.measurement='scripted-provider';
  const r=f.evaluate();assert.equal(r.productionQualified,false);assert.ok(r.pending.includes('GATE_PENDING:cleanup'));assert.ok(r.pending.includes('GATE_PENDING:live_tools'));
});
test('changed or missing distributed bytes remain blocked despite pass flags',t=>{
  const f=fixture(t);fs.appendFileSync(path.join(f.root,'evidence.txt'),'changed');
  const r=f.evaluate();assert.equal(r.productionQualified,false);assert.ok(r.pending.includes('DISTRIBUTED_RELEASE_BYTES_UNVERIFIED'));
});
test('archive and source claims must bind the verified distributed evidence',t=>{
  const f=fixture(t);f.m.release.archiveSha256='f'.repeat(64);
  assert.ok(f.evaluate().pending.includes('DISTRIBUTED_RELEASE_BYTES_UNVERIFIED'));
});
test('short soak cannot be relabeled as 72 measured hours',t=>{
  const f=fixture(t);f.m.soak.startedAt='2026-10-08T09:00:00.000Z';
  assert.ok(f.evaluate().pending.includes('MEASURED_72_HOUR_SOAK_PENDING'));
});
test('new compute account, missing deployment and unresolved test failures block production',t=>{
  const f=fixture(t);f.m.environment.computeAccount='agiagentcomputev4';f.m.deployment.manager=null;f.m.outstandingTests.relevantTimeouts=2;
  const r=f.evaluate();for(const code of ['EXISTING_ACCOUNT_EVIDENCE_PENDING','SELECTED_DEPLOYMENT_PENDING','OUTSTANDING_TESTS_PENDING'])assert.ok(r.pending.includes(code));
});
test('same operator with different role names does not establish independent acceptance',t=>{
  const f=fixture(t);f.m.cases[0].review.reviewerController=f.m.cases[0].review.agentController;
  assert.ok(f.evaluate().pending.includes('INDEPENDENT_ACCEPTANCE_PENDING:case-01'));
});
test('catalog cases and criteria cannot be silently omitted or replaced',t=>{
  const f=fixture(t);f.m.cases[0].criteria.pop();f.m.cases[1].id='case-01';
  const r=f.evaluate();assert.ok(r.pending.includes('CASE_CATALOG_INCOMPLETE'));assert.ok(r.pending.includes('CASE_PENDING:case-02'));
});
test('scripted execution, inferred provider usage and unproven commercial payment fail',t=>{
  const f=fixture(t),c=f.m.cases[0];c.execution='scripted-provider';c.usage.providerCalls=null;c.payment.classification='COMMERCIAL';
  const r=f.evaluate();for(const code of ['CASE_PENDING:case-01','CASE_MEASUREMENTS_PENDING:case-01','COMMERCIAL_RECEIPT_UNPROVEN:case-01'])assert.ok(r.pending.includes(code));
});
test('path traversal, symlinks, equal-to-limit files and hash mismatch are rejected',t=>{
  const f=fixture(t),record=f.m.evidence[0];assert.equal(verifyLocalFile(f.root,record),true);
  assert.equal(verifyLocalFile(f.root,{...record,path:'../evidence.txt'}),false);
  assert.equal(verifyLocalFile(f.root,{...record,bytes:MAX_FILE_BYTES}),false);
  assert.equal(verifyLocalFile(f.root,{...record,sha256:'0'.repeat(64)}),false);
  fs.symlinkSync(path.join(f.root,'evidence.txt'),path.join(f.root,'linked.txt'));
  assert.equal(verifyLocalFile(f.root,{...record,path:'linked.txt'}),false);
});
