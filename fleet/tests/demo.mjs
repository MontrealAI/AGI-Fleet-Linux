import fs from "node:fs";
import assert from "node:assert/strict";
import { autonomySpec } from "../packages/AGI_Node/src/autonomy.mjs";
import { validateSpec, evaluate } from "../packages/AGI_Node/src/review.mjs";
const job = autonomySpec(
  JSON.parse(
    fs.readFileSync(
      new URL("../examples/autonomy-job-spec.json", import.meta.url),
    ),
  ),
  validateSpec,
);
const good = Buffer.from(
  JSON.stringify({
    productId: "AGI-001",
    description:
      "A public example catalogue description that meets the declared length.",
    priceUSDC: 25,
  }),
);
const bad = Buffer.from(
  JSON.stringify({ productId: "OTHER", description: "short", priceUSDC: 0 }),
);
const pass = evaluate(job.acceptance, good),
  fail = evaluate(job.acceptance, bad);
assert.equal(pass.decision, "approve");
assert.equal(fail.decision, "reject");
console.log("AGI Fleet offline practice — no wallet, network or transaction.");
console.log("Complete public example: " + pass.decision);
console.log(
  "Incorrect product, short text and invalid price: " + fail.decision,
);
console.log(
  "These checks establish only the declared formal criteria, not general business quality.",
);
console.log("Next: open START_HERE.html.");
