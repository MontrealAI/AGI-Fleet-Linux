import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {need, privateDir, atomic, readSecret, digest} from './core.mjs';

function workspace(c) {
  need(c?.schema==='agi-native-config/v1' && ['agent','reviewer'].includes(c.role) && typeof c.dataDir==='string' && path.isAbsolute(c.dataDir), 'CONFIG_PATH');
  need(fs.existsSync(c.dataDir),'WORKSPACE_NOT_INITIALIZED');
  privateDir(c.dataDir);
  return c.dataDir;
}
export function stopWorkspace(c) {
  const dir=workspace(c), file=path.join(dir,'STOP');
  atomic(file,{schema:'agi-workstation-stop/v1',requestedAt:new Date().toISOString(),reason:'operator'});
  return {stopped:true,marker:file,next:'No new actions are authorized. An active request stops at the next authority check and attempts cleanup; inspect its result and operations before resuming. STOP remains until explicit resume.'};
}
export function resumeWorkspace(c,acknowledge) {
  need(acknowledge==='true','RESUME_ACKNOWLEDGEMENT');
  const dir=workspace(c);
  need(!fs.existsSync(path.join(dir,'RECOVERY_REQUIRED.json')),'RECOVERY_REQUIRED');
  const ledger=path.join(dir,'ledger.sqlite');
  if(fs.existsSync(ledger)) {
    const st=fs.lstatSync(ledger);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid(),'DATABASE_FILE');
    const db=new DatabaseSync(ledger,{readOnly:true});
    try {
      const lease=db.prepare('SELECT pid FROM lease WHERE singleton=1').get();
      if(lease) {
        let alive=true;try{process.kill(lease.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
        need(!alive,'WORKER_STILL_RUNNING');
      }
    } finally {db.close();}
  }
  const file=path.join(dir,'STOP');
  if(fs.existsSync(file)) {const st=fs.lstatSync(file);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid(),'STOP_FILE');fs.unlinkSync(file);}
  return {resumed:true,next:'The stop marker is cleared. This does not start a worker, renew grants or qualify this workstation. Run doctor, then explicitly run a packet or start the service.'};
}
export function workspaceStatus(c) {
  const dir=workspace(c), bound=typeof c.installationSha256==='string'&&!/^0+$/.test(c.installationSha256)&&typeof c.gatewayConfigSha256==='string'&&!/^0+$/.test(c.gatewayConfigSha256);
  return {schema:'agi-linux-workstation-status/v1',role:c.role,bound,stopped:fs.existsSync(path.join(dir,'STOP')),recoveryRequired:fs.existsSync(path.join(dir,'RECOVERY_REQUIRED.json')),provider:c.provider,model:c.model,openclawVersion:c.openclawVersion,applications:(c.applications??[]).map(a=>a.bundleId),resources:c.resources,authorityConfigured:typeof c.revocationFile==='string',qualified:false,
    next:!bound?'Complete bind with the actual OpenClaw package, paired node, authority file and budgets.':'Run doctor for current gateway/provider observations; inspect operations for job results. Local configuration does not establish physical qualification.'};
}
export function serviceName(c) {workspace(c);return 'agi-workstation-'+c.role+'-'+digest(c.dataDir).slice(0,12)+'.service';}
function quote(value) {
  need(typeof value==='string'&&value.length>0&&!/[\x00-\x1f\x7f%$]/.test(value),'SERVICE_ARGUMENT');
  return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
}
export function serviceUnit(c,{configFile,recipientKey,node=process.execPath,cli=fileURLToPath(new URL('./cli.mjs',import.meta.url)),env=process.env}={}) {
  need([node,cli,configFile,recipientKey].every(p=>typeof p==='string'&&path.isAbsolute(p)),'SERVICE_PATH');
  need(env.XDG_SESSION_TYPE==='x11'&&/^:[0-9]+(?:\.[0-9]+)?$/.test(env.DISPLAY??''),'X11_SESSION_REQUIRED');
  const values=[node,cli,'watch','--config',configFile,'--recipient-key',recipientKey];
  need(env.XDG_RUNTIME_DIR==='/run/user/'+process.getuid()&&env.DBUS_SESSION_BUS_ADDRESS==='unix:path='+env.XDG_RUNTIME_DIR+'/bus','PRIVATE_DESKTOP_BUS_REQUIRED');
  const environment=['XDG_SESSION_TYPE=x11','DISPLAY='+env.DISPLAY,'XDG_RUNTIME_DIR='+env.XDG_RUNTIME_DIR,'DBUS_SESSION_BUS_ADDRESS='+env.DBUS_SESSION_BUS_ADDRESS];
  if(env.XAUTHORITY){need(path.isAbsolute(env.XAUTHORITY),'XAUTHORITY_PATH');environment.push('XAUTHORITY='+env.XAUTHORITY);}
  return '[Unit]\nDescription=AGI authorized workstation ('+c.role+')\nAfter=graphical-session.target\nPartOf=graphical-session.target\n\n[Service]\nType=simple\nUMask=0077\nExecStart='+values.map(quote).join(' ')+'\n'+environment.map(v=>'Environment='+quote(v)).join('\n')+'\nRestart=no\nKillSignal=SIGTERM\nTimeoutStopSec=90\n\n[Install]\nWantedBy=graphical-session.target\n';
}
function userDir(home) {
  need(path.isAbsolute(home),'SERVICE_HOME');
  let current=home;
  for(const part of ['.config','systemd','user']) {
    current=path.join(current,part);
    if(!fs.existsSync(current))fs.mkdirSync(current,{mode:0o700});
    const st=fs.lstatSync(current);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o022)===0,'SERVICE_DIRECTORY');
  }
  return current;
}
export function installService(c,{configFile,recipientKey,home=os.homedir(),env=process.env,run=execFileSync}={}) {
  need(process.platform==='linux'&&process.getuid()!==0,'LINUX_TASK_ACCOUNT_REQUIRED');
  workspace(c);readSecret(recipientKey);readSecret(configFile,1048576);
  const name=serviceName(c),dir=userDir(home),file=path.join(dir,name);
  need(!fs.existsSync(file),'SERVICE_EXISTS');
  fs.writeFileSync(file,serviceUnit(c,{configFile,recipientKey,env}),{flag:'wx',mode:0o600});
  try {run('systemctl',['--user','daemon-reload'],{timeout:15000,stdio:['ignore','pipe','pipe']});}
  catch(error) {fs.unlinkSync(file);throw error;}
  return {installed:name,file,started:false,enabled:false,next:'The service was installed but remains stopped. Run service-start while logged into this same X11 account. No startup-on-login or automatic restart was enabled.'};
}
export function serviceCommand(c,command,{run=execFileSync}={}) {
  need(['start','stop'].includes(command),'SERVICE_COMMAND');
  const name=serviceName(c);
  if(command==='start')need(!fs.existsSync(path.join(c.dataDir,'STOP')),'STOP_REQUESTED');
  run('systemctl',['--user',command,name],{timeout:100000,stdio:['ignore','pipe','pipe']});
  return {service:name,command,requested:true};
}
