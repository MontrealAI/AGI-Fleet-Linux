import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {probeRuntimeNative} from '../compute/runtime-native-probe.mjs';

function fixture(t,{version='0.13.1',unavailable=false}={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agi-native-probe-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const packageRoot=path.join(home,'node_modules/openclaw'),dependency=path.join(home,'node_modules/@openclaw/fs-safe');fs.mkdirSync(packageRoot,{recursive:true,mode:0o700});fs.mkdirSync(dependency,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({name:'openclaw',version:'2026.9.5'}));
 fs.writeFileSync(path.join(dependency,'package.json'),JSON.stringify({name:'@openclaw/fs-safe',version,type:'module',exports:{'./package.json':'./package.json','./config':'./config.js','./copy':'./copy.js'}}));
 const symbol=JSON.stringify(home);fs.writeFileSync(path.join(dependency,'config.js'),`export function configureFsSafeNative(value){if(value.mode!=='require')throw Error('native mode not required');globalThis[${symbol}]=true;}`);
 fs.writeFileSync(path.join(dependency,'copy.js'),`export async function readCloneFileMetadata(paths){if(!globalThis[${symbol}]||!Array.isArray(paths)||paths.length)throw Error('unsafe probe');${unavailable?"throw Error('native binding unavailable');":"return [];"}}`);
 t.after(()=>delete globalThis[home]);return packageRoot;
}
test('native probe requires the pinned public API and passes an empty path list',async t=>{
 assert.deepEqual(await probeRuntimeNative(fixture(t)),{status:'ready'});
});
test('native probe rejects a mismatched dependency version before loading its API',async t=>{
 await assert.rejects(probeRuntimeNative(fixture(t,{version:'0.18.1'})),/RUNTIME_INSTALL_NATIVE_REQUIRED/);
});
test('native probe refuses unavailable bindings and relative package locations',async t=>{
 await assert.rejects(probeRuntimeNative(fixture(t,{unavailable:true})),/native binding unavailable/);
 await assert.rejects(probeRuntimeNative('relative/package'),/RUNTIME_INSTALL_NATIVE_REQUIRED/);
});
