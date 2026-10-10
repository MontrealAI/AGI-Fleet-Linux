const CODE='SETUP_RUNTIME_TELEMETRY_STATE_INVALID';
export const PINNED_TELEMETRY_STATE_KEY='telemetry.updateCheck';
const keys=new Set(['lastPingAt','latestVersion','note']);
const time=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
const sqliteTime=value=>time(value)||typeof value==='bigint'&&value>=0n&&value<=BigInt(Number.MAX_SAFE_INTEGER);
function need(ok){if(!ok){const error=Error(CODE);error.runtimeIdentityDetail={kind:'sqlite-security-projection',reason:'projection-validation-failed',logicalRecord:PINNED_TELEMETRY_STATE_KEY,beforeSha256:null,afterSha256:null};throw error;}}
/** OpenClaw 2026.9.5 persists this update-observation cache even when optional
 * feature statistics are disabled. It grants no update/execution authority.
 * Validation precedes omission from the modern security projection. */
export function assertPinnedTelemetryUpdateState(row){
 need(row?.state_key===PINNED_TELEMETRY_STATE_KEY&&typeof row.value_json==='string'&&Buffer.byteLength(row.value_json)<=8192&&sqliteTime(row.updated_at_ms));
 let state;try{state=JSON.parse(row.value_json);}catch{need(false);}
 need(state!==null&&typeof state==='object'&&!Array.isArray(state)&&Object.keys(state).every(key=>keys.has(key)));
 // The pinned writer uses JSON.stringify; this also rejects duplicate JSON
 // members rather than silently accepting the parser's last occurrence.
 need(row.value_json===JSON.stringify(state));
 if(Object.hasOwn(state,'lastPingAt'))need(time(state.lastPingAt));
 if(Object.hasOwn(state,'latestVersion'))need(typeof state.latestVersion==='string'&&state.latestVersion.length>0&&state.latestVersion.length<=256&&state.latestVersion===state.latestVersion.trim());
 if(Object.hasOwn(state,'note'))need(typeof state.note==='string'&&state.note.length<=500);
 return {schema:'agi-pinned-runtime-update-state/v1',runtime:'2026.9.5',logicalRecord:PINNED_TELEMETRY_STATE_KEY,classification:'recognized-pinned-runtime-update-state'};
}
