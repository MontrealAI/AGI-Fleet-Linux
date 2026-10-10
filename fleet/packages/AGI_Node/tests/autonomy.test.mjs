import test from "node:test";
import assert from "node:assert/strict";
import { autonomySpec, AUTONOMY_DECLARATION } from "../src/autonomy.mjs";
import { validateSpec, reviewJob } from "../src/review.mjs";
const envelope = {
  schema: "agi-autonomy-job/v1",
  title: "Answer",
  task: "Return answer 42",
  inputs: "Public",
  dataPolicy: "public",
  acceptance: {
    schema: "agi-node-job/v1",
    profile: "json-rules/v1",
    title: "Answer",
    rules: [{ id: "answer", path: "/answer", op: "equals", value: 42 }],
  },
  resolution: {
    mode: "formal-only/v1",
    moderators: ["0x0000000000000000000000000000000000000004"],
    neutralRefund: true,
  },
};
test("autonomy envelope validates exact committed criteria", () =>
  assert.equal(
    autonomySpec(envelope, validateSpec).acceptance.profile,
    "json-rules/v1",
  ));
test("Node review supports opted-in immutable automation envelope", async () => {
  const reader = {
    read: async (uri) => ({
      bytes: Buffer.from(
        uri === "spec" ? JSON.stringify(envelope) : '{"answer":42}',
      ),
      sha256: "fixture",
    }),
  };
  const r = await reviewJob(
    { details: AUTONOMY_DECLARATION },
    { specURI: "spec", completionURI: "done" },
    reader,
    { enabled: false, cloudVeto: false },
  );
  assert.equal(r.decision, "approve");
});
