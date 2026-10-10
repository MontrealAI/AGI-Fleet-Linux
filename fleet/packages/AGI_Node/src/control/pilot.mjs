import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensure, atomicWrite } from "../util.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const statuses = ["settled-reviewed", "settled-other", "failed", "unresolved"];
const text = (v, min, max) =>
  typeof v === "string" &&
  v.trim().length >= min &&
  v.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
function decimal(v, places) {
  ensure(
    typeof v === "string" &&
      new RegExp(`^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,${places}})?$`).test(v),
    "PILOT_AMOUNT_INVALID",
  );
  return v;
}
function addAmounts(values, places) {
  const total = values
    .reduce((n, value) => {
      const [whole, fraction = ""] = value.split(".");
      return (
        n +
        BigInt(whole) * 10n ** BigInt(places) +
        BigInt(fraction.padEnd(places, "0"))
      );
    }, 0n)
    .toString()
    .padStart(places + 1, "0");
  return total.slice(0, -places) + "." + total.slice(-places);
}
export function summarizeRun(run, now = Date.now()) {
  const end = run.endedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.floor((end - run.startedAt) / 1000));
  const counts = Object.fromEntries(
    statuses.map((s) => [s, run.jobs.filter((j) => j.status === s).length]),
  );
  return {
    elapsedSeconds,
    clockValid:
      now >= run.startedAt && (run.endedAt === null || now >= run.endedAt),
    outcomesRecorded: run.jobs.length,
    counts,
    operatorReportedReviewedSettlementsPerDay:
      elapsedSeconds >= 86400
        ? Number(
            ((counts["settled-reviewed"] * 86400) / elapsedSeconds).toFixed(3),
          )
        : null,
    receivedUSDC: addAmounts(
      run.jobs
        .filter((j) => j.status.startsWith("settled-"))
        .map((j) => j.receivedUSDC),
      6,
    ),
    interventions: run.interventions.length,
    interventionMinutes: run.interventions.reduce((n, i) => n + i.minutes, 0),
    costs: run.costs,
    basis:
      "Outcomes, independence, payments, costs and intervention time are operator reports, not automatically verified. Rate uses elapsed wall time including downtime; no extrapolation before 24 hours. ETH, USDC and USD are not combined into profit.",
  };
}

// A bounded commissioning notebook. It never changes signing authority, the
// transaction journal, the event cursor, budgets, or commissioning pass records.
export class Pilot {
  constructor(controller, role, version, clock = Date.now) {
    this.c = controller;
    this.role = role;
    this.version = version;
    this.clock = clock;
    this.file = path.join(controller.home, "pilot.json");
  }
  read() {
    if (!fs.existsSync(this.file))
      return { schema: "agi-pilot-book/v1", runs: [] };
    ensure(fs.statSync(this.file).size <= MAX_BYTES, "PILOT_HISTORY_LIMIT");
    let book;
    try {
      book = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      ensure(false, "PILOT_HISTORY_DAMAGED");
    }
    ensure(
      book?.schema === "agi-pilot-book/v1" &&
        Array.isArray(book.runs) &&
        book.runs.length <= 20,
      "PILOT_HISTORY_DAMAGED",
    );
    return book;
  }
  save(book) {
    const data = JSON.stringify(book, null, 2) + "\n";
    ensure(Buffer.byteLength(data) <= MAX_BYTES, "PILOT_HISTORY_LIMIT");
    atomicWrite(this.file, data);
  }
  start(input) {
    ensure(this.c.vault.unlocked, "NODE_LOCKED");
    const book = this.read();
    ensure(!book.runs.some((r) => r.endedAt === null), "PILOT_ALREADY_STARTED");
    ensure(book.runs.length < 20, "PILOT_HISTORY_LIMIT");
    ensure(text(input.label, 3, 80), "PILOT_LABEL_REQUIRED");
    const cfg = this.c.config;
    ensure(
      cfg.manager && (cfg.agent ?? cfg.validator) && this.c.pin(),
      "PILOT_ENROLL_FIRST",
    );
    book.runs.push({
      id: crypto.randomUUID(),
      label: input.label.trim(),
      role: this.role,
      application: this.version,
      chainId: cfg.chainId,
      scope: this.c.operations.scope(),
      startedAt: this.clock(),
      endedAt: null,
      jobs: [],
      interventions: [],
      costs: { gasETH: null, externalUSD: null, lostUSDC: null, evidence: "" },
    });
    this.save(book);
    return this.report();
  }
  edit(work) {
    ensure(this.c.vault.unlocked, "NODE_LOCKED");
    const book = this.read(),
      run = book.runs.at(-1),
      now = this.clock();
    ensure(run && run.endedAt === null, "PILOT_START_FIRST");
    ensure(now >= run.startedAt, "PILOT_CLOCK_CHANGED");
    ensure(run.scope === this.c.operations.scope(), "PILOT_SCOPE_CHANGED");
    work(run, now);
    this.save(book);
    return this.report();
  }
  job(input) {
    return this.edit((run, now) => {
      ensure(
        typeof input.jobId === "string" &&
          /^[1-9][0-9]{0,77}$/.test(input.jobId) &&
          BigInt(input.jobId) < 2n ** 256n,
        "PILOT_JOB_INVALID",
      );
      ensure(statuses.includes(input.status), "PILOT_OUTCOME_INVALID");
      ensure(
        input.attest === true && text(input.evidence, 20, 800),
        "PILOT_EVIDENCE_REQUIRED",
      );
      const settled = input.status.startsWith("settled-");
      ensure(
        !settled ||
          (/^0x[0-9a-fA-F]{64}$/.test(input.receipt) &&
            !/^0x0{64}$/.test(input.receipt)),
        "PILOT_RECEIPT_REQUIRED",
      );
      ensure(
        !settled ||
          (Number.isSafeInteger(input.settledAt) &&
            input.settledAt >= run.startedAt &&
            input.settledAt <= now),
        "PILOT_SETTLEMENT_TIME_INVALID",
      );
      const receivedUSDC = settled ? decimal(input.receivedUSDC, 6) : null;
      // One outcome per job per run, including corrections; never double count.
      const previous = run.jobs.findIndex((j) => j.jobId === input.jobId);
      ensure(previous >= 0 || run.jobs.length < 1000, "PILOT_HISTORY_LIMIT");
      const entry = {
        jobId: input.jobId,
        status: input.status,
        receipt: settled ? input.receipt.toLowerCase() : null,
        receivedUSDC,
        settledAt: settled ? input.settledAt : null,
        evidence: input.evidence.trim(),
        recordedAt: now,
        revision: previous >= 0 ? run.jobs[previous].revision + 1 : 1,
      };
      if (previous >= 0) run.jobs[previous] = entry;
      else run.jobs.push(entry);
    });
  }
  intervention(input) {
    return this.edit((run, now) => {
      ensure(
        text(input.evidence, 10, 800) &&
          Number.isSafeInteger(input.minutes) &&
          input.minutes >= 1 &&
          input.minutes <= 1440,
        "PILOT_INTERVENTION_INVALID",
      );
      ensure(run.interventions.length < 500, "PILOT_HISTORY_LIMIT");
      run.interventions.push({
        at: now,
        minutes: input.minutes,
        evidence: input.evidence.trim(),
      });
    });
  }
  costs(input) {
    return this.edit((run) => {
      ensure(text(input.evidence, 10, 800), "PILOT_EVIDENCE_REQUIRED");
      run.costs = {
        gasETH: input.gasETH === "" ? null : decimal(input.gasETH, 18),
        lostUSDC:
          input.lostUSDC === "" || input.lostUSDC === undefined
            ? null
            : decimal(input.lostUSDC, 6),
        externalUSD:
          input.externalUSD === "" ? null : decimal(input.externalUSD, 2),
        evidence: input.evidence.trim(),
      };
    });
  }
  journal(run, end) {
    try {
      return this.c.dbRead((db) => ({
        confirmedTransactions: db
          .prepare(
            "SELECT kind,status,COUNT(*) AS count FROM txs WHERE state='confirmed' AND accounted>=? AND accounted<? GROUP BY kind,status ORDER BY kind,status",
          )
          .all(Math.ceil(run.startedAt / 1000), Math.ceil(end / 1000)),
        pendingTransactionsNow: db
          .prepare("SELECT COUNT(*) AS count FROM txs WHERE state='pending'")
          .get().count,
        basis:
          "Local journal only; time is local confirmation-accounting time, not block timestamp. Successful transactions are not completed jobs. No raw transactions, wallet addresses or job contents. Missing journal is unknown, not zero.",
      }));
    } catch {
      return null;
    }
  }
  finish() {
    // Allow closing after a configuration/version change so old and new scopes
    // remain separate. It never marks the run or commissioning as passed.
    ensure(this.c.vault.unlocked, "NODE_LOCKED");
    const book = this.read(),
      run = book.runs.at(-1),
      now = this.clock();
    ensure(run && run.endedAt === null, "PILOT_START_FIRST");
    ensure(now >= run.startedAt, "PILOT_CLOCK_CHANGED");
    run.scopeMatchedAtClose = run.scope === this.c.operations.scope();
    run.endedAt = now;
    run.journal = run.scopeMatchedAtClose ? this.journal(run, now) : null;
    this.save(book);
    return this.report();
  }
  report() {
    const now = this.clock(),
      book = this.read();
    const scope = this.c.vault.unlocked ? this.c.operations.scope() : null;
    return {
      schema: "agi-pilot-report/v1",
      generatedAt: new Date(now).toISOString(),
      role: this.role,
      application: this.version,
      runs: book.runs.map((run) => ({
        ...run,
        scopeMatches: scope === null ? null : run.scope === scope,
        summary: summarizeRun(run, now),
        journal:
          run.endedAt !== null
            ? run.journal
            : run.scope === scope
              ? this.journal(run, now)
              : null,
      })),
      qualification:
        "Commissioning evidence notebook, not an independent audit or throughput benchmark. A completed duration does not prove continuous operation. Record every eligible outcome, including failures, and verify receipts, net receipts, unrelated validators and deferred claims before reporting settlement. Buyer-only acceptance is settled-other.",
      privacy:
        "Local operator session only; excluded from Fleet Monitor and AI status feeds. Evidence notes and public job/transaction identifiers are private exports. Never enter secrets or personal job contents. Export separately: this notebook is not included in wallet backups.",
    };
  }
}
