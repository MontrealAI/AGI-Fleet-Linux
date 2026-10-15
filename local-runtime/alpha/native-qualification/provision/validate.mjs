// Pure source/archive validation. Never execute payloads or inspect /opt.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkout,inputs,target]=process.argv.slice(2);
if(process.argv.length!==5||!['linux-x64','linux-arm64'].includes(target))throw Error('PREPARATION_ARGUMENTS');
const moduleAt=relative=>import(pathToFileURL(path.join(checkout,relative)).href);
const {digest,need}=await moduleAt('local-runtime/contracts.mjs');
const {alphaAdapterIdentity}=await moduleAt('local-runtime/alpha/package.mjs');
const {validateTargetSet,validateManifest,validateQualification}=await moduleAt('local-runtime/alpha/trust.mjs');
const {decodePinnedArchive}=await moduleAt('local-runtime/alpha/archive.mjs');
const lock=JSON.parse(fs.readFileSync(path.join(checkout,'local-runtime/alpha/package-lock.json'))),adapterSha256=alphaAdapterIdentity();
need(target==='linux-'+process.arch,'PREPARATION_ARCHITECTURE');
validateTargetSet(lock.targets,target,lock.source.commit,adapterSha256);
for(const name of ['linux-x64','linux-arm64']){
  const record=lock.targets[name],directory=path.join(inputs,name);
  const validated=validateManifest(fs.readFileSync(path.join(directory,'manifest.json')),record);
  validateQualification(fs.readFileSync(path.join(directory,'qualification.json')),record);
  decodePinnedArchive(fs.readFileSync(path.join(directory,'candidate.tar.gz')),record,validated);
}
process.stdout.write(JSON.stringify({archiveTreesValidated:2,adapterSha256,fixtureLockSha256:digest(fs.readFileSync(path.join(checkout,'local-runtime/alpha/package-lock.json'))),payloadExecuted:false,installationAttempted:false,productionQualified:false})+'\n');
