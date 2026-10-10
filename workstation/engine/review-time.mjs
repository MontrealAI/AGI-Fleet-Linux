import crypto from 'node:crypto';

const fail = code => { throw Error('REVIEW_TIME_' + code); };
const need = (ok, code) => { if (!ok) fail(code); };
const shape = (o, keys) => need(o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join('|') === keys.sort().join('|'), 'FIELDS');
const uint = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && !/^0x0{40}$/.test(v);
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
export function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
}
export const digest = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
export function validatePolicy(p) {
  shape(p, ['schema','chainId','manager','employer','fundingPolicySha256','minimumReviewers','agentSeconds','reviewSeconds','challengeSeconds','reserveSeconds','reviewers']);
  need(p.schema === 'agi-review-time-policy/v1' && [1,11155111,31337].includes(p.chainId) && address(p.manager) && address(p.employer) && hash(p.fundingPolicySha256), 'POLICY_SCOPE');
  for (const k of ['minimumReviewers','reviewSeconds','reserveSeconds']) need(uint(p[k], 1), 'POLICY_TIME');
  need(uint(p.agentSeconds) && uint(p.challengeSeconds), 'POLICY_TIME');
  need(p.minimumReviewers >= 3 && p.minimumReviewers <= 50 && Array.isArray(p.reviewers) && p.reviewers.length >= p.minimumReviewers && p.reviewers.length <= 50, 'INDEPENDENT_QUORUM');
  const wallets = new Set(), controllers = new Set(), domains = new Set(), ids = new Set(), keys = new Set();
  for (const r of p.reviewers) {
    shape(r, ['participantId','wallet','controllerId','failureDomain','publicKey']);
    need(name(r.participantId) && address(r.wallet) && hash(r.controllerId) && name(r.failureDomain) && typeof r.publicKey === 'string' && r.publicKey.length < 4096, 'REVIEWER');
    let key; try { key = crypto.createPublicKey(r.publicKey); } catch { fail('PUBLIC_KEY'); }
    need(key.asymmetricKeyType === 'ed25519', 'KEY_TYPE');
    const fingerprint = key.export({format:'der',type:'spki'}).toString('hex');
    need(!wallets.has(r.wallet) && !controllers.has(r.controllerId) && !domains.has(r.failureDomain) && !ids.has(r.participantId) && !keys.has(fingerprint) && r.wallet !== p.employer, 'INDEPENDENT_CONTROL');
    wallets.add(r.wallet); controllers.add(r.controllerId); domains.add(r.failureDomain); ids.add(r.participantId); keys.add(fingerprint);
  }
  return p;
}
export function validateBody(b, p) {
  validatePolicy(p);
  shape(b, ['schema','offerId','specSha256','fundingPolicySha256','chainId','manager','employer','reviewerWallet','participantId','controllerId','failureDomain','start','finish','deadline','issuedAt','validUntil']);
  need(b.schema === 'agi-review-time/v1' && hash(b.offerId) && hash(b.specSha256) && b.fundingPolicySha256 === p.fundingPolicySha256 && b.chainId === p.chainId && b.manager === p.manager && b.employer === p.employer, 'BOOKING_SCOPE');
  const r = p.reviewers.find(x => x.participantId === b.participantId);
  need(r && b.reviewerWallet === r.wallet && b.controllerId === r.controllerId && b.failureDomain === r.failureDomain, 'REVIEWER_SCOPE');
  need(uint(b.issuedAt,1) && uint(b.start,b.issuedAt+p.agentSeconds) && uint(b.finish,b.start+p.reviewSeconds) && uint(b.deadline,b.finish+p.challengeSeconds+p.reserveSeconds) && uint(b.validUntil,b.issuedAt+1) && b.validUntil <= b.start && b.validUntil <= b.issuedAt+600 && b.finish-b.start <= 86400 && b.deadline-b.issuedAt <= 2592000, 'WINDOW');
  return r;
}
export function verifyReceipt(receipt, policy, time = Math.floor(Date.now()/1000), requireFresh = true) {
  shape(receipt, ['body','signature']);
  const r = validateBody(receipt.body, policy);
  need(typeof receipt.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(receipt.signature), 'SIGNATURE_ENCODING');
  need(crypto.verify(null, Buffer.from(canonical(receipt.body)), r.publicKey, Buffer.from(receipt.signature, 'base64')), 'SIGNATURE');
  need(uint(time,1) && (!requireFresh || (receipt.body.issuedAt <= time && time < receipt.body.validUntil)), 'EXPIRED');
  return receipt.body;
}
export function verifyFundingWindows({policy, fundingPolicy, payload, durationSeconds, receipts, time = Math.floor(Date.now()/1000)}) {
  validatePolicy(policy);
  need(typeof durationSeconds === 'string' && /^(0|[1-9][0-9]*)$/.test(durationSeconds) && uint(Number(durationSeconds),1) && Number(durationSeconds) <= 2592000, 'JOB_DURATION');
  need(digest(fundingPolicy) === policy.fundingPolicySha256 && fundingPolicy.chainId === policy.chainId && fundingPolicy.manager === policy.manager && fundingPolicy.wallet === policy.employer, 'FUNDING_POLICY');
  need(Array.isArray(receipts) && receipts.length >= policy.minimumReviewers && receipts.length <= 50, 'RECEIPTS_REQUIRED');
  const reviewers = payload.lifecycle.participants.filter(x => x.role === 'reviewer');
  need(reviewers.length === receipts.length, 'REVIEWER_COUNT');
  const expected = new Map(reviewers.map(x => [x.id,payload.identities[x.id]]));
  const seen = new Set(), bodies = receipts.map(receipt => {
    const b = verifyReceipt(receipt, policy, time), identity = expected.get(b.participantId);
    need(identity?.wallet === b.reviewerWallet && identity.controllerId === b.controllerId && b.offerId === payload.offerId && b.specSha256 === payload.specSha256 && !seen.has(b.participantId), 'OFFER_BINDING');
    need(b.start >= time + policy.agentSeconds && b.deadline <= time + Number(durationSeconds), 'FUNDING_DEADLINE');
    seen.add(b.participantId); return b;
  });
  need(seen.size === expected.size, 'REVIEWERS_MISSING');
  return bodies;
}
export function verifyAgentWindows({policy, payload, offerId, receipts, job, time = Math.floor(Date.now()/1000)}) {
  validatePolicy(policy);
  need(hash(offerId) && job && job.buyer?.toLowerCase() === policy.employer && job.specURI === payload.specURI && !job.completed && !job.expired && !job.requested, 'AGENT_JOB_STATE');
  need(Array.isArray(receipts) && receipts.length >= policy.minimumReviewers && receipts.length === payload.lifecycle.participants.filter(x=>x.role === 'reviewer').length, 'RECEIPTS_REQUIRED');
  // The contract has no assignment deadline before applyForJob sets assignedAt.
  // Use the shorter of chain and wall time, with room for signing and inclusion.
  // An absent deadline on an already assigned job is inconsistent chain state.
  let deadline = BigInt(job.deadline);
  if (deadline === 0n) {
    need(job.agent?.toLowerCase() === '0x' + '0'.repeat(40) && BigInt(job.duration) > 120n && Number.isSafeInteger(job.now) && Number.isSafeInteger(time), 'AGENT_JOB_STATE');
    deadline = BigInt(Math.min(job.now,time)) + BigInt(job.duration) - 120n;
  }
  const expected=new Map(payload.lifecycle.participants.filter(x=>x.role==='reviewer').map(x=>[x.id,payload.identities[x.id]])),seen=new Set();
  const bodies=receipts.map(receipt=>{
    const b=verifyReceipt(receipt,policy,time,false),identity=expected.get(b.participantId);
    need(identity?.wallet===b.reviewerWallet&&identity.controllerId===b.controllerId&&b.offerId===offerId&&b.specSha256===payload.specSha256&&!seen.has(b.participantId),'AGENT_BINDING');
    need(b.start>=time+policy.agentSeconds&&BigInt(b.finish+policy.challengeSeconds+policy.reserveSeconds)<=deadline,'AGENT_DEADLINE');
    seen.add(b.participantId);return b;
  });
  need(seen.size===expected.size,'REVIEWERS_MISSING');return bodies;
}
export function assertNoOverlap(bodies, rows) {
  for (const row of rows) {
    need(row.review_windows && row.review_windows !== '[]', 'LEGACY_WINDOW_UNKNOWN');
    const existing = JSON.parse(row.review_windows);
    for (const b of bodies) for (const old of existing)
      need(b.reviewerWallet !== old.reviewerWallet || b.finish <= old.start || old.finish <= b.start, 'OVERLAP');
  }
}
export class ReviewerTimeLedger {
  constructor(store, policy, {time = () => Math.floor(Date.now()/1000)} = {}) {
    this.store = store; this.policy = validatePolicy(policy); this.time = time;
    store.db.exec('CREATE TABLE IF NOT EXISTS reviewer_time_bookings(offer TEXT PRIMARY KEY,body TEXT NOT NULL,signature TEXT NOT NULL,job TEXT UNIQUE,closed INTEGER NOT NULL DEFAULT 0)');
  }
  issue(request, key, reviewerWallet) {
    const time = this.time(), b = {...request,schema:'agi-review-time/v1',issuedAt:time};
    validateBody(b,this.policy);
    need(b.reviewerWallet === reviewerWallet, 'WALLET_SCOPE');
    const owner = this.policy.reviewers.find(x=>x.wallet === reviewerWallet);
    need(crypto.createPublicKey(key).export({format:'der',type:'spki'}).equals(crypto.createPublicKey(owner.publicKey).export({format:'der',type:'spki'})), 'SIGNER_SCOPE');
    return this.store.transaction(() => {
      const old = this.store.db.prepare('SELECT * FROM reviewer_time_bookings WHERE offer=?').get(b.offerId);
      if (old) {
        const prior = JSON.parse(old.body);
        need(!old.closed && canonical({...prior,issuedAt:time}) === canonical(b), 'OFFER_ALREADY_BOOKED');
        return {body:prior,signature:old.signature};
      }
      for (const row of this.store.db.prepare('SELECT body FROM reviewer_time_bookings WHERE closed=0').all()) {
        const prior = JSON.parse(row.body);
        need(b.finish <= prior.start || prior.finish <= b.start, 'OVERLAP');
      }
      const signature = crypto.sign(null,Buffer.from(canonical(b)),key).toString('base64');
      this.store.db.prepare('INSERT INTO reviewer_time_bookings(offer,body,signature) VALUES(?,?,?)').run(b.offerId,canonical(b),signature);
      return {body:b,signature};
    });
  }
  bind(offer, job) {
    need(hash(offer) && typeof job === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(job), 'JOB_ID');
    return this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT * FROM reviewer_time_bookings WHERE offer=?').get(offer);
      need(row && !row.closed && (!row.job || row.job === job), 'UNBOOKED_JOB');
      this.store.db.prepare('UPDATE reviewer_time_bookings SET job=? WHERE offer=?').run(job,offer);
      return JSON.parse(row.body);
    });
  }
  forJob(job, {specSha256, employer, chainId, manager, reviewerWallet, reviewEnd}, {phase = 'prepare'} = {}) {
    need(phase === 'prepare' || phase === 'commit', 'PHASE');
    const row = this.store.db.prepare('SELECT * FROM reviewer_time_bookings WHERE job=? AND closed=0').get(String(job));
    need(row, 'UNBOOKED_JOB');
    const time = this.time(), b = verifyReceipt({body:JSON.parse(row.body),signature:row.signature},this.policy,time,false);
    // Reserve the full work budget before preparation. A completed review may
    // commit within its still-current booking without reserving that work twice.
    need(b.specSha256 === specSha256 && b.employer === employer && b.chainId === chainId && b.manager === manager && b.reviewerWallet === reviewerWallet && time >= b.start && time < b.finish && (phase === 'commit' || time + this.policy.reviewSeconds <= b.finish) && BigInt(b.finish) <= BigInt(reviewEnd), 'JOB_WINDOW');
    return b;
  }
}
