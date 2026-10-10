import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,sha256} from '../src/util.mjs';
import {localizeImmutableBaseline,safeImmutableLocalization} from '../compute/setup-runtime-immutable-localization.mjs';
const names=['agents/agi-checker/agent/models.json','agents/agi-creator/agent/models.json','agents/agi-reviewer/agent/models.json','config-journal-fingerprint.key'];
const file=(name,bytes,executable=false)=>[name,'file',executable,sha256(bytes)];
const digest=entries=>sha256(canonical([...entries].sort((a,b)=>a[0].localeCompare(b[0]))));
const fixed=[file('openclaw.json','secret-config-canary'),file('compute-settings.json','preserved-limits-and-token-canary'),['workspace','directory']];
function inspect(previous,current,expected=previous){return localizeImmutableBaseline({currentEntries:current,previousEntries:previous,expectedDigest:digest(expected)});}

test('three generated models and fingerprint key are localized only by an exact sealed aggregate match',()=>{
 const previous=[...fixed,...names.slice(0,3).map((name,index)=>file(name,'catalog-before-'+index))];
 const current=[...fixed,...names.map((name,index)=>file(name,'generated-after-'+index))],before=canonical({previous,current});
 const result=inspect(previous,current);assert.equal(result.status,'MATCHED');assert.equal(result.reason,'bounded-reconstruction-matches-seal');assert.equal(result.hypothesesTested,16);assert.equal(result.matchedCandidateCount,1);assert.equal(result.deltas.length,4);
 for(const name of names){const delta=result.deltas.find(item=>item.path===name);assert.equal(delta.expectedSha256,previous.find(item=>item[0]===name)?.[3]??null);assert.equal(delta.observedSha256,current.find(item=>item[0]===name)[3]);assert.equal(delta.baselineTrust,'sealed-aggregate-bound-reconstruction');}
 assert.equal(result.historicalCauseEstablished,false);assert.equal(result.rollbackAuthorized,false);assert.equal(canonical({previous,current}),before);assert.deepEqual(safeImmutableLocalization(result),result);
});
test('pre-upgrade inventory itself is never substituted for the reviewed baseline',()=>{
 const previous=[file('openclaw.json','old-reviewed-config'),file(names[0],'old-catalog')],sealed=[file('openclaw.json','new-reviewed-config'),file(names[0],'old-catalog')],current=[file('openclaw.json','new-reviewed-config'),file(names[0],'new-catalog')];
 const result=inspect(previous,current,sealed);assert.equal(result.status,'MATCHED');assert.equal(result.deltas.length,1);assert.equal(result.deltas[0].path,names[0]);assert.notEqual(result.expectedDigest,digest(previous));
});
test('unexplained immutable change refuses localization and leaves expected hashes unknown',()=>{
 const previous=[...fixed,file(names[0],'old')],current=[...fixed,file(names[0],'new'),file('unknown-private-person-canary','secret')];
 const result=inspect(previous,current);assert.equal(result.status,'NO_MATCH');assert.equal(result.hypothesesTested,2);assert.deepEqual(result.deltas,[]);assert.ok(result.candidatePaths.every(item=>item.expectedSha256===null));assert.equal(JSON.stringify(result).includes('unknown-private-person-canary'),false);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('previous fingerprint key cannot be substituted or ignored merely because it changed',()=>{
 const previous=[...fixed,file(names[3],'old-fingerprint-secret')],current=[...fixed,file(names[3],'new-fingerprint-secret')];
 const result=inspect(previous,current);assert.equal(result.status,'NO_MATCH');assert.equal(result.hypothesesTested,1);assert.equal(result.candidatePaths[3].operation,'none');assert.deepEqual(result.deltas,[]);
});
test('absent model catalog is a bounded hypothesis only with an available previous inventory',()=>{
 const current=[...fixed,file(names[0],'generated')],available=inspect(fixed,current),unavailable=localizeImmutableBaseline({currentEntries:current,expectedDigest:digest(fixed)});
 assert.equal(available.status,'MATCHED');assert.equal(available.deltas[0].reason,'added');assert.equal(available.deltas[0].expectedSha256,null);assert.equal(unavailable.status,'UNAVAILABLE');assert.equal(unavailable.hypothesesTested,0);assert.equal(unavailable.candidatePaths[0].previousArtifactPresence,'unavailable');assert.deepEqual(unavailable.deltas,[]);
});
test('removed models can be reconstructed from retained bytes, including executable identity',()=>{
 const previous=[...fixed,file(names[0],'catalog',true)],current=[...fixed];const result=inspect(previous,current);
 assert.equal(result.status,'MATCHED');assert.equal(result.deltas[0].reason,'removed');assert.equal(result.deltas[0].kind,'executable-identity');assert.equal(result.deltas[0].expectedExecutable,true);assert.equal(result.deltas[0].observedExecutable,null);
});
test('no hypothesis is required when current inventory already matches the sealed aggregate',()=>{
 const result=localizeImmutableBaseline({currentEntries:fixed,expectedDigest:digest(fixed)});assert.equal(result.status,'MATCHED');assert.equal(result.reason,'current-already-matches-seal');assert.equal(result.hypothesesTested,1);assert.deepEqual(result.deltas,[]);assert.deepEqual(safeImmutableLocalization(result),result);
});
test('full internal inventory larger than 64 KiB supports a bounded match without exporting raw entries',()=>{
 const large=[...fixed,...Array.from({length:7800},(_,index)=>file('private-path-canary-'+index,'private-content-canary'))],current=[...large,file(names[0],'new')];assert.ok(Buffer.byteLength(JSON.stringify(large))>64*1024);
 const result=inspect(large,current);assert.equal(result.status,'MATCHED');assert.equal(result.deltas.length,1);assert.ok(JSON.stringify(result).length<5000);assert.equal(JSON.stringify(result).includes('private-path-canary'),false);
});
test('invalid or duplicate current tuples and invalid expected digest never produce trusted differences',()=>{
 for(const currentEntries of [null,[...fixed,fixed[0]],[file('../escape','secret')],[file('/private/path','secret')],[file('a//b','secret')],[['bad','file',false,'bad-hash']],Array.from({length:20001},(_,index)=>file('x'+index,'x'))]){
  const result=localizeImmutableBaseline({currentEntries,expectedDigest:digest(fixed),previousEntries:fixed});assert.equal(result.status,'INVALID');assert.equal(result.hypothesesTested,0);assert.deepEqual(result.deltas,[]);assert.deepEqual(safeImmutableLocalization(result),result);
 }
 const result=localizeImmutableBaseline({currentEntries:fixed,expectedDigest:'private-error-canary'});assert.equal(result.status,'INVALID');assert.equal(result.expectedDigest,null);assert.equal(JSON.stringify(result).includes('private-error-canary'),false);
});
test('invalid previous tuples are not treated as evidence of absence and unsupported types are not transformed',()=>{
 const current=[...fixed,file(names[0],'generated')],result=localizeImmutableBaseline({currentEntries:current,expectedDigest:digest(fixed),previousEntries:[file('/private/invalid','x')]});assert.equal(result.status,'UNAVAILABLE');assert.equal(result.candidatePaths[0].previousArtifactPresence,'unavailable');
 const directory=[...fixed,[names[0],'directory']],blocked=inspect(fixed,directory);assert.equal(blocked.status,'NO_MATCH');assert.equal(blocked.hypothesesTested,1);assert.deepEqual(blocked.deltas,[]);
});
test('public sanitizer rejects arbitrary paths, false authority, oversized and unbound expected hashes',()=>{
 const matched=inspect(fixed,[...fixed,file(names[0],'generated')]);
 for(const change of [v=>v.deltas[0].path='/secret/private-path',v=>v.candidatePaths[0].path='secret-private-path',v=>v.rollbackAuthorized=true,v=>v.historicalCauseEstablished=true,v=>v.deltas.push(...Array(5).fill(v.deltas[0])),v=>v.hypothesesTested=17,v=>v.expectedDigest='secret-canary',v=>v.reason='secret-canary',v=>v.matchedCandidateCount=0,v=>v.expectedDigest=null,v=>v.reason='previous-inventory-unavailable',v=>v.deltas[0].reason='removed',v=>v.deltas[0].expectedExecutable=false,v=>v.deltas[0].observedSha256='f'.repeat(64)]){const value=structuredClone(matched);change(value);assert.equal(safeImmutableLocalization(value),null);}
 const unbound=inspect(fixed,[...fixed,file('unexplained','x')]);unbound.candidatePaths[0].expectedSha256='a'.repeat(64);assert.equal(safeImmutableLocalization(unbound),null);
 const malicious={...matched,raw:'credential-canary',privateTuples:[file('secret','secret')]};malicious.deltas[0].raw='private-content-canary';const sanitized=safeImmutableLocalization(malicious);assert.ok(sanitized);assert.equal(JSON.stringify(sanitized).includes('canary'),false);
});
