#!/usr/bin/env node
import { acquireWalletLease } from "./wallet-lease.mjs";
import fs from "node:fs";
import { VERSION, assertRuntime } from "./version.mjs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { Wallet, getAddress, formatUnits, ZeroHash, parseUnits } from "ethers";
import { DEFAULT, validateConfig, loadConfig, binding } from "./config.mjs";
import {
  ensure,
  readJSON,
  atomicWrite,
  encode,
  codeOf,
  delay,
} from "./util.mjs";
import { Store } from "./store.mjs";
import { Chain } from "./chain.mjs";
import { Engine } from "./engine.mjs";
import { dashboard } from "./dashboard.mjs";
import { demo } from "./demo.mjs";
const args = process.argv.slice(2),
  command = args[0] ?? "help";
function option(name, fallback) {
  const n = args.indexOf("--" + name);
  return n < 0 ? fallback : args[n + 1];
}
const configFile = path.resolve(option("config", "node.config.json"));
function say(s) {
  console.log(s);
}
async function secret(label = "Keystore password: ") {
  if (process.env.AGI_NODE_PASSWORD_FILE) {
    const p = process.env.AGI_NODE_PASSWORD_FILE,
      s = fs.statSync(p);
    ensure(
      s.size <= 4096 &&
        (process.platform === "win32" || (s.mode & 0o077) === 0),
      "PASSWORD_FILE_MUST_BE_PRIVATE",
    );
    return fs.readFileSync(p, "utf8").replace(/\r?\n$/, "");
  }
  if (process.env.AGI_NODE_KEYSTORE_PASSWORD)
    return process.env.AGI_NODE_KEYSTORE_PASSWORD;
  ensure(process.stdin.isTTY, "SET_PASSWORD_FILE_FOR_UNATTENDED_OPERATION");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (e) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      e ? reject(e) : resolve(value);
    };
    const onData = (data) => {
      for (const ch of data.toString()) {
        if (ch === "\r" || ch === "\n") {
          finish();
          return;
        }
        if (ch === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f") {
          value = value.slice(0, -1);
        } else if (ch >= " ") value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}
async function setup() {
  ensure(!fs.existsSync(configFile), "CONFIG_EXISTS_EDIT_IT_INSTEAD");
  const c = structuredClone(DEFAULT),
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  say(
    "\nAGI NODE · PRIVATE SETUP\nYou can prepare this before deployment. Press Enter to leave future addresses blank.\n",
  );
  try {
    c.chainId = Number(
      (await rl.question("Chain: 1 Ethereum, 11155111 Sepolia [1]: ")) || "1",
    );
    c.manager = (
      await rl.question("Verified AGIJobManager address [later]: ")
    ).trim();
    c.deploymentBlock = Number(
      (await rl.question("Manager creation block [later]: ")) || "0",
    );
    c.validator = (
      await rl.question("Dedicated validator wallet address [create later]: ")
    ).trim();
    c.label = (
      await rl.question(
        "AGI Club label only, e.g. alice [owner/Merkle exception]: ",
      )
    ).trim();
    c.trustedBuyers = (
      await rl.question(
        "Buyer addresses whose formal jobs you authorize reviewing (comma-separated) [later]: ",
      )
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    validateConfig(c, path.dirname(configFile));
    atomicWrite(configFile, JSON.stringify(c, null, 2) + "\n");
  } finally {
    rl.close();
  }
  say(
    "\nSaved node.config.json. No key was requested and nothing was broadcast.\nNext: node src/cli.mjs wallet-create (optional), set AGI_NODE_RPC_URL, then enroll and doctor.\nTry npm run demo at any time. Read START_HERE.html for the full path.",
  );
}
async function doctor(c, chain, pin) {
  await chain.verify(pin);
  const cred = await chain.manager.validatorCredential(
      c.validator,
      c.label,
      c.proof,
    ),
    blocked = await chain.manager.blacklistedValidators(c.validator);
  ensure(cred[0] !== ZeroHash && !blocked, "VALIDATOR_NOT_ELIGIBLE");
  const [eth, usdc, allowance] = await Promise.all([
    chain.provider.getBalance(c.validator),
    chain.token.balanceOf(c.validator),
    chain.token.allowance(c.validator, c.manager),
  ]);
  say(
    `Contract + 8 library fingerprints: PASS\nChain: ${c.chainId}\nValidator credential: PASS\nWallet: ${getAddress(c.validator)}\nETH for gas: ${formatUnits(eth, 18)}\nUSDC available: ${formatUnits(usdc, 6)}\nExisting allowance: ${formatUnits(allowance, 6)} USDC\nBuyer scope: ${c.trustedBuyers.length} address(es)\nMaximum bond/job: ${c.limits.maxBondUSDC} USDC\nMaximum open bond/claims exposure: ${c.limits.maxOpenBondUSDC} USDC\nGas ceiling/24h: ${c.limits.maxGas24hETH} ETH\nReview mode: deterministic evidence${c.ai.enabled ? " + local AI veto" : ""}`,
  );
  if (eth === 0n || usdc === 0n)
    say(
      "Funding is still needed before bonded live validation. Observation remains available.",
    );
  if (allowance > parseUnits(c.limits.maxBondUSDC, 6))
    say(
      "Existing allowance exceeds your per-job policy. The node will reset it before a vote; review any earlier approvals.",
    );
}
async function main() {
  assertRuntime();
  if (command === "help") {
    say(
      `AGI Node · Private v${VERSION} · Advanced CLI

Recommended: npm start (graphical setup and public-network live operation)
Public-network activation and signing are unavailable in this legacy CLI.
The app manages independent RPCs, related-party review and commissioning.

Demo:       npm run demo
Prepare:    npm run setup (separate legacy observation configuration)
Verify:     node src/cli.mjs enroll
Check:      npm run doctor
Observe:    node src/cli.mjs run
Inspect:    node src/cli.mjs status
Report:     node src/cli.mjs report --out node-report.json
Recovery:   node src/cli.mjs pause | resume | recheck | reindex | unlock
Options:    --config /path/node.config.json ; run --once ; demo --port 8787

Local chain 31337 developer fixtures retain explicit live commands.
Never mix CLI state with graphical state. Read docs/CLI_REFERENCE.html.`,
    );
    return;
  }
  if (command === "setup") return setup();
  if (command === "demo")
    return demo(Number(option("port", 8787)), args.includes("--once"));
  const c = loadConfig(configFile),
    pinFile = path.join(c.dataDir, "deployment.json");
  if (
    c.chainId !== 31337 &&
    (command === "activate" || args.includes("--live"))
  ) {
    say(
      "Public-network live operation requires the graphical app. Run npm start; configure independent RPCs, related-party exclusions and commissioning there. This CLI did not connect, decrypt a wallet, authorize or sign.",
    );
    process.exitCode = 1;
    return;
  }
  if (command === "wallet-create") {
    ensure(!fs.existsSync(c.keystore), "KEYSTORE_EXISTS_NEVER_OVERWRITE");
    const password = await secret(
      "New keystore password (12+ characters, hidden): ",
    );
    ensure(password.length >= 12, "PASSWORD_MINIMUM_12_CHARACTERS");
    if (
      !process.env.AGI_NODE_PASSWORD_FILE &&
      !process.env.AGI_NODE_KEYSTORE_PASSWORD
    )
      ensure(
        password === (await secret("Repeat password: ")),
        "PASSWORDS_DIFFER",
      );
    const wallet = Wallet.createRandom();
    atomicWrite(c.keystore, await wallet.encrypt(password));
    say(
      "Encrypted wallet created: " +
        wallet.address +
        "\nBack up the keystore and password separately. No funds were moved.",
    );
    const original = readJSON(configFile);
    if (!original.validator) {
      original.validator = wallet.address;
      atomicWrite(configFile, JSON.stringify(original, null, 2) + "\n");
      say("Validator address saved in the configuration.");
    } else
      say(
        "Existing configured validator was preserved. Use this new address only after updating eligibility and configuration.",
      );
    return;
  }
  if (command === "pause") {
    atomicWrite(path.join(c.dataDir, "STOP"), "Paused by operator\n");
    say(
      "New signing paused. Already broadcast transactions can still execute.",
    );
    return;
  }
  if (command === "resume") {
    fs.rmSync(path.join(c.dataDir, "STOP"), { force: true });
    say("Pause removed. Live activation and every safety check still apply.");
    return;
  }
  if (command === "unlock") {
    const p = path.join(c.dataDir, "RUNNING.lock");
    const l = readJSON(p);
    let alive = true;
    try {
      process.kill(l.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
      else throw e;
    }
    ensure(!alive, "LOCK_PROCESS_STILL_RUNNING");
    fs.unlinkSync(p);
    say(
      "Stale process lock removed. The signed transaction journal was preserved.",
    );
    return;
  }
  if (command === "status" || command === "report") {
    // Read-only connection can run beside the active node without acquiring its writer lock.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(c.dataDir, "node.sqlite"), {
      readOnly: true,
    });
    const value = {
      runtime: JSON.parse(
        db.prepare("SELECT value FROM meta WHERE key='runtime'").get()?.value ??
          "{}",
      ),
      counts: db
        .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
        .all(),
      transactions: db
        .prepare(
          "SELECT hash,kind,job,state,status,block_hash,block_number FROM txs ORDER BY created DESC LIMIT 100",
        )
        .all(),
      reviews: db
        .prepare(
          "SELECT id,status,reason,review FROM jobs WHERE review IS NOT NULL ORDER BY created_block DESC LIMIT 100",
        )
        .all(),
    };
    db.close();
    if (command === "report") {
      const out = path.resolve(option("out", "node-report.json"));
      atomicWrite(out, JSON.stringify(value, null, 2) + "\n");
      say("Saved private report: " + out);
    } else say(JSON.stringify(value, null, 2));
    return;
  }
  if (command === "recheck" || command === "reindex") {
    const store = new Store(c.dataDir);
    try {
      ensure(!store.pending(), "PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST");
      if (command === "reindex") {
        store.transaction(() => {
          store.db.exec("DELETE FROM jobs");
          store.db.prepare("DELETE FROM meta WHERE key='cursor'").run();
        });
        say(
          "Event index cleared; next start rescans from creation. Signed transactions and budgets are preserved.",
        );
      } else {
        store.db.exec(
          "UPDATE jobs SET status='queued',next_review=0 WHERE my_vote=0 AND status!='terminal'",
        );
        say("All unfinished unvoted jobs will be reviewed again.");
      }
    } finally {
      store.close();
    }
    return;
  }
  validateConfig(c, path.dirname(configFile), { ready: true });
  const chain = new Chain(c);
  let releaseWallet;
  try {
    if (command === "enroll") {
      ensure(!fs.existsSync(pinFile), "DEPLOYMENT_ALREADY_PINNED");
      const pin = await chain.enroll();
      atomicWrite(pinFile, JSON.stringify(pin, null, 2) + "\n");
      say(
        "Pinned the v1.1.0 manager, native USDC and all 8 linked libraries. No transaction sent.\nNext: npm run doctor",
      );
      return;
    }
    const pin = readJSON(pinFile);
    if (command === "doctor") {
      await doctor(c, chain, pin);
      return;
    }
    if (command === "activate") {
      await doctor(c, chain, pin);
      ensure(
        fs.existsSync(c.keystore),
        "CREATE_OR_IMPORT_ENCRYPTED_KEYSTORE_FIRST",
      );
      const key = readJSON(c.keystore);
      ensure(
        getAddress("0x" + key.address.replace(/^0x/, "")) ===
          getAddress(c.validator),
        "KEYSTORE_WALLET_MISMATCH",
      );
      const phrase = `ACTIVATE ${c.chainId} ${c.manager.slice(-6).toLowerCase()} ${c.validator.slice(-6).toLowerCase()}`;
      say(
        "\nLive validation can lose bonds and spend ETH. It can approve/reject supported formal jobs from the listed buyers. No human confirmation is required for each permitted transaction.",
      );
      let answer = option("confirm", null);
      if (answer === null) {
        ensure(
          process.stdin.isTTY,
          "ACTIVATION_REQUIRES_EXPLICIT_CONFIRMATION",
        );
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          answer = await rl.question(
            "To authorize this configuration, type " + phrase + ": ",
          );
        } finally {
          rl.close();
        }
      }
      ensure(answer === phrase, "ACTIVATION_NOT_CONFIRMED");
      atomicWrite(
        path.join(c.dataDir, "activation.json"),
        JSON.stringify(
          {
            binding: binding(c, pin),
            validator: getAddress(c.validator),
            activatedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
      );
      say(
        "This exact configuration is authorized. Start with node src/cli.mjs run --live. Changes to configuration or deployment require activation again.",
      );
      return;
    }
    ensure(command === "run", "UNKNOWN_COMMAND");
    const live = args.includes("--live");
    let signer = null;
    if (live) {
      signer = (
        await Wallet.fromEncryptedJson(
          fs.readFileSync(c.keystore, "utf8"),
          await secret(),
        )
      ).connect(chain.provider);
      ensure(signer.address === getAddress(c.validator), "SIGNER_MISMATCH");
    }
    const store = new Store(c.dataDir);
    let ui,
      engine,
      stop = false;
    const signal = () => {
      stop = true;
      if (engine) engine.tx.halted = true;
    };
    process.on("SIGINT", signal);
    process.on("SIGTERM", signal);
    try {
      engine = new Engine(c, chain, store, pin, { live, signer });
      if (live) {
        releaseWallet = acquireWalletLease(c.chainId, c.validator);
        engine.tx.assertActive();
      }
      ui = await dashboard(store, c.port);
      say(
        `\n${live ? "LIVE · bounded autonomous signing" : "OBSERVE · no signing"}\nPrivate dashboard: ${ui.url}\nKeep this browser link private. Ctrl+C stops the process; use pause to stop new signing while monitoring continues.\n`,
      );
      do {
        try {
          await engine.cycle();
        } catch (e) {
          say(
            new Date().toISOString() +
              " · " +
              codeOf(e) +
              " · see dashboard / docs/TROUBLESHOOTING.md",
          );
        }
        if (args.includes("--once")) break;
        for (let i = 0; i < c.pollSeconds && !stop; i++) await delay(1000);
      } while (!stop);
    } finally {
      ui?.server.close();
      store.close();
      process.off("SIGINT", signal);
      process.off("SIGTERM", signal);
    }
  } finally {
    chain.provider.destroy?.();
    releaseWallet?.();
  }
}
main().catch((e) => {
  console.error(
    "AGI Node could not continue: " +
      (e.code ??
        (/^[A-Z_]+(?::.*)?$/.test(e.message)
          ? e.message
          : "Check your configuration, connection and required files. See docs/TROUBLESHOOTING.md.")),
  );
  process.exitCode = 1;
});
