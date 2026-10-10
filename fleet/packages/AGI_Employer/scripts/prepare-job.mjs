import fs from "node:fs";
import { boundedJSON, validateSpec } from "../packages/AGI_Node/src/review.mjs";
import {
  autonomySpec,
  AUTONOMY_DECLARATION,
} from "../packages/AGI_Node/src/autonomy.mjs";
import { rawCID } from "../packages/AGI_Node/src/content.mjs";
import { canonical, ensure } from "../ops/common.mjs";
ensure(process.argv[2], "JOB_FILE_REQUIRED");
const bytes = fs.readFileSync(process.argv[2]);
ensure(bytes.length <= 18000, "JOB_TOO_LARGE");
const value = autonomySpec(boundedJSON(bytes), validateSpec),
  canonicalBytes = Buffer.from(canonical(value));
const out = process.argv[3] ?? process.argv[2] + ".canonical.json";
fs.writeFileSync(out, canonicalBytes, { flag: "wx", mode: 0o600 });
console.log(
  JSON.stringify(
    {
      file: out,
      jobSpecURI: "ipfs://" + rawCID(canonicalBytes),
      details: AUTONOMY_DECLARATION,
      next: "Pin these exact canonical bytes as an IPFS raw block and verify public retrieval before posting. Use the existing job posting interface; no wallet or transaction is used by this command.",
    },
    null,
    2,
  ),
);
