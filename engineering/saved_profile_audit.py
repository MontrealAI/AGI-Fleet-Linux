"""Independent saved-archive Manager 1.17 evidence audit; no execution or network."""
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile

from contract_profiles import CONTRACT_PROFILES, baseline
from next_release_tools import provenance, verify_candidate
from release_tools import members, require, sha

PROFILE = 'manager-1.17.0-b7218196'
STEPS = ['legacy-artifact-reproduction', 'profile-artifact-reproduction',
         *[package + '-' + script.removesuffix('.mjs')
           for package, scripts in baseline.SCRIPTS.items() for script in scripts],
         'profile-lifecycle', 'manager-regression']
CLASSIFICATION = 'SAVED_ARCHIVE_LOCAL_MOCK_VALIDATION_NOT_RELEASE_QUALIFICATION'


def read(path):
    return json.loads(path.read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def audit_saved_profile(directory, archive, candidate, expected_commit, expected_run):
    """Return one architecture's audit; caller must require x64 and arm64 together."""
    directory, archive = Path(directory).absolute(), Path(archive).absolute()
    require(re.fullmatch(r'[a-f0-9]{40}', str(expected_commit))
            and re.fullmatch(r'[1-9][0-9]*', str(expected_run)), 'Expected workflow identity is missing')
    require(directory.is_dir() and directory.resolve() == directory, 'Profile evidence must be a canonical directory')
    expected_files = {'summary.json', 'candidate-binding.json', 'archive-members.json',
                      'profile-integration/summary.json', 'profile-integration/profile-lifecycle.json',
                      *['profile-integration/' + name + '.log' for name in STEPS]}
    actual_files = set()
    for file in directory.rglob('*'):
        mode = file.lstat().st_mode
        require(stat.S_ISREG(mode) or stat.S_ISDIR(mode), 'Profile evidence contains a link or special file')
        if stat.S_ISREG(mode): actual_files.add(file.relative_to(directory).as_posix())
    require(actual_files == expected_files and len(STEPS) == 12, 'Profile retained evidence coverage differs')
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size == candidate['bytes']
            and sha(archive) == candidate['sha256'], 'Profile candidate archive binding differs')
    receipt = verify_candidate(archive, candidate)
    binding = provenance(candidate)
    require(read(directory / 'candidate-binding.json') == binding, 'Profile candidate evidence binding differs')
    report = read(directory / 'summary.json')
    definition = CONTRACT_PROFILES[PROFILE]
    require(report['schema'] == 'agi-fleet-saved-profile-integration/v1' and report['status'] == 'PASS'
            and report['classification'] == CLASSIFICATION and report['productionQualified'] is False
            and report['completeArchiveUnchanged'] is True, 'Saved profile integration did not pass')
    require(report['workflowCommit'] == expected_commit and str(report['workflowRun']) == str(expected_run)
            and re.fullmatch(r'[1-9][0-9]*', str(report['workflowRunAttempt'])), 'Profile workflow identity differs')
    require(report['profile'] == PROFILE and report['profileManifestSHA256'] == definition['manifestSHA256']
            and report['manager']['commit'] == definition['commit'], 'Selected profile identity differs')
    require(report['candidateBinding'] == binding and report['archiveVerification'] == receipt,
            'Profile archive verification differs')
    architecture = report['runtime']['architecture']
    require(architecture in baseline.NODE_SHA and report['runtime'] == {
        'node': '24.21.0', 'architecture': architecture, 'platform': 'linux',
        'nodeArchiveSHA256': baseline.NODE_SHA[architecture]}, 'Profile native runtime differs')
    require(re.fullmatch(r'[a-f0-9]{64}', report['nodeBinarySHA256']), 'Profile Node executable identity is missing')
    require(report['limitations'] == {'localChainId': 31337, 'mockUSDCOnly': True,
            'physicalInstallation': False, 'publicChainDeployment': False, 'independentOperators': False},
            'Profile limits were broadened')

    # Independently regenerate the entire archive map, never trust the runner's
    # map, a source-only extraction, or a locally recomputed mutable manifest.
    prefix = candidate['prefix'] + '/'
    expected_members = {}
    with zipfile.ZipFile(archive) as saved:
        for entry in members(saved):
            require(entry.filename.startswith(prefix), 'Profile archive prefix differs')
            with saved.open(entry) as stream:
                checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
            expected_members[entry.filename[len(prefix):]] = {
                'sha256': checksum, 'bytes': entry.file_size,
                'executable': bool(entry.external_attr >> 16 & 0o111)}
        inventory = json.loads(saved.read(prefix + 'source-inventory.json'))
        rows = inventory['files']
        revision = digest(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode())
        require(revision == inventory['revisionSHA256'] == candidate['sourceRevisionSHA256']
                and len(rows) == candidate['sourceFiles'], 'Profile saved source inventory differs')
        source = {'files': len(rows), 'revisionSHA256': revision}
        require(report['before'] == report['after'] == source, 'Profile before/after source identity differs')
        bundle = 'shared/runtime/contract-profiles/'
        manifest_bytes = saved.read(prefix + bundle + PROFILE + '.json')
        require(digest(manifest_bytes) == definition['manifestSHA256'], 'Reviewed profile manifest differs')
        manifest = json.loads(manifest_bytes)
        require(manifest['profile'] == PROFILE and manifest['sourceCommit'] == definition['commit'], 'Profile source provenance differs')
        base = prefix + bundle + PROFILE + '/'
        for name, checksum in manifest['files'].items():
            require(digest(saved.read(base + name)) == checksum, 'Reviewed profile member differs: ' + name)
        build_receipt = json.loads(saved.read(base + 'BUILD_RECEIPT.json'))
        require(build_receipt['sourceCommit'] == definition['commit'], 'Reviewed Manager receipt differs')
        manager = {'commit': definition['commit'],
                   'lockfileSHA256': build_receipt['files']['package-lock.json']['sha256'],
                   'hardhatLockfileSHA256': build_receipt['files']['hardhat/package-lock.json']['sha256']}
        require(report['manager'] == manager, 'Profile Manager lock binding differs')
        sources = [{'path': name.removeprefix('project/'), 'sha256': checksum}
                   for name, checksum in sorted(manifest['productionSources'].items())]
        require(len(sources) == 11, 'Profile production source coverage differs')
        artifacts = []
        for name in baseline.ARTIFACTS:
            artifact = json.loads(saved.read(base + 'artifacts/' + name + '.json'))
            artifacts.append({'name': name,
                'abiSHA256': digest(json.dumps(artifact['abi'], sort_keys=True, separators=(',', ':')).encode()),
                'bytecodeSHA256': digest(artifact['bytecode'].encode()),
                'deployedBytecodeSHA256': digest(artifact['deployedBytecode'].encode()), 'immutableOffsetsMatch': True})
    require(read(directory / 'archive-members.json') == expected_members
            and sha(directory / 'archive-members.json') == report['archiveMembersSHA256']
            and report['completeArchiveFiles'] == len(expected_members), 'Complete archive member map differs')
    archive_identity = {'files': len(expected_members), 'membersSHA256': digest(
        json.dumps(expected_members, sort_keys=True, separators=(',', ':')).encode())}
    require(report['completeArchiveBefore'] == report['completeArchiveAfter'] == archive_identity,
            'Complete archive before/after identity differs')

    child_file = directory / 'profile-integration/summary.json'
    child = read(child_file)
    require(sha(child_file) == report['integrationSummarySHA256']
            and child['schema'] == 'agi-fleet-contract-profile-source-validation/v1'
            and child['status'] == 'PASS' and child['classification'] == CLASSIFICATION
            and child['productionQualified'] is False and child['savedArchiveBinding'] == binding,
            'Nested profile summary binding differs')
    require(child['source'] == source and child['profile'] == PROFILE
            and child['profileManifestSHA256'] == definition['manifestSHA256']
            and child['managerCommit'] == manager['commit']
            and child['managerLockfileSHA256'] == manager['lockfileSHA256']
            and child['managerHardhatLockfileSHA256'] == manager['hardhatLockfileSHA256']
            and child['node'] == '24.21.0' and child['nodeBinarySHA256'] == report['nodeBinarySHA256'],
            'Nested profile identities differ')
    require(child['limitations'] == {'chainId': 31337, 'mockUSDCOnly': True, 'deterministicFixtureWallets': True,
            'liveInference': False, 'publicIPFS': False, 'publicChainDeployment': False, 'independentOperators': False,
            'physicalInstallation': False, 'savedArchiveQualification': False, 'savedArchiveBytesExercised': True},
            'Nested profile scope differs')
    require([step['name'] for step in child['steps']] == STEPS and report['integrationSteps'] == 12
            and report['steps'] == [{**step, 'log': 'profile-integration/' + step['log']} for step in child['steps']],
            'Profile integration step coverage differs')
    logs = {}
    for step in child['steps']:
        require(step['exitCode'] == 0 and step['log'] == step['name'] + '.log', 'Profile step failed or log path differs')
        file = directory / 'profile-integration' / step['log']
        require(sha(file) == step['logSHA256'], 'Profile retained log hash differs')
        logs[step['name']] = file.read_text()
    for name, profile in [('legacy-artifact-reproduction', 'manager-legacy-db876a8'),
                          ('profile-artifact-reproduction', PROFILE)]:
        matches = re.findall(r'^MATCH (\w+)$', logs[name], re.MULTILINE)
        require(len(matches) == 11 and set(matches) == set(baseline.ARTIFACTS)
                and 'All 11 artifacts reproduced exactly' in logs[name]
                and 'Verified contract profile ' + profile + ' ' + CONTRACT_PROFILES[profile]['manifestSHA256'] in logs[name],
                'Profile artifact reproduction is incomplete')
    counts = [json.loads(line) for line in logs['manager-regression'].splitlines() if line.startswith('{"collectedTests":')]
    expected_counts = {'collectedTests': 792, 'executedTests': 792, 'passedTests': 792}
    require(counts == [expected_counts] and child['managerRegression'] == report['managerRegression'] == expected_counts,
            'Profile Manager regression counts differ')
    comparison = child['contractCompatibility']
    require(comparison['status'] == 'PASS' and comparison['bundledSourceCommit'] == definition['commit']
            and comparison['contractProfile'] == PROFILE and comparison['contractProfileSHA256'] == definition['manifestSHA256']
            and comparison['productionSources'] == sources and comparison['artifacts'] == artifacts,
            'Profile exact source/artifact comparison differs')
    lifecycle_file = directory / 'profile-integration/profile-lifecycle.json'
    lifecycle = read(lifecycle_file)
    require(sha(lifecycle_file) == report['lifecycleReportSHA256']
            and lifecycle == report['lifecycle'] == child['lifecycle']
            and lifecycle['schema'] == 'agi-fleet-job-lifecycle/v1' and lifecycle['status'] == 'PASS'
            and lifecycle['chainId'] == 31337 and lifecycle['contractProfile'] == PROFILE
            and lifecycle['contractProfileSHA256'] == definition['manifestSHA256'], 'Profile lifecycle binding differs')
    for key, value in {'linkedProductionContracts': 9, 'defaultVoteQuorum': 3, 'defaultReviewPeriodSeconds': 604800,
                       'agentGenerationCount': 1, 'publicationCount': 1, 'managerTokenBalanceAfter': '0',
                       'conservedTotalMockUSDC': '5000000000'}.items():
        require(lifecycle[key] == value, 'Profile lifecycle accounting differs: ' + key)
    for key in ['persistedAgentPreparationAndApproval', 'threePersistedNodeVotes', 'exactBondAllowancesConsumed',
                'persistedFinalization', 'deferredClaimsConservedUSDC', 'persistedAgentAndNodeClaims',
                'noDuplicateTransactionsAfterRestart', 'releasedAllClientExposure']:
        require(lifecycle[key] is True, 'Profile lifecycle coverage differs: ' + key)
    for key in ['liveInference', 'publicIPFS', 'nativeUSDC', 'independentlyOperatedValidators',
                'independentRPCBackends', 'realTimeEndurance']:
        require(lifecycle['limitations'][key] is False, 'Profile lifecycle scope was broadened')
    return {'status': 'PASS', 'architecture': architecture, 'workflowCommit': expected_commit,
            'workflowRun': str(expected_run), 'productionQualified': False, 'profile': PROFILE,
            'profileManifestSHA256': definition['manifestSHA256'], 'managerCommit': definition['commit'],
            'managerTestsPassed': 792, 'standaloneIntegrationScripts': 8, 'contractArtifactsMatched': 11,
            'verifiedLogs': 12, 'archiveSHA256': candidate['sha256'], 'sourceRevisionSHA256': source['revisionSHA256'],
            'completeArchiveUnchanged': True}
