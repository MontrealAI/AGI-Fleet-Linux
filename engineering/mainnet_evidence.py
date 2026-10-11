"""Replay public deployment evidence without RPC, signing or third-party packages.

Getter selectors are frozen for the release ABI; complete runtimes are compared
with its artifacts after substituting only recorded links and immutable slots.
The live observer also records Keccak hashes using the release-pinned ethers.
This replay verifies artifact bytes and snapshot consistency, not fresh readiness.
"""
import json
import re
from datetime import datetime
from release_tools import ROOT, SHA256, SOURCE_REVISION, require

GETTERS = {'0x8da5cb5b': ['owner', 'address'],
 '0xe30c3978': ['pendingOwner', 'address'],
 '0x11eac855': ['usdcToken', 'address'],
 '0x5c975abb': ['paused', 'bool'],
 '0x4168632d': ['settlementPaused', 'bool'],
 '0x2c308602': ['wallet30', 'address'],
 '0x5f88ffed': ['wallet10', 'address'],
 '0x4d421401': ['voteQuorum', 'uint256'],
 '0xe6e60204': ['requiredValidatorApprovals', 'uint256'],
 '0xc4d71ca1': ['requiredValidatorDisapprovals', 'uint256'],
 '0x85223477': ['completionReviewPeriod', 'uint256'],
 '0xdb6f77ea': ['disputeReviewPeriod', 'uint256'],
 '0xd6a2c77a': ['challengePeriodAfterApproval', 'uint256'],
 '0xbdd61c20': ['validationRewardPercentage', 'uint256'],
 '0x80191aa4': ['agentBond', 'uint256'],
 '0xa9b710de': ['agentBondBps', 'uint256'],
 '0x111e4621': ['agentBondMax', 'uint256'],
 '0xde32899f': ['validatorBondBps', 'uint256'],
 '0xab579ada': ['validatorBondMin', 'uint256'],
 '0x6c7b5227': ['validatorBondMax', 'uint256'],
 '0x1094c2b1': ['validatorSlashBps', 'uint256'],
 '0x7279f1fe': ['maxActiveJobsPerAgent', 'uint256'],
 '0xa6ef379d': ['maxJobPayout', 'uint256'],
 '0xeaf44543': ['jobDurationLimit', 'uint256'],
 '0x3f15457f': ['ens', 'address'],
 '0xa8e5fbc0': ['nameWrapper', 'address'],
 '0xd578b4a3': ['clubRootNode', 'bytes32'],
 '0x634bf46c': ['alphaClubRootNode', 'bytes32'],
 '0xa5c7af95': ['agentRootNode', 'bytes32'],
 '0xeb7bfaba': ['alphaAgentRootNode', 'bytes32'],
 '0xbdb5ca46': ['validatorMerkleRoot', 'bytes32'],
 '0x2634d360': ['agentMerkleRoot', 'bytes32'],
 '0x2167129e': ['lockIdentityConfig', 'bool'],
 '0x932f1484': ['agentNftRequired', 'bool'],
 '0x275979d7': ['ensJobPages', 'address'],
 '0xb0c2aa5e': ['nextJobId', 'uint256'],
 '0x75794a3c': ['nextTokenId', 'uint256'],
 '0xd8c9db6e': ['lockedEscrow', 'uint256'],
 '0xe213d680': ['lockedAgentBonds', 'uint256'],
 '0x9f36fb18': ['lockedValidatorBonds', 'uint256'],
 '0xf58d1459': ['lockedDisputeBonds', 'uint256'],
 '0xc2a1ef96': ['lockedClaims', 'uint256']}

CONTRACTS = {'AGIJobManager', 'UriUtils', 'TransferUtils', 'BondMath', 'ReputationMath',
             'ENSOwnership', 'NftEligibility', 'JobSettlement', 'JobValidation'}
TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
RESERVES = ['lockedEscrow', 'lockedAgentBonds', 'lockedValidatorBonds', 'lockedDisputeBonds', 'lockedClaims']
ALLOWED = {'eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'}


def word(value, kind):
    if kind == 'bool':
        require(type(value) is bool, 'Invalid Boolean observation')
        result = '1' if value else '0'
    elif kind.startswith('uint'):
        result = format(int(value), 'x')
    else:
        result = value.removeprefix('0x')
    require(re.fullmatch('[0-9a-fA-F]{1,64}', result), 'Invalid ABI value')
    return '0x' + result.lower().zfill(64)


def check_mainnet(report):
    require(report['schema'] == 'agi-fleet-mainnet-deployment-verification/v1'
            and report['status'] == 'PASS' and report['chainId'] == 1
            and report['fleetSHA256'] == SHA256 and report['sourceFilesVerified'] == 4816,
            'Deployment report identity differs')
    pin, state, observation = (report[k] for k in ['deploymentPin', 'state', 'observation'])
    require(set(pin['contracts']) == CONTRACTS and pin['chainId'] == 1
            and pin['manager'] == report['manager'] and pin['token'].lower() == TOKEN
            and state['usdcToken'].lower() == TOKEN
            and pin['deploymentBlock'] == report['creation']['block'], 'Deployment pin differs')
    require(report['actions'] == {'transactionsSent': 0, 'walletsLoaded': 0, 'operatorProfilesModified': 0},
            'Deployment verification exceeded read-only scope')
    if 'materialization' in report:
        require(report['materialization'] == {
            'status': 'PASS', 'fleetVersion': '1.0.9', 'fleetSHA256': SHA256,
            'manifestSHA256': '575b06be5344efaa861b8c5fe22fe48cfc9d97aa0edd29d474ff2218152758f6',
            'manifestEntriesVerified': 32900, 'sourceRevisionSHA256': SOURCE_REVISION,
            'sourceFilesVerified': 4816, 'rpcRequests': 0, 'transactionsSent': 0,
            'productionQualified': False}, 'Materialization verification differs')
    hosts = observation['rpcHosts']
    require(len(hosts) == len(set(hosts)) == 2 and all(re.fullmatch('[a-zA-Z0-9.-]+', h) for h in hosts),
            'Two distinct RPC hosts required')
    require(observation['bothRPCsAgree'] is True and observation['creationBoundaryVerifiedByPrimaryRPC'] is True
            and observation['creationReceiptAgreesOnBothRPCs'] is True, 'Incomplete observations')
    age = datetime.fromisoformat(report['observedAt'].replace('Z', '+00:00')).timestamp() - observation['timestamp']
    require(-90 <= age <= 300, 'Observation was stale when recorded')
    height = observation['block']
    by_address = {p['address'].lower(): name for name, p in pin['contracts'].items()}
    require(len(by_address) == 9, 'Duplicate contract addresses')
    codes = {host: {} for host in hosts}
    fields = {host: set() for host in hosts}
    receipts, boundaries, anchors, finalized = {}, {}, set(), set()
    recipients = {address.lower(): blocked for address, blocked in state['usdcBlockedRecipients'].items()}
    require(set(recipients) == {state[field].lower() for field in ['owner', 'wallet30', 'wallet10']},
            'Incomplete recipient checks')
    tokens = {host: set() for host in hosts}
    for batch in report['rpcEvidence']:
        host, requests, responses = (batch[k] for k in ['rpcHost', 'requests', 'responses'])
        require(host in hosts and len(requests) == len(responses) and requests, 'Invalid evidence batch')
        replies = {row['id']: row for row in responses}
        require(len(replies) == len(requests) and {r['id'] for r in requests} == set(replies), 'Incomplete RPC responses')
        for request in requests:
            response = replies[request['id']]
            require(request['jsonrpc'] == response['jsonrpc'] == '2.0' and 'error' not in response
                    and request['method'] in ALLOWED, 'Invalid or non-read-only RPC evidence')
            method, args, result = request['method'], request['params'], response['result']
            if method == 'eth_chainId':
                require(result == '0x1', 'RPC chain differs')
            elif method == 'eth_getTransactionReceipt':
                creation = report['creation']
                require(args == [creation['transactionHash']] and result['status'] == '0x1' and result['to'] is None
                        and result['contractAddress'].lower() == report['manager'].lower()
                        and result['transactionHash'] == creation['transactionHash']
                        and result['blockHash'] == creation['blockHash']
                        and int(result['blockNumber'], 16) == creation['block']
                        and result['from'].lower() == creation['deployer'].lower(), 'Creation receipt differs')
                receipts[host] = result
            elif method == 'eth_getBlockByNumber':
                if args[0] == hex(height):
                    require(int(result['number'], 16) == height and result['hash'] == observation['hash']
                            and int(result['timestamp'], 16) == observation['timestamp'], 'Observation block differs')
                    anchors.add(host)
                elif args[0] == 'finalized':
                    require(int(result['number'], 16) >= report['creation']['block'], 'Creation was not finalized')
                    finalized.add(host)
                else:
                    require(args[0] == 'latest' and int(result['number'], 16) >= height, 'Unexpected block read')
            elif method == 'eth_getCode':
                address, block = args[0].lower(), int(args[1], 16)
                if block == height:
                    require(address in by_address, 'Unexpected code address')
                    name = by_address[address]
                    require(name not in codes[host] or codes[host][name] == result.lower(), 'Conflicting runtime evidence')
                    codes[host][name] = result.lower()
                else:
                    require(host == hosts[0] and address == report['manager'].lower()
                            and block in [pin['deploymentBlock'] - 1, pin['deploymentBlock']], 'Unexpected historical read')
                    boundaries[block] = result.lower()
            else:
                require(args[1] == hex(height) and set(args[0]) == {'to', 'data'},
                        'Getter did not use the observation block or has unexpected parameters')
                address, data = args[0]['to'].lower(), args[0]['data'].lower()
                if address == report['manager'].lower():
                    require(data in GETTERS, 'Unknown manager getter')
                    field, kind = GETTERS[data]
                    require(result.lower() == word(state[field], kind), 'Manager observation differs: ' + field)
                    fields[host].add(field)
                else:
                    require(address == TOKEN, 'Unexpected token address')
                    if data == '0x313ce567': value, kind = state['usdcDecimals'], 'uint8'
                    elif data == '0x70a08231' + report['manager'][2:].lower().zfill(64):
                        value, kind = state['managerUSDCBalance'], 'uint256'
                    elif data == '0x5c975abb': value, kind = state['usdcPaused'], 'bool'
                    elif data.startswith('0xfe575a87') and len(data) == 74:
                        recipient = '0x' + data[-40:]
                        value, kind = (state['managerUSDCBlacklisted'] if recipient == report['manager'].lower()
                                       else recipients[recipient]), 'bool'
                    else: raise ValueError('Unexpected token getter')
                    require(result.lower() == word(value, kind), 'USDC observation differs')
                    tokens[host].add(data)
    require(set(receipts) == anchors == finalized == set(hosts) and receipts[hosts[0]] == receipts[hosts[1]],
            'Incomplete block or receipt evidence')
    expected_tokens = {'0x313ce567', '0x5c975abb', '0x70a08231' + report['manager'][2:].lower().zfill(64),
                       *['0xfe575a87' + address[2:].zfill(64) for address in [report['manager'].lower(), *recipients]]}
    for host in hosts:
        require(fields[host] == {spec[0] for spec in GETTERS.values()} and tokens[host] == expected_tokens
                and set(codes[host]) == CONTRACTS, 'Incomplete runtime or getter evidence')
        for name, code in codes[host].items():
            artifact = json.loads((ROOT / 'fleet/packages/AGI_Agent/contract/artifacts' / (name + '.json')).read_text())
            expected = artifact['deployedBytecode'].lower()
            def substitute(ref, address):
                nonlocal expected
                value = address.removeprefix('0x').lower().zfill(ref['length'] * 2)
                require(len(value) == ref['length'] * 2, 'Invalid runtime substitution')
                start = 2 + ref['start'] * 2
                expected = expected[:start] + value + expected[start + ref['length'] * 2:]
            for libraries in artifact['deployedLinkReferences'].values():
                for library, refs in libraries.items():
                    for ref in refs: substitute(ref, pin['contracts'][library]['address'])
            for refs in artifact['immutableReferences'].values():
                for ref in refs: substitute(ref, pin['token'] if name == 'AGIJobManager' else pin['contracts'][name]['address'])
            require(code == expected, 'Runtime artifact differs: ' + name)
    require(codes[hosts[0]] == codes[hosts[1]] and boundaries.get(pin['deploymentBlock'] - 1) == '0x'
            and boundaries.get(pin['deploymentBlock']) == codes[hosts[0]]['AGIJobManager'], 'Creation boundary or runtime disagreement')
    reserved = sum(int(state[k]) for k in RESERVES)
    require(state['usdcDecimals'] == 6 and int(state['managerUSDCBalance']) >= reserved, 'Invalid USDC reserves')
    assessment = report['assessment']
    require(assessment['productionQualified'] is False and assessment['fundedWorkEnabledByThisVerification'] is False
            and assessment['operatorIdentityQualification'] == assessment['operatorDualArchiveRPCQualification'] == 'NOT_RUN'
            and assessment['runtimeCompatibility'] == 'PASS' and assessment['linkedProductionContracts'] == 9
            and assessment['nativeUSDC'] is True and assessment['reservesSolventAtObservedBlock'] is True
            and assessment['totalReservedUSDCBaseUnits'] == str(reserved)
            and assessment['intakeOpen'] == (not state['paused'])
            and assessment['settlementOpen'] == (not state['settlementPaused'])
            and assessment['nativeUSDCAvailable'] == (not state['usdcPaused'] and not state['managerUSDCBlacklisted']
                                                       and not any(recipients.values())), 'Deployment scope or assessment differs')
    return {'status': 'PASS', 'rpcHosts': hosts, 'runtimeContracts': 9, 'managerGettersPerHost': len(GETTERS),
            'observationBlock': height, 'intakeOpenAtObservedBlock': assessment['intakeOpen'], 'productionQualified': False}
