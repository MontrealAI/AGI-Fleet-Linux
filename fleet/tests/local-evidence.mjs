// Synthetic fixture for the disposable-chain integration only, never observed production evidence.
import lifecycleCore from '../packages/AGI_Agent/src/admission-core/economics/lifecycle.cjs';
import calibration from '../packages/AGI_Agent/src/admission-core/economics/calibration.cjs';
import core from '../packages/AGI_Agent/src/admission-core/economics/admission.cjs';
import units from '../packages/AGI_Agent/src/admission-core/lib/usdc.js';
export function localEvidence(model,now){
 const assessed=lifecycleCore.lifecycle(model),records=[],cash=x=>BigInt(units.parseUSDC(x)),ids=model.participants.map(x=>x.id);
 for(const partition of ['calibration','evaluation'])for(let i=0;i<100;i++){
  const index=i<92?0:i-91,row=model.cases[index],result=assessed.cases[index],receipts={},deposits=result.capitalCommittedUSDC;
  for(const id of ids){const raw=result.netUSDC[id],net=raw.startsWith('-')?-cash(raw.slice(1)):cash(raw);receipts[id]=units.formatUSDC(net+cash(deposits[id])+cash(row.costsUSDC[id])-(id==='employer'?cash(row.employerValueUSDC):0n));}
  const total=Object.values(deposits).reduce((n,v)=>n+cash(v),0n),paid=Object.values(receipts).reduce((n,v)=>n+cash(v),0n),liabilities=row.outcome==='paymentUnavailable'?total:0n;
  records.push({id:partition+'-'+i,group:partition+'-run',partition,caseId:row.id,costsUSDC:row.costsUSDC,depositsUSDC:deposits,receiptsUSDC:receipts,otherReceiptsUSDC:units.formatUSDC(total-paid-liabilities),liabilitiesUSDC:units.formatUSDC(liabilities),employerValueUSDC:row.employerValueUSDC,evidenceSha256:core.digest('synthetic-'+partition+'-'+i)});
 }
 return JSON.stringify(calibration.buildCalibration(model,{schemaVersion:1,measurementKind:'observed',jobClass:'bounded-json',environmentSha256:core.digest('synthetic-runtime'),measuredAt:now,records}));
}
