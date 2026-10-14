import fs from 'node:fs';
import {need} from './primitives.mjs';
export function readPrivate(file,max=4_000_000){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const s=fs.fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077)&&s.size<=max,'PRIVATE_FILE_REQUIRED');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
