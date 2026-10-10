import {preparedSecurityReviewFixture as securityReview,bindPreparedReviewFixture} from './state-preparation-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {beginSetupTransaction,treeIdentity,snapshotProfile,restoreSetupTransaction} from '../compute/setup-transaction.mjs';
import {safeSetupFailure} from '../compute/setup-auth.mjs';

const stop=async()=>{};
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-sqlite-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profileDir=path.join(root,'profile');fs.mkdirSync(profileDir);return {root,profileDir,directory:path.join(root,'transaction')};};
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode:0o600});return file;};
const dbAt=(root,name='state.sqlite')=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE facts(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO facts VALUES(1,\'committed\')');return {file,db};};
const rows=file=>{const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT id,value FROM facts ORDER BY id').all().map(x=>({...x}));}finally{db.close();}};
const r=()=>securityReview({},{},{maxRuns24h:48,maxImages24h:8},{maxRuns24h:48,maxImages24h:8});
function legacyV2(root){const h=crypto.createHash('sha256');const walk=dir=>{for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file);assert.equal(s.isSymbolicLink(),false);if(dir===root&&name==='plugin-skills')continue;if(name.endsWith('-shm')&&fs.existsSync(path.join(dir,name.slice(0,-4))))continue;h.update(path.relative(root,file));h.update('\0');if(s.isDirectory())walk(file);else h.update(fs.readFileSync(file));h.update('\0');}};walk(root);return h.digest('hex');}
function onCandidateWrite(t,f,action){const original=fs.writeFileSync;let called=false;t.mock.method(fs,'writeFileSync',(file,...args)=>{if(!called&&String(file).startsWith(path.join(f.directory,'candidate'))&&String(file).endsWith('.sqlite')){called=true;action();}return original(file,...args);});return ()=>assert.equal(called,true);}

test('real WAL-mode databases can gain sidecars during snapshot without false profile drift',async t=>{
 const f=fixture(t);const names=['agents/agi-checker/agent/openclaw-agent.sqlite','agents/agi-creator/agent/openclaw-agent.sqlite','agents/agi-reviewer/agent/openclaw-agent.sqlite','state/openclaw.sqlite'];
 for(const name of names){const {file,db}=dbAt(f.profileDir,name);db.close();assert.equal(fs.existsSync(file+'-wal'),false);assert.equal(fs.existsSync(file+'-shm'),false);}
 const oldPhysical=legacyV2(f.profileDir),tx=await beginSetupTransaction({...f,stop});assert.equal(tx.state.treeIdentityVersion,3);assert.equal(tx.state.state,'prepared');assert.notEqual(legacyV2(f.profileDir),oldPhysical);assert.equal(treeIdentity(f.profileDir),tx.state.baseIdentity);assert.equal(treeIdentity(tx.candidate),tx.state.baseIdentity);
 for(const name of names)assert.deepEqual(rows(path.join(tx.candidate,name)),[{id:1,value:'committed'}]);
});

test('committed WAL pages absent from the main file are materialized exactly with all rows',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);t.after(()=>db.close());db.exec("INSERT INTO facts VALUES(2,'wal-only');");assert.ok(fs.statSync(file+'-wal').size>0);
 const isolated=put(f.root,'physical-main-only.sqlite',fs.readFileSync(file));const isolatedDB=new DatabaseSync(isolated,{readOnly:true});assert.throws(()=>isolatedDB.prepare('SELECT * FROM facts').all(),/no such table/);isolatedDB.close();
 const before=Buffer.from(db.serialize()),tx=await beginSetupTransaction({...f,stop});const copied=new DatabaseSync(path.join(tx.candidate,'state.sqlite'),{readOnly:true});try{assert.deepEqual(Buffer.from(copied.serialize()),before);assert.equal(copied.prepare('SELECT count(*) AS n FROM facts').get().n,2);}finally{copied.close();}
 assert.deepEqual(rows(file),[{id:1,value:'committed'},{id:2,value:'wal-only'}]);assert.equal(treeIdentity(f.profileDir),treeIdentity(tx.candidate));
});

test('typed values, schema, FTS, sequences and application metadata survive exact SQLite images',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);t.after(()=>db.close());db.exec("PRAGMA application_id=123456; PRAGMA user_version=91; CREATE TABLE typed(id INTEGER PRIMARY KEY AUTOINCREMENT,i INTEGER,r REAL,t TEXT,b BLOB,n); INSERT INTO typed(i,r,t,b,n) VALUES(9223372036854775807,1.25,'nul'||char(0)||'é',x'00ff80',NULL); CREATE INDEX typed_i ON typed(i); CREATE VIRTUAL TABLE search USING fts5(body); INSERT INTO search VALUES('preserved wal phrase'); CREATE VIEW projected AS SELECT i FROM typed;");
 const tx=await beginSetupTransaction({...f,stop}),copy=new DatabaseSync(path.join(tx.candidate,'state.sqlite'),{readOnly:true});try{assert.deepEqual(Buffer.from(copy.serialize()),Buffer.from(db.serialize()));const q=copy.prepare('SELECT i,r,t,b,n FROM typed');q.setReadBigInts(true);const v=q.get();assert.equal(v.i,9223372036854775807n);assert.equal(v.r,1.25);assert.equal(v.t,'nul\0é');assert.deepEqual(Buffer.from(v.b),Buffer.from([0,255,128]));assert.equal(v.n,null);assert.equal(copy.prepare("SELECT count(*) n FROM search WHERE search MATCH 'phrase'").get().n,1);assert.equal(copy.prepare('PRAGMA user_version').get().user_version,91);assert.equal(copy.prepare('PRAGMA application_id').get().application_id,123456);assert.equal(copy.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('typed').seq,1);}finally{copy.close();}
});

test('persistent virtual-table pages do not require loading or executing an unavailable extension',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);t.after(()=>db.close());db.enableDefensive(false);db.exec("CREATE TABLE embeddings_shadow(rowid INTEGER PRIMARY KEY, bytes BLOB); INSERT INTO embeddings_shadow VALUES(1,x'01020304'); PRAGMA writable_schema=ON; INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql) VALUES('table','embeddings','embeddings',0,'CREATE VIRTUAL TABLE embeddings USING unavailable_vec_module(dimensions=4)'); PRAGMA writable_schema=OFF;");
 const tx=await beginSetupTransaction({...f,stop}),copy=new DatabaseSync(path.join(tx.candidate,'state.sqlite'),{readOnly:true});try{assert.deepEqual(Buffer.from(copy.serialize()),Buffer.from(db.serialize()));assert.deepEqual(Buffer.from(copy.prepare('SELECT bytes FROM embeddings_shadow').get().bytes),Buffer.from([1,2,3,4]));assert.match(copy.prepare("SELECT sql FROM sqlite_schema WHERE name='embeddings'").get().sql,/unavailable_vec_module/);}finally{copy.close();}
});

for(const mutation of ['insert','update','delete','schema','metadata','commit-and-revert'])test('real concurrent SQLite '+mutation+' is refused before prepared publication',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);t.after(()=>db.close());const fired=onCandidateWrite(t,f,()=>db.exec({insert:"INSERT INTO facts VALUES(2,'newly-committed')",update:"UPDATE facts SET value='changed' WHERE id=1",delete:'DELETE FROM facts',schema:'CREATE TABLE new_state(value TEXT)',metadata:'PRAGMA user_version=77','commit-and-revert':"UPDATE facts SET value='temporary'; UPDATE facts SET value='committed'"}[mutation]));
 await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_PROFILE_CHANGED/);fired();const state=JSON.parse(fs.readFileSync(path.join(f.directory,'transaction.json'),'utf8'));assert.equal(state.state,'preparing');assert.equal(state.approval,null);assert.ok(fs.existsSync(file));if(mutation==='insert')assert.equal(rows(file).length,2);if(mutation==='commit-and-revert')assert.deepEqual(rows(file),[{id:1,value:'committed'}]);
});

test('another readonly connection may access sidecars during image write without rejection',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);t.after(()=>db.close());const fired=onCandidateWrite(t,f,()=>{const reader=new DatabaseSync(file,{readOnly:true});assert.equal(reader.prepare('SELECT count(*) n FROM facts').get().n,1);reader.close();});const tx=await beginSetupTransaction({...f,stop});fired();assert.equal(tx.state.state,'prepared');assert.deepEqual(rows(path.join(tx.candidate,'state.sqlite')),rows(file));
});

test('an external checkpoint during the guarded interval conservatively requires retry',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);t.after(()=>db.close());const fired=onCandidateWrite(t,f,()=>db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_PROFILE_CHANGED/);fired();const tx=await beginSetupTransaction({...f,stop});assert.equal(tx.state.state,'prepared');
});

for(const target of ['live','candidate'])test('a later committed SQLite change in '+target+' invalidates approval',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);db.close();const tx=await beginSetupTransaction({...f,stop}),review=r();Object.assign(review,bindPreparedReviewFixture(tx,review));tx.approve(review);const file=path.join(target==='live'?f.profileDir:tx.candidate,'state.sqlite'),writer=new DatabaseSync(file);writer.exec("INSERT INTO facts VALUES(2,'later')");writer.close();await assert.rejects(tx.publish({review,validate:()=>assert.fail(),seal:()=>assert.fail()}),target==='live'?/SETUP_PROFILE_CHANGED/:/SETUP_REVIEW_STALE/);assert.equal(rows(file).length,2);
});

test('SQLite committed activity after completion blocks rollback without losing rows',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);db.close();const tx=await beginSetupTransaction({...f,stop}),review=r();Object.assign(review,bindPreparedReviewFixture(tx,review));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});const file=path.join(f.profileDir,'state.sqlite'),writer=new DatabaseSync(file);writer.exec("INSERT INTO facts VALUES(2,'accepted-job')");writer.close();await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_RUNTIME_CHANGED/);assert.equal(rows(file)[1].value,'accepted-job');
});

for(const suffix of ['-wal','-shm'])test('non-SQLite paired '+suffix+' remains durable state',async t=>{
 const f=fixture(t);put(f.profileDir,'state','ordinary-file');put(f.profileDir,'state'+suffix,'first');const first=treeIdentity(f.profileDir);put(f.profileDir,'state'+suffix,'second');assert.notEqual(treeIdentity(f.profileDir),first);const tx=await beginSetupTransaction({...f,stop});assert.equal(fs.readFileSync(path.join(tx.candidate,'state'+suffix),'utf8'),'second');
});
for(const suffix of ['-wal','-shm'])test('orphan '+suffix+' remains durable state',async t=>{
 const f=fixture(t);put(f.profileDir,'absent'+suffix,'first');const first=treeIdentity(f.profileDir);put(f.profileDir,'absent'+suffix,'second');assert.notEqual(treeIdentity(f.profileDir),first);const tx=await beginSetupTransaction({...f,stop});assert.equal(fs.readFileSync(path.join(tx.candidate,'absent'+suffix),'utf8'),'second');
});
for(const suffix of ['-wal','-shm','-journal'])test('SQLite refuses redirected '+suffix+' before opening the database',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);db.close();put(f.root,'foreign','untouched');fs.symlinkSync(path.join(f.root,'foreign'),file+suffix);assert.throws(()=>treeIdentity(f.profileDir),/SETUP_STATE_OWNER_REQUIRED/);await assert.rejects(snapshotProfile(f.profileDir,path.join(f.root,'copy')),/SETUP_STATE_OWNER_REQUIRED/);assert.equal(fs.readFileSync(path.join(f.root,'foreign'),'utf8'),'untouched');
});

test('corrupt recognized SQLite fails closed with a sanitized diagnostic',async t=>{
 const f=fixture(t);put(f.profileDir,'state.sqlite',Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.alloc(150)]));await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_SQLITE_SNAPSHOT_FAILED/);assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'transaction.json'),'utf8')).state,'preparing');assert.equal(safeSetupFailure(Error('SETUP_SQLITE_SNAPSHOT_FAILED')),'SETUP_SQLITE_SNAPSHOT_FAILED');assert.equal(safeSetupFailure(Error('SETUP_SQLITE_SNAPSHOT_UNSUPPORTED')),'SETUP_SQLITE_SNAPSHOT_UNSUPPORTED');assert.equal(safeSetupFailure(Error('SETUP_SNAPSHOT_MISMATCH')),'SETUP_SNAPSHOT_MISMATCH');
});

test('the failed v2 preparing record and full candidate are archived byte-for-byte before v3 retry',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);db.close();put(f.profileDir,'auth-profiles.json','existing-oauth');put(f.profileDir,'compute-journal.json','existing-obligations');put(f.profileDir,'limits.json','{"maxRuns24h":48,"maxImages24h":8}');fs.mkdirSync(f.directory);fs.cpSync(f.profileDir,path.join(f.directory,'candidate'),{recursive:true});const old={schema:1,treeIdentityVersion:2,id:'395fc065-bccb-4170-a398-d059acc39836',state:'preparing',profileDir:f.profileDir,previousExisted:true,baseIdentity:legacyV2(f.profileDir),approval:null};put(f.directory,'transaction.json',JSON.stringify(old));const evidence=fs.readFileSync(path.join(f.directory,'transaction.json'));const candidateImage=fs.readFileSync(path.join(f.directory,'candidate/state.sqlite'));
 const reader=new DatabaseSync(file,{readOnly:true});reader.prepare('SELECT * FROM facts').all();reader.close();assert.notEqual(legacyV2(f.profileDir),old.baseIdentity);
 const tx=await beginSetupTransaction({...f,stop}),archive=f.directory+'-archive-'+old.id;assert.equal(tx.state.treeIdentityVersion,3);assert.notEqual(tx.state.id,old.id);assert.equal(tx.state.approval,null);assert.deepEqual(fs.readFileSync(path.join(archive,'transaction.json')),evidence);assert.deepEqual(fs.readFileSync(path.join(archive,'candidate/state.sqlite')),candidateImage);for(const name of ['auth-profiles.json','compute-journal.json','limits.json'])assert.equal(fs.readFileSync(path.join(tx.candidate,name),'utf8'),fs.readFileSync(path.join(f.profileDir,name),'utf8'));
});

for(const phase of ['prepared','approved'])test('a verified v2 '+phase+' transaction is archived rather than reinterpreted',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');fs.mkdirSync(f.directory);fs.cpSync(f.profileDir,path.join(f.directory,'candidate'),{recursive:true});put(f.directory,'candidate/staged-oauth.json','old-staged-oauth');const old={schema:1,treeIdentityVersion:2,id:crypto.randomUUID(),state:phase,profileDir:f.profileDir,previousExisted:true,baseIdentity:legacyV2(f.profileDir),approval:phase==='approved'?r().digest:null};put(f.directory,'transaction.json',JSON.stringify(old));const bytes=fs.readFileSync(path.join(f.directory,'transaction.json'));const tx=await beginSetupTransaction({...f,stop});assert.equal(tx.state.treeIdentityVersion,3);assert.deepEqual(fs.readFileSync(path.join(f.directory+'-archive-'+old.id,'transaction.json')),bytes);assert.equal(fs.readFileSync(path.join(f.directory+'-archive-'+old.id,'candidate/staged-oauth.json'),'utf8'),'old-staged-oauth');assert.equal(fs.existsSync(path.join(tx.candidate,'staged-oauth.json')),false);
});

test('v2 completed rollback retains its original physical identity semantics',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);db.close();fs.mkdirSync(f.directory);fs.renameSync(f.profileDir,path.join(f.directory,'previous'));fs.cpSync(path.join(f.directory,'previous'),f.profileDir,{recursive:true});const old={schema:1,treeIdentityVersion:2,id:crypto.randomUUID(),state:'complete',profileDir:f.profileDir,previousExisted:true,baseIdentity:legacyV2(path.join(f.directory,'previous')),completedIdentity:legacyV2(f.profileDir),approval:r().digest};put(f.directory,'transaction.json',JSON.stringify(old));const reader=new DatabaseSync(path.join(f.profileDir,'state.sqlite'),{readOnly:true});reader.prepare('SELECT * FROM facts').all();reader.close();await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_RUNTIME_CHANGED/);assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'transaction.json'),'utf8')).treeIdentityVersion,2);
});

for(const when of ['source-recheck','candidate-recheck'])test('commit-and-revert during '+when+' remains detected through the final source guard',async t=>{
 const f=fixture(t),{file,db}=dbAt(f.profileDir);t.after(()=>db.close());const original=DatabaseSync.prototype.serialize;let fired=false,sourceReads=0;
 t.mock.method(DatabaseSync.prototype,'serialize',function(...args){const image=original.apply(this,args),location=this.location();if(location===file)sourceReads++;if(!fired&&(when==='source-recheck'?location===file&&sourceReads===3:String(location).startsWith(path.join(f.directory,'candidate')))){fired=true;db.exec("UPDATE facts SET value='temporary'; UPDATE facts SET value='committed'");}return image;});
 await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_PROFILE_CHANGED/);assert.equal(fired,true);assert.deepEqual(rows(file),[{id:1,value:'committed'}]);
});

test('changed v2 prepared evidence stays intact and cannot be silently translated',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','original');fs.mkdirSync(f.directory);fs.cpSync(f.profileDir,path.join(f.directory,'candidate'),{recursive:true});const old={schema:1,treeIdentityVersion:2,id:crypto.randomUUID(),state:'prepared',profileDir:f.profileDir,previousExisted:true,baseIdentity:legacyV2(f.profileDir),approval:null};put(f.directory,'transaction.json',JSON.stringify(old));const bytes=fs.readFileSync(path.join(f.directory,'transaction.json'));put(f.profileDir,'openclaw.json','changed-live-state');await assert.rejects(beginSetupTransaction({...f,stop}),/SETUP_CANDIDATE_BASE_CHANGED/);assert.deepEqual(fs.readFileSync(path.join(f.directory,'transaction.json')),bytes);assert.equal(fs.existsSync(f.directory+'-archive-'+old.id),false);
});

test('a changed SQLite previous profile prevents rollback',async t=>{
 const f=fixture(t),{db}=dbAt(f.profileDir);db.close();const tx=await beginSetupTransaction({...f,stop}),review=r();Object.assign(review,bindPreparedReviewFixture(tx,review));tx.approve(review);await tx.publish({review,validate:()=>{},seal:()=>{}});await tx.complete(()=>{});const previous=new DatabaseSync(path.join(tx.previous,'state.sqlite'));previous.exec("INSERT INTO facts VALUES(2,'changed-backup')");previous.close();await assert.rejects(restoreSetupTransaction(f.directory,{stop}),/SETUP_ROLLBACK_BACKUP_CHANGED/);assert.equal(rows(path.join(tx.previous,'state.sqlite')).length,2);
});


test('unknown transaction states preserve evidence and refuse any service mutation',async t=>{
 const f=fixture(t);put(f.profileDir,'openclaw.json','unchanged');const record={schema:1,treeIdentityVersion:3,id:crypto.randomUUID(),state:'unknown-future-state',profileDir:f.profileDir,previousExisted:true,baseIdentity:treeIdentity(f.profileDir),approval:null};put(f.directory,'transaction.json',JSON.stringify(record));put(f.directory,'candidate/evidence','preserve');const bytes=fs.readFileSync(path.join(f.directory,'transaction.json'));const neverStop=async()=>assert.fail('must not call stop');await assert.rejects(beginSetupTransaction({...f,stop:neverStop}),/SETUP_TRANSACTION_STATE/);await assert.rejects(restoreSetupTransaction(f.directory,{stop:neverStop}),/SETUP_TRANSACTION_STATE/);assert.deepEqual(fs.readFileSync(path.join(f.directory,'transaction.json')),bytes);assert.equal(fs.readFileSync(path.join(f.directory,'candidate/evidence'),'utf8'),'preserve');assert.equal(safeSetupFailure(Error('SETUP_TRANSACTION_STATE')),'SETUP_TRANSACTION_STATE');
});
