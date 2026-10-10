import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {consumerRoot} from './consumer.mjs';
/** Bind the actual shared implementation and its consumer interfaces. Release
 * docs, runtime caches and operator state are outside this execution source. */
export function computeSourceIdentity(root=consumerRoot){
 const digest=crypto.createHash('sha256');let count=0;const allowedOwner=uid=>uid===0||uid===process.getuid?.();
 const visit=(directory)=>{
  const before=fs.lstatSync(directory);
  if(before.isSymbolicLink()||!allowedOwner(before.uid)||!before.isDirectory()||(before.mode&0o022))throw Error('COMPUTE_RUNTIME_SOURCE_CHANGED');
  const members=fs.readdirSync(directory).sort();
  for(const name of members){
   const file=path.join(directory,name),st=fs.lstatSync(file);
   if(st.isSymbolicLink()||!allowedOwner(st.uid)||(st.mode&0o022)||(!st.isFile()&&!st.isDirectory()))throw Error('COMPUTE_RUNTIME_SOURCE_CHANGED');
   if(st.isDirectory())visit(file);
   else{
    if(++count>4096||st.nlink!==1||st.size>16*1024*1024)throw Error('COMPUTE_RUNTIME_SOURCE_CHANGED');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{const opened=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.lstatSync(file);if(!['dev','ino','uid','mode','size','mtimeMs','ctimeMs'].every(k=>st[k]===opened[k]&&st[k]===after[k]&&st[k]===fs.fstatSync(fd)[k]))throw Error('COMPUTE_RUNTIME_SOURCE_CHANGED');digest.update(path.relative(root,file)+'\0');digest.update(bytes);digest.update('\0');}finally{fs.closeSync(fd);}
   }
  }
  const after=fs.lstatSync(directory);if(!['dev','ino','uid','mode','mtimeMs','ctimeMs'].every(k=>before[k]===after[k])||JSON.stringify(members)!==JSON.stringify(fs.readdirSync(directory).sort()))throw Error('COMPUTE_RUNTIME_SOURCE_CHANGED');
 };
 for(const relative of ['compute','shared/runtime','src'])visit(path.join(root,relative));
 return digest.digest('hex');
}
