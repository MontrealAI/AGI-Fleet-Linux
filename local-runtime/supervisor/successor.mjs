import {createSystem,runCandidate,chooseCandidate,exportCapsule,inspectCapsule,restoreCapsule,validateState,continueHistory,historyCapacity,exportableState} from '../../fleet/successor/vendor/manager/site/assets/successor/model.mjs';
import {need,keys,uuid,id,canonical,parseStrict,digest} from '../contracts.mjs';
import {STORAGE_LIMITS} from './capacity.mjs';

export async function successorOperation(runtime,action,input,principal) {
  runtime.scope(principal,action);
  const db=runtime.store.db;
  // Existing rows contain a bare state. Preserve that representation for old
  // source-less projects; source-bearing imports retain the complete metadata.
  const load=key=>{
    const r=db.prepare('SELECT value FROM projects WHERE id=?').get(uuid(key));need(r,'PROJECT_UNKNOWN');
    const value=parseStrict(r.value);
    if(value.schema==='agi-fleet/local-project/v1'){
      keys(value,['schema','state','sourceManifest']);
      return {raw:r.value,state:value.state,sourceManifest:value.sourceManifest};
    }
    return {raw:r.value,state:value,sourceManifest:null};
  };
  const save=(key,state,prior=null,sourceManifest=null)=>runtime.store.transaction(()=>{
    const current=db.prepare('SELECT value FROM projects WHERE id=?').get(key);
    need((current?.value??null)===prior,'PROJECT_CHANGED');
    if(prior===null)need(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n<32,'PROJECT_LIMIT');
    const raw=canonical(sourceManifest===null?state:{schema:'agi-fleet/local-project/v1',state,sourceManifest});need(Buffer.byteLength(raw)<=4_000_000,'PROJECT_LIMIT');
    const used=db.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM projects WHERE id<>?').get(key).bytes;
    need(used+Buffer.byteLength(raw)<=STORAGE_LIMITS.projects,'PROJECT_STORAGE_LIMIT');
    db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(key,raw);
  });
  if(action==='project-import'){
    keys(input,['capsule','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    need(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n<32,'PROJECT_LIMIT');
    const inspected=await inspectCapsule(input.capsule),state=await restoreCapsule(inspected,true),project=id();save(project,state,null,inspected.capsule.payload.sourceManifest);return {project,state,authority:'none',qualification:'historical-only'};
  }
  if(action==='project-export'){keys(input,['project']);const snapshot=load(input.project);return {capsule:await exportCapsule(snapshot.state,snapshot.sourceManifest),authority:'none'};}
  if(action==='project-continue-history'){
    keys(input,['project','checkpointSha256','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    const snapshot=load(input.project),continued=await continueHistory(snapshot.state,true,snapshot.sourceManifest);
    need(digest(continued.checkpoint)===input.checkpointSha256,'CHECKPOINT_CHANGED');
    save(input.project,continued.state,snapshot.raw,snapshot.sourceManifest);
    return {project:input.project,checkpointSha256:input.checkpointSha256,capacity:historyCapacity(continued.state),authority:'none',runAuthorized:false};
  }
  if(action==='project-select'){
    keys(input,['project','candidate','decision','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');
    const snapshot=load(input.project),state=await chooseCandidate(snapshot.state,input.candidate,input.decision);
    await exportableState(state,snapshot.sourceManifest);save(input.project,state,snapshot.raw,snapshot.sourceManifest);return {project:input.project,state,runAuthorized:false};
  }
  keys(input,['project','execution','review']);
  const execution=db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(input.execution));
  const review=db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(input.review));
  need(execution?.state==='complete'&&review?.state==='complete'&&execution.actor!==review.actor,'SEPARATE_REVIEW_REQUIRED');
  const a=parseStrict(execution.value),b=parseStrict(review.value);need(a.role==='agent'&&b.role==='node'&&b.review==='internal','REVIEW_SCOPE');
  const x=parseStrict(execution.result),y=parseStrict(review.result);
  const first=parseStrict(db.prepare('SELECT value FROM grants WHERE id=?').get(execution.grant_id).value);
  const second=parseStrict(db.prepare('SELECT value FROM grants WHERE id=?').get(review.grant_id).value);
  need(first.task.action==='successor-run'&&second.task.action==='successor-check','PROJECT_MARKET_SCOPE');
  need(second.task.sourceActor===execution.actor&&second.task.sourceController===x.sourceController,'REVIEW_PROVENANCE');
  need(y.result.deliverySha256===digest(x.result.files)&&y.result.checker.passed,'CANDIDATE_REJECTED');
  need(canonical(first.task.input.mission)===canonical(second.task.input.mission)&&first.task.input.variant===second.task.input.variant,'REVIEW_INPUT_CHANGED');
  const project=input.project===null?id():uuid(input.project);
  if(input.project===null)need(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n<32,'PROJECT_LIMIT');
  const snapshot=input.project===null?null:load(project);
  const state=snapshot?snapshot.state:await createSystem(first.task.input.mission);
  need(canonical(state.mission)===canonical(first.task.input.mission),'PROJECT_MISSION_CHANGED');
  await validateState(state);
  const result=await runCandidate(state,first.task.input.variant,a.sourceSha256);
  need(canonical(result.candidate.files.map(({sha256,...f})=>f))===canonical(x.result.files),'RETURNED_BYTES_CHANGED');
  await exportableState(result.state,snapshot?.sourceManifest??null);save(project,result.state,snapshot?.raw??null,snapshot?.sourceManifest??null);
  runtime.store.event('successor-internal-candidate',{project,execution:execution.id,review:review.id,candidate:result.candidate.id});
  return {project,...result,selectionRequired:true,reviewClass:'internal',independentReview:false,authority:'none'};
}
