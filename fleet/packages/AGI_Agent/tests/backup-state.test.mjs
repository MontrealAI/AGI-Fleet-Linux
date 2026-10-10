import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Controller} from '../src/control/controller.mjs';
import {openBackup,sealBackup} from '../src/control/vault.mjs';
import {Store} from '../src/store.mjs';
import {canonical,sha256} from '../src/util.mjs';
import {buildBundle} from '../src/artifacts.mjs';
const role=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).name.endsWith('agent')?'agent':'node';
const password='PUBLIC backup regression fixture 2026';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'agi-backup-state-'));
async function fixture(){const home=temp(),c=new Controller(home);await c.createVault(password);await c.wallet('create');return {home,c,async close(){await c.close();fs.rmSync(home,{recursive:true,force:true});}};}
function put(home,name,contents){const file=path.join(home,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,contents,{mode:0o600});}
test('encrypted restore preserves admission evidence, review windows and pilot history in a replacement home',async()=>{
 const f=await fixture(),target=temp(),d=new Controller(target);
 const files={'data/admission/inbox/42.json':'{"packet":"fixture"}','data/admission/evidence/report.json':'{"proof":"fixture"}','data/admission/review-windows/42.json':'{"minutes":90}','pilot.json':'{"schema":"agi-pilot-book/v1","runs":[]}'};
 try{
  const store=new Store(f.c.config.dataDir);store.set('reviewTimePolicy',{fixture:'preserve capacity'});store.close();
  for(const [name,bytes] of Object.entries(files))put(f.home,name,bytes);
  put(f.home,'commissioning.json','{"recovery":{"fixture":"old machine"}}');
  put(f.home,'data/activation.json','{"mustNotRestore":true}');
  const id='12345678-1234-4123-8123-123456789abc';
  const specification={schema:'agi-node-job/v1',profile:'computer-work/v1',dataPolicy:'public',title:'Backup fixture',prompt:'Return 42.',inputs:[],outputs:[{name:'answer.txt',mediaType:'text/plain',maxBytes:100,requirement:'42'}],criteria:[{id:'answer',requirement:'42'}]};
  const delivery=buildBundle(specification,new Map([['answer.txt',Buffer.from('42')]]));
  const record={schema:'agi-studio-run/v1',id,role,status:'checked',startedAt:new Date().toISOString(),specification,delivery,deliveryHash:sha256(delivery),specHash:sha256(canonical(specification))};
  put(f.home,'work-studio/'+id+'.json',JSON.stringify(record));
  const backup=await f.c.backup(password),decoded=await openBackup(backup,password);
  assert.equal(decoded.operational.schema,'agi-operational-state/v1');
  await d.restore(backup,password,true);
  for(const [name,bytes] of Object.entries(files))assert.equal(fs.readFileSync(path.join(target,name),'utf8'),bytes);
  assert.equal(d.config.dataDir,path.join(target,'data'));
  assert.deepEqual(d.studio.records[0],record);
  assert.equal(fs.existsSync(path.join(target,'data/activation.json')),false);
  assert.equal(fs.readFileSync(path.join(target,'recovered-commissioning.json'),'utf8'),'{"recovery":{"fixture":"old machine"}}');
  assert.deepEqual(d.operations.records,{});assert.equal(d.settings.restored,true);
  const restored=new Store(d.config.dataDir);assert.deepEqual(restored.meta('reviewTimePolicy'),{fixture:'preserve capacity'});restored.close();
 }finally{await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('failed restore and failed rollback immediately revoke in-memory authority and retain recovery files',async()=>{
 const f=await fixture(),rename=fs.renameSync;
 try{
  const backup=await f.c.backup(password);const originalVault=fs.readFileSync(f.c.vault.file);
  fs.renameSync=(from,to)=>{
   if(to===f.c.configFile&&path.basename(path.dirname(from)).startsWith('restore-'))throw Error('FIXTURE_INSTALL_FAILURE');
   if(to===f.c.vault.file&&path.basename(path.dirname(from)).startsWith('previous-'))throw Error('FIXTURE_ROLLBACK_FAILURE');
   return rename(from,to);
  };
  await assert.rejects(f.c.restore(backup,password,true),/FIXTURE_|RESTORE_INTERRUPTED/);
  assert.equal(f.c.vault.unlocked,false);
  const marker=JSON.parse(fs.readFileSync(path.join(f.home,'restore-in-progress.json')));
  assert.deepEqual(fs.readFileSync(path.join(marker.previous,'vault.json')),originalVault);
  assert.ok(fs.existsSync(marker.staged));
  await assert.rejects(f.c.unlock(password),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
  await assert.rejects(f.c.start('observe'),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
  assert.throws(()=>new Controller(f.home),/RESTORE_INTERRUPTED_RECOVERY_REQUIRED/);
 }finally{fs.renameSync=rename;await f.close();}
});
test('older encrypted backup remains recoverable without claiming omitted operational history',async()=>{
 const f=await fixture(),target=temp(),d=new Controller(target);
 try{
  const b=await openBackup(await f.c.backup(password),password);b.schema=2;delete b.operational;
  put(target,'pilot.json','{"schema":"agi-pilot-book/v1","runs":[{"foreign":true}]}');
  await d.restore(await sealBackup(b,password),password,true);
  assert.equal(d.vault.get('privateKey'),f.c.vault.get('privateKey'));assert.equal(d.settings.restored,true);
  assert.equal(fs.existsSync(path.join(target,'pilot.json')),false);
  assert.ok(fs.readdirSync(target).some(n=>n.startsWith('previous-')&&fs.existsSync(path.join(target,n,'pilot.json'))));
 }finally{await d.close();fs.rmSync(target,{recursive:true,force:true});await f.close();}
});
test('successful rollback preserves original wallet and records but requires explicit unlock',async()=>{
 const f=await fixture(),rename=fs.renameSync;
 try{
  put(f.home,'pilot.json','{"schema":"agi-pilot-book/v1","runs":[]}');
  const original=fs.readFileSync(f.c.vault.file),backup=await f.c.backup(password);
  fs.renameSync=(from,to)=>{if(to===f.c.configFile&&path.basename(path.dirname(from)).startsWith('restore-'))throw Error('FIXTURE_INSTALL_FAILURE');return rename(from,to);};
  await assert.rejects(f.c.restore(backup,password,true),/FIXTURE_INSTALL_FAILURE/);
  assert.equal(f.c.vault.unlocked,false);assert.deepEqual(fs.readFileSync(f.c.vault.file),original);
  assert.equal(fs.existsSync(path.join(f.home,'restore-in-progress.json')),false);
  fs.renameSync=rename;await f.c.unlock(password);assert.equal(f.c.vault.unlocked,true);
  assert.equal(fs.readFileSync(path.join(f.home,'pilot.json'),'utf8'),'{"schema":"agi-pilot-book/v1","runs":[]}');
 }finally{fs.renameSync=rename;await f.close();}
});
test('tampered operational backup fails before changing the existing wallet or history',async()=>{
 const f=await fixture();
 try{
  put(f.home,'data/admission/inbox/42.json','original evidence');
  const b=await openBackup(await f.c.backup(password),password),original=fs.readFileSync(f.c.vault.file);
  b.operational.files[0].sha256='0'.repeat(64);
  await assert.rejects(f.c.restore(await sealBackup(b,password),password,true),/BACKUP_STATE_INTEGRITY/);
  assert.deepEqual(fs.readFileSync(f.c.vault.file),original);
  assert.equal(fs.readFileSync(path.join(f.home,'data/admission/inbox/42.json'),'utf8'),'original evidence');
 }finally{await f.close();}
});
