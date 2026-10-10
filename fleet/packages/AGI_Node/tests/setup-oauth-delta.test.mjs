import test from 'node:test';import assert from 'node:assert/strict';
import {computeProfile} from '../compute/profile.mjs';import {assertAuthorizedOAuthChanges} from '../compute/setup-transaction.mjs';
const options={allowPinnedFirstStart:true,allowOpenAIVisibility:true};
const fresh=()=>computeProfile({token:'a'.repeat(64),port:18896,model:'openai/gpt-6-astra',workspace:'/private/candidate/workspace',imageID:'sha256:'+'b'.repeat(64),workstation:true,jobRoot:'/private/candidate/jobs',inputRoot:'/private/candidate/workspace/job-input',browserImageID:'sha256:'+'c'.repeat(64)});
function normalized(before,{all=true}={}){const after=structuredClone(before);after.agents.defaults.modelPolicy={allow:['openai/gpt-6-astra',...(all?['openai/*']:[])]};after.meta={migrations:{modelPolicyAllowlist:true,utilityModelSeparation:true},lastTouchedVersion:'2026.9.5'};after.auth.profiles['openai:agi-compute-pro'].displayName='PRIVATE-CANARY';return after;}
test('pinned first-sign-in normalization and exact Show all choice are admitted for fresh review',()=>{const before=fresh(),after=normalized(before),copy=structuredClone({before,after}),receipt=assertAuthorizedOAuthChanges(before,after,options);assert.equal(receipt.openAIModelVisibility,'openai/*');assert.equal(receipt.primaryModelsChanged,false);assert.deepEqual(receipt.normalizations,['meta.migrations.modelPolicyAllowlist','meta.migrations.utilityModelSeparation','agents.defaults.modelPolicy']);assert.deepEqual({before,after},copy);assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE-CANARY/);});
test('keep restrictions permits only equivalent current policy materialization',()=>{const before=fresh(),after=normalized(before,{all:false});assert.equal(assertAuthorizedOAuthChanges(before,after,{allowPinnedFirstStart:true}).openAIModelVisibility,'unchanged');assert.throws(()=>assertAuthorizedOAuthChanges(before,normalized(before),{allowPinnedFirstStart:true}),/OAUTH_SECURITY_CHANGED/);assert.throws(()=>assertAuthorizedOAuthChanges(before,normalized(before)),/OAUTH_SECURITY_CHANGED/);});
test('already materialized current OpenAI restriction may append only the one supported wildcard',()=>{const before=normalized(fresh(),{all:false}),after=structuredClone(before);after.agents.defaults.modelPolicy.allow.push('openai/*');assert.equal(assertAuthorizedOAuthChanges(before,after,options).openAIModelVisibility,'openai/*');assert.doesNotThrow(()=>assertAuthorizedOAuthChanges(after,structuredClone(after),options));});
const attacks={
 'all providers':c=>c.agents.defaults.modelPolicy.allow.push('*'),
 'foreign provider':c=>c.agents.defaults.modelPolicy.allow.push('foreign/*'),
 'remove existing restrictions':c=>c.agents.defaults.modelPolicy.allow=['openai/*'],
 'extra policy authority':c=>c.agents.defaults.modelPolicy.unrestricted=true,
 'primary selection':c=>c.agents.defaults.model.primary='openai/another-model',
 'fallback':c=>c.agents.defaults.model.fallbacks=['openai/another-model'],
 'role primary':c=>c.agents.entries['agi-reviewer'].model.primary='openai/another-model',
 'role policy injection':c=>c.agents.entries['agi-creator'].modelPolicy={allow:['*']},
 'model executable':c=>c.agents.defaults.models['openai/gpt-6-astra'].agentRuntime.id='foreign',
 'utility route':c=>c.agents.defaults.utilityModel='openai/another-model',
 'gateway exposure':c=>c.gateway.bind='lan',
 'auth downgrade':c=>c.auth.profiles['openai:agi-compute-pro'].mode='api_key',
 'different auth order':c=>c.auth.order.openai=['openai:foreign'],
 'plugin injection':c=>c.plugins.allow.push('foreign'),
 'discovery config override':c=>c.plugins.bundledDiscovery='all',
 'host execution':c=>c.agents.entries['agi-creator'].tools.exec.host='gateway',
 'sandbox network':c=>c.agents.entries['agi-creator'].sandbox.docker.network='host',
 'cron activation':c=>c.cron.enabled=true,
 'unknown marker':c=>c.meta.migrations.untrustedAuthority=true,
 'false marker':c=>c.meta.migrations.utilityModelSeparation=false,
 'wrong runtime':c=>c.meta.lastTouchedVersion='2026.9.6'
};
for(const [name,change] of Object.entries(attacks))test('first-sign-in still rejects '+name,()=>{const before=fresh(),after=normalized(before);change(after);assert.throws(()=>assertAuthorizedOAuthChanges(before,after,options),/OAUTH_SECURITY_CHANGED/);});
test('diagnostics expose hashes and bounded sanitized paths, not values or arbitrary key names',()=>{const before=fresh(),after=normalized(before);after['SECRET-KEY-CANARY']={value:'SECRET-VALUE-CANARY'};try{assertAuthorizedOAuthChanges(before,after,options);assert.fail('must reject');}catch(error){const report=error.oauthConfigDiagnostic;assert.equal(report.valuesIncluded,false);assert.ok(report.components.length);assert.ok(report.components.every(row=>/^[a-f0-9]{64}$/.test(row.expectedSHA256)&&/^[a-f0-9]{64}$/.test(row.observedSHA256)));assert.doesNotMatch(JSON.stringify(report),/SECRET-|PRIVATE-CANARY/);}});
