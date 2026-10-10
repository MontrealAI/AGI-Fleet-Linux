import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const fail=(predicate,facts={})=>{const e=Error('SETUP_PRIVATE_TEMP_FAILED');e.freshOAuthDiagnostic={schema:'agi-fresh-oauth-diagnostic/v1',substage:'private-temporary-root',objectKind:'temporary-root',predicate,...facts};return e;};
export function temporaryIdentity(root,uid=process.getuid()){
 const s=fs.lstatSync(root);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==uid||(s.mode&0o077)||fs.realpathSync(root)!==root)throw fail('canonical-private-owned-directory',{canonical:fs.realpathSync(root)===root,ownerMatches:s.uid===uid,mode:s.mode&0o777,linkCount:s.nlink,symlink:s.isSymbolicLink()});
 return {root,dev:s.dev,ino:s.ino,uid:s.uid};
}
export function removePrivateTemporary(identity){
 const current=temporaryIdentity(identity.root,identity.uid);
 if(current.dev!==identity.dev||current.ino!==identity.ino)throw fail('allocated-root-identity-unchanged');
 fs.rmSync(identity.root,{recursive:true,force:false});
}
/** Only the OS temporary ancestor may be canonicalized. Protected roots stay strict. */
export function withPrivateTemporary(prefix,work,{uid=process.getuid(),allocated=()=>{},removed=()=>{},hook=()=>{}}={}){
 let raw,identity,result,primary,cleanup;
 try{
  const requested=os.tmpdir(),base=fs.realpathSync(requested);hook('before-allocation');
  raw=fs.mkdtempSync(path.join(base,prefix));
  // mkdtemp creates 0700. Capture identity before any canonicalization can fail.
  const s=fs.lstatSync(raw);identity={root:raw,dev:s.dev,ino:s.ino,uid};
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o077))throw fail('allocation-owned-private',{ownerMatches:s.uid===uid,mode:s.mode&0o777,linkCount:s.nlink});
  hook('after-allocation');const canonical=fs.realpathSync(raw);
  if(canonical!==raw)throw fail('allocated-child-not-redirected');
  fs.chmodSync(canonical,0o700);identity=temporaryIdentity(canonical,uid);
  allocated(identity);hook('after-registration');result=work(canonical,{baseCanonicalized:requested!==base,canonical:true});
 }catch(e){primary=e;}
 finally{
  if(identity){try{hook('before-cleanup');removePrivateTemporary(identity);removed();}catch(e){cleanup=e;}}
 }
 if(cleanup){if(!primary)primary=fail('temporary-cleanup-required');primary.cleanupFailureCode='SETUP_PRIVATE_TEMP_CLEANUP_REQUIRED';primary.cleanupDiagnostic={objectKind:'temporary-root',predicate:'allocated-root-removal',code:'SETUP_PRIVATE_TEMP_CLEANUP_REQUIRED'};}
 if(primary)throw primary;return result;
}
