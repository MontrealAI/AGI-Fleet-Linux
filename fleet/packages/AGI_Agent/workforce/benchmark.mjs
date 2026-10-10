import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  need,
  readFile,
  readSecret,
  privateDir,
  atomic,
  canonical,
  digest,
  Journal,
  integer,
} from "./core.mjs";
import { args } from "./cli.mjs";
import {
  validateConfig,
  grantBody,
  signGrant,
  runNative,
  validateDelivery,
} from "./runner.mjs";
import { open, seal } from "./envelope.mjs";
import core from "./core/computer-work.cjs";
import { capabilityReport } from "./core/capability-report.cjs";
const read = (f) => JSON.parse(readFile(path.resolve(f), 134217728));
const specHash = (s) => core.digest(s);
export function createBenchmark(
  agent,
  reviewer,
  dir,
  { groups = 4, now = Math.floor(Date.now() / 1000) } = {},
) {
  need(integer(groups, 1, 100), "GROUPS");
  privateDir(dir);
  need(fs.readdirSync(dir).length === 0, "DIRECTORY_MUST_BE_EMPTY");
  const plan = { schemaVersion: 1, cases: [] },
    truth = {};
  for (const partition of ["calibration", "evaluation"])
    for (let group = 0; group < groups; group++)
      for (const [role, valid] of [
        ["agent", true],
        ["reviewer", true],
        ["reviewer", false],
      ]) {
        const id = crypto.randomUUID(),
          rows = Array.from({ length: 4 + (group % 3) }, (_, i) => ({
            id: "r" + (i + 1),
            cents: crypto.randomInt(100, 100000),
          })),
          source =
            "row_id,amount_cents,currency\n" +
            rows.map((x) => x.id + "," + x.cents + ",CAD").join("\n") +
            "\n",
          expected = {
            totalCents: rows.reduce((a, x) => a + x.cents, 0),
            rowIds: rows.map((x) => x.id),
            currency: "CAD",
          };
        const s = {
          schema: "agi-node-job/v1",
          profile: "computer-work/v2",
          title: "Reconcile an account export",
          prompt:
            "Reconcile the synthetic source.csv export. Produce result.json with numeric integer totalCents, all rowIds sorted in source order, and currency CAD. Open and independently inspect the actual result. This is a commissioning example, not customer evidence.",
          dataPolicy: "scoped",
          inputs: [
            {
              name: "source.csv",
              mediaType: "text/csv",
              uri: "https://example.invalid/commissioning/" + id,
              sha256: digest(source),
              maxBytes: 8192,
            },
          ],
          outputs: [
            {
              name: "result.json",
              mediaType: "application/json",
              maxBytes: 8192,
              requirement:
                "Exact decimal-safe reconciliation with complete source lineage.",
            },
          ],
          criteria: [
            {
              id: "total",
              requirement: "Total every amount_cents exactly as integers.",
              verification: "Recompute the sum from the original CSV.",
              evidence: ["result.json"],
            },
            {
              id: "lineage",
              requirement:
                "Preserve all row identifiers exactly once in source order.",
              verification:
                "Compare the rowIds array against every source row.",
              evidence: ["result.json"],
            },
            {
              id: "currency",
              requirement:
                "Preserve the CAD currency without converting or relabeling it.",
              verification: "Inspect the original and delivered currency.",
              evidence: ["result.json"],
            },
          ],
          environment: {
            runtimeSha256: {
              agent: core.digest(agent),
              reviewer: core.digest(reviewer),
            },
            capabilities: {
              agent: ["desktop", "files"],
              reviewer: ["desktop", "files", "independent-review"],
            },
          },
          authority: {
            agent: { scope: "dedicated-account", resources: agent.resources },
            reviewer: {
              scope: "dedicated-account",
              resources: reviewer.resources,
            },
          },
          budget: {
            maxAgentSeconds: Math.min(agent.maxTaskSeconds, 600),
            maxReviewSeconds: Math.min(reviewer.maxTaskSeconds, 600),
            maxAgentCostUSDC: "5",
            maxReviewCostUSDC: "5",
          },
          deadline: now + 604800,
          settlement: {
            chainId: 31337,
            manager: "0x" + "1".repeat(40),
            recovery:
              "This rehearsal sends no transactions; preserve failure, cost and human-time records.",
          },
          coordination: {
            parentSpecSha256: null,
            dependencies: [],
            delegation: "none",
          },
        };
        core.checkRuntime(s, role === "agent" ? agent : reviewer, role, now);
        let delivery = null;
        if (role === "reviewer") {
          const answer = structuredClone(expected);
          if (!valid) {
            if (group % 3 === 0) answer.totalCents++;
            else if (group % 3 === 1) answer.rowIds.pop();
            else answer.currency = "USD";
          }
          const content = Buffer.from(canonical(answer));
          delivery = {
            schema: "agi-work-bundle/v2",
            specHash: specHash(s),
            files: [
              {
                name: "result.json",
                mediaType: "application/json",
                bytes: content.length,
                sha256: digest(content),
                content: content.toString("base64"),
              },
            ],
          };
        }
        const caseDir = path.join(dir, "cases", id);
        privateDir(caseDir);
        atomic(path.join(caseDir, "case.json"), {
          schema: "agi-benchmark-case/v1",
          id,
          role,
          specification: s,
          inputs: [
            {
              name: "source.csv",
              content: Buffer.from(source).toString("base64"),
            },
          ],
          delivery,
        });
        plan.cases.push({
          id,
          partition,
          group: partition + "-" + id,
          role,
          expectedValid: valid,
          deliverySha256: delivery ? digest(delivery) : null,
          specSha256: specHash(s),
          runtimeSha256: s.environment.runtimeSha256[role],
        });
        truth[id] = expected;
      }
  const oracle = {
    schema: "agi-benchmark-oracle/v1",
    plan,
    truth,
    measurementKind: "unmeasured",
    scope:
      "Synthetic account reconciliation only. The independent oracle keeps this file off both worker machines. Do not use this corpus as universal capability or customer-economics evidence.",
  };
  atomic(path.join(dir, "ORACLE_DO_NOT_SEND_TO_WORKERS.json"), oracle);
  return oracle;
}
export function prepareBenchmark(c, casesDir, signingKey, out) {
  privateDir(out);
  let count = 0;
  for (const name of fs.readdirSync(casesDir).sort()) {
    need(/^[a-f0-9-]{36}$/.test(name), "CASE_ID");
    const item = read(path.join(casesDir, name, "case.json"));
    if (item.role !== c.role) continue;
    need(item.schema === "agi-benchmark-case/v1" && item.id === name, "CASE");
    const file = path.join(out, name + ".json");
    need(!fs.existsSync(file), "PACKET_EXISTS");
    const body = grantBody(c, item.specification, { delivery: item.delivery }),
      grant = signGrant(body, signingKey),
      packet = {
        schema: "agi-native-job/v1",
        specification: item.specification,
        inputs: item.inputs,
        delivery: item.delivery,
        grant,
      };
    atomic(
      file,
      seal(Buffer.from(canonical(packet)), c.recipientPublicKeys, {
        specSha256: body.specSha256,
        purpose: "job",
        expiresAt: body.expiresAt,
      }),
    );
    count++;
  }
  return { packets: count, directory: out };
}
export async function runBenchmark(
  c,
  packetsDir,
  recipientKey,
  out,
  { runner = runNative } = {},
) {
  privateDir(out);
  for (const name of fs.readdirSync(packetsDir).sort()) {
    need(/^[a-f0-9-]{36}\.json$/.test(name), "CASE_ID");
    const id = name.slice(0, -5),
      resultFile = path.join(out, name);
    if (fs.existsSync(resultFile)) continue;
    const encrypted = read(path.join(packetsDir, name));
    need(encrypted.header?.context?.purpose === "job", "JOB_ENVELOPE");
    const packet = JSON.parse(
      open(encrypted, recipientKey, encrypted.header.context),
    );
    need(
      specHash(packet.specification) === encrypted.header.context.specSha256,
      "ENVELOPE_SPEC",
    );
    let record;
    try {
      const result = await runner(c, packet, { resumeKey: recipientKey });
      // Keep the encrypted artifact beside the result so the entire directory
      // can be transferred to an independent oracle without rewriting Mac paths.
      if (result.status === "complete") {
        const relative = id + ".encrypted";
        atomic(
          path.join(out, relative),
          readFile(result.output, 134217728).toString("utf8"),
        );
        result.output = relative;
      }
      record = {
        caseId: id,
        specSha256: specHash(packet.specification),
        runtimeSha256: packet.specification.environment.runtimeSha256[c.role],
        result,
      };
    } catch (e) {
      record = {
        caseId: id,
        specSha256: specHash(packet.specification),
        runtimeSha256: packet.specification.environment.runtimeSha256[c.role],
        result: {
          run: "job-" + digest(packet.grant.body),
          status: "failed",
          error: /^(WORKFORCE|COMPUTER|EXECUTION)_/.test(e.message)
            ? e.message
            : "RUNTIME_FAILED",
        },
      };
    }
    atomic(resultFile, record);
  }
  return { results: out };
}
export function scoreBenchmark(oracle, records, operations, decryptResult) {
  need(
    oracle?.schema === "agi-benchmark-oracle/v1" &&
      operations.every((o) => o.openInterventions === 0),
    "ORACLE_OR_OPEN_INTERVENTIONS",
  );
  const runs = new Map(
      operations.flatMap((o) =>
        o.runs.map((r) => [r.id, { ...r, trace: o.traceSha256 }]),
      ),
    ),
    results = new Map();
  for (const r of records) {
    need(!results.has(r.caseId), "DUPLICATE_CASE");
    results.set(r.caseId, r);
  }
  const engagements = [];
  for (const c of oracle.plan.cases) {
    const r = results.get(c.id);
    need(
      r && r.specSha256 === c.specSha256 && r.runtimeSha256 === c.runtimeSha256,
      "MISSING_OR_CHANGED_CASE",
    );
    const operation = runs.get(r.result.run);
    let useful = false,
      verdict = c.role === "reviewer" ? "abstain" : null,
      status =
        r.result.status === "complete"
          ? "complete"
          : ["declined", "uncertain"].includes(r.result.status)
            ? "declined"
            : "failed";
    if (status === "complete") {
      need(
        operation &&
          operation.status === "complete" &&
          operation.spec_hash === c.specSha256 &&
          operation.runtime_hash === c.runtimeSha256 &&
          operation.role === c.role &&
          operation.finished >= operation.started,
        "RUN_RECORD",
      );
      const output = decryptResult(r);
      if (c.role === "agent") {
        need(
          output.schema === "agi-work-bundle/v2" &&
            output.specHash === c.specSha256 &&
            output.files.length === 1,
          "RESULT_ARTIFACT",
        );
        const file = output.files[0],
          bytes = Buffer.from(file.content, "base64");
        need(
          digest(bytes) === file.sha256 && bytes.length === file.bytes,
          "RESULT_HASH",
        );
        useful = canonical(JSON.parse(bytes)) === canonical(oracle.truth[c.id]);
      } else {
        need(
          output.schema === "agi-native-review/v1" &&
            output.specSha256 === c.specSha256 &&
            output.deliverySha256 === c.deliverySha256 &&
            ["approve", "reject", "abstain"].includes(output.verdict),
          "REVIEW_RESULT",
        );
        verdict = output.verdict;
      }
    }
    engagements.push({
      caseId: c.id,
      specSha256: c.specSha256,
      runtimeSha256: c.runtimeSha256,
      evidenceSha256: digest(r),
      traceSha256: operation?.trace ?? digest(r),
      observationSource: "runtime-and-independent-oracle",
      status,
      verdict,
      outcomeVerified: true,
      useful,
      elapsedMs: operation?.finished
        ? Math.max(0, operation.finished - operation.started)
        : 0,
      humanSeconds: operation?.human_seconds ?? 0,
      toolCalls: operation?.actions ?? 0,
      costUSDC: operation?.cost_usdc ?? null,
      receiptsUSDC: "0",
      depositsUSDC: "0",
      realizedValueUSDC: "0",
    });
  }
  need(results.size === oracle.plan.cases.length, "UNPLANNED_CASE");
  const ledger = {
    schemaVersion: 1,
    measurementKind: "observed",
    planSha256: core.digest(oracle.plan),
    engagements,
  };
  return {
    ledger,
    report: capabilityReport(oracle.plan, ledger),
    scope:
      "Pilot fixture observations. No paid settlements are inferred. The oracle must independently verify provenance before signing a qualification attestation.",
  };
}
export async function main(argv = process.argv.slice(2)) {
  const { command, out: a } = args(argv);
  if (command === "create") {
    const agent = read(a["agent-runtime"]).runtime,
      reviewer = read(a["reviewer-runtime"]).runtime;
    const oracle = createBenchmark(agent, reviewer, path.resolve(a.dir), {
      groups: Number(a.groups ?? 4),
    });
    console.log(
      JSON.stringify(
        {
          cases: oracle.plan.cases.length,
          oracle: path.join(
            path.resolve(a.dir),
            "ORACLE_DO_NOT_SEND_TO_WORKERS.json",
          ),
          planSha256: core.digest(oracle.plan),
        },
        null,
        2,
      ),
    );
  } else if (command === "prepare") {
    const c = validateConfig(JSON.parse(readSecret(path.resolve(a.config))));
    console.log(
      JSON.stringify(
        prepareBenchmark(
          c,
          path.resolve(a.cases),
          readSecret(path.resolve(a["signing-key"])),
          path.resolve(a.out),
        ),
      ),
    );
  } else if (command === "run") {
    const c = validateConfig(JSON.parse(readSecret(path.resolve(a.config))));
    console.log(
      JSON.stringify(
        await runBenchmark(
          c,
          path.resolve(a.packets),
          readSecret(path.resolve(a["recipient-key"])),
          path.resolve(a.out),
        ),
      ),
    );
  } else if (command === "score") {
    const oracle = read(a.oracle),
      recordDirs = a.results.split(","),
      artifactPaths = new Map(),
      records = recordDirs.flatMap((d) =>
        fs
          .readdirSync(d)
          .filter((n) => n.endsWith(".json"))
          .map((n) => {
            const r = read(path.join(d, n));
            if (r.result.status === "complete") {
              need(r.result.output === r.caseId + ".encrypted", "RESULT_PATH");
              artifactPaths.set(r.caseId, path.resolve(d, r.result.output));
            }
            return r;
          }),
      ),
      operations = a.operations.split(",").map(read),
      key = readSecret(path.resolve(a["recipient-key"]));
    const result = scoreBenchmark(oracle, records, operations, (r) => {
      const e = read(artifactPaths.get(r.caseId));
      return JSON.parse(open(e, key, e.header.context));
    });
    atomic(path.resolve(a.out), result);
    console.log(
      JSON.stringify({
        report: a.out,
        engagements: result.report.engagements,
        qualification: "NONE",
      }),
    );
  } else {
    console.log(
      "npm run workforce:benchmark -- create --agent-runtime AGENT_DESCRIPTOR --reviewer-runtime NODE_DESCRIPTOR --dir PRIVATE_DIR [--groups 4]\nnpm run workforce:benchmark -- prepare --config CONFIG --cases CASE_DIRECTORY --signing-key OPERATOR_KEY --out PACKETS_DIRECTORY\nnpm run workforce:benchmark -- run --config CONFIG --packets PACKETS_DIRECTORY --recipient-key RECIPIENT_KEY --out RESULTS_DIRECTORY\nnpm run workforce:benchmark -- score --oracle ORACLE --results AGENT_RESULTS,NODE_RESULTS --operations AGENT_OPERATIONS,NODE_OPERATIONS --recipient-key ORACLE_KEY --out REPORT",
    );
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(
      /^WORKFORCE_|^CAPABILITY_|^COMPUTER_/.test(e.message)
        ? e.message
        : "WORKFORCE_BENCHMARK_FAILED",
    );
    process.exitCode = 1;
  });
