import {assertLinuxServiceIntegrity,linuxEnvironment} from './linux-host.mjs';
import {computeSourceIdentity} from './source-identity.mjs';
import {roleSkills} from './roles.mjs';
import {assertStandardDerivedAuthority,assertStandardOAuthAuthority} from './setup-standard-authority.mjs';
import {validateManagedGatewayAuthority} from './setup-managed-service.mjs';
import {assertInstalledRemoteCatalogCache} from './setup-model-catalog-policy.mjs';
import fs from 'node:fs';
import {publicBrowserPluginDigest,publicBrowserAdapterDigest} from './public-browser-config.mjs';
import {runtimeEnvironment} from './runtime-env.mjs';
import path from 'node:path';
import {ensure,canonical,sha256} from '../src/util.mjs';
import {SKILLS,WORKSTATION_SKILLS} from './profile.mjs';
const FIELDS=['standardOAuthAuthority','assuranceMode','schema','policySealVersion','capabilityPolicy','role','workstation','jobRoot','inputRoot','browserImageID','port','token','signerUID','isolationAcknowledged','profileDir','workspace','gatewayConfig','gatewayPort','gatewayToken','home','node','openclaw','docker','maxRuns24h','maxImages24h','imageID','executionImageVerification','serviceHeapMiB','runtimeDependencies','versions','executableIdentity','gatewayHeapMiB','gatewayWrapper','gatewayWrapperSha256','publicWebPolicy'];
export function executionSettings(c){return {...(c.deploymentPlatform!==undefined?{deploymentPlatform:c.deploymentPlatform,linuxServiceAuthority:c.linuxServiceAuthority??null}:{}),...Object.fromEntries(FIELDS.map(k=>[k,c[k]??null])),...(c.computeSourceIdentity!==undefined?{computeSourceIdentity:c.computeSourceIdentity}:{}),...(c.runtimeModelCatalogPolicyVersion!==undefined?{runtimeModelCatalogPolicyVersion:c.runtimeModelCatalogPolicyVersion}:{}),...(c.managedGatewayServiceAuthority!==undefined?{managedGatewayServiceAuthority:c.managedGatewayServiceAuthority}:{})};}
function readPolicyFile(file,max=8*1024*1024){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(fd);ensure(st.isFile()&&st.size<=max,'COMPUTE_POLICY_FILE');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
export function legacyPolicyHash(c){return sha256(canonical({config:sha256(readPolicyFile(c.gatewayConfig)),bootstrap:sha256(readPolicyFile(path.join(c.workspace,'AGENTS.md'))),skills:roleSkills(c.role??'agent',c.workstation).map(name=>[name,sha256(readPolicyFile(path.join(c.workspace,'skills',name,'SKILL.md')))])}));}
export function policyHash(c,{adapterDirectory}={}){
 return sha256(canonical({schema:'agi-compute-policy/v2',settings:executionSettings(c),gateway:sha256(readPolicyFile(c.gatewayConfig)),bootstrap:sha256(readPolicyFile(path.join(c.workspace,'AGENTS.md'))),skills:roleSkills(c.role??'agent',c.workstation).map(name=>[name,sha256(readPolicyFile(path.join(c.workspace,'skills',name,'SKILL.md')))]),publicBrowser:c.publicWebPolicy?{plugin:publicBrowserPluginDigest(c.publicWebPolicy.pluginDirectory),adapter:publicBrowserAdapterDigest(adapterDirectory)}:null,wrapper:c.gatewayWrapper?sha256(readPolicyFile(c.gatewayWrapper,1024*1024)):null}));
}
export function assertComputePolicy(c,{settingsFile=path.join(c.profileDir,'compute-settings.json'),allowMissingSettings=false,adapterDirectory}={}){
 if(c.deploymentPlatform==='linux'){linuxEnvironment(c.home);assertLinuxServiceIntegrity(c,{loaded:true});}
 ensure(!fs.existsSync(path.join(c.profileDir,'SETUP_PENDING')),'COMPUTE_SETUP_PENDING');
 if(c.computeSourceIdentity!==undefined)ensure(c.computeSourceIdentity===computeSourceIdentity(),'COMPUTE_RUNTIME_SOURCE_CHANGED');
 ensure(c.policySealVersion===2,'COMPUTE_POLICY_MIGRATION_REQUIRED');
 ensure(policyHash(c,{adapterDirectory})===c.policyHash,'COMPUTE_POLICY_CHANGED');if(c.assuranceMode==='standard'){assertStandardOAuthAuthority(c);assertStandardDerivedAuthority(c.profileDir);}if(c.managedGatewayServiceAuthority!==undefined)validateManagedGatewayAuthority(c);if(c.runtimeModelCatalogPolicyVersion!==undefined){ensure(c.runtimeModelCatalogPolicyVersion===1,'COMPUTE_POLICY_CHANGED');assertInstalledRemoteCatalogCache(c);}
 if(fs.existsSync(settingsFile)){
  const saved=JSON.parse(readPolicyFile(settingsFile,1024*1024));
  ensure(saved.policyHash===c.policyHash&&canonical(executionSettings(saved))===canonical(executionSettings(c)),'COMPUTE_SETTINGS_CHANGED');
 }else ensure(allowMissingSettings,'COMPUTE_SETTINGS_MISSING');
 ensure(c.executableIdentity?.schema===1,'COMPUTE_RUNTIME_EXECUTABLE_CHANGED');
 runtimeEnvironment(c);
 return true;
}
