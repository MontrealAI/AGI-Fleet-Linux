import fs from "node:fs";
import { boundedJSON, DECLARATION } from "../src/review.mjs";
import { normalizeWork, AGENT_DECLARATION } from "../src/work.mjs";
import { rawCID } from "../src/content.mjs";
import { ensure, sha256 } from "../src/util.mjs";
const file = process.argv[2];
ensure(file, "SPEC_FILE_REQUIRED");
ensure(fs.statSync(file).size <= 24000, "SPEC_TOO_LARGE");
const bytes = fs.readFileSync(file),
  v = boundedJSON(bytes),
  details = v.schema === "agi-agent-job/v1" ? AGENT_DECLARATION : DECLARATION;
const w = normalizeWork(v, details, true);
console.log(
  JSON.stringify(
    {
      valid: true,
      uri: "ipfs://" + rawCID(bytes),
      sha256: sha256(bytes),
      details,
      compatibility: w.compatibility,
      published: false,
    },
    null,
    2,
  ),
);
