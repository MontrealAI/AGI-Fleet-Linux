import path from 'node:path';
import fs from "node:fs";
import { ROOT, ensure, now } from "./common.mjs";

export const BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT,"examples/labor-baseline.json")));
export const ROUTINE = ["buyerAcceptance", "buyerDispute", "moderatorRuling", "additionalEvidenceRequest"];
export const HUMAN_CATEGORIES = [...ROUTINE, "ownerGovernance", "exhaustedBeneficiaryReview", "specification", "customerSupport", "reviewCompensation", "qualification", "fundingAdmission", "reservationReconciliation", "valueCalibration", "maintenance", "incident", "other"];

// Coverage and completion are labor-weighted assumptions, never inferred from a
// transaction count. Evidence retrieval is not a measured replacement for a
// request for additional evidence, so that category defaults to zero coverage.
export function estimate(caseId, assumptions) {
  const scenario = BASELINE.cases.find(c => c.id === caseId);
  ensure(scenario && assumptions && typeof assumptions === "object" && !Array.isArray(assumptions), "LABOR_SCENARIO");
  ensure(Object.keys(assumptions).length === ROUTINE.length && ROUTINE.every(k => Object.hasOwn(assumptions, k)), "LABOR_CATEGORIES");
  const rows = ROUTINE.map(category => {
    const a = assumptions[category];
    ensure(a && Object.keys(a).length === 2 && [a.coverage, a.completion].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1), "LABOR_ASSUMPTION_RANGE");
    const baselineMinutes = scenario.counts[category] * BASELINE.minutes[category];
    return { category, events: scenario.counts[category], minutesPerEvent: BASELINE.minutes[category], ...a, baselineMinutes, potentiallyAvoidedMinutes: baselineMinutes * a.coverage * a.completion };
  });
  const routineMinutes = rows.reduce((n, r) => n + r.baselineMinutes, 0);
  const retainedMinutes = ["ownerGovernance", "exhaustedBeneficiaryReview"].reduce((n, k) => n + scenario.counts[k] * BASELINE.minutes[k], 0);
  const potentiallyAvoidedMinutes = rows.reduce((n, r) => n + r.potentiallyAvoidedMinutes, 0);
  const baselineMinutes = routineMinutes + retainedMinutes;
  return { schema: "agi-fleet-labor-estimate/v1", kind: "modeled-not-measured", scenario, rows, baselineMinutes, routineMinutes, retainedMinutes, potentiallyAvoidedMinutes, estimatedRemainingMinutes: baselineMinutes - potentiallyAvoidedMinutes, reductionFraction: baselineMinutes ? potentiallyAvoidedMinutes / baselineMinutes : 0, excluded: "Unmeasured work, automation operating costs, quality failures and changes in the job mix. These are assumptions for the historical scenario, not predicted or measured fleet performance." };
}

export function workload(store) {
  const grouped = sql => store.db.prepare(sql).all().map(r => ({ ...r }));
  const transactions = grouped("SELECT action,COUNT(*) transactions,COUNT(DISTINCT job) distinctJobs FROM txs WHERE status='confirmed' GROUP BY action ORDER BY action");
  const human = grouped("SELECT category,COUNT(*) entries,SUM(minutes) minutes FROM human_work WHERE voided=0 GROUP BY category ORDER BY category");
  const minutes = human.reduce((n, r) => n + r.minutes, 0);
  const claims = grouped("SELECT beneficiary,amount,status,attempts,lifetime_attempts,retry_round,checked,next_check FROM claims WHERE amount!='0' ORDER BY beneficiary");
  const observations = grouped("SELECT decision,COUNT(*) uniqueContexts FROM evidence_observations GROUP BY decision ORDER BY decision");
  const coverage = store.meta("measurementStart");
  return {
    schema: "agi-fleet-workload/v1", generated: now(), identity: store.meta("identity"),
    scope: "This retained role journal only. No network-wide coverage or fleet aggregation is implied.",
    measurementStart: coverage, historicalTransactionsIncluded: true,
    stats: store.stats(), jobsByState: grouped("SELECT status,COUNT(*) jobs FROM jobs GROUP BY status ORDER BY status"),
    confirmedTransactions: transactions, evidenceObservations: observations,
    humanWork: { minutesRecorded: minutes, hoursRecorded: minutes / 60, entries: human.reduce((n, r) => n + r.entries, 0), byCategory: human, completeness: "unknown-self-reported", measuredSavingsHours: null },
    exceptions: { open: store.incidents(200), totalOpen: store.db.prepare("SELECT COUNT(*) n FROM incidents WHERE state='open'").get().n, limit: 200 },
    claims: { observedUnpaidMicroUSDC: claims.reduce((n, c) => n + BigInt(c.amount), 0n).toString(), beneficiaries: claims, authoritativeCurrentBalance: false },
    limitations: ["Zero logged human minutes means no time was recorded; it does not establish zero human work.", "Confirmed transactions do not establish useful delivery, avoided labor or payment receipt for all beneficiaries.", "Evidence observations are distinct job/context checks since this upgrade, not additional-evidence requests or unique jobs.", "Claims are last observed values for configured beneficiaries, not a complete synchronized on-chain liability report.", "Do not add reports from overlapping wallets, restored journals or evidence roles without deduplicating their source records."],
  };
}
