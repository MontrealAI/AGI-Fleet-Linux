// Synthetic orchestration evidence. The actual pinned API runs are in
// setup-clean-initialization.test.mjs, never represented by this fixture.
export function cleanInitializationFixture(){return {
 schema:'agi-clean-initialization/v1',protocolVersion:1,openclawVersion:'2026.9.5',
 sourceIdentity:'1'.repeat(64),destinationIdentity:'2'.repeat(64),
 sourceStateSchemaSha256:'3'.repeat(64),destinationStateSchemaSha256:'3'.repeat(64),
 sourceStateContentSha256:'4'.repeat(64),destinationStateContentSha256:'5'.repeat(64),
 revisionKeyCreated:true,fingerprintKeyCreated:true,revisionSchemaCreated:false,
 deviceIdentityCreated:true,systemJobCount:6,systemJobsCreated:true,schedulerEnabled:false,
 cliShimSha256:'6'.repeat(64),runtimeArtifactsPrepared:true,
 startupCheckpointCount:3,bundledDiscoveryInitialized:true,pluginIndexPrepared:true,pluginIndexSha256:'7'.repeat(64),
 existingRecordsPreserved:true,otherFilesPreserved:true,verified:true
};}
