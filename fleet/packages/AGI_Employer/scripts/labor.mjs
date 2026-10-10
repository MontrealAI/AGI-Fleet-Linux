import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../ops/store.mjs';
import {acquireLock} from '../ops/common.mjs';
import {workload,HUMAN_CATEGORIES} from '../ops/workload.mjs';
const [action,dir,file]=process.argv.slice(2);let store,release;
try{
 if(!action||action==='--help')console.log('Usage: npm run labor -- record EXISTING_SERVICE_DATA ENTRY_JSON\n       npm run labor -- report EXISTING_SERVICE_DATA\n       npm run labor -- void EXISTING_SERVICE_DATA ENTRY_ID\nStop the service first. Entry: {id: UUID,category,minutes,reference}. Record actual active whole minutes, excluding waiting; never model estimates. Categories: '+HUMAN_CATEGORIES.join(', '));
 else{
  if(!['record','report','void'].includes(action)||!dir||!fs.existsSync(path.join(path.resolve(dir),'service.sqlite')))throw Error('Use an existing service data directory.');
  release=acquireLock(path.resolve(dir));store=new Store(path.resolve(dir));
  if(action==='record'){
   const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error('Use a regular entry file <=64 KiB.');
   const e=JSON.parse(fs.readFileSync(file,'utf8'));
   if(!e||Object.keys(e).sort().join(',')!==['id','category','minutes','reference'].sort().join(','))throw Error('Entry requires exactly id, category, minutes, reference.');
   console.log(JSON.stringify(store.recordHuman(e),null,2));
  }else if(action==='void') console.log(JSON.stringify(store.voidHuman(file),null,2));
  else console.log(JSON.stringify(workload(store),null,2));
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{store?.close();release?.();}
