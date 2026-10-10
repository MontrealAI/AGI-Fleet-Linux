import {roleContract,OPERATOR_ROLES} from './roles.mjs';
import path from 'node:path';
import {effectiveToolAllowed} from './runtime.mjs';
import { ensure } from '../src/util.mjs';
export const SKILLS = ['agi-public-research','agi-code-and-data','agi-image-production'];
export const WORKSTATION_SKILLS=[...SKILLS,'agi-browser-work','agi-desktop-work','agi-document-work','agi-evidence-review'];
export const WORK_TOOLS = ['read','write','edit','apply_patch','exec','process','web_fetch'];
export function computeProfile({token,port,model,workspace,imageID,workstation=false,jobRoot,inputRoot,browserImageID,role='agent',rootless=false}) {
  ensure(/^[a-f0-9]{64}$/.test(token) && Number.isSafeInteger(port) && port>=1024 && port<=65535 && /^openai\/[a-zA-Z0-9._-]{1,100}$/.test(model) && /^sha256:[a-f0-9]{64}$/.test(imageID) && path.isAbsolute(workspace), 'COMPUTE_PROFILE_INVALID');
  const config = {
    // Only admitted Agent/Node work may initiate model execution. Upstream
    // scheduled maintenance must not create unmetered provider work.
    cron:{enabled:false},
    auth:{profiles:{'openai:agi-compute-pro':{provider:'openai',mode:'oauth'}},order:{openai:['openai:agi-compute-pro']}},
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token},http:{endpoints:{chatCompletions:{enabled:true,images:{allowUrl:false,maxBytes:4194304}}}}},
    agents:{ownership:"explicit",defaults:{model:{primary:model,fallbacks:[]},models:{[model]:{agentRuntime:{id:"openclaw"}}},utilityModel:"",thinkingDefault:"high",maxConcurrent:1,timeoutSeconds:300,heartbeat:{every:'0m'},mediaModels:{image:{primary:'openai/gpt-image-2',fallbacks:[],timeoutMs:300000}}},entries:{
      'agi-creator':{name:'AGI work studio',workspace,model:{primary:model,fallbacks:[]},skills:SKILLS,
        sandbox:{mode:'all',backend:'docker',scope:'session',workspaceAccess:'ro',docker:{image:imageID,network:'none',readOnlyRoot:true,capDrop:['ALL'],user:'1000:1000',pidsLimit:128,memory:'2g',memorySwap:'2g',cpus:2}},
        tools:{allow:WORK_TOOLS,elevated:{enabled:false},exec:{host:'sandbox',mode:'full',timeoutSeconds:90},sandbox:{tools:{allow:WORK_TOOLS}}}},
      'agi-checker':{name:'AGI independent model check',workspace:path.join(workspace,'review'),model:{primary:model,fallbacks:[]},skills:[],tools:{deny:['*'],elevated:{enabled:false}}}
    }},
    tools:{allow:WORK_TOOLS,elevated:{enabled:false},exec:{host:'sandbox',mode:'full',timeoutSeconds:90},sandbox:{tools:{allow:WORK_TOOLS}},web:{search:{enabled:false},fetch:{enabled:true,maxChars:20000,maxCharsCap:20000,maxResponseBytes:750000,timeoutSeconds:30,maxRedirects:3,useTrustedEnvProxy:false,ssrfPolicy:{dangerouslyAllowPrivateNetwork:false}}}},
    browser:{enabled:false},plugins:{allow:['openai'],slots:{memory:'none'}}
  };
  if(OPERATOR_ROLES.includes(role)){
    const actor=roleContract(role).oauth[0],tools={deny:['*'],elevated:{enabled:false}};
    config.agents.entries={[actor]:{name:`AGI ${role} evidence reviewer`,workspace,model:{primary:model,fallbacks:[]},skills:[],tools:structuredClone(tools)}};
    delete config.agents.defaults.mediaModels;
    config.tools=tools;config.browser={enabled:false};config.plugins={allow:['openai'],slots:{memory:'none'}};
    return config;
  }
  if(workstation){
    ensure(path.isAbsolute(jobRoot)&&path.isAbsolute(inputRoot)&&/^sha256:[a-f0-9]{64}$/.test(browserImageID)&&['agent','node'].includes(role),'COMPUTE_PROFILE_INVALID');
    const skills=WORKSTATION_SKILLS;
    const workTools=[...WORK_TOOLS,'browser'];
    const sandbox={mode:'all',backend:'docker',scope:'session',workspaceAccess:'none',workspaceRoot:jobRoot,docker:{image:imageID,network:'none',readOnlyRoot:true,capDrop:['ALL'],user:rootless?'0:0':`${process.getuid?.()??1000}:${process.getgid?.()??1000}`,pidsLimit:384,memory:'4g',memorySwap:'4g',cpus:2,binds:[inputRoot+':/job-input:ro']},browser:{enabled:true,image:browserImageID,headless:true,noVncEnabled:false,allowHostControl:false,autoStart:true,autoStartTimeoutMs:45000,binds:[]}};
    const policy={allow:workTools,elevated:{enabled:false},exec:{host:'sandbox',mode:'full',timeoutSeconds:120},sandbox:{tools:{allow:workTools,deny:['nodes','computer','gateway','cron','message','sessions_spawn','sessions_send']}}};
    config.agents.entries['agi-creator']={...config.agents.entries['agi-creator'],skills:[...skills],sandbox:structuredClone(sandbox),tools:structuredClone(policy)};
    config.agents.entries['agi-reviewer']={name:'AGI evidence review studio',workspace,model:{primary:model,fallbacks:[]},skills:[...skills],sandbox:structuredClone(sandbox),tools:structuredClone(policy)};
    if(role==='node')delete config.agents.entries['agi-creator'];
    config.tools={...config.tools,...policy};
    config.browser={enabled:true,evaluateEnabled:false,allowSystemProfileImport:false,ssrfPolicy:{dangerouslyAllowPrivateNetwork:false}};
    config.plugins.allow=['openai','browser'];
    config.agents.defaults.timeoutSeconds=600;
  }
  // Global explicit allowlists conflict with the intentionally tool-less checker.
  // Creator/reviewer retain their own reviewed allowlists and sandbox policies.
  for(const [id,entry] of Object.entries(config.agents.entries)){
    if(id==='agi-checker')continue;
    entry.tools.deny=[...new Set([...(entry.tools.deny??[]),'browser','web_fetch','web_search'])];
    if(entry.sandbox?.browser)entry.sandbox.browser.autoStart=false;
  }
  delete config.tools.allow;
  delete config.tools.sandbox;
  return config;
}

const toolGroups={"group:fs":["read","write","edit","apply_patch"],"group:runtime":["exec","process"],"group:web":["web_fetch","web_search"],"group:ui":["browser","canvas"]};
function matchesTool(rule,tool){
 if(typeof rule!=='string')return false;
 rule=rule.trim().toLowerCase();tool=tool.trim().toLowerCase();rule=({bash:'exec','apply-patch':'apply_patch',cron:'automations'})[rule]??rule;
 if(rule==='*'||rule===tool)return true;
 if(toolGroups[rule])return toolGroups[rule].includes(tool);
 if(typeof rule!=='string')return false;
 return new RegExp('^'+rule.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(tool);
}
function restrictPolicy(fresh,old,global){
 const result=structuredClone(fresh),scopes=[global,old].filter(Boolean);
 for(const scope of scopes){
  if(Array.isArray(scope.allow))result.allow=(result.allow??[]).filter(t=>scope.allow.some(r=>matchesTool(r,t)));
  if(Array.isArray(scope.deny))result.deny=[...new Set([...(result.deny??[]),...scope.deny])];
  if(scope.exec){result.exec={...scope.exec,...result.exec};if(Number.isFinite(scope.exec.timeoutSeconds))result.exec.timeoutSeconds=Math.min(result.exec.timeoutSeconds??Infinity,scope.exec.timeoutSeconds);for(const key of ['mode','security','ask'])if(scope.exec[key]!==undefined)result.exec[key]=scope.exec[key];}
  if(scope.sandbox?.tools){result.sandbox??={};const current=result.sandbox.tools??{allow:result.allow??[]},previous=scope.sandbox.tools;if(Array.isArray(previous.allow))current.allow=(current.allow??[]).filter(t=>previous.allow.some(r=>matchesTool(r,t)));if(Array.isArray(previous.deny))current.deny=[...new Set([...(current.deny??[]),...previous.deny])];result.sandbox.tools=current;}
 }
 result.elevated={...(result.elevated??{}),enabled:false};
 if(result.exec)result.exec.host='sandbox';
 return result;
}
export function mergeRolePolicy(existing,generated){
 const result=structuredClone(generated);
 // Compile prior effective restrictions into each working role for the pinned model.
 // Global profile/provider allowlists must not conflict with the intentionally tool-less checker.
 for(const [id,entry] of Object.entries(result.agents.entries)){
  const prior=existing?.agents?.entries?.[id];
  if(id==='agi-checker'){entry.tools={deny:['*'],elevated:{enabled:false}};continue;}
  entry.tools=restrictPolicy(entry.tools,prior?.tools,existing?.tools);
  const previousEntry={...(prior??{}),model:entry.model,tools:prior?.tools??{}};
  entry.tools.allow=(entry.tools.allow??[]).filter(tool=>effectiveToolAllowed(existing??{},previousEntry,tool));
  // An empty upstream allowlist may be normalized away; explicitly deny every tool.
  if(entry.tools.allow.length===0)entry.tools.deny=[...new Set([...(entry.tools.deny??[]),'*'])];
  // alsoAllow and allow are mutually exclusive. Their effective profile additions are
  // already compiled above, so do not retain a profile that would discard them.
  const profileAdditions=prior?.tools?.alsoAllow??existing?.tools?.alsoAllow;
  if(prior?.tools?.profile!==undefined&&!Array.isArray(profileAdditions))entry.tools.profile=prior.tools.profile;
  if(prior?.tools?.byProvider!==undefined)entry.tools.byProvider=structuredClone(prior.tools.byProvider);
  if(Array.isArray(prior?.skills))entry.skills=entry.skills.filter(s=>prior.skills.includes(s));
 }
 // Preserve global denies, but never the broken global explicit allowlist.
 if(Array.isArray(existing?.tools?.deny))result.tools.deny=[...new Set([...(result.tools.deny??[]),...existing.tools.deny])];
 delete result.tools.allow;delete result.tools.sandbox;delete result.tools.profile;delete result.tools.byProvider;
 return result;
}
