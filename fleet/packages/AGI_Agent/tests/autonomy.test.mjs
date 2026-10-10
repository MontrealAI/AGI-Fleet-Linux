import test from "node:test";
import assert from "node:assert/strict";
import { autonomySpec, AUTONOMY_DECLARATION } from "../src/autonomy.mjs";
import { validateSpec } from "../src/review.mjs";
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
import { normalizeWork, checkDelivery } from "../src/work.mjs";
test("Agent only accepts automation envelopes with operator opt-in", () => {
  assert.throws(
    () => normalizeWork(envelope, AUTONOMY_DECLARATION, false),
    /OPT_IN/,
  );
  const w = normalizeWork(envelope, AUTONOMY_DECLARATION, true);
  assert.equal(checkDelivery(w, '{"answer":42}').decision, "approve");
});
