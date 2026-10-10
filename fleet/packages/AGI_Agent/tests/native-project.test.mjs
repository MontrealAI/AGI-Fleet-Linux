import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { nativeV3 } from "./workforce-v3-fixture.mjs";
import { Project, validateProject } from "../workforce/project.mjs";
import { canonical, digest } from "../workforce/core.mjs";
import { nativeRuntime } from "../workforce/runner.mjs";
import { signReceipt } from "../workforce/authority.mjs";
import { seal, recipientId } from "../workforce/envelope.mjs";
import core from "../workforce/core/computer-work.cjs";
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-project-")),
    a = nativeV3(path.join(dir, "a")),
    n = nativeV3(path.join(dir, "n"), "reviewer", a.operator),
    keys = [...a.c.recipientPublicKeys, ...n.c.recipientPublicKeys];
  a.c.recipientPublicKeys = keys;
  n.c.recipientPublicKeys = keys;
  const configs = { agent: a.c, reviewer: n.c },
    spec = structuredClone(a.spec);
  spec.environment.runtimeSha256 = Object.fromEntries(
    Object.entries(configs).map(([r, c]) => [r, core.digest(nativeRuntime(c))]),
  );
  spec.privacy.recipientKeyIds = keys.map(recipientId);
  const stage = {
      id: "draft",
      role: "agent",
      dependencies: [],
      specification: spec,
      inputs: [],
      inputBindings: [],
      reviewOf: null,
    },
    review = {
      id: "validate",
      role: "reviewer",
      dependencies: ["draft"],
      specification: null,
      inputs: [],
      inputBindings: [],
      reviewOf: "draft",
    },
    plan = {
      schema: "agi-native-project/v1",
      title: "Fixture project",
      objective: "Produce and independently verify an artifact",
      mode: "pilot",
      deadline: spec.deadline,
      maxCostUSDC: "20",
      maxConcurrent: 2,
      finalStage: "validate",
      stages: [stage, review],
    };
  return { dir, a, n, configs, plan };
}
function response(p, id, artifact) {
  const state = p.state().stages[id],
    stage = p.plan.stages.find((s) => s.id === id),
    c = p.configs[stage.role],
    s = state.specification,
    encrypted = seal(Buffer.from(canonical(artifact)), c.recipientPublicKeys, {
      specSha256: core.digest(s),
      purpose: stage.role === "agent" ? "delivery" : "review",
      expiresAt: s.deadline + s.privacy.retentionSeconds,
    });
  return {
    encrypted,
    receipt: signReceipt(c, {
      run: "job-" + state.grantSha256,
      grantSha256: state.grantSha256,
      specSha256: core.digest(s),
      runtimeSha256: state.runtimeSha256,
      encryptedSha256: digest(encrypted),
      status: "complete",
      finishedAt: Math.floor(Date.now() / 1000),
    }),
  };
}
function delivery(p, id) {
  const s = p.state().stages[id].specification,
    bytes = Buffer.from('{"value":42}');
  return {
    schema: "agi-work-bundle/v2",
    specHash: core.digest(s),
    files: s.outputs.map((o) => ({
      name: o.name,
      mediaType: o.mediaType,
      bytes: bytes.length,
      sha256: digest(bytes),
      content: bytes.toString("base64"),
    })),
  };
}
function review(p, id, verdict) {
  const stage = p.plan.stages.find((s) => s.id === id),
    s = p.state().stages[id].specification;
  return {
    schema: "agi-native-review/v1",
    specSha256: core.digest(s),
    deliverySha256: digest(p.loadArtifact(stage.reviewOf)),
    verdict,
    review: {
      safeToReview: true,
      checks: s.criteria.map((c) => ({
        id: c.id,
        status: verdict === "approve" ? "pass" : "fail",
        method: "fixture-only recomputation",
        observed: "fixture result",
        files: c.evidence,
      })),
    },
  };
}
test("project dispatches dependencies, independently verifies exact bytes, and retains authority after restart", () => {
  const f = setup();
  let p;
  try {
    p = new Project(path.join(f.dir, "project"), f.plan, f.configs);
    let state = p.tick(f.a.operator.privateKey);
    assert.equal(state.stages.draft.status, "dispatched");
    assert.equal(state.stages.validate.status, "pending");
    const grant = state.stages.draft.grantSha256;
    assert(fs.existsSync(path.join(p.dir, state.stages.draft.outbox)));
    p.close();
    p = new Project(path.join(f.dir, "project"), f.plan, f.configs);
    state = p.tick(f.a.operator.privateKey);
    assert.equal(state.stages.draft.grantSha256, grant);
    p.ingest(
      "draft",
      response(p, "draft", delivery(p, "draft")),
      f.a.recipient.privateKey,
    );
    state = p.tick(f.a.operator.privateKey);
    assert.equal(state.stages.validate.status, "dispatched");
    assert.notEqual(state.stages.validate.grantSha256, grant);
    p.ingest(
      "validate",
      response(p, "validate", review(p, "validate", "approve")),
      f.a.recipient.privateKey,
    );
    state = p.tick(f.a.operator.privateKey);
    assert(state.complete);
    assert(state.finalArtifact);
    assert.equal(p.journal.row(p.run).reserved_cost_usdc, "0.384000");
  } finally {
    p?.close();
    fs.rmSync(f.dir, { recursive: true });
  }
});
test("a rejected independent result routes repair evidence without replaying external effects", () => {
  const f = setup();
  let p;
  try {
    p = new Project(path.join(f.dir, "project"), f.plan, f.configs);
    p.tick(f.a.operator.privateKey);
    p.ingest(
      "draft",
      response(p, "draft", delivery(p, "draft")),
      f.a.recipient.privateKey,
    );
    p.tick(f.a.operator.privateKey);
    p.ingest(
      "validate",
      response(p, "validate", review(p, "validate", "reject")),
      f.a.recipient.privateKey,
    );
    const state = p.tick(f.a.operator.privateKey);
    assert.equal(state.stages.validate.status, "rejected");
    assert(!state.complete);
    assert(fs.existsSync(path.join(p.dir, "repairs/draft.json")));
  } finally {
    p?.close();
    fs.rmSync(f.dir, { recursive: true });
  }
});
test("project rejects forged receipts, wrong delivered-byte reviews, cycles and unfunded complete reservations", () => {
  const f = setup();
  let p;
  try {
    const cycle = structuredClone(f.plan);
    cycle.stages[0].dependencies = ["validate"];
    assert.throws(() => validateProject(cycle), /CYCLE/);
    const low = structuredClone(f.plan);
    low.maxCostUSDC = "0.01";
    assert.throws(
      () => new Project(path.join(f.dir, "low"), low, f.configs),
      /COST_LIMIT/,
    );
    p = new Project(path.join(f.dir, "project"), f.plan, f.configs);
    p.tick(f.a.operator.privateKey);
    const out = response(p, "draft", delivery(p, "draft"));
    out.receipt.body.role = "reviewer";
    assert.throws(
      () => p.ingest("draft", out, f.a.recipient.privateKey),
      /SIGNED_RECORD/,
    );
    p.ingest(
      "draft",
      response(p, "draft", delivery(p, "draft")),
      f.a.recipient.privateKey,
    );
    p.tick(f.a.operator.privateKey);
    const bad = review(p, "validate", "approve");
    bad.deliverySha256 = "0".repeat(64);
    assert.throws(
      () =>
        p.ingest(
          "validate",
          response(p, "validate", bad),
          f.a.recipient.privateKey,
        ),
      /DELIVERY_REVIEW/,
    );
  } finally {
    p?.close();
    fs.rmSync(f.dir, { recursive: true });
  }
});
test("downstream input binding requires an independent review dependency and rejects missing file provenance", () => {
  const f = setup();
  try {
    const child = {
      ...structuredClone(f.plan.stages[0]),
      id: "integrate",
      dependencies: ["draft"],
      inputBindings: [
        { name: "source.json", fromStage: "draft", file: "result.json" },
      ],
    };
    f.plan.stages.push(child);
    assert.throws(() => validateProject(f.plan), /UNREVIEWED_INPUT/);
    child.dependencies.push("validate");
    assert.equal(validateProject(f.plan), f.plan);
  } finally {
    fs.rmSync(f.dir, { recursive: true });
  }
});
test("a four-stage project binds independently accepted upstream files into the next exact grant", () => {
  const f = setup();
  let p;
  try {
    const template = structuredClone(f.plan.stages[0].specification);
    template.inputs = [
      {
        name: "source.json",
        mediaType: template.outputs[0].mediaType,
        uri: "agi-local://project/source.json",
        sha256: "0".repeat(64),
        maxBytes: 8192,
      },
    ];
    f.plan.stages.push(
      {
        id: "integrate",
        role: "agent",
        dependencies: ["draft", "validate"],
        specification: template,
        inputs: [],
        inputBindings: [
          {
            name: "source.json",
            fromStage: "draft",
            file: template.outputs[0].name,
          },
        ],
        reviewOf: null,
      },
      {
        id: "final",
        role: "reviewer",
        dependencies: ["integrate"],
        specification: null,
        inputs: [],
        inputBindings: [],
        reviewOf: "integrate",
      },
    );
    f.plan.finalStage = "final";
    p = new Project(path.join(f.dir, "project"), f.plan, f.configs);
    p.tick(f.a.operator.privateKey);
    const original = delivery(p, "draft");
    p.ingest("draft", response(p, "draft", original), f.a.recipient.privateKey);
    p.tick(f.a.operator.privateKey);
    assert.equal(p.state().stages.integrate.status, "pending");
    p.ingest(
      "validate",
      response(p, "validate", review(p, "validate", "approve")),
      f.a.recipient.privateKey,
    );
    p.tick(f.a.operator.privateKey);
    const child = p.state().stages.integrate;
    assert.equal(child.status, "dispatched");
    assert.equal(
      child.specification.inputs[0].sha256,
      original.files[0].sha256,
    );
    p.ingest(
      "integrate",
      response(p, "integrate", delivery(p, "integrate")),
      f.a.recipient.privateKey,
    );
    p.tick(f.a.operator.privateKey);
    p.ingest(
      "final",
      response(p, "final", review(p, "final", "approve")),
      f.a.recipient.privateKey,
    );
    assert(p.tick(f.a.operator.privateKey).complete);
  } finally {
    p?.close();
    fs.rmSync(f.dir, { recursive: true });
  }
});
