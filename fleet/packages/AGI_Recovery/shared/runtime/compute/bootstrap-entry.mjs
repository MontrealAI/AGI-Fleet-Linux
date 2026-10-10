import path from 'node:path';import fs from 'node:fs';import {consumerCompute,consumerFile} from './consumer.mjs';
if(process.argv[1]){const entry=path.resolve(process.argv[1]);if(path.dirname(entry)===consumerCompute&&entry.endsWith('.mjs')){const target=consumerFile('shared/runtime/compute/'+path.basename(entry));if(fs.existsSync(target))process.argv[1]=target;}}
