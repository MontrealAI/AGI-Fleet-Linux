import {createPublicWebReport,publicWebReportView,projectQualificationStatus} from './public-web-report.mjs';
import {sendCloudReviewResult} from '../cloud-review-result.mjs';
import {createExecutionAdmission,validateExecutionAdmission} from '../public-web-admission.mjs';
import {ensurePublicWebAuthority} from './public-web-authority.mjs';
import {releaseCompatibility} from './compatibility.mjs';
import {addBackupIntegrity,backupHash,verifyDownloadedBackup,backupProgress} from './backup-verification.mjs';
import {loadReleaseProfile,upgradeStatus,compareExpectedAddress,assertRestoreWallet} from './release-profile.mjs';
import {collectPreflight,sanitizeDiagnostics} from './system-preflight.mjs';
import { captureOperational, stageOperational, checkBackupSize } from './operational-state.mjs';
import { isSeedProfile } from './wallet-profile.mjs';
import { createSeedWallet, importSeedWallet, checkRecovery, publicRecovery } from './wallet-recovery.mjs';
import { Studio } from './studio.mjs';
import {isComputerSpec,computerVerdict} from '../artifacts.mjs';
import { isImageSpec, visionVerdict } from '../images.mjs';
import { VERSION } from "../version.mjs";
import { Pilot } from "./pilot.mjs";
import { Operations } from "./operations.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Wallet, getAddress, formatUnits, parseUnits, ZeroHash } from "ethers";
import { DEFAULT, validateConfig, binding } from "../config.mjs";
import { Store } from "../store.mjs";
import {
  ROOT,
  atomicWrite,
  privateDir,
  readJSON,
  ensure,
  sha256,
  canonical,
  encode,
} from "../util.mjs";
import { connectChain, validRPC } from "../rpc.mjs";
import { Vault, sealBackup, openBackup } from "./vault.mjs";
import { Keychain, setBackground } from "./os-integration.mjs";
import { publicError, explain } from "./messages.mjs";
import { boundedJSON, validateSpec, evaluate } from "../review.mjs";
import { Companion, safeSnapshot, validateCompanion } from "./companion.mjs";
async function boundedResponse(response, limit, code) {
  let size = 0;
  const parts = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    ensure(size <= limit, code);
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

export function defaultHome() {
  return (
    process.env.AGI_NODE_HOME ??
    path.join(
      os.homedir(),
      process.platform === "darwin"
        ? "Library/Application Support/MONTREAL.AI/AGI Node"
        : process.platform === "win32"
          ? "AppData/Local/MONTREAL.AI/AGI Node"
          : ".local/share/montreal-ai/agi-node",
    )
  );
}
const freshSettings = () => ({
  schema: 2,
  backupSaved: false,
  remember: false,
  background: false,
  resumeOnLaunch: false,
  lastMode: "observe",
  notifications: false,
  language: "en",
  incidents: [],
  restored: false,
});
export class Controller {
  constructor(home = defaultHome(), options = {}) {
    privateDir(home);
    ensure(
      !fs.existsSync(path.join(home, "restore-in-progress.json")),
      "RESTORE_INTERRUPTED_RECOVERY_REQUIRED",
    );
    this.home = home;
    this.configFile = path.join(home, "node.config.json");
    this.pinFile = path.join(home, "data/deployment.json");
    this.stateFile = path.join(home, "app-state.json");
    this.vault = new Vault(home);
    this.keychain = options.keychain ?? new Keychain(home);
    this.connect = options.connect ?? connectChain;
    this.spawn = options.spawn ?? fork;
    this.worker = null;
    this.workerMode = null;
    this.operation = null;
    this.metrics = {};
    this.health = null;
    this.desired = false;
    this.failures = [];
    this.restartTimer = null;
    this.challenge = null;
    this.recoveryChallenge = null;
    this.labHistory = [];
    this.backupIssued = false; this.backupVerified = null;
    this.settings = fs.existsSync(this.stateFile)
      ? { ...freshSettings(), ...readJSON(this.stateFile) }
      : freshSettings();
    this.companionOptions = {...(options.companion ?? {}), publicWebAuthority: () => this.vault.get("publicWebAuthority")};
    this.companion = new Companion(
      home,
      () => this.vault.get("openclawToken"),
      this.companionOptions,
    );
    this.config = fs.existsSync(this.configFile)
      ? validateConfig(readJSON(this.configFile), home)
      : validateConfig(
          { ...structuredClone(DEFAULT), chainId: 11155111 },
          home,
        );
    const release=loadReleaseProfile(home,{hasState:this.vault.exists,role:"node",version:VERSION,address:this.config.validator,kind:isSeedProfile(home)?"seed":"original",previousVersion:"2.20.0"});
    this.releaseProfile=release.profile;
    if(release.upgraded){this.settings.backupSaved=false;this.settings.backupReceipt=null;this.saveState();fs.rmSync(path.join(this.config.dataDir,"activation.json"),{force:true});}
    this.studio = new Studio(this, "node", VERSION);
    this.operations = new Operations(this, "node", VERSION);
    this.pilot = new Pilot(this, "node", VERSION);
    privateDir(this.config.dataDir);
    const running = path.join(this.config.dataDir, "RUNNING.lock");
    if (fs.existsSync(running)) {
      const record = readJSON(running);
      if (Number.isSafeInteger(record.pid) && record.pid > 0)
        this.cleanupLock(record.pid);
    }
  }
  assertOperationsReady() {
    this.operations.assertReady();
  }
  saveState() {
    atomicWrite(this.stateFile, JSON.stringify(this.settings, null, 2) + "\n");
  }
  incident(code) {
    const e = explain(code),
      last = this.settings.incidents[0];
    if (last?.code === code && Date.now() - Date.parse(last.at) < 300000)
      return;
    this.settings.incidents.unshift({ ...e, at: new Date().toISOString() });
    this.settings.incidents = this.settings.incidents.slice(0, 40);
    this.saveState();
  }
  async mutate(label, work, { interruptStudio = false, operationKind = null } = {}) {
    this.assertRestoreReady();
    ensure(!this.operation && !this.cancellationDepth, "OPERATION_IN_PROGRESS");
    ensure(!this.publicWebCommissioningBusy||interruptStudio,"COMPANION_BUSY");
    ensure(!this.studio?.busy || interruptStudio, "STUDIO_BUSY");
    this.operation = label; this.operationKind = operationKind;
    try {
      if (interruptStudio) await this.studio?.cancel();
      return await work();
    } finally {
      this.operation = null; this.operationKind = null;
    }
  }
  assertRestoreReady() {
    if (this.restoreFailed || fs.existsSync(path.join(this.home, "restore-in-progress.json"))) {
      this.vault.lock();
      this.recoveryChallenge = null;
      this.challenge = null;
      throw new Error("RESTORE_INTERRUPTED_RECOVERY_REQUIRED");
    }
  }
  requireStopped({allowIdentityApproval=false}={}) {
    this.assertRestoreReady();
    ensure(!this.publicWebCommissioningBusy && (allowIdentityApproval || !this.companion.approvalReservation),"COMPANION_BUSY");
    ensure(!this.studio?.busy, "STUDIO_BUSY");
    ensure(!this.worker && !this.desired, "STOP_BEFORE_CHANGING_SETTINGS");
    ensure(
      !fs.existsSync(path.join(this.config.dataDir, "RUNNING.lock")),
      "ANOTHER_WORKER_IS_RUNNING",
    );
  }
  pin() {
    return fs.existsSync(this.pinFile) ? readJSON(this.pinFile) : null;
  }
  configPublic() {
    const c = this.config;
    return {
      chainId: c.chainId,
      manager: c.manager,
      deploymentBlock: c.deploymentBlock,
      validator: c.validator,
      label: c.label,
      proof: c.proof,
      trustedBuyers: c.trustedBuyers,
      excludedParties: c.excludedParties,
      independenceReviewed: c.independenceReviewed,
      limits: c.limits,
      allowedHttpsHosts: c.allowedHttpsHosts,
      ipfsGateway: c.ipfsGateway,
      autoClaim: c.autoClaim,
      autoFinalizeOwnJobs: c.autoFinalizeOwnJobs,
      reviewConcurrency: c.reviewConcurrency,
      maxReviewsPerCycle: c.maxReviewsPerCycle,
      ai: c.ai,
    };
  }
  dbRead(work) {
    const file = path.join(this.config.dataDir, "node.sqlite");
    if (!fs.existsSync(file)) return null;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return work(db);
    } finally {
      db.close();
    }
  }
  status() {
    let data = this.dbRead((db) => {
      const meta = (k) => {
        const row = db.prepare("SELECT value FROM meta WHERE key=?").get(k);
        return row ? JSON.parse(row.value) : null;
      };
      const recent = db
        .prepare(
          "SELECT kind,bond,gas_budget,accounted,state FROM txs WHERE accounted>=? OR state='pending'",
        )
        .all(Math.floor(Date.now() / 1000) - 86400);
      const gas = recent.reduce((s, t) => s + BigInt(t.gas_budget), 0n),
        bonds = recent
          .filter((t) => t.kind === "vote")
          .reduce((s, t) => s + BigInt(t.bond), 0n);
      return {
        runtime: meta("runtime"),
        cursor: meta("cursor"),
        counts: db
          .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
          .all(),
        votedTotal: db
          .prepare("SELECT COUNT(*) AS n FROM jobs WHERE my_vote=1")
          .get().n,
        pending:
          db
            .prepare(
              "SELECT hash,kind,job,created FROM txs WHERE state='pending'",
            )
            .get() ?? null,
        jobs: db
          .prepare(
            "SELECT id,status,reason,created_block,my_vote,review FROM jobs ORDER BY created_block DESC,id DESC LIMIT 40",
          )
          .all()
          .map((row) => ({
            ...row,
            review: row.review ? JSON.parse(row.review) : null,
            explanation: explain(row.reason),
          })),
        transactions: db
          .prepare(
            "SELECT hash,kind,job,state,status,accounted FROM txs ORDER BY created DESC LIMIT 20",
          )
          .all(),
        budgets: {
          gasUsedETH: formatUnits(gas, 18),
          bondUsedUSDC: formatUnits(bonds, 6),
          transactions: recent.length,
          gasLimitETH: this.config.limits.maxGas24hETH,
          bondLimitUSDC: this.config.limits.maxBond24hUSDC,
          transactionLimit: this.config.limits.maxTransactions24h,
        },
      };
    });
    data ??= {
      runtime: null,
      cursor: null,
      counts: [],
      votedTotal: 0,
      pending: null,
      jobs: [],
      transactions: [],
      budgets: {
        gasUsedETH: "0",
        bondUsedUSDC: "0",
        transactions: 0,
        gasLimitETH: this.config.limits.maxGas24hETH,
        bondLimitUSDC: this.config.limits.maxBond24hUSDC,
        transactionLimit: this.config.limits.maxTransactions24h,
      },
    };
    const paused = fs.existsSync(path.join(this.config.dataDir, "STOP"));
    return {
      version: VERSION,
      compatibility: releaseCompatibility(),
      backup: backupProgress({issued:this.backupIssued,verified:this.backupVerified,receipt:this.settings.backupReceipt,saved:this.settings.backupSaved}),
      upgrade: upgradeStatus(this.releaseProfile,this.config.validator,fs.existsSync(path.join(this.config.dataDir,"node.sqlite"))),
      platform: process.platform,
      operation: this.operation,
      vaultExists: this.vault.exists,
      unlocked: this.vault.unlocked,
      rpcConfigured: this.vault.unlocked
        ? Boolean(this.vault.get("rpcURL"))
        : null,
      walletPresent: Boolean(this.config.validator),
      walletRecovery: publicRecovery(this.vault, this.config.validator),
      walletProfile: isSeedProfile(this.home) ? "seed" : "original",
      configured: fs.existsSync(this.configFile),
      enrolled: Boolean(this.pin()),
      running: Boolean(this.worker),
      mode: this.workerMode ?? "stopped",
      paused,
      restarting: this.desired && !this.worker,
      config: this.configPublic(),
      health: this.health,
      metrics: this.metrics,
      settings: {
        backupSaved: this.settings.backupSaved,
        remember: this.settings.remember,
        background: this.settings.background,
        resumeOnLaunch: this.settings.resumeOnLaunch,
        notifications: this.settings.notifications,
        language: this.settings.language,
        restored: this.settings.restored,
      },
      keychainSupported: this.keychain.supported,
      backgroundSupported: ["darwin","linux"].includes(process.platform),
      incidents: this.settings.incidents,
      companion: this.companion.status(),
      operations: this.operations.summary(),
      ...data,
    };
  }
  async boot() {
    this.assertRestoreReady();
    this.operations.start();
    this.companion.startAutomatic(
      () => this.companionSnapshot(),
      () => this.vault.unlocked && !this.operation && !this.studio?.busy && !this.publicWebCommissioningBusy,
    );
    if (this.settings.remember && this.vault.exists) {
      try {
        this.vault.unlockKey(await this.keychain.get());
        this.reconcileWallet();
      } catch {
        this.vault.lock();
        this.incident("OS_CREDENTIAL_UNAVAILABLE");
      }
    }
    if (this.vault.unlocked && this.settings.resumeOnLaunch) {
      try {
        await this.start(this.settings.lastMode);
      } catch (e) {
        this.incident(publicError(e).code);
      }
    }
  }
  async createVault(password) {
    this.assertRestoreReady();
    await this.vault.create(password);
    this.saveState();
    return { created: true };
  }
  async unlock(password) {
    this.assertRestoreReady();
    await this.vault.unlock(password);
    try { this.reconcileWallet(); } catch (e) { this.vault.lock(); throw e; }
    return { unlocked: true };
  }
  async lock() {
    await this.stop();
    await this.companion.cancel();
    this.vault.lock();
    this.recoveryChallenge = null;
    return { locked: true };
  }
  invalidate() {
    fs.rmSync(path.join(this.config.dataDir, "activation.json"), {
      force: true,
    });
    this.challenge = null;
    this.health = null;
    this.settings.backupSaved = false;
    this.backupIssued = false; this.backupVerified = null;
    this.saveState();
  }
  async saveConfig(input) {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    const allowed = [
      "chainId",
      "manager",
      "deploymentBlock",
      "label",
      "proof",
      "trustedBuyers",
      "excludedParties",
      "independenceReviewed",
      "limits",
      "allowedHttpsHosts",
      "ipfsGateway",
      "autoClaim",
      "autoFinalizeOwnJobs",
      "reviewConcurrency",
      "maxReviewsPerCycle",
      "ai",
    ];
    ensure(
      Object.keys(input).every((k) => allowed.includes(k)),
      "CONFIG_UNKNOWN_FIELD",
    );
    ensure(
      !this.dbRead((db) =>
        db.prepare("SELECT 1 FROM txs WHERE state='pending' LIMIT 1").get(),
      ),
      "PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST",
    );
    const old = this.config;
    if (
      (input.excludedParties &&
        JSON.stringify(input.excludedParties) !==
          JSON.stringify(old.excludedParties)) ||
      (input.label !== undefined && input.label !== old.label)
    )
      input = { ...input, independenceReviewed: false };
    if (input.ai?.cloudVeto) {
      ensure(input.ai.cloudPublicOnly === true, "CLOUD_PUBLIC_DATA_REQUIRED");
      ensure(
        this.companion.config.enabled && this.companion.status().connected,
        "COMPANION_TEST_REQUIRED",
      );
    }
    const next = validateConfig(
      {
        ...old,
        ...input,
        dataDir: path.join(this.home, "data"),
        keystore: path.join(this.home, "data/validator.keystore.json"),
      },
      this.home,
    );
    const targetChanged =
      old.chainId !== next.chainId ||
      old.manager.toLowerCase() !== next.manager.toLowerCase() ||
      old.deploymentBlock !== next.deploymentBlock;
    if (targetChanged && fs.existsSync(path.join(old.dataDir, "node.sqlite")))
      throw new Error("NEW_DEPLOYMENT_REQUIRES_SEPARATE_WORKSPACE");
    this.config = next;
    atomicWrite(this.configFile, JSON.stringify(next, null, 2) + "\n");
    if (targetChanged) fs.rmSync(this.pinFile, { force: true });
    this.invalidate();
    return this.configPublic();
  }
  async saveRPC(url, verificationURL = undefined) {
    this.requireStopped();
    const values = { rpcURL: validRPC(url) };
    if (verificationURL !== undefined)
      values.verificationRPCURL = verificationURL
        ? validRPC(verificationURL)
        : null;
    const second =
      values.verificationRPCURL ?? this.vault.get("verificationRPCURL");
    if (second)
      ensure(
        this.config.chainId === 31337
          ? url !== second
          : new URL(url).hostname !== new URL(second).hostname,
        "RPC_PROVIDERS_MUST_DIFFER",
      );
    this.vault.set(values);
    this.invalidate();
    this.health = null;
    this.settings.backupSaved = false;
    this.backupIssued = false; this.backupVerified = null;
    this.saveState();
    return { saved: true };
  }
  async wallet(kind, options = {}) {
    this.requireStopped();
    ensure(
      !this.config.validator && !this.vault.get("privateKey"),
      "WALLET_ALREADY_CONFIGURED",
    );
    let wallet, recovery = null;
    if (kind === "create") ({ wallet, recovery } = createSeedWallet(options.wordCount ?? 24));
    else if (kind === "phrase") {
      ensure(options.acknowledgeHistory === true, "RECOVERY_HISTORY_ACKNOWLEDGEMENT");
      ({ wallet, recovery } = importSeedWallet(options));
    }
    else {
      ensure(
        kind === "import" &&
          typeof options.keystore === "string" &&
          options.keystore.length <= 1048576 &&
          typeof options.password === "string",
        "WALLET_IMPORT_FORMAT",
      );
      const parsed = JSON.parse(options.keystore),
        params = (parsed.crypto ?? parsed.Crypto)?.kdfparams;
      ensure(
        params &&
          ((Number.isInteger(params.n) &&
            params.n >= 2 &&
            params.n <= 262144 &&
            Number.isInteger(params.r) &&
            params.r >= 1 &&
            params.r <= 8 &&
            Number.isInteger(params.p) &&
            params.p >= 1 &&
            params.p <= 4) ||
            (Number.isInteger(params.c) &&
              params.c >= 1 &&
              params.c <= 1000000)),
        "KEYSTORE_KDF_LIMIT",
      );
      wallet = await Wallet.fromEncryptedJson(
        options.keystore,
        options.password,
      );
    }
    if (kind === "phrase") this.settings.restored = true;
    this.invalidate();
    this.vault.set({ privateKey: wallet.privateKey, walletRecovery: recovery });
    this.config.validator = wallet.address;
    atomicWrite(this.configFile, JSON.stringify(this.config, null, 2) + "\n");
    return { address: wallet.address, recovery: publicRecovery(this.vault, wallet.address) };
  }
  reconcileWallet() {
    const key = this.vault.get("privateKey");
    if (!key) { ensure(!this.config.validator, "RECOVERY_RECORD_MISMATCH"); return; }
    const address = new Wallet(key).address;
    ensure(!this.config.validator || getAddress(this.config.validator) === address, "RECOVERY_RECORD_MISMATCH");
    const recovery = this.vault.get("walletRecovery");
    if (recovery) checkRecovery(recovery, key, address);
    if (!this.config.validator) {
      this.config.validator = address;
      atomicWrite(this.configFile, JSON.stringify(this.config, null, 2) + "\n");
      this.invalidate();
    }
  }
  requireRecoveryConfirmed() {
    const recovery = this.vault.get("walletRecovery");
    if (recovery) {
      checkRecovery(recovery, this.vault.get("privateKey"), this.config.validator);
      ensure(recovery.confirmed === true, "RECOVERY_CONFIRMATION_REQUIRED");
    }
  }
  requireBackupConfirmed() {
    ensure(this.settings.backupSaved && this.settings.backupReceipt?.currentReady && this.settings.backupReceipt.profileID===this.releaseProfile.id, "BACKUP_REQUIRED");
  }
  async revealRecovery(password) {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    await this.vault.verifyPassword(password);
    const r = this.vault.get("walletRecovery");
    ensure(r, "RECOVERY_PHRASE_UNAVAILABLE");
    checkRecovery(r, this.vault.get("privateKey"), this.config.validator);
    const indices = new Set();
    const words = r.phrase.split(' ');
    while (indices.size < 3) indices.add(crypto.randomInt(words.length));
    const challenge = { token: crypto.randomBytes(32).toString('hex'), indices: [...indices].sort((a,b) => a-b), expiresAt: Date.now() + 5 * 60000, address: r.address };
    this.recoveryChallenge = challenge;
    return { phrase: r.phrase, path: r.path, address: r.address, wordCount: words.length, hasPassphrase: r.passphrase !== '', ...challenge, displaySeconds: 120 };
  }
  confirmRecovery({ token, answers, passphrase = '' } = {}) {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    const c = this.recoveryChallenge;
    this.recoveryChallenge = null;
    ensure(c && typeof token === 'string' && token.length === 64 && token === c.token && Date.now() < c.expiresAt, "RECOVERY_CHALLENGE_EXPIRED");
    const r = checkRecovery(this.vault.get("walletRecovery"), this.vault.get("privateKey"), this.config.validator);
    ensure(c.address === r.address && Array.isArray(answers) && answers.length === 3 && answers.every((word, i) => typeof word === 'string' && word.trim().toLowerCase() === r.phrase.split(' ')[c.indices[i]]), "RECOVERY_WORDS_INCORRECT");
    ensure(typeof passphrase === 'string' && passphrase.normalize('NFKD') === r.passphrase, "RECOVERY_PASSPHRASE_INCORRECT");
    this.invalidate();
    this.vault.set({ walletRecovery: { ...r, confirmed: true } });
    return { confirmed: true };
  }
  async discover(receiptHash) {
    this.requireStopped();
    ensure(
      /^0x[0-9a-fA-F]{64}$/.test(receiptHash),
      "DEPLOYMENT_TRANSACTION_REQUIRED",
    );
    const chain = this.connect(
      this.config,
      this.vault.get("rpcURL"),
      this.vault.get("verificationRPCURL"),
    );
    try {
      await chain.head();
      const r = await chain.provider.getTransactionReceipt(receiptHash);
      ensure(
        r?.status === 1 && r.contractAddress,
        "DIRECT_DEPLOYMENT_RECEIPT_REQUIRED",
      );
      await this.saveConfig({
        manager: getAddress(r.contractAddress),
        deploymentBlock: r.blockNumber,
      });
      return {
        manager: this.config.manager,
        deploymentBlock: this.config.deploymentBlock,
      };
    } finally {
      chain.provider.destroy();
    }
  }
  async enroll() {
    this.requireStopped();
    validateConfig(this.config, this.home, { ready: true });
    const chain = this.connect(
      this.config,
      this.vault.get("rpcURL"),
      this.vault.get("verificationRPCURL"),
    );
    try {
      const pin = await chain.enroll();
      const existing = this.pin();
      if (existing)
        ensure(
          binding(this.config, existing) === binding(this.config, pin),
          "DEPLOYMENT_PIN_MISMATCH",
        );
      else atomicWrite(this.pinFile, JSON.stringify(pin, null, 2) + "\n");
      return await this.checkHealthWith(chain, pin);
    } finally {
      chain.provider.destroy();
    }
  }
  async checkHealthWith(chain, pin) {
    await chain.verify(pin);
    const c = this.config,
      [credential, blacklisted, eth, usdc, allowance, nonce] =
        await Promise.all([
          chain.manager.validatorCredential(c.validator, c.label, c.proof),
          chain.manager.blacklistedValidators(c.validator),
          chain.provider.getBalance(c.validator),
          chain.token.balanceOf(c.validator),
          chain.token.allowance(c.validator, c.manager),
          chain.provider.getTransactionCount(c.validator, "latest"),
        ]);
    this.health = {
      checkedAt: new Date().toISOString(),
      contract: true,
      eligible: credential[0] !== ZeroHash && !blacklisted,
      eth: formatUnits(eth, 18),
      usdc: formatUnits(usdc, 6),
      allowanceUSDC: formatUnits(allowance, 6),
      walletNonce: nonce,
      controller: credential[1],
      chainId: c.chainId,
    };
    this.verification = chain.provider.verification ?? null;
    this.finalized = chain.lastFinalized ?? null;
    return this.health;
  }
  async check() {
    validateConfig(this.config, this.home, { ready: true });
    ensure(this.pin(), "ENROLL_DEPLOYMENT_FIRST");
    const chain = this.connect(
      this.config,
      this.vault.get("rpcURL"),
      this.vault.get("verificationRPCURL"),
    );
    try {
      return await this.checkHealthWith(chain, this.pin());
    } finally {
      chain.provider.destroy();
    }
  }
  async activationChallenge() {
    this.requireStopped();
    this.assertOperationsReady();
    ensure(!this.settings.restored, "RESTORE_RECONCILIATION_REQUIRED");
    ensure(this.vault.get("privateKey"), "WALLET_REQUIRED");
    this.requireRecoveryConfirmed();
    this.requireBackupConfirmed();
    const health = await this.check();
    ensure(health.eligible, "VALIDATOR_NOT_ELIGIBLE");
    ensure(parseUnits(health.eth, 18) > 0n, "INSUFFICIENT_ETH");
    const maxKnown = this.dbRead(
      (db) => db.prepare("SELECT MAX(nonce) AS nonce FROM txs").get().nonce,
    );
    ensure(
      health.walletNonce === 0 ||
        (maxKnown !== null &&
          maxKnown !== undefined &&
          health.walletNonce <= maxKnown + 1),
      "USED_WALLET_REQUIRES_HISTORY",
    );
    this.challenge = {
      id: crypto.randomBytes(32).toString("hex"),
      until: Date.now() + 120000,
      binding: binding(this.config, this.pin()),
    };
    return {
      id: this.challenge.id,
      chainId: this.config.chainId,
      validator: this.config.validator,
      manager: this.config.manager,
      limits: this.config.limits,
    };
  }
  async activate(value) {
    this.requireStopped();
    this.requireBackupConfirmed();
    ensure(
      value.acknowledgeRisk === true && value.independentReview === true,
      "ACTIVATION_ACKNOWLEDGEMENT",
    );
    const challenge = this.challenge;
    this.challenge = null;
    ensure(
      challenge &&
        challenge.id === value.id &&
        challenge.until > Date.now() &&
        challenge.binding === binding(this.config, this.pin()),
      "ACTIVATION_EXPIRED",
    );
    atomicWrite(
      path.join(this.config.dataDir, "activation.json"),
      JSON.stringify(
        {
          binding: challenge.binding,
          validator: getAddress(this.config.validator),
          activatedAt: new Date().toISOString(),
          interface: "operator-v2",
        },
        null,
        2,
      ) + "\n",
    );
    return { authorized: true };
  }
  async start(mode) {
    this.assertRestoreReady();
    ensure(!this.publicWebCommissioningBusy && !this.companion.approvalReservation,"COMPANION_BUSY");
    ensure(!this.studio?.busy, "STUDIO_BUSY");
    ensure(["observe", "live"].includes(mode), "RUN_MODE");
    ensure(!this.worker && !this.desired, "ALREADY_RUNNING");
    ensure(this.vault.unlocked, "NODE_LOCKED");
    if (mode === "live") this.requireBackupConfirmed();
    if (this.config.ai.cloudVeto)
      ensure(
        this.companion.config.enabled && this.companion.status().connected,
        "COMPANION_TEST_REQUIRED",
      );
    validateConfig(this.config, this.home, { ready: true });
    ensure(this.pin(), "ENROLL_DEPLOYMENT_FIRST");
    if (mode === "live") {
      this.assertOperationsReady();
      ensure(
        !fs.existsSync(path.join(this.config.dataDir, "STOP")),
        "NODE_PAUSED",
      );
      ensure(!this.settings.restored, "RESTORE_RECONCILIATION_REQUIRED");
      ensure(this.vault.get("privateKey"), "WALLET_REQUIRED");
    this.requireRecoveryConfirmed();
      ensure(
        fs.existsSync(path.join(this.config.dataDir, "activation.json")),
        "LIVE_NOT_ACTIVATED",
      );
      const a = readJSON(path.join(this.config.dataDir, "activation.json"));
      ensure(
        a.binding === binding(this.config, this.pin()),
        "ACTIVATION_SCOPE_CHANGED",
      );
    }
    this.desired = true;
    this.workerMode = mode;
    this.settings.lastMode = mode;
    this.saveState();
    this.spawnWorker();
    return { started: true, mode };
  }
  cleanupLock(pid) {
    const file = path.join(this.config.dataDir, "RUNNING.lock");
    if (!fs.existsSync(file)) return;
    try {
      const lock = readJSON(file);
      if (lock.pid !== pid) return;
      try {
        process.kill(pid, 0);
        return;
      } catch (e) {
        if (e.code !== "ESRCH") return;
      }
      fs.unlinkSync(file);
    } catch {}
  }
  spawnWorker() {
    if (!this.desired || !this.vault.unlocked) return;
    const child = this.spawn(path.join(ROOT, "src/worker.mjs"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: Object.fromEntries(
        [
          "PATH",
          "TMPDIR",
          "TMP",
          "TEMP",
          "LANG",
          "LC_ALL",
          "SystemRoot",
          "WINDIR",
        ]
          .filter((k) => process.env[k] !== undefined)
          .map((k) => [k, process.env[k]]),
      ),
    });
    this.worker = child;
    child.on("message", (m) => {
      if (m.type === "cloud-review") {
        void sendCloudReviewResult(child,m.id,this.cloudReview(m));
      } else if (m.type === "cycle") {
        this.metrics = m.metrics;
        this.lastCycle = Date.now();
        if (m.passed) this.lastSuccessfulCycle = this.lastCycle;
        this.lastCyclePassed = m.passed === true;
        this.verification = m.verification;
        this.finalized = m.finalized;
        if (m.health) this.health = m.health;
      } else if (["fatal", "issue"].includes(m.type)) {
        this.health = null;
        this.incident(m.code);
        if (m.type === "fatal") this.desired = false;
      }
    });
    child.on("error", () => {
      this.desired = false;
      this.worker = null;
      this.incident("WORKER_START_FAILED");
    });
    child.on("exit", () => {
      if (this.worker !== child) return;
      this.worker = null;
      this.cleanupLock(child.pid);
      if (!this.desired) return;
      this.failures = this.failures.filter((t) => Date.now() - t < 600000);
      this.failures.push(Date.now());
      if (this.failures.length >= 5) {
        this.desired = false;
        this.incident("RESTART_LIMIT_REACHED");
        return;
      }
      this.incident("WORKER_RESTARTING");
      this.restartTimer = setTimeout(
        () => this.spawnWorker(),
        Math.min(60000, 2000 * 2 ** (this.failures.length - 1)),
      );
    });
    child.send({
      type: "start",
      mode: this.workerMode,
      config: this.config,
      pin: this.pin(),
      rpcURL: this.vault.get("rpcURL"),
      verificationRPCURL: this.vault.get("verificationRPCURL"),
      ...(this.workerMode === "live"
        ? { privateKey: this.vault.get("privateKey") }
        : {}),
    });
  }
  async stop() {
    await this.studio?.cancel();
    this.desired = false;
    clearTimeout(this.restartTimer);
    await this.companion.cancel();
    const child = this.worker;
    if (!child) {
      this.workerMode = null;
      return { stopped: true };
    }
    const stopFile = path.join(this.config.dataDir, "STOP"),
      marker = "STOPPING_" + crypto.randomUUID();
    const temporaryPause = !fs.existsSync(stopFile);
    if (temporaryPause) atomicWrite(stopFile, marker);
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 90000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      if (child.connected) child.send({ type: "stop" });
      else child.kill("SIGTERM");
    });
    if (
      temporaryPause &&
      fs.existsSync(stopFile) &&
      fs.readFileSync(stopFile, "utf8") === marker
    )
      fs.unlinkSync(stopFile);
    this.workerMode = null;
    return { stopped: true };
  }
  pause() {
    atomicWrite(path.join(this.config.dataDir, "STOP"), "OPERATOR_PAUSED\n");
    return { paused: true };
  }
  async resume() {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    const file = path.join(this.config.dataDir, "STOP");
    if (fs.existsSync(file)) {
      const reason = fs.readFileSync(file, "utf8");
      ensure(
        !/REORG|NONCE|CODE_CHANGED|PIN_MISMATCH|JOURNAL|CLOCK_CHANGED/.test(
          reason,
        ),
        "SECURITY_RECONCILIATION_REQUIRED",
      );
    }
    await this.check();
    fs.rmSync(file, { force: true });
    return { resumed: true };
  }
  async remember(enabled) {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    if (enabled) {
      await this.keychain.set(this.vault.key.toString("base64"));
    } else await this.keychain.remove();
    this.settings.remember = Boolean(enabled);
    this.saveState();
    return { remember: this.settings.remember };
  }
  async background(value) {
    ensure(
      typeof value.enabled === "boolean" &&
        typeof value.resumeOnLaunch === "boolean",
      "BACKGROUND_SETTINGS",
    );
    if (value.resumeOnLaunch)
      ensure(this.settings.remember, "ENABLE_OS_UNLOCK_FIRST");
    const result = await setBackground(this.home, value.enabled);
    this.settings.background = value.enabled;
    this.settings.resumeOnLaunch = value.enabled && value.resumeOnLaunch;
    this.saveState();
    return result;
  }
  requireCertainApprovalPersistence() {
    ensure(!this.companion.approvalPersistenceUncertain && this.companion.stateFailureCode!=="COMPANION_APPROVAL_RECONCILIATION_REQUIRED" && !fs.existsSync(this.companion.stateFile+".approval-pending"), "COMPANION_APPROVAL_RECONCILIATION_REQUIRED");
  }
  async backup(password, {excludeStudio=false}={}) {
    ensure(typeof excludeStudio === "boolean", "BACKUP_STATE_FORMAT");
    this.requireCertainApprovalPersistence();
    ensure(
      this.config.validator && fs.existsSync(this.configFile),
      "WALLET_REQUIRED",
    );
    await this.vault.verifyPassword(password);
    await this.stop();
    this.requireStopped();
    await this.companion.cancel();
    this.requireCertainApprovalPersistence();
    const file = path.join(this.config.dataDir, "node.sqlite");
    if (fs.existsSync(file)) {
      const db = new DatabaseSync(file);
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        db.close();
      }
    }
    const data = {
      schema: 3,
      profile: {...this.releaseProfile,expectedAddress:this.config.validator},
      settings: {language:this.settings.language,notifications:this.settings.notifications},
      version: VERSION,
      createdAt: new Date().toISOString(),
      config: readJSON(this.configFile),
      pin: this.pin(),
      vault: readJSON(this.vault.file),
      companion: { config: this.companion.config, state: this.companion.state },
      database: fs.existsSync(file)
        ? fs.readFileSync(file).toString("base64")
        : null,
    };
    data.operational = captureOperational({home:this.home,dataDir:this.config.dataDir,kind:"node",excludeStudio});
    const sealed = await sealBackup(addBackupIntegrity(data), password);
    this.requireCertainApprovalPersistence();
    // A newly issued snapshot needs its own verification and storage acknowledgement.
    // Persist this before returning it so restarting cannot revive an older receipt.
    this.settings.backupSaved = false;
    this.settings.backupReceipt = null;
    this.saveState();
    this.challenge = null;
    this.backupIssued = backupHash(sealed); this.backupVerified = null;
    return sealed;
  }
  acknowledgeBackup() {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    ensure(this.backupIssued, "DOWNLOAD_BACKUP_FIRST");
    ensure(this.backupVerified?.currentReady && this.backupVerified.hash===this.backupIssued, "VERIFY_DOWNLOADED_BACKUP_FIRST");
    this.settings.backupReceipt=this.backupVerified;
    this.backupIssued = false; this.backupVerified = null;
    this.settings.backupSaved = true;
    this.saveState();
    return { saved: true };
  }
  async verifyBackup(envelope,password) {
    this.requireCertainApprovalPersistence();
    this.requireStopped();ensure(this.vault.unlocked,"NODE_LOCKED");this.backupVerified=null;
    const result=await verifyDownloadedBackup(envelope,password,{role:"node",kind:"node",profileID:this.releaseProfile.id,expectedAddress:this.config.validator,issuedHash:this.backupIssued,openBackup,Vault,checkRecovery,
      validate:(value)=>{const c=validateConfig({...value.config,dataDir:path.join(this.home,"data")},this.home);ensure(!value.pin||(value.pin.manager.toLowerCase()===c.manager.toLowerCase()&&value.pin.chainId===c.chainId),"BACKUP_DEPLOYMENT_MISMATCH");},
      inspectState:(temp,value)=>{
        const studio=new Studio({home:temp},"node",VERSION);ensure(!studio.historyError,"STUDIO_HISTORY_DAMAGED");new Pilot({home:temp},"node",VERSION).read();
        if(value.companion){validateCompanion({...value.companion.config,enabled:false,autoBrief:false});const companion=new Companion(temp,()=>null);atomicWrite(companion.stateFile,JSON.stringify(value.companion.state));ensure(!new Companion(temp,()=>null).stateError,"COMPANION_STATE_INVALID");}
      }
    });
    this.requireCertainApprovalPersistence();
    this.backupVerified=result.currentReady?result:null;return result;
  }
  machinePreflight() {this.requireStopped();this.preflight=collectPreflight();return this.preflight;}
  diagnostics() {return sanitizeDiagnostics({facts:{...this.preflight?.facts,role:"node"}});}
  compareUpgrade(expected) {return compareExpectedAddress(expected,this.config.validator);}
  async restore(envelope, password, acknowledge) {
    this.requireCertainApprovalPersistence();
    ensure(acknowledge === true, "RESTORE_CONFIRMATION_REQUIRED");
    this.requireStopped();
    const value = await openBackup(envelope, password);
    this.requireCertainApprovalPersistence();
    ensure([2,3].includes(value.schema) && value.config && value.vault, "BACKUP_FORMAT");
    ensure(value.schema !== 3 || value.operational, "BACKUP_STATE_FORMAT");
    const c = validateConfig(
      {
        ...value.config,
        dataDir: path.join(this.home, "data"),
        keystore: path.join(this.home, "data/validator.keystore.json"),
      },
      this.home,
    );
    assertRestoreWallet(this.releaseProfile,this.config.validator,c.validator);
    await this.companion.cancel();
    this.requireCertainApprovalPersistence();
    ensure(
      !value.pin ||
        (value.pin.manager.toLowerCase() === c.manager.toLowerCase() &&
          value.pin.chainId === c.chainId),
      "BACKUP_DEPLOYMENT_MISMATCH",
    );
    let dbBytes = null;
    if (value.database) {
      ensure(
        typeof value.database === "string" &&
          value.database.length < 48 * 1024 * 1024,
        "BACKUP_TOO_LARGE",
      );
      dbBytes = Buffer.from(value.database, "base64");
      ensure(
        dbBytes.subarray(0, 16).toString() === "SQLite format 3\0",
        "BACKUP_DATABASE_FORMAT",
      );
    }
    const temp = path.join(this.home, "restore-" + crypto.randomUUID());
    privateDir(temp);
    try {
      atomicWrite(path.join(temp, "vault.json"), JSON.stringify(value.vault));
      const checkVault = new Vault(temp);
      try {
        await checkVault.unlock(password);
        ensure(!c.validator || new Wallet(checkVault.get("privateKey")).address === getAddress(c.validator), "BACKUP_WALLET_MISMATCH");
        if (checkVault.get("walletRecovery")) checkRecovery(checkVault.get("walletRecovery"), checkVault.get("privateKey"), c.validator);
      } finally { checkVault.lock(); }
      if (dbBytes) {
        const file = path.join(temp, "node.sqlite");
        atomicWrite(file, dbBytes);
        const db = new DatabaseSync(file);
        try {
          ensure(
            db.prepare("PRAGMA integrity_check").get().integrity_check === "ok",
            "BACKUP_DATABASE_INVALID",
          );
          ensure(
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'",
              )
              .get().n === 0,
            "BACKUP_DATABASE_INVALID",
          );
          for (const table of ["meta", "jobs", "txs"])
            ensure(
              db
                .prepare(
                  "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                )
                .get(table),
              "BACKUP_DATABASE_INVALID",
            );
        } finally {
          db.close();
        }
      }
      // Stage complete state, then swap it. On an interrupted swap, the marker blocks startup.
      privateDir(path.join(temp, "data"));
      if (value.operational) stageOperational(temp, value.operational, "node");
      privateDir(path.join(temp, "work-studio"));
      const stagedStudio = new Studio({home:temp}, "node", VERSION);
      ensure(!stagedStudio.historyError, "STUDIO_HISTORY_DAMAGED");
      new Pilot({home:temp}, "node", VERSION).read();
      atomicWrite(path.join(temp, "commissioning.json"), "{}\n");
      const restoredCompanion = new Companion(temp, () => null);
      if (value.companion) {
        restoredCompanion.config = validateCompanion({
          ...value.companion.config,
          enabled: false,
          autoBrief: false,
        });
        atomicWrite(
          restoredCompanion.stateFile,
          JSON.stringify(value.companion.state),
        );
        const check = new Companion(temp, () => null);
        ensure(!check.stateError, "COMPANION_STATE_INVALID");
        restoredCompanion.stateRevision = check.stateRevision;
        restoredCompanion.state = {
          ...check.state,
          cache: [],
          lastBrief: null,
          testedAt: null,
        };
      }
      restoredCompanion.save();
      restoredCompanion.persist();
      atomicWrite(
        path.join(temp, "node.config.json"),
        JSON.stringify(c, null, 2),
      );
      if (value.pin)
        atomicWrite(
          path.join(temp, "data/deployment.json"),
          JSON.stringify(value.pin),
        );
      if (dbBytes)
        fs.renameSync(
          path.join(temp, "node.sqlite"),
          path.join(temp, "data/node.sqlite"),
        );
      this.requireCertainApprovalPersistence();
      const old = path.join(this.home, "previous-" + crypto.randomUUID()),
        marker = path.join(this.home, "restore-in-progress.json");
      privateDir(old);
      const names = [
        "vault.json",
        "node.config.json",
        "data",
        "app-state.json",
        "assistant.json",
        "assistant-state.json",
        "work-studio",
        "pilot.json",
        "commissioning.json",
        "recovered-commissioning.json",
      ];
      // Revoke every in-memory authority before touching the active files.
      this.vault.lock();
      this.recoveryChallenge = null;
      this.challenge = null;
      this.health = null;
      this.backupIssued = false; this.backupVerified = null;
      atomicWrite(
        marker,
        JSON.stringify({ previous: old, staged: temp, names }),
      );
      const moved = [],
        installed = [];
      try {
        for (const name of names) {
          const current = path.join(this.home, name);
          if (fs.existsSync(current)) {
            fs.renameSync(current, path.join(old, name));
            moved.push(name);
          }
        }
        for (const name of names.filter(name => fs.existsSync(path.join(temp, name)))) {
          fs.renameSync(path.join(temp, name), path.join(this.home, name));
          installed.push(name);
        }
        this.vault.lock();
        await this.vault.unlock(password);
        this.config = c;
        this.settings = {
          ...freshSettings(),
          restored: true,
          backupSaved: false,
        };
        this.saveState();
        fs.unlinkSync(marker);
      } catch (error) {
        this.vault.lock();
        try {
          for (const name of installed)
            fs.rmSync(path.join(this.home, name), {recursive:true, force:true});
          fs.rmSync(this.stateFile, {force:true});
          for (const name of moved)
            fs.renameSync(path.join(old, name), path.join(this.home, name));
          this.config = fs.existsSync(this.configFile)
            ? validateConfig(readJSON(this.configFile), this.home) : this.config;
          this.settings = fs.existsSync(this.stateFile)
            ? readJSON(this.stateFile) : freshSettings();
          fs.rmSync(marker, {force:true});
        } catch (rollbackError) {
          this.restoreFailed = true;
          // Keep both the marker and staging directory. Startup, unlock and
          // signing remain blocked even if the operator closes this window.
          throw new Error("RESTORE_INTERRUPTED_RECOVERY_REQUIRED", {cause:rollbackError});
        }
        throw error;
      }
      await this.keychain.remove().catch(() => {});
      await this.companion.close();
      this.companion = new Companion(
        this.home,
        () => this.vault.get("openclawToken"),
        this.companionOptions,
      );
      this.companion.startAutomatic(
        () => this.companionSnapshot(),
        () => this.vault.unlocked && !this.operation && !this.studio?.busy && !this.publicWebCommissioningBusy,
      );
      this.health = null;
      this.challenge = null;
      this.backupIssued = false; this.backupVerified = null;
      this.studio = new Studio(this, "node", VERSION);
      this.pilot = new Pilot(this, "node", VERSION);
      this.operations.records = {};
      atomicWrite(this.operations.file, "{}\n");
      return { restored: true, liveLocked: true };
    } finally {
      if (!fs.existsSync(path.join(this.home, "restore-in-progress.json")))
        fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  async reconcileRestore() {
    this.requireStopped();
    ensure(this.settings.restored, "NO_RESTORED_STATE");
    const health = await this.check();
    const record = this.dbRead((db) => ({
      max: db.prepare("SELECT MAX(nonce) AS n FROM txs").get().n,
      pending: db.prepare("SELECT nonce FROM txs WHERE state='pending'").get(),
      confirmed: db
        .prepare(
          "SELECT hash,block_hash,block_number FROM txs WHERE state='confirmed'",
        )
        .all(),
    }));
    ensure(
      record?.max === null || record?.max === undefined
        ? health.walletNonce === 0
        : health.walletNonce <= record.max + 1,
      "RESTORE_RECONCILIATION_REQUIRED",
    );
    const chain = this.connect(
      this.config,
      this.vault.get("rpcURL"),
      this.vault.get("verificationRPCURL"),
    );
    try {
      for (const t of record?.confirmed ?? []) {
        const receipt = await chain.provider.getTransactionReceipt(t.hash);
        ensure(
          receipt && receipt.blockHash === t.block_hash,
          "RESTORE_RECONCILIATION_REQUIRED",
        );
      }
      if (record?.pending)
        ensure(
          health.walletNonce <= record.pending.nonce + 1,
          "RESTORE_RECONCILIATION_REQUIRED",
        );
    } finally {
      chain.provider.destroy();
    }
    this.settings.restored = false;
    this.saveState();
    return { reconciled: true, reactivationRequired: true };
  }
  async reindex() {
    this.requireStopped();
    const store = new Store(this.config.dataDir);
    try {
      ensure(!store.pending(), "PENDING_TRANSACTION_MUST_BE_RECONCILED_FIRST");
      store.transaction(() => {
        store.db.exec("DELETE FROM jobs");
        store.db.prepare("DELETE FROM meta WHERE key='cursor'").run();
      });
      return { queued: true };
    } finally {
      store.close();
    }
  }
  report() {
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      ...this.status(),
      qualification: {
        releaseEvidence: "docs/VALIDATION.html",
        liveDeploymentQualified: false,
        independentAudit: false,
      },
    };
  }
  companionSnapshot() {
    return safeSnapshot(this.status());
  }
  async saveCompanion(input) {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    ensure(
      input && Object.keys(input).every((k) => ["config", "token"].includes(k)),
      "COMPANION_SETTINGS",
    );
    const next = validateCompanion(input.config);
    if (input.token !== undefined && input.token !== "") {
      ensure(
        typeof input.token === "string" &&
          /^[A-Za-z0-9_-]{32,256}$/.test(input.token),
        "COMPANION_TOKEN_REQUIRED",
      );
      await this.companion.cancel();
      this.vault.set({ openclawToken: input.token });
    }
    if (next.enabled)
      ensure(this.vault.get("openclawToken"), "COMPANION_TOKEN_REQUIRED");
    await this.companion.configure(next);
    this.invalidate();
    return { saved: true };
  }
  async companionKit(input) {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    ensure(input.acknowledge === true, "COMPANION_ACKNOWLEDGEMENT");
    ensure(input.mode === undefined || ["bounded","workstation"].includes(input.mode),"COMPANION_MODE");
    const workstation=input.mode === "workstation";
    const browserAuthority = workstation ? ensurePublicWebAuthority(this.vault) : null;
    if (browserAuthority?.created) this.invalidate();
    // A fresh gateway credential has no authority at the node's operator API.
    const token = crypto.randomBytes(32).toString("hex");
    await this.saveCompanion({
      config: { ...this.companion.config, mode:workstation?"workstation":"bounded",port:workstation?18898:18891,timeoutMs:workstation?720000:60000, enabled: true, acknowledged: true },
      token,
    });
    return {
      ...(workstation?{mode:"workstation",signerUID:process.getuid?.()}:{}),
      schema: "agi-node-openclaw-setup/v1",
      openclawVersion: "2026.9.5",
      ...(browserAuthority ? {publicWebAuthority: browserAuthority.authority.publicKey} : {}),
      token,
      port: this.companion.config.port,
      agent: this.companion.config.agent,
      model: "openai/gpt-6-astra",
    };
  }
  requireComputeIdentityChangeReady({ignorePending=false}={}) {
    ensure(!this.operation, "OPERATION_IN_PROGRESS");
    this.requireStopped({allowIdentityApproval:ignorePending});
    ensure(this.vault.unlocked, "NODE_LOCKED");
    ensure(ignorePending || !this.companion.pending, "COMPANION_BUSY");
    const active=this.dbRead(db=>{
      const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
      if(exists('txs') && db.prepare("SELECT 1 FROM txs WHERE state='pending' LIMIT 1").get())return true;
      if(exists('admission_reservations') && db.prepare("SELECT 1 FROM admission_reservations WHERE closed=0 LIMIT 1").get())return true;
      if(exists('jobs') && db.prepare("SELECT 1 FROM jobs WHERE status NOT IN ('terminal','waiting','unsupported','skipped','lost','abstained') LIMIT 1").get())return true;
      if(exists('jobs') && db.prepare("SELECT 1 FROM jobs WHERE my_vote=1 AND status!='terminal' LIMIT 1").get())return true;

      return false;
    });
    ensure(!active, "COMPANION_ACTIVE_WORK_IDENTITY_LOCKED");
  }
  async companionInspectIdentity() {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    return this.companion.inspectComputeIdentity();
  }
  async approveComputeIdentity(input) {
    this.requireComputeIdentityChangeReady();
    const result=await this.companion.approveComputeIdentity(input,{validateCommit:()=>this.requireComputeIdentityChangeReady({ignorePending:true})});
    this.invalidate();
    return result;
  }
  companionPublicWebReport(){ensure(this.vault.unlocked,'NODE_LOCKED');return {report:publicWebReportView(this.companion.state.lastPublicWebReport)};}
  async companionPublicWebCommissioning(input) {
    this.requireStopped();
    ensure(this.vault.unlocked,'NODE_LOCKED');
    ensure(input&&Object.keys(input).every(key=>['acknowledge','allowProviderCalls','allowLocalRuntime'].includes(key))&&input.acknowledge===true&&input.allowProviderCalls===true&&input.allowLocalRuntime===true,'PUBLIC_WEB_COMMISSIONING_APPROVAL_REQUIRED');
    ensure(this.companion.config.mode==='workstation','COMPANION_WORKSTATION_REQUIRED');
    ensure(!this.operation&&!this.publicWebCommissioningBusy&&!this.companion.pending,'COMPANION_BUSY');
    const reservation=Symbol('public-web-commissioning'),generation=this.companion.generation;
    this.publicWebCommissioningBusy=true;this.companion.commissioningReservation=reservation;
    try {
      const identity=await this.companion.inspectComputeIdentity();
      ensure(this.vault.unlocked&&generation===this.companion.generation,'COMPANION_CANCELLED');
      ensure(identity.policyHash===this.companion.state.computePolicy,'COMPANION_COMPUTE_POLICY_CHANGED');
      ensure(identity.publicWeb?.enabled===true&&['commissioning','qualified'].includes(identity.publicWeb.mode),'COMPUTE_PUBLIC_WEB_NOT_QUALIFIED');
      const {createPublicWebCommissioningFixture,createPublicWebCommissioningInput,verifyPublicWebCommissioningDelivery}=await import('../../compute/public-web-commissioning.mjs');
      const hashes=identity.publicWeb.runtimeSha256,role='reviewer',selected=hashes?.[role];
      ensure(/^[a-f0-9]{64}$/.test(selected??''),'PUBLIC_WEB_POLICY_INVALID');
      const plan=createPublicWebCommissioningFixture({challenge:crypto.randomBytes(32).toString('hex'),issuedAt:Date.now(),agentRuntimeSha256:hashes.agent??selected,reviewerRuntimeSha256:hashes.reviewer??selected});
      const {kind,input:payload}=createPublicWebCommissioningInput(plan,role);
      const executionAdmission=createExecutionAdmission({specification:plan.specification,sourceSpecSha256:sha256(canonical(plan.specification)),chainId:plan.specification.settlement.chainId,manager:plan.specification.settlement.manager,jobID:'1',role});
      ensure(this.vault.unlocked&&generation===this.companion.generation,'COMPANION_CANCELLED');
      const result=await this.companion.request(kind,payload,{cacheMs:0,executionAdmission,purpose:'commissioning',allowPublicWebCommissioning:true,commissioningFixture:plan.fixture,commissioningReservation:reservation});
      let artifact=null,review=null;
      if(role==='agent'){
        ensure(result.status==='complete','PUBLIC_WEB_COMMISSIONING_DELIVERY');
        artifact=verifyPublicWebCommissioningDelivery(plan,result.content);
      } else {
        const {at,cached,requestID,...answer}=result;review=computerVerdict(plan.specification,answer);
        ensure(review.verdict==='consistent','PUBLIC_WEB_COMMISSIONING_DELIVERY');
      }
      let qualificationExport=null,qualificationStatus=projectQualificationStatus({status:'BLOCKED',code:'COMMISSIONING_OBSERVATION_REQUIRED'});
      let browserEvidence={status:'BLOCKED',code:'COMMISSIONING_OBSERVATION_REQUIRED',actualBrowserInteraction:false,productionQualified:false};
      try {
        const {verifyPublicWebCommissioningEvidence}=await import('../../compute/public-web-evidence.mjs');
        const observed=await this.companion.readPublicWebEvidence(result.requestID,{includeQualification:true});
        browserEvidence=verifyPublicWebCommissioningEvidence(observed.publicWeb,{requestID:result.requestID,executionAdmission,policyHash:identity.policyHash,operatorPublicKey:this.vault.get('publicWebAuthority')?.publicKey});
        qualificationStatus=observed.qualificationStatus;
        if(browserEvidence.status==='PASS'&&observed.qualification){
          ensure(observed.qualification.verification?.operatorPublicKey===this.vault.get('publicWebAuthority')?.publicKey&&observed.qualification.verification?.reviewerPublicKey===identity.publicWeb?.reviewerPublicKey&&canonical(observed.qualification.payload?.browserEvidence)===canonical(observed.publicWeb),'PUBLIC_WEB_QUALIFICATION_BINDING');
          qualificationExport=observed.qualification;
        }
      } catch(error) {qualificationStatus=projectQualificationStatus({status:'BLOCKED',code:error.code??error.message});}
      ensure(this.vault.unlocked&&generation===this.companion.generation,'COMPANION_CANCELLED');
      const report=createPublicWebReport({completedAt:Date.now(),role,requestID:result.requestID,fixtureSha256:executionAdmission.acceptedSpecSha256,runtimeSha256:selected,policyHash:identity.policyHash,browserEvidence,qualificationStatus,qualificationExport});
      return this.companion.savePublicWebReport(report);
    } finally {
      if(this.companion.commissioningReservation===reservation)this.companion.commissioningReservation=null;
      this.publicWebCommissioningBusy=false;
    }
  }
  async companionTest() {
    this.requireStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    if(this.companion.config.mode!=="bounded" && !this.companion.state.computePolicy)this.requireComputeIdentityChangeReady();
    return this.companion.request(
      "test",
      { purpose: "connection-test" },
      { cacheMs: 0 },
    );
  }
  async companionImageTest() {
    this.requireStopped();ensure(this.vault.unlocked, "NODE_LOCKED");
    const specification=readJSON(path.join(ROOT,"examples/image-smoke.json"));
    const image=fs.readFileSync(path.join(ROOT,"examples/image-smoke.png")).toString("base64");
    const answer=await this.companion.request("vision",{specification,image},{cacheMs:0});
    const {at,cached,...v}=answer;
    return {...visionVerdict(specification,v),note:"Live model review of a known synthetic fixture; no vote or payment."};
  }
  async companionWorkstationTest() {
    this.requireStopped();ensure(this.vault.unlocked,"NODE_LOCKED");this.backupVerified=null;ensure(this.companion.config.mode === "workstation","COMPUTER_REVIEW_NOT_ENABLED");
    const specification=readJSON(path.join(ROOT,"examples/computer-smoke.json")),delivery=fs.readFileSync(path.join(ROOT,"examples/computer-smoke.bundle.json"),"utf8");
    const {at,cached,...answer}=await this.companion.request("computer-review",{specification,delivery},{cacheMs:0});
    return {...computerVerdict(specification,answer),note:"Actual tool review of known local fixture files. Inspect each criterion and its evidence; this does not prove independent settlement or general job coverage."};
  }
  async companionBrief() {
    ensure(!this.studio?.busy, "STUDIO_BUSY");
    ensure(this.vault.unlocked, "NODE_LOCKED");
    return this.companion.request("brief", this.companionSnapshot());
  }
  async cloudReview(input) {
    ensure(this.desired && this.worker, "CLOUD_AI_UNAVAILABLE");
    ensure(
      this.config.ai.cloudVeto &&
        this.config.ai.cloudPublicOnly &&
        this.vault.unlocked,
      "CLOUD_PUBLIC_DATA_REQUIRED",
    );
    ensure(
      typeof input.delivery === "string" && input.delivery.length <= (isComputerSpec(input.specification) ? 8388608 : isImageSpec(input.specification) ? 5592408 : 21336),
      "COMPANION_INPUT_LIMIT",
    );
    const bytes = Buffer.from(input.delivery, "base64");
    ensure(bytes.length <= (isComputerSpec(input.specification) ? (input.specification.profile==='computer-work/v2'?94371840:6291456) : isImageSpec(input.specification) ? 4194304 : 16000), "COMPANION_INPUT_LIMIT");
    if (isImageSpec(input.specification)) ensure(this.config.ai.reviewImages === true, "IMAGE_REVIEW_NOT_ENABLED");
    const specification = validateSpec(input.specification);
    // Recheck locally before sending any content to the cloud reviewer.
    ensure(
      evaluate(specification, bytes).decision === "approve",
      "CLOUD_REVIEW_PASS_REQUIRED",
    );
    if(isComputerSpec(specification)) {
      ensure(this.config.ai.reviewComputerWork === true && this.companion.config.mode === "workstation","COMPUTER_REVIEW_NOT_ENABLED");
      const executionAdmission=specification.publicWeb?.reviewer?validateExecutionAdmission(input.executionAdmission,specification,'reviewer'):null;
      if(executionAdmission){ensure(this.workerMode==='live','PUBLIC_WEB_ADMISSION_INVALID');ensure(executionAdmission.chainId===this.config.chainId&&executionAdmission.manager===this.config.manager.toLowerCase(),'PUBLIC_WEB_SETTLEMENT_CHANGED');}
      const {at,cached,...answer}=await this.companion.request("computer-review",{specification,delivery:new TextDecoder("utf-8",{fatal:true}).decode(bytes)},{cacheMs:executionAdmission?0:86400000,...(executionAdmission?{executionAdmission}:{})});
      return computerVerdict(specification,answer);
    }
    if (isImageSpec(specification)) {
      const answer = await this.companion.request("vision", {specification, image: bytes.toString("base64")}, {cacheMs: 86400000});
      const {at,cached,...judgment}=answer;
      return visionVerdict(specification, judgment);
    }
    const delivery = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return this.companion.request(
      "review",
      { specification, delivery },
      { cacheMs: 86400000 },
    );
  }
  createReadAccess() {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    return { token: this.companion.mintReadToken() };
  }
  revokeReadAccess() {
    ensure(this.vault.unlocked, "NODE_LOCKED");
    this.companion.revokeReadToken();
    return { revoked: true };
  }
  async models() {
    const r = await fetch("http://127.0.0.1:11434/api/tags", {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    ensure(r.ok, "LOCAL_AI_UNAVAILABLE");
    const text = await boundedResponse(r, 1048576, "MODEL_LIST_TOO_LARGE");
    const body = JSON.parse(text);
    return {
      models: (body.models ?? [])
        .slice(0, 100)
        .map((m) => ({ name: m.name, size: m.size, digest: m.digest })),
    };
  }
  async modelTest(model) {
    ensure(
      typeof model === "string" && /^[A-Za-z0-9_.:/-]{1,150}$/.test(model),
      "MODEL_NAME",
    );
    const started = Date.now();
    const r = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 60 },
        messages: [
          {
            role: "user",
            content:
              'Return exactly this JSON object: {"status":"ready"}. This is a connection test, not a quality evaluation.',
          },
        ],
      }),
    });
    ensure(r.ok, "LOCAL_AI_UNAVAILABLE");
    const text = await boundedResponse(r, 65536, "MODEL_OUTPUT_TOO_LARGE");
    const result = JSON.parse(JSON.parse(text).message?.content);
    ensure(result.status === "ready", "MODEL_RESPONSE_FORMAT");
    return {
      connected: true,
      elapsedMs: Date.now() - started,
      qualityQualified: false,
    };
  }
  lab(specText, deliveryBase64) {
    ensure(
      typeof specText === "string" &&
        specText.length <= 262144 &&
        typeof deliveryBase64 === "string" &&
        deliveryBase64.length <= 350000,
      "LAB_SIZE_LIMIT",
    );
    const spec = validateSpec(boundedJSON(Buffer.from(specText))),
      bytes = Buffer.from(deliveryBase64, "base64");
    ensure(bytes.length <= 262144, "LAB_SIZE_LIMIT");
    return {
      ...evaluate(spec, bytes),
      profile: spec.profile,
      specHash: sha256(specText),
      deliveryHash: sha256(bytes),
      onChain: false,
    };
  }
  async close() {
    await this.studio?.cancel();
    this.operations.close();
    await this.companion.close();
    await this.stop();
    this.vault.lock();
    this.recoveryChallenge = null;
  }
}
