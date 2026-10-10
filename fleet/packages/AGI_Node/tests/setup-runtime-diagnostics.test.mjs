import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical,sha256} from '../src/util.mjs';
import {captureRuntimeSecurityIdentity,captureRuntimeSecurityComponents,captureRuntimeImmutableComponents,assertRuntimeSecurityIdentity,inspectRuntimeSecurityIdentity,safeRuntimeIdentityDiagnostic} from '../compute/setup-runtime-identity.mjs';
import {sqliteSecurityProjection} from '../compute/setup-runtime-sqlite.mjs';
import {runtimeDatabase} from './runtime-sqlite-fixture.mjs';
const write=(root,name,value)=>fs.writeFileSync(path.join(root,name),value,{mode:0o600});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'agi-runtime-diagnostics-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));write(root,'openclaw.json','{"gateway":{"bind":"loopback"},"secret":"credential-canary"}\n');write(root,'compute-settings.json','{"policyHash":"sealed","limits":48}');return root;}
function rejected(root,record,options){let error;try{assertRuntimeSecurityIdentity(root,record,options);}catch(value){error=value;}assert.ok(error,'identity must reject');return error;}
function legacy(record){const result=structuredClone(record);delete result.diagnosticDetails;return result;}

test('diagnostic inventory binds exactly to the unchanged immutable aggregate and records contain no file contents',t=>{
 const root=fixture(t),record=captureRuntimeSecurityIdentity(root),entries=record.diagnosticDetails.immutableEntries;
 assert.equal(sha256(canonical(entries)),record.immutableDigest);assert.equal(sha256(canonical({contract:record.contract,immutableDigest:record.immutableDigest,sqliteSecurityDigests:record.sqliteSecurityDigests})),record.digest);
 assert.equal(JSON.stringify(record.diagnosticDetails).includes('credential-canary'),false);assert.equal(assertRuntimeSecurityIdentity(root,legacy(record)).digest,record.digest);
 const result=inspectRuntimeSecurityIdentity(root,record,{phase:'report-only'});assert.equal(result.captureComplete,true);assert.equal(result.captureFailureCode,null);assert.deepEqual(result.deltas,[]);assert.equal(result.legacyBaselineDetailAvailable,true);
});
test('changed protected config reports bound before/after bytes without contents or absolute paths',t=>{
 const root=fixture(t),record=captureRuntimeSecurityIdentity(root),before=sha256(fs.readFileSync(path.join(root,'openclaw.json')));write(root,'openclaw.json','{"gateway":{"bind":"public"},"secret":"new-secret-canary"}');const after=sha256(fs.readFileSync(path.join(root,'openclaw.json')));
 const error=rejected(root,record,{phase:'completion-after-readiness'}),d=error.runtimeIdentityDiagnostic;assert.equal(error.message,'SETUP_PROFILE_CHANGED');assert.equal(d.phase,'completion-after-readiness');assert.equal(d.captureComplete,true);
 assert.ok(d.deltas.some(delta=>delta.path==='openclaw.json'&&delta.kind==='config-json'&&delta.beforeSha256===before&&delta.afterSha256===after&&delta.baselineTrust==='bound'));
 for(const secret of [root,'credential-canary','new-secret-canary','gateway','public'])assert.equal(JSON.stringify(d).includes(secret),false,secret);
});
test('unknown protected paths remain fail-closed and export only an opaque path hash',t=>{
 const root=fixture(t),name='private-customer-name-token',record=captureRuntimeSecurityIdentity(root);write(root,name,'private-content-canary');const d=rejected(root,record).runtimeIdentityDiagnostic;
 assert.ok(d.deltas.some(delta=>delta.pathSha256===sha256(name)&&delta.reason==='added'));for(const secret of [name,root,'private-content-canary'])assert.equal(JSON.stringify(d).includes(secret),false);
});
test('legacy records retain aggregate checks and explicitly lack historical per-file baseline',t=>{
 const root=fixture(t),record=legacy(captureRuntimeSecurityIdentity(root));write(root,'openclaw.json','{}');const d=rejected(root,record).runtimeIdentityDiagnostic;
 assert.equal(d.legacyBaselineDetailAvailable,false);assert.equal(d.componentBaselineTrust,'unavailable');assert.ok(d.deltas.some(delta=>delta.kind==='immutable-tree'));assert.equal(d.deltas.some(delta=>delta.path==='openclaw.json'),false);
});
test('early derived-cache mismatch reports exact same-capture config/cache hashes even for legacy records',t=>{
 const root=fixture(t),record=legacy(captureRuntimeSecurityIdentity(root)),config=fs.readFileSync(path.join(root,'openclaw.json'));write(root,'openclaw.json.last-good','{"secret":"different-cache-canary"}');
 const error=rejected(root,record,{phase:'rollback-before-restore'}),d=error.runtimeIdentityDiagnostic;assert.equal(error.message,'SETUP_PROFILE_CHANGED');assert.equal(d.captureComplete,false);assert.equal(d.captureFailureCode,'SETUP_PROFILE_CHANGED');
 const delta=d.deltas.find(item=>item.kind==='derived-config');assert.equal(delta.path,'openclaw.json.last-good');assert.equal(delta.beforeSha256,sha256(config));assert.equal(delta.afterSha256,sha256(fs.readFileSync(path.join(root,'openclaw.json.last-good'))));assert.equal(delta.baselineTrust,'observed-same-capture');assert.equal(delta.comparisonBasis,'current-config-versus-current-cache');assert.equal(d.legacyBaselineDetailAvailable,false);assert.equal(JSON.stringify(d).includes('different-cache-canary'),false);
 write(root,'openclaw.json.last-good',JSON.stringify(JSON.parse(config)));assert.equal(rejected(root,record).message,'SETUP_PROFILE_CHANGED');
});
test('forged unbound inventories cannot create a trusted path delta or change acceptance',t=>{
 const root=fixture(t),record=captureRuntimeSecurityIdentity(root);record.diagnosticDetails.immutableEntries[0][3]='f'.repeat(64);write(root,'openclaw.json','{}');const d=rejected(root,record).runtimeIdentityDiagnostic;
 assert.equal(d.legacyBaselineDetailAvailable,false);assert.equal(d.componentBaselineTrust,'invalid');assert.ok(d.deltas.some(delta=>delta.reason==='baseline-detail-invalid'));assert.equal(d.deltas.some(delta=>delta.kind==='config-json'),false);
});
test('SQLite logical security changes report table and allowlisted key hashes without values',t=>{
 const root=fixture(t),f=runtimeDatabase(root,'state');t.after(()=>f.db.close());const record=captureRuntimeSecurityIdentity(root);f.db.prepare("UPDATE config_machine_state SET value_json=? WHERE state_key='authProfiles.state'").run(JSON.stringify({version:1,order:{anthropic:['private-provider-profile-canary']}}));
 const error=rejected(root,record),d=error.runtimeIdentityDiagnostic;assert.equal(error.message,'SETUP_PROFILE_CHANGED');const table=d.deltas.find(delta=>delta.table==='config_machine_state'&&delta.kind==='sqlite-security-projection'),row=d.deltas.find(delta=>delta.kind==='sqlite-logical-record'&&delta.logicalRecord==='authProfiles.state');assert.ok(table);assert.ok(row);assert.equal(row.baselineTrust,'advisory-unbound');assert.match(row.recordKeySha256,/^[a-f0-9]{64}$/);assert.notEqual(row.beforeSha256,row.afterSha256);
 assert.equal(d.expected.immutableDigest,d.actual.immutableDigest);assert.notEqual(d.expected.sqliteSecurityDigests['state/openclaw.sqlite'],d.actual.sqliteSecurityDigests['state/openclaw.sqlite']);for(const secret of [root,'private-provider-profile-canary','anthropic','value_json'])assert.equal(JSON.stringify(d).includes(secret),false,secret);
});
test('unknown logical keys export only hashes and optional diagnostics do not alter SQLite projection',t=>{
 const root=fixture(t),f=runtimeDatabase(root,'state');t.after(()=>f.db.close());const options={root,relative:'state/openclaw.sqlite',profileDir:root};const plain=sqliteSecurityProjection(f.file,options),detailed=sqliteSecurityProjection(f.file,{...options,diagnostics:true});assert.equal(plain.sha256,detailed.sha256);assert.deepEqual(Object.keys(plain).sort(),['kind','schema','schemaObjects','sha256']);
 const record=captureRuntimeSecurityIdentity(root);f.db.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('private-key-canary','{"private-value-canary":true}',1);const d=rejected(root,record).runtimeIdentityDiagnostic;assert.ok(d.deltas.some(delta=>delta.kind==='sqlite-logical-record'&&delta.reason==='added'));for(const secret of ['private-key-canary','private-value-canary'])assert.equal(JSON.stringify(d).includes(secret),false);
});
test('known missing-meta config observation remains runtime bookkeeping and does not by itself change identity',t=>{
 const root=fixture(t),f=runtimeDatabase(root,'state');t.after(()=>f.db.close());const record=captureRuntimeSecurityIdentity(root);f.db.prepare('INSERT INTO config_health_entries VALUES(?,?,?,?,?)').run(path.join(root,'openclaw.json'),JSON.stringify({hash:'a'.repeat(64),bytes:100,hasMeta:true,gatewayMode:'local',observedAt:'2026-10-04'}),null,'missing-meta-vs-last-good',10);
 const d=inspectRuntimeSecurityIdentity(root,record);assert.equal(d.captureFailureCode,null);assert.deepEqual(d.deltas,[]);assert.equal(d.actual.digest,record.digest);
});
test('required auth-order validation failure identifies SQLite table and preserves fail-closed code',t=>{
 const root=fixture(t),f=runtimeDatabase(root,'agent','agi-creator');t.after(()=>f.db.close());const record=captureRuntimeSecurityIdentity(root,{authStaging:[{agent:'agi-creator',provider:'openai',order:['openai:agi-compute-pro'],storage:'openclaw-agent-sqlite',verified:true}]});f.db.prepare("UPDATE auth_profile_state SET state_json=? WHERE state_key='primary'").run('{"version":1,"order":{"openai":["unapproved-secret-canary"]}}');
 const error=rejected(root,record),d=error.runtimeIdentityDiagnostic;assert.equal(error.message,'SETUP_RUNTIME_SQLITE_SECURITY_INVALID');assert.equal(d.captureComplete,false);assert.ok(d.deltas.some(delta=>delta.path==='agents/agi-creator/agent/openclaw-agent.sqlite'&&delta.table==='auth_profile_state'&&delta.reason==='projection-validation-failed'));assert.equal(JSON.stringify(d).includes('unapproved-secret-canary'),false);
});
test('file read races report metadata hashes from the failed capture without a diagnostic recapture',t=>{
 const root=fixture(t),record=captureRuntimeSecurityIdentity(root),file=path.join(root,'openclaw.json'),originalRead=fs.readFileSync,originalOpen=fs.openSync;let targetFd,reads=0,written=false;
 t.mock.method(fs,'openSync',(name,...args)=>{const fd=originalOpen(name,...args);if(name===file)targetFd=fd;return fd;});t.mock.method(fs,'readFileSync',(name,...args)=>{const result=originalRead(name,...args);if(name===targetFd){reads++;if(!written){written=true;write(root,'openclaw.json','{"changed":"during-read"}');}}return result;});
 const error=rejected(root,record),d=error.runtimeIdentityDiagnostic;assert.equal(error.message,'SETUP_PROFILE_CHANGED');assert.equal(reads,1);assert.equal(d.captureComplete,false);const delta=d.deltas.find(item=>item.kind==='file-metadata');assert.equal(delta.path,'openclaw.json');assert.match(delta.beforeSha256,/^[a-f0-9]{64}$/);assert.match(delta.afterSha256,/^[a-f0-9]{64}$/);assert.notEqual(delta.beforeSha256,delta.afterSha256);
});
test('diagnostic sanitizer drops hostile fields, codes, names, phases and raw values',()=>{
 const d=safeRuntimeIdentityDiagnostic({schema:'agi-runtime-identity-diagnostic/v1',phase:'phase-secret-canary',captureFailureCode:'SETUP_SECRET_CANARY',secret:'outer-secret-canary',expected:{digest:'a'.repeat(64),immutableDigest:'b'.repeat(64),sqliteSecurityDigests:{'secret-path-canary':'c'.repeat(64)}},deltas:[{kind:'protected-file',reason:'digest-mismatch',path:'/private/home/secret-path-canary',table:'secret-table-canary',logicalRecord:'secret-row-canary',recordKeySha256:'d'.repeat(64),beforeSha256:'e'.repeat(64),afterSha256:'f'.repeat(64),raw:'raw-secret-canary'}]});
 assert.equal(d.phase,'unspecified');assert.equal(d.captureFailureCode,'SETUP_RUNTIME_IDENTITY_CAPTURE_FAILED');for(const secret of ['phase-secret-canary','SETUP_SECRET_CANARY','outer-secret-canary','secret-path-canary','secret-table-canary','secret-row-canary','raw-secret-canary'])assert.equal(JSON.stringify(d).includes(secret),false);assert.match(d.deltas[0].pathSha256,/^[a-f0-9]{64}$/);assert.match(d.deltas[0].tableSha256,/^[a-f0-9]{64}$/);assert.deepEqual(d,safeRuntimeIdentityDiagnostic(d));
});
test('oversized optional immutable detail is omitted without changing acceptance',t=>{
 const root=fixture(t);for(let i=0;i<800;i++)write(root,'long-protected-name-'+String(i).padStart(4,'0')+'-'.repeat(60),'fixture');const record=captureRuntimeSecurityIdentity(root);assert.equal(record.diagnosticDetails,undefined);assert.equal(assertRuntimeSecurityIdentity(root,record).digest,record.digest);assert.equal(inspectRuntimeSecurityIdentity(root,record).legacyBaselineDetailAvailable,false);
});

test('complete disposable diagnostic tuples survive the receipt detail cap without changing security identity',t=>{
 const root=fixture(t);for(let i=0;i<800;i++)write(root,'large-protected-entry-'+String(i).padStart(4,'0')+'-'.repeat(60),'fixture');
 const record=captureRuntimeSecurityIdentity(root),full=captureRuntimeSecurityComponents(root,record.contract);
 assert.equal(record.diagnosticDetails,undefined);assert.deepEqual(full.identity,record);assert.equal(full.components.immutableEntries.length,802);assert.equal(sha256(canonical(full.components.immutableEntries)),record.immutableDigest);
 assert.equal(JSON.stringify(full.components).includes('credential-canary'),false);write(root,'openclaw.json','{"changed":true}');assert.equal(rejected(root,record).message,'SETUP_PROFILE_CHANGED');
});
test('previous immutable-only observation does not admit legacy SQLite into current security checks',t=>{
 const root=fixture(t),f=runtimeDatabase(root,'state');t.after(()=>f.db.close());f.db.exec('CREATE TABLE legacy_unrecognized(value TEXT)');
 assert.throws(()=>captureRuntimeSecurityIdentity(root),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);const observed=captureRuntimeImmutableComponents(root);
 assert.equal(observed.immutableEntries.some(e=>e[0]==='state/openclaw.sqlite'),false);assert.equal(sha256(canonical(observed.immutableEntries)),observed.immutableDigest);
 fs.symlinkSync(path.join(root,'openclaw.json'),path.join(root,'unexpected-link'));assert.throws(()=>captureRuntimeImmutableComponents(root),/SETUP_STATE_OWNER_REQUIRED/);
});


test('cleanup audit growth is mutable while config changes and unsafe audit objects remain protected',t=>{
 const root=fixture(t),record=captureRuntimeSecurityIdentity(root);
 for(const name of ['cleanup-evidence','cleanup-history']){fs.mkdirSync(path.join(root,name),{mode:0o700});fs.writeFileSync(path.join(root,name,'retained.json'),'{}',{mode:0o600});}
 assert.equal(assertRuntimeSecurityIdentity(root,record).digest,record.digest);
 fs.chmodSync(path.join(root,'cleanup-history','retained.json'),0o700);assert.throws(()=>assertRuntimeSecurityIdentity(root,record),/SETUP_STATE_FILE_UNSUPPORTED/);
 fs.chmodSync(path.join(root,'cleanup-history','retained.json'),0o600);write(root,'compute-settings.json','{"limits":999}');assert.throws(()=>assertRuntimeSecurityIdentity(root,record),/SETUP_PROFILE_CHANGED/);
});
