import crypto from 'node:crypto';
import {canonical,sha256,ensure} from '../src/util.mjs';
import {validateComputerSpec,validateBundle,buildBundle} from '../src/artifacts.mjs';

export function reconcileRows(rows){
 ensure(Array.isArray(rows)&&rows.length===48,'COMMISSIONING_ROWS');
 const totals={CAD:0,USD:0},groups={},ids=new Set();
 for(const r of rows){
  ensure(r&&Object.keys(r).sort().join('|')==='amountCents|currency|department|id'&&/^[a-f0-9]{12}$/.test(r.id)&&!ids.has(r.id)&&['CAD','USD'].includes(r.currency)&&['engineering','operations','research'].includes(r.department)&&Number.isSafeInteger(r.amountCents)&&Math.abs(r.amountCents)<=99999,'COMMISSIONING_ROW');
  ids.add(r.id);totals[r.currency]+=r.amountCents;
  const key=r.department+':'+r.currency;groups[key]=(groups[key]??0)+r.amountCents;
 }
 return {schema:'agi-reconciliation-result/v1',rowCount:rows.length,inputSHA256:sha256(canonical(rows)),totalsCents:totals,byDepartmentCents:groups,rowIDs:rows.map(r=>r.id).sort()};
}
export function createCommissioningPlan({releaseSHA256,now=Date.now(),randomBytes=crypto.randomBytes}={}){
 ensure(/^[a-f0-9]{64}$/.test(releaseSHA256??''),'COMMISSIONING_RELEASE_IDENTITY');
 const rows=Array.from({length:48},(_,i)=>({id:randomBytes(6).toString('hex'),currency:i%2?'USD':'CAD',department:['engineering','operations','research'][i%3],amountCents:randomBytes(4).readUInt32BE(0)%199999-99999}));
 const oracle=reconcileRows(rows),runID=crypto.randomUUID();
 const specification={schema:'agi-node-job/v1',profile:'computer-work/v1',title:'Reconcile a synthetic multi-department transaction export',prompt:'Reconcile the synthetic public rows below. Amounts are integer minor units; never combine currencies. Produce result.json with exactly schema=agi-reconciliation-result/v1, rowCount, inputSHA256 (SHA-256 of canonical JSON of rows; sorted object keys, original array order, no whitespace), totalsCents (CAD/USD), byDepartmentCents (department:currency keys), and rowIDs sorted lexicographically. Produce reconciliation.csv with header department,currency,amountCents and one row for each department/currency pair sorted by department then currency. Independently recalculate both files with code and inspect their contents. Do not merely report success. No network, private inputs, publication or transactions. Synthetic input rows: '+canonical(rows),dataPolicy:'public',inputs:[],outputs:[{name:'result.json',mediaType:'application/json',maxBytes:20000,requirement:'Exact reconciliation and complete sorted row identity list; integer cents only.'},{name:'reconciliation.csv',mediaType:'text/csv',maxBytes:4000,requirement:'Six department/currency totals, matching result.json and source rows.'}],criteria:[{id:'totals',requirement:'Both currencies and all six department/currency sums match independent recomputation from all original rows.'},{id:'completeness',requirement:'Exactly 48 distinct source row IDs are included and the canonical input hash is correct.'},{id:'cross-check',requirement:'The CSV has exactly the required six records and matches the JSON totals with no invented data.'}]};
 validateComputerSpec(specification);
 return {schema:'agi-commissioning-plan/v1',runID,createdAt:now,expiresAt:now+7200000,releaseSHA256,specSHA256:sha256(canonical(specification)),specification,privateOracle:{rows,expected:oracle,browserChallenge:randomBytes(24).toString('hex'),desktopChallenge:randomBytes(24).toString('hex')},scope:'Synthetic file reconciliation, local role review and deliberately incorrect delivery control. No independent third-party, browser, desktop, public-web or settlement qualification is implied.'};
}
export function verifyPlan(plan){
 ensure(plan?.schema==='agi-commissioning-plan/v1'&&/^[a-f0-9-]{36}$/.test(plan.runID)&&/^[a-f0-9]{64}$/.test(plan.releaseSHA256)&&plan.specSHA256===sha256(canonical(validateComputerSpec(plan.specification))),'COMMISSIONING_PLAN');
 ensure(Number.isSafeInteger(plan.createdAt)&&Number.isSafeInteger(plan.expiresAt)&&plan.expiresAt>plan.createdAt&&['browserChallenge','desktopChallenge'].every(k=>/^[a-f0-9]{48}$/.test(plan.privateOracle?.[k]??''))&&plan.privateOracle.browserChallenge!==plan.privateOracle.desktopChallenge,'COMMISSIONING_PLAN_CHALLENGE');
 ensure(canonical(reconcileRows(plan.privateOracle?.rows))===canonical(plan.privateOracle.expected)&&plan.specification.prompt.endsWith(canonical(plan.privateOracle.rows)),'COMMISSIONING_ORACLE');
 return plan;
}
export function expectedFixtureFiles(plan){
 verifyPlan(plan);const value=plan.privateOracle.expected;
 const csv='department,currency,amountCents\n'+Object.entries(value.byDepartmentCents).sort(([a],[b])=>a.localeCompare(b)).map(([key,amount])=>key.replace(':',',')+','+amount).join('\n')+'\n';
 return new Map([['result.json',Buffer.from(canonical(value)+'\n')],['reconciliation.csv',Buffer.from(csv)]]);
}
export function verifyFixtureDelivery(plan,delivery){
 verifyPlan(plan);const {files}=validateBundle(plan.specification,Buffer.from(delivery));
 let result;try{result=JSON.parse(files.get('result.json').toString('utf8'));}catch{throw Error('COMMISSIONING_JSON');}
 ensure(canonical(result)===canonical(plan.privateOracle.expected),'COMMISSIONING_RECONCILIATION');
 const lines=files.get('reconciliation.csv').toString('utf8').replaceAll('\r\n','\n').trimEnd().split('\n');
 const expected=expectedFixtureFiles(plan).get('reconciliation.csv').toString('utf8').trimEnd().split('\n');
 ensure(lines.length===7&&lines.every((line,i)=>line===expected[i]),'COMMISSIONING_CSV');
 return {verified:true,files:[...files].map(([name,bytes])=>({name,bytes:bytes.length,sha256:sha256(bytes)})),deliverySHA256:sha256(delivery)};
}
export function corruptFixtureDelivery(plan,delivery){
 const {files}=validateBundle(plan.specification,Buffer.from(delivery));
 const value=JSON.parse(files.get('result.json'));value.totalsCents.CAD+=1;
 files.set('result.json',Buffer.from(canonical(value)+'\n'));
 return buildBundle(plan.specification,files);
}
