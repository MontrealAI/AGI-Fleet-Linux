import {ensure,strictKeys} from '../src/util.mjs';
import {boundedJSON} from '../src/review.mjs';
export function parseAnswer(kind, text, images = false) {
  ensure(
    typeof text === "string" &&
      Buffer.byteLength(text) <= (kind === "generate" ? (images ? 10485760 : 26000) : 4096),
    "COMPANION_RESPONSE_INVALID",
  );
  let v;
  try {
    v = boundedJSON(Buffer.from(text));
  } catch {
    ensure(false, "COMPANION_RESPONSE_INVALID");
  }
  if (kind === "generate") {
    strictKeys(v, ["status", "content"], "COMPANION_RESPONSE_INVALID");
    ensure(
      ["complete", "decline"].includes(v.status) &&
        typeof v.content === "string" &&
        Buffer.byteLength(v.content) <= (images ? 6291456 : 12000) &&
        (v.status !== "complete" || v.content.length > 0),
      "COMPANION_RESPONSE_INVALID",
    );
  } else if (kind === "quality") {
    strictKeys(v, ["verdict"], "COMPANION_RESPONSE_INVALID");
    ensure(
      ["pass", "revise", "decline"].includes(v.verdict),
      "COMPANION_RESPONSE_INVALID",
    );
  } else if (kind === "review") {
    strictKeys(v, ["verdict"], "COMPANION_RESPONSE_INVALID");
    ensure(
      ["consistent", "concern", "uncertain"].includes(v.verdict),
      "COMPANION_RESPONSE_INVALID",
    );
  } else if (kind === "test") {
    strictKeys(v, ["status"], "COMPANION_RESPONSE_INVALID");
    ensure(v.status === "ready", "COMPANION_RESPONSE_INVALID");
  } else {
    strictKeys(v, ["summary", "attention"], "COMPANION_RESPONSE_INVALID");
    ensure(
      typeof v.summary === "string" &&
        v.summary.length > 0 &&
        v.summary.length <= 1600 &&
        !/[\x00-\x08\x0B-\x1F]/.test(v.summary),
      "COMPANION_RESPONSE_INVALID",
    );
    ensure(
      [
        "none",
        "check_node",
        "check_connection",
        "review_evidence",
        "review_limits",
      ].includes(v.attention),
      "COMPANION_RESPONSE_INVALID",
    );
  }
  return v;
}
