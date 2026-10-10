import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runtimeArtifactLock} from './runtime-artifacts.mjs';

// OpenClaw 2026.9.5 has no standalone native-probe script. Use the pinned
// dependency's public exports; require native execution and supply no paths.
export async function probeRuntimeNative(packageRoot){
  if(!path.isAbsolute(packageRoot))throw Error('RUNTIME_INSTALL_NATIVE_REQUIRED');
  const requireFromPackage=createRequire(path.join(packageRoot,'package.json'));
  const manifest=JSON.parse(fs.readFileSync(requireFromPackage.resolve('@openclaw/fs-safe/package.json'),'utf8'));
  if(manifest.name!==runtimeArtifactLock.openclaw.nativePackage.name||manifest.version!==runtimeArtifactLock.openclaw.nativePackage.version)throw Error('RUNTIME_INSTALL_NATIVE_REQUIRED');
  const config=await import(pathToFileURL(requireFromPackage.resolve('@openclaw/fs-safe/config')).href);
  config.configureFsSafeNative({mode:'require'});
  const copy=await import(pathToFileURL(requireFromPackage.resolve('@openclaw/fs-safe/copy')).href);
  await copy.readCloneFileMetadata([]);
  return {status:'ready'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]!=='--probe'||!process.argv[3])throw Error('RUNTIME_INSTALL_NATIVE_REQUIRED');
    console.log(JSON.stringify(await probeRuntimeNative(process.argv[3])));
  }catch{console.log(JSON.stringify({status:'unavailable'}));process.exitCode=1;}
}
