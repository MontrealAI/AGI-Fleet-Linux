import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.version, 'v24.21.0', 'Use the release-pinned Node 24.21.0');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  assert.ok(['--fleet', '--manager', '--creation-tx', '--primary-env', '--secondary-env', '--out'].includes(key)
    && !(key in options) && process.argv[i + 1], 'Unknown, duplicate or missing option');
  options[key] = process.argv[i + 1];
}
for (const key of ['--fleet', '--manager', '--creation-tx', '--primary-env', '--secondary-env', '--out']) {
  assert.ok(options[key], 'Required option: ' + key);
}
const fleet = fs.realpathSync(options['--fleet']);
const output = path.resolve(options['--out']);
assert.ok(!fs.existsSync(output), 'Output must be absent');
assert.match(options['--creation-tx'], /^0x[0-9a-fA-F]{64}$/);
const inventory = JSON.parse(fs.readFileSync(path.join(repository, 'fleet/source-inventory.json')));
assert.equal(inventory.revisionSHA256, '0bf5b82329a7f743759fa7f8a6383ef985df286f3c702143719b8667c5051f97');
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
assert.equal(crypto.createHash('sha256').update(JSON.stringify(ordered(inventory.files))).digest('hex'), inventory.revisionSHA256);
assert.equal(inventory.files.length, 4816);
for (const row of inventory.files) {
  const file = path.join(fleet, row.path), stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && fs.realpathSync(file).startsWith(fleet + path.sep), 'Unsafe source file');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), row.sha256, row.path);
  assert.equal(Boolean(stat.mode & 0o111), row.executable, row.path + ' mode');
}
const agent = path.join(fleet, 'packages/AGI_Agent');
const requireFleet = createRequire(path.join(agent, 'package.json'));
const { Interface, getAddress, keccak256, ZeroAddress } =
  await import(pathToFileURL(requireFleet.resolve('ethers')));
const { ABI, matchRuntime, NATIVE_USDC } = await import(pathToFileURL(path.join(agent, 'src/chain.mjs')));
const manager = getAddress(options['--manager']);
assert.notEqual(manager, ZeroAddress);
const endpoints = ['--primary-env', '--secondary-env'].map(key => {
  assert.match(options[key], /^[A-Z][A-Z0-9_]{1,80}$/);
  let url;
  try { url = new URL(process.env[options[key]]); }
  catch { throw new Error('Missing or invalid RPC environment setting'); }
  assert.equal(url.protocol, 'https:', 'Mainnet RPC must use HTTPS');
  return url;
});
assert.notEqual(endpoints[0].hostname, endpoints[1].hostname, 'Two distinct RPC hosts are required');
const fields = [
  'owner', 'pendingOwner', 'usdcToken', 'paused', 'settlementPaused', 'wallet30', 'wallet10', 'voteQuorum',
  'requiredValidatorApprovals', 'requiredValidatorDisapprovals', 'completionReviewPeriod',
  'disputeReviewPeriod', 'challengePeriodAfterApproval', 'validationRewardPercentage',
  'agentBond', 'agentBondBps', 'agentBondMax', 'validatorBondBps', 'validatorBondMin',
  'validatorBondMax', 'validatorSlashBps', 'maxActiveJobsPerAgent', 'maxJobPayout', 'jobDurationLimit',
  'ens', 'nameWrapper', 'clubRootNode', 'alphaClubRootNode', 'agentRootNode', 'alphaAgentRootNode',
  'validatorMerkleRoot', 'agentMerkleRoot', 'lockIdentityConfig', 'agentNftRequired', 'ensJobPages',
  'nextJobId', 'nextTokenId', 'lockedEscrow', 'lockedAgentBonds', 'lockedValidatorBonds',
  'lockedDisputeBonds', 'lockedClaims',
];
const normalize = value => typeof value === 'bigint' ? String(value) : value;

let sequence = 0;
const evidence = [];
async function batch(endpoint, queries) {
  const requests = queries.map(([method, params]) => ({ jsonrpc: '2.0', id: ++sequence, method, params }));
  const child = spawn('python3', [path.join(repository, 'engineering/read-only-rpc.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let body = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  child.stdout.on('data', bytes => {
    body += bytes;
    if (body.length > 2000000) child.kill('SIGKILL');
  });
  child.stderr.resume();
  child.stdin.end(JSON.stringify({ url: endpoint.href, requests }));
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Read-only RPC transport failed')));
    });
    const responses = JSON.parse(body);
    assert.ok(Array.isArray(responses) && responses.length === requests.length, 'Incomplete RPC batch');
    const byId = new Map(responses.map(row => [row.id, row]));
    assert.equal(byId.size, requests.length, 'Duplicate RPC response');
    const results = requests.map(row => {
      const response = byId.get(row.id);
      assert.ok(response?.jsonrpc === '2.0' && !response.error && 'result' in response,
        'RPC read failed: ' + endpoint.hostname + ' / ' + row.method);
      return response.result;
    });
    const retained = requests.map(request => {
      const response = byId.get(request.id);
      let result = response.result;
      const method = request.method;
      if (method === 'eth_getBlockByNumber') result = Object.fromEntries(
        ['number', 'hash', 'parentHash', 'timestamp'].map(key => [key, result[key]]));
      if (method === 'eth_getTransactionReceipt') result = Object.fromEntries(
        ['transactionHash', 'blockNumber', 'blockHash', 'contractAddress', 'from', 'to', 'status']
          .map(key => [key, result[key]]));
      return { jsonrpc: '2.0', id: response.id, result };
    });
    evidence.push({ rpcHost: endpoint.hostname, requests, responses: retained });
    return results;
  } finally { clearTimeout(timeout); }
}
const query = (method, ...params) => [method, params];
const tag = number => '0x' + number.toString(16);
const iface = new Interface(ABI);
const token = getAddress(NATIVE_USDC[1]);
const tokenInterface = new Interface(['function balanceOf(address) view returns(uint256)',
  'function decimals() view returns(uint8)', 'function paused() view returns(bool)',
  'function isBlacklisted(address) view returns(bool)']);
const call = (address, api, method, args, block) => query('eth_call',
  { to: address, data: api.encodeFunctionData(method, args) }, tag(block));
const decode = (api, method, value) => normalize(api.decodeFunctionResult(method, value)[0]);

try {
  const initial = await Promise.all(endpoints.map(endpoint => batch(endpoint, [
    query('eth_chainId'), query('eth_getTransactionReceipt', options['--creation-tx']),
    query('eth_getBlockByNumber', 'latest', false), query('eth_getBlockByNumber', 'finalized', false),
  ])));
  for (const [chain, receipt, latest, finalized] of initial) {
    assert.equal(chain, '0x1', 'Wrong chain');
    assert.ok(receipt && receipt.status === '0x1' && receipt.to === null, 'Successful creation receipt is required');
    assert.equal(getAddress(receipt.contractAddress), manager, 'Creation receipt address differs');
    assert.equal(receipt.transactionHash.toLowerCase(), options['--creation-tx'].toLowerCase());
    assert.ok(latest?.hash && finalized?.hash && Number(finalized.number) <= Number(latest.number), 'Missing finalized head');
    assert.ok(Number(receipt.blockNumber) <= Number(finalized.number), 'Creation is not finalized');
  }
  const receipt = initial[0][1];
  assert.deepEqual(receipt, initial[1][1], 'Creation receipts disagree');
  const deploymentBlock = Number(receipt.blockNumber);
  const height = Math.min(...initial.map(row => Number(row[2].number)));
  const tokenReads = [['decimals', []], ['balanceOf', [manager]], ['paused', []], ['isBlacklisted', [manager]]];
  const observations = await Promise.all(endpoints.map((endpoint, index) => batch(endpoint, [
    query('eth_chainId'), query('eth_getBlockByNumber', tag(height), false),
    query('eth_getCode', manager, tag(height)),
    ...fields.map(field => call(manager, iface, field, [], height)),
    ...tokenReads.map(([method, args]) => call(token, tokenInterface, method, args, height)),
    ...(index === 0 ? [query('eth_getCode', manager, tag(deploymentBlock - 1)),
      query('eth_getCode', manager, tag(deploymentBlock))] : []),
  ])));
  const anchor = observations[0][1];
  assert.equal(Number(anchor.number), height);
  assert.equal(anchor.hash, observations[1][1].hash, 'Observation block differs');
  assert.equal(observations[0].at(-2), '0x', 'Code existed before the creation block');
  assert.equal(observations[0].at(-1), observations[0][2], 'Creation code differs from observed code');
  const states = observations.map(row => {
    assert.equal(row[0], '0x1', 'Wrong chain');
    const state = Object.fromEntries(fields.map((field, index) => [field, decode(iface, field, row[3 + index])]));
    const values = tokenReads.map(([method], index) => decode(tokenInterface, method, row[3 + fields.length + index]));
    [state.usdcDecimals, state.managerUSDCBalance, state.usdcPaused, state.managerUSDCBlacklisted] = values;
    state.usdcDecimals = Number(state.usdcDecimals);
    assert.equal(getAddress(state.usdcToken), token, 'Not native USDC');
    return state;
  });
  assert.deepEqual(states[0], states[1], 'RPC state observations disagree');
  const known = {}, contracts = {};
  const checkCode = (name, address, codes) => {
    assert.equal(codes[0], codes[1], 'RPC code observations disagree');
    matchRuntime(name, address, codes[0], token, known);
    contracts[name] = { address, codeHash: keccak256(codes[0]) };
  };
  checkCode('AGIJobManager', manager, observations.map(row => row[2]));
  while (Object.keys(known).some(name => !contracts[name])) {
    const next = Object.entries(known).filter(([name]) => !contracts[name]);
    const recipients = [...new Set([states[0].owner, states[0].wallet30, states[0].wallet10])];
    const first = !contracts.BondMath;
    const results = await Promise.all(endpoints.map(endpoint => batch(endpoint, [
      query('eth_chainId'), query('eth_getBlockByNumber', tag(height), false),
      ...next.map(([, address]) => query('eth_getCode', address, tag(height))),
      ...(first ? recipients.map(address => call(token, tokenInterface, 'isBlacklisted', [address], height)) : []),
    ])));
    for (const row of results) {
      assert.equal(row[0], '0x1', 'Wrong chain');
      assert.equal(row[1]?.hash, anchor.hash, 'Observation block changed');
    }
    for (const [index, [name, address]] of next.entries()) checkCode(name, address, results.map(row => row[index + 2]));
    if (first) {
      for (const [index, row] of results.entries()) states[index].usdcBlockedRecipients = Object.fromEntries(
        recipients.map((address, i) => [address, decode(tokenInterface, 'isBlacklisted', row[2 + next.length + i])]));
      assert.deepEqual(states[0], states[1], 'RPC recipient observations disagree');
    }
  }
  assert.equal(Object.keys(contracts).length, 9, 'Incomplete library graph');
  const last = await Promise.all(endpoints.map(endpoint => batch(endpoint, [
    query('eth_chainId'), query('eth_getBlockByNumber', tag(height), false),
    query('eth_getBlockByNumber', 'finalized', false),
  ])));
  for (const row of last) {
    assert.equal(row[0], '0x1', 'Wrong chain');
    assert.equal(row[1]?.hash, anchor.hash, 'Observation block changed');
    assert.ok(row[2]?.hash && Number(row[2].number) >= deploymentBlock, 'Creation finality changed');
  }
  const timestamp = Number(anchor.timestamp), age = Math.floor(Date.now() / 1000) - timestamp;
  assert.ok(age >= -90 && age <= 300, 'Stale observation or incorrect clock');
  const state = states[0];
  assert.equal(state.usdcDecimals, 6);
  const reserved = ['lockedEscrow', 'lockedAgentBonds', 'lockedValidatorBonds', 'lockedDisputeBonds', 'lockedClaims']
    .reduce((sum, name) => sum + BigInt(state[name]), 0n);
  assert.ok(BigInt(state.managerUSDCBalance) >= reserved, 'Observed USDC reserves are insolvent');
  const report = {
    schema: 'agi-fleet-mainnet-deployment-verification/v1', status: 'PASS', observedAt: new Date().toISOString(),
    chainId: 1, manager, creation: { transactionHash: receipt.transactionHash, block: deploymentBlock,
      blockHash: receipt.blockHash, deployer: getAddress(receipt.from) },
    observation: { block: height, hash: anchor.hash, timestamp,
      rpcHosts: endpoints.map(url => url.hostname), bothRPCsAgree: true,
      creationBoundaryVerifiedByPrimaryRPC: true, creationReceiptAgreesOnBothRPCs: true },
    fleetVersion: '1.0.9', fleetSHA256: '5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102',
    sourceFilesVerified: inventory.files.length,
    deploymentPin: { schema: 1, chainId: 1, manager, token, deploymentBlock,
      sourceTag: 'v1.1.0', sourceCommit: 'db876a8021da6afcf7aa974489d13374e6d188b5', contracts }, state,
    assessment: {
      runtimeCompatibility: 'PASS', linkedProductionContracts: 9, nativeUSDC: true,
      intakeOpen: !state.paused, settlementOpen: !state.settlementPaused,
      nativeUSDCAvailable: !state.usdcPaused && !state.managerUSDCBlacklisted
        && Object.values(state.usdcBlockedRecipients).every(blocked => !blocked),
      reservesSolventAtObservedBlock: true, totalReservedUSDCBaseUnits: String(reserved),
      productionQualified: false, fundedWorkEnabledByThisVerification: false,
      operatorIdentityQualification: 'NOT_RUN', operatorDualArchiveRPCQualification: 'NOT_RUN',
      note: 'Read-only deployment observation. Verify each operator identity and live services independently; settings can change after this block.',
    },
    actions: { transactionsSent: 0, walletsLoaded: 0, operatorProfilesModified: 0 },
    rpcEvidence: evidence,
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const { rpcEvidence, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : 'Read-only verification failed');
  process.exitCode = 1;
}
