// Local capacity exercise. No network, signer, blockchain or wallet is used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../src/store.mjs";
import { validateSpec, evaluate } from "../src/review.mjs";
import { Controller } from "../src/control/controller.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agi-capacity-")),
  controller = new Controller(home),
  store = new Store(controller.config.dataDir),
  round = (n) => Math.round(n * 100) / 100;
try {
  let started = performance.now();
  store.transaction(() => {
    for (let i = 0; i < 100000; i++)
      store.putJob(String(i), {
        created_block: i,
        requested: 1,
        status: i % 10 === 0 ? "waiting" : "terminal",
      });
  });
  const insertMs = performance.now() - started;
  const times = [];
  for (let i = 0; i < 30; i++) {
    started = performance.now();
    controller.status();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const spec = validateSpec({
      schema: "agi-node-job/v1",
      profile: "csv-table/v1",
      title: "Synthetic catalogue",
      columns: [
        { name: "id", type: "string" },
        { name: "price", type: "number", min: 0, max: 100 },
      ],
      minRows: 100,
      maxRows: 100,
      uniqueBy: ["id"],
    }),
    bytes = Buffer.from(
      "id,price\n" +
        Array.from(
          { length: 100 },
          (_, i) => "item-" + i + "," + (i % 100),
        ).join("\n"),
    );
  started = performance.now();
  for (let i = 0; i < 1000; i++)
    if (evaluate(spec, bytes).decision !== "approve")
      throw Error("BENCHMARK_REVIEW_FAILED");
  const reviewMs = performance.now() - started;
  console.log(
    JSON.stringify(
      {
        kind: "Local synthetic capacity exercise; not chain throughput or SLA",
        node: process.version,
        os: process.platform,
        architecture: process.arch,
        cpu: os.cpus()[0]?.model,
        logicalCPUs: os.cpus().length,
        jobRows: 100000,
        jobInsertMs: round(insertMs),
        statusSamples: 30,
        statusP50Ms: round(times[15]),
        statusP95Ms: round(times[28]),
        csvReviews: 1000,
        rowsPerReview: 100,
        csvReviewTotalMs: round(reviewMs),
        csvReviewsPerSecond: round(1000000 / reviewMs),
        peakRSSMiB: round(process.resourceUsage().maxRSS / 1024),
        databaseBytes: fs.statSync(
          path.join(controller.config.dataDir, "node.sqlite"),
        ).size,
        limitations: [
          "single Linux host",
          "memory/disk/CPU vary by hardware",
          "no RPC, finality, local model or signing load",
          "no sustained production soak",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  await controller.close();
  fs.rmSync(home, { recursive: true, force: true });
}
