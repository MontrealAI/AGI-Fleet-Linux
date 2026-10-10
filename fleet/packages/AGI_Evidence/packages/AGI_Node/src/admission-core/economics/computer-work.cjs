'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const {domainToASCII} = require('node:url');
const fail = (yes, code) => { if (!yes) throw Error('COMPUTER_' + code); };
const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
const digest = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const text = (x, n=2000) => typeof x === 'string' && x.length > 0 && x.length <= n && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const integer = (x, lo, hi) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const keys = (x, names, code) => fail(x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join('|') === [...names].sort().join('|'), code);
const unique = (xs, max=64) => Array.isArray(xs) && xs.length <= max && xs.every(x => text(x,160)) && new Set(xs).size === xs.length;
const MAX_FILE_BYTES = 32*1024*1024, MAX_TOTAL_BYTES = 64*1024*1024, MAX_BUNDLE_BYTES = 90*1024*1024;
function safeName(name) {
  fail(text(name,240) && /^[A-Za-z0-9][A-Za-z0-9_.\/-]*$/.test(name) && name.split('/').length <= 12 && name.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.')), 'ARTIFACT_PATH');
  return name;
}
function validatePublicWebScope(scope) {
  keys(scope,['hosts','limits',...(Object.hasOwn(scope??{},'interactions')?['interactions']:[])],'PUBLIC_WEB_SCOPE');
  if(Object.hasOwn(scope,'interactions'))fail(unique(scope.interactions,3)&&scope.interactions.includes('inspect')&&scope.interactions.every(x=>['inspect','navigate','form'].includes(x)),'PUBLIC_WEB_INTERACTIONS');
  fail(Array.isArray(scope.hosts) && scope.hosts.length>=1 && scope.hosts.length<=32,'PUBLIC_WEB_HOSTS');
  const seen=new Set();
  for(const host of scope.hosts){
    keys(host,['hostname','ports'],'PUBLIC_WEB_HOST');
    const name=host.hostname;
    fail(typeof name==='string' && name.length<=253 && name===domainToASCII(name).toLowerCase() && !net.isIP(name) && !/[\s\\/%:@\[\]?#\x00-\x1f\x7f]/.test(name),'PUBLIC_WEB_HOST');
    const labels=name.split('.');
    fail(labels.length>=2 && labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && /[a-z]/.test(labels.at(-1)) && !['localhost','local','internal','home','lan','test','invalid','onion'].includes(labels.at(-1)) && !seen.has(name),'PUBLIC_WEB_HOST');
    seen.add(name);
    fail(Array.isArray(host.ports) && host.ports.length>=1 && host.ports.length<=2 && new Set(host.ports).size===host.ports.length && host.ports.every(port=>port===80||port===443),'PUBLIC_WEB_PORT');
  }
  keys(scope.limits,['maxRequests','maxConnections','maxBytes'],'PUBLIC_WEB_LIMITS');
  for(const [key,min,max]of [['maxRequests',1,256],['maxConnections',1,16],['maxBytes',1024,67108864]])fail(integer(scope.limits[key],min,max),'PUBLIC_WEB_LIMITS');
  return scope;
}
function publicWebScope(s,role){
  validateComputerWork(s);fail(['agent','reviewer'].includes(role),'ROLE');
  const scope=s.publicWeb?.[role];fail(scope!==null && scope!==undefined,'PUBLIC_WEB_SCOPE_REQUIRED');return scope;
}
function validateComputerWork(s) {
  if(s?.profile === 'computer-work/v3') return validatePrivateWork(s);
  keys(s,['schema','profile','title','prompt','dataPolicy','inputs','outputs','criteria','environment','authority','budget','deadline','settlement','coordination',...(Object.hasOwn(s??{},'publicWeb')?['publicWeb']:[])],'SPEC_FIELDS');
  fail(s.schema === 'agi-node-job/v1' && s.profile === 'computer-work/v2', 'SPEC_VERSION');
  fail(text(s.title,160) && text(s.prompt,12000) && ['public','scoped'].includes(s.dataPolicy), 'SPEC_GOAL');
  keys(s.environment,['runtimeSha256','capabilities'],'ENVIRONMENT');
  keys(s.environment.runtimeSha256,['agent','reviewer'],'RUNTIME_HASH');
  fail(Object.values(s.environment.runtimeSha256).every(hash), 'RUNTIME_HASH');
  keys(s.environment.capabilities,['agent','reviewer'],'CAPABILITIES');
  keys(s.authority,['agent','reviewer'],'AUTHORITY');
  for (const role of ['agent','reviewer']) {
    fail(unique(s.environment.capabilities[role]) && s.environment.capabilities[role].length > 0,'CAPABILITIES');
    keys(s.authority[role],['scope','resources'],'AUTHORITY');
    fail(['isolated-public','dedicated-account'].includes(s.authority[role].scope) && unique(s.authority[role].resources),'AUTHORITY');
    fail(s.authority[role].scope !== 'isolated-public' || s.dataPolicy === 'public','DATA_AUTHORITY');
  }
  if(Object.hasOwn(s,'publicWeb'))keys(s.publicWeb,['agent','reviewer'],'PUBLIC_WEB_SCOPE');
  for(const role of ['agent','reviewer']){
    const scope=s.publicWeb?.[role],isolatedWeb=s.authority[role].scope==='isolated-public' && (s.authority[role].resources.includes('public-web')||s.environment.capabilities[role].includes('browser'));
    if(isolatedWeb)fail(scope!==null && scope!==undefined,'PUBLIC_WEB_SCOPE_REQUIRED');
    if(scope!==null && scope!==undefined){
      validatePublicWebScope(scope);
      fail(s.dataPolicy==='public' && s.authority[role].scope==='isolated-public' && s.authority[role].resources.includes('public-web') && s.environment.capabilities[role].includes('browser'),'PUBLIC_WEB_AUTHORITY');
    }
  }
  for (const kind of ['inputs','outputs']) {
    fail(Array.isArray(s[kind]) && s[kind].length <= 64 && (kind === 'inputs' || s[kind].length > 0),'FILES');
    const seen = new Set(); let total=0;
    for (const f of s[kind]) {
      keys(f,kind === 'inputs' ? ['name','mediaType','uri','sha256','maxBytes'] : ['name','mediaType','maxBytes','requirement'],'FILE_FIELDS');
      safeName(f.name); fail(!seen.has(f.name.toLowerCase()),'DUPLICATE_FILE'); seen.add(f.name.toLowerCase());
      fail(text(f.mediaType,160) && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(f.mediaType) && integer(f.maxBytes,1,MAX_FILE_BYTES),'FILE_LIMIT'); total+=f.maxBytes;
      if (kind === 'outputs') fail(text(f.requirement),'OUTPUT_REQUIREMENT');
      else { fail(hash(f.sha256) && text(f.uri,1200),'INPUT'); const u=new URL(f.uri); fail(['https:','ipfs:'].includes(u.protocol) && !u.username && !u.password,'INPUT_URI'); }
    }
    fail(total <= MAX_TOTAL_BYTES,'TOTAL_LIMIT');
  }
  fail(Array.isArray(s.criteria) && s.criteria.length > 0 && s.criteria.length <= 64,'CRITERIA'); const ids=new Set();
  for (const c of s.criteria) {
    keys(c,['id','requirement','verification','evidence'],'CRITERION');
    fail(text(c.id,40) && /^[a-z0-9_-]+$/.test(c.id) && !ids.has(c.id) && text(c.requirement) && text(c.verification) && unique(c.evidence) && c.evidence.length > 0 && c.evidence.every(name => s.outputs.some(f=>f.name===name)),'CRITERION'); ids.add(c.id);
  }
  keys(s.budget,['maxAgentSeconds','maxReviewSeconds','maxAgentCostUSDC','maxReviewCostUSDC'],'BUDGET');
  for(const k of ['maxAgentSeconds','maxReviewSeconds']) fail(integer(s.budget[k],1,604800),'TIME_BUDGET');
  for(const k of ['maxAgentCostUSDC','maxReviewCostUSDC']) fail(typeof s.budget[k] === 'string' && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(s.budget[k]),'COST_BUDGET');
  fail(integer(s.deadline,1,Number.MAX_SAFE_INTEGER),'DEADLINE');
  keys(s.settlement,['chainId','manager','recovery'],'SETTLEMENT');
  fail(integer(s.settlement.chainId,1,Number.MAX_SAFE_INTEGER) && /^0x[0-9a-f]{40}$/.test(s.settlement.manager) && !/^0x0{40}$/.test(s.settlement.manager) && text(s.settlement.recovery),'SETTLEMENT');
  keys(s.coordination,['parentSpecSha256','dependencies','delegation'],'COORDINATION');
  fail((s.coordination.parentSpecSha256===null || hash(s.coordination.parentSpecSha256)) && unique(s.coordination.dependencies) && s.coordination.dependencies.every(hash) && ['none','separately-admitted'].includes(s.coordination.delegation),'COORDINATION');
  fail(Buffer.byteLength(canonical(s))<=65536,'SPEC_SIZE'); return s;
}

function validatePrivateWork(s) {
  keys(s,['schema','profile','title','prompt','dataPolicy','inputs','outputs','criteria','environment','authority','budget','deadline','settlement','coordination','privacy','execution','permissions'],'SPEC_FIELDS');
  fail(['public','confidential','restricted'].includes(s.dataPolicy),'DATA_CLASS');
  keys(s.privacy,['recipientKeyIds','retentionSeconds','publicDisclosure','modelProcessing'],'PRIVACY');
  fail(unique(s.privacy.recipientKeyIds,8) && s.privacy.recipientKeyIds.length>0 && s.privacy.recipientKeyIds.every(hash),'RECIPIENTS');
  fail(integer(s.privacy.retentionSeconds,60,7776000) && ['commitment-only','public-files'].includes(s.privacy.publicDisclosure) && ['approved-provider','local-only'].includes(s.privacy.modelProcessing),'PRIVACY');
  fail(s.dataPolicy==='public' || s.privacy.publicDisclosure==='commitment-only','PRIVATE_PUBLICATION');
  keys(s.execution,['maxWallSeconds','leaseSeconds','maxResumes','retryBudget'],'EXECUTION');
  fail(integer(s.execution.maxWallSeconds,1,604800) && integer(s.execution.leaseSeconds,5,300) && integer(s.execution.maxResumes,0,1000) && integer(s.execution.retryBudget,0,100),'EXECUTION');
  keys(s.permissions,['agent','reviewer'],'PERMISSIONS');
  for(const role of ['agent','reviewer']) {
    const p=s.permissions[role];keys(p,['enforcement','allowedActions','capabilityHandles','externalEffects','expiresAt'],'PERMISSIONS');
    fail(['observe-only','whole-account','broker-scoped'].includes(p.enforcement) && unique(p.allowedActions) && p.allowedActions.length>0 && unique(p.capabilityHandles) && unique(p.externalEffects) && integer(p.expiresAt,1,Number.MAX_SAFE_INTEGER),'PERMISSIONS');
    fail(p.enforcement!=='whole-account' || (p.externalEffects.length===1 && p.externalEffects[0]==='whole-account-interaction'),'WHOLE_ACCOUNT_ACKNOWLEDGEMENT');
    fail(p.enforcement!=='observe-only' || (p.externalEffects.length===0 && p.allowedActions.every(a=>['screenshot','list_apps','list_windows','get_window_state'].includes(a))),'READ_ONLY');
  }
  const projection={...s,profile:'computer-work/v2',dataPolicy:s.dataPolicy==='public'?'public':'scoped'};
  delete projection.privacy;delete projection.execution;delete projection.permissions;
  fail(Array.isArray(s.inputs),'FILES');
  projection.inputs=s.inputs.map(f=>{
    if(s.dataPolicy==='public')return f;
    fail(typeof f.uri==='string' && /^agi-(local|encrypted):\/\/[a-z0-9][a-z0-9_-]{0,79}\/[A-Za-z0-9_.\/-]+$/.test(f.uri),'PRIVATE_INPUT_HANDLE');
    safeName(f.uri.slice(f.uri.indexOf('/',f.uri.indexOf('://')+3)+1));
    return {...f,uri:'https://example.invalid/staged-input'};
  });
  validateComputerWork(projection);
  fail(s.execution.maxWallSeconds>=Math.max(s.budget.maxAgentSeconds,s.budget.maxReviewSeconds),'WALL_BUDGET');
  fail(Buffer.byteLength(canonical(s))<=65536,'SPEC_SIZE');return s;
}
function privateCommitment({specSha256,runtimeSha256,encryptedSha256,receiptSha256,recipientPolicySha256}) {
  fail([specSha256,runtimeSha256,encryptedSha256,receiptSha256,recipientPolicySha256].every(hash),'COMMITMENT');
  return {schema:'agi-private-commitment/v1',specSha256,runtimeSha256,encryptedSha256,receiptSha256,recipientPolicySha256,disclosure:'commitments-only'};
}

function checkRuntime(s, runtime, role, now=Math.floor(Date.now()/1000)) {
  validateComputerWork(s); fail(['agent','reviewer'].includes(role),'ROLE');
  const native = runtime?.schemaVersion === 2;
  keys(runtime,native ? ['schemaVersion','adapter','model','openclawVersion','policySha256','installationSha256','capabilities','scope','resources','maxTaskSeconds'] : ['schemaVersion','model','openclawVersion','policySha256','imageSha256','capabilities','scope','resources','maxTaskSeconds'],'RUNTIME');
  fail((native ? runtime.adapter === 'openclaw-native/v1' && runtime.scope === 'dedicated-account' && hash(runtime.installationSha256) : runtime.schemaVersion === 1 && hash(runtime.imageSha256)) && text(runtime.model,160) && text(runtime.openclawVersion,80) && hash(runtime.policySha256) && unique(runtime.capabilities) && unique(runtime.resources) && integer(runtime.maxTaskSeconds,1,604800),'RUNTIME');
  fail(digest(runtime)===s.environment.runtimeSha256[role],'RUNTIME_CHANGED');
  fail(integer(now,1,Number.MAX_SAFE_INTEGER) && now<s.deadline,'DEADLINE');
  fail(s.environment.capabilities[role].every(c=>runtime.capabilities.includes(c)),'CAPABILITY_UNAVAILABLE');
  fail(s.authority[role].scope===runtime.scope && s.authority[role].resources.every(r=>runtime.resources.includes(r)),'AUTHORITY_UNAVAILABLE');
  fail(s.budget[role==='agent'?'maxAgentSeconds':'maxReviewSeconds']<=runtime.maxTaskSeconds,'RUNTIME_TIME_LIMIT');
  return {specSha256:digest(s),environmentSha256:digest(runtime),role};
}
if(require.main===module){try{fail(process.argv.length===3,'USAGE: node scripts/economics/computer-work.cjs job.json'); const f=process.argv[2],st=fs.lstatSync(f); fail(st.isFile()&&!st.isSymbolicLink()&&st.size<=65536,'INPUT_FILE');const s=validateComputerWork(JSON.parse(fs.readFileSync(f)));console.log(JSON.stringify({profile:s.profile,specSha256:digest(s),authorization:'NONE: required capabilities and authority must be checked by the runtime.'},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={validatePublicWebScope,publicWebScope,validateComputerWork,validatePrivateWork,privateCommitment,checkRuntime,safeName,canonical,digest,MAX_FILE_BYTES,MAX_TOTAL_BYTES,MAX_BUNDLE_BYTES};
