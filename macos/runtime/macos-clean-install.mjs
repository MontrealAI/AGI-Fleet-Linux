import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROLES=Object.freeze(['agent','node','moderator','employer','evidence','recovery']);
export const GATES=Object.freeze(['freshInstall','dockerIsolation','oauthInference','liveDocuments','baseAndBrowserCleanup','stopAndRecovery','rebootIdentity','endurance72Hours','jobIntegration','independentReview','distribution']);
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const integer=(value,min=0)=>Number.isSafeInteger(value) && value>=min;
const date=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function verifyEvidence(root, record) {
  if (!record || typeof record.path!=='string' || path.isAbsolute(record.path) || record.path.includes('\\') || record.path.split('/').some(p=>!p || p==='.' || p==='..') || !hash(record.sha256) || !integer(record.bytes,1) || record.bytes>=450000000) return false;
  let file=fs.realpathSync(root);
  for(const part of record.path.split('/')) { file=path.join(file,part); if(fs.lstatSync(file).isSymbolicLink()) return false; }
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const before=fs.fstatSync(fd);
    if(!before.isFile() || before.nlink!==1 || before.size!==record.bytes) return false;
    const digest=crypto.createHash('sha256'), buffer=Buffer.alloc(1024*1024); let count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))) digest.update(buffer.subarray(0,count));
    const after=fs.fstatSync(fd);
    return ['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]) && digest.digest('hex')===record.sha256;
  } finally { fs.closeSync(fd); }
}

export function evaluateMacCleanInstall(value,{root='.',now=Date.now(),verifyFile=verifyEvidence}={}) {
  const m=value??{}, pending=[], check=(condition,code)=>{if(!condition)pending.push(code);};
  check(m.schema==='agi-macos-clean-install-qualification/v1','SCHEMA');
  check(m.scope==='all-six-roles-clean-install-m1-m2','SCOPE');
  check(m.productionQualified===false && m.authorization==='NONE','NO_RUNTIME_AUTHORITY');
  check(/^\d+\.\d+\.\d+$/.test(m.release?.version??'') && hash(m.release?.archiveSHA256) && hash(m.release?.sourceSHA256),'RELEASE_IDENTITY');
  check(date(m.frozenAt) && Date.parse(m.frozenAt)<=now,'FREEZE_TIME');
  const records=Array.isArray(m.evidence)?m.evidence:[], verified=new Set(), seen=new Set();
  check(records.length>0 && records.length<=4096,'EVIDENCE_REQUIRED');
  for(const record of records.slice(0,4096)) {
    const id=record?.id, validId=typeof id==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !seen.has(id); seen.add(id);
    let valid=false; try {valid=validId && verifyFile(root,record);} catch {}
    check(valid,'EVIDENCE_INVALID:'+String(id??'unknown')); if(valid)verified.add(id);
  }
  const refs=ids=>Array.isArray(ids) && ids.length>0 && new Set(ids).size===ids.length && ids.every(id=>verified.has(id));
  for(const kind of ['archive','source']) {
    const record=records.find(r=>r.id===m.release?.[kind+'EvidenceId']);
    check(record && verified.has(record.id) && record.sha256===m.release?.[kind+'SHA256'],'RELEASE_'+kind.toUpperCase()+'_UNVERIFIED');
  }
  const machines=Array.isArray(m.machines)?m.machines:[];
  check(machines.length===2 && new Set(machines.map(x=>x?.chipFamily)).size===2 && ['M1','M2'].every(chip=>machines.some(x=>x?.chipFamily===chip)),'M1_M2_COVERAGE');
  check(machines.length===2 && machines.every(x=>hash(x?.machineSHA256)) && new Set(machines.map(x=>x?.machineSHA256)).size===2,'DISTINCT_PHYSICAL_HOSTS');
  for(const chip of ['M1','M2']) {
    const machine=machines.find(x=>x?.chipFamily===chip)??{};
    check(machine.physical===true && machine.platform==='darwin' && machine.arch==='arm64' && machine.translated===false && /^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(machine.osVersion??'') && Number(machine.osVersion.split('.')[0])>=15 && hash(machine.machineSHA256) && refs(machine.evidenceIds),'HOST_PENDING:'+chip);
    const accounts=machine.accounts??{};
    check(accounts.installationTrack==='clean-install' && accounts.newComputeAccount===true && accounts.computeStandard===true && accounts.signerStandard===true && integer(accounts.computeUID,1) && integer(accounts.signerUID,1) && accounts.computeUID!==accounts.signerUID && accounts.walletSeparated===true && accounts.oldStatePreserved===true && refs(accounts.evidenceIds),'CLEAN_ACCOUNTS_PENDING:'+chip);
    const roles=machine.roles??{};
    for(const role of ROLES)check(roles[role]?.status==='PASS' && roles[role]?.measurement==='observed' && refs(roles[role]?.evidenceIds),'ROLE_PENDING:'+chip+':'+role);
    for(const name of GATES) {
      const gate=machine.gates?.[name];
      check(gate?.status==='PASS' && gate?.measurement==='observed' && refs(gate?.evidenceIds),'GATE_PENDING:'+chip+':'+name);
    }
    const cleanup=machine.gates?.baseAndBrowserCleanup;
    check(integer(cleanup?.baseAttempts,1) && cleanup.basePasses===cleanup.baseAttempts && integer(cleanup?.browserAttempts,1) && cleanup.browserPasses===cleanup.browserAttempts && cleanup.remainingContainers===0 && cleanup.unresolvedFailures===0,'POSITIVE_CLEANUP_PENDING:'+chip);
    const soak=machine.gates?.endurance72Hours;
    check(integer(soak?.activeSeconds,259200) && date(soak?.startedAt) && date(soak?.finishedAt) && Date.parse(soak.finishedAt)<=now && Date.parse(soak.finishedAt)-Date.parse(soak.startedAt)>=soak.activeSeconds*1000,'72_HOUR_OBSERVATION_PENDING:'+chip);
  }
  check(m.nativeTests?.platform==='darwin' && m.nativeTests?.arch==='arm64' && integer(m.nativeTests?.passed,1) && m.nativeTests?.failed===0 && m.nativeTests?.skipped===0 && m.nativeTests?.timedOut===0 && refs(m.nativeTests?.evidenceIds),'NATIVE_TESTS_PENDING');
  check(m.review?.decision==='ACCEPT' && hash(m.review?.operatorIdentitySHA256) && hash(m.review?.reviewerIdentitySHA256) && m.review.operatorIdentitySHA256!==m.review.reviewerIdentitySHA256 && m.review.independenceObserved===true && refs(m.review?.evidenceIds),'INDEPENDENT_REVIEW_PENDING');
  const reasons=[...new Set(pending)];
  return {schema:'agi-macos-clean-install-gate-result/v1',version:m.release?.version??null,status:reasons.length?'QUALIFICATION_PENDING':'EVIDENCE_COMPLETE_REQUIRES_SUBSTANTIVE_REVIEW',evidenceComplete:reasons.length===0,productionQualified:false,authorization:'NONE',verifiedEvidenceCount:verified.size,pending:reasons,limitations:'Checks evidence completeness and file integrity only. Does not establish the truth of observations, approve production, authorize funded work, or clear STOP. Historical migration evidence is not fresh-install evidence.'};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];
  if(file==='--help') console.log('Usage: node qualification/macos-clean-install.mjs qualification.json\nExit 0: evidence mechanically complete (still requires review); 2: pending; 1: invalid input. No runtime or financial authority.');
  else try {
    if(!file)throw Error(); const stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size>4*1024*1024)throw Error();
    const result=evaluateMacCleanInstall(JSON.parse(fs.readFileSync(file)),{root:path.dirname(path.resolve(file))});
    console.log(JSON.stringify(result,null,2)); process.exitCode=result.evidenceComplete?0:2;
  } catch {console.error('MAC_QUALIFICATION_INPUT_INVALID');process.exitCode=1;}
}
