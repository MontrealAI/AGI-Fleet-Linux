import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {captureOperational,validateOperational,stageOperational,checkBackupSize} from '../src/control/operational-state.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'agi-manifest-test-'));
function entry(name,content='fixture'){const b=Buffer.from(content);return {path:name,size:b.length,data:b.toString('base64'),sha256:crypto.createHash('sha256').update(b).digest('hex')};}
function manifest(files){return {schema:'agi-operational-state/v1',kind:'agent',bytes:files.reduce((n,f)=>n+f.size,0),files};}
test('manifest rejects traversal, absolute paths, foreign roots and platform path aliases',()=>{
 for(const name of ['../vault.json','/tmp/escape','data/admission/../../vault.json','data/admission/a\\b','data/admission/a:b','data/admission/./a','data/admission//a','vault.json','data/activation.json','work-studio/\u0000.json'])
  assert.throws(()=>validateOperational(manifest([entry(name)]),'agent'),/BACKUP_STATE_PATH/);
});
test('manifest rejects duplicate names, Mac case collisions, file/parent collisions and altered bytes',()=>{
 for(const files of [[entry('work-studio/a'),entry('work-studio/a')],[entry('work-studio/a'),entry('work-studio/A')],[entry('work-studio/a'),entry('work-studio/a/b')]])
  assert.throws(()=>validateOperational(manifest(files),'agent'),/BACKUP_STATE_(DUPLICATE|PATH)/);
 const b=manifest([entry('pilot.json')]);b.files[0].data='Zm9v';assert.throws(()=>validateOperational(b,'agent'),/BACKUP_STATE/);
 b.files[0]=entry('pilot.json');b.bytes++;assert.throws(()=>validateOperational(b,'agent'),/BACKUP_STATE_INTEGRITY/);
 assert.throws(()=>validateOperational(manifest([]),'fleet'),/BACKUP_STATE_FORMAT/);
});
test('capture refuses symlinks and hardlinks instead of exporting secrets outside its scope',()=>{
 const home=temp();fs.mkdirSync(path.join(home,'data'));fs.mkdirSync(path.join(home,'work-studio'));
 try{
  fs.writeFileSync(path.join(home,'outside'),'private fixture');const link=path.join(home,'work-studio','link');
  fs.symlinkSync(path.join(home,'outside'),link);assert.throws(()=>captureOperational({home,kind:'agent'}),/BACKUP_STATE_UNSAFE_FILE/);fs.unlinkSync(link);
  fs.linkSync(path.join(home,'outside'),link);assert.throws(()=>captureOperational({home,kind:'agent'}),/BACKUP_STATE_UNSAFE_FILE/);fs.unlinkSync(link);
  fs.symlinkSync(path.join(home,'work-studio'),path.join(home,'data','admission'));assert.throws(()=>captureOperational({home,kind:'agent'}),/BACKUP_STATE_UNSAFE_FILE/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('manifest validation completes before writing any files, and staged permissions are private',()=>{
 const target=temp();
 try{
  const b=manifest([entry('pilot.json'),entry('../escape')]);assert.throws(()=>stageOperational(target,b,'agent'),/BACKUP_STATE_PATH/);assert.deepEqual(fs.readdirSync(target),[]);
  const good=manifest([entry('data/admission/inbox/42.json'),entry('commissioning.json')]);stageOperational(target,good,'agent');
  assert.equal(fs.statSync(path.join(target,'data/admission/inbox/42.json')).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(target,'data/admission/inbox')).mode&0o777,0o700);
  assert.equal(fs.readFileSync(path.join(target,'recovered-commissioning.json'),'utf8'),'fixture');
 }finally{fs.rmSync(target,{recursive:true,force:true});}
});
test('oversized state and requests fail explicitly without a partial backup',()=>{
 const home=temp();fs.mkdirSync(path.join(home,'data'));fs.mkdirSync(path.join(home,'work-studio'));
 try{
  const fd=fs.openSync(path.join(home,'work-studio','large'),'w');fs.ftruncateSync(fd,14*1024*1024+1);fs.closeSync(fd);
  assert.throws(()=>captureOperational({home,kind:'agent'}),/BACKUP_TOO_LARGE/);
  assert.throws(()=>checkBackupSize({oversized:'x'.repeat(46*1024*1024)}),/BACKUP_TOO_LARGE/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
