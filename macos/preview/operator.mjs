// Local operator controls shared in behavior with the Linux source preview.
// These controls create no job authority, perform no desktop action and start no service.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {need,privateDir,atomic} from './core.mjs';

const present=file=>fs.lstatSync(file,{throwIfNoEntry:false});
function workspace(c){
  need(c?.schema==='agi-native-config/v1'&&['agent','reviewer'].includes(c.role)&&typeof c.dataDir==='string'&&path.isAbsolute(c.dataDir),'CONFIG_PATH');
  need(present(c.dataDir),'WORKSPACE_NOT_INITIALIZED');privateDir(c.dataDir);return c.dataDir;
}
function ownedFile(file,code){
  const s=present(file);need(s?.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077),code);return s;
}
export function stopWorkspace(c){
  const dir=workspace(c),file=path.join(dir,'STOP');
  if(present(file))ownedFile(file,'STOP_FILE');
  atomic(file,{schema:'agi-workstation-stop/v1',requestedAt:new Date().toISOString(),reason:'operator'});
  return {stopped:true,marker:file,next:'No new actions are authorized. Active work stops at its next authority check and attempts cleanup. Inspect operating records and recovery before resuming.'};
}
export function resumeWorkspace(c,acknowledge){
  need(acknowledge==='true','RESUME_ACKNOWLEDGEMENT');const dir=workspace(c);
  need(!present(path.join(dir,'RECOVERY_REQUIRED.json')),'RECOVERY_REQUIRED');
  const ledger=path.join(dir,'ledger.sqlite');
  if(present(ledger)){
    ownedFile(ledger,'DATABASE_FILE');
    const db=new DatabaseSync(ledger,{readOnly:true});
    try{
      const lease=db.prepare('SELECT pid FROM lease WHERE singleton=1').get();
      if(lease){
        need(Number.isSafeInteger(lease.pid)&&lease.pid>0,'WORKER_STILL_RUNNING');
        let alive=true;try{process.kill(lease.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
        need(!alive,'WORKER_STILL_RUNNING');
      }
    }finally{db.close();}
  }
  const file=path.join(dir,'STOP');if(present(file)){ownedFile(file,'STOP_FILE');fs.unlinkSync(file);}
  return {resumed:true,next:'The stop marker is cleared. No worker was started and no grant renewed. Check the real provider and explicitly run an approved pilot packet.'};
}
export function workspaceStatus(c){
  const dir=workspace(c),bound=/^[a-f0-9]{64}$/.test(c.installationSha256??'')&&!/^0+$/.test(c.installationSha256)&&/^[a-f0-9]{64}$/.test(c.gatewayConfigSha256??'')&&!/^0+$/.test(c.gatewayConfigSha256);
  return {schema:'agi-macos-workstation-status/v1',role:c.role,bound,stopped:Boolean(present(path.join(dir,'STOP'))),recoveryRequired:Boolean(present(path.join(dir,'RECOVERY_REQUIRED.json'))),provider:c.provider,model:c.model,openclawVersion:c.openclawVersion,applications:(c.applications??[]).map(a=>a.bundleId),resources:c.resources,authorityConfigured:typeof c.revocationFile==='string',qualified:false,productionExecution:'DISABLED',next:bound?'Run doctor to inspect the actual paired Mac provider. Configuration alone is not physical qualification.':'Connect the signed OpenClaw Mac app, paired node, authority file and reviewed budgets.'};
}
