import fs from 'node:fs';
import path from 'node:path';
import {OutcomeLedger,summarizeOutcomes} from './outcomes.mjs';
import {parseStrict,fail} from './vendor/manager/site/assets/successor/safe.mjs';
const args=process.argv.slice(2);fail(args[0]==='--store'&&path.isAbsolute(args[1])&&['--event','--summary'].includes(args[2])&&args.length===(args[2]==='--event'?4:3),'OUTCOME_USAGE');
const ledger=new OutcomeLedger(args[1]);
if(args[2]==='--event'){const stat=fs.lstatSync(args[3]);fail(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=20000,'OUTCOME_INPUT');ledger.append(parseStrict(fs.readFileSync(args[3],'utf8'),20000));}
console.log(JSON.stringify(summarizeOutcomes(ledger.read()),null,2));
