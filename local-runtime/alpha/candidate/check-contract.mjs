// Development harness bridge to Fleet's actual scoped admission/receipt contract.
// It never creates a task, approval, grant, reservation, process or settlement.
import fs from 'node:fs';
import {validateAlphaInput, validateAlphaOutput} from '../contract.mjs';
process.on('uncaughtException',error=>{process.stderr.write(String(error.code??error.message)+'\n');process.exit(1);});
const bytes=fs.readFileSync(0);
if(bytes.length>2_000_000)throw new Error('CANDIDATE_CHECK_SIZE');
const value=JSON.parse(bytes.toString('utf8'));
if(Object.keys(value).sort().join(',')!=='envelope,input')throw new Error('CANDIDATE_CHECK_FIELDS');
const spec=validateAlphaInput(value.input);
if(value.envelope!==null)validateAlphaOutput(value.input,value.envelope);
process.stdout.write(JSON.stringify({kind:spec.kind,specHash:spec.specHash,budget:spec.budget,receiptChecked:value.envelope!==null})+'\n');
