import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export const canonical = (x) =>
  x === null || typeof x !== "object"
    ? JSON.stringify(x)
    : Array.isArray(x)
      ? "[" + x.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}";
export const digest = (x) =>
  crypto
    .createHash("sha256")
    .update(typeof x === "string" || Buffer.isBuffer(x) ? x : canonical(x))
    .digest("hex");
export const need = (v, code) => {
  if (!v) throw Error("WORKFORCE_" + code);
};
export const exact = (o, keys) =>
  need(
    o &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      Object.keys(o).sort().join("|") === [...keys].sort().join("|"),
    "FIELDS",
  );
export const id = (x) =>
  typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x);
export const hash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export const integer = (x, a, b) => Number.isSafeInteger(x) && x >= a && x <= b;
export function money(value) {
  need(
    typeof value === "string" &&
      /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(value),
    "COST_POLICY",
  );
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
}
export const moneyText = (n) =>
  String(n / 1000000n) + "." + String(n % 1000000n).padStart(6, "0");
export function privateDir(dir) {
  need(path.isAbsolute(dir), "ABSOLUTE_PATH");
  let current = path.parse(dir).root;
  for (const part of dir.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const s = fs.lstatSync(current);
      need(s.isDirectory() && !s.isSymbolicLink(), "DIRECTORY_LINK");
    }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.statSync(dir);
  need(
    st.uid === process.getuid() && (st.mode & 0o077) === 0,
    "PRIVATE_DIRECTORY",
  );
  return dir;
}
export function readFile(file, limit = 1048576) {
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const st = fs.fstatSync(fd);
    need(st.isFile() && st.nlink === 1 && st.size <= limit, "FILE");
    const b = fs.readFileSync(fd);
    need(b.length === st.size, "FILE_CHANGED");
    return b;
  } finally {
    fs.closeSync(fd);
  }
}
export function readSecret(file, maximum = 8192) {
  const st = fs.lstatSync(file);
  need(
    st.uid === process.getuid() && (st.mode & 0o077) === 0,
    "SECRET_PERMISSIONS",
  );
  return readFile(file, maximum).toString("utf8").trim();
}
export function atomic(file, value) {
  privateDir(path.dirname(file));
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, typeof value === "string" ? value : canonical(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  const d = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(d);
  } finally {
    fs.closeSync(d);
  }
}
export function createIdentity(dir) {
  privateDir(dir);
  const file = path.join(dir, "device-key.pem");
  if (!fs.existsSync(file)) {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    atomic(file, privateKey.export({ type: "pkcs8", format: "pem" }));
  }
  const privateKey = crypto.createPrivateKey(readSecret(file)),
    publicKey = crypto.createPublicKey(privateKey),
    raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, publicKey: raw.toString("base64url"), id: digest(raw) };
}
export class Journal {
  constructor(dir, { now = Date.now, recover = true, observer = false } = {}) {
    privateDir(dir);
    this.dir = dir;
    this.now = now;
    this.owner = observer ? null : crypto.randomUUID();
    const dbPath = path.join(dir, "ledger.sqlite");
    if (fs.existsSync(dbPath)) {
      const s = fs.lstatSync(dbPath);
      need(
        s.isFile() &&
          !s.isSymbolicLink() &&
          s.nlink === 1 &&
          s.uid === process.getuid(),
        "DATABASE_FILE",
      );
    }
    try {
      this.db = new DatabaseSync(dbPath);
      fs.chmodSync(dbPath, 0o600);
      this.db
        .exec(`PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS monotonic(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS lease(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,owner TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,spec_hash TEXT NOT NULL,runtime_hash TEXT NOT NULL,role TEXT NOT NULL,kind TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,status TEXT NOT NULL,model_calls INTEGER NOT NULL DEFAULT 0,actions INTEGER NOT NULL DEFAULT 0,cost_usdc TEXT,reserved_cost_usdc TEXT NOT NULL,cost_evidence TEXT,human_seconds INTEGER NOT NULL DEFAULT 0,delivery_hash TEXT,error TEXT);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES runs(id),at INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,previous TEXT NOT NULL,hash TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),request_hash TEXT NOT NULL,status TEXT NOT NULL,response_hash TEXT);
  CREATE TABLE IF NOT EXISTS interventions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),started INTEGER NOT NULL,finished INTEGER,reason TEXT NOT NULL);`);
      this.verify();
      if (!observer) {
        this.transaction(() => {
          const lease = this.db
            .prepare("SELECT * FROM lease WHERE singleton=1")
            .get();
          if (lease) {
            let alive = true;
            try {
              process.kill(lease.pid, 0);
            } catch (e) {
              if (e.code === "ESRCH") alive = false;
            }
            need(!alive, "ALREADY_RUNNING");
          }
          this.db
            .prepare("INSERT OR REPLACE INTO lease VALUES(1,?,?)")
            .run(process.pid, this.owner);
        });
        if (recover)
          for (const row of this.db
            .prepare("SELECT id FROM runs WHERE status='running'")
            .all())
            this.finish(row.id, "interrupted", {
              error: "RESTART_REQUIRES_RECONCILIATION",
            });
      }
    } catch (e) {
      this.close();
      throw e;
    }
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  append(run, kind, payload = {}) {
    const previous =
      this.db.prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").get()
        ?.hash ?? "0".repeat(64);
    const at = this.now(),
      body = { run, at, kind, payload, previous },
      h = digest(body);
    this.db
      .prepare(
        "INSERT INTO events(run_id,at,kind,payload,previous,hash) VALUES(?,?,?,?,?,?)",
      )
      .run(run, at, kind, canonical(payload), previous, h);
    return h;
  }
  verify() {
    let previous = "0".repeat(64);
    for (const row of this.db
      .prepare("SELECT * FROM events ORDER BY seq")
      .all()) {
      need(
        row.previous === previous &&
          digest({
            run: row.run_id,
            at: row.at,
            kind: row.kind,
            payload: JSON.parse(row.payload),
            previous,
          }) === row.hash,
        "JOURNAL_TAMPERED",
      );
      previous = row.hash;
    }
    return previous;
  }
  start(
    run,
    spec,
    runtime,
    role,
    kind = "pilot",
    maxRuns24h = 20,
    reservedCostUSDC = "0",
    maxDailyReserveUSDC = "999999999999",
  ) {
    need(this.owner, "OBSERVER");
    need(
      id(run) &&
        hash(spec) &&
        hash(runtime) &&
        ["agent", "reviewer"].includes(role) &&
        ["pilot", "production"].includes(kind),
      "RUN",
    );
    this.transaction(() => {
      need(
        !this.db.prepare("SELECT 1 FROM runs WHERE id=?").get(run),
        "DUPLICATE_RUN",
      );
      need(
        this.db
          .prepare("SELECT COUNT(*) n FROM runs WHERE started>?")
          .get(this.now() - 86400000).n < maxRuns24h,
        "DAILY_LIMIT",
      );
      const reserve = money(reservedCostUSDC),
        ceiling = money(maxDailyReserveUSDC);
      const recent = this.db
        .prepare(
          "SELECT reserved_cost_usdc,cost_usdc FROM runs WHERE started>?",
        )
        .all(this.now() - 86400000);
      const billed = this.db
        .prepare(
          "SELECT reserved_cost_usdc,cost_usdc FROM runs WHERE runtime_hash=? AND cost_usdc IS NOT NULL",
        )
        .all(runtime);
      need(
        billed.every((x) => money(x.cost_usdc) <= money(x.reserved_cost_usdc)),
        "COST_RESERVE_UNDERESTIMATED",
      );
      need(
        recent.reduce((sum, x) => sum + money(x.reserved_cost_usdc), 0n) +
          reserve <=
          ceiling,
        "DAILY_COST_LIMIT",
      );
      this.db
        .prepare(
          "INSERT INTO runs(id,spec_hash,runtime_hash,role,kind,started,status,reserved_cost_usdc) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          run,
          spec,
          runtime,
          role,
          kind,
          this.now(),
          "running",
          reservedCostUSDC,
        );
      this.append(run, "started", {
        spec,
        runtime,
        role,
        kind,
        reservedCostUSDC,
      });
    });
  }
  row(run) {
    return this.db.prepare("SELECT * FROM runs WHERE id=?").get(run);
  }
  monotonic(key, value) {
    need(integer(value, 0, Number.MAX_SAFE_INTEGER), "SEQUENCE");
    this.transaction(() => {
      const old =
        this.db.prepare("SELECT value FROM monotonic WHERE key=?").get(key)
          ?.value ?? -1;
      need(value >= old, "AUTHORITY_ROLLBACK");
      if (value > old)
        this.db
          .prepare("INSERT OR REPLACE INTO monotonic VALUES(?,?)")
          .run(key, value);
    });
  }
  checkpoint(run, encryptedSha256) {
    need(
      this.row(run)?.status === "running" && hash(encryptedSha256),
      "CHECKPOINT",
    );
    this.append(run, "checkpoint", { encryptedSha256 });
  }
  lastCheckpoint(run) {
    const r = this.db
      .prepare(
        "SELECT * FROM events WHERE run_id=? AND kind='checkpoint' ORDER BY seq DESC LIMIT 1",
      )
      .get(run);
    return r ? { seq: r.seq, ...JSON.parse(r.payload) } : null;
  }
  resume(run, spec, runtime, role, maxResumes) {
    need(this.owner, "OBSERVER");
    return this.transaction(() => {
      const r = this.row(run),
        cp = this.lastCheckpoint(run);
      need(
        r?.status === "interrupted" &&
          r.spec_hash === spec &&
          r.runtime_hash === runtime &&
          r.role === role &&
          r.cost_evidence === null,
        "RESUME_SCOPE",
      );
      need(cp, "CHECKPOINT_REQUIRED");
      const events = this.db
        .prepare(
          "SELECT kind,payload,seq FROM events WHERE run_id=? ORDER BY seq",
        )
        .all(run);
      need(
        events.filter((e) => e.kind === "resumed").length < maxResumes,
        "RESUME_LIMIT",
      );
      const reservations = new Map(
        events
          .filter((e) => e.kind === "reserved")
          .map((e) => {
            const p = JSON.parse(e.payload);
            return [p.actionId, { ...p, seq: e.seq }];
          }),
      );
      for (const a of this.db
        .prepare("SELECT * FROM actions WHERE run_id=?")
        .all(run)) {
        const reservation = reservations.get(a.id);
        need(reservation, "ACTION_PROVENANCE");
        // An input after the last committed checkpoint is never replayed.
        need(
          reservation.model ||
            (a.status === "observed" && reservation.seq < cp.seq),
          "UNRECONCILED_INPUT",
        );
        if (a.status === "reserved") {
          need(reservation.model, "UNRECONCILED_INPUT");
          this.db
            .prepare("UPDATE actions SET status='abandoned' WHERE id=?")
            .run(a.id);
          this.append(run, "abandoned-model", { actionId: a.id });
        }
      }
      this.db
        .prepare(
          "UPDATE runs SET status='running',finished=NULL,error=NULL WHERE id=?",
        )
        .run(run);
      this.append(run, "resumed", { checkpointSha256: cp.encryptedSha256 });
      return this.row(run);
    });
  }
  reserve(run, request, { model = false, maxCalls = 1, maxActions = 1 } = {}) {
    need(this.owner, "OBSERVER");
    return this.transaction(() => {
      const r = this.db.prepare("SELECT * FROM runs WHERE id=?").get(run);
      need(r?.status === "running", "RUN_NOT_ACTIVE");
      need(
        model ? r.model_calls < maxCalls : r.actions < maxActions,
        "BUDGET_EXHAUSTED",
      );
      const actionId = crypto.randomUUID(),
        requestHash = digest(request);
      this.db
        .prepare("INSERT INTO actions VALUES(?,?,?,?,NULL)")
        .run(actionId, run, requestHash, "reserved");
      this.db
        .prepare(
          "UPDATE runs SET " +
            (model ? "model_calls=model_calls+1" : "actions=actions+1") +
            " WHERE id=?",
        )
        .run(run);
      this.append(run, "reserved", { actionId, requestHash, model });
      return actionId;
    });
  }
  resolve(actionId, response) {
    this.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM actions WHERE id=?")
        .get(actionId);
      need(row?.status === "reserved", "ACTION_ALREADY_RECORDED");
      const h = digest(response);
      this.db
        .prepare(
          "UPDATE actions SET status='observed',response_hash=? WHERE id=?",
        )
        .run(h, actionId);
      this.append(row.run_id, "observed", { actionId, responseHash: h });
    });
  }
  finish(run, status, { deliveryHash = null, error = null } = {}) {
    need(this.owner, "OBSERVER");
    need(
      ["complete", "failed", "interrupted", "declined", "uncertain"].includes(
        status,
      ) &&
        (!deliveryHash || hash(deliveryHash)),
      "STATUS",
    );
    this.transaction(() => {
      need(
        this.db.prepare("SELECT status FROM runs WHERE id=?").get(run)
          ?.status === "running",
        "RUN_NOT_ACTIVE",
      );
      this.db
        .prepare(
          "UPDATE runs SET status=?,finished=?,delivery_hash=?,error=? WHERE id=?",
        )
        .run(status, this.now(), deliveryHash, error, run);
      this.append(run, status, { deliveryHash, error });
    });
  }
  reconcileCost(run, cost, evidence) {
    need(
      typeof cost === "string" &&
        /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(cost) &&
        hash(evidence),
      "COST",
    );
    this.transaction(() => {
      need(this.db.prepare("SELECT id FROM runs WHERE id=?").get(run), "RUN");
      need(
        !this.db.prepare("SELECT cost_evidence FROM runs WHERE id=?").get(run)
          .cost_evidence,
        "COST_ALREADY_RECONCILED",
      );
      this.db
        .prepare("UPDATE runs SET cost_usdc=?,cost_evidence=? WHERE id=?")
        .run(cost, evidence, run);
      this.append(run, "cost-reconciled", { cost, evidence });
    });
  }
  intervention(run, reason, token = null) {
    need(id(reason), "REASON");
    return this.transaction(() => {
      if (!token) {
        const t = crypto.randomUUID();
        this.db
          .prepare("INSERT INTO interventions VALUES(?,?,?,NULL,?)")
          .run(t, run, this.now(), reason);
        this.append(run, "human-start", { token: t, reason });
        return t;
      }
      const r = this.db
        .prepare("SELECT * FROM interventions WHERE id=? AND run_id=?")
        .get(token, run);
      need(r && r.finished === null && this.now() >= r.started, "INTERVENTION");
      const seconds = Math.ceil((this.now() - r.started) / 1000);
      this.db
        .prepare("UPDATE interventions SET finished=? WHERE id=?")
        .run(this.now(), token);
      this.db
        .prepare("UPDATE runs SET human_seconds=human_seconds+? WHERE id=?")
        .run(seconds, run);
      this.append(run, "human-finish", { token, seconds });
      return seconds;
    });
  }
  pendingExecutions() {
    const open = new Map();
    for (const e of this.db
      .prepare(
        "SELECT run_id,kind,payload FROM events WHERE kind IN ('execution','execution-closed') ORDER BY seq",
      )
      .all()) {
      const p = JSON.parse(e.payload);
      if (e.kind === "execution")
        open.set(p.executionId, { run: e.run_id, ...p });
      else open.delete(p.executionId);
    }
    return [...open.values()];
  }
  report() {
    const rows = this.db
        .prepare("SELECT * FROM runs ORDER BY started,id")
        .all(),
      unfinished = this.db
        .prepare("SELECT COUNT(*) n FROM interventions WHERE finished IS NULL")
        .get().n;
    return {
      schema: "agi-workforce-operations/v1",
      runs: rows,
      totalRuns: rows.length,
      complete: rows.filter((x) => x.status === "complete").length,
      unreconciledCosts: rows.filter((x) => x.cost_usdc === null).length,
      openInterventions: unfinished,
      recordedHumanSeconds: rows.reduce((a, x) => a + x.human_seconds, 0),
      traceSha256: this.verify(),
      evidenceKind: "local-runtime-record",
      independent: false,
    };
  }
  close() {
    if (!this.db) return;
    try {
      if (this.owner)
        this.db.prepare("DELETE FROM lease WHERE owner=?").run(this.owner);
    } finally {
      this.db.close();
      this.db = null;
    }
  }
}
