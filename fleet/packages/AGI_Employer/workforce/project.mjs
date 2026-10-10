import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  need,
  exact,
  id,
  hash,
  integer,
  canonical,
  digest,
  money,
  moneyText,
  privateDir,
  readFile,
  readSecret,
  atomic,
  Journal,
} from "./core.mjs";
import {
  nativeRuntime,
  validateConfig,
  validatePacket,
  validateDelivery,
  reviewVerdict,
  grantBody,
  signGrant,
  checkGrant,
} from "./runner.mjs";
import { seal, open, recipientId } from "./envelope.mjs";
import { verifyReceipt } from "./authority.mjs";
import core from "./core/computer-work.cjs";
import capacity from "./core/capacity-plan.cjs";
import { args } from "./cli.mjs";
const read = (f) => JSON.parse(readFile(path.resolve(f), 134217728));
export function validateProject(p) {
  exact(p, [
    "schema",
    "title",
    "objective",
    "mode",
    "deadline",
    "maxCostUSDC",
    "maxConcurrent",
    "finalStage",
    "stages",
  ]);
  need(
    p.schema === "agi-native-project/v1" &&
      typeof p.title === "string" &&
      p.title.length > 0 &&
      p.title.length <= 160 &&
      typeof p.objective === "string" &&
      p.objective.length > 0 &&
      p.objective.length <= 12000 &&
      ["pilot", "production"].includes(p.mode) &&
      integer(p.deadline, 1, Number.MAX_SAFE_INTEGER) &&
      integer(p.maxConcurrent, 1, 2),
    "PROJECT",
  );
  money(p.maxCostUSDC);
  need(
    Array.isArray(p.stages) && p.stages.length > 0 && p.stages.length <= 64,
    "STAGES",
  );
  const by = new Map();
  for (const s of p.stages) {
    exact(s, [
      "id",
      "role",
      "dependencies",
      "specification",
      "inputs",
      "inputBindings",
      "reviewOf",
    ]);
    need(
      id(s.id) &&
        !by.has(s.id) &&
        ["agent", "reviewer"].includes(s.role) &&
        Array.isArray(s.dependencies) &&
        new Set(s.dependencies).size === s.dependencies.length &&
        Array.isArray(s.inputs) &&
        Array.isArray(s.inputBindings),
      "STAGE",
    );
    by.set(s.id, s);
    if (s.role === "agent") {
      need(s.reviewOf === null, "REVIEW_LINK");
      core.validateComputerWork(s.specification);
      need(
        s.specification.profile === "computer-work/v3",
        "PROJECT_V3_REQUIRED",
      );
    } else
      need(
        s.specification === null &&
          s.inputs.length === 0 &&
          s.inputBindings.length === 0 &&
          id(s.reviewOf),
        "REVIEW_LINK",
      );
  }
  for (const s of p.stages) {
    need(
      s.dependencies.every((d) => by.has(d) && d !== s.id),
      "DEPENDENCY",
    );
    if (s.role === "reviewer")
      need(
        s.dependencies.includes(s.reviewOf) &&
          by.get(s.reviewOf)?.role === "agent",
        "REVIEW_LINK",
      );
    for (const b of s.inputBindings) {
      exact(b, ["name", "fromStage", "file"]);
      core.safeName(b.name);
      core.safeName(b.file);
      need(
        s.dependencies.includes(b.fromStage) &&
          by.get(b.fromStage)?.role === "agent",
        "INPUT_DEPENDENCY",
      );
      need(
        s.dependencies.some(
          (d) =>
            by.get(d)?.role === "reviewer" &&
            by.get(d).reviewOf === b.fromStage,
        ),
        "UNREVIEWED_INPUT",
      );
    }
  }
  const seen = new Set(),
    active = new Set();
  function visit(id) {
    need(!active.has(id), "PROJECT_CYCLE");
    if (seen.has(id)) return;
    active.add(id);
    for (const d of by.get(id).dependencies) visit(d);
    active.delete(id);
    seen.add(id);
  }
  for (const s of p.stages) visit(s.id);
  need(by.get(p.finalStage)?.role === "reviewer", "FINAL_INDEPENDENT_REVIEW");
  return p;
}
export function reservation(c) {
  return (
    money(c.costPolicy.modelCallReserveUSDC) * BigInt(c.limits.maxModelCalls) +
    money(c.costPolicy.actionReserveUSDC) * BigInt(c.limits.maxActions) +
    money(c.costPolicy.fixedRunReserveUSDC)
  );
}
export function projectSchedule(plan, state, now) {
  return capacity.projectWindow(plan.stages.map(s => {
    const spec = s.role === 'agent' ? s.specification : plan.stages.find(x => x.id === s.reviewOf).specification;
    return {id:s.id,role:s.role,dependencies:s.dependencies,workSeconds:spec.budget[s.role === 'agent' ? 'maxAgentSeconds' : 'maxReviewSeconds'],deadline:spec.deadline,complete:state?.stages[s.id]?.status === 'complete'};
  }), {now:Math.floor(now / 1000),deadline:plan.deadline,maxConcurrent:plan.maxConcurrent});
}
export class Project {
  constructor(dir, plan, configs, { now = Date.now } = {}) {
    this.plan = validateProject(plan);
    this.configs = configs;
    this.now = now;
    this.dir = privateDir(path.resolve(dir));
    this.hash = digest(plan);
    this.run = "project-" + this.hash;
    for (const role of ["agent", "reviewer"]) {
      validateConfig(configs[role]);
      need(
        configs[role].role === role && configs[role].receiptPublicKey,
        "PROJECT_RUNTIME",
      );
    }
    need(
      configs.agent.nodeId !== configs.reviewer.nodeId &&
        configs.agent.receiptPublicKey !== configs.reviewer.receiptPublicKey,
      "PROJECT_DISTINCT_REVIEWER",
    );
    this.binding = digest(
      Object.fromEntries(
        Object.entries(configs).map(([role, c]) => [
          role,
          core.digest(nativeRuntime(c)),
        ]),
      ),
    );
    const total = plan.stages.reduce(
      (a, s) => a + reservation(configs[s.role]),
      0n,
    );
    need(total <= money(plan.maxCostUSDC), "PROJECT_COST_LIMIT");
    this.journal = new Journal(this.dir, { now, recover: false });
    try {
      const r = this.journal.row(this.run);
      if (!r) projectSchedule(plan, null, this.now());
      if (!r)
        this.journal.start(
          this.run,
          this.hash,
          this.binding,
          "agent",
          plan.mode,
          1000,
          moneyText(total),
          plan.maxCostUSDC,
        );
      else
        need(
          r.spec_hash === this.hash && r.runtime_hash === this.binding,
          "PROJECT_CHANGED",
        );
      if (!this.state())
        this.save({
          stages: Object.fromEntries(
            plan.stages.map((s) => [s.id, { status: "pending" }]),
          ),
          reservedCostUSDC: moneyText(total),
          complete: false,
        });
    } catch (e) {
      this.close();
      throw e;
    }
  }
  state() {
    const r = this.journal.db
      .prepare(
        "SELECT payload FROM events WHERE run_id=? AND kind='project-state' ORDER BY seq DESC LIMIT 1",
      )
      .get(this.run);
    return r ? JSON.parse(r.payload) : null;
  }
  save(state) {
    this.journal.append(this.run, "project-state", state);
  }
  loadArtifact(stageId) {
    const s = this.state().stages[stageId];
    need(s?.status === "complete" && s.artifact, "STAGE_NOT_COMPLETE");
    return read(path.join(this.dir, s.artifact));
  }
  prepareStage(stage, state, key) {
    const c = this.configs[stage.role];
    need(
      crypto.createPublicKey(key).export({ type: "spki", format: "pem" }) ===
        c.operatorPublicKey,
      "PROJECT_SIGNER",
    );
    let spec,
      inputs,
      delivery = null;
    if (stage.role === "reviewer") {
      const upstream = state.stages[stage.reviewOf];
      spec = upstream.specification;
      inputs = read(path.join(this.dir, upstream.packetRecord)).inputs;
      delivery = this.loadArtifact(stage.reviewOf);
      validateDelivery(spec, delivery);
    } else {
      spec = structuredClone(stage.specification);
      inputs = structuredClone(stage.inputs);
      const bound = new Set();
      for (const b of stage.inputBindings) {
        need(!bound.has(b.name), "DUPLICATE_BINDING");
        bound.add(b.name);
        const source = this.loadArtifact(b.fromStage),
          file = source.files.find((f) => f.name === b.file),
          declared = spec.inputs.find((f) => f.name === b.name);
        need(
          file &&
            declared &&
            file.bytes <= declared.maxBytes &&
            file.mediaType === declared.mediaType,
          "BOUND_INPUT",
        );
        declared.sha256 = file.sha256;
        declared.uri = "agi-local://project/" + b.name;
        inputs = inputs.filter((f) => f.name !== b.name);
        inputs.push({ name: b.name, content: file.content });
      }
      inputs = spec.inputs.map((f) => {
        const matches = inputs.filter((x) => x.name === f.name);
        need(matches.length === 1, "INPUT_BINDING");
        return matches[0];
      });
      spec.coordination = {
        parentSpecSha256: this.hash,
        dependencies: [
          ...new Set(
            stage.dependencies.map((d) =>
              core.digest(state.stages[d].specification),
            ),
          ),
        ],
        delegation: "separately-admitted",
      };
      need(spec.deadline <= this.plan.deadline, "PROJECT_DEADLINE");
    }
    core.checkRuntime(
      spec,
      nativeRuntime(c),
      stage.role,
      Math.floor(this.now() / 1000),
    );
    const body = grantBody(c, spec, {
        mode: this.plan.mode,
        now: Math.floor(this.now() / 1000),
        delivery,
      }),
      grant = signGrant(body, key);
    checkGrant(c, spec, grant, {
      now: Math.floor(this.now() / 1000),
      delivery,
    });
    const packet = validatePacket({
      schema: "agi-native-job/v1",
      specification: spec,
      grant,
      inputs,
      delivery,
    });
    const encrypted = seal(
      Buffer.from(canonical(packet)),
      c.recipientPublicKeys,
      {
        specSha256: core.digest(spec),
        purpose: "job",
        expiresAt: body.expiresAt,
      },
    );
    const packetRecord = stage.id + ".packet.json",
      outbox = "outbox/" + stage.role + "/" + stage.id + ".encrypted.json";
    const staged = "staged/" + stage.id + ".json";
    atomic(path.join(this.dir, packetRecord), packet);
    atomic(path.join(this.dir, staged), encrypted);
    return {
      status: "dispatched",
      specification: spec,
      grantSha256: digest(body),
      packetRecord,
      outbox,
      staged,
      exported: false,
      runtimeSha256: core.digest(nativeRuntime(c)),
      dispatchedAt: this.now(),
    };
  }
  tick(key) {
    const state = this.state();
    need(this.now() < this.plan.deadline * 1000, "PROJECT_EXPIRED");
    if (!Object.values(state.stages).some(s => ["rejected", "uncertain", "repair-required", "blocked"].includes(s.status)))
      projectSchedule(this.plan, state, this.now());
    let active = Object.values(state.stages).filter(
      (s) => s.status === "dispatched",
    ).length;
    const occupied = new Set(
      this.plan.stages
        .filter((s) => state.stages[s.id].status === "dispatched")
        .map((s) => s.role),
    );
    for (const s of this.plan.stages) {
      const current = state.stages[s.id];
      if (current.status !== "pending") continue;
      if (
        s.dependencies.some((d) =>
          ["rejected", "uncertain", "repair-required", "blocked"].includes(
            state.stages[d].status,
          ),
        )
      ) {
        state.stages[s.id] = {
          status: "blocked",
          reason: "DEPENDENCY_REQUIRES_REPAIR",
        };
        continue;
      }
      if (
        active >= this.plan.maxConcurrent ||
        occupied.has(s.role) ||
        !s.dependencies.every((d) => state.stages[d].status === "complete")
      )
        continue;
      // Persist the exact packet before exposing it to the separately transported queue.
      state.stages[s.id] = this.prepareStage(s, state, key);
      this.save(state);
      active++;
      occupied.add(s.role);
    }
    // A crash can re-export only the same journaled grant, never issue a new one.
    for (const s of Object.values(state.stages))
      if (s.status === "dispatched" && !s.exported) {
        atomic(
          path.join(this.dir, s.outbox),
          readFile(path.join(this.dir, s.staged), 134217728).toString("utf8"),
        );
        s.exported = true;
        this.save(state);
      }
    state.complete = this.plan.stages.every(
      (s) => state.stages[s.id].status === "complete",
    );
    if (state.complete) {
      const final = this.plan.stages.find((s) => s.id === this.plan.finalStage);
      state.finalArtifact = state.stages[final.reviewOf].artifact;
    }
    this.save(state);
    if (state.complete && this.journal.row(this.run).status === "running")
      this.journal.finish(this.run, "complete");
    return state;
  }
  ingest(stageId, bundle, recipientKey) {
    const state = this.state(),
      stage = this.plan.stages.find((s) => s.id === stageId),
      current = state.stages[stageId];
    need(stage && current?.status === "dispatched", "STAGE_STATE");
    exact(bundle, ["receipt", "encrypted"]);
    const c = this.configs[stage.role],
      s = current.specification;
    const receipt = verifyReceipt(c, bundle.receipt, {
      grantSha256: current.grantSha256,
      specSha256: core.digest(s),
      runtimeSha256: current.runtimeSha256,
      encryptedSha256: digest(bundle.encrypted),
    });
    need(
      receipt.finishedAt * 1000 >= current.dispatchedAt - 1000 &&
        receipt.finishedAt <= this.plan.deadline,
      "STAGE_RECEIPT_TIME",
    );
    const expected = {
      specSha256: core.digest(s),
      purpose: stage.role === "agent" ? "delivery" : "review",
      expiresAt: s.deadline + s.privacy.retentionSeconds,
    };
    const artifact = JSON.parse(open(bundle.encrypted, recipientKey, expected));
    if (stage.role === "agent") {
      validateDelivery(s, artifact);
      need(receipt.status === "complete", "DELIVERY_STATUS");
    } else {
      const prior = this.loadArtifact(stage.reviewOf);
      need(
        artifact.schema === "agi-native-review/v1" &&
          artifact.specSha256 === core.digest(s) &&
          artifact.deliverySha256 === digest(prior) &&
          ["approve", "reject", "abstain"].includes(artifact.verdict) &&
          reviewVerdict(s, artifact.review) === artifact.verdict,
        "INDEPENDENT_DELIVERY_REVIEW",
      );
    }
    const file = "artifacts/" + stageId + ".json";
    atomic(path.join(this.dir, file), artifact);
    atomic(
      path.join(this.dir, "receipts/" + stageId + ".json"),
      bundle.receipt,
    );
    current.artifact = file;
    current.receiptSha256 = digest(bundle.receipt);
    current.status =
      stage.role === "agent" || artifact.verdict === "approve"
        ? "complete"
        : artifact.verdict === "reject"
          ? "rejected"
          : "uncertain";
    if (current.status === "rejected") {
      const repair = {
        schema: "agi-project-repair/v1",
        projectSha256: this.hash,
        stage: stage.reviewOf,
        review: artifact,
        priorGrantSha256: state.stages[stage.reviewOf].grantSha256,
        authority:
          "Fresh separately admitted repair required; no uncertain external action is replayed.",
      };
      atomic(
        path.join(this.dir, "repairs/" + stage.reviewOf + ".json"),
        repair,
      );
    }
    this.save(state);
    return state;
  }
  close() {
    this.journal?.close();
  }
}
export async function main(argv = process.argv.slice(2)) {
  const { command, out: a } = args(argv);
  if (command === "help") {
    console.log(
      "workforce:project -- init --spec SPEC --inputs INPUT_DIR --configs ROLE_CONFIG_PATHS --out PLAN --max-cost USDC\nworkforce:project -- tick|ingest|status|watch --plan PLAN --configs ROLE_CONFIG_PATHS --dir PRIVATE_DIR [--signing-key KEY] [--stage ID --result TRANSFERRED_BUNDLE --recipient-key KEY]",
    );
    return;
  }
  const paths = read(a.configs),
    configs = Object.fromEntries(
      ["agent", "reviewer"].map((r) => [
        r,
        JSON.parse(readSecret(path.resolve(paths[r]))),
      ]),
    );
  if (command === "init") {
    const spec = core.validateComputerWork(read(a.spec));
    need(spec.profile === "computer-work/v3", "PROJECT_V3_REQUIRED");
    const inputs = spec.inputs.map((f) => {
      const b = readFile(path.resolve(a.inputs, f.name), f.maxBytes);
      need(digest(b) === f.sha256, "INPUT_HASH");
      return { name: f.name, content: b.toString("base64") };
    });
    const plan = {
      schema: "agi-native-project/v1",
      title: spec.title,
      objective: spec.prompt,
      mode: a.mode ?? "pilot",
      deadline: spec.deadline,
      maxCostUSDC: a["max-cost"],
      maxConcurrent: 2,
      finalStage: "validate",
      stages: [
        {
          id: "work",
          role: "agent",
          dependencies: [],
          specification: spec,
          inputs,
          inputBindings: [],
          reviewOf: null,
        },
        {
          id: "validate",
          role: "reviewer",
          dependencies: ["work"],
          specification: null,
          inputs: [],
          inputBindings: [],
          reviewOf: "work",
        },
      ],
    };
    validateProject(plan);
    need(a.out, "OUTPUT_REQUIRED");
    atomic(path.resolve(a.out), plan);
    console.log(
      JSON.stringify({
        plan: a.out,
        authority: "NONE until a bounded signing operator dispatches the plan",
      }),
    );
    return;
  }
  const p = new Project(a.dir, read(a.plan), configs);
  try {
    if (command === "status") console.log(JSON.stringify(p.state(), null, 2));
    else if (command === "tick")
      console.log(
        JSON.stringify(
          p.tick(readSecret(path.resolve(a["signing-key"]))),
          null,
          2,
        ),
      );
    else if (command === "ingest")
      console.log(
        JSON.stringify(
          p.ingest(
            a.stage,
            read(a.result),
            readSecret(path.resolve(a["recipient-key"])),
          ),
          null,
          2,
        ),
      );
    else if (command === "watch") {
      const key = readSecret(path.resolve(a["signing-key"])),
        recipient = readSecret(path.resolve(a["recipient-key"]));
      let stopped = false;
      for (const s of ["SIGTERM", "SIGINT"])
        process.on(s, () => {
          stopped = true;
        });
      const inbox = privateDir(path.join(p.dir, "inbox"));
      while (!stopped) {
        for (const s of p.plan.stages) {
          const f = path.join(inbox, s.id + ".json");
          if (
            fs.existsSync(f) &&
            p.state().stages[s.id].status === "dispatched"
          ) {
            p.ingest(s.id, read(f), recipient);
            fs.renameSync(f, f + ".accepted");
          }
        }
        const state = p.tick(key);
        if (state.complete) {
          console.log(
            JSON.stringify({
              complete: true,
              finalArtifact: state.finalArtifact,
            }),
          );
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } else throw Error("WORKFORCE_PROJECT_COMMAND");
  } finally {
    p.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
