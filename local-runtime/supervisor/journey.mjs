import {need,keys,uuid,id,canonical,parseStrict,digest} from '../contracts.mjs';
import {inspectProjectRequest,sealProjectReturn,PROJECT_BYTES} from '../project/transfer.mjs';

export async function journeyOperation(runtime,action,input,principal){
  runtime.scope(principal,action);const db=runtime.store.db;
  const load=key=>{const row=db.prepare('SELECT value FROM journeys WHERE id=?').get(uuid(key));need(row,'JOURNEY_UNKNOWN');return {raw:row.value,value:parseStrict(row.value,PROJECT_BYTES)};};
  const save=(key,value,prior=null)=>runtime.store.transaction(()=>{
    const current=db.prepare('SELECT value FROM journeys WHERE id=?').get(key);need((current?.value??null)===prior,'JOURNEY_CHANGED');
    if(prior===null)need(db.prepare('SELECT COUNT(*) AS n FROM journeys').get().n<32,'JOURNEY_LIMIT');
    const raw=canonical(value);need(Buffer.byteLength(raw)<=PROJECT_BYTES,'JOURNEY_CAPACITY');
    const used=db.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM journeys WHERE id<>?').get(key).bytes;need(used+Buffer.byteLength(raw)<=32_000_000,'JOURNEY_STORAGE_LIMIT');
    db.prepare('INSERT INTO journeys VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(key,raw);
  });
  if(action==='journey-list'){
    keys(input,[]);return {journeys:db.prepare('SELECT id,value FROM journeys ORDER BY rowid DESC').all().map(row=>{const value=parseStrict(row.value,PROJECT_BYTES);return {journey:row.id,project:value.project,route:value.route,returned:value.returned!==null};}),authority:'none'};
  }
  if(action==='journey-import'){
    keys(input,['request','confirm']);need(input.confirm===true,'CONFIRM_REQUIRED');const checked=await inspectProjectRequest(input.request),journey=id();
    save(journey,{schema:'agi-fleet/local-journey/v1',request:input.request,project:checked.request.project,route:checked.request.route,returned:null});
    runtime.store.event('journey-imported-inert',{journey,requestSha256:digest(input.request),authority:'none'});
    return {journey,project:checked.request.project,route:checked.request.route,authority:'none',runAuthorized:false,productionQualified:false};
  }
  if(action==='journey-inspect'){
    keys(input,['journey']);const {value}=load(input.journey);return {...value,journey:input.journey,authority:'none',runAuthorized:false};
  }
  const executionFor=async(snapshot,run)=>{
    const checked=await inspectProjectRequest(snapshot.value.request),row=db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(run));
    need(row?.state==='complete','JOURNEY_EXECUTION_REQUIRED');
    const value=parseStrict(row.value),grant=parseStrict(db.prepare('SELECT value FROM grants WHERE id=?').get(row.grant_id).value),receipt=parseStrict(row.result);
    const binding=digest(snapshot.value.request);
    need(grant.projectRequestSha256===binding&&value.projectRequestSha256===binding&&receipt.projectRequestSha256===binding,'JOURNEY_PROJECT_BINDING');
    need(value.role==='agent'&&canonical(grant.task)===canonical(checked.request.task)&&receipt.inputSha256===digest(checked.request.task),'JOURNEY_EXECUTION_CHANGED');
    return {request:checked.request,row,value,grant,receipt};
  };
  if(action==='journey-prepare'){
    keys(input,['journey','actor']);const snapshot=load(input.journey),checked=await inspectProjectRequest(snapshot.value.request);
    return {journey:input.journey,...runtime.prepare({actor:input.actor,task:checked.request.task},principal,{projectRequestSha256:digest(snapshot.value.request)}),route:checked.request.route};
  }
  if(action==='journey-review-prepare'){
    keys(input,['journey','execution','actor']);const snapshot=load(input.journey),execution=await executionFor(snapshot,input.execution);
    const task={schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{...execution.request.task.input,files:execution.receipt.result.files},review:'internal',sourceActor:execution.row.actor,sourceController:execution.receipt.sourceController};
    return {journey:input.journey,execution:input.execution,...runtime.prepare({actor:input.actor,task},principal,{projectRequestSha256:digest(snapshot.value.request)}),reviewClass:'internal',independentReview:false};
  }
  keys(input,['journey','execution','review','confirm']);need(action==='journey-export','ACTION_UNKNOWN');need(input.confirm===true,'CONFIRM_REQUIRED');
  const snapshot=load(input.journey),execution=await executionFor(snapshot,input.execution),review=db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(input.review));
  need(review?.state==='complete'&&review.actor!==execution.row.actor&&parseStrict(review.value).role==='node','JOURNEY_SEPARATE_REVIEW_REQUIRED');
  const reviewGrant=parseStrict(db.prepare('SELECT value FROM grants WHERE id=?').get(review.grant_id).value),reviewReceipt=parseStrict(review.result);
  const binding=digest(snapshot.value.request);need(reviewGrant.projectRequestSha256===binding&&parseStrict(review.value).projectRequestSha256===binding&&reviewReceipt.projectRequestSha256===binding,'JOURNEY_PROJECT_BINDING');
  const expected={schema:'agi-fleet/local-task/v1',action:'successor-check',workspace:'files',input:{...execution.request.task.input,files:execution.receipt.result.files},review:'internal',sourceActor:execution.row.actor,sourceController:execution.receipt.sourceController};
  need(canonical(reviewGrant.task)===canonical(expected),'JOURNEY_REVIEW_CHANGED');
  const entry=(row,receipt)=>({runId:row.id,actorId:row.actor,controllerId:receipt.sourceController,raw:row.result,sha256:digest(row.result)});
  const returned=await sealProjectReturn({schema:'agi-fleet/project-return/v1',request:{raw:snapshot.value.request,sha256:digest(snapshot.value.request)},project:execution.request.project,route:execution.request.route,execution:entry(execution.row,execution.receipt),review:entry(review,reviewReceipt),reviewClass:'internal',independentReview:false,authority:'none',productionQualified:false,settlement:'not-connected'});
  need(snapshot.value.returned===null||snapshot.value.returned===returned,'JOURNEY_RETURN_ALREADY_RECORDED');
  save(input.journey,{...snapshot.value,returned},snapshot.raw);runtime.store.event('journey-returned-internal',{journey:input.journey,execution:input.execution,review:input.review,sha256:digest(returned)});
  return {journey:input.journey,returned,authority:'none',independentReview:false,productionQualified:false,settlement:'not-connected'};
}
