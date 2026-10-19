// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sha256} from './bridge.mjs';
const [proof,output]=process.argv.slice(2);assert(path.isAbsolute(proof)&&path.isAbsolute(output));
const read=name=>JSON.parse(fs.readFileSync(path.join(proof,name)));
const binding=read('execution-context.json'),aggregate=read('compatibility-evidence.json'),service=read('service-observation.json');
assert.deepEqual(aggregate.producer,binding);assert.equal(aggregate.importedFilesAloneProveExecution,false);assert.equal(aggregate.nativeAndMockChainJourneyPassed,true);
const artifacts=[];function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){assert(!entry.isSymbolicLink());const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else{assert(entry.isFile());const name=path.relative(proof,file).split(path.sep).join('/');assert(!/operator-journal|identity\.key|api\.token|operator\.token|ledger\.sqlite/.test(name));const raw=fs.readFileSync(file);artifacts.push({name,bytes:raw.length,sha256:sha256(raw)});}}}walk(proof);artifacts.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
const nativeHash=sha256(fs.readFileSync(path.join(proof,'accepted/computer-return.json')));assert.equal(nativeHash,service.nativeAlphaReturnSha256);assert.equal(nativeHash,service.returnExportSha256);
const receipt={schema:'agi-fleet/saved-package-computer-journey/v1',binding,package:read('package-observation.json'),sourceCommits:aggregate.sourceCommits,service:{actualIPC:service.actualIPC,prepare:service.prepare,exactGrant:service.exactGrant,oneUse:service.oneUse,actualDocker:service.actualDocker,actualBrowser:service.actualBrowser,nativeAlphaReturnSha256:nativeHash,returnExportSha256:nativeHash},compatibilityEvidenceSha256:sha256(fs.readFileSync(path.join(proof,'compatibility-evidence.json'))),artifacts,outcomes:{recovery:service.recovery,cases:service.cases,operatorEffort:service.operatorEffort,history:aggregate.history,costs:aggregate.costs},providerRequests:0,providerBilledCost:0,humanMinutes:null,deviceCost:null,independentlyControlledEconomicReview:false,productionQualified:false,realWallets:false,authority:'none'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({schema:receipt.schema,binding,artifacts:artifacts.length,realWallets:false,productionQualified:false}));
