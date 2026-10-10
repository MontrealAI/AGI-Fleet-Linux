import {assertPinnedTelemetryUpdateState} from './setup-telemetry-policy.mjs';
import {canonical,sha256} from '../src/util.mjs';
import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
const need=ok=>{if(!ok)throw Error('SETUP_RUNTIME_MODEL_CATALOG_INVALID');};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=4096;
const integer=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
const sqliteTime=x=>integer(x)||typeof x==='bigint'&&x>0n&&x<=BigInt(Number.MAX_SAFE_INTEGER);
const permittedOpenAIAPIs=new Set(['openai-completions','openai-responses','openai-chatgpt-responses']);
const providerFields=new Set(['api','defaultModel','defaultUtilityModel','models']);
const modelFields=new Set(['id','name','api','input','reasoning','contextWindow','contextWindows','contextWindowDefault','contextTokens','maxTokens','thinkingLevelMap','cost','compat','mediaInput','status','statusReason','replaces','replacedBy','tags']);
/** Remote data cannot grant a provider, credential, model, tool or endpoint.
 * The sealed config and pinned OpenAI plugin own those grants. Cache timestamps,
 * pricing and descriptive model metadata may refresh; transport overrides are
 * already stripped by the pinned runtime and are rejected here if injected. */
export function assertRemoteModelCatalogCache(row,config){
 need(record(config)&&config.agents?.ownership==='explicit');
 const configured=[config.agents?.defaults?.model?.primary,...Object.values(config.agents?.entries??{}).map(x=>x.model?.primary)].filter(Boolean);
 need(configured.length>0&&configured.every(x=>typeof x==='string'&&/^openai\/[A-Za-z0-9._-]+$/.test(x)));
 const expectedURL=config.models?.catalogRefresh?.url?.trim()||'https://catalog.openclaw.ai/models/v1/catalog.json';
 const cache=JSON.parse(row.value_json);need(record(cache)&&row.value_json===JSON.stringify(cache)&&Object.keys(cache).sort().join(',')==='bundle_json,checked_at,etag,generated_at,last_modified,min_version,source_url');
 need(cache.source_url===expectedURL&&integer(cache.generated_at)&&integer(cache.checked_at)&&sqliteTime(row.updated_at_ms)&&typeof cache.bundle_json==='string'&&Buffer.byteLength(cache.bundle_json)<=4194304);
 for(const name of ['etag','last_modified','min_version'])need(cache[name]===null||text(cache[name]));
 const bundle=JSON.parse(cache.bundle_json);need(record(bundle)&&cache.bundle_json===JSON.stringify(bundle)&&bundle.schemaVersion===1&&integer(bundle.generatedAt)&&Number(bundle.generatedAt)===Number(cache.generated_at)&&bundle.generatedAt<=Date.now()+86400000&&text(bundle.sourceCommit)&&record(bundle.providers));
 need(Object.keys(bundle).every(k=>['schemaVersion','generatedAt','minVersion','sourceCommit','providers','pricing'].includes(k))&&(bundle.minVersion??null)===cache.min_version);
 let nodes=0;const walk=value=>{need(++nodes<=200000);if(Array.isArray(value)){need(value.length<=8192);for(const item of value)walk(item);}else if(record(value)){for(const [key,item] of Object.entries(value)){need(!['baseUrl','headers','apiKey','accessToken','refreshToken','toolPolicy','pluginPolicy'].includes(key)&&key.length<=256);walk(item);}}else need(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=65536||typeof value==='number'&&Number.isFinite(value));};walk(bundle);
 need(Object.keys(bundle.providers).length<=1024);
 for(const [provider,value] of Object.entries(bundle.providers)){
  need(text(provider)&&record(value)&&Object.keys(value).every(k=>providerFields.has(k))&&Array.isArray(value.models)&&value.models.length>0&&value.models.length<=8192);
  if(provider==='openai'&&value.api!==undefined)need(permittedOpenAIAPIs.has(value.api));
  const ids=new Set();for(const model of value.models){need(record(model)&&text(model.id)&&!ids.has(model.id)&&Object.keys(model).every(k=>modelFields.has(k)));ids.add(model.id);if(provider==='openai'&&model.api!==undefined)need(permittedOpenAIAPIs.has(model.api));}
 }
 // Hash the authority constraint, not the changing observations. All other
 // config_machine_state rows retain their original exact security projection.
 return {schema:'agi-remote-catalog-cache/v1',authoritySHA256:sha256(canonical({provider:'openai',api:[...permittedOpenAIAPIs].sort(),sourceURL:expectedURL,configured,modelPolicy:config.agents.defaults.modelPolicy??null})),contentSHA256:sha256(cache.bundle_json)};
}
/** Recheck the narrow cache authority guard before work and authenticated health.
 * BEGIN observes committed WAL state; credentials are never selected or emitted. */
export function assertInstalledRemoteCatalogCache(c){
 const file=path.join(c.profileDir,'state/openclaw.sqlite');let db,fd;
 try{
  const before=fs.lstatSync(file);need(before.isFile()&&!before.isSymbolicLink()&&before.uid===process.getuid()&&before.nlink===1&&!(before.mode&0o077));
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const opened=fs.fstatSync(fd);need(opened.dev===before.dev&&opened.ino===before.ino);
  db=new DatabaseSync(file,{readOnly:true,allowExtension:false});db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const table=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='config_machine_state'").get();
  const contract=JSON.parse(fs.readFileSync(new URL('./setup-runtime-sqlite-contract.json',import.meta.url)));const expected=contract.state.objects.find(x=>x.name==='config_machine_state');
  const sql=value=>String(value).replace(/\s+/g,' ').replace(/\bIF NOT EXISTS\b/ig,'').trim().replace(/;$/,'');need(table?.type==='table'&&sql(table.sql)===sql(expected.sql));
  const rows=db.prepare("SELECT * FROM config_machine_state WHERE state_key IN ('modelCatalog.remote','telemetry.updateCheck')").all();need(new Set(rows.map(row=>row.state_key)).size===rows.length);for(const row of rows){if(row.state_key==='modelCatalog.remote')assertRemoteModelCatalogCache(row,JSON.parse(fs.readFileSync(c.gatewayConfig)));else if(c.assuranceMode!=='standard')assertPinnedTelemetryUpdateState(row);}
  db.exec('ROLLBACK');const after=fs.lstatSync(file);need(after.dev===before.dev&&after.ino===before.ino&&after.uid===before.uid&&after.mode===before.mode&&after.nlink===1);
 }catch(error){if(error?.message==='SETUP_RUNTIME_TELEMETRY_STATE_INVALID')throw error;throw Error('COMPUTE_MODEL_CATALOG_POLICY_CHANGED');}finally{try{db?.close();}catch{}if(fd!==undefined)fs.closeSync(fd);}
}
