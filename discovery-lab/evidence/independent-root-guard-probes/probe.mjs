import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifiedAlphaRoot,evidenceDestination,qualify,verifyAlphaSource} from '../fleet-lab/discovery-lab/qualify.mjs';
import {canonical,parseBounded} from '../fleet-lab/discovery-lab/contract.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceNames=['qualify.mjs','qualify.test.mjs','contract.mjs','contract.test.mjs'];
const hashes=()=>Object.fromEntries(sourceNames.map(name=>[name,sha(fs.readFileSync(new URL('../fleet-lab/discovery-lab/'+name,import.meta.url)))]));
const sourceBefore=hashes();
assert.equal(process.version,'v24.21.0');
assert.equal(sha(fs.readFileSync(process.execPath)),'7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-root-review-'));
const checks=[];
try {
  const alpha=path.join(temp,'alpha'),fleet=path.join(temp,'fleet'),nested=path.join(alpha,'copies');
  fs.mkdirSync(alpha);fs.mkdirSync(fleet);fs.mkdirSync(nested);
  execFileSync('git',['init','--quiet',alpha]);
  execFileSync('git',['-C',alpha,'-c','user.name=review-fixture','-c','user.email=review@example.invalid','commit','--quiet','--allow-empty','-m','fixture']);
  const alias=path.join(temp,'alpha-alias'),nestedAlias=path.join(temp,'nested-alias');
  fs.symlinkSync(alpha,alias,'dir');fs.symlinkSync(nested,nestedAlias,'dir');
  for(const root of [alpha,alpha+path.sep,alias,alias+path.sep]) {
    assert.equal(verifiedAlphaRoot(root),fs.realpathSync(alpha));checks.push('valid-root:'+root);
  }
  for(const root of [nested,nestedAlias]) {
    assert.throws(()=>verifiedAlphaRoot(root),/Git worktree root/);
    assert.throws(()=>verifyAlphaSource(root),/Git worktree root/);
    const output=path.join(alpha,'must-remain-absent');
    await assert.rejects(qualify(root,{output}),/Git worktree root/);
    assert.equal(fs.existsSync(output),false);checks.push('nested-refused-before-write:'+root);
  }
  for(const root of [alpha,fleet])for(const candidate of [root,path.join(root,'receipt')]) {
    assert.throws(()=>evidenceDestination(candidate,[alpha,fleet]),/outside both checkouts/);checks.push('inside-refused:'+candidate);
  }
  assert.throws(()=>evidenceDestination(path.join(alias,'receipt'),[alpha,fleet]),/outside both checkouts/);
  checks.push('aliased-parent-refused');
  for(const name of ['alpha-sibling','evidence']) {
    const candidate=path.join(temp,name);assert.equal(evidenceDestination(candidate,[alpha,fleet]),candidate);
    assert.equal(fs.existsSync(candidate),false);checks.push('outside-preserved:'+candidate);
  }
  let encoderCalls=0;const original=globalThis.TextEncoder;
  globalThis.TextEncoder=class {constructor(){encoderCalls++;throw Error('encoder should not allocate');}};
  try {
    assert.throws(()=>parseBounded('x'.repeat(2_000_001)),/Import exceeds 2 MB/);
    assert.throws(()=>canonical('x'.repeat(2_000_001)),/Canonical JSON exceeds 2 MB/);
    assert.throws(()=>canonical(['x'.repeat(999_999),'x'.repeat(999_999)]),/Canonical JSON exceeds 2 MB/);
    assert.equal(encoderCalls,0);checks.push('oversize-parser-scalar-aggregate-no-encoder');
  } finally {globalThis.TextEncoder=original;}
  for(const value of ['a'.repeat(1_999_998),'é'.repeat(999_999),'😀'.repeat(499_999)+'é']) {
    const encoded=canonical(value);assert.equal(Buffer.byteLength(encoded),2_000_000);assert.equal(parseBounded(encoded),value);
    assert.throws(()=>canonical(value+'x'),/Canonical JSON exceeds 2 MB/);checks.push('exact-utf8-byte-boundary:'+value.charCodeAt(0));
  }
  assert.deepEqual(hashes(),sourceBefore);
  console.log(JSON.stringify({schema:'independent-technical-advisory-probe/v1',runtime:process.version,binarySha256:sha(fs.readFileSync(process.execPath)),sourceSha256:sourceBefore,checksPassed:checks.length,checks,findings:[],scope:'Narrow local source review. No eligible-owner, organizational independence, release, installed Fleet or external-execution claim.'},null,2));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
