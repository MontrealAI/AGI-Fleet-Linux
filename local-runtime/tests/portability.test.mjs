import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {digest} from '../contracts.mjs';

test('allowlisted export excludes host bindings, grants, clients, credentials and databases; restore is a new inert actor',()=>{
 const a=fixture(),b=fixture();try{const actor=a.create(),capsule=a.runtime.exportActor({actor:actor.id},a.operator);assert.deepEqual(Object.keys(capsule.payload).sort(),['authority','name','packageSha256','role','schema','sourceActor']);const restored=b.runtime.importActor({capsule,confirm:true},b.operator);assert.notEqual(restored.id,actor.id);assert.notEqual(restored.controller,actor.controller);assert.equal(restored.host,null);assert.equal(restored.active,false);assert.equal(restored.sourceActor,actor.id);assert.equal(b.runtime.store.db.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);}finally{a.close();b.close();}
});
test('foreign fields, forged digests, permission injection and traversal-shaped labels cannot create extraction paths',()=>{
 const f=fixture();try{const a=f.create(),capsule=f.runtime.exportActor({actor:a.id},f.operator);for(const key of ['token','host','grant','paths','hooks','wallet']){const c=structuredClone(capsule);c.payload[key]='../../secret';c.sha256=digest(c.payload);assert.throws(()=>f.runtime.importActor({capsule:c,confirm:true},f.operator),/FIELDS_INVALID/);}const c=structuredClone(capsule);c.payload.authority='execute';c.sha256=digest(c.payload);assert.throws(()=>f.runtime.importActor({capsule:c,confirm:true},f.operator),/PORTABLE_IDENTITY/);assert.throws(()=>f.runtime.importActor({capsule:{...capsule,sha256:'bad'},confirm:true},f.operator),/PORTABLE_IDENTITY/);}finally{f.close();}
});
test('unrelated roles retain their unchanged registry restrictions',()=>{
 const f=fixture();try{for(const role of ['agent','node','moderator','employer','evidence','recovery']){const a=f.create(role);assert.equal(a.role,role);assert.equal(a.host.authority,'bounded-offline-only');}}finally{f.close();}
});
