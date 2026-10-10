import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
test("single writer and persisted signed intent survive restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-store-"));
  let s = new Store(dir);
  try {
    assert.throws(() => new Store(dir), /NODE_ALREADY_RUNNING/);
    s.putJob("1", { status: "reviewed" });
    s.reserve({
      hash: "h",
      raw: "private raw",
      nonce: 0,
      kind: "vote",
      job: "1",
      decision: "approve",
      context: "ctx",
      bond: "100",
      gas_budget: "200",
      created: 100,
    });
    assert.throws(() =>
      s.reserve({
        hash: "h2",
        raw: "r",
        nonce: 1,
        kind: "claim",
        gas_budget: "1",
        created: 100,
      }),
    );
    s.close();
    s = new Store(dir);
    assert.equal(s.pending().context, "ctx");
    assert.equal(s.recent(100000).length, 1);
    assert.equal(JSON.stringify(s.snapshot()).includes("private raw"), false);
    s.markReceipt(
      "h",
      { blockHash: "block", blockNumber: 1, status: 1 },
      100001,
    );
    assert.equal(s.job("1").my_vote, 1);
    assert.equal(s.pending(), undefined);
    assert.equal(s.recent(100002).length, 1);
    assert.equal(s.recent(200000).length, 0);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("atomic event checkpoint rollback preserves earlier state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-store-")),
    s = new Store(dir);
  try {
    assert.throws(() =>
      s.transaction(() => {
        s.putJob("9", { status: "queued" });
        s.set("cursor", { number: 5 });
        throw new Error("interrupted");
      }),
    );
    assert.equal(s.job("9"), undefined);
    assert.equal(s.meta("cursor"), null);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
