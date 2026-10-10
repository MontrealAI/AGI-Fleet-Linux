import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonical,sha256} from '../src/util.mjs';
import {sqliteSecurityProjection} from '../compute/setup-runtime-sqlite.mjs';
import {localizeRuntimeState,safeRuntimeStateLocalization} from '../compute/setup-runtime-state-localization.mjs';
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
const relative='state/openclaw.sqlite';
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'agi-state-localization-')),source=path.join(base,'installed');fs.mkdirSync(path.join(source,'state'),{recursive:true,mode:0o700});
 const file=path.join(source,relative);fs.writeFileSync(file,'',{mode:0o600});const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;'+contract.state.sql+';PRAGMA user_version=17');
 db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary','global',17,null,'2026.9.5',1,1);
 db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('auth.sharedStore','{"mode":"shared"}',1);
 const read=()=>sqliteSecurityProjection(file,{root:source,profileDir:source,relative,diagnostics:true});const initial=read();
 const sealedRecord={version:1,immutableDigest:'1'.repeat(64),sqliteSecurityDigests:{[relative]:initial.sha256},contract:{version:1,phase:'sealed',profileDir:source,registryAliases:[],authStaging:[],sqliteSchemaGuards:{[relative]:initial.schemaObjects}}};sealedRecord.digest=sha256(canonical({contract:sealedRecord.contract,immutableDigest:sealedRecord.immutableDigest,sqliteSecurityDigests:sealedRecord.sqliteSecurityDigests}));
 const copy=name=>{const root=path.join(base,name);fs.mkdirSync(path.join(root,'state'),{recursive:true,mode:0o700});for(const suffix of ['','-wal','-journal'])if(fs.existsSync(file+suffix))fs.copyFileSync(file+suffix,path.join(root,relative)+suffix);return root;};
 const previousRoot=copy('previous-copy');t.after(()=>{db.close();fs.rmSync(base,{recursive:true,force:true});});
 return {base,source,file,db,sealedRecord,previousRoot,copy,read,observe:opts=>localizeRuntimeState({currentRoot:copy('current-copy'),previousRoot,sealedRecord,...opts})};
}
function hashes(file){return Object.fromEntries(['','-wal'].map(suffix=>[suffix,sha256(fs.readFileSync(file+suffix))]));}
test('previous projection authenticates only its state component and committed WAL changes produce table and record deltas',t=>{
 const f=fixture(t),before=hashes(f.file);f.db.prepare("UPDATE config_machine_state SET value_json=?,updated_at_ms=2 WHERE state_key='auth.sharedStore'").run('{"mode":"agent"}');
 assert.equal(hashes(f.file)[''],before['']);assert.notEqual(hashes(f.file)['-wal'],before['-wal']);const sourceBefore=hashes(f.file),currentDigest=f.read().sha256;
 const result=f.observe({expectedCurrentSha256:currentDigest});assert.equal(result.status,'LOCALIZED');assert.equal(result.baseline.matchesSealed,true);assert.equal(result.baseline.candidateSha256,result.baseline.expectedSha256);assert.equal(result.matchesObservedAggregate,true);assert.equal(result.current.sha256,currentDigest);
 assert.equal(result.deltas.some(x=>x.kind==='table'&&x.table==='config_machine_state'),true);assert.equal(result.deltas.some(x=>x.kind==='record'&&x.logicalRecord==='auth.sharedStore'&&x.reason==='digest-mismatch'),true);assert.deepEqual(hashes(f.file),sourceBefore);assert.equal(result.historicalCauseEstablished,false);assert.equal(result.reconciliationAuthorized,false);assert.deepEqual(safeRuntimeStateLocalization(result),result);
});
test('current and previous equal sealed component yields an empty localized delta',t=>{const f=fixture(t),result=f.observe();assert.equal(result.status,'LOCALIZED');assert.equal(result.current.sha256,result.baseline.expectedSha256);assert.equal(result.matchesObservedAggregate,null);assert.deepEqual(result.deltas,[]);});
test('missing previous artifact retains current table and record hashes without inventing expected components',t=>{
 const f=fixture(t),result=f.observe({previousRoot:null});assert.equal(result.status,'BASELINE_UNAVAILABLE');assert.equal(result.baseline.available,false);assert.equal(result.baseline.reason,'missing-source-artifact');assert.equal(result.baseline.source,'transaction/previous/state/openclaw.sqlite');assert.ok(result.current.tables.length>50);assert.equal(result.current.tables.find(x=>x.table==='config_machine_state').records[0].logicalRecord,'auth.sharedStore');assert.deepEqual(result.deltas,[]);
});
test('unmatched previous state is not treated as the approved baseline',t=>{
 const f=fixture(t),db=new DatabaseSync(path.join(f.previousRoot,relative));db.prepare("UPDATE config_machine_state SET value_json='{}' WHERE state_key='auth.sharedStore'").run();db.close();const result=f.observe();assert.equal(result.status,'BASELINE_MISMATCH');assert.equal(result.baseline.matchesSealed,false);assert.notEqual(result.baseline.candidateSha256,result.baseline.expectedSha256);assert.deepEqual(result.deltas,[]);assert.ok(result.current.tables.length);
});
test('malformed or unavailable previous state reports exact staged failure while retaining current observation',t=>{
 for(const cause of ['missing','schema']){const f=fixture(t);if(cause==='missing')fs.rmSync(path.join(f.previousRoot,'state'),{recursive:true});else{const db=new DatabaseSync(path.join(f.previousRoot,relative));db.exec('CREATE TABLE unexpected_private_table(value TEXT)');db.close();}const result=f.observe();assert.equal(result.status,'BASELINE_UNAVAILABLE');assert.equal(result.failure.stage,'baseline-projection');assert.equal(result.failure.code,cause==='missing'?'REPAIR_RUNTIME_STATE_SOURCE_MISSING':'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');assert.ok(result.current);assert.deepEqual(result.deltas,[]);assert.equal(JSON.stringify(result).includes('unexpected_private_table'),false);}
});
test('current schema failures remain blocked and observation coherence mismatch cannot yield a bound delta',t=>{
 const f=fixture(t),mismatch=f.observe({expectedCurrentSha256:'0'.repeat(64)});assert.equal(mismatch.status,'BLOCKED');assert.equal(mismatch.failure.stage,'current-coherence');assert.equal(mismatch.failure.code,'SETUP_PROFILE_CHANGED');assert.equal(mismatch.matchesObservedAggregate,false);assert.deepEqual(mismatch.deltas,[]);
 f.db.exec('CREATE TABLE unexpected_authority(value TEXT)');const current=f.copy('changed-current');const result=localizeRuntimeState({currentRoot:current,previousRoot:f.previousRoot,sealedRecord:f.sealedRecord});assert.equal(result.status,'BLOCKED');assert.equal(result.failure.stage,'current-projection');assert.equal(result.failure.code,'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');assert.equal(result.current,null);
});
test('record keys and values remain opaque, including newly committed authority records',t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('customer.email@private.invalid','{"secret":"DO_NOT_EXPORT"}',3);const result=f.observe(),delta=result.deltas.find(x=>x.kind==='record'&&x.reason==='added');assert.ok(delta);assert.match(delta.recordKeySha256,/^[a-f0-9]{64}$/);assert.equal(delta.expectedSha256,null);assert.equal(delta.logicalRecord,undefined);for(const secret of [f.base,'customer.email@private.invalid','DO_NOT_EXPORT','value_json'])assert.equal(JSON.stringify(result).includes(secret),false);
});
test('direct installed or candidate source paths are refused before SQLite opens',t=>{
 const f=fixture(t),before=hashes(f.file),result=localizeRuntimeState({currentRoot:f.source,previousRoot:f.previousRoot,sealedRecord:f.sealedRecord});assert.equal(result.status,'BLOCKED');assert.equal(result.failure.code,'REPAIR_RUNTIME_STATE_COPY_REQUIRED');assert.deepEqual(hashes(f.file),before);
 const originalPrevious=path.join(f.base,'transaction','previous');fs.mkdirSync(path.dirname(originalPrevious),{mode:0o700});fs.cpSync(f.previousRoot,originalPrevious,{recursive:true});const originalBefore=hashes(path.join(originalPrevious,relative));
 const record=structuredClone(f.sealedRecord);record.contract.registryAliases=[path.join(f.base,'transaction','candidate')];record.digest=sha256(canonical({contract:record.contract,immutableDigest:record.immutableDigest,sqliteSecurityDigests:record.sqliteSecurityDigests}));const guarded=localizeRuntimeState({currentRoot:f.copy('other-current'),previousRoot:path.join(f.base,'transaction','previous'),sealedRecord:record});assert.equal(guarded.status,'BASELINE_UNAVAILABLE');assert.equal(guarded.failure.code,'REPAIR_RUNTIME_STATE_COPY_REQUIRED');assert.deepEqual(hashes(path.join(originalPrevious,relative)),originalBefore);assert.equal(fs.existsSync(path.join(originalPrevious,relative)+'-shm'),false);
});
test('record output and deltas are bounded and truncation never fabricates missing records',t=>{
 const f=fixture(t),insert=f.db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)');f.db.exec('BEGIN');for(let i=0;i<600;i++)insert.run('private-'+i,'{"opaque":true}',i);f.db.exec('COMMIT');const result=f.observe();assert.equal(result.status,'LOCALIZED');assert.equal(result.current.tables.find(x=>x.table==='config_machine_state').recordsTruncated,true);assert.ok(result.current.tables.reduce((n,x)=>n+x.records.length,0)<=512);assert.equal(result.deltas.filter(x=>x.kind==='record'&&x.table==='config_machine_state').length,0);assert.ok(result.deltas.some(x=>x.kind==='table'&&x.table==='config_machine_state'));
});
test('sanitizer rejects unknown fields, forged trust, unsanitized record keys, and invalid baseline receipts',t=>{
 const f=fixture(t),result=f.observe();for(const bad of [{...result,raw:'SECRET'}, {...result,reconciliationAuthorized:true}, {...result,historicalCauseEstablished:true}, {...result,status:'BASELINE_UNAVAILABLE'}, {...result,matchesObservedAggregate:false}, {...result,baseline:{...result.baseline,candidateSha256:'0'.repeat(64)}}, {...result,current:{...result.current,tables:[{...result.current.tables[0],table:'secret-name'}]}}, {...result,current:{...result.current,raw:'SECRET'}}])assert.equal(safeRuntimeStateLocalization(bad),null);
 const record=structuredClone(f.sealedRecord);record.digest='0'.repeat(64);const invalid=localizeRuntimeState({currentRoot:f.copy('bad-record-copy'),previousRoot:f.previousRoot,sealedRecord:record});assert.equal(invalid.status,'BLOCKED');assert.equal(invalid.failure.code,'SETUP_RUNTIME_SECURITY_VERSION');assert.equal(invalid.current,null);
});
