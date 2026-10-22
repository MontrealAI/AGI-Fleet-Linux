import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {evidenceDestination,verifiedAlphaRoot,qualify} from './qualify.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'discovery-evidence-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const fleet=path.join(root,'fleet'),alpha=path.join(root,'alpha');fs.mkdirSync(fleet);fs.mkdirSync(alpha);
  return {root,fleet,alpha};
}
test('evidence refuses a path inside either checkout including trailing-separator roots',t=>{
  const {fleet,alpha}=fixture(t);
  for(const root of [fleet,alpha])assert.throws(()=>evidenceDestination(path.join(root,'new-evidence'),[fleet+path.sep,alpha]),/outside both checkouts/);
});
test('evidence resolves an existing parent alias before checking containment',t=>{
  const {root,fleet,alpha}=fixture(t),alias=path.join(root,'alias');fs.symlinkSync(fleet,alias,'dir');
  assert.throws(()=>evidenceDestination(path.join(alias,'new-evidence'),[fleet,alpha]),/outside both checkouts/);
});
test('retained evidence is never overwritten',t=>{
  const {root,fleet,alpha}=fixture(t),existing=path.join(root,'retained');fs.mkdirSync(existing);
  assert.throws(()=>evidenceDestination(existing,[fleet,alpha]),/not overwrite/);
});
test('an absent directory outside both repositories remains available for concrete output',t=>{
  const {root,fleet,alpha}=fixture(t),output=path.join(root,'new-evidence');
  assert.equal(evidenceDestination(output,[fleet,alpha]),output);assert.equal(fs.existsSync(output),false);
});
test('Alpha source must be the physical Git worktree root before output validation',async t=>{
  const {root,alpha}=fixture(t);
  execFileSync('git',['init','--quiet',alpha]);
  const nested=path.join(alpha,'copied-source');fs.mkdirSync(nested);
  const alias=path.join(root,'alpha-alias');fs.symlinkSync(alpha,alias,'dir');
  assert.equal(verifiedAlphaRoot(alpha),fs.realpathSync(alpha));
  assert.equal(verifiedAlphaRoot(alias),fs.realpathSync(alpha));
  assert.throws(()=>verifiedAlphaRoot(nested),/Git worktree root/);
  const output=path.join(alpha,'must-not-write');
  await assert.rejects(qualify(nested,{output}),/Git worktree root/);
  assert.equal(fs.existsSync(output),false);
});
