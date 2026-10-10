import crypto from 'node:crypto';
import net from 'node:net';
import {canonicalGrant, publicIPAddress} from './public-web-policy.mjs';
import {verifyPublicWebCommissioningEvidence} from './public-web-evidence.mjs';

const DAY = 86400000, HASH = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need = (ok, code = 'PUBLIC_WEB_QUALIFICATION_INVALID') => { if (!ok) throw Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => need(record(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|'));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sameSet = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && actual.every(value => expected.includes(value));
const hash = value => typeof value === 'string' && HASH.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
export const PUBLIC_WEB_QUALIFICATION_SCOPE = 'bounded-public-web-transport/v1';
export const PUBLIC_WEB_QUALIFICATION_RESIDUALS = Object.freeze(['controlled-host-private-reachability', 'authoritative-dns-rebinding', 'cross-host-redirect']);
export function publicWebQualificationResiduals() { return PUBLIC_WEB_QUALIFICATION_RESIDUALS.map(id => ({id, status: 'NOT_TESTED'})); }
function boundedJSON(value) {
  let nodes = 0;
  const visit = (item, depth) => {
    need(++nodes <= 50000 && depth <= 32, 'PUBLIC_WEB_QUALIFICATION_LIMIT');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { need(item.length <= 262144, 'PUBLIC_WEB_QUALIFICATION_LIMIT'); return; }
    if (typeof item === 'number') { need(Number.isSafeInteger(item), 'PUBLIC_WEB_QUALIFICATION_INVALID'); return; }
    need(Array.isArray(item) || record(item));
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0); const text = canonicalGrant(value);
  need(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'PUBLIC_WEB_QUALIFICATION_LIMIT'); return text;
}
export function publicWebQualificationDigest(value) { return crypto.createHash('sha256').update(boundedJSON(value)).digest('hex'); }
function publicKey(value) {
  need(typeof value === 'string' && value.length <= 4096 && value.includes('BEGIN PUBLIC KEY') && !value.includes('PRIVATE'), 'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
  let key; try { key = crypto.createPublicKey(value); } catch { throw Error('PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY'); }
  need(key.asymmetricKeyType === 'ed25519', 'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
  need(key.export({type: 'spki', format: 'pem'}) === value, 'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
  return {key, der: key.export({type: 'spki', format: 'der'})};
}
function sourceMap(value) {
  need(record(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 128, 'PUBLIC_WEB_QUALIFICATION_SOURCE_CHANGED');
  for (const [key, digest] of Object.entries(value)) need(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/.test(key) && !key.split('/').includes('..') && hash(digest), 'PUBLIC_WEB_QUALIFICATION_SOURCE_CHANGED');
}
function falseConnection(value) { need(record(value) && value.connected === false && typeof value.error === 'string' && value.error.length > 0, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED'); }
function validateProbe(item, envelope, issuedAt) {
  exact(item, ['id', 'commandSha256', 'exitCode', 'code', 'stdout', 'startedAt', 'finishedAt']);
  need(hash(item.commandSha256) && item.exitCode === 0 && item.code === 'OK' && record(item.stdout), 'PUBLIC_WEB_QUALIFICATION_PROBE_FAILED');
  need(integer(item.startedAt) && integer(item.finishedAt) && item.startedAt <= item.finishedAt && item.finishedAt <= envelope.collectedAt && item.startedAt >= issuedAt - DAY, 'PUBLIC_WEB_QUALIFICATION_STALE');
  const out = item.stdout;
  if (item.id === 'egress-control') {
    need(out.schema === 'agi-public-web-egress-probe/v1' && Array.isArray(out.dns) && out.dns.length > 0 && out.dns.length <= 64, 'PUBLIC_WEB_QUALIFICATION_CONTROL_FAILED');
    need(out.dns.every(answer => answer && publicIPAddress(answer.address) && net.isIP(answer.address) === answer.family) && net.isIP(out.selectedIPv4) === 4 && out.dns.some(answer => answer.address === out.selectedIPv4), 'PUBLIC_WEB_QUALIFICATION_CONTROL_FAILED');
    need(out.tcp?.connected === true && out.udpDNS?.receivedBytes >= 12 && out.udpDNS.transactionID === 42513 && out.udpDNS.rcode === 0 && out.udpDNS.answerCount > 0 && out.udpDNS.peerAddress === '1.1.1.1', 'PUBLIC_WEB_QUALIFICATION_CONTROL_FAILED');
  } else if (item.id === 'browser-negative') {
    need(out.schema === 'agi-public-web-browser-probe/v1', 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    falseConnection(out.directPublicTCP); falseConnection(out.directTCPDNS);
    need(out.directUDPDNS?.receivedBytes === 0 && typeof out.directUDPDNS.error === 'string' && out.directUDPDNS.error.length > 0, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    need(out.publicIPv4 === envelope.observations.find(probe => probe.id === 'egress-control')?.stdout?.selectedIPv4, 'PUBLIC_WEB_QUALIFICATION_CONTROL_FAILED');
    need(Array.isArray(out.privateTCP) && sameSet(out.privateTCP.map(probe => probe.address), ['169.254.169.254', '168.63.129.16', '10.0.0.1', '172.16.0.1', '192.168.0.1', '127.0.0.1', '::1']), 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    for (const probe of out.privateTCP) { need(net.isIP(probe.address) !== 0 && !publicIPAddress(probe.address) && probe.port === 80, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED'); falseConnection(probe); }
    need(Array.isArray(out.hostnameResolution) && sameSet(out.hostnameResolution.map(probe => probe.hostname), ['example.com', 'host.docker.internal', 'gateway.docker.internal']), 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    for (const probe of out.hostnameResolution) {
      need(Array.isArray(probe.addresses) && probe.addresses.length <= 16, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
      if (probe.hostname === 'example.com' || probe.addresses.length === 0) need(probe.addresses.length === 0 && typeof probe.error === 'string' && probe.error.length > 0, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
      else need(probe.addresses.every(address => net.isIP(address) !== 0 && !publicIPAddress(address)), 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    }
    need(Array.isArray(out.proxyRequests) && sameSet(out.proxyRequests.map(probe => probe.target), ['unapproved.example.com', '169.254.169.254', '127.0.0.1']) && out.proxyRequests.every(probe => probe.status === 403 && /^HTTP\/1\.[01] 403(?:\s|$)/.test(probe.firstLine)), 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
    need(typeof out.resolvConf === 'string' && out.resolvConf.length <= 8192, 'PUBLIC_WEB_QUALIFICATION_NEGATIVE_FAILED');
  } else if (item.id === 'protected-browser-positive') {
    need(out.schema === 'agi-public-web-browser-observation/v1' && out.url === 'https://example.com/' && out.title === 'Example Domain' && Array.isArray(out.headings) && out.headings.some(heading => heading.level === 'h1' && heading.text === 'Example Domain') && hash(out.textSha256) && out.grantHash === envelope.grantHash && out.untrusted === true, 'PUBLIC_WEB_QUALIFICATION_BROWSER_FAILED');
  } else if (item.id === 'proxy-enforcement-control') {
    need(out.schema === 'agi-public-web-enforcement-probe/v1' && out.syntheticDNS === true && out.syntheticRedirect === true && out.installedProxyModule === '/opt/agi/public-web-proxy.mjs' && Array.isArray(out.tests) && sameSet(out.tests.map(probe => probe.id), ['mixed-dns', 'rebind-after-public', 'redirect-reauthorization', 'literal-private']), 'PUBLIC_WEB_QUALIFICATION_ENFORCEMENT_FAILED');
    const tests = Object.fromEntries(out.tests.map(probe => [probe.id, probe]));
    need(tests['mixed-dns'].response?.status === 403 && sameSet(tests['mixed-dns'].connects, []), 'PUBLIC_WEB_QUALIFICATION_ENFORCEMENT_FAILED');
    const rebind = tests['rebind-after-public'], redirect = tests['redirect-reauthorization'], literal = tests['literal-private'];
    need(rebind.first?.status === 200 && rebind.first.body === 'FIXTURE' && rebind.second?.status === 403 && rebind.lookups === 2 && sameSet(rebind.connects, ['1.1.1.1']), 'PUBLIC_WEB_QUALIFICATION_ENFORCEMENT_FAILED');
    need(redirect.first?.status === 302 && redirect.first.location === 'http://unapproved.example.com/' && redirect.second?.status === 403 && sameSet(redirect.connects, ['1.1.1.1']), 'PUBLIC_WEB_QUALIFICATION_ENFORCEMENT_FAILED');
    need(Array.isArray(literal.responses) && sameSet(literal.responses.map(probe => probe.target), ['127.0.0.1', '169.254.169.254', '168.63.129.16']) && literal.responses.every(probe => probe.status === 403) && sameSet(literal.connects, []), 'PUBLIC_WEB_QUALIFICATION_ENFORCEMENT_FAILED');
  } else need(false, 'PUBLIC_WEB_QUALIFICATION_PROBE_UNKNOWN');
}
function validatePayload(payload, options) {
  exact(payload, ['schema', 'issuedAt', 'expiresAt', 'executionFingerprint', 'candidatePolicyHash', 'observations', 'browserEvidence', 'executionAdmission', 'scope', 'residuals', 'productionQualified', 'paidSettlementQualified']);
  const {now = Date.now(), executionFingerprint, candidatePolicyHash, browserImageID, proxyImageID, sourceHashes, operatorPublicKey} = options;
  need(payload.schema === 'agi-public-web-technical-qualification/v1' && payload.scope === PUBLIC_WEB_QUALIFICATION_SCOPE && payload.productionQualified === false && payload.paidSettlementQualified === false, 'PUBLIC_WEB_QUALIFICATION_SCOPE');
  need(canonicalGrant(payload.residuals) === canonicalGrant(publicWebQualificationResiduals()), 'PUBLIC_WEB_QUALIFICATION_RESIDUALS_REQUIRED');
  need(integer(now) && integer(payload.issuedAt) && payload.issuedAt > 0 && integer(payload.expiresAt) && payload.issuedAt <= now && payload.expiresAt > now && payload.expiresAt > payload.issuedAt && payload.expiresAt - payload.issuedAt <= DAY, 'PUBLIC_WEB_QUALIFICATION_STALE');
  need(hash(executionFingerprint) && payload.executionFingerprint === executionFingerprint && hash(payload.candidatePolicyHash) && (candidatePolicyHash === undefined || candidatePolicyHash === payload.candidatePolicyHash), 'PUBLIC_WEB_QUALIFICATION_BINDING');
  need(IMAGE.test(browserImageID ?? '') && IMAGE.test(proxyImageID ?? ''), 'PUBLIC_WEB_QUALIFICATION_BINDING');
  const o = payload.observations;
  exact(o, ['schema', 'collectedAt', 'executionFingerprint', 'platform', 'synthetic', 'sourceHashes', 'policyHash', 'sessionID', 'grantHash', 'containerIDs', 'imageIDs', 'observations', 'requiredExternalMeasurements', 'productionQualified']);
  need(o.schema === 'agi-public-web-observations/v1' && o.synthetic === false && o.productionQualified === false, 'PUBLIC_WEB_QUALIFICATION_ACTUAL_OBSERVATIONS_REQUIRED');
  need(o.executionFingerprint === executionFingerprint, 'PUBLIC_WEB_QUALIFICATION_BINDING');
  need(integer(o.collectedAt) && o.collectedAt <= payload.issuedAt && o.collectedAt >= payload.issuedAt - DAY, 'PUBLIC_WEB_QUALIFICATION_STALE');
  exact(o.platform, ['platform', 'arch', 'uid', 'signerUID']);
  need(o.platform.platform === (options.platform??'darwin') && o.platform.arch === (options.arch??'arm64') && (o.platform.platform==='darwin'&&o.platform.arch==='arm64'||o.platform.platform==='linux'&&['x64','arm64'].includes(o.platform.arch)) && integer(o.platform.uid) && integer(o.platform.signerUID) && o.platform.uid > 0 && o.platform.signerUID > 0 && o.platform.uid !== o.platform.signerUID, 'PUBLIC_WEB_QUALIFICATION_MAC_REQUIRED');
  sourceMap(sourceHashes); sourceMap(o.sourceHashes);
  need(canonicalGrant(sourceHashes) === canonicalGrant(o.sourceHashes), 'PUBLIC_WEB_QUALIFICATION_SOURCE_CHANGED');
  need(o.policyHash === payload.candidatePolicyHash && UUID.test(o.sessionID ?? '') && hash(o.grantHash), 'PUBLIC_WEB_QUALIFICATION_BINDING');
  exact(o.containerIDs, ['browser', 'proxy']); exact(o.imageIDs, ['browser', 'proxy']);
  need(hash(o.containerIDs.browser) && hash(o.containerIDs.proxy) && o.containerIDs.browser !== o.containerIDs.proxy && o.imageIDs.browser === browserImageID && o.imageIDs.proxy === proxyImageID, 'PUBLIC_WEB_QUALIFICATION_BINDING');
  need(sameSet(o.requiredExternalMeasurements, PUBLIC_WEB_QUALIFICATION_RESIDUALS), 'PUBLIC_WEB_QUALIFICATION_RESIDUALS_REQUIRED');
  need(Array.isArray(o.observations) && sameSet(o.observations.map(probe => probe.id), ['egress-control', 'browser-negative', 'protected-browser-positive', 'proxy-enforcement-control']), 'PUBLIC_WEB_QUALIFICATION_PROBES_REQUIRED');
  for (const probe of o.observations) validateProbe(probe, o, payload.issuedAt);
  const evidence = payload.browserEvidence;
  need(evidence?.requestID === o.sessionID && evidence.grantHash === o.grantHash && evidence.browserContainerID === o.containerIDs.browser && evidence.proxyContainerID === o.containerIDs.proxy && evidence.grant?.payload?.browserImageID === browserImageID && evidence.grant?.payload?.proxyImageID === proxyImageID && integer(evidence.startedAt) && integer(evidence.finishedAt) && evidence.startedAt >= payload.issuedAt - DAY && evidence.finishedAt >= o.collectedAt && evidence.finishedAt <= payload.issuedAt, 'PUBLIC_WEB_QUALIFICATION_BINDING');
  need(o.collectedAt < evidence.grant.payload.expiresAt && o.observations.every(probe => probe.startedAt >= evidence.startedAt && probe.startedAt >= evidence.grant.payload.issuedAt && probe.finishedAt < evidence.grant.payload.expiresAt), 'PUBLIC_WEB_QUALIFICATION_STALE');
  const browser = verifyPublicWebCommissioningEvidence(evidence, {requestID: o.sessionID, executionAdmission: payload.executionAdmission, policyHash: payload.candidatePolicyHash, operatorPublicKey});
  need(browser.status === 'PASS' && browser.actualBrowserInteraction === true, 'PUBLIC_WEB_QUALIFICATION_GATEWAY_EVIDENCE_REQUIRED');
  return browser;
}
export function verifyPublicWebQualification(receipt, options = {}) {
  boundedJSON(receipt); exact(receipt, ['schema', 'payload', 'signature']);
  need(receipt.schema === 'agi-public-web-qualification-receipt/v1' && typeof receipt.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(receipt.signature), 'PUBLIC_WEB_QUALIFICATION_SIGNATURE');
  const reviewer = publicKey(options.reviewerPublicKey), operator = publicKey(options.operatorPublicKey);
  need(!reviewer.der.equals(operator.der), 'PUBLIC_WEB_QUALIFICATION_INDEPENDENT_REVIEWER_REQUIRED');
  need(crypto.verify(null, Buffer.from(boundedJSON(receipt.payload)), reviewer.key, Buffer.from(receipt.signature, 'base64')), 'PUBLIC_WEB_QUALIFICATION_SIGNATURE');
  const browser = validatePayload(receipt.payload, options);
  return freeze({status: 'PASS', scope: PUBLIC_WEB_QUALIFICATION_SCOPE, payload: structuredClone(receipt.payload), receiptSha256: publicWebQualificationDigest(receipt), reviewerKeySha256: crypto.createHash('sha256').update(reviewer.der).digest('hex'), completedToolCalls: browser.completedToolCalls, residuals: publicWebQualificationResiduals(), productionQualified: false, paidSettlementQualified: false});
}
export function inspectPublicWebQualificationPayload(payload, options = {}) {
  boundedJSON(payload);
  const reviewer = publicKey(options.reviewerPublicKey), operator = publicKey(options.operatorPublicKey);
  need(!reviewer.der.equals(operator.der), 'PUBLIC_WEB_QUALIFICATION_INDEPENDENT_REVIEWER_REQUIRED');
  const browser = validatePayload(payload, options);
  return freeze({payloadSha256: publicWebQualificationDigest(payload), scope: PUBLIC_WEB_QUALIFICATION_SCOPE, completedToolCalls: browser.completedToolCalls, residuals: publicWebQualificationResiduals(), productionQualified: false, paidSettlementQualified: false});
}
// The reviewer retains this key separately. A signature authenticates their review;
// it cannot prove truthful physical execution against a dishonest key holder.
export function signPublicWebQualification(payload, reviewerPrivateKey, options = {}) {
  let key; try { key = crypto.createPrivateKey(reviewerPrivateKey); } catch { throw Error('PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY'); }
  need(key.asymmetricKeyType === 'ed25519', 'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
  const expected = publicKey(options.reviewerPublicKey), actual = crypto.createPublicKey(key).export({type: 'spki', format: 'der'});
  need(expected.der.equals(actual), 'PUBLIC_WEB_QUALIFICATION_REVIEWER_KEY');
  const receipt = {schema: 'agi-public-web-qualification-receipt/v1', payload: structuredClone(payload), signature: crypto.sign(null, Buffer.from(boundedJSON(payload)), key).toString('base64')};
  verifyPublicWebQualification(receipt, options); return freeze(receipt);
}
