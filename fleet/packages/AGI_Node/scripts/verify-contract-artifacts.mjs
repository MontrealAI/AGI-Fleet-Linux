import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import solc from "solc";
import { ROOT, canonical, sha256 } from "../src/util.mjs";
const base = path.join(ROOT, "contract"),
  provenance = JSON.parse(
    fs.readFileSync(path.join(base, "artifact-provenance.json")),
  );
assert.ok(solc.version().startsWith("0.8.37+"), "Expected pinned solc 0.8.37");
const outputs = new Map();
for (const [name, p] of Object.entries(provenance.artifacts)) {
  if (!outputs.has(p.buildInfoId)) {
    console.log("Recompiling " + p.buildInfoId);
    const input = fs.readFileSync(
        path.join(base, "compiler-inputs", p.buildInfoId + ".json"),
        "utf8",
      ),
      output = JSON.parse(solc.compile(input));
    assert.equal(
      (output.errors ?? []).filter((e) => e.severity === "error").length,
      0,
    );
    outputs.set(p.buildInfoId, output);
  }
  const b = fs.readFileSync(path.join(base, "artifacts", name + ".json")),
    a = JSON.parse(b),
    out = outputs.get(p.buildInfoId).contracts[p.sourceName][name];
  assert.equal(sha256(b), p.artifactSHA256);
  for (const [key, value] of Object.entries({
    abi: out.abi,
    bytecode: "0x" + out.evm.bytecode.object,
    deployedBytecode: "0x" + out.evm.deployedBytecode.object,
    linkReferences: out.evm.bytecode.linkReferences,
    deployedLinkReferences: out.evm.deployedBytecode.linkReferences,
    immutableReferences: out.evm.deployedBytecode.immutableReferences ?? {},
  }))
    assert.equal(canonical(a[key]), canonical(value), name + " " + key);
  console.log("MATCH " + name);
}
console.log(
  "All 11 artifacts reproduced exactly from the included compiler inputs.",
);
