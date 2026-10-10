import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { privateDir, ensure, encode } from "./util.mjs";
export class Store {
  constructor(dir, { lock = true } = {}) {
    privateDir(dir);
    this.dir = dir;
    this.lock = path.join(dir, "RUNNING.lock");
    if (lock) {
      try {
        this.lockFD = fs.openSync(this.lock, "wx", 0o600);
        fs.writeFileSync(
          this.lockFD,
          encode({ pid: process.pid, started: new Date().toISOString() }),
        );
        fs.fsyncSync(this.lockFD);
      } catch {
        throw new Error(
          "NODE_ALREADY_RUNNING_OR_STALE_LOCK: see recovery guide",
        );
      }
    }
    try {
      this.db = new DatabaseSync(path.join(dir, "agent.sqlite"));
      this.db
        .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,created_block INTEGER,spec_uri TEXT,details TEXT,requested INTEGER DEFAULT 0,owned INTEGER DEFAULT 0,bond TEXT DEFAULT '0',status TEXT DEFAULT 'waiting',reason TEXT DEFAULT '',next_review INTEGER DEFAULT 0,review TEXT);
        CREATE TABLE IF NOT EXISTS txs(hash TEXT PRIMARY KEY,raw TEXT NOT NULL,nonce INTEGER NOT NULL,kind TEXT NOT NULL,job TEXT,decision TEXT,context TEXT,bond TEXT NOT NULL,gas_budget TEXT NOT NULL,created INTEGER NOT NULL,accounted INTEGER NOT NULL,state TEXT NOT NULL,block_hash TEXT,block_number INTEGER,status INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON txs(state) WHERE state='pending';
        CREATE INDEX IF NOT EXISTS review_queue ON jobs(requested,status,next_review);
        CREATE INDEX IF NOT EXISTS tx_date ON txs(accounted);
        CREATE TABLE IF NOT EXISTS work(job TEXT PRIMARY KEY, binding TEXT NOT NULL, spec_hash TEXT NOT NULL, spec TEXT NOT NULL, content TEXT, uri TEXT, stage TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS agent_queue ON jobs(owned,status,next_review);`);
      if (process.platform !== "win32")
        fs.chmodSync(path.join(dir, "agent.sqlite"), 0o600);
    } catch (e) {
      this.close();
      throw e;
    }
  }
  close() {
    this.db?.close();
    this.db = null;
    if (this.lockFD !== undefined) {
      fs.closeSync(this.lockFD);
      fs.unlinkSync(this.lock);
      this.lockFD = undefined;
    }
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
    const r = this.db.prepare("SELECT value FROM meta WHERE key=?").get(k);
    return r ? JSON.parse(r.value) : fallback;
  }
  set(k, v) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(k, encode(v));
  }
  job(id) {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(String(id));
  }
  putJob(id, values) {
    const keys = Object.keys(values);
    ensure(
      keys.every((k) =>
        [
          "created_block",
          "spec_uri",
          "details",
          "requested",
          "owned",
          "bond",
          "status",
          "reason",
          "next_review",
          "review",
        ].includes(k),
      ),
      "STORE_FIELD",
    );
    this.db.prepare("INSERT OR IGNORE INTO jobs(id) VALUES(?)").run(String(id));
    if (keys.length)
      this.db
        .prepare(
          `UPDATE jobs SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
        )
        .run(...keys.map((k) => values[k]), String(id));
  }
  work(id) {
    const r = this.db.prepare("SELECT * FROM work WHERE job=?").get(String(id));
    return r ? { ...r, spec: JSON.parse(r.spec) } : null;
  }
  saveWork(id, w) {
    this.db
      .prepare(
        "INSERT INTO work VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET binding=excluded.binding,spec_hash=excluded.spec_hash,spec=excluded.spec,content=excluded.content,uri=excluded.uri,stage=excluded.stage,attempts=excluded.attempts,updated=excluded.updated",
      )
      .run(
        String(id),
        w.binding,
        w.spec_hash,
        JSON.stringify(w.spec),
        w.content ?? null,
        w.uri ?? null,
        w.stage,
        w.attempts ?? 0,
        Math.floor(Date.now() / 1000),
      );
  }
  queue(limit, now) {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE owned=0 AND status NOT IN ('terminal','unsupported','lost') AND next_review<=? ORDER BY created_block,id LIMIT ?",
      )
      .all(now, limit);
  }
  ownJobs() {
    return this.db
      .prepare("SELECT * FROM jobs WHERE owned=1 AND status!='terminal'")
      .all();
  }
  pending() {
    return this.db.prepare("SELECT * FROM txs WHERE state='pending'").get();
  }
  reserve(t) {
    this.db
      .prepare(
        "INSERT INTO txs(hash,raw,nonce,kind,job,decision,context,bond,gas_budget,created,accounted,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        t.hash,
        t.raw,
        t.nonce,
        t.kind,
        t.job ?? null,
        t.decision ?? null,
        t.context ?? null,
        t.bond ?? "0",
        t.gas_budget,
        t.created,
        t.created,
        "pending",
      );
  }
  recent(now) {
    return this.db
      .prepare("SELECT * FROM txs WHERE accounted>=? OR state='pending'")
      .all(now - 86400);
  }
  markReceipt(hash, receipt, now) {
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE txs SET state='confirmed',block_hash=?,block_number=?,status=?,accounted=? WHERE hash=?",
        )
        .run(receipt.blockHash, receipt.blockNumber, receipt.status, now, hash);
      const t = this.db.prepare("SELECT * FROM txs WHERE hash=?").get(hash);
      if (t.kind === "submit" && receipt.status === 1)
        this.putJob(t.job, {
          requested: 1,
          status: "submitted",
          reason: "AWAITING_REVIEW",
        });
      if (t.kind === "apply" && receipt.status === 1)
        this.putJob(t.job, {
          owned: 1,
          bond: t.bond,
          status: "assigned",
          reason: t.decision,
        });
    });
  }
  confirmed() {
    return this.db
      .prepare(
        "SELECT hash,block_hash,block_number FROM txs WHERE state='confirmed' ORDER BY block_number DESC LIMIT 200",
      )
      .all();
  }
  snapshot() {
    return {
      assignedTotal: this.db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE owned=1")
        .get().n,
      runtime: this.meta("runtime", {}),
      cursor: this.meta("cursor"),
      counts: this.db
        .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
        .all(),
      jobs: this.db
        .prepare(
          "SELECT id,status,reason,created_block,owned FROM jobs ORDER BY created_block DESC LIMIT 40",
        )
        .all(),
      pending:
        this.db
          .prepare(
            "SELECT hash,kind,job,created FROM txs WHERE state='pending'",
          )
          .get() ?? null,
      transactions: this.db
        .prepare(
          "SELECT hash,kind,job,state,status,accounted FROM txs ORDER BY created DESC LIMIT 20",
        )
        .all(),
    };
  }
}
