import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {pinnedStandardFixture,pinnedPackage} from '../packages/AGI_Node/tests/setup-standard-lifecycle-fixture.mjs';
import {roleContract,COMPUTE_ROLES} from '../packages/AGI_Node/compute/roles.mjs';
import {preparePinnedControlUICache} from '../packages/AGI_Node/compute/setup-runtime-materialization.mjs';
const real={skip:!pinnedPackage,timeout:240000};
for(const role of COMPUTE_ROLES)test('pristine '+role+' Standard first run completes without retry or legacy initialization',real,async t=>{
 const f=pinnedStandardFixture(t,role,{binLayout:true}),contract=roleContract(role),sdk=await import('../packages/'+contract.package+'/compute/setup.mjs');
 const actualPolicy=await import('../packages/'+contract.package+'/compute/policy.mjs'),healthFetch=f.dependencies.fetch;f.dependencies.fetch=async(url,options)=>{const response=await healthFetch(url,options);if(!url.endsWith('/health'))return response;const health=await response.json(),settings=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));health.policyHash=actualPolicy.policyHash(settings);return new Response(JSON.stringify(health));};
 const adapter=f.dependencies.spawnSync;f.dependencies.spawnSync=(exe,args,options)=>{
  const result=adapter(exe,args,options);
  if(exe===f.runtime.openclaw&&args[2]==='gateway'&&args[3]==='start')preparePinnedControlUICache(f.profileDir,pinnedPackage);
  return result;
 };
 const result=await sdk.setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'standard',dependencies:f.dependencies});
 const report=result.supportReport;assert.equal(report.passed,true);assert.equal(report.assuranceMode,'standard');assert.equal(report.transaction.state,'complete');assert.equal(report.cleanInitialization,null);assert.equal(report.freshOAuthResume,null);assert.equal(report.legacyMigrationRequired,false);assert.equal(report.cleanRetryEvidence,null);
 assert.equal(f.loginExchanges,contract.oauth.length);assert.equal(report.serviceReadiness.health.state,'passed');assert.equal(report.serviceReadiness.finalPolicy.state,'passed');assert.ok(Object.values(report.serviceReadiness.health.history.at(-1).predicates).every(Boolean));
 const config=JSON.parse(fs.readFileSync(path.join(f.profileDir,'openclaw.json'))),settings=JSON.parse(fs.readFileSync(path.join(f.profileDir,'compute-settings.json')));
 assert.deepEqual(Object.keys(config.agents.entries).sort(),contract.oauth.slice().sort());assert.equal(settings.maxRuns24h,contract.maxRuns24h);assert.equal(settings.maxImages24h,contract.maxImages24h);
 if(!['agent','node'].includes(role)){assert.equal(settings.publicWebPolicy,null);assert.deepEqual(config.tools.deny,['*']);assert.deepEqual(config.agents.entries[contract.oauth[0]].skills,[]);assert.equal(config.browser.enabled,false);}
 assert.equal(report.walletAccessed,false);assert.equal(report.moneyMoved,false);assert.equal(report.publicOutput,false);
});
