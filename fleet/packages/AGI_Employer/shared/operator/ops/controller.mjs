import {roleContract} from '../../runtime/compute/roles.mjs';
import {releaseCompatibility} from '../packages/AGI_Node/src/control/compatibility.mjs';
import {addBackupIntegrity,backupHash,verifyDownloadedBackup,backupProgress} from '../packages/AGI_Node/src/control/backup-verification.mjs';
import {loadReleaseProfile,upgradeStatus,compareExpectedAddress} from '../packages/AGI_Node/src/control/release-profile.mjs';
import {collectPreflight,sanitizeDiagnostics} from '../packages/AGI_Node/src/control/system-preflight.mjs';
import { captureOperational, stageOperational, checkBackupSize } from '../packages/AGI_Node/src/control/operational-state.mjs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSeedWallet, importSeedWallet, checkRecovery, publicRecovery } from '../packages/AGI_Node/src/control/wallet-recovery.mjs';
import { isSeedProfile } from '../packages/AGI_Node/src/control/wallet-profile.mjs';
import fs from "node:fs";
import path from "node:path";
import { Wallet, getAddress } from "ethers";
import {
  Vault,
  sealBackup,
  openBackup,
} from "../packages/AGI_Node/src/control/vault.mjs";
import { Keychain } from "../packages/AGI_Node/src/control/os-integration.mjs";
import { DEFAULT, validateConfig, binding, inShard } from "./config.mjs";
import { Store } from "./store.mjs";
import { workload } from "./workload.mjs";
import { connect } from "./chain.mjs";
import { Engine } from "./engine.mjs";
import { modelReview } from "./evidence.mjs";
import { acquireWalletLease } from "../packages/AGI_Node/src/wallet-lease.mjs";
import {
  ROOT,
  ensure,
  atomicWrite,
  privateDir,
  now,
  json,
  errorCode,
  sha256,
  canonical,
  same,
  criticalError,
} from "./common.mjs";
export class Controller {
  constructor(home, role) {
    this.home = home;
    privateDir(home);
    ensure(!fs.existsSync(path.join(home, "restore-in-progress.json")), "RESTORE_INTERRUPTED_RECOVERY_REQUIRED");
    this.vault = new Vault(home);
    this.keychain = new Keychain(home);
    this.store = new Store(home);
    this.config = fs.existsSync(path.join(home, "config.json"))
      ? validateConfig(
          JSON.parse(fs.readFileSync(path.join(home, "config.json"))),
        )
      : {
          ...structuredClone(DEFAULT),
          role,
          gatewayAgent: `agi-${role}`,
          gatewayURL: `http://127.0.0.1:${roleContract(role).port}`,
        };
    ensure(this.config.role === role, "HOME_ROLE_MISMATCH");
    if (role === "evidence" && !this.config.wallet)
      this.config.wallet = "0x0000000000000000000000000000000000000000";
    if (!this.config.wallet) this.config.wallet = this.store.meta("walletAddress") ?? "";
    this.recoveryChallenge = null;
    this.backupIssued = false; this.backupVerified = null;
    this.running = false;
    this.busy = false;
    this.status = "locked";
    this.error = null;
    this.chain = null;
    this.engine = null;
    this.timer = null;
    this.pin = this.store.meta("pin");
    const version=JSON.parse(fs.readFileSync(path.join(ROOT,"package.json"))).version;
    const release=loadReleaseProfile(home,{hasState:this.vault.exists,role,version,address:role==="evidence"?null:this.config.wallet,kind:isSeedProfile(home)?"seed":"original",previousVersion:"1.13.0"});
    this.releaseProfile=release.profile;
    if(release.upgraded){this.store.set("walletBackupSaved",false);this.store.set("backupReceipt",null);this.store.set("activation",null);}
  }
  snapshot() {
    return {
      compatibility: releaseCompatibility(),
      role: this.config.role,
      version: JSON.parse(fs.readFileSync(path.join(ROOT,"package.json"))).version,
      walletRecovery: this.config.role === "evidence" ? { type: "none" } : publicRecovery(this.vault, this.config.wallet),
      walletProfile: isSeedProfile(this.home) ? "seed" : "original",
      backupSaved: this.store.meta("walletBackupSaved") === true,
      backup:backupProgress({issued:this.backupIssued,verified:this.backupVerified,receipt:this.store.meta("backupReceipt"),saved:this.store.meta("walletBackupSaved")===true}),
      upgrade:upgradeStatus(this.releaseProfile,this.config.wallet,this.store.stats().jobs>0||this.store.stats().transactions>0),
      historyRecoveryRequired: this.store.meta("phraseRecoveryNeedsHistory") === true,
      mode: this.mode ?? "stopped",
      status: this.status,
      error: this.error,
      vaultExists: this.vault.exists,
      walletKeyPresent: this.vault.unlocked ? Boolean(this.vault.get("privateKey")) : null,
      unlocked: this.vault.unlocked,
      configured: Boolean(this.config.manager),
      config: this.config,
      enrolled: Boolean(this.pin),
      pin: this.pin,
      stats: this.store.stats(),
      running: this.running,
      paused: fs.existsSync(path.join(this.home, "STOP")),
      activation: this.store.meta("activation"),
      lastCycle: this.store.meta("lastCycle"),
      jobs: this.store.db
        .prepare(
          "SELECT id,status,reason,checked FROM jobs ORDER BY checked DESC LIMIT 30",
        )
        .all(),
      claims: this.store.db
        .prepare("SELECT * FROM claims WHERE amount!='0' LIMIT 50")
        .all(),
      events: this.store.db
        .prepare("SELECT time,kind,data FROM events ORDER BY seq DESC LIMIT 25")
        .all(),
      exceptions: this.store.incidents(),
      humanMinutesRecorded: this.store.db.prepare("SELECT COALESCE(SUM(minutes),0) minutes FROM human_work WHERE voided=0").get().minutes,
      humanEntries: this.store.db.prepare("SELECT * FROM human_work WHERE voided=0 ORDER BY created DESC,id LIMIT 10").all(),
      osKeychain: this.keychain.supported,
    };
  }
  workload() { return workload(this.store); }
  recordHuman(body) {
    ensure(this.vault.unlocked, "VAULT_LOCKED");
    return this.store.recordHuman(body);
  }
  voidHuman(id) {
    ensure(this.vault.unlocked, "VAULT_LOCKED");
    return this.store.voidHuman(id);
  }
  async renewClaim({ beneficiary, reason, confirm }) {
    ensure(this.vault.unlocked && !this.running && !this.busy && !this.store.pending(), "STOP_AND_UNLOCK_FIRST");
    ensure(this.pin, "VERIFY_DEPLOYMENT_FIRST");
    ensure(this.config.role !== "evidence", "READ_ONLY_ROLE");
    ensure(confirm === true && ["token-restriction-cleared", "funding-or-infrastructure-restored", "operator-reviewed"].includes(reason), "CLAIM_REVIEW_REQUIRED");
    const address = getAddress(beneficiary);
    ensure(this.config.claimBeneficiaries.some(b => same(b, address)) && inShard(this.config, `claim:${address}`), "CLAIM_BENEFICIARY_SCOPE");
    const row = this.store.db.prepare("SELECT * FROM claims WHERE beneficiary=?").get(address);
    ensure(row && row.amount !== "0" && (row.status === "retry-exhausted" || row.attempts >= this.config.limits.maxClaimAttempts), "CLAIM_NOT_EXHAUSTED");
    this.busy = true;
    try {
      const chain = await this.openChain();
      await chain.verify(this.pin);
      ensure(!(await chain.manager.settlementPaused()), "SETTLEMENT_PAUSED");
      const amount = await chain.manager.pendingUSDC(address);
      this.store.claim(address, amount);
      if (amount === 0n) return { beneficiary: address, outcome: "already-paid" };
      // This is an operator-recorded retry allowance only. It neither signs a
      // transaction nor removes STOP, renews authority or redirects a claim.
      this.store.renewClaim(address, reason);
      return { beneficiary: address, outcome: "retry-allowance-renewed", attemptsAllowed: this.config.limits.maxClaimAttempts };
    } finally { this.busy = false; }
  }
  assertRestoreReady() {
    if (this.restoreFailed || fs.existsSync(path.join(this.home, "restore-in-progress.json"))) {
      this.vault.lock(); this.recoveryChallenge = null;
      throw Error("RESTORE_INTERRUPTED_RECOVERY_REQUIRED");
    }
  }
  async unlock(password) {
    this.assertRestoreReady();
    ensure(!this.busy && !this.running, "OPERATION_BUSY");
    if (this.vault.exists) await this.vault.unlock(password);
    else await this.vault.create(password);
    try { this.reconcileWallet(); } catch (e) { this.vault.lock(); throw e; }
    this.status = "ready";
    return this.snapshot();
  }
  requireWalletStopped() {
    ensure(this.vault.unlocked && !this.running && !this.busy, "STOP_AND_UNLOCK_FIRST");
  }
  invalidateWallet() {
    this.store.set("activation", null);
    this.store.set("walletBackupSaved", false);
    this.backupIssued = false; this.backupVerified = null;
  }
  async wallet(kind, options = {}) {
    this.requireWalletStopped();
    ensure(this.config.role !== "evidence", "EVIDENCE_HAS_NO_SIGNING_KEY");
    ensure(!this.config.wallet && !this.vault.get("privateKey") && !this.store.meta("identity") && !this.store.pending() && this.store.stats().jobs === 0, "WALLET_ALREADY_CONFIGURED");
    let result;
    if (kind === "create") result = createSeedWallet(options.wordCount ?? 24);
    else {
      ensure(kind === "phrase", "WALLET_IMPORT_FORMAT");
      ensure(options.acknowledgeHistory === true, "RECOVERY_HISTORY_ACKNOWLEDGEMENT");
      result = importSeedWallet(options);
      this.store.set("phraseRecoveryNeedsHistory", true);
    }
    this.invalidateWallet();
    this.vault.set({privateKey: result.wallet.privateKey, walletRecovery: result.recovery});
    this.config.wallet = result.wallet.address;
    this.store.set("walletAddress", result.wallet.address);
    return {address: result.wallet.address, recovery: publicRecovery(this.vault, result.wallet.address)};
  }
  reconcileWallet() {
    const key = this.vault.get("privateKey"), recovery = this.vault.get("walletRecovery");
    if (this.config.role === "evidence") { ensure(!key && !recovery, "EVIDENCE_HAS_NO_SIGNING_KEY"); return; }
    if (!key) { ensure(!recovery, "RECOVERY_RECORD_MISMATCH"); return; }
    const address = new Wallet(key).address;
    ensure(!this.config.wallet || same(this.config.wallet, address), "RECOVERY_RECORD_MISMATCH");
    if (recovery) checkRecovery(recovery, key, address);
    const identity = this.store.meta("identity");
    if (identity) ensure(same(identity.wallet, address) && identity.role === this.config.role, "RECOVERY_RECORD_MISMATCH");
    if (!this.config.wallet) { this.config.wallet = address; this.invalidateWallet(); }
    this.store.set("walletAddress", address);
  }
  requireRecoveryConfirmed() {
    ensure(!this.store.meta("phraseRecoveryNeedsHistory"), "RECOVERY_HISTORY_REQUIRED");
    const recovery = this.vault.get("walletRecovery");
    if (recovery) {
      checkRecovery(recovery, this.vault.get("privateKey"), this.config.wallet);
      ensure(recovery.confirmed === true, "RECOVERY_CONFIRMATION_REQUIRED");

    }
    ensure(this.store.meta("walletBackupSaved")===true&&this.store.meta("backupReceipt")?.currentReady&&this.store.meta("backupReceipt")?.profileID===this.releaseProfile.id,"BACKUP_REQUIRED");
  }
  async verifyBackup(envelope,password){
    this.assertRestoreReady();this.requireWalletStopped();this.backupVerified=null;
    const result=await verifyDownloadedBackup(envelope,password,{role:this.config.role,kind:"fleet",profileID:this.releaseProfile.id,expectedAddress:this.config.wallet,issuedHash:this.backupIssued,openBackup,Vault,checkRecovery,validate:value=>{if(value.configured!==false)validateConfig(value.config);else ensure(value.config.schema===DEFAULT.schema&&!value.config.manager&&!value.config.deploymentBlock,"BACKUP_CONFIG");}});
    this.backupVerified=result.currentReady?result:null;return result;
  }
  machinePreflight(){ensure(!this.running&&!this.busy,"STOP_BEFORE_CONFIGURATION");this.preflight=collectPreflight();return this.preflight;}
  diagnostics(){return sanitizeDiagnostics({facts:{...this.preflight?.facts,role:this.config.role}});}
  compareUpgrade(expected){return compareExpectedAddress(expected,this.config.wallet);}
  async revealRecovery(password) {
    this.requireWalletStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    await this.vault.verifyPassword(password);
    const r = this.vault.get("walletRecovery");
    ensure(r, "RECOVERY_PHRASE_UNAVAILABLE");
    checkRecovery(r, this.vault.get("privateKey"), this.config.wallet);
    const indices = new Set();
    const words = r.phrase.split(' ');
    while (indices.size < 3) indices.add(crypto.randomInt(words.length));
    const challenge = { token: crypto.randomBytes(32).toString('hex'), indices: [...indices].sort((a,b) => a-b), expiresAt: Date.now() + 5 * 60000, address: r.address };
    this.recoveryChallenge = challenge;
    return { phrase: r.phrase, path: r.path, address: r.address, wordCount: words.length, hasPassphrase: r.passphrase !== '', ...challenge, displaySeconds: 120 };
  }
  confirmRecovery({ token, answers, passphrase = '' } = {}) {
    this.requireWalletStopped();
    ensure(this.vault.unlocked, "NODE_LOCKED");
    const c = this.recoveryChallenge;
    this.recoveryChallenge = null;
    ensure(c && typeof token === 'string' && token.length === 64 && token === c.token && Date.now() < c.expiresAt, "RECOVERY_CHALLENGE_EXPIRED");
    const r = checkRecovery(this.vault.get("walletRecovery"), this.vault.get("privateKey"), this.config.wallet);
    ensure(c.address === r.address && Array.isArray(answers) && answers.length === 3 && answers.every((word, i) => typeof word === 'string' && word.trim().toLowerCase() === r.phrase.split(' ')[c.indices[i]]), "RECOVERY_WORDS_INCORRECT");
    ensure(typeof passphrase === 'string' && passphrase.normalize('NFKD') === r.passphrase, "RECOVERY_PASSPHRASE_INCORRECT");
    this.invalidateWallet();
    this.vault.set({ walletRecovery: { ...r, confirmed: true } });
    return { confirmed: true };
  }
  async save(config, secrets) {
    ensure(
      this.vault.unlocked &&
        !this.running &&
        !this.busy &&
        !this.store.pending(),
      "STOP_BEFORE_CONFIGURATION",
    );
    const c = validateConfig(config);
    ensure(c.role === this.config.role, "HOME_ROLE_MISMATCH");
    const identity = this.store.meta("identity");
    if (identity)
      ensure(
        identity.chain === c.chainId &&
          same(identity.manager, c.manager) &&
          same(identity.wallet, c.wallet) &&
          identity.role === c.role,
        "USE_NEW_HOME_FOR_IDENTITY",
      );
    const values = {};
    for (const k of [
      "rpcURL",
      "verificationRPCURL",
      "privateKey",
      "openclawToken",
    ])
      if (secrets[k]) values[k] = secrets[k];
    if (values.privateKey)
      ensure(
        same(new Wallet(values.privateKey).address, c.wallet),
        "WALLET_KEY_MISMATCH",
      );
    if (c.role === "evidence")
      ensure(
        !values.privateKey && !this.vault.get("privateKey"),
        "EVIDENCE_HAS_NO_SIGNING_KEY",
      );
    const key = this.vault.get("privateKey");
    if (key) ensure(same(new Wallet(key).address, c.wallet) && (!values.privateKey || values.privateKey === key), "WALLET_ALREADY_CONFIGURED");
    if (this.config.role !== "evidence" && this.config.wallet) ensure(same(this.config.wallet, c.wallet), "WALLET_ALREADY_CONFIGURED");
    this.invalidateWallet();
    this.vault.set(values);
    this.config = c;
    atomicWrite(
      path.join(this.home, "config.json"),
      JSON.stringify(c, null, 2) + "\n",
    );
    this.store.set("activation", null);
    this.store.set("pin", null);
    // Reindex scope changes without erasing the financial journal or evidence.
    this.store.db.prepare("DELETE FROM meta WHERE k='cursor'").run();
    this.store.set("claimCursor", 0);
    this.pin = null;
    this.status = "configuration-saved";
    this.store.event("configuration-saved", { binding: sha256(canonical(c)) });
    return this.snapshot();
  }
  async openChain() {
    ensure(this.vault.unlocked, "VAULT_LOCKED");
    if (this.chain) this.chain.provider.destroy();
    this.chain = connect(
      validateConfig(this.config),
      this.vault.value,
      this.home,
    );
    return this.chain;
  }
  async enroll() {
    ensure(
      !this.running && !this.busy && !this.store.pending(),
      "STOP_BEFORE_ENROLLMENT",
    );
    this.busy = true;
    try {
      const chain = await this.openChain(),
        pin = await chain.enroll();
      if (this.config.role === "moderator")
        ensure(
          await chain.manager.moderators(this.config.wallet),
          "MODERATOR_NOT_APPOINTED",
        );
      const latest = await chain.provider.getTransactionCount(
          this.config.wallet,
          "latest",
        ),
        pending = await chain.provider.getTransactionCount(
          this.config.wallet,
          "pending",
        );
      ensure(latest === pending, "EXTERNAL_PENDING_NONCE");
      // A phrase recovers keys, never a transaction journal. Do not silently
      // adopt an already-used wallet nonce as a fresh baseline.
      if (this.store.meta("phraseRecoveryNeedsHistory")) ensure(latest === 0, "RECOVERY_HISTORY_REQUIRED");
      if (this.store.meta("initialNonce") === null)
        this.store.set("initialNonce", latest);
      this.pin = pin;
      this.store.set("pin", pin);
      this.store.set("phraseRecoveryNeedsHistory", false);
      this.store.set("activation", null);
      this.store.event("deployment-enrolled", {
        manager: pin.manager,
        chainId: pin.chainId,
      });
      this.status = "deployment-verified";
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }
  async activate({ phrase, days, independence }) {
    this.assertRestoreReady();
    ensure(
      this.vault.unlocked && !this.running && !this.busy && this.pin,
      "VERIFY_DEPLOYMENT_FIRST",
    );
    ensure(this.config.role !== "evidence", "READ_ONLY_ROLE");
    this.requireRecoveryConfirmed();
    ensure(
      Number.isInteger(days) && days >= 1 && days <= 30,
      "AUTHORITY_DURATION",
    );
    ensure(
      phrase ===
        `AUTHORIZE ${this.config.role.toUpperCase()} ON ${this.config.chainId}`,
      "AUTHORITY_CONFIRMATION",
    );
    ensure(
      this.vault.get("privateKey") &&
        same(
          new Wallet(this.vault.get("privateKey")).address,
          this.config.wallet,
        ),
      "WALLET_KEY_REQUIRED",
    );
    if (this.config.role === "moderator")
      ensure(
        independence === true && this.config.independenceConfirmed,
        "INDEPENDENCE_CONFIRMATION_REQUIRED",
      );
    await (await this.openChain()).verify(this.pin);
    this.store.set("activation", {
      binding: binding(this.config, this.pin),
      wallet: getAddress(this.config.wallet),
      created: now(),
      expires: now() + days * 86400,
    });
    fs.rmSync(path.join(this.home, "STOP"), { force: true });
    this.store.event("standing-authority-granted", {
      role: this.config.role,
      expires: now() + days * 86400,
    });
    this.status = "authorized";
    return this.snapshot();
  }
  async start(mode = "observe") {
    this.assertRestoreReady();
    ensure(
      this.vault.unlocked && !this.running && !this.busy && this.pin,
      "VERIFY_DEPLOYMENT_FIRST",
    );
    ensure(["observe", "live"].includes(mode), "MODE");
    if (mode === "live") {
      ensure(this.config.role !== "evidence", "READ_ONLY_ROLE");
      this.requireRecoveryConfirmed();
    }
    this.busy = true;
    try {
      if (mode === "live")
        this.releaseWallet = acquireWalletLease(
          this.config.chainId,
          this.config.wallet,
        );
      await this.openChain();
      const signer =
        mode === "live" ? new Wallet(this.vault.get("privateKey")) : null;
      this.engine = new Engine(this.config, this.chain, this.store, this.pin, {
        signer,
        reviewer: (packet) =>
          modelReview(
            this.config,
            this.vault.get("openclawToken"),
            packet,
            this.store,
          ),
      });
      if (mode === "live") this.engine.tx.active();
      this.mode = mode;
      this.running = true;
      this.store.set("autostart", mode);
      this.status = mode === "live" ? "running" : "observing";
    } catch (error) {
      this.releaseWallet?.();
      this.releaseWallet = null;
      throw error;
    } finally {
      this.busy = false;
    }
    void this.tick();
    return this.snapshot();
  }
  async tick() {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      const disk = fs.statfsSync(this.home),
        db =
          fs.statSync(path.join(this.home, "service.sqlite")).size +
          (fs.existsSync(path.join(this.home, "service.sqlite-wal"))
            ? fs.statSync(path.join(this.home, "service.sqlite-wal")).size
            : 0);
      ensure(
        disk.bavail * disk.bsize > 64 * 1024 * 1024 &&
          db < this.config.maxDiskMB * 1024 * 1024,
        "STORAGE_LIMIT",
      );
      const r = await this.engine.cycle({ live: this.mode === "live" });
      this.status = fs.existsSync(path.join(this.home, "STOP"))
        ? "paused"
        : r.status;
      this.store.set("lastCycle", { time: now(), ...r });
      this.error = null;
      this.store.resolveIncident("service", "runtime", "CYCLE_SUCCEEDED");
    } catch (e) {
      this.error = errorCode(e);
      this.status = "attention";
      this.store.incident("service", "runtime", this.error);
      if (criticalError(this.error))
        atomicWrite(path.join(this.home, "STOP"), this.error + "\n");
    } finally {
      this.busy = false;
      if (this.running)
        this.timer = setTimeout(
          () => void this.tick(),
          this.config.pollSeconds * 1000,
        );
    }
  }
  pause() {
    atomicWrite(path.join(this.home, "STOP"), "OPERATOR_PAUSE\n");
    this.status = "paused";
    this.store.event("signing-paused", {});
    return this.snapshot();
  }
  async stop() {
    this.running = false;
    this.engine?.halt();
    clearTimeout(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
    this.releaseWallet?.();
    this.releaseWallet = null;
    this.store.set("autostart", null);
    this.status = "stopped";
    return this.snapshot();
  }
  async lock() {
    this.pause();
    await this.stop();
    this.vault.lock();
    this.recoveryChallenge = null;
    this.status = "locked";
    return this.snapshot();
  }
  async backup(password) {
    this.assertRestoreReady();
    ensure(
      !this.running && !this.busy && this.vault.unlocked,
      "STOP_AND_UNLOCK_FOR_BACKUP",
    );
    await this.vault.verifyPassword(password);
    this.reconcileWallet();
    this.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = fs.readFileSync(path.join(this.home, "service.sqlite"));
    ensure(
      bytes.length <= 24 * 1024 * 1024,
      "BACKUP_TOO_LARGE_USE_DISK_BACKUP",
    );
    const sealed = await sealBackup(
      addBackupIntegrity({
        schema: "agi-fleet-backup/v2",
        createdAt:new Date().toISOString(),
        profile:{...this.releaseProfile,expectedAddress:this.config.wallet},
        vaultPasswordMatchesBackup: true,
        configured: Boolean(this.config.manager),
        config: this.config,
        vault: JSON.parse(fs.readFileSync(this.vault.file)),
        database: bytes.toString("base64"),
        sha256: sha256(bytes),
        operational: captureOperational({home:this.home,kind:"fleet"}),
      }),
      password,
    );
    // Persist revocation before returning a new snapshot; each download needs its own proof.
    this.store.set("walletBackupSaved", false);
    this.store.set("backupReceipt", null);
    this.backupIssued = backupHash(sealed); this.backupVerified=null;
    return sealed;
  }
  acknowledgeBackup() {
    ensure(this.vault.unlocked && this.backupIssued, "DOWNLOAD_BACKUP_FIRST");
    ensure(this.backupVerified?.currentReady&&this.backupVerified.hash===this.backupIssued,"VERIFY_DOWNLOADED_BACKUP_FIRST");
    this.store.set("backupReceipt",this.backupVerified);
    this.backupIssued = false; this.backupVerified = null;
    this.store.set("walletBackupSaved", true);
    return { saved: true };
  }
  async restore(envelope, password) {
    this.assertRestoreReady();
    ensure(
      !this.running &&
        !this.busy &&
        !this.vault.exists &&
        !this.store.meta("pin") &&
        this.store.stats().jobs === 0,
      "RESTORE_REQUIRES_EMPTY_HOME",
    );
    const b = await openBackup(envelope, password);
    ensure(
      ["agi-fleet-backup/v1", "agi-fleet-backup/v2"].includes(b.schema) && b.config.role === this.config.role,
      "BACKUP_ROLE",
    );
    ensure(b.schema !== "agi-fleet-backup/v2" || b.operational, "BACKUP_STATE_FORMAT");
    if (b.configured !== false) validateConfig(b.config);
    else {
      // Wallet backups may be made before a deployment has been configured.
      ensure(b.config.schema === DEFAULT.schema && !b.config.manager && !b.config.deploymentBlock, "BACKUP_CONFIG");
      ensure(b.config.wallet && getAddress(b.config.wallet) === b.config.wallet, "BACKUP_WALLET_MISMATCH");
    }
    const bytes = Buffer.from(b.database, "base64");
    ensure(
      sha256(bytes) === b.sha256 &&
        bytes.subarray(0, 16).toString() === "SQLite format 3\u0000",
      "BACKUP_INTEGRITY",
    );
    const stage = fs.mkdtempSync(path.join(this.home, "restore-check-"));
    try {
      if (b.operational) stageOperational(stage, b.operational, "fleet");
      privateDir(path.join(stage, "funding"));
      atomicWrite(path.join(stage, "vault.json"), JSON.stringify(b.vault));
      // Old backups could have a separate outer password. They remain locked
      // until their original vault password validates identity on unlock.
      if (b.vaultPasswordMatchesBackup === true) {
        const vault = new Vault(stage);
        try {
          await vault.unlock(password);
          const key = vault.get("privateKey");
          if (b.config.role === "evidence") ensure(!key && !vault.get("walletRecovery"), "EVIDENCE_HAS_NO_SIGNING_KEY");
          else if (key) {
            ensure(same(new Wallet(key).address, b.config.wallet), "BACKUP_WALLET_MISMATCH");
            if (vault.get("walletRecovery")) checkRecovery(vault.get("walletRecovery"), key, b.config.wallet);
          }
        } finally { vault.lock(); }
      }
      atomicWrite(path.join(stage, "service.sqlite"), bytes);
      const db = new DatabaseSync(path.join(stage, "service.sqlite"));
      try {
        ensure(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "BACKUP_DATABASE_INVALID");
        ensure(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n === 0, "BACKUP_DATABASE_INVALID");
        for (const name of ["meta", "jobs", "txs"])
          ensure(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name), "BACKUP_DATABASE_INVALID");
      }
      finally { db.close(); }
      const staged = new Store(stage);
      try {
        const identity = staged.meta("identity");
        if (identity) ensure(identity.chain === b.config.chainId && same(identity.manager, b.config.manager) && same(identity.wallet, b.config.wallet) && identity.role === b.config.role, "BACKUP_IDENTITY_MISMATCH");
        staged.set("activation", null);
        staged.set("autostart", null);
        staged.set("walletBackupSaved", false);
        staged.set("walletAddress", b.config.wallet);
        staged.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally { staged.close(); }
      const previous = path.join(this.home, "previous-" + crypto.randomUUID());
      privateDir(previous);
      atomicWrite(path.join(this.home, "restore-in-progress.json"), JSON.stringify({schema:1,staged:stage,previous}));
      this.vault.lock(); this.recoveryChallenge = null; this.backupIssued = false; this.backupVerified = null;
      this.store.close();
      this.restoreFailed = true;
      try {
        for (const suffix of ["-wal", "-shm"]) fs.rmSync(path.join(this.home, "service.sqlite" + suffix), {force:true});
        atomicWrite(path.join(this.home, "service.sqlite"), fs.readFileSync(path.join(stage, "service.sqlite")));
        if (b.configured !== false) atomicWrite(path.join(this.home, "config.json"), JSON.stringify(b.config, null, 2));
        atomicWrite(this.vault.file, JSON.stringify(b.vault));
        if (fs.existsSync(path.join(this.home, "funding")))
          fs.renameSync(path.join(this.home, "funding"), path.join(previous, "funding"));
        fs.renameSync(path.join(stage, "funding"), path.join(this.home, "funding"));
        atomicWrite(path.join(this.home, "STOP"), "RESTORED_REQUIRES_NONCE_RECONCILIATION\n");
        this.store = new Store(this.home);
        this.restoreFailed = false;
        this.config = b.config;
        this.pin = this.store.meta("pin");
        fs.rmSync(path.join(this.home, "restore-in-progress.json"));
      } catch (e) {
        // A mixed restore is permanently blocked until files are recovered.
        if (!this.restoreFailed) this.store.close();
        this.restoreFailed = true;
        this.vault.lock();
        throw e;
      }
      this.status = "restored-locked";
    } finally {
      if (!fs.existsSync(path.join(this.home, "restore-in-progress.json")))
        fs.rmSync(stage, {recursive:true, force:true});
    }
    return this.snapshot();
  }
  async remember(enabled) {
    ensure(this.vault.unlocked, "VAULT_LOCKED");
    if (enabled) await this.keychain.set(this.vault.key.toString("base64"));
    else await this.keychain.remove();
    return { enabled };
  }
  async resumeAfterLogin() {
    this.assertRestoreReady();
    try {
      this.vault.unlockKey(await this.keychain.get());
      this.reconcileWallet();
      this.status = fs.existsSync(path.join(this.home, "STOP"))
        ? "paused"
        : "ready";
      const mode = this.store.meta("autostart");
      if (mode && !fs.existsSync(path.join(this.home, "STOP")) && this.pin)
        await this.start(mode);
    } catch (error) {
      this.vault.lock();
      this.error = errorCode(error);
      this.status = "locked";
    }
  }
  async close() {
    this.running = false;
    this.engine?.halt();
    clearTimeout(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
    this.vault.lock();
    this.recoveryChallenge = null;
    this.chain?.provider.destroy();
    this.releaseWallet?.();
    this.releaseWallet = null;
    if (!this.restoreFailed) this.store.close();
  }
}
