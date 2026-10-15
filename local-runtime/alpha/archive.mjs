// Strict reader for the reproducible candidate tar.gz format. Never runs tools,
// scripts, installers, archive commands or file-selected executables.
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {need,digest} from '../contracts.mjs';
import {ALPHA_TREE_LIMIT,relativePath,verifyTree} from './trust.mjs';
const utf8=new TextDecoder('utf-8',{fatal:true});
function string(bytes){const zero=bytes.indexOf(0);return utf8.decode(zero<0?bytes:bytes.subarray(0,zero));}
function octal(bytes){const text=string(bytes).trim();need(/^[0-7]+$/.test(text),'ALPHA_ARCHIVE_NUMBER_INVALID');const value=Number.parseInt(text,8);need(Number.isSafeInteger(value)&&value>=0,'ALPHA_ARCHIVE_NUMBER_INVALID');return value;}
function pax(bytes){
  const result={};let position=0;
  while(position<bytes.length){
    const space=bytes.indexOf(32,position);need(space>position,'ALPHA_ARCHIVE_PAX_INVALID');const token=bytes.subarray(position,space).toString('ascii');
    need(/^[1-9][0-9]*$/.test(token),'ALPHA_ARCHIVE_PAX_INVALID');const length=Number(token),end=position+length;
    need(Number.isSafeInteger(length)&&end<=bytes.length&&bytes[end-1]===10,'ALPHA_ARCHIVE_PAX_INVALID');
    const record=utf8.decode(bytes.subarray(space+1,end-1)),equal=record.indexOf('='),key=record.slice(0,equal);
    need(equal>0&&key==='path'&&!Object.hasOwn(result,key),'ALPHA_ARCHIVE_PAX_INVALID');result[key]=record.slice(equal+1);position=end;
  }
  return result;
}
export function decodePinnedArchive(raw,target,validated){
  need(Buffer.isBuffer(raw)&&raw.length===target.archiveBytes&&digest(raw)===target.archiveSha256,'ALPHA_ARCHIVE_CHANGED');
  const tar=gunzipSync(raw,{maxOutputLength:ALPHA_TREE_LIMIT+16_000_000}),records=[],seen=new Set();let offset=0,pending=null,rootSeen=false,ended=false;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(v=>v===0)){need(tar.subarray(offset).every(v=>v===0),'ALPHA_ARCHIVE_TRAILING_DATA');ended=true;break;}
    let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];need(checksum===octal(header.subarray(148,156)),'ALPHA_ARCHIVE_CHECKSUM_INVALID');
    need(string(header.subarray(257,263))==='ustar','ALPHA_ARCHIVE_FORMAT_INVALID');
    const size=octal(header.subarray(124,136)),mode=octal(header.subarray(100,108)),type=String.fromCharCode(header[156]||48);
    need(size<=ALPHA_TREE_LIMIT&&offset+size<=tar.length,'ALPHA_ARCHIVE_SIZE_INVALID');
    const content=tar.subarray(offset,offset+size),next=offset+Math.ceil(size/512)*512;
    need(next<=tar.length&&tar.subarray(offset+size,next).every(v=>v===0),'ALPHA_ARCHIVE_PADDING_INVALID');offset=next;
    if(type==='x'){need(pending===null&&size<=8192,'ALPHA_ARCHIVE_PAX_INVALID');pending=pax(content);continue;}
    need(['0','2','5'].includes(type),'ALPHA_ARCHIVE_NODE_INVALID');
    const prefix=string(header.subarray(345,500));let name=pending?.path??[prefix,string(header.subarray(0,100))].filter(Boolean).join('/');pending=null;
    if(type==='5'&&name.endsWith('/'))name=name.slice(0,-1);
    relativePath(name);need(!seen.has(name),'ALPHA_ARCHIVE_DUPLICATE');seen.add(name);
    if(name==='rootfs'){need(type==='5'&&size===0&&mode===0o555&&!rootSeen,'ALPHA_ARCHIVE_ROOT_INVALID');rootSeen=true;continue;}
    need(rootSeen&&name.startsWith('rootfs/'),'ALPHA_ARCHIVE_ROOT_INVALID');const relative=name.slice(7),expected=validated.entries.get(relative);
    need(expected&&expected.mode===mode&&({0:'file',2:'symlink',5:'directory'})[type]===expected.type,'ALPHA_ARCHIVE_TREE_MISMATCH');
    if(type==='0')need(size===expected.bytes&&digest(content)===expected.sha256,'ALPHA_ARCHIVE_FILE_CHANGED');
    else need(size===0,'ALPHA_ARCHIVE_NODE_INVALID');
    if(type==='2')need(string(header.subarray(157,257))===expected.target,'ALPHA_ARCHIVE_LINK_CHANGED');
    records.push({relative,expected,content});
  }
  need(ended&&pending===null&&rootSeen&&records.length===validated.entries.size,'ALPHA_ARCHIVE_INCOMPLETE');return records;
}
export function extractVerifiedArchive(raw,target,validated,directory,{rootOwner=true}={}){
  const records=decodePinnedArchive(raw,target,validated);need(!fs.existsSync(directory),'ALPHA_INSTALL_DESTINATION_EXISTS');fs.mkdirSync(directory,{mode:0o700});
  // Manifest parent validation forbids traversing links. Links are created only
  // after all regular data, so they cannot redirect an extraction write.
  for(const {relative,expected,content} of records){
    const file=path.join(directory,relative);
    if(expected.type==='directory')fs.mkdirSync(file,{mode:0o700});
    else if(expected.type==='file'){const fd=fs.openSync(file,'wx',expected.mode);try{fs.writeFileSync(fd,content);fs.fchmodSync(fd,expected.mode);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  }
  for(const {relative,expected} of records)if(expected.type==='symlink')fs.symlinkSync(expected.target,path.join(directory,relative));
  for(const {relative,expected} of records.toReversed())if(expected.type==='directory'){const dir=path.join(directory,relative);fs.chmodSync(dir,expected.mode);const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  fs.chmodSync(directory,0o555);const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}verifyTree(directory,validated,{rootOwner});return directory;
}
