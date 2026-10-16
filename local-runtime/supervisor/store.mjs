import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ROOT, need, id, canonical, parseStrict, digest} from '../contracts.mjs';
import {readPrivate} from '../private-file.mjs';
export {readPrivate} from '../private-file.mjs';

export function privateDirectory(directory, {create = false} = {}) {
  need(path.isAbsolute(directory) && directory === path.resolve(directory) && !directory.startsWith(ROOT), 'STATE_OUTSIDE_CHECKOUT_REQUIRED');
  if (create) fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const st = fs.lstatSync(directory);
  need(st.isDirectory() && !st.isSymbolicLink() && fs.realpathSync(directory) === directory && st.uid === process.getuid() && !(st.mode & 0o077), 'PRIVATE_STATE_REQUIRED');
  return directory;
}
export class Store {
  constructor(directory, {create = false} = {}) {
    this.directory = privateDirectory(directory, {create});
    const file = path.join(directory, 'ledger.sqlite');
    if (fs.existsSync(file)) readPrivate(file, 256_000_000);
    else { need(create, 'INSTALL_REQUIRED'); const fd=fs.openSync(file,'wx',0o600); fs.closeSync(fd); }
    for (const suffix of ['-wal','-shm','-journal']) if (fs.existsSync(file+suffix)) readPrivate(file+suffix,256_000_000);
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actors(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES actors(id), value TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES actors(id), grant_id TEXT UNIQUE NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS clients(hash TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journeys(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, value TEXT NOT NULL);
    `);
    if (!this.meta('schema')) {
      need(create, 'STATE_VERSION');
      this.transaction(() => { this.set('schema', 'agi-fleet/local-ledger/v1'); this.set('host', id()); this.set('controller',id()); this.set('stopped',false); this.set('paused',false); this.set('clock',0); this.set('maxRuns',256); this.set('maxConcurrent',2); });
    }
    need(this.meta('schema') === 'agi-fleet/local-ledger/v1', 'STATE_VERSION');
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  meta(key) { const r=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return r ? parseStrict(r.value) : null; }
  set(key,value) { this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,canonical(value)); }
  actor(actor) { const r=this.db.prepare('SELECT value FROM actors WHERE id=?').get(actor); need(r,'ACTOR_UNKNOWN'); return parseStrict(r.value); }
  saveActor(actor) { this.db.prepare('INSERT INTO actors VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(actor.id,canonical(actor)); }
  listActors() { return this.db.prepare('SELECT value FROM actors ORDER BY rowid').all().map(r=>parseStrict(r.value)); }
  event(kind,body) { const prior=this.db.prepare('SELECT value FROM events ORDER BY seq DESC LIMIT 1').get(); const value={kind,body,previous:prior?digest(prior.value):null}; this.db.prepare('INSERT INTO events(value) VALUES(?)').run(canonical(value)); }
  recover({forceStop=false}={}) {
    this.transaction(()=>{
      const active=this.db.prepare("SELECT id,actor FROM runs WHERE state='running'").all();
      this.db.prepare("UPDATE grants SET state='revoked' WHERE state IN ('prepared','authorized')").run();
      this.db.prepare("UPDATE runs SET state='uncertain' WHERE state='running'").run();
      if(active.length){this.set('stopped',true);this.event('restart-needs-reconciliation',active);}
      if(forceStop){
        this.set('stopped',true);
        for(const actor of this.listActors()){actor.active=false;actor.host=null;actor.generation++;this.saveActor(actor);}
        this.event('explicit-service-recovery',{interrupted:active.map(r=>r.id),authority:'none'});
      }
    });
  }
  close() { this.db.close(); }
}
