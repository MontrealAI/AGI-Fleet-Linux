import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT } from "../src/config.mjs";
import { VERSION } from "../src/version.mjs";
const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
test("CLI help uses package version and sends public-network operators to graphical setup", () => {
  const r = spawnSync(process.execPath, [cli, "help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("v" + VERSION));
  assert.match(
    r.stdout,
    /Public-network activation and signing are unavailable/,
  );
  assert.doesNotMatch(r.stdout, /Authorize:|Operate:|v2\.1\.0/);
});
test("public-network CLI live and activation fail before RPC, decryption or journal creation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agi-cli-gate-"));
  try {
    for (const chainId of [1, 11155111]) {
      const c = structuredClone(DEFAULT);
      c.chainId = chainId;
      const config = path.join(dir, "node.config.json");
      fs.writeFileSync(config, JSON.stringify(c));
      for (const args of [["activate"], ["run", "--live"]]) {
        const r = spawnSync(
          process.execPath,
          [cli, ...args, "--config", config],
          {
            cwd: dir,
            encoding: "utf8",
            timeout: 5000,
            env: { PATH: process.env.PATH },
          },
        );
        assert.equal(r.status, 1);
        assert.match(r.stdout, /requires the graphical app/);
        assert.deepEqual(fs.readdirSync(dir), ["node.config.json"]);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
