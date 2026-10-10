import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fixture } from "./workforce-fixture.mjs";
import { nativeRuntime } from "../workforce/runner.mjs";
import {
  createBenchmark,
  prepareBenchmark,
  runBenchmark,
  scoreBenchmark,
} from "../workforce/benchmark.mjs";
import { canonical, digest } from "../workforce/core.mjs";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agi-benchmark-"));
test("frozen corpus separates the oracle from worker cases and includes plausible invalid deliveries", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    const out = path.join(d, "corpus"),
      o = createBenchmark(nativeRuntime(f.c), nativeRuntime(f.c), out, {
        groups: 2,
      });
    assert.equal(o.plan.cases.length, 12);
    assert.equal(o.plan.cases.filter((x) => !x.expectedValid).length, 4);
    for (const c of o.plan.cases) {
      const text = fs.readFileSync(
        path.join(out, "cases", c.id, "case.json"),
        "utf8",
      );
      assert(!text.includes("expectedValid"));
      assert(!text.includes('"partition"'));
      assert(o.truth[c.id]);
    }
    assert.notEqual(o.plan.cases[0].group, o.plan.cases.at(-1).group);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
test("benchmark preparation signs in a separate account and native runners only receive encrypted grants", async () => {
  const d = tmp(),
    f = fixture(d);
  try {
    const out = path.join(d, "corpus");
    createBenchmark(nativeRuntime(f.c), nativeRuntime(f.c), out, { groups: 1 });
    const packets = path.join(d, "packets");
    assert.equal(
      prepareBenchmark(
        f.c,
        path.join(out, "cases"),
        f.operator.privateKey,
        packets,
      ).packets,
      2,
    );
    let calls = 0;
    const artifact = path.join(d, "ciphertext.json");
    fs.writeFileSync(artifact, '{"fixture":"encrypted-test-only"}');
    const results = path.join(d, "results");
    await runBenchmark(f.c, packets, f.recipient.privateKey, results, {
      runner: async (c, p) => {
        calls++;
        assert.equal(p.grant.body.role, "agent");
        return {
          run: "job-" + digest(p.grant.body),
          status: "complete",
          output: artifact,
        };
      },
    });
    await runBenchmark(f.c, packets, f.recipient.privateKey, results, {
      runner: () => assert.fail("completed records must not rerun"),
    });
    assert.equal(calls, 2);
    for (const name of fs
      .readdirSync(results)
      .filter((n) => n.endsWith(".json"))) {
      const r = JSON.parse(fs.readFileSync(path.join(results, name)));
      assert.equal(r.result.output, r.caseId + ".encrypted");
      assert.equal(
        fs.readFileSync(path.join(results, r.result.output), "utf8"),
        fs.readFileSync(artifact, "utf8"),
      );
    }
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
test("scoring preserves failed and unbilled runs and never invents receipts", () => {
  const d = tmp(),
    f = fixture(d);
  try {
    const out = path.join(d, "corpus"),
      o = createBenchmark(nativeRuntime(f.c), nativeRuntime(f.c), out, {
        groups: 1,
      }),
      records = o.plan.cases.map((c) => ({
        caseId: c.id,
        specSha256: c.specSha256,
        runtimeSha256: c.runtimeSha256,
        result: { run: "r-" + c.id, status: "failed" },
      })),
      operation = {
        runs: [],
        openInterventions: 0,
        traceSha256: "a".repeat(64),
      };
    const scored = scoreBenchmark(o, records, [operation], () => assert.fail());
    assert.equal(scored.ledger.engagements.length, 6);
    assert(
      scored.ledger.engagements.every(
        (x) => x.costUSDC === null && x.receiptsUSDC === "0",
      ),
    );
    assert(
      Object.values(scored.report.totals).every((x) => x.netUSDC === null),
    );
    assert.throws(
      () => scoreBenchmark(o, records.slice(1), [operation], () => {}),
      /MISSING/,
    );
    operation.openInterventions = 1;
    assert.throws(
      () => scoreBenchmark(o, records, [operation], () => {}),
      /INTERVENTIONS/,
    );
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
