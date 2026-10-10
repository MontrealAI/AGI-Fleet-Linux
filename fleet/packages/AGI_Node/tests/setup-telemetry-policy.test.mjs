import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runtimeDatabase} from './runtime-sqlite-fixture.mjs';import {pinnedTelemetry} from './pinned-telemetry-fixture.mjs';
import {assertPinnedTelemetryUpdateState} from '../compute/setup-telemetry-policy.mjs';import {sqliteSecurityProjection} from '../compute/setup-runtime-sqlite.mjs';
const row=(v,updated_at_ms=1)=>({state_key:'telemetry.updateCheck',value_json:JSON.stringify(v),updated_at_ms});
const options={skip:!process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT?'Actual pinned SDK required':false,timeout:120000};
for(const state of [{},{lastPingAt:0},{lastPingAt:1,latestVersion:'2026.9.5',note:'known operational state'}])test('exact bounded telemetry shape accepted '+JSON.stringify(Object.keys(state)),()=>assert.doesNotThrow(()=>assertPinnedTelemetryUpdateState(row(state))));
for(const state of [null,[],1,{unexpected:true},{lastPingAt:-1},{lastPingAt:'1'},{lastPingAt:Number.MAX_SAFE_INTEGER+1},{latestVersion:''},{latestVersion:' '.repeat(1)},{latestVersion:'a'.repeat(257)},{note:'a'.repeat(501)},{note:1},{latestVersion:[]},{provider:'openai'},JSON.parse('{"__proto__":{}}')])test('invalid telemetry projection rejects '+JSON.stringify(state).slice(0,80),()=>assert.throws(()=>assertPinnedTelemetryUpdateState(row(state)),/SETUP_RUNTIME_TELEMETRY_STATE_INVALID/));
for(const json of ['{','{"lastPingAt":1e999}','{"lastPingAt":1,"lastPingAt":2}'])test('malformed or duplicate telemetry JSON fails '+json,()=>assert.throws(()=>assertPinnedTelemetryUpdateState({...row({}),value_json:json}),/SETUP_RUNTIME_TELEMETRY_STATE_INVALID/));
test('actual pinned update-check writes and refreshes cache with feature telemetry disabled',options,async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-telemetry-')));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const {file,db}=runtimeDatabase(root,'state');db.exec('PRAGMA user_version=17');db.close();
 const projection=()=>sqliteSecurityProjection(file,{root,profileDir:root,relative:'state/openclaw.sqlite',runtimeMutabilityVersion:1});
 const legacy=()=>sqliteSecurityProjection(file,{root,profileDir:root,relative:'state/openclaw.sqlite'});
 const read=()=>{const d=runtimeDatabase(root,'state').db;try{return d.prepare('SELECT * FROM config_machine_state WHERE state_key=?').get('telemetry.updateCheck');}finally{d.close();}};
 const baseline=projection().sha256,old=legacy().sha256;assert.equal(read(),undefined);
 const stamp=Date.now();await pinnedTelemetry(root,{nowMs:stamp});assertPinnedTelemetryUpdateState(read());assert.equal(projection().sha256,baseline);assert.notEqual(legacy().sha256,old);
 await pinnedTelemetry(root,{nowMs:stamp+86400001,version:'2026.9.6',note:'refresh'});assertPinnedTelemetryUpdateState(read());assert.equal(JSON.parse(read().value_json).lastPingAt,stamp+86400001);assert.equal(projection().sha256,baseline);
 const edit=runtimeDatabase(root,'state').db;edit.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('unknown.authority','{"enabled":true}',1);edit.close();assert.notEqual(projection().sha256,baseline);
});
