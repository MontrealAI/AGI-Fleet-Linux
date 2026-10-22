// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [beforePath,afterPath,requestsPath,browserRoot,output]=process.argv.slice(2);
const before=await import(pathToFileURL(beforePath).href),after=await import(pathToFileURL(afterPath).href);
const sha=filename=>createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
let count=0,seed=3;
const random=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
function value(depth=0) {
    const k=random(depth>4?5:7);
    if(k===0)return null;
    if(k===1)return Boolean(random(2));
    if(k===2)return random(10000)-5000;
    if(k===3)return ['a','é','😀','\0','quote"\\'][random(5)].repeat(random(30));
    if(k===4)return {};
    if(k===5)return Array.from({length:random(6)},()=>value(depth+1));
    return Object.fromEntries(Array.from({length:random(6)},(_,i)=>['key'+i,value(depth+1)]));
}
const same=input=>{assert.equal(after.canonical(input),before.canonical(input));count++;};
for(let i=0;i<1000;i++)same(value());
const cases=JSON.parse(fs.readFileSync(requestsPath)).cases;
for(const row of cases)same(row.request);
for(const name of ['browser-workspace.json','manager-review-draft.json','jobs-review-draft.json']) {
    same(JSON.parse(fs.readFileSync(browserRoot+'/'+name)));
}
const report={beforeSha256:sha(beforePath),afterSha256:sha(afterPath),canonicalByteEquivalenceCases:count,
    finiteSemanticRequests:cases.length,exactBrowserDownloads:3,generatedBoundedCompoundData:1000,
    scriptSha256:sha(new URL(import.meta.url))};
assert.equal(fs.existsSync(output),false,'Preserve prior reports');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
