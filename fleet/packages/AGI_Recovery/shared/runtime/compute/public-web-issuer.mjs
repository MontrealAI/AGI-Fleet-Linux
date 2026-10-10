import core from '../src/admission-core/economics/computer-work.cjs';
import {validateExecutionAdmission} from '../src/public-web-admission.mjs';
import {PUBLIC_WEB_MAX_TTL_MS,validatePublicWebGrant} from './public-web-policy.mjs';
const need=(ok,code)=>{if(!ok)throw Error(code);};
// Returns an unsigned template. Only the signer-side vault may approve it.
export function createAcceptedPublicWebGrant(options){
 need(options&&Object.keys(options).every(key=>['immutableSpec','executionAdmission','bindings','issuedAt','expiresAt','purpose'].includes(key)),'PUBLIC_WEB_ISSUANCE_INVALID');
 const {immutableSpec,bindings}=options,purpose=options.purpose??'accepted-job',admission=validateExecutionAdmission(options.executionAdmission,immutableSpec,options.executionAdmission?.role,{purpose}),scope=core.publicWebScope(immutableSpec,admission.role),issuedAt=options.issuedAt??Date.now();
 need(bindings&&typeof bindings==='object'&&!Array.isArray(bindings)&&Object.keys(bindings).sort().join('|')===['runtimePolicyHash','sessionID','browserContainerID','browserImageID','proxyImageID','browserIPv4','proxyIPv4'].sort().join('|'),'PUBLIC_WEB_BINDING_INVALID');
 need(Number.isSafeInteger(issuedAt)&&issuedAt>0&&Number.isSafeInteger(immutableSpec.deadline*1000),'PUBLIC_WEB_GRANT_EXPIRED');
 const ceiling=Math.min(immutableSpec.deadline*1000,issuedAt+immutableSpec.budget[admission.role==='agent'?'maxAgentSeconds':'maxReviewSeconds']*1000,issuedAt+PUBLIC_WEB_MAX_TTL_MS),expiresAt=options.expiresAt??ceiling;
 need(Number.isSafeInteger(expiresAt)&&expiresAt<=ceiling,'PUBLIC_WEB_GRANT_EXPIRED');
 return validatePublicWebGrant({schema:'agi-public-web-grant/v2',purpose,...structuredClone(bindings),taskHash:admission.acceptedSpecSha256,sourceSpecSha256:admission.sourceSpecSha256,chainId:admission.chainId,manager:admission.manager,jobID:admission.jobID,role:admission.role,runtimeSha256:admission.runtimeSha256,issuedAt,expiresAt,hosts:structuredClone(scope.hosts),interactions:structuredClone(scope.interactions??['inspect','navigate']),limits:structuredClone(scope.limits)},{now:issuedAt});
}
