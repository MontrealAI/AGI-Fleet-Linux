import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store.mjs";
import { dashboard } from "./dashboard.mjs";
import { evaluate, DECLARATION, reviewJob } from "./review.mjs";
import { sha256, encode } from "./util.mjs";
export const sampleSpec = {
  schema: "agi-node-job/v1",
  profile: "json-rules/v1",
  title: "Deliver a verified catalogue record",
  rules: [
    { id: "product-id", path: "/productId", op: "equals", value: "AGI-001" },
    {
      id: "description-length",
      path: "/description",
      op: "stringLength",
      min: 30,
      max: 200,
    },
    { id: "price", path: "/priceUSDC", op: "numberRange", min: 1, max: 100 },
  ],
};
export const goodDelivery = {
  productId: "AGI-001",
  description:
    "A clearly described example catalogue product for the private AGI Node demo.",
  priceUSDC: 25,
};
export async function demo(port = 8787, once = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-node-demo-")),
    store = new Store(dir);
  for (const [id, delivery] of [
    ["101", goodDelivery],
    ["102", { ...goodDelivery, priceUSDC: 999 }],
    ["103", { ...goodDelivery, productId: "WRONG" }],
  ]) {
    const result = evaluate(sampleSpec, Buffer.from(JSON.stringify(delivery)));
    store.putJob(id, {
      created_block: Number(id),
      requested: 1,
      status: result.decision === "approve" ? "would-approve" : "would-reject",
      reason:
        result.decision === "approve"
          ? "ALL_ACCEPTANCE_CHECKS_PASS"
          : "ACCEPTANCE_CHECK_FAILED",
      review: encode(result),
    });
  }
  store.putJob("104", {
    created_block: 104,
    requested: 1,
    status: "abstained",
    reason: "UNSUPPORTED_ACCEPTANCE_DECLARATION",
  });
  store.putJob("105", {
    created_block: 105,
    requested: 1,
    status: "abstained",
    reason: "EVIDENCE_UNAVAILABLE",
  });
  store.set("runtime", {
    status: "demo",
    mode: "DEMO",
    message:
      "Synthetic jobs; real verification engine. No RPC, wallet, AI model or funds required.",
    updated: new Date().toISOString(),
  });
  console.log(
    "Demo: 1 approval, 2 rejections, 2 abstentions. No blockchain transactions.",
  );
  if (once) {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const ui = await dashboard(store, port);
  console.log("Open your private demo: " + ui.url + "\nCtrl+C to stop.");
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    ui.server.close(() => {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
