import {reviewAction,reviewRequest} from './review-funding.mjs';
import {fundingRequest} from '../packages/AGI_Agent/src/admission-core/economics/funding-state.mjs';
import { parseUnits, ZeroAddress, getAddress } from "ethers";
import { ensure, same, now } from "./common.mjs";
import { assertProof } from "./evidence.mjs";
import { inShard } from "./config.mjs";
export function scoped(c, s) {
  ensure(inShard(c, s.id), "WRONG_SHARD");
  ensure(
    c.trustedBuyers.some((a) => same(a, s.buyer)),
    "BUYER_OUT_OF_SCOPE",
  );
  ensure(s.payout <= parseUnits(c.limits.maxJobUSDC, 6), "JOB_VALUE_LIMIT");
  ensure(!s.paused, "SETTLEMENT_PAUSED");
}
export function jobAction(c, s, row, proof) {
  scoped(c, s);
  if (s.completed || s.expired) return null;
  if (c.role === "evidence") return null;
  if (c.role === "recovery") {
    if (
      s.disputed &&
      BigInt(s.now) > s.neutralRefundAfter &&
      s.neutralRefundAfter > 0n
    )
      return { action: "refund", job: s.id };
    if (
      !s.disputed &&
      s.requested &&
      BigInt(s.now) > s.settlementAfter &&
      s.settlementAfter > 0n
    )
      return { action: "finalize", job: s.id };
    if (
      !s.requested &&
      !s.disputed &&
      s.agent !== ZeroAddress &&
      BigInt(s.now) > s.assignmentDeadline
    )
      return { action: "expire", job: s.id };
    return null;
  }
  if (c.role === "employer") {
    ensure(same(s.buyer, c.wallet), "EMPLOYER_AUTHORITY_REQUIRED");
    if (
      s.agent === ZeroAddress &&
      !s.requested &&
      !s.disputed &&
      now() - (row.createdTime ?? now()) >= c.cancelAfterSeconds
    )
      return { action: "cancel", job: s.id };
    if (!s.requested || s.disputed) return null;
    assertProof(c, s, proof);
    if (proof.decision === "approve")
      return { action: "accept", job: s.id, proof_hash: proof.hash };
    if (
      proof.decision === "reject" &&
      BigInt(s.now + c.minReviewSeconds) <= s.reviewEnd
    )
      return { action: "dispute", job: s.id, proof_hash: proof.hash };
    return null;
  }
  if (c.role === "moderator") {
    if (!s.disputed) return null;
    ensure(s.moderator, "MODERATOR_NOT_APPOINTED");
    ensure(
      ![s.buyer, s.agent].some(
        (a) => same(a, c.wallet) || c.excludedParties.some((b) => same(a, b)),
      ),
      "CONFLICT_OF_INTEREST",
    );
    ensure(
      c.chainId === 31337 || c.independenceConfirmed,
      "INDEPENDENCE_CONFIRMATION_REQUIRED",
    );
    assertProof(c, s, proof);
    return {
      action: proof.decision === "approve" ? "agent-win" : "buyer-win",
      job: s.id,
      proof_hash: proof.hash,
    };
  }
  throw Error("ROLE_NOT_AUTHORIZED");
}
export function requestFor(chain, pin, action, bond = 0n) {
  if(reviewAction(action.action))return reviewRequest(chain,pin,action);
  if(action.action==='fund')return fundingRequest(chain.c.manager,action.offer);
  if(action.action==='approve-funding')return {to:pin.token,data:chain.token.interface.encodeFunctionData('approve',[chain.c.manager,parseUnits(action.offer.payoutUSDC,6)])};
  if (action.action === "approve-dispute")
    return {
      to: pin.token,
      data: chain.token.interface.encodeFunctionData("approve", [
        chain.c.manager,
        bond,
      ]),
    };
  const methods = {
    accept: "acceptJob",
    cancel: "cancelJob",
    dispute: "disputeJob",
    expire: "expireJob",
    finalize: "finalizeJob",
    refund: "refundUnresolvedDispute",
    claim: "claimUSDC",
    "agent-win": "resolveDisputeWithCode",
    "buyer-win": "resolveDisputeWithCode",
  };
  ensure(methods[action.action], "ACTION_NOT_ALLOWED");
  let args = action.action === "claim" ? [action.beneficiary] : [action.job];
  if (["agent-win", "buyer-win"].includes(action.action))
    args.push(
      action.action === "agent-win" ? 1 : 2,
      `formal-only/v1 sha256:${action.proof_hash}`,
    );
  return {
    to: chain.c.manager,
    data: chain.iface.encodeFunctionData(methods[action.action], args),
  };
}
export function assertRequest(c, chain, pin, request, action, bond = 0n) {
  ensure(
    !request.value || BigInt(request.value) === 0n,
    "NATIVE_VALUE_FORBIDDEN",
  );
  const expected = requestFor(chain, pin, action, bond);
  ensure(
    same(request.to, expected.to) && request.data === expected.data,
    "TRANSACTION_SCOPE",
  );
  const permitted = {
    employer: ["approve-review","fund-review","refund-review","claim-review","fund", "approve-funding", "accept", "cancel", "dispute", "approve-dispute", "claim"],
    evidence: [],
    moderator: ["agent-win", "buyer-win", "claim"],
    recovery: ["finalize", "expire", "refund", "claim"],
  };
  ensure(permitted[c.role].includes(action.action), "ROLE_NOT_AUTHORIZED");
  if (action.action === "claim")
    ensure(
      c.claimBeneficiaries.some((a) => same(a, action.beneficiary)) &&
        inShard(c, `claim:${getAddress(action.beneficiary)}`),
      "CLAIM_BENEFICIARY_SCOPE",
    );
  if (["dispute", "approve-dispute"].includes(action.action))
    ensure(
      bond > 0n && bond <= parseUnits(c.limits.maxDisputeBondUSDC, 6),
      "DISPUTE_BOND_LIMIT",
    );
}
