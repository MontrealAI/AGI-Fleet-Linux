import fs from "node:fs";
import path from "node:path";
import { isAddress, getAddress } from "ethers";
import { atomicWrite, readJSON, ensure, sha256, canonical } from "../util.mjs";
import { binding } from "../config.mjs";
export const CASES = {
  appliance:
    "Real Mac: restart, login, FileVault, Keychain and lid/sleep behavior",
  identity: "Distinct signer and ENS identity; all related parties excluded",
  lifecycle:
    "Sepolia: real inference, public delivery, independent validation and settlement",
  faults:
    "Sepolia: network, RPC disagreement, OpenClaw/IPFS restart and pending transaction recovery",
  recovery:
    "Latest encrypted backup restored on a stopped replacement; old signer disabled",
  monitor:
    "Supervised keyless monitor; browser closed; monitor-host loss alerts received",
  soak: "At least 72 hours on Sepolia AND the full deployed review/settlement lifecycle; exceptions resolved",
  pilot: "Small mainnet limits chosen; independent validation arranged",
};
const recent = (t, now, seconds = 240) =>
  Number.isFinite(Date.parse(t)) &&
  now >= Date.parse(t) &&
  now - Date.parse(t) <= seconds * 1000;
const amount = (v) =>
  typeof v === "string" && /^\d{1,24}(\.\d{1,18})?$/.test(v) ? v : null;
const integer = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
export function monitorSnapshot(s, probe, role, version, now = Date.now()) {
  const ttl = Math.max(240, (s.pollSeconds ?? 20) * 5);
  const cycleFresh =
    recent(s.lastSuccessfulCycle, now, ttl) && s.lastCyclePassed === true;
  const walletFresh = recent(s.health?.checkedAt, now, ttl);
  const rpcFresh =
    recent(s.verification?.checkedAt, now, ttl) && !s.verification?.lastError;
  const aiNeeded = role === "agent" || s.config?.ai?.cloudVeto === true;
  const localAINeeded = role === "node" && s.config?.ai?.enabled === true;
  const gatewayFresh =
    recent(probe.gateway?.checkedAt, now, 150) && probe.gateway?.ok === true;
  const ipfsFresh =
    recent(probe.ipfs?.checkedAt, now, 150) && probe.ipfs?.ok === true;
  const localAIFresh =
    recent(probe.localAI?.checkedAt, now, 150) && probe.localAI?.ok === true;
  const diskOK =
    typeof probe.diskFreeBytes === "number" &&
    probe.diskFreeBytes >= 512 * 1024 * 1024 &&
    recent(probe.checkedAt, now, 150);
  const backoff = Number(s.companion?.nextAttemptAt) > now;
  const quota = integer(s.companion?.calls24h),
    quotaMax = integer(s.companion?.config?.maxCalls24h);
  const quotaOK =
    !aiNeeded ||
    (!backoff &&
      quota !== null &&
      quotaMax !== null &&
      quota < quotaMax &&
      !s.companion?.lastError);
  const runtimeOK = !["attention", "paused", "catching-up"].includes(
    s.runtime?.status,
  );
  const healthy =
    s.running === true &&
    s.unlocked === true &&
    !s.paused &&
    cycleFresh &&
    walletFresh &&
    (s.mode !== "live" ||
      (s.health?.eligible === true && Number(s.health?.eth) > 0)) &&
    rpcFresh &&
    runtimeOK &&
    diskOK &&
    quotaOK &&
    (!aiNeeded || gatewayFresh) &&
    (!localAINeeded || localAIFresh) &&
    (role !== "agent" || ipfsFresh);
  const activeJobs = (s.counts ?? [])
    .filter((x) =>
      ["assigned", "submitted", "disputed", "voted"].includes(x.status),
    )
    .reduce((n, x) => n + (integer(x.count) ?? 0), 0);
  return {
    schema: "agi-fleet-status/v1",
    role,
    version,
    generatedAt: new Date(now).toISOString(),
    state: healthy ? "healthy" : s.running ? "attention" : "stopped",
    mode: ["observe", "live"].includes(s.mode) ? s.mode : "stopped",
    paused: s.paused === true,
    unlocked: s.unlocked === true,
    network:
      s.config?.chainId === 1
        ? "ethereum"
        : s.config?.chainId === 11155111
          ? "sepolia"
          : "local",
    worker: {
      running: s.running === true,
      cycleFresh,
      lastAttemptAt: s.lastCycle ?? null,
      lastSuccessAt: s.lastSuccessfulCycle ?? null,
      lastAttemptPassed: s.lastCyclePassed === true,
    },
    rpc: {
      state: rpcFresh ? "verified" : "unverified",
      checkedAt: s.verification?.checkedAt ?? null,
      agreedBlock: integer(s.verification?.block),
      finalizedBlock: integer(s.finalized),
      scannedBlock: integer(s.cursor?.number),
      reason: ["RPC_DISAGREEMENT", "RPC_VERIFICATION_UNAVAILABLE"].includes(
        s.verification?.lastError,
      )
        ? s.verification.lastError
        : null,
    },
    openclaw: {
      required: aiNeeded,
      gateway: gatewayFresh ? "reachable" : "unavailable-or-unchecked",
      modelLastTestAt: s.companion?.testedAt
        ? new Date(s.companion.testedAt).toISOString()
        : null,
      inference: "last test only; not continuously probed",
      calls24h: quota,
      limit24h: quotaMax,
      retryAt: backoff
        ? new Date(s.companion.nextAttemptAt).toISOString()
        : null,
    },
    ipfs: {
      required: role === "agent",
      localPublisher:
        role === "agent"
          ? ipfsFresh
            ? "reachable"
            : "unavailable-or-unchecked"
          : "not-used",
      publicRetrieval: "checked per delivery",
    },
    localAI: {
      required: localAINeeded,
      state: localAIFresh ? "reachable" : "unavailable-or-unchecked",
    },
    wallet: {
      fresh: walletFresh,
      eligible: walletFresh ? s.health?.eligible === true : null,
      eth: walletFresh ? amount(s.health?.eth) : null,
      usdc: walletFresh ? amount(s.health?.usdc) : null,
    },
    activeJobs,
    pendingTransaction: s.pending
      ? {
          kind: [
            "apply",
            "submit",
            "approve",
            "vote",
            "claim",
            "finalize",
          ].includes(s.pending.kind)
            ? s.pending.kind
            : "unknown",
          ageSeconds: Math.max(
            0,
            Math.floor(now / 1000) - Number(s.pending.created),
          ),
        }
      : null,
    disk: { freeBytes: integer(probe.diskFreeBytes), healthy: diskOK },
    software: {
      application: version,
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      openclawPinned: "2026.9.5",
      contract: "v1.1.0",
      sourceCommit: "db876a8021da6afcf7aa974489d13374e6d188b5",
    },
    privacy:
      "No keys, RPC URLs, wallet addresses, job content or transaction hashes. Balances and operating counts are disclosed to this read token.",
  };
}
export class Operations {
  constructor(controller, role, version) {
    this.c = controller;
    this.role = role;
    this.version = version;
    this.file = path.join(controller.home, "commissioning.json");
    this.records = fs.existsSync(this.file) ? readJSON(this.file) : {};
    this.probes = {};
    this.busy = false;
    this.timer = null;
    this.stopped = false;
  }
  scope() {
    return sha256(
      canonical({
        version: this.version,
        binding: binding(this.c.config, this.c.pin()),
        rpc: this.c.vault.unlocked
          ? sha256(
              (this.c.vault.get("rpcURL") ?? "") +
                "\n" +
                (this.c.vault.get("verificationRPCURL") ?? ""),
            )
          : null,
      }),
    );
  }
  summary() {
    const scope = this.c.vault.unlocked ? this.scope() : null;
    return {
      scope,
      verificationConfigured: this.c.vault.unlocked
        ? Boolean(this.c.vault.get("verificationRPCURL"))
        : null,
      independenceReviewed: this.c.config.independenceReviewed === true,
      cases: Object.entries(CASES).map(([id, title]) => ({
        id,
        title,
        ...(this.records[id]?.scope === scope
          ? this.records[id]
          : { status: "pending", evidence: "" }),
      })),
      qualification:
        "Operator-recorded evidence. Not an independent audit or hardware certification.",
    };
  }
  evidenceReport() {
    const unlocked = this.c.vault.unlocked;
    const cfg = this.c.config,
      pin = this.c.pin();
    const summary = this.summary();
    return {
      schema: "agi-commissioning-evidence/v1",
      generatedAt: new Date().toISOString(),
      role: this.role,
      software: {
        application: this.version,
        node: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        openclawTarget: "2026.9.5",
        contractTarget: "v1.1.0",
      },
      scope: unlocked ? this.scope() : null,
      scopeStatus: unlocked ? "current-configuration" : "locked-unverified",
      deployment: {
        chainId: cfg.chainId,
        manager: cfg.manager || null,
        creationBlock: cfg.deploymentBlock,
        enrollmentPresent: Boolean(pin),
        enrollmentDigest: pin ? sha256(canonical(pin)) : null,
        basis:
          "Configured and enrolled data only. Export does not query the chain or approve this deployment.",
      },
      configuredLimits: structuredClone(cfg.limits),
      settlementBudgetRecovery: this.c.budgetRecoveryReport?.() ?? null,
      sharedJobFormat: "agi-node-job/v1",
      extendedEnvelopesEnabled: cfg.execution?.allowEnvelopes === true,
      automaticFinalizationEnabled: cfg.autoFinalizeOwnJobs,
      operatorAttestations: summary.cases,
      outstandingAttestationIds: summary.cases
        .filter((x) => x.status !== "pass")
        .map((x) => x.id),
      qualification:
        "Not established by this export. Attestations, independence, alert receipt and live payments have not been independently verified.",
      requiredExternalEvidence: {
        appliance:
          "Actual M1 restart, FileVault/login/Keychain, sleep/lid, crash recovery and remote access; after-login launchd is not cold-boot recovery.",
        identity:
          "Wallet/ENS authorization and unrelated controllers; test inference account cannot read wallet files, Keychain or backups.",
        lifecycle:
          "Paused-intake deployment readiness: owner acceptance, payouts, native USDC, identity policy, linked code, quorum and reserves. Then real inference, public exact bytes, sufficient unrelated votes, finalization receipt, payment and bond release. Employer acceptance is a separate route.",
        faults:
          "RPC conflict/outage, quota/IPFS failure, eligibility revocation, invalid work, pending transaction/nonce conflict, quorum failure, disputes and deferred claims; document safe recovery and intervention.",
        recovery:
          "Encrypted backup restored with old signer stopped, intact journals and reconciled pending transactions; separate Sepolia and mainnet wallets/workspaces.",
        monitor:
          "Notifications actually received with browser closed, worker/tunnel stopped and monitor host offline. HTTP heartbeat acceptance is not proof of delivery.",
        soak: "At least 72 hours on Sepolia AND enough real time for the full deployed review and settlement lifecycle (default review is seven days after submission). Record actual timing, pauses, exceptions, costs and interventions. Shortened test-only timing leaves a production-timing gap; elapsed time alone does not qualify reliability.",
        pilot:
          "Limited monitored mainnet pilot only after prior evidence is reviewed; actual deployed quorum and enough unrelated eligible validators; explicit gas/ETH/bond limits and exception owner.",
      },
      privacy:
        "Private operator report. Includes public deployment metadata, limits and your free-text notes, which may contain sensitive information. Review before sharing. No vault secrets, RPC URLs or wallet keys are exported by the structured projection. Never put credentials or private job content in notes.",
    };
  }
  assertReady() {
    if (this.c.config.chainId === 31337) return;
    ensure(this.c.vault.get("verificationRPCURL"), "VERIFICATION_RPC_REQUIRED");
    ensure(
      this.c.config.independenceReviewed === true,
      "INDEPENDENCE_REVIEW_REQUIRED",
    );
    if (this.c.config.chainId === 1)
      ensure(
        this.summary().cases.every((x) => x.status === "pass"),
        "COMMISSIONING_REQUIRED",
      );
  }
  record(input) {
    this.c.requireStopped();
    ensure(this.c.vault.unlocked, "NODE_LOCKED");
    ensure(
      Object.hasOwn(CASES, input.id) &&
        ["pending", "pass", "blocked"].includes(input.status),
      "COMMISSIONING_FORMAT",
    );
    ensure(
      typeof input.evidence === "string" &&
        input.evidence.length <= 1000 &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.evidence),
      "COMMISSIONING_FORMAT",
    );
    if (input.status === "pass")
      ensure(
        input.evidence.trim().length >= 20,
        "COMMISSIONING_EVIDENCE_REQUIRED",
      );
    this.records[input.id] = {
      status: input.status,
      evidence: input.evidence.trim(),
      at: new Date().toISOString(),
      scope: this.scope(),
    };
    atomicWrite(this.file, JSON.stringify(this.records, null, 2));
    // Removing a commissioning pass removes live authority immediately.
    if (input.status !== "pass") this.c.invalidate();
    return this.summary();
  }
  identity() {
    const cfg = this.c.config,
      wallet = cfg.agent ?? cfg.validator;
    ensure(wallet, "WALLET_REQUIRED");
    return {
      schema: "agi-actor-identity/v1",
      role: this.role,
      wallet: getAddress(wallet),
      label: cfg.label,
      chainId: cfg.chainId,
      manager: cfg.manager,
    };
  }
  async excludePeer(input) {
    const peer = input.identity,
      self = this.identity();
    ensure(
      peer &&
        peer.schema === "agi-actor-identity/v1" &&
        ["agent", "node"].includes(peer.role) &&
        isAddress(peer.wallet),
      "PEER_IDENTITY_INVALID",
    );
    ensure(
      peer.wallet.toLowerCase() !== self.wallet.toLowerCase(),
      "PEER_WALLET_MUST_DIFFER",
    );
    const set = new Set(
      this.c.config.excludedParties.map((x) => x.toLowerCase()),
    );
    set.add(peer.wallet.toLowerCase());
    await this.c.saveConfig({
      excludedParties: [...set].map(getAddress),
      independenceReviewed: false,
    });
    return {
      excluded: getAddress(peer.wallet),
      note: "Review every related identity, then confirm independence.",
    };
  }
  async probe() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const checkedAt = new Date().toISOString(),
      result = { checkedAt };
    const get = async (url, headers = {}, compute = false) => {
      try {
        const r = await fetch(url, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        let ok = r.ok;
        if(ok && compute){let size=0,parts=[];for await(const b of r.body){size+=b.length;ensure(size<=8192,"COMPUTE_HEALTH_LIMIT");parts.push(b);}const h=JSON.parse(Buffer.concat(parts));ok=["agi-compute/v1","agi-compute/v2"].includes(h.protocol)&&h.gatewayReady===true&&h.stopped===false;}else await r.body?.cancel();
        return { ok, checkedAt };
      } catch {
        return { ok: false, checkedAt };
      }
    };
    try {
      try {
        const d = fs.statfsSync(this.c.home);
        result.diskFreeBytes = d.bavail * d.bsize;
      } catch {
        result.diskFreeBytes = null;
      }
      const token = this.c.vault.unlocked
        ? this.c.vault.get("openclawToken")
        : null;
      const gateway = token
        ? get(`http://127.0.0.1:${this.c.companion.config.port}/${["tools","workstation"].includes(this.c.companion.config.mode)?"health":"v1/models"}`, {
            Authorization: "Bearer " + token,
          }, ["tools","workstation"].includes(this.c.companion.config.mode))
        : Promise.resolve({ ok: false, checkedAt });
      const ipfs =
        this.role === "agent"
          ? (async () => {
              try {
                const { Publisher } = await import("../publisher.mjs");
                await new Publisher(this.c.config).check();
                return { ok: true, checkedAt };
              } catch {
                return { ok: false, checkedAt };
              }
            })()
          : Promise.resolve({ ok: false, checkedAt });
      const localAI = this.c.config.ai?.enabled
        ? get("http://127.0.0.1:11434/api/tags")
        : Promise.resolve({ ok: false, checkedAt });
      [result.gateway, result.ipfs, result.localAI] = await Promise.all([
        gateway,
        ipfs,
        localAI,
      ]);
      this.probes = result;
    } finally {
      this.busy = false;
    }
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.probe();
    this.timer = setInterval(() => void this.probe(), 60000);
    this.timer.unref();
  }
  close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
  }
  snapshot() {
    const s = this.c.status();
    return monitorSnapshot(
      {
        ...s,
        pollSeconds: this.c.config.pollSeconds,
        lastCycle: this.c.lastCycle
          ? new Date(this.c.lastCycle).toISOString()
          : null,
        lastSuccessfulCycle: this.c.lastSuccessfulCycle
          ? new Date(this.c.lastSuccessfulCycle).toISOString()
          : null,
        lastCyclePassed: this.c.lastCyclePassed,
        verification: this.c.verification,
        finalized: this.c.finalized,
      },
      this.probes,
      this.role,
      this.version,
    );
  }
}
