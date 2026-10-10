import {
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  parseUnits,
} from "ethers";
import { Chain as BaseChain } from "../packages/AGI_Node/src/chain.mjs";
import { VerifiedProvider } from "../packages/AGI_Node/src/verified-rpc.mjs";
import { ensure, sha256, canonical, same, now } from "./common.mjs";
import { validateRPC, inShard } from "./config.mjs";
const POLICY_KEYS = [
  "owner",
  "wallet30",
  "wallet10",
  "completionReviewPeriod",
  "disputeReviewPeriod",
  "challengePeriodAfterApproval",
  "voteQuorum",
  "requiredValidatorApprovals",
  "requiredValidatorDisapprovals",
  "validationRewardPercentage",
  "validatorBondBps",
  "validatorBondMin",
  "validatorBondMax",
  "validatorSlashBps",
  "agentBond",
  "agentBondBps",
  "agentBondMax",
  "jobDurationLimit",
];
export class Chain extends BaseChain {
  constructor(c, provider) {
    super({ ...c, validator: c.wallet, label: "", proof: [] }, provider);
    this.c = c;
  }
  async economics(blockTag) {
    return Object.fromEntries(
      await Promise.all(
        POLICY_KEYS.map(async (k) => [
          k,
          String(await this.manager[k]({ blockTag })),
        ]),
      ),
    );
  }
  async enroll() {
    const pin = await super.enroll(),
      head = await this.head();
    return { ...pin, economics: await this.economics(head.number) };
  }
  async verify(pin) {
    const h = await super.verify(pin);
    ensure(
      canonical(pin.economics) === canonical(await this.economics(h.number)),
      "ECONOMIC_POLICY_CHANGED",
    );
    return h;
  }
  async snapshot(id) {
    const b = await this.head(),
      o = { blockTag: b.number };
    const [core, v, bonds, d, specURI, completionURI, paused, moderator] =
      await Promise.all([
        this.manager.getJobCore(id, o),
        this.manager.getJobValidation(id, o),
        this.manager.getJobBonds(id, o),
        this.manager.getJobDeadlines(id, o),
        this.manager.getJobSpecURI(id, o),
        this.manager.getJobCompletionURI(id, o),
        this.manager.settlementPaused(o),
        this.manager.moderators(this.c.wallet, o),
      ]);
    const value = {
      id: String(id),
      buyer: core.employer,
      agent: core.assignedAgent,
      payout: core.payout,
      duration: core.duration,
      completed: core.completed,
      expired: core.expired,
      disputed: core.disputed,
      requested: v.completionRequested,
      approvals: v.validatorApprovals,
      disapprovals: v.validatorDisapprovals,
      requestedAt: v.completionRequestedAt,
      disputedAt: v.disputedAt,
      assignmentDeadline: d.assignmentDeadline,
      reviewEnd: d.reviewEnd,
      settlementAfter: d.settlementAfter,
      neutralRefundAfter: d.neutralRefundAfter,
      disputeBond: bonds.disputeAmount,
      agentBond: bonds.agentAmount,
      specURI,
      completionURI,
      paused,
      moderator,
    };
    return {
      ...value,
      context: sha256(canonical(value)),
      blockNumber: b.number,
      blockHash: b.hash,
      now: b.timestamp,
    };
  }
  async scan(store) {
    const head = await this.head(),
      target = await this.safeHeight(head);
    let cursor = store.meta("cursor", {
      number: this.c.deploymentBlock - 1,
      hash: null,
    });
    if (cursor.hash)
      ensure(
        (await this.provider.getBlock(cursor.number))?.hash === cursor.hash,
        "CHAIN_REORG_REINDEX_REQUIRED",
      );
    for (let n = 0; n < this.c.chunksPerCycle && cursor.number < target; n++) {
      const from = cursor.number + 1,
        to = Math.min(target, from + this.c.logChunk - 1),
        block = await this.provider.getBlock(to);
      const logs = await this.provider.getLogs({
        address: this.c.manager,
        fromBlock: from,
        toBlock: to,
        topics: [
          [
            this.iface.getEvent("JobCreated").topicHash,
            this.iface.getEvent("USDCDeferred").topicHash,
            ...[
              "JobCancelled",
              "JobCompleted",
              "JobExpired",
              "UnresolvedDisputeRefunded",
            ].map((k) => this.iface.getEvent(k).topicHash),
          ],
        ],
      });
      const hashes = new Map();
      for (const l of logs) {
        if (!hashes.has(l.blockNumber))
          hashes.set(
            l.blockNumber,
            (await this.provider.getBlock(l.blockNumber))?.hash,
          );
        ensure(
          !l.removed && hashes.get(l.blockNumber) === l.blockHash,
          "SCAN_REORG",
        );
      }
      ensure(
        (await this.provider.getBlock(to))?.hash === block.hash,
        "SCAN_REORG",
      );
      const admitted = new Set();
      // JobCreated omits the buyer address. Corroborate current finalized core
      // state before storing jobs; never infer the buyer from transaction.from.
      for (const log of logs) {
        const event = this.iface.parseLog(log);
        if (event.name !== "JobCreated") continue;
        const id = String(event.args.jobId);
        if (
          !inShard(this.c, id) ||
          event.args.payout > parseUnits(this.c.limits.maxJobUSDC, 6)
        )
          continue;
        let core;
        try {
          core = await this.manager.getJobCore(id, { blockTag: target });
        } catch (error) {
          let parsed;
          try {
            parsed = this.iface.parseError(error.data);
          } catch {}
          if (parsed?.name === "JobNotFound") continue;
          throw error;
        }
        if (!this.c.trustedBuyers.some((a) => same(a, core.employer))) continue;
        if (this.c.role === "employer" && !same(core.employer, this.c.wallet))
          continue;
        admitted.add(id);
      }
      store.transaction(() => {
        for (const l of logs) {
          const e = this.iface.parseLog(l);
          if(["JobCancelled","JobCompleted","JobExpired"].includes(e.name))store.set("fundingTerminal:"+String(e.args.jobId),{transactionHash:l.transactionHash});
          if (e.name === "JobCreated") {
            const id = String(e.args.jobId);
            if (admitted.has(id))
              store.putJob(id, {
                created: l.blockNumber,
                details: e.args.details.slice(0, 2048),
                spec_uri: sha256(e.args.jobSpecURI),
                ...(store.job(id)?.status === "out-of-scope"
                  ? { status: "pending", next_check: 0 }
                  : {}),
              });
          } else if (e.name === "USDCDeferred") {
            const a = getAddress(e.args.beneficiary);
            if (
              this.c.claimBeneficiaries.includes(a) &&
              inShard(this.c, `claim:${a}`)
            )
              store.db
                .prepare("INSERT OR IGNORE INTO claims(beneficiary) VALUES(?)")
                .run(a);
          } else if (store.job(String(e.args.jobId))) {
            store.putJob(String(e.args.jobId), {
              status: "terminal",
              reason: e.name,
            });
          }
        }
        cursor = { number: to, hash: block.hash };
        store.set("cursor", cursor);
      });
    }
    return {
      head: head.number,
      scanned: cursor.number,
      caughtUp: cursor.number >= target,
    };
  }
  async approvedDisputeBond(id) {
    const s = await this.snapshot(id);
    let amount = (s.payout * 50n) / 10000n;
    if (amount < 1000000n) amount = 1000000n;
    if (amount > 200000000n) amount = 200000000n;
    return amount;
  }
}
export function connect(c, secrets, home) {
  const a = validateRPC(secrets.rpcURL, c.chainId),
    b = validateRPC(secrets.verificationRPCURL, c.chainId);
  ensure(a !== b, "INDEPENDENT_RPC_REQUIRED");
  if (c.chainId !== 31337)
    ensure(
      new URL(a).hostname !== new URL(b).hostname,
      "INDEPENDENT_RPC_HOSTS_REQUIRED",
    );
  return new Chain(c, new VerifiedProvider(a, b, home));
}
