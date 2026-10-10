import core from './admission-core/economics/computer-work.cjs';
import {ensure} from './util.mjs';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fields=['schema','chainId','manager','jobID','role','acceptedSpecSha256','sourceSpecSha256','runtimeSha256'];
function frozen(value){for(const child of Object.values(value))if(child&&typeof child==='object')frozen(child);return Object.freeze(value);}
// The caller must derive this record from its admitted, immutable job read, never a model reply.
export function createExecutionAdmission({specification,sourceSpecSha256,chainId,manager,jobID,role}){
 const admission={schema:'agi-public-web-admission/v1',chainId,manager:String(manager).toLowerCase(),jobID:String(jobID),role,acceptedSpecSha256:core.digest(specification),sourceSpecSha256,runtimeSha256:specification?.environment?.runtimeSha256?.[role]};
 return validateExecutionAdmission(admission,specification,role);
}
export function validateExecutionAdmission(value,specification,role,{purpose='accepted-job'}={}){
 ensure(['accepted-job','commissioning'].includes(purpose),'PUBLIC_WEB_PURPOSE_INVALID');
 core.publicWebScope(specification,role);
 ensure(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...fields].sort().join('|'),'PUBLIC_WEB_ADMISSION_INVALID');
 ensure(value.schema==='agi-public-web-admission/v1'&&value.role===role&&['agent','reviewer'].includes(role)&&Number.isSafeInteger(value.chainId)&&value.chainId>0&&/^0x[0-9a-f]{40}$/.test(value.manager)&&!/^0x0{40}$/.test(value.manager),'PUBLIC_WEB_ADMISSION_INVALID');
 ensure(typeof value.jobID==='string'&&/^[1-9][0-9]{0,77}$/.test(value.jobID)&&BigInt(value.jobID)<2n**256n,'PUBLIC_WEB_JOB_INVALID');
 ensure(hash(value.acceptedSpecSha256)&&hash(value.sourceSpecSha256)&&hash(value.runtimeSha256),'PUBLIC_WEB_ADMISSION_INVALID');
 ensure(value.acceptedSpecSha256===core.digest(specification)&&value.runtimeSha256===specification.environment.runtimeSha256[role],'PUBLIC_WEB_ACCEPTED_SPEC_CHANGED');
 ensure(value.chainId===specification.settlement.chainId&&value.manager===specification.settlement.manager,'PUBLIC_WEB_SETTLEMENT_CHANGED');
 return frozen(structuredClone(value));
}
