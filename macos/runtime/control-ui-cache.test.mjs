import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {preparePinnedControlUICache, validatePinnedControlUICache} from '../packages/AGI_Agent/compute/setup-runtime-materialization.mjs';
import {runtimeArtifactLock} from '../packages/AGI_Agent/compute/runtime-artifacts.mjs';

const packageRoot=process.env.AGI_TEST_OPENCLAW_PACKAGE_ROOT;
const sdk={skip:!packageRoot?'Pinned OpenClaw unavailable':false,timeout:30000};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rawInventory=fs.readFileSync(new URL('../packages/AGI_Agent/compute/openclaw-2026.9.5.inventory.json',import.meta.url));
assert.equal(sha(rawInventory),runtimeArtifactLock.openclaw.inventorySHA256);
const inventory=JSON.parse(rawInventory);
function pinnedSource(relative){
  const bytes=fs.readFileSync(path.join(packageRoot,relative)),record=inventory.files[relative];
  assert.ok(record);assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);
  return bytes.toString();
}
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'agi-mac-cache-startup-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
function snapshot(root){
  const result=[];
  function walk(dir){for(const name of fs.readdirSync(dir).sort()){
    const file=path.join(dir,name),s=fs.lstatSync(file),relative=path.relative(root,file);
    result.push([relative,s.mode&0o777,s.isSymbolicLink()?fs.readlinkSync(file):s.isFile()?sha(fs.readFileSync(file)):'directory']);
    if(s.isDirectory()&&!s.isSymbolicLink())walk(file);
  }}walk(root);return result;
}
/** Run the exact inventory-bound SDK manifest parser and retention functions.
 * Only the filesystem timing, state-root and lexical path-boundary adapters
 * are injected. No Gateway, network, provider, or production claim is made. */
function retention(root,{mkdir=fsp.mkdir.bind(fsp)}={}){
  const source=pinnedSource('dist/server-start-gE7ggn-j.mjs');
  const begin='//#region src/gateway/control-ui-asset-manifest.ts';
  const end='//#region src/gateway/server-control-ui-root.ts';
  assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
  const code=source.slice(source.indexOf(begin),source.indexOf(end));
  assert.ok(code.includes('async function publishGeneration(params)'));
  const within=(directory,file)=>{const relative=path.relative(directory,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));};
  const factory=new Function('fs$1','path','constants','createHash','randomUUID','resolveStateDir','isRecord','isErrno','isWithinDir',code+'\nreturn createControlUiAssetRetention;');
  return factory({...fsp,mkdir},path,fs.constants,createHash,randomUUID,()=>root,value=>value!==null&&typeof value==='object'&&!Array.isArray(value),error=>Boolean(error&&typeof error==='object'&&'code' in error),within)(path.join(packageRoot,'dist/control-ui'));
}

test('pinned SDK exposes the former empty-cache staging race deterministically; validation remains read-only',sdk,async t=>{
  const root=fixture(t);let release,observed;
  const paused=new Promise(resolve=>{release=resolve;});const staged=new Promise(resolve=>{observed=resolve;});
  const actual=retention(root,{mkdir:async(file,options)=>{
    const value=await fsp.mkdir(file,options);
    if(path.basename(file).startsWith('.staging-')){observed(file);await paused;}
    return value;
  }});
  const preparing=actual.prepare();
  try{
    const staging=await Promise.race([staged,preparing.then(()=>assert.fail('SDK did not expose staging'))]);
    assert.match(path.basename(staging),/^\.staging-\d+-[a-f0-9-]+$/);
    const before=snapshot(root);
    assert.throws(()=>validatePinnedControlUICache(root,packageRoot),/SETUP_RUNTIME_MATERIALIZATION_INVALID/);
    assert.deepEqual(snapshot(root),before,'authority validation must not repair or delete staging');
  }finally{release();await preparing;}
  assert.ok(validatePinnedControlUICache(root,packageRoot).length>0);
});

test('preparing the exact pinned generation before review prevents SDK staging and retains immutable bytes',sdk,async t=>{
  const root=fixture(t);preparePinnedControlUICache(root,packageRoot);
  const before=snapshot(root),created=[];
  const actual=retention(root,{mkdir:async(file,options)=>{
    created.push(path.basename(file));
    assert.equal(path.basename(file).startsWith('.staging-'),false,'prepared generation must take the SDK existing-generation path');
    assert.ok(validatePinnedControlUICache(root,packageRoot).length>0);
    return fsp.mkdir(file,options);
  }});
  await actual.prepare();
  assert.ok(created.length>0);assert.deepEqual(snapshot(root),before);
  assert.ok(validatePinnedControlUICache(root,packageRoot).length>0);
});

test('preparation and later read-only validation still reject extra directories, tampered assets and symlinks',sdk,t=>{
  const root=fixture(t);preparePinnedControlUICache(root,packageRoot);
  const extra=path.join(root,'cache/control-ui-assets/.staging-unapproved');
  fs.mkdirSync(extra,{mode:0o700});const before=snapshot(root);
  for(const check of [preparePinnedControlUICache,validatePinnedControlUICache])assert.throws(()=>check(root,packageRoot),/SETUP_RUNTIME_MATERIALIZATION_INVALID/);
  assert.deepEqual(snapshot(root),before);fs.rmdirSync(extra);
  const asset=validatePinnedControlUICache(root,packageRoot).find(row=>row[1]==='file'&&row[0].endsWith('.js'));
  assert.ok(asset);const file=path.join(root,asset[0]),original=fs.readFileSync(file);
  fs.appendFileSync(file,'\nunapproved executable');
  for(const check of [preparePinnedControlUICache,validatePinnedControlUICache])assert.throws(()=>check(root,packageRoot),/SETUP_RUNTIME_MATERIALIZATION_INVALID/);
  fs.writeFileSync(file,original);fs.unlinkSync(file);fs.symlinkSync(path.join(packageRoot,'dist/control-ui',asset[0].split('/').slice(3).join('/')),file);
  for(const check of [preparePinnedControlUICache,validatePinnedControlUICache])assert.throws(()=>check(root,packageRoot),/SETUP_RUNTIME_MATERIALIZATION_INVALID/);
});
