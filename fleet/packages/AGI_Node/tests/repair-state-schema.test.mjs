import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {collectStateSchema, safeStateSchemaObservation, inventoryCompute, safeSupportReport, exportSupportReport} from '../compute/repair.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = 'a'.repeat(64);
const sample = () => ({schema:'agi-state-schema-observation/v1',present:true,userVersion:17,schemaSha256:hash,sourceAdmission:{status:'SUPPORTED',requiredColumns:[]},objects:[{type:'table',name:'user_profiles',tableName:'user_profiles',sqlSha256:hash}]});
const stateContract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url),'utf8')).state;
function validState(db) {
 const selected=stateContract.objects.filter(o=>['schema_meta','config_machine_state','user_profiles','user_profile_emails','user_profile_identities'].includes(o.tableName));
 for(const type of ['table','index'])for(const object of selected)if(object.type===type&&object.sql)db.exec(object.sql);
 db.exec('PRAGMA user_version=17');db.prepare('INSERT INTO schema_meta VALUES(?,?,?,?,?,?,?)').run('primary','global',17,null,'2026.9.5',1,1);
}
function fixture(t,role='agent') {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-schema-report-'));fs.chmodSync(home,0o700);t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const profileDir=path.join(home,role==='agent'?'.openclaw-agi-compute':'.openclaw-agi-node-compute');fs.mkdirSync(profileDir,{mode:0o700});
 const settings={home,profileDir,role,gatewayConfig:path.join(profileDir,'openclaw.json'),workspace:path.join(profileDir,'workspace'),signerUID:12345,isolationAcknowledged:true,port:role==='agent'?18894:18898,gatewayPort:role==='agent'?18896:18900,policyHash:hash,maxRuns24h:48,maxImages24h:8};
 for(const [name,value] of Object.entries({'compute-settings.json':settings,'openclaw.json':{tools:{},browser:{ssrfPolicy:{dangerouslyAllowPrivateNetwork:false}}},'agi-compute-profile.json':{version:'1.21.2'}}))fs.writeFileSync(path.join(profileDir,name),JSON.stringify(value),{mode:0o600});
 fs.mkdirSync(path.join(profileDir,'state'),{mode:0o700});
 return {home,profileDir,settings,role};
}
function snapshot(root){const out={};for(const name of fs.readdirSync(root).sort()){const p=path.join(root,name),s=fs.lstatSync(p);out[name]=s.isDirectory()?snapshot(p):{mode:s.mode&0o777,sha256:digest(fs.readFileSync(p)),size:s.size,ino:s.ino,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs};}return out;}
const inventory = f => inventoryCompute({...f,platform:'linux',dependencies:false,probePort:async()=>false,policyCheck:()=>f.settings.policyHash});

test('state schema collection is bounded and uses only its fixed worker with sanitized environment',async()=>{
 let observed;
 const result=await collectStateSchema({profileDir:'/absolute/private-profile',run:async(executable,args,options)=>{observed={executable,args,options};return {status:0,code:'OK',stdout:JSON.stringify({ok:true,result:sample()})};}});
 assert.equal(result.userVersion,17);assert.equal(observed.executable,process.execPath);assert.equal(observed.options.timeoutMs,5000);assert.equal(observed.options.maxBytes,1048576);
 assert.equal(observed.options.env.NODE_OPTIONS,undefined);assert.equal(observed.options.env.OPENCLAW_STATE_DIR,undefined);assert.deepEqual(JSON.parse(observed.options.input),{profileDir:'/absolute/private-profile'});assert.match(observed.args.at(-1),/observeStateSchema/);
});

test('schema sanitizer exports only exact fields and hashes unknown names',()=>{
 const value=sample();value.objects.push({type:'table',name:'PRIVATE_CREDENTIAL_VALUE',tableName:'PRIVATE_CREDENTIAL_VALUE',sqlSha256:'b'.repeat(64)});
 const safe=safeStateSchemaObservation(value),text=JSON.stringify(safe);assert(!text.includes('PRIVATE_CREDENTIAL_VALUE'));assert.match(safe.objects[1].name,/^opaque:[a-f0-9]{64}$/);assert.deepEqual(safeStateSchemaObservation(safe),safe);
 assert.equal(safe.objects[0].name,'user_profiles');assert(!text.includes('CREATE TABLE'));assert.deepEqual(safeStateSchemaObservation({schema:value.schema,present:false}),{schema:value.schema,present:false});
});

test('malformed, overlong, duplicate and extra diagnostic fields fail closed',()=>{
 const variants=[];let v=sample();v.rows=[{secret:'never-export'}];variants.push(v);
 v=sample();v.objects[0].sql='CREATE TABLE secret';variants.push(v);
 v=sample();v.objects[0].name='bad name with secret';variants.push(v);
 v=sample();v.objects[0].type='unexpected';variants.push(v);
 v=sample();v.objects[0].sqlSha256='secret';variants.push(v);
 v=sample();v.objects.push({...v.objects[0]});variants.push(v);
 v=sample();v.objects=Array(2001).fill(v.objects[0]);variants.push(v);
 v=sample();v.userVersion=-1;variants.push(v);
 v=sample();v.userVersion=2**32;variants.push(v);
 v=sample();delete v.sourceAdmission;variants.push(v);
 v=sample();v.sourceAdmission={status:'SUPPORTED',requiredColumns:[],owner:{secret:'PRIVATE'}};variants.push(v);
 v=sample();v.sourceAdmission={status:'SUPPORTED',requiredColumns:['private_secret_column']};variants.push(v);
 v=sample();v.sourceAdmission={status:'SUPPORTED',requiredColumns:['user_profiles.role','user_profiles.role']};variants.push(v);
 v=sample();v.sourceAdmission={status:'BLOCKED',code:'PRIVATE_ARBITRARY_CODE'};variants.push(v);
 variants.push({schema:'agi-state-schema-observation/v1',present:false,secret:'extra'});
 for(const variant of variants)assert.equal(safeStateSchemaObservation(variant),null);
});

test('worker timeout, cancellation, invalid JSON, failure and oversized responses are refused without raw diagnostics',async()=>{
 for(const result of [{status:null,code:'TIMEOUT',stdout:'private'},{status:null,code:'CANCELLED',stdout:'private'},{status:0,code:'OK',stdout:'not JSON PRIVATE'},{status:1,code:'FAILED',stdout:JSON.stringify({ok:false,error:'PRIVATE'})},{status:0,code:'OK',stdout:'x'.repeat(1048577)},{status:0,code:'OK',stdout:JSON.stringify({ok:true,result:sample(),secret:'PRIVATE'})}])await assert.rejects(collectStateSchema({profileDir:'/absolute/profile',run:async()=>result}),{message:'REPAIR_STATE_SCHEMA_UNAVAILABLE'});
});

test('missing database inventory never creates state and reports no schema qualification',async t=>{
 const f=fixture(t),before=snapshot(f.profileDir),report=await inventory(f);assert.deepEqual(snapshot(f.profileDir),before);assert.deepEqual(report.stateSchema,{schema:'agi-state-schema-observation/v1',present:false});assert.equal(report.checks.find(c=>c.id==='state-schema').status,'NOT TESTED');
});

test('real WAL schema is observed without altering any installed main, WAL or SHM bytes',async t=>{
 const f=fixture(t),file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA journal_mode=WAL');validState(db);db.prepare('INSERT INTO user_profiles(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('private-id','PRIVATE_ACCOUNT_SECRET',1,1);
  for(const name of fs.readdirSync(path.dirname(file)))fs.chmodSync(path.join(path.dirname(file),name),0o600);
  const before=snapshot(f.profileDir),report=await inventory(f),after=snapshot(f.profileDir);assert.deepEqual(after,before);assert.equal(report.stateSchema.userVersion,17);assert(report.stateSchema.objects.some(o=>o.name==='user_profiles'));assert.equal(report.checks.find(c=>c.id==='state-schema').code,'STATE_SCHEMA_SIGNATURES_OBSERVED');assert.equal(report.checks.find(c=>c.id==='state-schema-source').code,'STATE_SCHEMA_SOURCE_SUPPORTED');assert.deepEqual(report.stateSchema.sourceAdmission,{status:'SUPPORTED',requiredColumns:[]});
  const exported=safeSupportReport(report);assert(!JSON.stringify(exported).includes('PRIVATE_ACCOUNT_SECRET'));assert(!JSON.stringify(exported).includes('private-id'));assert.deepEqual(exported.stateSchema,report.stateSchema);
  const out=path.join(f.home,'sanitized.json');exportSupportReport(report,out);assert.equal(fs.statSync(out).mode&0o777,0o600);assert.deepEqual(snapshot(f.profileDir),before);
  db.exec("UPDATE user_profiles SET display_name='ANOTHER_PRIVATE_SECRET'");const second=await collectStateSchema({profileDir:f.profileDir});assert.deepEqual(second,report.stateSchema,'Row changes do not enter schema-only signatures');
 }finally{db.close();}
});

test('unexpected schema objects remain blocked and raw object names and DDL do not escape',async t=>{
 const f=fixture(t),file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);db.exec("CREATE TABLE PRIVATE_SECRET_IDENTIFIER (private_value TEXT DEFAULT 'PRIVATE_DEFAULT_SECRET'); INSERT INTO PRIVATE_SECRET_IDENTIFIER VALUES ('PRIVATE_ROW_SECRET')");db.close();fs.chmodSync(file,0o600);
 const before=snapshot(f.profileDir),report=await inventory(f),safe=safeSupportReport(report),text=JSON.stringify(safe);assert.equal(report.checks.find(c=>c.id==='state-schema').status,'BLOCKED');assert.equal(report.checks.find(c=>c.id==='state-schema').code,'REPAIR_STATE_SCHEMA_UNKNOWN_OBJECTS');
 for(const secret of ['PRIVATE_SECRET_IDENTIFIER','PRIVATE_DEFAULT_SECRET','PRIVATE_ROW_SECRET','private_value'])assert(!text.includes(secret),secret);assert.deepEqual(snapshot(f.profileDir),before);assert.match(safe.stateSchema.objects[0].name,/^opaque:/);
});

test('malformed worker observation becomes a bounded inventory blocker without exporting contents',async t=>{
 const f=fixture(t),malformed=sample();malformed.objects[0].sql='PRIVATE_RAW_SQL';const report=await inventoryCompute({...f,platform:'linux',dependencies:false,probePort:async()=>false,policyCheck:()=>f.settings.policyHash,schemaRun:async()=>({status:0,code:'OK',stdout:JSON.stringify({ok:true,result:malformed})})});
 assert.equal(report.checks.find(c=>c.id==='state-schema').code,'REPAIR_STATE_SCHEMA_UNAVAILABLE');assert.equal(safeSupportReport(report).stateSchema,null);assert(!JSON.stringify(report).includes('PRIVATE_RAW_SQL'));
});

test('database symlink is refused and its target remains untouched',async t=>{
 const f=fixture(t),target=path.join(f.home,'private-target');fs.writeFileSync(target,'PRIVATE_FILE_SECRET',{mode:0o600});fs.symlinkSync(target,path.join(f.profileDir,'state/openclaw.sqlite'));
 const report=await inventory(f);assert.equal(report.checks.find(c=>c.id==='state-schema').status,'BLOCKED');assert.equal(report.stateSchema,undefined);assert.equal(fs.readFileSync(target,'utf8'),'PRIVATE_FILE_SECRET');assert(!JSON.stringify(safeSupportReport(report)).includes('PRIVATE_FILE_SECRET'));
});

test('schema diagnostics apply to the Node profile and never substitute the Agent path',async t=>{
 const f=fixture(t,'node'),file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);db.exec('CREATE TABLE user_profiles (id TEXT)');db.close();fs.chmodSync(file,0o600);
 const report=await inventory(f);assert.equal(report.role,'node');assert.equal(report.stateSchema.present,true);assert.equal(fs.existsSync(path.join(f.home,'.openclaw-agi-compute')),false);
});


test('wrong core metadata is separately blocked even when exact schema signatures were collected',async t=>{
 const f=fixture(t),file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);validState(db);db.prepare("UPDATE schema_meta SET app_version=? WHERE meta_key='primary'").run('PRIVATE_UNSUPPORTED_VERSION');db.close();fs.chmodSync(file,0o600);
 const before=snapshot(f.profileDir),report=await inventory(f),safe=safeSupportReport(report);assert.equal(report.checks.find(c=>c.id==='state-schema').code,'STATE_SCHEMA_SIGNATURES_OBSERVED');assert.equal(report.checks.find(c=>c.id==='state-schema-source').status,'BLOCKED');assert.deepEqual(safe.stateSchema.sourceAdmission,{status:'BLOCKED',code:'SETUP_RUNTIME_SQLITE_SECURITY_INVALID'});assert(!JSON.stringify(safe).includes('PRIVATE_UNSUPPORTED_VERSION'));assert.deepEqual(snapshot(f.profileDir),before);
});

test('altered known table definitions cannot become source-admission success',async t=>{
 const f=fixture(t),file=path.join(f.profileDir,'state/openclaw.sqlite'),db=new DatabaseSync(file);validState(db);db.exec('ALTER TABLE user_profiles ADD COLUMN PRIVATE_EXTRA_COLUMN TEXT');db.close();fs.chmodSync(file,0o600);
 const report=await inventory(f),safe=safeSupportReport(report);assert.equal(report.checks.find(c=>c.id==='state-schema-source').status,'BLOCKED');assert.deepEqual(safe.stateSchema.sourceAdmission,{status:'BLOCKED',code:'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED'});assert(!JSON.stringify(safe).includes('PRIVATE_EXTRA_COLUMN'));
});
