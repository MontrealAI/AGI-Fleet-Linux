import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// This offline gate verifies submitted evidence completeness and integrity. It never
// grants execution, wallet, payment or cleanup-reconciliation authority.
export const MAX_FILE_BYTES = 450_000_000;
export const REQUIRED_GATES = Object.freeze([
  'in_place_update', 'identity_approval', 'approval_resilience', 'live_tools',
  'cleanup', 'cleanup_reconciliation', 'cleanup_capacity', 'full_job_cycle',
  'role_independence', 'lifecycle_endurance', 'distribution', 'outstanding_tests',
  'capacity_and_economics',
]);
export const CASE_IDS = Object.freeze(Array.from({length:24}, (_,i)=>`case-${String(i+1).padStart(2,'0')}`));
export const canonical = value => JSON.stringify(value, (_,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const address = value => typeof value==='string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const integer = (value,min=0) => Number.isSafeInteger(value) && value>=min;
const date = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const nonempty = value => typeof value==='string' && value.trim().length>0;
const catalogBytes=fs.readFileSync(new URL('./acceptance-catalog.json',import.meta.url));
export const CATALOG_SHA256=sha256(catalogBytes);
const catalog=JSON.parse(catalogBytes);
export const CONTRACT_SOURCE_PIN=JSON.parse(fs.readFileSync(new URL('./contract-source-pin.json',import.meta.url)));

export function verifyLocalFile(root, record) {
  if (!nonempty(record?.path) || path.isAbsolute(record.path) || record.path.includes('\\') || record.path.split('/').some(p=>p==='..'||p==='.'||!p)) return false;
  if (!hash(record.sha256) || !integer(record.bytes,1) || record.bytes>=MAX_FILE_BYTES) return false;
  const base=fs.realpathSync(root); let location=base;
  for (const segment of record.path.split('/')) {
    location=path.join(location,segment);
    if (fs.lstatSync(location).isSymbolicLink()) return false;
  }
  const fd=fs.openSync(location,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const before=fs.fstatSync(fd);
    if (!before.isFile() || before.nlink!==1 || before.size!==record.bytes) return false;
    const digest=crypto.createHash('sha256'), buffer=Buffer.alloc(1024*1024); let length;
    while ((length=fs.readSync(fd,buffer,0,buffer.length,null))) digest.update(buffer.subarray(0,length));
    const after=fs.fstatSync(fd);
    return before.dev===after.dev && before.ino===after.ino && before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs && digest.digest('hex')===record.sha256;
  } finally { fs.closeSync(fd); }
}

export function evaluateReleaseQualification(manifest, {root='.', now=Date.now(), verifyFile=verifyLocalFile}={}) {
  const failures=[];
  const check=(condition,code)=>{if(!condition)failures.push(code);return condition;};
  const m=manifest??{};
  check(m.schema==='agi-fleet-release-qualification/v1','MANIFEST_SCHEMA');
  check(nonempty(m.release?.version)&&hash(m.release?.archiveSha256)&&hash(m.release?.sourceSha256),'RELEASE_IDENTITY_PENDING');
  check(m.scope==='all-six-roles-on-selected-deployment','QUALIFICATION_SCOPE');
  check(m.catalogSha256===CATALOG_SHA256,'CASE_CATALOG_CHANGED');
  check(date(m.frozenAt)&&Date.parse(m.frozenAt)<=now,'FREEZE_TIME');
  const files=Array.isArray(m.evidence)?m.evidence:[], verified=new Set(), seen=new Set();
  check(files.length>0&&files.length<=4096,'EVIDENCE_REQUIRED');
  for(const file of files.slice(0,4096)){
    const validID=nonempty(file?.id)&&!seen.has(file.id); seen.add(file?.id);
    let valid=false;try{valid=validID&&verifyFile(root,file);}catch{}
    if(check(valid,'EVIDENCE_INVALID:'+String(file?.id??'unknown')))verified.add(file.id);
  }
  const refs=(ids)=>Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>verified.has(id));
  const archive=files.find(f=>f?.id===m.release?.archiveEvidenceId), source=files.find(f=>f?.id===m.release?.sourceEvidenceId);
  check(verified.has(archive?.id)&&archive.sha256===m.release?.archiveSha256&&verified.has(source?.id)&&source.sha256===m.release?.sourceSha256,'DISTRIBUTED_RELEASE_BYTES_UNVERIFIED');
  const gates=m.gates??{};
  for(const name of REQUIRED_GATES){
    const gate=gates[name];
    check(gate?.status==='PASS'&&gate.measurement==='observed'&&refs(gate.evidenceIds),'GATE_PENDING:'+name);
  }
  const deployment=m.deployment??{};
  check(deployment.repository===CONTRACT_SOURCE_PIN.repository&&deployment.commit===CONTRACT_SOURCE_PIN.commit&&integer(deployment.chainId,1)&&[1,11155111].includes(deployment.chainId)&&address(deployment.manager)&&deployment.abiSha256===CONTRACT_SOURCE_PIN.abiSha256&&hash(deployment.bytecodeSha256)&&address(deployment.token)&&deployment.tokenDecimals===6&&integer(deployment.confirmations,1)&&integer(deployment.observedBlock,1)&&hash(deployment.observedBlockHash)&&refs(deployment.evidenceIds),'SELECTED_DEPLOYMENT_PENDING');
  check(Array.isArray(deployment.supportedTransitions)&&deployment.supportedTransitions.length>0&&new Set(deployment.supportedTransitions).size===deployment.supportedTransitions.length&&deployment.supportedTransitions.every(name=>CONTRACT_SOURCE_PIN.mutatingFunctions.includes(name)),'DEPLOYED_TRANSITIONS_PENDING');
  const runtime=m.environment??{};
  check(runtime.physicalMac===true&&runtime.signerAccount==='agiagentv1'&&runtime.computeAccount==='agiagentcomputev3'&&runtime.newAccountCreated===false&&runtime.walletPreserved===true&&runtime.oauthPreserved===true&&runtime.oldFailureEvidencePreserved===true,'EXISTING_ACCOUNT_EVIDENCE_PENDING');
  const soak=m.soak??{}, duration=date(soak.startedAt)&&date(soak.finishedAt)?(Date.parse(soak.finishedAt)-Date.parse(soak.startedAt))/1000:0;
  check(soak.measurement==='observed'&&integer(soak.activeSeconds,72*3600)&&duration>=soak.activeSeconds&&Date.parse(soak.finishedAt)<=now&&soak.rebootVerified===true&&soak.interruptionRecoveryVerified===true&&refs(soak.evidenceIds),'MEASURED_72_HOUR_SOAK_PENDING');
  const tests=m.outstandingTests??{};
  check(tests.relevantFailures===0&&tests.relevantSkips===0&&tests.relevantTimeouts===0&&tests.capableEnvironment===true&&refs(tests.evidenceIds),'OUTSTANDING_TESTS_PENDING');
  const cases=Array.isArray(m.cases)?m.cases:[], byID=new Map(cases.map(c=>[c?.id,c]));
  check(cases.length===24&&byID.size===24&&CASE_IDS.every(id=>byID.has(id)),'CASE_CATALOG_INCOMPLETE');
  for(const id of CASE_IDS){
    const c=byID.get(id)??{}, review=c.review??{}, usage=c.usage??{};
    const requiredCriteria=catalog.cases.find(item=>item.id===id).acceptanceCriteria.map(item=>item.id);
    const criterionIDs=Array.isArray(c.criteria)?c.criteria.map(item=>item.id):[];
    check(c.status==='PASS'&&c.execution==='live-provider-and-tools'&&['synthetic','public-authorized'].includes(c.inputClassification)&&c.inputPermission==='public-or-synthetic-only'&&refs(c.deliverableEvidenceIds)&&refs(c.toolEvidenceIds)&&c.openedAndInspected===true&&criterionIDs.length===requiredCriteria.length&&new Set(criterionIDs).size===requiredCriteria.length&&requiredCriteria.every(id=>criterionIDs.includes(id))&&c.criteria.every(x=>x.status==='PASS'&&refs(x.evidenceIds)),'CASE_PENDING:'+id);
    check(review.decision==='ACCEPT'&&review.independenceVerified===true&&nonempty(review.agentController)&&nonempty(review.reviewerController)&&review.agentController!==review.reviewerController&&refs(review.assignmentEvidenceIds)&&refs(review.decisionEvidenceIds),'INDEPENDENT_ACCEPTANCE_PENDING:'+id);
    check(integer(c.elapsedSeconds,1)&&integer(c.humanInterventionSeconds)&&integer(usage.attemptedRequests,1)&&integer(usage.reservedSlots,1)&&integer(usage.providerCalls,1)&&integer(usage.toolRuns,1)&&integer(usage.images)&&refs(usage.evidenceIds),'CASE_MEASUREMENTS_PENDING:'+id);
    const payment=c.payment??{};
    check(['NONE','MOCK','TESTNET','COMMERCIAL'].includes(payment.classification),'PAYMENT_CLASSIFICATION_PENDING:'+id);
    if(payment.classification==='COMMERCIAL')check(payment.finalized===true&&payment.chainId===deployment.chainId&&payment.manager?.toLowerCase()===deployment.manager?.toLowerCase()&&refs(payment.evidenceIds),'COMMERCIAL_RECEIPT_UNPROVEN:'+id);
  }
  const ledgers=m.economics?.ledgers??{};
  for(const name of ['jobVolume','fees','providerCosts','refunds','liabilities'])check(refs(ledgers[name]),'SEPARATE_LEDGER_PENDING:'+name);
  check(m.economics?.measurement==='observed'&&refs(m.economics?.metricsEvidenceIds),'ECONOMICS_MEASUREMENTS_PENDING');
  const reasons=[...new Set(failures)];
  return {schema:'agi-fleet-release-gate-result/v1',release:m.release?.version??null,scope:m.scope??null,productionQualified:reasons.length===0,status:reasons.length?'RELEASE_CANDIDATE_ONLY':'QUALIFIED_UNDER_SUBMITTED_EVIDENCE',pending:reasons,verifiedEvidenceCount:verified.size,authorization:'NONE',limitations:'Mechanical evidence checks verify completeness and file integrity. They cannot establish the truth of physical observations, organizational independence, model quality or commercial value. Supporting evidence for each claim must undergo substantive review. This gate grants no runtime or financial authority and adds no release approval policy.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [file]=process.argv.slice(2);
    if(!file||file==='--help'){console.log('Usage: node qualification/release-gate.mjs manifest.json\nOffline mechanical verification only. Exit 0: requested evidence complete and files verified. Exit 2: pending qualification. Exit 1: invalid input. Evidence paths are relative to the manifest. Supporting claims still require substantive review. Never put tokens or customer content in qualification evidence.');process.exitCode=file==='--help'?0:1;}
    else{
      const load=f=>{const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.size>4*1024*1024)throw Error('INPUT_FILE_INVALID');return JSON.parse(fs.readFileSync(f,'utf8'));};
      const report=evaluateReleaseQualification(load(file),{root:path.dirname(path.resolve(file))});
      console.log(JSON.stringify(report,null,2));process.exitCode=report.productionQualified?0:2;
    }
  }catch{console.error('QUALIFICATION_INPUT_INVALID');process.exitCode=1;}
}
