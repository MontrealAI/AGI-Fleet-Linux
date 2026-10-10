import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {main} from '../engine/cli.mjs';
import {serviceUnit,serviceCommand,serviceName,workspaceStatus,stopWorkspace,resumeWorkspace} from '../engine/operator.mjs';
import {friendlyError} from '../launch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agi-cli-'));fs.chmodSync(dir,0o700);const dataDir=path.join(dir,'operations');fs.mkdirSync(dataDir,{mode:0o700});return {dir,c:{schema:'agi-native-config/v1',role:'agent',dataDir,provider:'cua-computer',model:'openai/gpt-6-astra',openclawVersion:'2026.9.5',installationSha256:'0'.repeat(64),gatewayConfigSha256:'0'.repeat(64),resources:['dedicated-account:test'],applications:[],revocationFile:null},close:()=>fs.rmSync(dir,{recursive:true,force:true})};}

test('init creates private Linux preparation files without claiming a configured runtime or printing key material',()=>{
 const h=fixture();try{
  const pub=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),key=path.join(h.dir,'operator-public.pem');fs.writeFileSync(key,pub,{mode:0o600});
  const dir=path.join(h.dir,'new'),result=spawnSync(process.execPath,['engine/cli.mjs','init','--dir',dir,'--role','agent','--operator-public-key',key,'--installation','/opt/test/openclaw'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/BEGIN.*KEY|gateway-token/);
  const c=JSON.parse(fs.readFileSync(path.join(dir,'native-config.json')));assert.equal(c.appBundlePath,'/opt/test/openclaw');assert.equal(c.provider,'cua-computer');assert.equal(workspaceStatus(c).bound,false);
  for(const name of ['native-config.json','recipient-private.pem','openclaw-planner-fragment.json'])assert.equal(fs.statSync(path.join(dir,name)).mode&0o777,0o600);
  assert.equal(fs.existsSync(c.gatewayTokenFile),false);assert.equal(fs.existsSync(path.join(dir,'operator-private.pem')),false);
 }finally{h.close();}
});
test('stop works before binding; resume is explicit and refuses incomplete recovery or live worker',()=>{
 const h=fixture();try{
  stopWorkspace(h.c);assert.equal(workspaceStatus(h.c).stopped,true);assert.throws(()=>resumeWorkspace(h.c,'false'),/ACKNOWLEDGEMENT/);
  const recovery=path.join(h.c.dataDir,'RECOVERY_REQUIRED.json');fs.writeFileSync(recovery,'{}');assert.throws(()=>resumeWorkspace(h.c,'true'),/RECOVERY_REQUIRED/);fs.unlinkSync(recovery);
  const db=new DatabaseSync(path.join(h.c.dataDir,'ledger.sqlite'));db.exec('CREATE TABLE lease(singleton INTEGER PRIMARY KEY,pid INTEGER)');db.prepare('INSERT INTO lease VALUES(1,?)').run(process.pid);db.close();
  assert.throws(()=>resumeWorkspace(h.c,'true'),/WORKER_STILL_RUNNING/);const clear=new DatabaseSync(path.join(h.c.dataDir,'ledger.sqlite'));clear.exec('DELETE FROM lease');clear.close();
  assert.equal(resumeWorkspace(h.c,'true').resumed,true);assert.equal(workspaceStatus(h.c).stopped,false);
 }finally{h.close();}
});
test('stop refuses directory indirection and status omits sensitive configuration',()=>{
 const h=fixture();try{
  const c={...h.c,gatewayToken:'DO_NOT_EXPOSE',operatorPublicKey:'KEY',gatewayTokenFile:'/secret/path'};
  assert.doesNotMatch(JSON.stringify(workspaceStatus(c)),/DO_NOT_EXPOSE|KEY|secret\/path/);
  fs.symlinkSync(h.c.dataDir,path.join(h.dir,'linked'));assert.throws(()=>stopWorkspace({...h.c,dataDir:path.join(h.dir,'linked')}),/DIRECTORY_LINK/);
 }finally{h.close();}
});
test('systemd unit uses explicit Linux X11 arguments, no shell or automatic restart and rejects interpolation',()=>{
 const h=fixture();try{
  const options={configFile:'/home/test/Work Files/native-config.json',recipientKey:'/home/test/private/recipient.pem',node:'/usr/bin/node',cli:'/home/test/cli.mjs',env:{XDG_SESSION_TYPE:'x11',DISPLAY:':0',XAUTHORITY:'/home/test/.Xauthority',XDG_RUNTIME_DIR:'/run/user/'+process.getuid(),DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+process.getuid()+'/bus'}};
  const unit=serviceUnit(h.c,options);assert.match(unit,/"\/home\/test\/Work Files\/native-config.json"/);assert.match(unit,/Restart=no/);assert.match(unit,/Environment="XDG_RUNTIME_DIR=/);assert.match(unit,/Environment="DBUS_SESSION_BUS_ADDRESS=unix:path=/);assert.match(unit,/PartOf=graphical-session.target/);assert.doesNotMatch(unit,/\/bin\/(?:ba)?sh|PRIVATE KEY/);
  for(const suffix of ['\nExecStart=bad','%n','$HOME'])assert.throws(()=>serviceUnit(h.c,{...options,configFile:'/home/test/'+suffix}),/SERVICE_ARGUMENT/);
  assert.throws(()=>serviceUnit(h.c,{...options,env:{XDG_SESSION_TYPE:'wayland',DISPLAY:':0'}}),/X11_SESSION_REQUIRED/);
  assert.throws(()=>serviceUnit(h.c,{...options,env:{XDG_SESSION_TYPE:'x11',DISPLAY:'remote.example:0'}}),/X11_SESSION_REQUIRED/);
 }finally{h.close();}
});
test('service names separate workspaces; STOP prevents service startup before any systemctl call',()=>{
 const h=fixture();try{
  const other=path.join(h.dir,'other');fs.mkdirSync(other,{mode:0o700});assert.notEqual(serviceName(h.c),serviceName({...h.c,dataDir:other}));
  const calls=[],run=(...args)=>calls.push(args);stopWorkspace(h.c);assert.throws(()=>serviceCommand(h.c,'start',{run}),/STOP_REQUESTED/);assert.equal(calls.length,0);
  serviceCommand(h.c,'stop',{run});assert.deepEqual(calls[0].slice(0,2),['systemctl',['--user','stop',serviceName(h.c)]]);
 }finally{h.close();}
});
test('noninteractive launcher is useful and errors do not disclose arbitrary exception payloads',()=>{
 const result=spawnSync(process.execPath,['launch.mjs'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/interactive terminal/);assert.match(result.stdout,/QUICKSTART.md/);
 assert.doesNotMatch(friendlyError(Error('token=SECRET')),/SECRET/);assert.match(friendlyError(Error('WORKFORCE_SCOPED_BROKER_ADAPTER_REQUIRED')),/unavailable/);
});
test('packet rejects a mismatched operator signing key before touching specification or writing output',async()=>{
 const h=fixture();try {
  const pub=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}),key=path.join(h.dir,'wrong.pem');fs.writeFileSync(key,crypto.generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  // The initialized record must be bound before the normal command dispatcher will reach signing.
  const cfg={...h.c,identityDir:path.join(h.dir,'device'),gatewayURL:'http://127.0.0.1:29501',gatewayTokenFile:path.join(h.dir,'token'),gatewayConfigFile:path.join(h.dir,'gateway'),plannerAgent:'agi-native-planner',nodeId:'test-node',installationSha256:'a'.repeat(64),gatewayConfigSha256:'b'.repeat(64),appBundlePath:'/opt/openclaw',operatorPublicKey:pub,recipientPublicKeys:[crypto.generateKeyPairSync('x25519').publicKey.export({format:'pem',type:'spki'})],limits:{maxActions:1,maxModelCalls:1,maxSeconds:60,maxRuns24h:1},costPolicy:{modelCallReserveUSDC:'1',actionReserveUSDC:'0',fixedRunReserveUSDC:'0',maxDailyReserveUSDC:'1'},qualificationPolicyFile:null,qualificationEvidenceFile:null,receiptPublicKey:null};
  const file=path.join(h.dir,'config.json'),out=path.join(h.dir,'packet.json');fs.writeFileSync(file,JSON.stringify(cfg),{mode:0o600});
  await assert.rejects(main(['packet','--config',file,'--spec','/does/not/exist','--inputs',h.dir,'--signing-key',key,'--out',out]),/AUTHORITY_SIGNER/);assert.equal(fs.existsSync(out),false);
 }finally{h.close();}
});
