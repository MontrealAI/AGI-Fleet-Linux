import crypto from 'node:crypto';
import {verifyPublicWebQualification} from '../../compute/public-web-qualification.mjs';
import {validateExecutionAdmission} from '../public-web-admission.mjs';
import {validatePublicWebAuthority} from './public-web-authority.mjs';
import {createAcceptedPublicWebGrant} from '../../compute/public-web-issuer.mjs';
import {approvePublicWebGrant,grantDigest,canonicalGrant} from '../../compute/public-web-policy.mjs';
import {ensure} from '../util.mjs';
export const executionRole=kind=>kind==='generate'?'agent':['quality','computer-review'].includes(kind)?'reviewer':null;
export const executionSpec=(kind,input)=>kind==='computer-review'?input?.specification:input?.specification?.acceptance;
export function publicWebRequest(kind,input,options={}){
 const role=executionRole(kind),specification=executionSpec(kind,input);
 if(!role||!specification?.publicWeb?.[role]){ensure(options.executionAdmission==null&&options.purpose!=='commissioning','PUBLIC_WEB_ADMISSION_INVALID');return null;}
 const purpose=options.purpose??'accepted-job';
 ensure(['accepted-job','commissioning'].includes(purpose),'PUBLIC_WEB_PURPOSE_INVALID');
 ensure(purpose!=='commissioning'||options.allowPublicWebCommissioning===true,'PUBLIC_WEB_COMMISSIONING_APPROVAL_REQUIRED');
 const executionAdmission=validateExecutionAdmission(options.executionAdmission,specification,role,{purpose});
 return {executionAdmission,purpose,...(purpose==='commissioning'?{commissioningFixture:structuredClone(options.commissioningFixture)}:{})};
}
export function publicWebReviewerKey(value){
 if(value==null)return null;
 ensure(typeof value==='string'&&value.length<=4096&&value.includes('BEGIN PUBLIC KEY')&&!value.includes('PRIVATE'),'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
 let key;try{key=crypto.createPublicKey(value);}catch{ensure(false,'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');}
 ensure(key.asymmetricKeyType==='ed25519','PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
 return key.export({type:'spki',format:'pem'});
}
export function publicWebReviewerFingerprint(value){const key=publicWebReviewerKey(value);return key?crypto.createHash('sha256').update(crypto.createPublicKey(key).export({type:'spki',format:'der'})).digest('hex'):null;}
export function validatePublicWebHealth(identity,authority,admission,purpose,{reviewerPublicKey=null,now=Date.now()}={}){
 validatePublicWebAuthority(authority);
 const p=identity?.publicWeb;
 ensure(p?.enabled===true&&p.adapterVersion==='agi-public-browser/v1'&&p.operatorPublicKey===authority.publicKey&&/^sha256:[a-f0-9]{64}$/.test(p.browserImageID)&&/^sha256:[a-f0-9]{64}$/.test(p.proxyImageID),'PUBLIC_WEB_POLICY_INVALID');
 ensure(purpose==='commissioning'?['commissioning','qualified'].includes(p.mode):p.mode==='qualified'&&identity.qualification?.browser?.status==='PASS','COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
 ensure(p.runtimeSha256?.[admission.role]===admission.runtimeSha256,'PUBLIC_WEB_ACCEPTED_SPEC_CHANGED');
 if(purpose!=='commissioning'){
  const pinned=publicWebReviewerKey(reviewerPublicKey);
  ensure(pinned!==null,'PUBLIC_WEB_QUALIFICATION_REVIEWER_REQUIRED');
  ensure(publicWebReviewerKey(p.reviewerPublicKey)===pinned,'PUBLIC_WEB_QUALIFICATION_REVIEWER_CHANGED');
  const q=p.qualificationIdentity;
  ensure(q&&typeof q==='object'&&/^[a-f0-9]{64}$/.test(q.executionFingerprint??'')&&/^[a-f0-9]{64}$/.test(q.candidatePolicyHash??''),'PUBLIC_WEB_QUALIFICATION_BINDING');
  verifyPublicWebQualification(p.qualificationReceipt,{reviewerPublicKey:pinned,operatorPublicKey:authority.publicKey,executionFingerprint:q.executionFingerprint,candidatePolicyHash:q.candidatePolicyHash,browserImageID:p.browserImageID,proxyImageID:p.proxyImageID,sourceHashes:q.sourceHashes,now});
 }
 return p;
}
export function signPublicWebPreparation({requestID,kind,input,executionAdmission,purpose,preparation,identity,authority,reviewerPublicKey=null,now=Date.now()}){
 const role=executionRole(kind),specification=executionSpec(kind,input),admission=validateExecutionAdmission(executionAdmission,specification,role,{purpose}),policy=validatePublicWebHealth(identity,authority,admission,purpose,{reviewerPublicKey,now});
 ensure(preparation&&typeof preparation==='object'&&!Array.isArray(preparation)&&Object.keys(preparation).sort().join('|')===['schema','requestID','requestSha256','approvalPayload','expectedGrantHash','expiresAt','purpose'].sort().join('|')&&preparation.schema==='agi-public-web-preparation/v1','PUBLIC_WEB_PREPARATION_INVALID');
 ensure(preparation.requestID===requestID&&preparation.purpose===purpose&&preparation.requestSha256===grantDigest({kind,input,executionAdmission:admission,purpose}),'PUBLIC_WEB_PREPARATION_CHANGED');
 const p=preparation.approvalPayload;
 ensure(p?.sessionID===requestID&&p.runtimePolicyHash===identity.policyHash&&p.browserImageID===policy.browserImageID&&p.proxyImageID===policy.proxyImageID,'PUBLIC_WEB_BINDING_INVALID');
 const bindings=Object.fromEntries(['runtimePolicyHash','sessionID','browserContainerID','browserImageID','proxyImageID','browserIPv4','proxyIPv4'].map(key=>[key,p[key]]));
 const expected=createAcceptedPublicWebGrant({immutableSpec:specification,executionAdmission:admission,bindings,issuedAt:p.issuedAt,expiresAt:p.expiresAt,purpose});
 ensure(canonicalGrant(expected)===canonicalGrant(p)&&preparation.expectedGrantHash===grantDigest(expected)&&preparation.expiresAt===expected.expiresAt,'PUBLIC_WEB_PREPARATION_CHANGED');
 ensure(now>=expected.issuedAt&&now<expected.expiresAt,'PUBLIC_WEB_GRANT_EXPIRED');
 return approvePublicWebGrant(expected,authority.privateKey,{now});
}
