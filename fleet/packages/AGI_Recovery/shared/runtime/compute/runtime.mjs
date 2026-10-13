import fs from 'node:fs';
import {publicBrowserPolicyReady} from './public-browser-config.mjs';
import {canonical,sha256} from '../src/util.mjs';
import core from '../src/admission-core/economics/computer-work.cjs';
import timing from '../src/admission-core/economics/execution-window.cjs';
import {ensure} from '../src/util.mjs';
const toolGroups={'group:fs':['ls','read','write','edit','apply_patch'],'group:runtime':['exec','process','code_execution'],'group:web':['web_fetch','web_search','x_search'],'group:ui':['browser','screen','dashboard','terminal','portal','canvas','show_widget'],'group:openclaw':['code_execution','web_search','web_fetch','x_search','browser','screen','dashboard','terminal','portal','show_widget']};
const normalizeTool=value=>{const key=typeof value==='string'?value.trim().toLowerCase():'';return ({bash:'exec','apply-patch':'apply_patch',cron:'automations'})[key]??key;};
function matches(pattern,tool){
 pattern=normalizeTool(pattern);tool=normalizeTool(tool);
 if(!pattern)return false;
 if(toolGroups[pattern])return toolGroups[pattern].includes(tool);
 return new RegExp('^'+pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(tool);
}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function selectedProviderPolicy(scope,model){
 if(scope?.byProvider===undefined)return undefined;
 ensure(record(scope.byProvider)&&typeof model==='string'&&/^openai\/[a-zA-Z0-9._-]+$/.test(model),'COMPUTE_RUNTIME_TOOL_POLICY');
 const normalized=model.toLowerCase(),provider=normalized.split('/')[0],entries=new Map();
 for(const [key,value] of Object.entries(scope.byProvider)){
  const id=key.trim().toLowerCase();
  ensure(record(value),'COMPUTE_RUNTIME_TOOL_POLICY');
  if(!entries.has(id))entries.set(id,value);
 }
 return entries.get(normalized)??entries.get(provider);
}
function profileAllows(profile,alsoAllow,tool){
 if(profile===undefined)return true;
 ensure(['minimal','coding','messaging','full'].includes(profile),'COMPUTE_RUNTIME_TOOL_POLICY');
 if(alsoAllow!==undefined)ensure(Array.isArray(alsoAllow)&&alsoAllow.every(x=>typeof x==='string'),'COMPUTE_RUNTIME_TOOL_POLICY');
 if(profile==='full'||alsoAllow?.some(pattern=>matches(pattern,tool)))return true;
 // Exact 2026.9.5 catalog membership for the tools used by this runtime's capability checks.
 if(profile==='coding')return ['ls','read','write','edit','apply_patch','exec','process','code_execution','web_fetch','web_search','x_search'].includes(normalizeTool(tool));
 return false;
}
export function effectiveToolAllowed(config,entry,tool){
 const global=config.tools??{},local=entry.tools??{},selected=entry.model??config.agents?.defaults?.model,model=typeof selected==='string'?selected:selected?.primary;
 const provider=selectedProviderPolicy(global,model),agentProvider=selectedProviderPolicy(local,model);
 const baseProfile=local.profile??global.profile,providerProfile=agentProvider?.profile??provider?.profile;
 if(!profileAllows(baseProfile,local.alsoAllow??global.alsoAllow,tool)||!profileAllows(providerProfile,agentProvider?.alsoAllow??provider?.alsoAllow,tool))return false;
 const policies=[global,local,provider,agentProvider,global.sandbox?.tools,local.sandbox?.tools].filter(Boolean);
 return policies.every(p=>{
  ensure(record(p),'COMPUTE_RUNTIME_TOOL_POLICY');
  for(const key of ['allow','deny','alsoAllow'])if(p[key]!==undefined)ensure(Array.isArray(p[key])&&p[key].every(x=>typeof x==='string'),'COMPUTE_RUNTIME_TOOL_POLICY');
  ensure(!(p.allow!==undefined&&p.alsoAllow!==undefined),'COMPUTE_RUNTIME_TOOL_POLICY');
  return (!p.allow||p.allow.some(x=>matches(x,tool)))&&(!p.deny||!p.deny.some(x=>matches(x,tool)));
 });
}
function configured(c,role){
 const config=JSON.parse(fs.readFileSync(c.gatewayConfig,'utf8'));
 ensure(['agent','reviewer'].includes(role),'COMPUTE_RUNTIME_ROLE');
 const entry=config.agents?.entries?.[role==='agent'?'agi-creator':'agi-reviewer'];
 ensure(entry,'COMPUTE_RUNTIME_ROLE');return {config,entry};
}
export function runtimeManifest(c,role=c.role==='node'?'reviewer':'agent',{commissioning=false}={}){
 const {config,entry}=configured(c,role), selected=entry.model??config.agents?.defaults?.model;
 const model=typeof selected==='string'?selected:selected?.primary;
 ensure(c.workstation===true&&entry.sandbox?.mode==='all'&&entry.sandbox?.backend==='docker'&&entry.sandbox?.scope==='session'&&entry.sandbox?.workspaceAccess==='none','COMPUTE_RUNTIME_SANDBOX');
 ensure(entry.sandbox.docker?.network==='none'&&entry.sandbox.docker?.image===c.imageID&&entry.sandbox.browser?.image===c.browserImageID&&entry.sandbox.browser?.allowHostControl===false,'COMPUTE_RUNTIME_IMAGES');
 ensure(!selected?.fallbacks?.length&&!config.agents?.defaults?.model?.fallbacks?.length,'COMPUTE_RUNTIME_FALLBACK');
 ensure(entry.tools?.exec?.host==='sandbox'&&entry.tools?.elevated?.enabled===false,'COMPUTE_RUNTIME_TOOLS');
 ensure(typeof model==='string'&&/^[a-f0-9]{64}$/.test(c.policyHash)&&/^sha256:[a-f0-9]{64}$/.test(c.imageID),'COMPUTE_RUNTIME_IDENTITY');
 const fileTools=['read','write'].every(tool=>effectiveToolAllowed(config,entry,tool)),exec=effectiveToolAllowed(config,entry,'exec');
 // This manifest describes the sealed configuration, not time-varying receipt
 // authority. Expiry must not change an already-admitted offline runtime hash.
 // Browser execution is separately authorized by checkWorkRuntime/coordinator.
 const browserConfigured=c.publicWebPolicy?.enabled===true&&(commissioning?['commissioning','qualified'].includes(c.publicWebPolicy.mode):c.publicWebPolicy.mode==='qualified');
 const browser=browserConfigured&&publicBrowserPolicyReady(c,{commissioning:true})&&effectiveToolAllowed(config,entry,'agi_public_browser');
 const capabilities=[...(fileTools?['files']:[]),...(fileTools&&exec?['desktop','code','documents','independent-review']:[]),...(browser?['browser']:[])];
 return {schemaVersion:1,model,openclawVersion:'2026.9.5',policySha256:c.policyHash,imageSha256:c.imageID.slice(7),capabilities,scope:'isolated-public',resources:['job-workspace',...(browser?['public-web']:[])],maxTaskSeconds:600};
}
export function checkWorkRuntime(worker,spec,role,{commissioning=false}={}){
 if(!['computer-work/v1','computer-work/v2'].includes(spec?.profile))return null;
 const {config,entry}=configured(worker.c,role);
 const publicTools=['browser','web_fetch','web_search'];
 const context=worker.currentPublicWebContext;
 if(!commissioning&&context?.commissioning){ensure(context.role===role&&context.specSha256===sha256(canonical(spec)),'COMPUTE_PUBLIC_WEB_CONTEXT_MISMATCH');commissioning=true;}
 if(spec.profile==='computer-work/v1'){
  ensure(publicTools.every(tool=>!effectiveToolAllowed(config,entry,tool)), 'COMPUTE_LEGACY_SCOPE_REQUIRED');
  ensure(spec.dataPolicy==='public','COMPUTE_SCOPED_ADAPTER_REQUIRED');
  return {runtime:runtimeManifest(worker.c,role),legacyOffline:true};
 }
 ensure(publicTools.every(tool=>!effectiveToolAllowed(config,entry,tool)),'COMPUTE_PUBLIC_WEB_NATIVE_TOOL_FORBIDDEN');
 const wantsBrowser=spec.environment?.capabilities?.[role]?.includes('browser')||spec.authority?.[role]?.resources?.includes('public-web');
 if(wantsBrowser)ensure(publicBrowserPolicyReady(worker.c,{commissioning})&&core.publicWebScope(spec,role)&&effectiveToolAllowed(config,entry,'agi_public_browser'),'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
 const runtime=runtimeManifest(worker.c,role,{commissioning}),check=core.checkRuntime(spec,runtime,role,Math.floor(worker.now()/1000));
 ensure(spec.dataPolicy==='public'&&spec.authority[role].scope==='isolated-public','COMPUTE_SCOPED_ADAPTER_REQUIRED');
 // A parent commitment is inert provenance, never delegation or dependency admission.
 ensure(spec.coordination.dependencies.length===0&&spec.coordination.delegation==='none','COMPUTE_COORDINATION_ADAPTER_REQUIRED');
 return {...check,runtime};
}
export function workSignal(worker,spec,role,signal,options={}){
 if(spec?.profile!=='computer-work/v2')return signal;
 checkWorkRuntime(worker,spec,role,options);
 timing.checkExecutionWindow(spec,role,{now:Math.floor(worker.now()/1000)});
 const budget=spec.budget[role==='agent'?'maxAgentSeconds':'maxReviewSeconds']*1000;
 const remaining=Math.min(budget,spec.deadline*1000-worker.now());
 ensure(remaining>0,'COMPUTE_JOB_EXPIRED');
 const timeout=AbortSignal.timeout(Math.max(1,Math.floor(remaining)));
 return signal?AbortSignal.any([signal,timeout]):timeout;
}
