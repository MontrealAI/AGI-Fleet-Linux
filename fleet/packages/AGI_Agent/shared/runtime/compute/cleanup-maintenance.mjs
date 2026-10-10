import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {readCleanupEvidence,archiveCleanupEvidence,evidenceBlocksWork} from './cleanup-evidence.mjs';
import {roleContract} from './roles.mjs';

export function cleanupMaintenanceReport(profileDir){
 const evidence=readCleanupEvidence(profileDir),stopPresent=fs.existsSync(path.join(profileDir,'COMPUTE_STOP'));
 return {schema:'agi-cleanup-maintenance/v1',evidence,stopPresent,workBlocked:stopPresent||evidenceBlocksWork(evidence),archiveEligible:evidence.status==='PASS'&&evidence.pending.length===0&&evidence.attemptCount>0,sandboxReconciliation:{status:'REQUIRES_REVIEW',automaticStopRemoval:false,reason:'Original command failure, retained job state and live sandbox postconditions require physical-runtime review. Archival grants no work authority.'},providerCalled:false,settingsChanged:false,limitsChanged:false,walletAccessed:false};
}
export async function cleanupMaintenanceMain(args=process.argv.slice(2)){
 const allowed=new Set(['--role','--profile','--json','--interactive']);
 if(args.some((arg,i)=>arg.startsWith('--')&&!allowed.has(arg))||new Set(args.filter(arg=>arg.startsWith('--'))).size!==args.filter(arg=>arg.startsWith('--')).length)throw Error('CLEANUP_MAINTENANCE_ARGUMENTS');
 const value=key=>args.includes(key)?args[args.indexOf(key)+1]:null;
 const role=value('--role')??'agent',contract=roleContract(role),profileDir=value('--profile')??path.join(os.homedir(),'.openclaw-'+contract.profile);
 if(!path.isAbsolute(profileDir))throw Error('CLEANUP_MAINTENANCE_PROFILE');
 const report=cleanupMaintenanceReport(profileDir);
 if(args.includes('--json')){process.stdout.write(JSON.stringify(report,null,2)+'\n');return;}
 process.stdout.write(`Cleanup evidence: ${report.evidence.status}\nSTOP marker: ${report.stopPresent?'present':'absent'}\n`);
 const capacity=report.evidence.capacity;
 if(capacity)process.stdout.write(`Active attempts: ${capacity.activeAttempts}; archived attempts: ${capacity.archivedAttempts}; remaining active slots: ${capacity.remainingAttempts}\nCapacity: ${capacity.warning}\n`);
 process.stdout.write('This tool preserves cleanup failures, job artifacts, journals, settings and STOP. It does not run models or Docker.\n');
 if(!args.includes('--interactive')||!process.stdin.isTTY)return;
 const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
 try{
  const choice=(await terminal.question('1 Inspect only\n2 Archive verified completed evidence\n3 Resume an interrupted archive transaction\nChoose [1]: ')).trim();
  if(!['2','3'].includes(choice))return;
  if(choice==='2'&&!report.archiveEligible)throw Error('CLEANUP_ARCHIVE_REVIEW_REQUIRED');
  const word=choice==='2'?'ARCHIVE':'RESUME';
  if((await terminal.question(`Type ${word} to preserve and verify the complete archive: `)).trim()!==word)return;
  const result=archiveCleanupEvidence(profileDir,{resume:choice==='3'});
  process.stdout.write(`Archive verified. Active attempts: ${result.attemptCount}; archived attempts: ${result.capacity.archivedAttempts}. STOP remains unchanged.\n`);
 }finally{terminal.close();}
}
