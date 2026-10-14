import {canonical,need,parseStrict} from '../contracts.mjs';

// Logical UTF-8 payload ceilings, not a filesystem quota or a bound on SQLite
// page/journal overhead. Running and uncertain work keeps room for its outcome
// and one explicit reconciliation, independently of the daily work budget.
export const STORAGE_LIMITS=Object.freeze({grants:32_000_000,projects:32_000_000,runs:64_000_000,
  backendResult:2_100_000,outcome:2_200_000,runReservation:2_300_000});

export function runHistoryUsage(db) {
  return db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(value AS BLOB))+
    CASE WHEN state IN ('running','uncertain') THEN
      MAX(length(CAST(COALESCE(result,'') AS BLOB)),?,COALESCE(json_extract(value,'$.storageReservationBytes'),?))
    ELSE length(CAST(COALESCE(result,'') AS BLOB)) END),0) AS bytes FROM runs`)
    .get(STORAGE_LIMITS.runReservation,STORAGE_LIMITS.runReservation);
}

export function encodeOutcome(value,maximum=STORAGE_LIMITS.outcome) {
  const raw=canonical(value);need(Buffer.byteLength(raw)<=maximum,'OUTPUT_LIMIT');
  // Error observations also cross the durable JSON boundary. Invalid adapter
  // observations must not prevent a bounded STOP record from being committed.
  parseStrict(raw,maximum);return raw;
}

export function encodeFailure(code,observation) {
  try{return encodeOutcome({error:code,observation:observation??null});}
  catch{return canonical({error:code,observation:null,evidenceOmitted:'oversized-or-invalid-adapter-observation'});}
}
