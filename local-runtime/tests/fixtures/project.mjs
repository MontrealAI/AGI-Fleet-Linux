import {canonical} from '../../contracts.mjs';
import {ALPHA_NATIVE_SOURCE} from '../../project/native-source.mjs';
import {createProject,publicDataOpportunity} from '../../project/vendor/alpha/examples/successor-project/engine.mjs';
import {createRecord} from '../../project/vendor/alpha/examples/successor-workbench/mission-record.mjs';
import {example} from '../../project/vendor/alpha/examples/successor-workbench/engine.mjs';
import {createBrief} from '../../project/vendor/alpha/examples/alpha-discovery/engine.mjs';

export async function nativeProject({projectId='project-retained',cycleId='cycle-retained',csv='group,amount\nÉnergie,2\nÉnergie,2\nWind,-1\n'}={}){
  const spec=example('public-data');spec.inputs.csv=csv;
  const sourceHash='a'.repeat(64),source=path=>({repository:ALPHA_NATIVE_SOURCE.repository,commit:ALPHA_NATIVE_SOURCE.commit,path,sha256:ALPHA_NATIVE_SOURCE.files.find(f=>f.path===path).sha256});
  return canonical(await createProject({projectId,cycleId,sourceHash,discoveryBytes:canonical(await createBrief(publicDataOpportunity(),sourceHash)),record:await createRecord({missionId:'mission-retained',sourceHash,spec}),choices:{family:'public-data',selection:'explicit-user-selection',duplicatePolicy:'sum-all-rows-no-deduplication',unitPolicy:'unchanged-integer-units',dataRights:spec.rights.dataClass},sources:{discovery:source('examples/alpha-discovery/engine.mjs'),mission:source('examples/successor-workbench/mission-record.mjs')}}));
}
