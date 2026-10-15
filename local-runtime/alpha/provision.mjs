// Offline operator tooling only. This module is never reachable through task
// actions or scoped assistant tools. Current null trust targets stop all writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,digest} from '../contracts.mjs';
import {readReviewedAlphaTarget,requireAlphaRuntime} from './package.mjs';
import {ALPHA_INSTALL_BASE,validateManifest,validateQualification,assertTrustedParents} from './trust.mjs';
import {extractVerifiedArchive} from './archive.mjs';

function syncDirectory(directory){const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writePinned(file,bytes){const fd=fs.openSync(file,'wx',0o444);try{fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,0o444);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function boundedRead(file,size){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.size<=size,'ALPHA_PROVISION_INPUT_INVALID');
    const chunks=[];let total=0;
    while(true){const chunk=Buffer.alloc(Math.min(65536,size-total+1)),count=fs.readSync(fd,chunk,0,chunk.length,null);if(count===0)break;total+=count;need(total<=size,'ALPHA_PROVISION_INPUT_INVALID');chunks.push(chunk.subarray(0,count));}
    return Buffer.concat(chunks);
  }finally{fs.closeSync(fd);}
}
export function provisionAlpha({archive,manifest,qualification,confirm}){
  const trusted=readReviewedAlphaTarget(); // Refuse null/replaced pins before any input or destination access.
  need(confirm===true,'ALPHA_PROVISION_CONFIRM_REQUIRED');need(process.getuid?.()===0,'ALPHA_PROVISION_ROOT_REQUIRED');
  // No mkdir/chown/sudo of the system installation parent or permission changes
  // on existing files. A separately authorized operator prepares this directory.
  assertTrustedParents(ALPHA_INSTALL_BASE);
  const parent=path.join(ALPHA_INSTALL_BASE,trusted.target.target);assertTrustedParents(parent);
  need(!fs.existsSync(trusted.directory),'ALPHA_INSTALL_DESTINATION_EXISTS');
  const manifestBytes=boundedRead(manifest,trusted.target.manifestBytes),validated=validateManifest(manifestBytes,trusted.target);
  const qualificationBytes=boundedRead(qualification,1_000_000);validateQualification(qualificationBytes,trusted.target);
  const archiveBytes=boundedRead(archive,trusted.target.archiveBytes);
  need(archiveBytes.length===trusted.target.archiveBytes&&digest(archiveBytes)===trusted.target.archiveSha256,'ALPHA_ARCHIVE_CHANGED');
  const staging=fs.mkdtempSync(path.join(parent,'.staging-'));fs.chmodSync(staging,0o700);
  try{
    extractVerifiedArchive(archiveBytes,trusted.target,validated,path.join(staging,'rootfs'));
    writePinned(path.join(staging,'manifest.json'),manifestBytes);
    writePinned(path.join(staging,'qualification.json'),qualificationBytes);
    fs.chmodSync(staging,0o555);syncDirectory(staging);need(!fs.existsSync(trusted.directory),'ALPHA_INSTALL_DESTINATION_EXISTS');
    fs.renameSync(staging,trusted.directory);syncDirectory(parent);
    const runtime=requireAlphaRuntime();return {state:'PROVISIONED_INACTIVE',runtimeIdentity:runtime.runtimeIdentity,artifactSha256:runtime.packageSha256,actorActivationRequired:true,grantsRestored:false,settlementAuthority:false};
  }catch(error){
    // Keep the unselected staging directory for inspection; never overwrite an
    // installation or retry with fallback pins. Existing grants remain untouched.
    error.stagingRetained=staging;throw error;
  }
}
function main(){
  const args=process.argv.slice(2),allowed=new Set(['--archive','--manifest','--qualification','--confirm']);
  need(args.length===7&&args.every((v,i)=>i%2===0?allowed.has(v):typeof v==='string')&&args[6]==='--confirm','ALPHA_PROVISION_USAGE');
  const values={};for(let i=0;i<6;i+=2){need(args[i]!=='--confirm'&&!Object.hasOwn(values,args[i]),'ALPHA_PROVISION_USAGE');values[args[i]]=args[i+1];}
  need(['--archive','--manifest','--qualification'].every(k=>values[k]),'ALPHA_PROVISION_USAGE');
  process.stdout.write(JSON.stringify(provisionAlpha({archive:values['--archive'],manifest:values['--manifest'],qualification:values['--qualification'],confirm:true}))+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(error){process.stderr.write((error.code||error.message)+'\n');process.exitCode=1;}
