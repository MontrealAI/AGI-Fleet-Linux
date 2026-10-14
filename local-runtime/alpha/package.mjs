import fs from 'node:fs';
import {need,keys,parseStrict,digest} from '../contracts.mjs';

export const ALPHA_SOURCE_COMMIT='2355b3cb198a6fb2c948744d283f108ab6ce5ebc';
export const ALPHA_VALIDATOR='alpha_factory_v1.core.runtime.work_spec';
export const ALPHA_ENTRYPOINT='alpha_factory_v1.core.runtime.fleet_work';
export const ALPHA_MARKET='agijobsv0-jobregistry-v2';
export const ALPHA_PACKAGE_HELP='Alpha execution is not provisioned. A reviewed per-architecture interpreter/source/dependency package and exact-byte native bubblewrap qualification are required. Keep this action blocked; do not install host dependencies or use a shell fallback.';

// This is deliberately not an installer or a configurable command launcher.
// No request, environment variable, external manifest or fixture can supply pins.
// Populating targets alone cannot enable dispatch: the next implementation must
// validate and isolate every runtime byte before replacing this refusal.
export function inspectAlphaPackage() {
  try {
    const raw=fs.readFileSync(new URL('./package-lock.json',import.meta.url),'utf8');
    const lock=parseStrict(raw,32768);
    keys(lock,['schema','state','source','dependencySubsetSha256','targets','qualification','settlementAuthority']);
    keys(lock.source,['repository','commit','requirementsSha256','entrypoint','validator']);
    keys(lock.targets,['linux-x64','linux-arm64']);
    need(lock.schema==='agi-fleet/alpha-package-lock/v1'&&lock.state==='UNPROVISIONED'&&lock.qualification==='NOT_RUN'&&lock.settlementAuthority===false,'ALPHA_TRUST_LOCK_INVALID');
    need(lock.source.repository==='https://github.com/MontrealAI/AGI-Alpha-Agent-v0'&&lock.source.commit===ALPHA_SOURCE_COMMIT&&lock.source.entrypoint===ALPHA_ENTRYPOINT&&lock.source.validator===ALPHA_VALIDATOR&&lock.source.requirementsSha256==='807e9de36cff92e1cecd7a6f1d651760f66ea4f8346dd799a139269f48c75790','ALPHA_TRUST_LOCK_INVALID');
    need(lock.targets['linux-x64']===null&&lock.targets['linux-arm64']===null,'ALPHA_PACKAGE_REVIEW_REQUIRED');
    need(digest(fs.readFileSync(new URL('./requirements-fleet.lock',import.meta.url)))===lock.dependencySubsetSha256,'ALPHA_DEPENDENCY_LOCK_CHANGED');
    return {supported:false,code:'ALPHA_PACKAGE_UNPROVISIONED',sourceCommit:ALPHA_SOURCE_COMMIT,trustLockSha256:digest(raw),packageSha256:null,qualification:'NOT_RUN',help:ALPHA_PACKAGE_HELP};
  } catch(e) {
    return {supported:false,code:e.code==='ENOENT'?'ALPHA_TRUST_LOCK_MISSING':/^ALPHA_/.test(e.code||e.message)?e.code||e.message:'ALPHA_TRUST_LOCK_INVALID',sourceCommit:ALPHA_SOURCE_COMMIT,packageSha256:null,qualification:'NOT_RUN',help:ALPHA_PACKAGE_HELP};
  }
}

export function refuseUnprovisionedAlpha() {
  const state=inspectAlphaPackage();
  throw Object.assign(new Error(state.code),{code:state.code,observation:{backend:'linux-bwrap-alpha/v1',launchAttempted:false,processGroupGone:true,network:'none',providerCalls:0,qualification:'NOT_RUN'}});
}
