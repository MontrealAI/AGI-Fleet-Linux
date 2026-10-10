import core from '../src/admission-core/economics/computer-work.cjs';
import {canonical,sha256,ensure} from '../src/util.mjs';
import {validateExecutionAdmission} from '../src/public-web-admission.mjs';
import {validateBundle,buildBundle} from '../src/artifacts.mjs';
// This template is the only input allowed in commissioning mode. Its synthetic
// settlement descriptor is never submitted to a chain or treated as an accepted job.
export const PUBLIC_WEB_COMMISSIONING_TEMPLATE='agi-public-web-example-domain/v1';
export function createPublicWebCommissioningFixture({challenge,issuedAt,agentRuntimeSha256,reviewerRuntimeSha256}){
 ensure([challenge,agentRuntimeSha256,reviewerRuntimeSha256].every(v=>/^[a-f0-9]{64}$/.test(v??''))&&Number.isSafeInteger(issuedAt)&&issuedAt>0,'PUBLIC_WEB_COMMISSIONING_FIXTURE');
 const fixture={schema:'agi-public-web-commissioning-fixture/v1',challenge,issuedAt,agentRuntimeSha256,reviewerRuntimeSha256};
 const scope={hosts:[{hostname:'example.com',ports:[443]}],limits:{maxRequests:8,maxConnections:2,maxBytes:1048576}};
 const specification={schema:'agi-node-job/v1',profile:'computer-work/v2',title:'Controlled public browser commissioning',prompt:'This is a synthetic commissioning exercise, not an accepted or paid job. Use agi_public_browser to navigate to https://example.com/. Inspect the actual document title and first h1 using the browser. Write observation.json with exactly schema="agi-public-web-observation/v1", url="https://example.com/", title, heading, and challenge="'+challenge+'". The reviewer must independently navigate with agi_public_browser and compare the saved actual file with the current page. Never infer browser success from this instruction, a model reply, or prior knowledge. No login, interaction with people, publication, funds or transactions. If the browser is unavailable decline.',dataPolicy:'public',inputs:[],outputs:[{name:'observation.json',mediaType:'application/json',maxBytes:4096,requirement:'Exact structured observation of the public page and supplied synthetic challenge.'}],criteria:[{id:'actual-observation',requirement:'The exact title and heading match the current public page and challenge is unchanged.',verification:'Independently navigate to the allowed URL using the scoped browser, read the actual JSON output and compare its fields.',evidence:['observation.json']}],environment:{runtimeSha256:{agent:agentRuntimeSha256,reviewer:reviewerRuntimeSha256},capabilities:{agent:['browser','files','code'],reviewer:['browser','files','independent-review']}},authority:{agent:{scope:'isolated-public',resources:['job-workspace','public-web']},reviewer:{scope:'isolated-public',resources:['job-workspace','public-web']}},budget:{maxAgentSeconds:180,maxReviewSeconds:180,maxAgentCostUSDC:'0',maxReviewCostUSDC:'0'},deadline:Math.floor(issuedAt/1000)+600,settlement:{chainId:31337,manager:'0x'+'c'.repeat(40),recovery:'Synthetic commissioning only. No accepted chain job, publication, transaction or settlement.'},coordination:{parentSpecSha256:null,dependencies:[],delegation:'none'},publicWeb:{agent:structuredClone(scope),reviewer:structuredClone(scope)}};
 core.validateComputerWork(specification);
 return {fixture,specification,work:{schema:'agi-agent-work/v1',task:specification.prompt,inputs:'',acceptance:specification,compatibility:'buyer-or-envelope-validator'}};
}
export function validatePublicWebCommissioningFixture({specification,fixture,executionAdmission,role,now=Date.now()}){
 ensure(fixture&&Object.keys(fixture).sort().join('|')==='agentRuntimeSha256|challenge|issuedAt|reviewerRuntimeSha256|schema'&&fixture.schema==='agi-public-web-commissioning-fixture/v1','PUBLIC_WEB_COMMISSIONING_FIXTURE');
 const expected=createPublicWebCommissioningFixture(fixture);
 ensure(canonical(specification)===canonical(expected.specification)&&now>=fixture.issuedAt&&now<expected.specification.deadline*1000,'PUBLIC_WEB_COMMISSIONING_FIXTURE');
 const admission=validateExecutionAdmission(executionAdmission,specification,role);
 ensure(admission.jobID==='1'&&admission.sourceSpecSha256===sha256(canonical(specification)),'PUBLIC_WEB_COMMISSIONING_FIXTURE');
 return expected;
}
export function verifyPublicWebCommissioningDelivery({specification,fixture},delivery){
 const {files}=validateBundle(specification,Buffer.from(delivery)),value=JSON.parse(files.get('observation.json'));
 ensure(Object.keys(value).sort().join('|')==='challenge|heading|schema|title|url'&&value.schema==='agi-public-web-observation/v1'&&value.challenge===fixture.challenge&&value.url==='https://example.com/'&&value.title==='Example Domain'&&value.heading==='Example Domain','PUBLIC_WEB_COMMISSIONING_DELIVERY');
 return {status:'PASS',scope:'Artifact fields only; actual browser/tool use and independent live review require captured evidence.',artifactSha256:sha256(files.get('observation.json')),productionQualified:false};
}

export function createPublicWebCommissioningInput(plan,role){
 ensure(['agent','reviewer'].includes(role),'PUBLIC_WEB_COMMISSIONING_FIXTURE');
 const expected=createPublicWebCommissioningFixture(plan.fixture);ensure(canonical(plan.specification)===canonical(expected.specification),'PUBLIC_WEB_COMMISSIONING_FIXTURE');
 if(role==='agent')return {kind:'generate',input:{specification:expected.work,attempt:1}};
 const observation={schema:'agi-public-web-observation/v1',url:'https://example.com/',title:'Example Domain',heading:'Example Domain',challenge:plan.fixture.challenge};
 const delivery=buildBundle(plan.specification,new Map([['observation.json',Buffer.from(canonical(observation)+'\n')]]));
 return {kind:'computer-review',input:{specification:plan.specification,delivery}};
}
