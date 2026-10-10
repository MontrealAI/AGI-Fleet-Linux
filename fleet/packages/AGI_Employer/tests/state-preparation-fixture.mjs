// Synthetic no-op preparation evidence for orchestration and filesystem tests.
import {securityReview} from '../compute/setup-transaction.mjs';
// This does not claim an SDK migration. setup-state-preparation.test.mjs executes
// the pinned runtime against real SQLite databases and proves row preservation.
export function statePreparationFixture(){return {
 schema:'agi-candidate-state-preparation/v1',protocolVersion:1,openclawVersion:'2026.9.5',
 sourceSchemaSha256:'a'.repeat(64),destinationSchemaSha256:'a'.repeat(64),
 sourceContentSha256:'b'.repeat(64),destinationContentSha256:'b'.repeat(64),
 sourceObjectCount:0,destinationObjectCount:0,sourceRowCount:0,destinationRowCount:0,
 addedSchemaObjects:[],addedColumns:[],ownerProfileCreated:false,
 ownerIdentityCreated:false,ownerDisplayNameInitialized:false,ownerDisplayNameSource:'existing',existingRecordsPreserved:true,verified:true
};}
export function bindPreparedReviewFixture(tx,review){
 // Explicitly model the already-completed preparation prerequisite. The real
 // bind/approve/publish methods and strict production validation still execute.
 if(tx.state.preparationProtocolVersion===1&&!tx.state.preparationReceipt){tx.state.preparationReceipt=statePreparationFixture();tx.save();}
 return tx.bindReview(review);
}
export function preparedSecurityReviewFixture(previousConfig,candidateConfig,previousSettings,candidateSettings,options={}){
 return securityReview(previousConfig,candidateConfig,previousSettings,candidateSettings,{statePreparation:statePreparationFixture(),...options});
}
