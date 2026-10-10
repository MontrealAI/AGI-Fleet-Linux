import net from 'node:net';
import {inspectPublicWebQualificationPayload} from '../../compute/public-web-qualification.mjs';
import {canonicalGrant} from '../../compute/public-web-policy.mjs';

const fail = () => { throw Error('PUBLIC_WEB_QUALIFICATION_INVALID'); };
const need = value => { if (!value) fail(); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value, required, optional = []) {
  need(record(value));
  need(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)));
}
function array(value, max, check) { need(Array.isArray(value) && value.length <= max); value.forEach(check); }
function timestamps(value, names) { names.forEach(name => need(integer(value[name]))); }
const connectionErrors = new Set(['TIMEOUT', 'OSError', 'gaierror', 'herror', 'ConnectionError', 'ConnectionRefusedError', 'ConnectionResetError', 'ConnectionAbortedError', 'BrokenPipeError', 'PermissionError', 'BlockingIOError', 'InterruptedError', 'TimeoutError']);
function error(value, nullable = false) { need(nullable && value === null || connectionErrors.has(value)); }
function connection(value, extra = []) { keys(value, ['connected', 'error', ...extra]); need(typeof value.connected === 'boolean'); error(value.error, value.connected); }
function ip(value) { need(typeof value === 'string' && net.isIP(value) > 0); }
function sourceHashes(value) {
  need(record(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 128);
  for (const [name, digest] of Object.entries(value)) {
    need(/^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*(?:[A-Za-z0-9][A-Za-z0-9._-]*\.(?:mjs|cjs|py|sh|json)|Dockerfile)$/.test(name) && name.length <= 151 && !name.split('/').includes('..') && hash(digest));
  }
}
function admission(value) {
  keys(value, ['schema', 'chainId', 'manager', 'jobID', 'role', 'acceptedSpecSha256', 'sourceSpecSha256', 'runtimeSha256']);
  need(value.schema === 'agi-public-web-admission/v1' && ['agent', 'reviewer'].includes(value.role));
  need(Number.isSafeInteger(value.chainId) && value.chainId > 0 && /^0x[0-9a-f]{40}$/.test(value.manager) && !/^0x0{40}$/.test(value.manager));
  need(typeof value.jobID === 'string' && /^[1-9][0-9]{0,77}$/.test(value.jobID) && BigInt(value.jobID) < 2n ** 256n);
  ['acceptedSpecSha256', 'sourceSpecSha256', 'runtimeSha256'].forEach(name => need(hash(value[name])));
}
function browserEvidence(value) {
  keys(value, ['schema', 'source', 'dependencyMode', 'requestID', 'role', 'sessionKey', 'startedAt', 'finishedAt', 'runtimePolicyHash', 'browserContainerID', 'proxyContainerID', 'grant', 'grantHash', 'events', 'gatewayTrace', 'cleanup', 'status'], ['purpose']);
  if (Object.hasOwn(value, 'purpose')) need(value.purpose === 'commissioning');
  keys(value.cleanup, ['status', 'closedAt']); need(value.cleanup.status === 'PASS'); timestamps(value.cleanup, ['closedAt']);
  array(value.events, 256, event => {
    keys(event, ['action', 'startedAt', 'commandSHA256', 'status', 'finishedAt'], ['resultSHA256', 'gatewayResultTextSHA256', 'urlSHA256', 'fixtureObservationMatches']);
    need(['navigate', 'snapshot', 'click', 'type', 'scroll', 'screenshot'].includes(event.action));
    need(['complete', 'failed-or-uncertain'].includes(event.status)); timestamps(event, ['startedAt', 'finishedAt']);
    for (const name of ['commandSHA256', 'resultSHA256', 'gatewayResultTextSHA256', 'urlSHA256']) if (Object.hasOwn(event, name)) need(hash(event[name]));
    if (Object.hasOwn(event, 'fixtureObservationMatches')) need(typeof event.fixtureObservationMatches === 'boolean');
  });
  const trace = value.gatewayTrace;
  keys(trace, ['source', 'openclawVersion', 'status', 'requestID', 'agent', 'sessionKey', 'sessionIDSHA256', 'runIDSHA256', 'beforeSeq', 'afterSeq', 'startedAt', 'finishedAt', 'finalResponseSHA256', 'calls']);
  timestamps(trace, ['beforeSeq', 'afterSeq', 'startedAt', 'finishedAt']);
  array(trace.calls, 500, call => {
    keys(call, ['tool', 'toolCallSHA256', 'callSeq', 'resultSeq', 'argumentsSHA256', 'resultSHA256', 'isError'], ['resultTextSHA256', 'engineExecID', 'engineCommandSHA256', 'commandSHA256', 'containerID']);
    need(['agi_public_browser', 'read', 'write', 'edit', 'apply_patch', 'exec', 'process'].includes(call.tool) && call.isError === false);
    timestamps(call, ['callSeq', 'resultSeq']);
    for (const name of ['toolCallSHA256', 'argumentsSHA256', 'resultSHA256', 'resultTextSHA256', 'engineExecID', 'engineCommandSHA256', 'commandSHA256', 'containerID']) if (Object.hasOwn(call, name)) need(hash(call[name]));
  });
}
function forbiddenResponse(value, extra = []) {
  keys(value, ['status', ...extra], ['location', 'body', 'firstLine', 'error']); need(value.status === 403);
  if (Object.hasOwn(value, 'location')) need(value.location === null);
  if (Object.hasOwn(value, 'firstLine')) need(['HTTP/1.0 403 Forbidden', 'HTTP/1.1 403 Forbidden'].includes(value.firstLine));
  if (Object.hasOwn(value, 'error')) need(value.error === null);
  if (Object.hasOwn(value, 'body')) need(['PUBLIC_WEB_DNS_NOT_PUBLIC', 'PUBLIC_WEB_HOST_NOT_APPROVED', 'PUBLIC_WEB_HOST_INVALID', 'PUBLIC_WEB_REQUEST_BLOCKED'].some(code => value.body === JSON.stringify({error: code})));
}
function output(probe) {
  const out = probe.stdout;
  if (probe.id === 'egress-control') {
    keys(out, ['schema', 'dns', 'selectedIPv4', 'tcp', 'udpDNS']);
    array(out.dns, 64, answer => { keys(answer, ['address', 'family']); ip(answer.address); need(answer.family === net.isIP(answer.address)); });
    ip(out.selectedIPv4); connection(out.tcp);
    keys(out.udpDNS, ['receivedBytes', 'transactionID', 'rcode', 'answerCount', 'peerAddress', 'error']);
    timestamps(out.udpDNS, ['receivedBytes', 'transactionID', 'rcode', 'answerCount']); ip(out.udpDNS.peerAddress); need(out.udpDNS.error === null);
  } else if (probe.id === 'browser-negative') {
    keys(out, ['schema', 'publicIPv4', 'directPublicTCP', 'directTCPDNS', 'directUDPDNS', 'privateTCP', 'hostnameResolution', 'proxyRequests', 'resolvConf']);
    ip(out.publicIPv4); connection(out.directPublicTCP); connection(out.directTCPDNS);
    keys(out.directUDPDNS, ['receivedBytes', 'error']); need(out.directUDPDNS.receivedBytes === 0); error(out.directUDPDNS.error);
    array(out.privateTCP, 7, item => { connection(item, ['address', 'port']); ip(item.address); need(item.port === 80); });
    array(out.hostnameResolution, 3, item => {
      keys(item, ['hostname', 'addresses', 'error']); need(['example.com', 'host.docker.internal', 'gateway.docker.internal'].includes(item.hostname));
      array(item.addresses, 16, ip); error(item.error, item.addresses.length > 0);
    });
    array(out.proxyRequests, 3, item => forbiddenResponse(item, ['target']));
    need(typeof out.resolvConf === 'string' && out.resolvConf.length <= 1024);
    const nameservers = out.resolvConf.trim().split('\n'); need(nameservers.length <= 8);
    for (const line of nameservers) { const match = /^nameserver ([^\s]+)$/.exec(line); need(match); ip(match[1]); }
  } else if (probe.id === 'protected-browser-positive') {
    keys(out, ['schema', 'url', 'title', 'headings', 'textSha256', 'grantHash', 'untrusted']);
    // The reviewed exercise visits only the fixed Example Domain fixture.
    array(out.headings, 1, heading => { keys(heading, ['level', 'text']); need(heading.level === 'h1' && heading.text === 'Example Domain'); });
  } else if (probe.id === 'proxy-enforcement-control') {
    keys(out, ['schema', 'syntheticDNS', 'syntheticRedirect', 'installedProxyModule', 'tests']);
    array(out.tests, 4, item => {
      if (item.id === 'mixed-dns') { keys(item, ['id', 'response', 'connects']); forbiddenResponse(item.response); }
      else if (item.id === 'rebind-after-public') {
        keys(item, ['id', 'first', 'second', 'lookups', 'connects']); keys(item.first, ['status', 'body'], ['location']);
        need(item.first.status === 200 && item.first.body === 'FIXTURE' && (!Object.hasOwn(item.first, 'location') || item.first.location === null)); forbiddenResponse(item.second);
      } else if (item.id === 'redirect-reauthorization') {
        keys(item, ['id', 'first', 'second', 'connects']); keys(item.first, ['status', 'location'], ['body']);
        need(item.first.status === 302 && item.first.location === 'http://unapproved.example.com/' && (!Object.hasOwn(item.first, 'body') || item.first.body === '')); forbiddenResponse(item.second);
      } else if (item.id === 'literal-private') { keys(item, ['id', 'responses', 'connects']); array(item.responses, 3, response => forbiddenResponse(response, ['target'])); }
      else fail();
      array(item.connects, 2, ip);
    });
  } else fail();
}
// An export is public technical evidence, not a place to persist arbitrary
// provider strings. Reject unexpected fields; preserve the signed grant bytes.
export function validatePublicWebExport(value, {role, requestID, fixtureSha256, runtimeSha256, policyHash, completedAt} = {}) {
  try {
    need(Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024);
    keys(value, ['schema', 'payload', 'verification']); need(value.schema === 'agi-public-web-qualification-export/v1');
    keys(value.verification, ['executionFingerprint', 'sourceHashes', 'candidatePolicyHash', 'operatorPublicKey', 'reviewerPublicKey', 'browserImageID', 'proxyImageID']);
    sourceHashes(value.verification.sourceHashes);
    const p = value.payload; admission(p.executionAdmission); browserEvidence(p.browserEvidence);
    need(['agent', 'reviewer'].includes(role) && p.executionAdmission.role === role);
    sourceHashes(p.observations.sourceHashes); array(p.observations.observations, 4, output);
    need(typeof requestID === 'string' && p.browserEvidence.requestID === requestID && p.observations.sessionID === requestID);
    need(hash(fixtureSha256) && p.executionAdmission.acceptedSpecSha256 === fixtureSha256);
    need(hash(runtimeSha256) && p.executionAdmission.runtimeSha256 === runtimeSha256);
    need(hash(policyHash) && p.candidatePolicyHash === policyHash && value.verification.candidatePolicyHash === policyHash);
    need(integer(completedAt) && completedAt >= p.issuedAt);
    inspectPublicWebQualificationPayload(p, {...value.verification, now: completedAt});
    // JSON cloning also excludes prototypes/accessors; canonical equality makes
    // preservation of the exact review and signed-grant content explicit.
    const clean = JSON.parse(JSON.stringify(value)); need(canonicalGrant(clean) === canonicalGrant(value)); return clean;
  } catch { fail(); }
}
