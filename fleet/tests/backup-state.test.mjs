import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Controller} from '../ops/controller.mjs';
import {createServer} from '../ops/server.mjs';
import {config,temp} from './helpers.mjs';
import {openBackup,sealBackup} from '../packages/AGI_Node/src/control/vault.mjs';
const password='PUBLIC Fleet backup fixture only 2026';
function put(home,name,content){const p=path.join(home,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);}
test('Fleet HTTP backup/restore retains exact funding packets, reviewer windows, evidence and reservations',async()=>{
 const home=temp(),target=temp(),c=new Controller(home,'employer'),d=new Controller(target,'employer');let server;
 try{
  await c.unlock(password);await c.wallet('create');await c.save(config('employer',{wallet:c.config.wallet}),{});
  const files={'funding/inbox/offer.json':'{"funding":"packet"}','funding/review-windows/offer.json':'{"reviewerMinutes":90}','funding/evidence/report.json':JSON.stringify({evidence:'x'.repeat(1024*1024)})};
  for(const [name,content] of Object.entries(files))put(home,name,content);
  c.store.db.exec('CREATE TABLE funding_reservations (offer TEXT PRIMARY KEY, cost TEXT, review_windows TEXT)');
  c.store.db.prepare('INSERT INTO funding_reservations VALUES (?,?,?)').run('offer','5000000','retained windows');
  server=await createServer(d);
  const envelope=await c.backup(password),b=await openBackup(envelope,password);
  assert.equal(b.schema,'agi-fleet-backup/v2');assert.equal(b.operational.files.length,3);
  const response=await fetch(server.origin+'/api/restore',{method:'POST',headers:{Origin:server.origin,Authorization:'Bearer '+server.token,'Content-Type':'application/json'},body:JSON.stringify({envelope,password})});
  assert.equal(response.status,200,await response.text());
  for(const [name,content] of Object.entries(files))assert.equal(fs.readFileSync(path.join(target,name),'utf8'),content);
  assert.equal(d.store.db.prepare('SELECT cost FROM funding_reservations').get().cost,'5000000');
  assert.equal(d.store.meta('activation'),null);assert.equal(d.vault.unlocked,false);assert.equal(d.snapshot().paused,true);
  await d.unlock(password);assert.equal(d.config.wallet,c.config.wallet);
 }finally{if(server){server.server.closeAllConnections();await new Promise(r=>server.server.close(r));}await d.close();await c.close();for(const h of [home,target])fs.rmSync(h,{recursive:true,force:true});}
});
test('Fleet corrupted manifest cannot install wallet, database or external paths',async()=>{
 const home=temp(),target=temp(),c=new Controller(home,'employer'),d=new Controller(target,'employer');
 try{
  await c.unlock(password);await c.wallet('create');put(home,'funding/inbox/offer.json','fixture');
  const b=await openBackup(await c.backup(password),password);b.operational.files[0].path='../escape.json';
  await assert.rejects(d.restore(await sealBackup(b,password),password),/BACKUP_STATE_PATH/);
  assert.equal(d.vault.exists,false);assert.equal(d.store.meta('walletAddress'),null);
 }finally{await d.close();await c.close();for(const h of [home,target])fs.rmSync(h,{recursive:true,force:true});}
});
test('Fleet restore rejects database triggers before opening its operational Store',async()=>{
 const home=temp(),target=temp(),c=new Controller(home,'employer'),d=new Controller(target,'employer');
 try{
  await c.unlock(password);await c.wallet('create');
  c.store.db.exec("CREATE TRIGGER untrusted AFTER INSERT ON meta BEGIN DELETE FROM txs; END");
  await assert.rejects(d.restore(await c.backup(password),password),/BACKUP_DATABASE_INVALID/);
  assert.equal(d.vault.exists,false);
 }finally{await d.close();await c.close();for(const h of [home,target])fs.rmSync(h,{recursive:true,force:true});}
});
