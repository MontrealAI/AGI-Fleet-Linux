#!/usr/bin/env node
import fs from "node:fs";
import { rawCID } from "../src/content.mjs";
import { boundedJSON, validateSpec, DECLARATION } from "../src/review.mjs";
import { sha256 } from "../src/util.mjs";
const [file, kind = "delivery"] = process.argv.slice(2);
if (!file || !["spec", "delivery"].includes(kind)) {
  console.error(
    "Usage: node scripts/prepare-job.mjs path/to/file.json [spec|delivery]",
  );
  process.exit(1);
}
const bytes = fs.readFileSync(file);
if (bytes.length > 262144)
  throw new Error("Default node evidence limit is 262,144 bytes.");
if (kind === "spec") validateSpec(boundedJSON(bytes));
console.log(
  JSON.stringify(
    {
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      rawBlockCID: rawCID(bytes),
      ipfsURI: "ipfs://" + rawCID(bytes),
      httpsFragment: "#sha256=" + sha256(bytes),
      ...(kind === "spec" ? { jobDetails: DECLARATION } : {}),
    },
    null,
    2,
  ),
);
console.log(
  "\nThis computes addresses only. Upload these exact bytes as a raw IPFS block, or publish via an allowlisted HTTPS host with the committed digest. It does not upload, post a job, or send a transaction.",
);
