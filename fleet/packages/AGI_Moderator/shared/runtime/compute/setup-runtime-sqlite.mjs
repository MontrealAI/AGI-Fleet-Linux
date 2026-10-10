import {ALL_OAUTH_ROLES} from './roles.mjs';
import {assertPinnedTelemetryUpdateState,PINNED_TELEMETRY_STATE_KEY} from './setup-telemetry-policy.mjs';
import {assertRemoteModelCatalogCache} from './setup-model-catalog-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const contract=JSON.parse(fs.readFileSync(new URL('./setup-runtime-sqlite-contract.json',import.meta.url),'utf8'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const need=(ok,code='SETUP_RUNTIME_SQLITE_SECURITY_INVALID')=>{if(!ok)throw Error(code);};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Uint8Array);
const canonical=v=>typeof v==='bigint'?JSON.stringify({sqliteInteger:String(v)}):v instanceof Uint8Array?JSON.stringify({sqliteBlob:Buffer.from(v).toString('hex')}):Array.isArray(v)?'['+v.map(canonical).join(',')+']':record(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const omit=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([key])=>!keys.includes(key)));
const schemaSQL=sql=>sql===null?null:sql.replace(/('(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)|\s+/g,(token,quoted)=>quoted?token:' ').trim();
const json=value=>{need(typeof value==='string'&&Buffer.byteLength(value)<=16*1024*1024);let parsed;try{parsed=JSON.parse(value);}catch{need(false);}need(record(parsed));return parsed;};
const names=ALL_OAUTH_ROLES;
export const RUNTIME_SQLITE_PATHS=Object.freeze(['state/openclaw.sqlite',...names.map(n=>`agents/${n}/agent/openclaw-agent.sqlite`)]);
// These are application data and bookkeeping, not approved policy or executable
// configuration. Their bytes are retained in the stopped runtime snapshot.
const agentRuntime=new Set(['sqlite_sequence','session_nodes','session_participants','session_key_contract','session_windows','session_canonical_validation_pending','conversations','conversation_deliveries','session_conversations','session_members','session_suggestions','board_tabs','board_widgets','session_progress_cards','heartbeat_outcomes','message_tool_run_outcomes','session_goal_operations','transcript_events','session_transcript_archives','session_transcript_cold_archives','transcript_rewrite_watermarks','trajectory_runtime_events','acp_parent_stream_events','transcript_event_identities','context_engine_turn_outbox','cache_entries','memory_index_meta','memory_index_sources','memory_index_chunks','memory_index_chunk_recall_metadata','memory_index_chunk_provenance','memory_entry_origins','memory_session_tombstones','memory_embedding_cache','memory_index_state','session_transcript_index_state','session_transcript_active_events','session_transcript_fts','session_pending_inputs','session_input_completions']);
const stateRuntime=new Set(['sqlite_sequence','diagnostic_events','skill_usage','audit_events','session_state_events','session_state_heads','session_watch_cursors','session_upstream_links','gateway_boot_lifecycle','capture_sessions','capture_blobs','capture_events']);
const derivedCheckpoints=new Set(['startup-migrations','state-migrations']);
const contractDigest=sha(canonical({contract,agentRuntime:[...agentRuntime].sort(),stateRuntime:[...stateRuntime].sort()}));
const expected=Object.fromEntries(['agent','state'].map(kind=>[kind,new Map(contract[kind].objects.map(o=>[o.name,o]))]));
function owned(file,{directory=false,optional=false}={}){
 const stat=fs.lstatSync(file,{throwIfNoEntry:!optional});if(!stat)return null;
 need(!stat.isSymbolicLink()&&(!process.getuid||stat.uid===process.getuid()),'SETUP_STATE_OWNER_REQUIRED');
 need(directory?stat.isDirectory():stat.isFile(),'SETUP_STATE_FILE_UNSUPPORTED');
 need(!(stat.mode&0o077)&&(directory||stat.nlink===1),'SETUP_STATE_OWNER_REQUIRED');return stat;
}
function identity(before,after){need(before&&after&&before.dev===after.dev&&before.ino===after.ino&&before.uid===after.uid,'SETUP_PROFILE_CHANGED');}
function sidecars(file){for(const suffix of ['-wal','-shm','-journal'])owned(file+suffix,{optional:true});}
function location(file,{relative,profileDir,root=profileDir}){
 need(typeof file==='string'&&typeof profileDir==='string'&&path.isAbsolute(profileDir)&&typeof root==='string'&&path.isAbsolute(root)&&path.isAbsolute(file)&&RUNTIME_SQLITE_PATHS.includes(relative),'SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED');
 profileDir=path.resolve(profileDir);root=path.resolve(root);need(file===path.join(root,...relative.split('/')),'SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED');
 let directory=root;owned(directory,{directory:true});need(fs.realpathSync(directory)===directory,'SETUP_STATE_OWNER_REQUIRED');
 for(const part of relative.split('/').slice(0,-1)){directory=path.join(directory,part);owned(directory,{directory:true});}
 return {kind:relative==='state/openclaw.sqlite'?'state':'agent',agent:relative.split('/')[1],profileDir,root};
}
function schema(db,kind,requiredSchemaObjects=[],{allowSupportedLegacyUserProfiles=false}={}){
 need(Array.isArray(requiredSchemaObjects)&&requiredSchemaObjects.every(x=>typeof x==='string'),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
 const actual=db.prepare('SELECT type,name,tbl_name AS tableName,sql FROM main.sqlite_schema ORDER BY type,name').all(),tables=new Set(),legacyUserProfiles=[];
 for(const obj of actual){
  const known=expected[kind].get(obj.name);
  const schemaNeed=ok=>{if(ok)return;const error=Error('SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');error.runtimeIdentityDetail={kind:'sqlite-schema',reason:'capture-validation-failed',table:obj.tableName,beforeSha256:known?sha(canonical({...known,sql:schemaSQL(known.sql)})):null,afterSha256:sha(canonical({...obj,sql:schemaSQL(obj.sql)})),baselineTrust:'bound'};throw error;};
  schemaNeed(known&&obj.type===known.type&&obj.tableName===known.tableName);
  const current=[known.sql,...known.sqlVariants??[]].some(sql=>schemaSQL(obj.sql)===schemaSQL(sql));
  const legacy=!current&&allowSupportedLegacyUserProfiles===true&&kind==='state'&&(known.preflightLegacySqlVariants??[]).some(sql=>schemaSQL(obj.sql)===schemaSQL(sql));
  schemaNeed(current||legacy);
  if(legacy){need(known.type==='table'&&typeof known.legacyMissingColumn==='string','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');legacyUserProfiles.push(known.name+'.'+known.legacyMissingColumn);}
  if(obj.type==='table')tables.add(obj.name);
 }
 for(const name of kind==='agent'?['schema_meta','auth_profile_store','auth_profile_state']:['schema_meta','config_machine_state'])need(tables.has(name),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
 // Security tables must be real tables with the pinned schema; their content is
 // never read through an arbitrary view, virtual module or supplied function.
 const schemaObjects=actual.map(obj=>obj.type+':'+obj.name).sort();need(new Set(requiredSchemaObjects).size===requiredSchemaObjects.length&&requiredSchemaObjects.every(x=>schemaObjects.includes(x)),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
 return {tables,schemaObjects,legacyUserProfiles:legacyUserProfiles.sort(),schemaDigest:sha(canonical(actual.map(obj=>({...obj,sql:schemaSQL(obj.sql)}))))};
}
function authState(value,{requiredOpenAIOrder=false}={}){
 const parsed=json(value);need(parsed.version===1);need(parsed.order===undefined||record(parsed.order));
 for(const [provider,order] of Object.entries(parsed.order??{}))need(provider.length>0&&Array.isArray(order)&&order.length>0&&order.every(x=>typeof x==='string'&&x.length>0)&&new Set(order).size===order.length);
 if(requiredOpenAIOrder)need(canonical(parsed.order?.openai)===canonical(['openai:agi-compute-pro']));
 for(const key of ['lastGood','usageStats'])need(parsed[key]===undefined||record(parsed[key]));
 return omit(parsed,['lastGood','usageStats']);
}
function authStore(value){
 const parsed=json(value);need(parsed.version===1&&record(parsed.profiles));const profiles={};
 for(const [id,credential] of Object.entries(parsed.profiles)){
  need(id.length>0&&record(credential)&&typeof credential.provider==='string'&&['api_key','token','oauth'].includes(credential.type));
  if(credential.type==='oauth'&&credential.provider==='openai'&&typeof credential.access==='string'&&typeof credential.refresh==='string'){
   need(credential.access.length>0&&credential.access.length<=65536&&credential.refresh.length>0&&credential.refresh.length<=65536&&typeof credential.expires==='number'&&Number.isFinite(credential.expires)&&credential.expires>0);
   need(credential.idToken===undefined||typeof credential.idToken==='string'&&credential.idToken.length>0&&credential.idToken.length<=65536);
   profiles[id]={...omit(credential,['access','refresh','expires','idToken']),refreshableInlineOAuth:true};
  }else profiles[id]=credential;
 }
 return {...parsed,profiles};
}
function numeric(value){return typeof value==='bigint'?value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER):typeof value==='number'&&Number.isSafeInteger(value);}
function schemaMeta(rows,{kind,agent}){
 const owner=rows.find(row=>row.meta_key==='primary');need(owner&&owner.role===(kind==='agent'?'agent':'global')&&owner.agent_id===(kind==='agent'?agent:null)&&Number(owner.schema_version)===(kind==='agent'?21:17)&&owner.app_version==='2026.9.5');
 return rows.flatMap(row=>{
  if(kind==='state'&&derivedCheckpoints.has(row.meta_key)){
   need(row.role==='global'&&row.agent_id===null&&Number(row.schema_version)===3&&typeof row.app_version==='string');
   const parts=row.app_version.split('\n');need(parts.length===6&&parts[0]==='2026.9.5'&&parts[1]==='3'&&parts.slice(2).every(x=>x.length>0&&x.length<=4096));return [];
  }
  return [omit(row,['updated_at'])];
 });
}
function knownRegistry(row,roots){
 if(!names.includes(row.agent_id))return false;
 const relative=`agents/${row.agent_id}/agent/openclaw-agent.sqlite`;
 return Number(row.schema_version??21)===21&&(row.path===relative||roots.some(root=>row.path===path.join(root,relative)));
}
function projectionRows(table,rows,context){
 const {kind,requiredOpenAIOrder,profileDir,allowedProfileRoots=[profileDir]}=context;
 if(table==='schema_meta')return schemaMeta(rows,context);
 if(kind==='agent'&&table==='auth_profile_state'){
  if(requiredOpenAIOrder)need(rows.some(r=>r.state_key==='primary'));
  return rows.map(row=>row.state_key==='primary'?{state_key:row.state_key,state:authState(row.state_json,{requiredOpenAIOrder})}:row);
 }
 if(kind==='agent'&&table==='auth_profile_store')return rows.map(row=>row.store_key==='primary'?{store_key:row.store_key,store:authStore(row.store_json)}:row);
 if(kind==='state'&&table==='config_machine_state'){need(new Set(rows.map(row=>row.state_key)).size===rows.length);return rows.flatMap(row=>{
  if(row.state_key==='authProfiles.store')return [{state_key:row.state_key,store:authStore(row.value_json)}];
  if(row.state_key==='authProfiles.state')return [{state_key:row.state_key,state:authState(row.value_json)}];
  // The updater's observation cache is not permission to update; executable and
  // update policy files remain part of the sealed filesystem identity.
  if(row.state_key==='update.checkState'){json(row.value_json);return [];}
  if(row.state_key==='modelCatalog.remote'&&context.runtimeMutabilityVersion===1){assertRemoteModelCatalogCache(row,context.approvedConfig);return [];}
  if(row.state_key===PINNED_TELEMETRY_STATE_KEY&&context.runtimeMutabilityVersion===1){assertPinnedTelemetryUpdateState(row);return [];}
  return [row];
 });}
 if(kind==='state'&&table==='official_external_plugin_catalog_snapshots'&&context.pluginCatalogCacheVersion===1){need(context.runtimeMutabilityVersion===1,'SETUP_RUNTIME_SECURITY_VERSION');need(rows.length<=1,'SETUP_RUNTIME_PLUGIN_CATALOG_INVALID');for(const row of rows)assertPinnedPluginCatalogSnapshot(row,context.approvedConfig);return [];}
 if(kind==='state'&&table==='gateway_restart_intent')return rows.flatMap(row=>{
  if(row.intent_key!=='gateway-restart')return [row];
  need(row.kind==='gateway-restart'&&numeric(row.pid)&&Number(row.pid)>0&&numeric(row.created_at)&&numeric(row.updated_at_ms)&&(row.reason===null||typeof row.reason==='string'&&row.reason.length<=200));
  need(row.force===null||[0,1].includes(Number(row.force)));need(row.wait_ms===null||numeric(row.wait_ms)&&Number(row.wait_ms)>=0);return [];
 });
 if(kind==='state'&&table==='gateway_restart_handoff')return rows.flatMap(row=>{
  if(row.handoff_key!=='current')return [row];
  need(row.kind==='gateway-supervisor-restart-handoff'&&Number(row.version)===1&&typeof row.intent_id==='string'&&row.intent_id.length>0&&row.intent_id.length<=120&&numeric(row.pid)&&Number(row.pid)>0);
  need(numeric(row.created_at)&&numeric(row.expires_at)&&Number(row.expires_at)>Number(row.created_at)&&Number(row.expires_at)-Number(row.created_at)<=60000&&numeric(row.updated_at_ms));
  need(['config-write','gateway-update','operator-restart','plugin-change','signal','unknown'].includes(row.source)&&['full-process','update-process'].includes(row.restart_kind)&&['launchd','systemd','schtasks','external'].includes(row.supervisor_mode));
  need(row.process_instance_id===null||typeof row.process_instance_id==='string'&&row.process_instance_id.length<=120);need(row.reason===null||typeof row.reason==='string'&&row.reason.length<=200);
  for(const key of ['restart_trace_started_at','restart_trace_last_at'])need(row[key]===null||numeric(row[key]));return [];
 });
 if(kind==='state'&&table==='agent_databases')return rows.flatMap(row=>knownRegistry(row,allowedProfileRoots)?[]:[row]);
 if(kind==='state'&&table==='agent_database_leases')return rows.flatMap(row=>{
  if(knownRegistry(row,allowedProfileRoots)){need(numeric(row.owner_pid)&&numeric(row.opened_at));return [];}return [row];
 });
 // Leases are ephemeral concurrency ownership records, not enduring grants.
 if(kind==='state'&&table==='state_leases'){for(const row of rows){need(typeof row.scope==='string'&&typeof row.lease_key==='string'&&typeof row.owner==='string'&&numeric(row.created_at)&&numeric(row.updated_at));for(const key of ['expires_at','heartbeat_at'])need(row[key]===null||numeric(row[key]));if(row.payload_json!==null)json(row.payload_json);}return [];}
 if(kind==='state'&&table==='config_health_entries')return rows.flatMap(row=>{
  need(typeof row.config_path==='string'&&path.isAbsolute(row.config_path)&&numeric(row.updated_at_ms));
  need(row.last_observed_suspicious_signature===null||typeof row.last_observed_suspicious_signature==='string');
  const extra={};for(const key of ['last_known_good_json','last_promoted_good_json'])if(row[key]!==null){const value=json(row[key]);need(typeof value.hash==='string'&&/^[a-f0-9]{64}$/.test(value.hash)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0);
   for(const name of ['mtimeMs','ctimeMs','mode','nlink','uid','gid'])need(value[name]===undefined||value[name]===null||typeof value[name]==='number'&&Number.isFinite(value[name]));
   for(const name of ['dev','ino','gatewayMode','observedAt'])need(value[name]===undefined||value[name]===null||typeof value[name]==='string');need(value.hasMeta===undefined||typeof value.hasMeta==='boolean');
   const unknown=omit(value,['hash','bytes','mtimeMs','ctimeMs','dev','ino','mode','nlink','uid','gid','hasMeta','gatewayMode','observedAt']);if(Object.keys(unknown).length)extra[key]=unknown;
  }return Object.keys(extra).length?[{config_path:row.config_path,...extra}]:[];
 });
 return rows;
}
const knownLogicalRecords={schema_meta:new Set(['primary','startup-migrations','state-migrations']),auth_profile_state:new Set(['primary']),auth_profile_store:new Set(['primary']),config_machine_state:new Set(['authProfiles.store','authProfiles.state','auth.sharedStore','update.checkState','modelCatalog.remote','telemetry.updateCheck']),gateway_restart_intent:new Set(['gateway-restart']),gateway_restart_handoff:new Set(['current'])};
function rowDiagnostic(row,primaryKeys,table){
 const keys=primaryKeys.length&&primaryKeys.every(key=>Object.hasOwn(row,key))?primaryKeys.map(key=>[key,row[key]]):null;
 const key=keys?.length===1?keys[0][1]:null;
 return {keySha256:sha(canonical(keys??row)),sha256:sha(canonical(row)),...(typeof key==='string'&&knownLogicalRecords[table]?.has(key)?{logicalRecord:key}:{})};
}
// Diagnostics are advisory detail, never an alternate security projection.
// The existing aggregate digest and acceptance conditions are unchanged.
export function runtimeSQLiteDiagnosticTableNames(){return [...new Set([...contract.agent.tables,...contract.state.tables].map(table=>table.name))].sort();}
export function runtimeSQLiteSecurityTableNames(relative){
 need(RUNTIME_SQLITE_PATHS.includes(relative),'SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED');const kind=relative==='state/openclaw.sqlite'?'state':'agent',runtime=kind==='agent'?agentRuntime:stateRuntime;
 return contract[kind].tables.map(table=>table.name).filter(table=>!runtime.has(table)&&!(kind==='agent'&&table.startsWith('session_transcript_fts_'))).sort();
}
/** Return only a digest. Credential values never leave this read-only scope.
 * BEGIN gives one coherent logical SQLite/WAL view. Runtime commits are allowed;
 * this does not claim an online whole-database or malicious ABA write fence.
 */
export function sqliteSecurityProjection(file,options={}){
 const context={...options,...location(file,options)};
 if(options.allowedProfileRoots!==undefined)need(Array.isArray(options.allowedProfileRoots)&&options.allowedProfileRoots.length<=8&&options.allowedProfileRoots.every(root=>typeof root==='string'&&path.isAbsolute(root)&&root===path.resolve(root)),'SETUP_RUNTIME_SQLITE_PATH_UNSUPPORTED');
 const before=owned(file);sidecars(file);let db,fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);identity(before,fs.fstatSync(fd));
  db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
  identity(before,owned(file));const {tables,schemaObjects}=schema(db,context.kind,options.requiredSchemaObjects),rows={},diagnosticTables={};let remainingDiagnosticRows=2048,completeDiagnosticRows=0;
  const version=db.prepare('PRAGMA user_version').get().user_version;
  const runtime=context.kind==='agent'?agentRuntime:stateRuntime;
  for(const definition of contract[context.kind].tables){
   const table=definition.name;
   if(runtime.has(table)||context.kind==='agent'&&table.startsWith('session_transcript_fts_'))continue;
   if(!tables.has(table)){rows[table]=[];if(options.diagnostics===true)diagnosticTables[table]={sha256:sha(canonical([])),recordCount:0,records:[],recordsTruncated:false};continue;}
   const query=db.prepare(`SELECT * FROM "${table}"`);query.setReadBigInts(true);
   const contents=query.all();need(contents.length<=100000);
   let projectedRows;try{projectedRows=projectionRows(table,contents,context);}catch(error){if(options.diagnostics===true)error.runtimeIdentityDetail={kind:'sqlite-security-projection',reason:'projection-validation-failed',path:options.relative,table,...(error.runtimeIdentityDetail?.logicalRecord===PINNED_TELEMETRY_STATE_KEY?{logicalRecord:PINNED_TELEMETRY_STATE_KEY}:{}),beforeSha256:null,afterSha256:null};throw error;}
   const projected=projectedRows.map(canonical).sort();need(projected.reduce((sum,row)=>sum+Buffer.byteLength(row),0)<=32*1024*1024);rows[table]=projected;
   if(options.diagnostics===true){
    const primaryKeys=db.prepare(`PRAGMA table_info("${table}")`).all().filter(column=>Number(column.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(column=>column.name);
    if(options.completeDiagnostics===true){completeDiagnosticRows+=projectedRows.length;need(completeDiagnosticRows<=100000,'SETUP_COMPONENT_EVIDENCE_LIMIT');}
    const limit=options.completeDiagnostics===true?projectedRows.length:Math.min(remainingDiagnosticRows,256),records=projectedRows.map(row=>rowDiagnostic(row,primaryKeys,table)).sort((a,b)=>a.keySha256.localeCompare(b.keySha256)||a.sha256.localeCompare(b.sha256)).slice(0,limit);remainingDiagnosticRows-=records.length;
    diagnosticTables[table]={sha256:sha(canonical(projected)),recordCount:projected.length,records,recordsTruncated:records.length<projected.length};
   }
  }
  const result=sha(canonical({schema:'agi-runtime-sqlite-security/v1',contract:contractDigest,kind:context.kind,agent:context.kind==='agent'?context.agent:null,userVersion:version,rows}));
  db.exec('ROLLBACK');identity(before,owned(file));identity(before,fs.fstatSync(fd));sidecars(file);
  return {schema:'agi-runtime-sqlite-security/v1',kind:context.kind,sha256:result,schemaObjects,...(options.diagnostics===true?{diagnosticDetails:{schema:'agi-runtime-sqlite-diagnostic/v1',aggregateSha256:result,tableDigests:diagnosticTables}}:{})};
 }catch(error){if(/^SETUP_/.test(error?.message))throw error;throw Error('SETUP_RUNTIME_SQLITE_READ_FAILED');}
 finally{try{db?.close();}catch{}if(fd!==undefined)fs.closeSync(fd);}
}

/** Inspect a stopped candidate before the pinned upstream preparation owner runs.
 * The missing-role/login variants are a migration admission only. They are never
 * accepted by sqliteSecurityProjection(), approval, completion, or rollback.
 */
export function sqliteSchemaPreflight(file,options={}){
 const context=location(file,options);need(options.allowSupportedLegacyUserProfiles===undefined||typeof options.allowSupportedLegacyUserProfiles==='boolean','SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
 const before=owned(file);sidecars(file);let db,fd;
 try{
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);identity(before,fs.fstatSync(fd));
  db=new DatabaseSync(file,{readOnly:true,allowExtension:false});db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
  identity(before,owned(file));const observation=schema(db,context.kind,options.requiredSchemaObjects,{allowSupportedLegacyUserProfiles:options.allowSupportedLegacyUserProfiles===true});
  const query=db.prepare('SELECT * FROM schema_meta');query.setReadBigInts(true);const metadata=query.all();schemaMeta(metadata,context);
  const primary=metadata.find(row=>row.meta_key==='primary'),userVersion=db.prepare('PRAGMA user_version').get().user_version;
  need(userVersion===(context.kind==='agent'?21:17),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
  const owner={role:primary.role,schemaVersion:Number(primary.schema_version),agentId:primary.agent_id,appVersion:primary.app_version};
  const result={schema:'agi-openclaw-schema-preflight/v1',schemaDigest:observation.schemaDigest,schemaObjects:observation.schemaObjects,userVersion,owner,legacyUserProfiles:observation.legacyUserProfiles};
  db.exec('ROLLBACK');identity(before,owned(file));identity(before,fs.fstatSync(fd));sidecars(file);return result;
 }catch(error){if(/^SETUP_/.test(error?.message))throw error;throw Error('SETUP_RUNTIME_SQLITE_READ_FAILED');}
 finally{try{db?.close();}catch{}if(fd!==undefined)fs.closeSync(fd);}
}

// Pinned OpenClaw 2026.9.5 creates this authority store on first use.
// Missing is precisely an empty grant set; every other authority table is mandatory.
const standardLazyTables=new Set(['operator_approval_standing_grants']);
function standardStandingGrantsSchema(db,actual){
 const table='operator_approval_standing_grants';
 const objects=db.prepare('SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema WHERE tbl_name=? OR name=? ORDER BY type,name').all(table,table);
 const definitions=contract.state.objects.filter(object=>object.tableName===table);
 if(!actual){need(objects.length===0,'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');return;}
 need(objects.length===definitions.length&&objects.every(object=>{
  const definition=definitions.find(value=>value.name===object.name);
  return definition&&object.type===definition.type&&object.tableName===definition.tableName&&[definition.sql,...definition.sqlVariants??[]].some(sql=>schemaSQL(object.sql)===schemaSQL(sql));
 }),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
}
function standardStandingGrants(rows){
 const identifiers=['grant_id','minted_by_approval_id','agent_id','cron_job_id','job_config_revision','operation_binding'];
 need(new Set(rows.map(row=>row.grant_id)).size===rows.length);
 for(const row of rows){
  for(const key of identifiers)need(typeof row[key]==='string'&&row[key].length>0&&Buffer.byteLength(row[key])<=16384);
  need(numeric(row.created_at_ms)&&Number(row.created_at_ms)>=0);
  for(const key of ['expires_at_ms','revoked_at_ms','last_used_at_ms'])need(row[key]===null||numeric(row[key])&&Number(row[key])>=0);
  need(row.expires_at_ms===null||Number(row.expires_at_ms)>=Number(row.created_at_ms));
  need(row.revoked_by===null||typeof row.revoked_by==='string'&&row.revoked_by.length>0&&Buffer.byteLength(row.revoked_by)<=16384);
  need(numeric(row.use_count)&&Number(row.use_count)>=0);
 }
 return rows.map(row=>omit(row,['last_used_at_ms','use_count']));
}

/** Standard installation reads only authority-bearing stores, using one SQLite
 * read transaction per database. Cache, history, schema inventory and operational
 * coordinator records are not part of this identity. The pinned real security
 * tables and their DDL remain mandatory except the enumerated lazy empty grant store; credentials are never exported. */
export function sqliteStandardAuthority(file,options={}){
 const context={...options,...location(file,options)},before=owned(file);sidecars(file);let db;
 try{
  db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
  // SQL triggers/views are executable behavior, not operational cache data.
  for(const object of db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('trigger','view')").all()){
   const definition=expected[context.kind].get(object.name);need(definition&&definition.type===object.type&&[definition.sql,...definition.sqlVariants??[]].some(sql=>schemaSQL(sql)===schemaSQL(object.sql)),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
  }
  const ownerObject=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='schema_meta'").get();
  need(ownerObject?.type==='table'&&schemaSQL(ownerObject.sql)===schemaSQL(expected[context.kind].get('schema_meta').sql),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
  need(db.prepare('PRAGMA user_version').get().user_version===(context.kind==='agent'?21:17),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
  schemaMeta(db.prepare('SELECT * FROM schema_meta').all(),context);
  const tables=context.kind==='agent'?['auth_profile_store','auth_profile_state']:['config_machine_state','exec_approvals_config','operator_approval_standing_grants','plugin_binding_approvals','mcp_oauth_stores'],rows={};
  for(const table of tables){
   const actual=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(table),definition=expected[context.kind].get(table);
   if(context.kind==='state'&&standardLazyTables.has(table)){standardStandingGrantsSchema(db,actual);if(!actual){rows[table]=[];continue;}}
   need(actual?.type==='table'&&[definition.sql,...definition.sqlVariants??[]].some(sql=>schemaSQL(sql)===schemaSQL(actual.sql)),'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
   need(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").get(table).n===0,'SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED');
   if(table==='operator_approval_standing_grants'){const size=db.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(grant_id AS BLOB))+length(CAST(minted_by_approval_id AS BLOB))+length(CAST(agent_id AS BLOB))+length(CAST(cron_job_id AS BLOB))+length(CAST(job_config_revision AS BLOB))+length(CAST(operation_binding AS BLOB))+coalesce(length(CAST(revoked_by AS BLOB)),0)),0) AS bytes FROM operator_approval_standing_grants').get();need(size.n<=100000&&size.bytes<=32*1024*1024);}
   const query=db.prepare(table==='config_machine_state'?"SELECT * FROM config_machine_state WHERE state_key IN ('authProfiles.store','authProfiles.state','auth.sharedStore')":'SELECT * FROM "'+table+'"');query.setReadBigInts(true);let values=query.all();need(values.length<=100000);
   if(table==='config_machine_state')values=values.filter(row=>['authProfiles.store','authProfiles.state','auth.sharedStore'].includes(row.state_key));
   let projected;
   if(table==='exec_approvals_config'){
    // A lazily materialized deny/default approval document grants no new host
    // authority. No agent overrides, allowlist entries or automatic grants.
    for(const row of values){
     const raw=json(row.raw_json);need(Object.keys(raw).every(k=>['version','socket','defaults','agents'].includes(k))&&raw.version===1&&record(raw.agents??{})&&Object.keys(raw.agents??{}).length===0);
     const defaults=raw.defaults??{};need(record(defaults)&&Object.keys(defaults).every(k=>['security','ask','askFallback','autoAllowSkills'].includes(k))&&[undefined,'deny','allowlist'].includes(defaults.security)&&[undefined,'always','on-miss'].includes(defaults.ask)&&[undefined,'deny'].includes(defaults.askFallback)&&[undefined,false].includes(defaults.autoAllowSkills));
     need(Number(row.agent_count)===0&&Number(row.allowlist_count)===0&&[null,0,0n].includes(row.auto_allow_skills)&&[null,'deny','allowlist'].includes(row.default_security)&&[null,'always','on-miss'].includes(row.default_ask)&&[null,'deny'].includes(row.default_ask_fallback));
    }projected=[];
   }else if(table==='operator_approval_standing_grants')projected=standardStandingGrants(values);
   else if(['plugin_binding_approvals','mcp_oauth_stores'].includes(table))projected=values.map(row=>omit(row,['updated_at','updated_at_ms','last_used_at_ms','use_count']));
   else projected=projectionRows(table,values,context);
   rows[table]=projected.map(canonical).sort();need(rows[table].reduce((total,value)=>total+Buffer.byteLength(value),0)<=32*1024*1024);
  }
  if(context.kind==='agent'){need(rows.auth_profile_store.length===1&&rows.auth_profile_state.length===1);const selected=JSON.parse(rows.auth_profile_store[0]).store?.profiles?.['openai:agi-compute-pro'];need(selected?.provider==='openai'&&selected.type==='oauth'&&selected.refreshableInlineOAuth===true);}
  db.exec('ROLLBACK');identity(before,owned(file));sidecars(file);
  return sha(canonical({schema:'agi-standard-sqlite-authority/v1',kind:context.kind,rows}));
 }catch(error){if(/^SETUP_/.test(error?.message))throw error;throw Error('SETUP_RUNTIME_SQLITE_READ_FAILED');}finally{db?.close();}
}

export const PINNED_PLUGIN_CATALOG_URL='https://clawhub.ai/v1/feeds/plugins';
// Keep this validator in the existing security module: qualification receipts
// bind at most 128 source entries; the approved bound is unchanged.
export const assertPinnedPluginCatalogSnapshot=(()=>{
const CODE='SETUP_RUNTIME_PLUGIN_CATALOG_INVALID';
const rowKeys=['feed_url','body','status','etag','last_modified','checksum','saved_at','trust_mode','trust_key_id','trust_signature_count','trust_threshold','trust_verified_at','updated_at_ms'].sort();
const feedKeys=new Set(['schemaVersion','id','generatedAt','expiresAt','sequence','description','entries']);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>typeof value==='bigint'?value>=0n&&value<=BigInt(Number.MAX_SAFE_INTEGER):Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const timestamp=value=>text(value,80)&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)>=0;
function need(ok){if(!ok)throw Error(CODE);}
function boundedData(value,depth=0,budget={nodes:0}){
 need(depth<=24&&++budget.nodes<=100000);
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='number'){need(Number.isFinite(value));return;}
 if(typeof value==='string'){need(value.length<=262144&&!value.includes('\u0000'));return;}
 need(Array.isArray(value)||record(value));
 for(const [key,item] of Object.entries(value)){need(!['__proto__','prototype','constructor'].includes(key)&&text(key,256));boundedData(item,depth+1,budget);}
}
/** The pinned default feed is UNSIGNED discovery data, never install approval.
 * Only new, explicitly versioned seals admit its bounded default-source cache.
 * Plugin allowlists, installed code/indexes, approvals, config and credentials
 * remain in the security identity. Old seals retain byte-sensitive behavior.
 * Signed/custom feeds need a separately reviewed policy; trust claims here fail.
 */
return function assertPinnedPluginCatalogSnapshot(row,approvedConfig){
 const allow=approvedConfig?.plugins?.allow;
 need(Array.isArray(allow)&&allow.length>0&&new Set(allow).size===allow.length&&allow.every(id=>['openai','browser','agi-public-browser'].includes(id)));
 need(record(row)&&Object.keys(row).sort().join(',')===rowKeys.join(',')&&row.feed_url===PINNED_PLUGIN_CATALOG_URL);
 need(typeof row.body==='string'&&Buffer.byteLength(row.body)>0&&Buffer.byteLength(row.body)<=1024*1024);
 need(integer(row.status)&&Number(row.status)===200&&integer(row.updated_at_ms)&&timestamp(row.saved_at));
 for(const key of ['etag','last_modified'])need(row[key]===null||text(row[key],4096));
 for(const key of ['trust_mode','trust_key_id','trust_signature_count','trust_threshold','trust_verified_at'])need(row[key]===null);
 need(typeof row.checksum==='string'&&/^sha256:[a-f0-9]{64}$/.test(row.checksum)&&'sha256:'+crypto.createHash('sha256').update(row.body).digest('hex')===row.checksum);
 let feed;try{feed=JSON.parse(row.body);}catch{need(false);}
 need(record(feed)&&Object.keys(feed).every(key=>feedKeys.has(key))&&[1,2].includes(feed.schemaVersion)&&feed.id==='clawhub-official'&&timestamp(feed.generatedAt)&&Number.isSafeInteger(feed.sequence)&&feed.sequence>=0);
 need(feed.expiresAt===undefined||timestamp(feed.expiresAt)&&Date.parse(feed.expiresAt)>Date.parse(feed.generatedAt));
 need(feed.description===undefined||text(feed.description,8192));
 need(Array.isArray(feed.entries)&&feed.entries.length<=10000&&feed.entries.every(record));boundedData(feed);
 return {schema:'agi-pinned-plugin-catalog-cache/v1',runtime:'2026.9.5',classification:'untrusted-discovery-cache',installAuthority:false};
}
})();
