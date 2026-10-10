import crypto from 'node:crypto';
import {canonical} from '../src/util.mjs';
const CODE='OPENCLAW_OAUTH_SECURITY_CHANGED',PROFILE='openai:agi-compute-pro';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>canonical(a)===canonical(b);
const sha=v=>crypto.createHash('sha256').update(canonical(v)??'undefined').digest('hex');
const pathNames=new Set('auth profiles order openai provider mode email displayName meta migrations modelPolicyAllowlist utilityModelSeparation lastTouchedVersion lastTouchedAt agents defaults entries agi-creator agi-checker agi-reviewer models model primary fallbacks modelPolicy allow agentRuntime id utilityModel plugins enabled slots memory load paths config tools deny sandbox docker network host elevated exec gateway bind port http endpoints chatCompletions browser cron'.split(' '));
function componentPath(parts){return parts.map(x=>pathNames.has(x)||/^\d+$/.test(x)?x:'opaque:'+sha(x).slice(0,16)).join('.');}
function differences(before,after){const result=[];function walk(a,b,parts){if(same(a,b))return;if(object(a)&&object(b)){for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())walk(a[key],b[key],[...parts,key]);}else if(result.length<64)result.push({path:componentPath(parts),kind:'config-json',expectedSHA256:sha(a),observedSHA256:sha(b)});}walk(before,after,[]);return result;}
export function assertAuthorizedOAuthChanges(before,after,{allowPinnedFirstStart=false,allowOpenAIVisibility=false}={}){
 const receipt={schema:'agi-oauth-config-admission/v1',openclawVersion:'2026.9.5',normalizations:[],openAIModelVisibility:'unchanged',primaryModelsChanged:false,fallbacksChanged:false};
 const fail=()=>{const error=Error(CODE);error.oauthConfigDiagnostic={schema:'agi-oauth-config-diagnostic/v1',code:CODE,comparison:'before-oauth-versus-current-candidate',expectedSHA256:sha(before),observedSHA256:sha(after),components:differences(before,after),valuesIncluded:false};throw error;};
 const need=ok=>{if(!ok)fail();};
 need(object(before)&&object(after));const next=after.auth?.profiles?.[PROFILE];
 need(next?.provider==='openai'&&next?.mode==='oauth');need(same(after.auth?.order?.openai,[PROFILE]));
 for(const key of ['email','displayName'])need(next[key]===undefined||typeof next[key]==='string'&&next[key].length<=1024);
 const scrub=config=>{const value=structuredClone(config),entry=value.auth?.profiles?.[PROFILE];if(entry){for(const key of ['provider','mode','email','displayName'])delete entry[key];if(!Object.keys(entry).length)delete value.auth.profiles[PROFILE];}if(value.auth?.order)delete value.auth.order.openai;for(const key of ['profiles','order'])if(value.auth?.[key]&&!Object.keys(value.auth[key]).length)delete value.auth[key];if(value.auth&&!Object.keys(value.auth).length)delete value.auth;if(value.meta){delete value.meta.lastTouchedVersion;delete value.meta.lastTouchedAt;if(!Object.keys(value.meta).length)delete value.meta;}return value;};
 if(after.meta?.lastTouchedVersion!==undefined&&after.meta.lastTouchedVersion!==before.meta?.lastTouchedVersion)need(after.meta.lastTouchedVersion==='2026.9.5');
 if(after.meta?.lastTouchedAt!==undefined)need(typeof after.meta.lastTouchedAt==='string'&&Number.isFinite(Date.parse(after.meta.lastTouchedAt)));
 const left=scrub(before),right=scrub(after),model='openai/gpt-6-astra';
 if(!Object.hasOwn(before.agents?.defaults?.models??{},model)&&same(after.agents?.defaults?.models?.[model],{}))delete right.agents.defaults.models[model];
 if(allowPinnedFirstStart){
  for(const marker of ['modelPolicyAllowlist','utilityModelSeparation']){
   const a=before.meta?.migrations?.[marker],b=after.meta?.migrations?.[marker];
   if(!same(a,b)){need(a===undefined&&b===true);if(marker==='utilityModelSeparation')need(typeof before.agents?.defaults?.model?.primary==='string'&&Object.values(before.agents?.entries??{}).every(role=>typeof role.model?.primary==='string'));delete right.meta.migrations[marker];receipt.normalizations.push('meta.migrations.'+marker);}
  }
  if(right.meta?.migrations&&!Object.keys(right.meta.migrations).length&&!before.meta?.migrations)delete right.meta.migrations;
  if(right.meta&&!Object.keys(right.meta).length&&!left.meta)delete right.meta;
  const a=before.agents?.defaults?.modelPolicy,b=after.agents?.defaults?.modelPolicy;
  if(!same(a,b)){
   const refs=a===undefined?Object.keys(before.agents?.defaults?.models??{}):a?.allow;
   need(Array.isArray(refs)&&refs.length>0&&refs.length<=100&&refs.every(ref=>typeof ref==='string'&&/^openai\/[A-Za-z0-9._-]+$/.test(ref)));
   const original=a===undefined?{allow:refs}:a,normalized=same(b,original),expanded=allowOpenAIVisibility===true&&same(b,{...original,allow:[...refs,'openai/*']});
   need(normalized||expanded);if(a===undefined){need(after.meta?.migrations?.modelPolicyAllowlist===true);delete right.agents.defaults.modelPolicy;receipt.normalizations.push('agents.defaults.modelPolicy');}else right.agents.defaults.modelPolicy=structuredClone(a);
   if(expanded)receipt.openAIModelVisibility='openai/*';
  }
 }
 need(same(left,right));return receipt;
}
