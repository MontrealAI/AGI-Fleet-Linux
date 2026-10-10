import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensure, privateDir, json, now, canonical, sha256 } from "./common.mjs";
import { HUMAN_CATEGORIES } from "./workload.mjs";
export class Store {
  constructor(home) {
    this.home = home;
    privateDir(home);
    this.db = new DatabaseSync(path.join(home, "service.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,created INTEGER NOT NULL,details TEXT NOT NULL,spec_uri TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT,checked INTEGER NOT NULL DEFAULT 0,next_check INTEGER NOT NULL DEFAULT 0,proof TEXT);
    CREATE TABLE IF NOT EXISTS txs(hash TEXT PRIMARY KEY,raw TEXT NOT NULL,nonce INTEGER UNIQUE NOT NULL,action TEXT NOT NULL,job TEXT,beneficiary TEXT,proof_hash TEXT,context TEXT,bond TEXT NOT NULL,gas_budget TEXT NOT NULL,created INTEGER NOT NULL,accounted INTEGER NOT NULL DEFAULT 0,binding TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',block_number INTEGER,block_hash TEXT,receipt TEXT);
    CREATE TABLE IF NOT EXISTS claims(beneficiary TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_check INTEGER NOT NULL DEFAULT 0,amount TEXT NOT NULL DEFAULT '0',status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,previous TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_requests(id TEXT PRIMARY KEY,created INTEGER NOT NULL,status TEXT NOT NULL,tokens INTEGER);`);
    fs.chmodSync(path.join(home, "service.sqlite"), 0o600);
    ensure(this.meta("schema", 1) === 1, "STATE_SCHEMA");
    this.set("schema", 1);
    if (
      !this.db
        .prepare("PRAGMA table_info(txs)")
        .all()
        .some((c) => c.name === "accounted")
    )
      this.db.exec(
        "ALTER TABLE txs ADD COLUMN accounted INTEGER NOT NULL DEFAULT 0",
      );
    this.db.exec(
      "UPDATE txs SET accounted=created WHERE accounted=0; CREATE INDEX IF NOT EXISTS fleet_txs_accounted ON txs(accounted);",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS fleet_jobs_queue ON jobs(status,next_check,checked); CREATE INDEX IF NOT EXISTS fleet_txs_budget ON txs(created); CREATE INDEX IF NOT EXISTS fleet_model_budget ON model_requests(created);",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents(key TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,code TEXT NOT NULL,state TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,occurrences INTEGER NOT NULL DEFAULT 1,closed INTEGER,outcome TEXT);
      CREATE INDEX IF NOT EXISTS fleet_incidents_open ON incidents(state,first_seen,key);
      CREATE TABLE IF NOT EXISTS evidence_observations(job TEXT NOT NULL,context TEXT NOT NULL,decision TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(job,context));
      CREATE TABLE IF NOT EXISTS human_work(id TEXT PRIMARY KEY,created INTEGER NOT NULL,category TEXT NOT NULL,minutes INTEGER NOT NULL,reference TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0);
    `);
    const claimCols = this.db.prepare("PRAGMA table_info(claims)").all().map(c => c.name);
    if (!claimCols.includes("lifetime_attempts")) {
      this.transaction(() => this.db.exec("ALTER TABLE claims ADD COLUMN lifetime_attempts INTEGER NOT NULL DEFAULT 0; UPDATE claims SET lifetime_attempts=attempts;"));
    }
    for (const column of ["retry_round", "checked"])
      if (!claimCols.includes(column)) this.db.exec(`ALTER TABLE claims ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    this.db.exec("UPDATE claims SET status='confirmed-awaiting-refresh' WHERE status='paid' AND amount!='0'");
    if (!this.meta("measurementStart")) this.set("measurementStart", now());
    if (!this.meta("exceptionsBackfilledV12")) {
      this.transaction(() => {
        for (const row of this.db.prepare("SELECT id,reason FROM jobs WHERE status='blocked'").all()) this.incident("job", row.id, row.reason ?? "JOB_BLOCKED");
        for (const row of this.db.prepare("SELECT beneficiary,status FROM claims WHERE amount!='0' AND status IN ('retry','retry-exhausted')").all()) this.incident("claim", row.beneficiary, row.status === "retry-exhausted" ? "CLAIM_RETRIES_EXHAUSTED" : "CLAIM_UNAVAILABLE");
        this.set("exceptionsBackfilledV12", true);
      });
    }
  }
  incident(kind, subject, code) {
    ensure(["job", "claim", "service"].includes(kind), "INCIDENT_KIND");
    const key = `${kind}:${subject}`, t = now();
    const old = this.db.prepare("SELECT * FROM incidents WHERE key=?").get(key);
    this.db.prepare(`INSERT INTO incidents(key,kind,subject,code,state,first_seen,last_seen) VALUES(?,?,?,?,'open',?,?)
      ON CONFLICT(key) DO UPDATE SET code=excluded.code,state='open',last_seen=excluded.last_seen,occurrences=incidents.occurrences+1,closed=NULL,outcome=NULL`).run(key, kind, String(subject), code, t, t);
    if (!old || old.state !== "open" || old.code !== code) this.event("exception-opened", { key, code });
    return key;
  }
  resolveIncident(kind, subject, outcome) {
    const key = `${kind}:${subject}`;
    const r = this.db.prepare("UPDATE incidents SET state='closed',closed=?,outcome=? WHERE key=? AND state='open'").run(now(), outcome, key);
    if (r.changes) this.event("exception-cleared", { key, outcome });
  }
  incidents(limit = 50, after = "") {
    ensure(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, "INCIDENT_LIMIT");
    ensure(typeof after === "string" && after.length <= 150, "INCIDENT_CURSOR");
    return this.db.prepare("SELECT * FROM incidents WHERE state='open' AND key>? ORDER BY key LIMIT ?").all(after, limit);
  }
  recordHuman({ id, category, minutes, reference = "" }) {
    ensure(typeof id === "string" && /^[0-9a-f-]{36}$/.test(id), "WORK_ENTRY_ID");
    ensure(HUMAN_CATEGORIES.includes(category), "WORK_CATEGORY");
    ensure(Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 1440, "WORK_MINUTES");
    ensure(typeof reference === "string" && /^[a-zA-Z0-9:_-]{0,150}$/.test(reference), "WORK_REFERENCE");
    return this.transaction(() => {
      const old = this.db.prepare("SELECT * FROM human_work WHERE id=?").get(id);
      if (old) {
        ensure(old.category === category && old.minutes === minutes && old.reference === reference, "WORK_ID_CONFLICT");
        return old;
      }
      this.db.prepare("INSERT INTO human_work(id,created,category,minutes,reference) VALUES(?,?,?,?,?)").run(id, now(), category, minutes, reference);
      this.event("human-work-recorded", { id, category, minutes, reference });
      return this.db.prepare("SELECT * FROM human_work WHERE id=?").get(id);
    });
  }
  voidHuman(id) {
    ensure(typeof id === "string", "WORK_ENTRY_ID");
    return this.transaction(() => {
      ensure(this.db.prepare("SELECT id FROM human_work WHERE id=?").get(id), "WORK_ENTRY_NOT_FOUND");
      const r = this.db.prepare("UPDATE human_work SET voided=1 WHERE id=? AND voided=0").run(id);
      if (r.changes) this.event("human-work-voided", { id });
      return { id, voided: true };
    });
  }
  observeEvidence(job, context, decision) {
    this.db.prepare("INSERT OR IGNORE INTO evidence_observations VALUES(?,?,?,?)").run(String(job), context, decision, now());
  }
  exhaustClaim(beneficiary) {
    this.db.prepare("UPDATE claims SET status='retry-exhausted' WHERE beneficiary=?").run(beneficiary);
    this.incident("claim", beneficiary, "CLAIM_RETRIES_EXHAUSTED");
  }
  renewClaim(beneficiary, reason) {
    return this.transaction(() => {
      const r = this.db.prepare("UPDATE claims SET attempts=0,retry_round=retry_round+1,next_check=0,status='retry' WHERE beneficiary=? AND amount!='0'").run(beneficiary);
      ensure(r.changes === 1, "CLAIM_NOT_UNPAID");
      this.incident("claim", beneficiary, "CLAIM_RETRY_RESUMED");
      this.event("claim-retries-renewed", { beneficiary, reason });
    });
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  meta(k, fallback = null) {
    const row = this.db.prepare("SELECT v FROM meta WHERE k=?").get(k);
    return row ? JSON.parse(row.v) : fallback;
  }
  set(k, v) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
      )
      .run(k, json(v));
  }
  event(kind, data) {
    const previous =
      this.db.prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").get()
        ?.hash ?? "0".repeat(64);
    const time = now(),
      text = canonical(data),
      hash = sha256(canonical({ previous, time, kind, data }));
    this.db
      .prepare(
        "INSERT INTO events(time,kind,data,previous,hash) VALUES(?,?,?,?,?)",
      )
      .run(time, kind, text, previous, hash);
  }
  putJob(id, values) {
    const cols = [
      "created",
      "details",
      "spec_uri",
      "status",
      "reason",
      "checked",
      "next_check",
      "proof",
    ];
    ensure(
      Object.keys(values).every((k) => cols.includes(k)),
      "JOB_FIELDS",
    );
    if (!this.job(id)) {
      ensure(
        values.created !== undefined &&
          typeof values.details === "string" &&
          typeof values.spec_uri === "string",
        "JOB_EVENT_REQUIRED",
      );
      this.db
        .prepare(
          "INSERT INTO jobs(id,created,details,spec_uri) VALUES(?,?,?,?)",
        )
        .run(String(id), values.created, values.details, values.spec_uri);
    }
    for (const [k, v] of Object.entries(values))
      this.db.prepare(`UPDATE jobs SET ${k}=? WHERE id=?`).run(v, String(id));
    if (values.status === "blocked") this.incident("job", String(id), values.reason ?? "JOB_BLOCKED");
    else if (values.status) this.resolveIncident("job", String(id), values.status === "terminal" ? "JOB_CLOSED_PAYMENT_NOT_ASSERTED" : `JOB_STATE_${values.status.toUpperCase().replaceAll("-", "_")}`);
  }
  job(id) {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(String(id));
  }
  queue(limit) {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE status NOT IN ('terminal','out-of-scope') AND next_check<=? ORDER BY checked,created,id LIMIT ?",
      )
      .all(now(), limit);
  }
  pending() {
    return this.db
      .prepare(
        "SELECT * FROM txs WHERE status='pending' ORDER BY nonce LIMIT 1",
      )
      .get();
  }
  reserve(t) {
    ensure(!this.pending(), "TRANSACTION_PENDING");
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO txs(hash,raw,nonce,action,job,beneficiary,proof_hash,context,bond,gas_budget,created,binding) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          t.hash,
          t.raw,
          t.nonce,
          t.action,
          t.job ?? null,
          t.beneficiary ?? null,
          t.proof_hash ?? null,
          t.context ?? null,
          t.bond ?? "0",
          t.gas_budget,
          t.created,
          t.binding,
        );
      this.db
        .prepare("UPDATE txs SET accounted=created WHERE hash=?")
        .run(t.hash);
      this.event("transaction-signed", {
        hash: t.hash,
        action: t.action,
        job: t.job,
        gasBudget: t.gas_budget,
      });
    });
  }
  recent(t = now()) {
    return this.db
      .prepare(
        "SELECT action,bond,gas_budget FROM txs WHERE accounted>=? OR status='pending'",
      )
      .all(t - 86400);
  }
  receipt(hash, r) {
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE txs SET status=?,block_number=?,block_hash=?,receipt=? WHERE hash=?",
        )
        .run(
          r.status === 1 ? "confirmed" : "reverted",
          r.blockNumber,
          r.blockHash,
          json({ hash: r.hash, status: r.status, gasUsed: String(r.gasUsed) }),
          hash,
        );
      this.event("transaction-receipt", {
        hash,
        status: r.status,
        block: r.blockNumber,
      });
      // Reserve cost until 24 hours after finality, even when mining was delayed.
      this.db
        .prepare("UPDATE txs SET accounted=MAX(accounted,?) WHERE hash=?")
        .run(now(), hash);
    });
  }
  claim(address, amount) {
    this.db
      .prepare(
        `INSERT INTO claims(beneficiary,amount,status,checked) VALUES(?,?,?,?) ON CONFLICT(beneficiary) DO UPDATE SET attempts=CASE WHEN claims.amount='0' AND excluded.amount!='0' THEN 0 ELSE claims.attempts END,next_check=CASE WHEN claims.amount='0' AND excluded.amount!='0' THEN 0 ELSE claims.next_check END,status=CASE WHEN excluded.amount='0' THEN 'paid' WHEN claims.amount='0' OR claims.status IN ('paid','confirmed-awaiting-refresh') THEN 'pending' ELSE claims.status END,amount=excluded.amount,checked=excluded.checked`,
      )
      .run(address, String(amount), String(amount) === "0" ? "paid" : "pending", now());
    if (String(amount) === "0") this.resolveIncident("claim", address, "ZERO_PENDING_OBSERVED");
  }
  claimAttempt(address, success) {
    this.db
      .prepare(
        "UPDATE claims SET attempts=attempts+1,lifetime_attempts=lifetime_attempts+1,next_check=?,status=? WHERE beneficiary=?",
      )
      .run(
        now() +
          (success
            ? 86400
            : Math.min(
                14,
                2 **
                  Math.min(
                    4,
                    this.db
                      .prepare(
                        "SELECT attempts FROM claims WHERE beneficiary=?",
                      )
                      .get(address)?.attempts ?? 0,
                  ),
              ) * 86400),
        success ? "confirmed-awaiting-refresh" : "retry",
        address,
      );
    if (!success) this.incident("claim", address, "CLAIM_UNAVAILABLE");
  }
  stats() {
    const count = (q) => this.db.prepare(q).get().n;
    return {
      jobs: count("SELECT COUNT(*) n FROM jobs"),
      open: count(
        "SELECT COUNT(*) n FROM jobs WHERE status NOT IN ('terminal','out-of-scope')",
      ),
      blockedJobs: count("SELECT COUNT(*) n FROM jobs WHERE status='blocked'"),
      confirmed: count("SELECT COUNT(*) n FROM txs WHERE status='confirmed'"),
      pending: count("SELECT COUNT(*) n FROM txs WHERE status='pending'"),
      unpaidClaims: count("SELECT COUNT(*) n FROM claims WHERE amount!='0'"),
      exhaustedClaims: count(
        "SELECT COUNT(*) n FROM claims WHERE amount!='0' AND status='retry-exhausted'",
      ),
      evidence: count("SELECT COUNT(*) n FROM jobs WHERE proof IS NOT NULL"),
      openExceptions: count("SELECT COUNT(*) n FROM incidents WHERE state='open'"),
      modelRequests24h: this.db
        .prepare("SELECT COUNT(*) n FROM model_requests WHERE created>?")
        .get(now() - 86400).n,
    };
  }
  close() {
    this.db.close();
  }
}
