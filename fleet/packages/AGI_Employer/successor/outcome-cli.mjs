import fs from 'node:fs';
import path from 'node:path';
import {OutcomeLedger,summarizeOutcomes,exportAttemptObservations} from './outcomes.mjs';
import {parseStrict,fail,isHash} from './vendor/manager/site/assets/successor/safe.mjs';
const args=process.argv.slice(2);
fail(args[0]==='--store'&&path.isAbsolute(args[1]),'OUTCOME_USAGE');
const selected=args[2]==='--attempt',attempt=selected?args[3]:null,operation=args[selected?4:2];
fail(!selected||isHash(attempt),'OUTCOME_USAGE');
fail(selected?['--summary','--export'].includes(operation)&&args.length===5:['--event','--summary'].includes(operation)&&args.length===(operation==='--event'?4:3),'OUTCOME_USAGE');
const ledger=new OutcomeLedger(args[1]);
if(operation==='--event'){const stat=fs.lstatSync(args[3]);fail(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=20000,'OUTCOME_INPUT');ledger.append(parseStrict(fs.readFileSync(args[3],'utf8'),20000));}
const records=selected?exportAttemptObservations(ledger.read(),attempt):ledger.read();
console.log(JSON.stringify(operation==='--export'?records:summarizeOutcomes(records),null,2));
