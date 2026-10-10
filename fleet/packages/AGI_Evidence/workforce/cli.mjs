#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  need,
  readFile,
  readSecret,
  privateDir,
  atomic,
  canonical,
  digest,
  Journal,
} from "./core.mjs";
import { inspectHardware, inspectInstallation } from "./platform.mjs";
import { Gateway, verifyPlanner } from "./gateway.mjs";
import {
  runNative,
  validateConfig,
  nativeRuntime,
  sourceDigest,
  grantBody,
  signGrant,
  validatePacket,
  validateDelivery,
  reconcileExecutions,
} from "./runner.mjs";
import { seal, open, recipientId } from "./envelope.mjs";
import { signAuthority } from "./authority.mjs";
import { createIdentity } from "./core.mjs";
import core from "./core/computer-work.cjs";
import qualification from "./core/workforce.cjs";
const usage = `Private native workforce — public and dedicated-account computer jobs

  npm run workforce -- authority-record --config CONFIG --signing-key OPERATOR_KEY --sequence INTEGER --disabled true|false --out SIGNED_RECORD [--revoked NONCE,NONCE]
  npm run workforce -- export-result --result LOCAL_RESULT_JSON --out TRANSFER_BUNDLE
  npm run workforce -- keygen --dir /absolute/operator-only/folder
  npm run workforce -- init --dir /absolute/private/folder --role agent|reviewer --operator-public-key PUBLIC_KEY
  npm run workforce -- bind --config CONFIG --gateway-config OPENCLAW_CONFIG --node-id NODE --provider PROVIDER --account-label ACCOUNT --model-call-reserve USDC --action-reserve USDC --fixed-run-reserve USDC --daily-reserve USDC
  npm run workforce -- bind-app --config CONFIG --app /Applications/Task.app
  npm run workforce -- doctor --config /absolute/native-config.json
  npm run workforce -- add-recipient --config CONFIG --file RECIPIENT_PUBLIC_KEY
  npm run workforce -- descriptor --config /absolute/native-config.json
  npm run workforce -- packet --config CONFIG --spec SPEC --inputs DIR --signing-key KEY --out ENCRYPTED [--delivery DECRYPTED_DELIVERY] [--mode pilot|production]
  npm run workforce -- run --config CONFIG --packet ENCRYPTED --recipient-key KEY
  npm run workforce -- enqueue --config CONFIG --packet ENCRYPTED
  npm run workforce -- watch --config CONFIG --recipient-key KEY
  npm run workforce -- decrypt --packet ENCRYPTED --recipient-key KEY --out PRIVATE_FILE
  npm run workforce -- operations --config CONFIG [--out REPORT]
  npm run workforce -- bill --config CONFIG --run ID --amount USDC --evidence FILE
  npm run workforce -- human-start --config CONFIG --run ID --reason LABEL
  npm run workforce -- human-stop --config CONFIG --run ID --reason LABEL --timer ID
  npm run workforce -- commission-record --config CONFIG --out RECORD
  npm run workforce -- qualify --policy POLICY --evidence EVIDENCE
  npm run workforce -- recover --config CONFIG
  npm run workforce -- install-service --config CONFIG --recipient-key KEY

Open docs/NATIVE_WORKFORCE.html for account setup, independent review, live commissioning and payment integration boundaries. Production requires the complete signed qualification evidence. Native execution does not load a wallet or automatically submit encrypted content to a public job.`;
export function args(argv) {
  const [command = "help", ...rest] = argv,
    out = {};
  need(rest.length % 2 === 0, "ARGUMENTS");
  for (let i = 0; i < rest.length; i += 2) {
    need(
      /^--[a-z-]+$/.test(rest[i]) &&
        rest[i + 1] &&
        !Object.hasOwn(out, rest[i].slice(2)),
      "ARGUMENTS",
    );
    out[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, out };
}
const json = (f) => JSON.parse(readFile(path.resolve(f), 134217728));
const config = (f) => validateConfig(JSON.parse(readSecret(path.resolve(f))));
const output = (file, value) => {
  if (file) atomic(path.resolve(file), value);
  else console.log(JSON.stringify(value, null, 2));
};
function keypair(type, dir, name) {
  const p = crypto.generateKeyPairSync(type);
  atomic(
    path.join(dir, name + "-private.pem"),
    p.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  const pub = p.publicKey.export({ type: "spki", format: "pem" });
  atomic(path.join(dir, name + "-public.pem"), pub);
  return pub;
}
async function init(a) {
  need(
    a.dir && a["operator-public-key"] && ["agent", "reviewer"].includes(a.role),
    "INIT_ARGUMENTS",
  );
  const dir = path.resolve(a.dir);
  privateDir(dir);
  need(fs.readdirSync(dir).length === 0, "INIT_DIRECTORY_MUST_BE_EMPTY");
  const operatorPublicKey = readFile(
    path.resolve(a["operator-public-key"]),
    4096,
  ).toString("utf8");
  need(
    crypto.createPublicKey(operatorPublicKey).asymmetricKeyType === "ed25519",
    "OPERATOR_KEY",
  );
  const recipientPublicKey = keypair("x25519", dir, "recipient");
  const c = {
    schema: "agi-native-config/v1",
    role: a.role,
    dataDir: path.join(dir, "operations"),
    identityDir: path.join(dir, "device"),
    gatewayURL: "http://127.0.0.1:29501",
    gatewayTokenFile: path.join(dir, "gateway-token.txt"),
    gatewayConfigFile: path.join(dir, "openclaw.json"),
    gatewayConfigSha256: "0".repeat(64),
    plannerAgent: "agi-native-planner",
    model: "openai/gpt-6-astra",
    openclawVersion: "2026.9.5",
    nodeId: "REPLACE_WITH_APPROVED_NODE_ID",
    provider: "cua-computer",
    installationSha256: "0".repeat(64),
    appBundlePath: "/Applications/OpenClaw.app",
    resources: ["dedicated-account:REPLACE_WITH_TASK_ACCOUNT"],
    operatorPublicKey,
    recipientPublicKeys: [recipientPublicKey],
    limits: {
      maxActions: 120,
      maxModelCalls: 80,
      maxSeconds: 600,
      maxRuns24h: 20,
    },
    costPolicy: {
      modelCallReserveUSDC: null,
      actionReserveUSDC: null,
      fixedRunReserveUSDC: null,
      maxDailyReserveUSDC: null,
    },
    qualificationPolicyFile: null,
    qualificationEvidenceFile: null,
    revocationFile: null,
    receiptPublicKey: null,
    applications: [],
  };
  c.receiptPublicKey = crypto
    .createPublicKey(createIdentity(c.identityDir).privateKey)
    .export({ format: "pem", type: "spki" });
  atomic(path.join(dir, "native-config.json"), c);
  atomic(path.join(dir, "openclaw-planner-fragment.json"), {
    agents: {
      entries: {
        "agi-native-planner": {
          name: "AGI bounded native planner",
          model: { primary: c.model, fallbacks: [] },
          tools: { deny: ["*"], elevated: { enabled: false } },
        },
      },
    },
  });
  privateDir(path.join(dir, "operations"));
  privateDir(path.join(dir, "operations", "inbox"));
  output(null, {
    created: path.join(dir, "native-config.json"),
    next: "Read docs/NATIVE_WORKFORCE.html. Add the planner to a dedicated OpenClaw gateway and pair the dedicated Mac through its normal approval flow. Keep private keys outside the application archive; exchange only public recipient keys with the reviewer and employer.",
  });
}
async function doctor(c, { save } = {}) {
  verifyPlanner(c);
  need(
    inspectInstallation(c.appBundlePath).installationSha256 ===
      c.installationSha256,
    "NATIVE_INSTALLATION_CHANGED",
  );
  const gateway = new Gateway(c);
  let report;
  try {
    await gateway.connect(AbortSignal.timeout(15000));
    const node = await gateway.node();
    need(
      gateway.hello?.server?.version === c.openclawVersion,
      "OPENCLAW_VERSION_CHANGED",
    );
    report = {
      schema: "agi-native-doctor/v1",
      hardware: inspectHardware(),
      sourceSha256: sourceDigest(),
      runtime: nativeRuntime(c),
      runtimeSha256: core.digest(nativeRuntime(c)),
      node: {
        id: node.nodeId,
        platform: node.platform ?? null,
        permissions: node.permissions ?? null,
        computerUse: node.computerUse,
      },
      gatewayVersion: gateway.hello.server.version,
      checks: {
        paired: true,
        provider: true,
        plannerConfiguration: true,
        capture: false,
        keyboard: false,
        pointer: false,
        liveModel: false,
        reboot: false,
      },
      qualified: false,
    };
    output(save, report);
    return report;
  } finally {
    gateway.close();
  }
}
function decodePacket(a) {
  const envelope = json(a.packet);
  need(envelope.header?.context?.purpose === "job", "JOB_ENVELOPE");
  const plain = open(
    envelope,
    readSecret(path.resolve(a["recipient-key"])),
    envelope.header.context,
  );
  const packet = validatePacket(JSON.parse(plain));
  need(
    core.digest(packet.specification) === envelope.header.context.specSha256,
    "ENVELOPE_SPEC",
  );
  return packet;
}
async function packet(c, a) {
  const spec = core.validateComputerWork(json(a.spec)),
    dir = path.resolve(a.inputs),
    inputs = spec.inputs.map((f) => {
      const file = path.resolve(dir, f.name);
      need(file.startsWith(dir + path.sep), "INPUT_PATH");
      const b = readFile(file, f.maxBytes);
      need(digest(b) === f.sha256, "INPUT_HASH");
      return { name: f.name, content: b.toString("base64") };
    });
  const delivery = a.delivery ? validateDelivery(spec, json(a.delivery)) : null,
    body = grantBody(c, spec, { mode: a.mode ?? "pilot", delivery }),
    grant = signGrant(body, readSecret(path.resolve(a["signing-key"])));
  const p = validatePacket({
    schema: "agi-native-job/v1",
    specification: spec,
    grant,
    inputs,
    delivery,
  });
  const encrypted = seal(Buffer.from(canonical(p)), c.recipientPublicKeys, {
    specSha256: core.digest(spec),
    purpose: "job",
    expiresAt: body.expiresAt,
  });
  output(a.out, encrypted);
}
export async function main(argv = process.argv.slice(2)) {
  const { command, out: a } = args(argv);
  if (["help", "--help"].includes(command)) {
    console.log(usage);
    return;
  }
  if (command === "keygen") {
    const dir = path.resolve(a.dir);
    privateDir(dir);
    need(fs.readdirSync(dir).length === 0, "INIT_DIRECTORY_MUST_BE_EMPTY");
    keypair("ed25519", dir, "operator");
    output(null, {
      directory: dir,
      next: "Keep operator-private.pem in the signing account. Copy only operator-public.pem to the dedicated native account.",
    });
    return;
  }
  if (command === "init") return init(a);
  if (command === "menu") {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      console.log(
        "Private native workforce\n1. Create a private installation\n2. Check a configured Mac\n3. Show operating records\n4. Open the setup guide",
      );
      const n = await rl.question("Choose 1–4: ");
      if (n === "1")
        return init({
          dir: await rl.question("New absolute private folder: "),
          role: await rl.question("Role (agent or reviewer): "),
          "operator-public-key": await rl.question(
            "Absolute operator PUBLIC key file (private key stays in a separate account): ",
          ),
        });
      if (n === "2" || n === "3") {
        const f = await rl.question("Absolute native-config.json path: ");
        return main([n === "2" ? "doctor" : "operations", "--config", f]);
      }
      const guide = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../docs/NATIVE_WORKFORCE.html",
      );
      if (process.platform === "darwin") execFileSync("/usr/bin/open", [guide]);
      else console.log(guide);
    } finally {
      rl.close();
    }
    return;
  }
  if (command === "export-result") {
    const result = json(a.result);
    need(result.receipt && result.output && a.out, "RESULT_EXPORT");
    output(a.out, { receipt: result.receipt, encrypted: json(result.output) });
    return;
  }
  if (command === "decrypt") {
    const e = json(a.packet),
      p = open(
        e,
        readSecret(path.resolve(a["recipient-key"])),
        e.header.context,
      );
    need(a.out, "OUTPUT_REQUIRED");
    atomic(path.resolve(a.out), p.toString("utf8"));
    return;
  }
  if (command === "qualify") {
    const q = qualification.qualifyWorkforce(json(a.policy), json(a.evidence));
    output(a.out, q);
    if (!q.eligible) process.exitCode = 2;
    return;
  }
  if (command === "bind") {
    const file = path.resolve(a.config),
      c = JSON.parse(readSecret(file)),
      g = JSON.parse(readSecret(path.resolve(a["gateway-config"]), 1048576));
    need(
      g.gateway?.bind === "loopback" &&
        g.gateway?.auth?.mode === "token" &&
        typeof g.gateway?.auth?.token === "string",
      "GATEWAY_POLICY",
    );
    const install = inspectInstallation(c.appBundlePath);
    c.installationSha256 = install.installationSha256;
    need(
      typeof a["account-label"] === "string" &&
        /^[A-Za-z0-9_-]{1,80}$/.test(a["account-label"]),
      "ACCOUNT_LABEL",
    );
    c.resources = ["dedicated-account:" + a["account-label"]];
    c.nodeId = a["node-id"];
    c.provider = a.provider;
    c.costPolicy = {
      modelCallReserveUSDC: a["model-call-reserve"],
      actionReserveUSDC: a["action-reserve"],
      fixedRunReserveUSDC: a["fixed-run-reserve"],
      maxDailyReserveUSDC: a["daily-reserve"],
    };
    c.gatewayConfigFile = path.resolve(a["gateway-config"]);
    c.gatewayConfigSha256 = digest(g);
    c.gatewayURL = "http://127.0.0.1:" + g.gateway.port;
    atomic(c.gatewayTokenFile, g.gateway.auth.token);
    validateConfig(c);
    verifyPlanner(c);
    atomic(file, c);
    output(null, {
      bound: true,
      runtimeSha256: core.digest(nativeRuntime(c)),
      hardware: inspectHardware(),
    });
    return;
  }
  const c = config(a.config);
  if (command === "authority-record") {
    need(
      a.out && ["true", "false"].includes(a.disabled),
      "AUTHORITY_ARGUMENTS",
    );
    const key = readSecret(path.resolve(a["signing-key"]));
    need(
      crypto.createPublicKey(key).export({ format: "pem", type: "spki" }) ===
        c.operatorPublicKey,
      "AUTHORITY_SIGNER",
    );
    const lifetime = Number(a["valid-seconds"] ?? 86400);
    need(
      Number.isSafeInteger(lifetime) && lifetime >= 60 && lifetime <= 604800,
      "AUTHORITY_LIFETIME",
    );
    const now = Math.floor(Date.now() / 1000),
      sequence = Number(a.sequence);
    need(Number.isSafeInteger(sequence) && sequence >= 0, "AUTHORITY_SEQUENCE");
    output(
      a.out,
      signAuthority(
        {
          schema: "agi-native-authority/v1",
          nodeId: c.nodeId,
          role: c.role,
          sequence,
          issuedAt: now,
          expiresAt: now + lifetime,
          disabled: a.disabled === "true",
          revokedGrantNonces: a.revoked ? a.revoked.split(",") : [],
        },
        key,
      ),
    );
    return;
  }
  if (command === "bind-app") {
    const app = inspectInstallation(path.resolve(a.app));
    need(
      !c.applications.some((x) => x.bundleId === app.bundleId),
      "DUPLICATE_APPLICATION",
    );
    c.applications.push({
      bundleId: app.bundleId,
      path: app.app,
      installationSha256: app.installationSha256,
    });
    validateConfig(c);
    atomic(path.resolve(a.config), c);
    output(null, {
      capability: "app:" + app.bundleId,
      note: "Runtime identity changed; create fresh specifications, grants and qualification.",
    });
    return;
  }
  if (command === "add-recipient") {
    const publicKey = readFile(path.resolve(a.file), 4096).toString("utf8"),
      id = recipientId(publicKey);
    need(
      !c.recipientPublicKeys.some((k) => recipientId(k) === id),
      "DUPLICATE_RECIPIENT",
    );
    c.recipientPublicKeys.push(publicKey);
    validateConfig(c);
    atomic(path.resolve(a.config), c);
    output(null, {
      added: id,
      note: "Runtime identity changed. Create fresh descriptors, job specifications and grants.",
    });
    return;
  }
  if (command === "enqueue") {
    const bytes = readFile(path.resolve(a.packet), 134217728),
      envelope = JSON.parse(bytes);
    need(
      envelope.header?.schema === "agi-private-envelope/v1" &&
        envelope.header.context?.purpose === "job",
      "JOB_ENVELOPE",
    );
    const name = crypto.randomUUID() + ".json",
      inbox = privateDir(path.join(c.dataDir, "inbox"));
    atomic(path.join(inbox, name), bytes.toString("utf8"));
    output(null, { queued: name });
    return;
  }
  if (command === "descriptor") {
    output(a.out, {
      sourceSha256: sourceDigest(),
      runtime: nativeRuntime(c),
      runtimeSha256: core.digest(nativeRuntime(c)),
    });
    return;
  }
  if (command === "doctor") return doctor(c, { save: a.out });
  if (command === "packet") return packet(c, a);
  if (command === "run") {
    const result = await runNative(c, decodePacket(a), {
      resumeKey: readSecret(path.resolve(a["recipient-key"])),
    });
    output(null, result);
    return;
  }
  if (command === "watch") {
    const inbox = privateDir(path.join(c.dataDir, "inbox")),
      done = privateDir(path.join(c.dataDir, "processed"));
    let stopped = false,
      active;
    for (const s of ["SIGTERM", "SIGINT"])
      process.on(s, () => {
        stopped = true;
        active?.abort();
      });
    while (!stopped) {
      for (const name of fs
        .readdirSync(inbox)
        .filter((x) => /^[a-zA-Z0-9_-]+\.json$/.test(x))
        .sort()) {
        if (stopped) break;
        const file = path.join(inbox, name);
        active = new AbortController();
        let result;
        try {
          result = await runNative(c, decodePacket({ ...a, packet: file }), {
            signal: active.signal,
            resumeKey: readSecret(path.resolve(a["recipient-key"])),
          });
        } catch (e) {
          result = {
            status: "blocked",
            error: /^WORKFORCE_|^COMPUTER_|^EXECUTION_/.test(e.message)
              ? e.message
              : "REQUEST_FAILED",
          };
        } finally {
          active = null;
        }
        if (stopped) break;
        if (
          /WORKFORCE_(GATEWAY_(TIMEOUT_UNCERTAIN|DISCONNECTED|CLOSED|UNAVAILABLE)|MODEL_UNAVAILABLE|PROVIDER_RESTARTED|NODE_NOT_READY)$/.test(
            result.error ?? "",
          )
        )
          break;
        if (result.receipt && result.output)
          atomic(path.join(done, name + ".transfer.json"), {
            receipt: result.receipt,
            encrypted: json(result.output),
          });
        atomic(path.join(done, name + ".result"), result);
        fs.renameSync(
          file,
          path.join(
            done,
            digest(readFile(file, 134217728)) + ".encrypted.json",
          ),
        );
        if (fs.existsSync(path.join(c.dataDir, "RECOVERY_REQUIRED.json"))) {
          stopped = true;
          process.exitCode = 2;
          break;
        }
      }
      if (!stopped) await delay(5000);
    }
    return;
  }
  if (command === "commission-record") {
    need(a.out, "OUTPUT_REQUIRED");
    const report = await doctor(c, {});
    report.rehearsalRequired = [
      "capture and actual keyboard/pointer effect",
      "signed-in task-account authority",
      "live model and artifact round trip",
      "restart then reboot without replay",
      "independent held-out jobs and cost reconciliation",
    ];
    output(a.out, report);
    return;
  }
  if (command === "recover") {
    const j = new Journal(c.dataDir),
      g = new Gateway(c);
    try {
      await g.connect(AbortSignal.timeout(15000));
      output(null, await reconcileExecutions(c, j, g));
    } finally {
      g.close();
      j.close();
    }
    return;
  }
  if (command === "install-service") {
    need(process.platform === "darwin" && a["recipient-key"], "MAC_SERVICE");
    const home = os.homedir(),
      dir = path.join(home, "Library/LaunchAgents");
    fs.mkdirSync(dir, { recursive: true });
    const label = "ai.montreal.agi.native." + c.role,
      xml = (x) =>
        x
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
    const values = [
      process.execPath,
      fileURLToPath(import.meta.url),
      "watch",
      "--config",
      path.resolve(a.config),
      "--recipient-key",
      path.resolve(a["recipient-key"]),
    ];
    const file = path.join(dir, label + ".plist");
    need(!fs.existsSync(file), "SERVICE_EXISTS");
    fs.writeFileSync(
      file,
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>' +
        label +
        "</string><key>ProgramArguments</key><array>" +
        values.map((x) => "<string>" + xml(x) + "</string>").join("") +
        "</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer></dict></plist>",
      { flag: "wx", mode: 0o600 },
    );
    execFileSync(
      "/bin/launchctl",
      ["bootstrap", "gui/" + process.getuid(), file],
      { timeout: 15000 },
    );
    output(null, {
      installed: label,
      scope:
        "Starts after login; does not unlock FileVault, grant permissions, or create job authority.",
    });
    return;
  }
  const j = new Journal(c.dataDir, { observer: true });
  try {
    if (command === "operations") output(a.out, j.report());
    else if (command === "bill") {
      j.reconcileCost(
        a.run,
        a.amount,
        digest(readFile(path.resolve(a.evidence), 67108864)),
      );
      output(null, { recorded: true });
    } else if (command === "human-start")
      output(null, { timer: j.intervention(a.run, a.reason) });
    else if (command === "human-stop")
      output(null, { seconds: j.intervention(a.run, a.reason, a.timer) });
    else throw Error("WORKFORCE_UNKNOWN_COMMAND");
  } finally {
    j.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(
      /^(WORKFORCE|COMPUTER|EXECUTION)_/.test(e.message)
        ? e.message
        : "WORKFORCE_COMMAND_FAILED: check the guide, paths and private configuration.",
    );
    process.exitCode = 1;
  });
