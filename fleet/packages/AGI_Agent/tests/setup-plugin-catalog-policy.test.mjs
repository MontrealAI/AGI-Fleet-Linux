import {safeSetupFailure} from '../compute/setup-auth.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {runtimeDatabase} from './runtime-sqlite-fixture.mjs';
import {assertPinnedPluginCatalogSnapshot,PINNED_PLUGIN_CATALOG_URL} from '../compute/setup-runtime-sqlite.mjs';
import {sqliteSecurityProjection} from '../compute/setup-runtime-sqlite.mjs';
import {captureRuntimeSecurityIdentity,assertRuntimeSecurityIdentity} from '../compute/setup-runtime-identity.mjs';
const config={plugins:{allow:['openai','browser','agi-public-browser']}};
const feed=()=>({schemaVersion:2,id:'clawhub-official',generatedAt:'2026-10-09T00:00:00.000Z',sequence:1,entries:[{id:'discovery-only',install:{candidates:[{sourceRef:'public-npm',package:'unapproved-plugin'}]}}]});
const seal=row=>({...row,checksum:'sha256:'+createHash('sha256').update(row.body).digest('hex')});
const row=()=>seal({feed_url:PINNED_PLUGIN_CATALOG_URL,body:JSON.stringify(feed()),status:200n,etag:null,last_modified:null,saved_at:'2026-10-09T00:00:01.000Z',trust_mode:null,trust_key_id:null,trust_signature_count:null,trust_threshold:null,trust_verified_at:null,updated_at_ms:1n});
const code=/SETUP_RUNTIME_PLUGIN_CATALOG_INVALID/;
test('default bounded unsigned discovery snapshot grants no installation authority',()=>assert.equal(assertPinnedPluginCatalogSnapshot(row(),config).installAuthority,false));
const invalid={
 'custom feed':r=>r.feed_url='https://example.invalid/feed',
 'non-success response':r=>r.status=500,
 'forged checksum':r=>r.checksum='sha256:'+'0'.repeat(64),
 'signed trust claim':r=>r.trust_mode='signed',
 'partial trust claim':r=>r.trust_key_id='attacker',
 'unsafe timestamp':r=>r.updated_at_ms=-1,
 'invalid saved time':r=>r.saved_at='not-a-date',
 'header injection':r=>r.etag='a\r\nb',
 'unknown row field':r=>r.authority=true,
 'oversized body':r=>r.body='x'.repeat(1024*1024+1),
 'malformed JSON':r=>r.body='{',
 'unknown feed authority':r=>r.body=JSON.stringify({...feed(),approval:true}),
 'wrong feed ID':r=>r.body=JSON.stringify({...feed(),id:'other'}),
 'unsupported feed schema':r=>r.body=JSON.stringify({...feed(),schemaVersion:3}),
 'negative sequence':r=>r.body=JSON.stringify({...feed(),sequence:-1}),
 'invalid expiry':r=>r.body=JSON.stringify({...feed(),expiresAt:'2020-01-01T00:00:00Z'}),
 'non-object entry':r=>r.body=JSON.stringify({...feed(),entries:[null]}),
 'prototype metadata':r=>r.body=JSON.stringify({...feed(),entries:[JSON.parse('{"__proto__":{"install":true}}')]}),
};
for(const [name,mutate] of Object.entries(invalid))test('catalog rejects '+name,()=>{const value=row();mutate(value);const candidate=name==='forged checksum'?value:seal(value);assert.throws(()=>assertPinnedPluginCatalogSnapshot(candidate,config),error=>{assert.match(error.message,code);assert.equal(safeSetupFailure(error),'SETUP_RUNTIME_PLUGIN_CATALOG_INVALID');return true;});});
test('catalog rule requires the sealed explicit bundled-plugin allowlist',()=>{for(const value of [{},{plugins:{}},{plugins:{allow:[]}},{plugins:{allow:['*']}},{plugins:{allow:['unapproved']}}])assert.throws(()=>assertPinnedPluginCatalogSnapshot(row(),value),code);});
test('versioned native SQLite projection keeps old seals and authority rows strict',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-plugin-cache-')));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'openclaw.json'),JSON.stringify(config),{mode:0o600});
 const {file,db}=runtimeDatabase(root,'state');db.close();
 const modern={profileDir:root,runtimeMutabilityVersion:1,pluginCatalogCacheVersion:1};
 const legacy={profileDir:root,runtimeMutabilityVersion:1};
 const current=captureRuntimeSecurityIdentity(root,modern),old=captureRuntimeSecurityIdentity(root,legacy);
 assert.equal(current.contract.pluginCatalogCacheVersion,1);assert.equal(old.contract.pluginCatalogCacheVersion,undefined);
 const edit=operation=>{const d=runtimeDatabase(root,'state').db;try{operation(d);}finally{d.close();}};
 const put=value=>edit(d=>d.prepare('INSERT OR REPLACE INTO official_external_plugin_catalog_snapshots('+Object.keys(value).join(',')+') VALUES('+Object.keys(value).map(()=>'?').join(',')+')').run(...Object.values(value)));
 put(row());assert.doesNotThrow(()=>assertRuntimeSecurityIdentity(root,current));assert.throws(()=>assertRuntimeSecurityIdentity(root,old),/SETUP_PROFILE_CHANGED/);
 put(seal({...row(),body:JSON.stringify({...feed(),sequence:2,entries:[]})}));assert.doesNotThrow(()=>assertRuntimeSecurityIdentity(root,current));
 put({...row(),trust_mode:'signed'});assert.throws(()=>assertRuntimeSecurityIdentity(root,current),code);put(row());
 fs.writeFileSync(path.join(root,'openclaw.json'),JSON.stringify({plugins:{allow:['openai','unapproved']}}));assert.throws(()=>assertRuntimeSecurityIdentity(root,current),code);fs.writeFileSync(path.join(root,'openclaw.json'),JSON.stringify(config));
 edit(d=>d.prepare('INSERT INTO config_machine_state VALUES(?,?,?)').run('unapproved.authority','{"enabled":true}',1));assert.throws(()=>assertRuntimeSecurityIdentity(root,current),/SETUP_PROFILE_CHANGED/);edit(d=>d.prepare('DELETE FROM config_machine_state WHERE state_key=?').run('unapproved.authority'));
 edit(d=>d.exec('CREATE TRIGGER unexpected_catalog_authority AFTER INSERT ON official_external_plugin_catalog_snapshots BEGIN SELECT 1; END'));assert.throws(()=>assertRuntimeSecurityIdentity(root,current),/SETUP_RUNTIME_SQLITE_SCHEMA_UNSUPPORTED/);edit(d=>d.exec('DROP TRIGGER unexpected_catalog_authority'));
 fs.chmodSync(file,0o644);assert.throws(()=>assertRuntimeSecurityIdentity(root,current),/SETUP_STATE_OWNER_REQUIRED/);fs.chmodSync(file,0o600);assert.doesNotThrow(()=>assertRuntimeSecurityIdentity(root,current));
 assert.throws(()=>captureRuntimeSecurityIdentity(root,{...modern,pluginCatalogCacheVersion:2}),/SETUP_RUNTIME_SECURITY_VERSION/);
 const projection=()=>sqliteSecurityProjection(file,{root,profileDir:root,relative:'state/openclaw.sqlite',runtimeMutabilityVersion:1,pluginCatalogCacheVersion:1,approvedConfig:config});assert.ok(projection().sha256);
});
