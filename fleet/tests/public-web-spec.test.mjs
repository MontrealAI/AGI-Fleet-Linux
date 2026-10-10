import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import fleet from '../workforce/core/computer-work.cjs';
import agent from '../packages/AGI_Agent/src/admission-core/economics/computer-work.cjs';
import node from '../packages/AGI_Node/src/admission-core/economics/computer-work.cjs';
test('Fleet and both standalone validators bind the same explicit role web scope without granting native authority',()=>{
 const spec=JSON.parse(fs.readFileSync(new URL('../examples/computer-work-v2.json',import.meta.url)));const before=fleet.digest(spec);for(const core of [fleet,agent,node])assert.equal(core.validateComputerWork(spec),spec);
 spec.environment.capabilities.agent.push('browser');spec.authority.agent.resources.push('public-web');spec.publicWeb={agent:{hosts:[{hostname:'example.com',ports:[443]}],limits:{maxRequests:8,maxConnections:2,maxBytes:1048576}},reviewer:null};
 assert.notEqual(fleet.digest(spec),before);for(const core of [fleet,agent,node]){core.validateComputerWork(spec);assert.equal(core.digest(spec),fleet.digest(spec));assert.deepEqual(core.publicWebScope(spec,'agent'),spec.publicWeb.agent);assert.throws(()=>core.publicWebScope(spec,'reviewer'),/SCOPE_REQUIRED/);const widened=structuredClone(spec);widened.publicWeb.agent.hosts[0].ports.push(22);assert.throws(()=>core.validateComputerWork(widened),/PUBLIC_WEB_PORT/);const missing=structuredClone(spec);delete missing.publicWeb;assert.throws(()=>core.validateComputerWork(missing),/PUBLIC_WEB_SCOPE_REQUIRED/);const native=structuredClone(spec);native.authority.agent.scope='dedicated-account';assert.throws(()=>core.validateComputerWork(native),/PUBLIC_WEB_AUTHORITY/);}
});
