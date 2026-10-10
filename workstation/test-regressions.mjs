// Exercise inherited authority, recovery and project behavior against the preview
// engine. The frozen tests and source remain untouched. No provider is invoked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = fs.mkdtempSync(path.join(os.tmpdir(), "agi-workstation-regressions-"));
const cases = ["native-workforce.test.mjs", "native-resumption.test.mjs", "native-project.test.mjs"];
try {
  fs.cpSync(path.join(here, "engine"), path.join(target, "workforce"), { recursive: true });
  fs.mkdirSync(path.join(target, "tests"));
  for (const name of [...cases, "workforce-fixture.mjs", "workforce-v3-fixture.mjs"]) {
    let source = fs.readFileSync(path.join(here, "../fleet/tests", name), "utf8");
    if (name === "native-workforce.test.mjs") {
      // The Linux preview rejects ALL production grants before the inherited
      // qualification pipeline. Preserve both assertions, requiring its exact
      // stronger refusal instead of the two downstream macOS policy errors.
      for (const expected of ["/QUALIFICATION_REQUIRED/", "/QUALIFICATION_OPERATING_POLICY_REQUIRED/"]) {
        if (source.split(expected).length !== 2) throw Error("Inherited production assertion changed; review required");
        source = source.replace(expected, "/WORKFORCE_LINUX_PRODUCTION_QUALIFICATION_REQUIRED_PREVIEW_PILOT_ONLY$/");
      }
    }
    fs.writeFileSync(path.join(target, "tests", name), source);
  }
  const result = spawnSync(process.execPath, ["--test", ...cases.map(n => path.join(target, "tests", n))], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(target, { recursive: true, force: true });
}
