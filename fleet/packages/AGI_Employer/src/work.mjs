import {isComputerSpec,evaluateComputer} from './artifacts.mjs';
import { isImageSpec, evaluateImage } from './images.mjs';
import { deliveryBytes, deliveryPlan } from './delivery.mjs';
import { ensure, strictKeys, canonical, sha256 } from "./util.mjs";
import { validateSpec, evaluate, boundedJSON, DECLARATION } from "./review.mjs";
import { rawCID } from "./content.mjs";
export const AGENT_DECLARATION =
  "AGI-AGENT-V1: public inputs; the immutable specification contains the complete task and acceptance criteria.";
export const MAX_DELIVERY = 12000;
export function normalizeWork(value, details, allowEnvelopes = false) {
  ensure(Buffer.byteLength(canonical(value)) <= 65536, "WORK_SPEC_TOO_LARGE");
  if (value?.schema === "agi-node-job/v1") {
    ensure(details === DECLARATION, "UNSUPPORTED_ACCEPTANCE_DECLARATION");
    return {
      schema: "agi-agent-work/v1",
      task: value.prompt ?? "Produce a complete deliverable satisfying these formal acceptance criteria. The title describes the requested work.",
      inputs: "",
      acceptance: validateSpec(value),
      compatibility: "agi-node-v2.1",
    };
  }
  ensure(
    allowEnvelopes && details === AGENT_DECLARATION,
    "UNSUPPORTED_JOB_FORMAT",
  );
  strictKeys(
    value,
    ["schema", "task", "inputs", "acceptance", "dataPolicy"],
    "WORK_SPEC_FIELDS",
  );
  ensure(
    value.schema === "agi-agent-job/v1" && value.dataPolicy === "public",
    "PUBLIC_DATA_REQUIRED",
  );
  ensure(
    typeof value.task === "string" &&
      value.task.length > 0 &&
      value.task.length <= 6000 &&
      typeof value.inputs === "string" &&
      value.inputs.length <= 10000,
    "WORK_TASK_INVALID",
  );
  return {
    schema: "agi-agent-work/v1",
    task: value.task,
    inputs: value.inputs,
    acceptance: validateSpec(value.acceptance),
    compatibility: "buyer-or-envelope-validator",
  };
}
export function validateWork(w) {
  strictKeys(
    w,
    ["schema", "task", "inputs", "acceptance", "compatibility"],
    "WORK_FORMAT",
  );
  ensure(
    w.schema === "agi-agent-work/v1" &&
      typeof w.task === "string" &&
      typeof w.inputs === "string" &&
      Buffer.byteLength(canonical(w)) <= 80000,
    "WORK_FORMAT",
  );
  ensure(
    ["agi-node-v2.1", "buyer-or-envelope-validator"].includes(w.compatibility),
    "WORK_FORMAT",
  );
  validateSpec(w.acceptance);
  return w;
}
export function checkDelivery(w, content) {
  validateWork(w);
  if (isComputerSpec(w.acceptance)) return evaluateComputer(w.acceptance, Buffer.from(content));
  if (isImageSpec(w.acceptance)) { try { return evaluateImage(w.acceptance, deliveryBytes(content,w)); } catch { return {decision:"reject",checks:[{id:"image-encoding",passed:false}]}; } }
  ensure(
    typeof content === "string" &&
      Buffer.byteLength(content) > 0 &&
      Buffer.byteLength(content) <= MAX_DELIVERY,
    "DELIVERY_SIZE",
  );
  ensure(
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content),
    "DELIVERY_CONTROL_CHARACTERS",
  );
  const bytes = Buffer.from(content);
  ensure(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes) === content,
    "DELIVERY_UTF8",
  );
  return evaluate(w.acceptance, bytes);
}
export function deliveryURI(content, spec) {
  return deliveryPlan(deliveryBytes(content, spec)).uri;
}
export function assertPrepared(w, binding, legacyBinding = null) {
  ensure(
    w &&
      (w.binding === binding ||
        (legacyBinding !== null && w.binding === legacyBinding)) &&
      w.stage === "published" &&
      w.uri === deliveryURI(w.content, w.spec),
    "PREPARED_WORK_REQUIRED",
  );
  ensure(
    checkDelivery(w.spec, w.content).decision === "approve",
    "DELIVERY_CHECK_FAILED",
  );
}
export function shardFor(chainId, manager, id, count) {
  return Number(
    BigInt("0x" + sha256(`${chainId}:${manager.toLowerCase()}:${id}`)) %
      BigInt(count),
  );
}
export function decodeWork(bytes, details, allowEnvelopes) {
  return normalizeWork(boundedJSON(bytes), details, allowEnvelopes);
}
