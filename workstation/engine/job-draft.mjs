import {need,money,moneyText,canonical} from './core.mjs';
import {nativeRuntime,validateConfig} from './runner.mjs';
import {NATIVE_ACTIONS} from './native.mjs';
import {recipientId} from './envelope.mjs';
import core from './core/computer-work.cjs';

export function descriptor(c) {
  validateConfig(c);
  const runtime=nativeRuntime(c);
  const reserve=money(c.costPolicy.modelCallReserveUSDC)*BigInt(c.limits.maxModelCalls)+money(c.costPolicy.actionReserveUSDC)*BigInt(c.limits.maxActions)+money(c.costPolicy.fixedRunReserveUSDC);
  return {schema:'agi-workstation-descriptor/v1',role:c.role,runtime,runtimeSha256:core.digest(runtime),recipientKeyIds:c.recipientPublicKeys.map(recipientId).sort(),limits:{maxSeconds:c.limits.maxSeconds,maxRunReserveUSDC:moneyText(reserve)},qualification:'PILOT_ONLY'};
}
export function draftJob(c,reviewer,{title='Inspect the dedicated test workspace',prompt='Inspect the permitted synthetic test workspace and use an installed text editor to save a concise report of the observed applications and screen to the specified output directory. Do not contact anyone or perform purchases. Cite observations honestly and state any unavailable capability.',output='report.md',authority,dataPolicy='public',chainId,manager,now=Math.floor(Date.now()/1000)}={}) {
  need(c.role==='agent','DRAFT_AGENT_CONFIG_REQUIRED');
  need(authority==='whole-account','DRAFT_EXPLICIT_WHOLE_ACCOUNT_REQUIRED');
  need(['public','confidential','restricted'].includes(dataPolicy),'DRAFT_DATA_POLICY');
  need(reviewer?.schema==='agi-workstation-descriptor/v1'&&reviewer.role==='reviewer'&&reviewer.runtimeSha256===core.digest(reviewer.runtime),'DRAFT_REVIEWER_DESCRIPTOR');
  const agent=descriptor(c);
  need(Array.isArray(reviewer.recipientKeyIds)&&canonical(agent.recipientKeyIds)===canonical([...reviewer.recipientKeyIds].sort()),'DRAFT_RECIPIENTS_MUST_MATCH');
  need(Number.isSafeInteger(reviewer.limits?.maxSeconds)&&reviewer.limits.maxSeconds>=1&&reviewer.limits.maxSeconds<=604800,'DRAFT_REVIEWER_LIMITS');
  need(money(reviewer.limits.maxRunReserveUSDC)>=0n,'DRAFT_REVIEWER_LIMITS');
  need(Number.isSafeInteger(now)&&now>0,'DRAFT_TIME');
  const seconds={agent:Math.min(600,agent.limits.maxSeconds),reviewer:Math.min(600,reviewer.limits.maxSeconds)};
  const deadline=now+86400,actions=NATIVE_ACTIONS;
  const media={md:'text/markdown',txt:'text/plain',json:'application/json',csv:'text/csv',pdf:'application/pdf',html:'text/html'};
  const spec={schema:'agi-node-job/v1',profile:'computer-work/v3',title,prompt,dataPolicy,inputs:[],outputs:[{name:output,mediaType:media[output.split('.').at(-1)]??'application/octet-stream',maxBytes:1048576,requirement:'A complete inspectable result meeting every acceptance criterion.'}],criteria:[{id:'useful-result',requirement:'The result answers the job brief using actual permitted observations and clearly identifies limitations.',verification:'Open the delivered file, compare its claims with independently observed evidence and reject unsupported completion claims.',evidence:[output]}],environment:{runtimeSha256:{agent:agent.runtimeSha256,reviewer:reviewer.runtimeSha256},capabilities:{agent:['desktop','files'],reviewer:['desktop','files','independent-review']}},authority:{agent:{scope:'dedicated-account',resources:[...agent.runtime.resources]},reviewer:{scope:'dedicated-account',resources:[...reviewer.runtime.resources]}},budget:{maxAgentSeconds:seconds.agent,maxReviewSeconds:seconds.reviewer,maxAgentCostUSDC:agent.limits.maxRunReserveUSDC,maxReviewCostUSDC:reviewer.limits.maxRunReserveUSDC},deadline,settlement:{chainId,manager:typeof manager==='string'?manager.toLowerCase():manager,recovery:'Encrypted results and signed receipts require a separately reviewed settlement integration. This draft does not publish confidential content or submit an on-chain transaction.'},coordination:{parentSpecSha256:null,dependencies:[],delegation:'none'},privacy:{recipientKeyIds:agent.recipientKeyIds,retentionSeconds:86400,publicDisclosure:'commitment-only',modelProcessing:'approved-provider'},execution:{maxWallSeconds:Math.max(seconds.agent,seconds.reviewer),leaseSeconds:30,maxResumes:2,retryBudget:1},permissions:Object.fromEntries(['agent','reviewer'].map(role=>[role,{enforcement:authority,allowedActions:[...actions],capabilityHandles:[...(role==='agent'?agent:reviewer).runtime.resources],externalEffects:['whole-account-interaction'],expiresAt:deadline}]))};
  core.validateComputerWork(spec);core.checkRuntime(spec,agent.runtime,'agent',now);core.checkRuntime(spec,reviewer.runtime,'reviewer',now);
  return spec;
}
