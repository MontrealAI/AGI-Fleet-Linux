import qualified from '../packages/AGI_Agent/src/admission-core/economics/qualification-fixture.cjs';
import crypto from 'node:crypto';
import core from '../packages/AGI_Agent/src/admission-core/economics/admission.cjs';
const {canonical,digest}=core;
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync(new URL('../packages/AGI_Agent/tests/admission-fixture.json',import.meta.url)));
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(reviewPayment='retainer') {
 const now=Math.floor(Date.now()/1000);
 const keys=crypto.generateKeyPairSync('ed25519'),input=clone(sample);
 const policy={schemaVersion:3,epoch:'funding-allocation-1',chainId:1,manager:addr(99),wallet:addr(1),role:'employer',trustedKeys:{issuer:keys.publicKey.export({type:'spki',format:'pem'})},classes:['catalog'],maxPacketAgeSeconds:600,maxEvidenceAgeSeconds:86400,minimumSamples:100,minimumHorizonDays:180,limits:{employer:{minimumExpectedNetUSDC:'100',maximumScenarioLossUSDC:'1100'},agent:{minimumExpectedNetUSDC:'100',maximumScenarioLossUSDC:'100'},reviewer:{minimumExpectedNetUSDC:'10',maximumScenarioLossUSDC:'160'}},maxOpenExposureUSDC:'5000',maxEpochCostUSDC:'100',maxOpenJobs:3,maxGasWeiPerJob:'1000000000000000',capacity:{allocationId:'dedicated-allocation',agentSlots:3,reviewerSlots:9,providerUnits:100}};
 const payload={schemaVersion:3,policyDigest:digest(policy),offerId:digest('offer'),participantId:'employer',jobClass:'catalog',issuedAt:now-10,expiresAt:now+500,specURI:'ipfs://fixture',specSha256:digest('spec'),evidence:{reportSha256:digest('report'),measuredAt:now-100,sampleCount:100,qualification:'qualified',costsIncludeFailuresAndOverhead:true},identities:Object.fromEntries(input.participants.map((p,i)=>[p.id,{wallet:addr(i+1),controllerId:digest('independent-'+i)}])),lifecycle:input,gasBudgetWei:'1000000000000000',ethPriceCeilingUSDC:'4000',commitment:{action:'createJob',durationSeconds:'100',details:'public task'},capacity:{allocationId:'dedicated-allocation',leaseId:digest('lease'),expiresAt:now+600,agentSlots:1,reviewerSlots:3,providerUnits:20},valueEvidence:{baselineSha256:digest('baseline'),outcomesSha256:digest('outcomes'),measurementKind:'observed',sampleCount:100}};
 const q=qualified.qualificationFixture({measurementKind:'observed',now,reviewPayment});
 policy.schemaVersion=reviewPayment==='retainer'?5:7;if(policy.schemaVersion===7)policy.reviewPayment=reviewPayment;policy.calibration=q.policy.calibration;policy.classes=q.policy.classes;policy.limits=q.policy.limits;payload.schemaVersion=policy.schemaVersion;payload.lifecycle=q.model;payload.jobClass=q.envelope.payload.jobClass;payload.evidence=q.envelope.payload.evidence;
 const envelope={keyId:'issuer',payload,signature:''},observed={chainId:1,manager:policy.manager,wallet:policy.wallet,offerId:payload.offerId,specURI:payload.specURI,specSha256:payload.specSha256,terms:clone(input.terms),observedAt:now,commitment:clone(payload.commitment)};
 const resign=()=>{payload.policyDigest=digest(policy);envelope.signature=crypto.sign(null,Buffer.from(canonical(payload)),keys.privateKey).toString('base64');};resign();
 return {evidenceReport:q.evidenceReport,policy,envelope,observed,portfolio:{openExposureUSDC:'0',epochCostUSDC:'0',openJobs:0,capacity:{agentSlots:0,reviewerSlots:0,providerUnits:0}},now,resign};
}

export {fixture,addr};
