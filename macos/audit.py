#!/usr/bin/env python3
"""Independently audit the exact Mac archive and retained native evidence."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engineering'))
from release_tools import LIMIT, extract, require, sha
from next_release_tools import adapt_baseline

REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
LABELS = ('macos-15', 'macos-26')
COUNTS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
BAD = ('fail', 'cancelled', 'skipped', 'todo')
NODE_SHA = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe'
FIXTURE_SHA = '4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014'
FIXTURE_BYTES = 211966077
SYSTEM_NODE_CANDIDATES = [
    '/opt/homebrew/bin/node', '/opt/homebrew/opt/node/bin/node',
    '/opt/homebrew/opt/node@24/bin/node', '/opt/homebrew/opt/node@22/bin/node',
    '/usr/local/bin/node', '/usr/local/opt/node/bin/node',
    '/usr/local/opt/node@24/bin/node', '/usr/local/opt/node@22/bin/node', '/usr/bin/node',
]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key: ' + key)
        result[key] = value
    return result


def decode_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def read_json(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Missing or linked JSON: ' + str(path))
    return decode_json(path.read_bytes())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def provenance(commit, repository, run_id):
    require(isinstance(commit, str) and re.fullmatch('[0-9a-f]{40}', commit), 'Exact workflow commit required')
    require(repository == REPOSITORY, 'Unexpected publication repository')
    require(re.fullmatch('[1-9][0-9]*', str(run_id)), 'Exact workflow run required')


def candidate_binding(metadata, commit, repository, run_id):
    provenance(commit, repository, run_id)
    return {'schema': 'agi-macos-validation-binding/v1',
            'candidate': {key: metadata[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')},
            'workflowCommit': commit, 'repository': repository, 'workflowRun': str(run_id),
            'productionQualified': False}


def regular_tree(directory):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), 'Missing or linked evidence directory')
    for path in directory.rglob('*'):
        require(not path.is_symlink(), 'Evidence symlinks are forbidden')
        require(path.is_dir() or stat.S_ISREG(path.stat().st_mode), 'Special evidence files are forbidden')
        if path.is_file():
            require(path.stat().st_size < LIMIT, 'Evidence member exceeds the size ceiling')


def validate_metadata(metadata, commit, repository, run_id):
    provenance(commit, repository, run_id)
    expected = read_json(ROOT / 'macos/release.json')
    require(metadata.get('schema') == 'agi-macos-candidate-build/v1', 'Unexpected candidate schema')
    for key, value in expected.items():
        if key != 'schema':
            require(metadata.get(key) == value, 'Candidate specification differs: ' + key)
    require(metadata.get('workflowCommit') == metadata.get('repositoryCommit') == commit, 'Build commit differs')
    for key in ('sha256', 'sourceRevisionSHA256'):
        require(isinstance(metadata.get(key), str) and re.fullmatch('[0-9a-f]{64}', metadata[key]), 'Invalid candidate digest')
    require(type(metadata.get('bytes')) is int and 0 < metadata['bytes'] < LIMIT, 'Invalid candidate size')
    require(type(metadata.get('sourceFiles')) is int and metadata['sourceFiles'] >= 4816, 'Incomplete source inventory')
    require(metadata['productionQualified'] is False and metadata['physicalQualification'] == 'NOT_RUN'
            and metadata['signedNotarized'] is False, 'Qualification scope differs')
    inputs = metadata.get('buildInputs')
    require(isinstance(inputs, list) and bool(inputs), 'Missing build input inventory')
    names = [row['path'] for row in inputs]
    require(len(names) == len(set(names)), 'Duplicate build input')
    expected_inputs = {path.relative_to(ROOT).as_posix() for path in (ROOT / 'macos').rglob('*')
                       if path.is_file() and not path.is_symlink() and '__pycache__' not in path.parts}
    require(set(names) == expected_inputs, 'Build input coverage differs')
    for row in inputs:
        require(sha(ROOT / row['path']) == row['sha256'], 'Build input changed: ' + row['path'])


def parse_tap(data):
    text = data.decode('utf-8')
    require(text.startswith('TAP version 13\n'), 'Missing TAP header')
    require(not re.search(r'^\s*not ok\b|^\s*ok \d+ .* #\s*(?:SKIP|TODO)\b|^\s*Bail out!', text, re.M | re.I),
            'Failed, skipped or aborted TAP case')
    plans = re.findall(r'^1\.\.(\d+)$', text, re.M)
    assertions = re.findall(r'^ok (\d+) - ', text, re.M)
    require(len(plans) == 1 and int(plans[0]) > 0
            and list(map(int, assertions)) == list(range(1, int(plans[0]) + 1)), 'Incomplete TAP plan')
    counts = {}
    for key in COUNTS:
        values = re.findall(r'^# ' + key + r' (\d+)$', text, re.M)
        require(len(values) == 1, 'Missing or ambiguous TAP summary: ' + key)
        counts[key] = int(values[0])
    require(counts['tests'] == counts['pass'] > 0 and not any(counts[key] for key in BAD), 'TAP counts did not pass')
    require(len(re.findall(r'^\s*ok \d+ - ', text, re.M)) == counts['tests'] + counts['suites'],
            'TAP case inventory differs from its summary')
    return counts


def archive_identity(archive, metadata):
    prefix = metadata['prefix'] + '/'
    tree = {}
    with zipfile.ZipFile(archive) as saved:
        for item in saved.infolist():
            require(item.filename.startswith(prefix) and not item.is_dir(), 'Unexpected archive member')
            relative = item.filename[len(prefix):]
            require(relative and relative not in tree, 'Duplicate archive member')
            with saved.open(item) as stream:
                checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
            tree[relative] = {'sha256': checksum, 'mode': stat.S_IMODE(item.external_attr >> 16)}
        records = decode_json(saved.read(prefix + 'source-inventory.json'))['files']
        source = {row['path']: row['sha256'] for row in records}
        require(len(source) == len(records) == metadata['sourceFiles'], 'Source inventory coverage differs')
        fixture_lock = decode_json(saved.read(prefix + 'test-support/regression-fixtures.json'))
        openclaw_inventory = decode_json(saved.read(prefix + 'shared/runtime/compute/openclaw-2026.9.5.inventory.json'))
    tests = {name for name in tree if re.fullmatch(r'(?:tests|packages/[^/]+/tests)/[^/]+\.test\.mjs', name)}
    require(len(tests) >= 342 and tests <= source.keys(), 'Complete regression sources missing')
    return tree, source, tests, fixture_lock, openclaw_inventory


def audit_complete(directory, tree, sources, selection, node, fixture_lock):
    result = read_json(directory / 'results.json')
    require(result['schema'] == 'agi-full-regressions/v1' and result['status'] == 'PASS'
            and result['scope'] == 'FULL' and all(result[key] is True for key in
            ('complete', 'sourceUnchanged', 'retainedLogsUnchanged')), 'Native suite is incomplete or changed')
    rows = result['results']
    require(result['testFiles'] == len(rows) == len(selection), 'Native test file count differs')
    require(len({row['file'] for row in rows}) == len(rows)
            and {row['file'] for row in rows} == selection, 'Native test coverage differs')
    require(read_json(directory / 'tested-source.json') == sources, 'Tested source differs from saved archive')
    prerequisites = result['prerequisites']
    require(prerequisites == read_json(directory / 'prerequisites.json'), 'Prerequisite receipt differs')
    require(prerequisites['node'] == {'version': 'v24.21.0', 'sha256': node['executableSHA256']}
            and prerequisites['unixSocket']['available'] is True
            and prerequisites['openclaw']['version'] == '2026.9.5'
            and type(prerequisites['openclaw']['verifiedFiles']) is int
            and prerequisites['openclaw']['verifiedFiles'] > 0, 'Pinned runtime prerequisites differ')
    history = prerequisites['historical']
    require(len(history) == len(fixture_lock['historical']), 'Historical fixture count differs')
    for actual, expected in zip(history, fixture_lock['historical']):
        require({key: value for key, value in actual.items() if key != 'verifiedFiles'} == expected
                and type(actual.get('verifiedFiles')) is int and actual['verifiedFiles'] > 0,
                'Historical fixture binding differs')
    totals, logs = Counter(), set()
    for row in rows:
        log = row['log']
        require(isinstance(log, str) and PurePosixPath(log).name == log and log.endswith('.tap')
                and log not in logs, 'Unsafe or duplicate retained log')
        logs.add(log)
        data = (directory / log).read_bytes()
        require(type(row['logBytes']) is int and len(data) == row['logBytes']
                and digest(data) == row['logSHA256'], 'Retained TAP bytes differ')
        require(row['sourceSHA256'] == tree[row['file']]['sha256'], 'Executed test source differs')
        counts = parse_tap(data)
        require(counts == row['counts'] and type(row['exitCode']) is int and row['exitCode'] == 0
                and row['timedOut'] is False and row['completeSummary'] is True, 'Native test failed or result differs')
        totals.update(counts)
    require({path.name for path in directory.glob('*.tap')} == logs, 'Retained TAP log coverage differs')
    require(not any(path.name.endswith(('.running', '.tmp')) for path in directory.iterdir()), 'Unfinished evidence remains')
    require(dict(totals) == result['counts'] and totals['tests'] == totals['pass'] >= 3898,
            'Native total count differs or baseline coverage decreased')
    return {'status': 'PASS', 'counts': dict(totals), 'testFiles': len(selection),
            'verifiedLogs': len(logs), 'verifiedSourceFiles': len(sources),
            'resultsSHA256': sha(directory / 'results.json'), 'testedSourceSHA256': sha(directory / 'tested-source.json')}


def audit_host_gates(directory, tree, macos):
    gates = read_json(directory / 'mac-host.json')
    require(gates['schema'] == 'agi-macos-packaged-host-gates/v1' and gates['status'] == 'PASS'
            and gates['platform'] == 'darwin' and gates['architecture'] == 'arm64'
            and gates['productionQualified'] is False, 'Packaged Mac host gates did not pass')
    roles = ('agent', 'node', 'moderator', 'employer', 'evidence', 'recovery')
    expected = {'fleet': '', **{role: 'packages/AGI_' + role.title() + '/' for role in roles}}
    require(len(gates['cases']) == 7 and {row['edition'] for row in gates['cases']} == set(expected),
            'Packaged host gate edition coverage differs')
    logs = set()
    observation = {'schema': 'agi-macos-host/v1', 'platform': 'darwin', 'arch': 'arm64',
                   'osVersion': macos, 'translated': False, 'productionQualified': False}
    for row in gates['cases']:
        prefix = expected[row['edition']]
        require(row['script'] == prefix + 'scripts/check-mac-host.mjs'
                and row['module'] == prefix + 'shared/runtime/compute/mac-host.mjs'
                and row['scriptSHA256'] == tree[row['script']]['sha256']
                and row['moduleSHA256'] == tree[row['module']]['sha256']
                and row['observation'] == observation
                and row['status'] == 'PASS' and type(row['exitCode']) is int and row['exitCode'] == 0,
                'Packaged host gate identity or native observation differs')
        log = row['log']
        require(isinstance(log, str) and re.fullmatch(r'mac-host-[0-6]\.log', log) and log not in logs,
                'Unsafe or duplicate Mac host log')
        logs.add(log)
        require(sha(directory / log) == row['logSHA256']
                and read_json(directory / log) == observation, 'Retained native Mac host observation differs')
    require({path.name for path in directory.glob('mac-host-*.log')} == logs, 'Mac host log coverage differs')


def audit_ci_system_node(directory, node, openclaw_inventory, commit, repository, run_id):
    """Bind the disposable runner's upstream probe without broadening product trust."""
    receipt = read_json(directory / 'system-node.json')
    require(receipt['schema'] == 'agi-macos-ci-system-node/v1' and receipt['status'] == 'PASS'
            and receipt['scope'] == 'DISPOSABLE_GITHUB_HOSTED_CI_ONLY'
            and receipt['operatorAccountsUsed'] is False, 'System Node provisioning has the wrong scope or status')
    require(receipt['repository'] == repository and receipt['workflowCommit'] == commit
            and str(receipt['githubRunId']) == str(run_id), 'System Node receipt workflow provenance differs')
    require(receipt['systemNodeCandidates'] == SYSTEM_NODE_CANDIDATES
            and receipt['target'] == SYSTEM_NODE_CANDIDATES[0], 'Pinned upstream system Node candidate scope differs')
    require(receipt['target'] == '/opt/homebrew/bin/node' and receipt['version'] == '24.21.0'
            and receipt['archiveSHA256'] == NODE_SHA
            and receipt['executableSHA256'] == node['executableSHA256'], 'Provisioned Node is not the verified private runtime')
    require(receipt['restoration'] == 'PASS' and receipt['originalPreserved'] is True
            and receipt['parentPermissionsUnchanged'] is True, 'Original system Node or directory permissions were not restored')
    original = receipt['originalEntry']
    require(original == receipt['restoredEntry'], 'Restored system Node differs from its original entry')
    require(isinstance(original, dict) and original.get('kind') in ('file', 'symlink', 'absent'), 'Unsafe original system Node entry')
    if original['kind'] == 'absent':
        require(original == {'kind': 'absent'}, 'Malformed absent system Node entry')
    else:
        keys = {'kind', 'uid', 'gid', 'mode', 'sha256'}
        if original['kind'] == 'symlink':
            keys.add('linkTarget')
        require(set(original) == keys and all(type(original[key]) is int and original[key] >= 0
                    for key in ('uid', 'gid', 'mode')) and original['mode'] <= 0o7777
                and re.fullmatch('[0-9a-f]{64}', original['sha256']), 'Malformed original system Node identity')
        if original['kind'] == 'symlink':
            require(isinstance(original['linkTarget'], str) and original['linkTarget']
                    and '\x00' not in original['linkTarget']
                    and digest(original['linkTarget'].encode()) == original['sha256'], 'Original Node symlink identity differs')
    parents = receipt['parentsBefore']
    require(type(receipt['runnerUID']) is int and receipt['runnerUID'] > 0, 'Missing disposable runner ownership identity')
    require(parents == receipt['parentsAfter'] and isinstance(parents, list)
            and [row['path'] for row in parents] == ['/opt/homebrew/bin', '/opt/homebrew', '/opt', '/'],
            'System Node parent coverage or identity changed')
    for row in parents:
        require(set(row) == {'path', 'uid', 'gid', 'mode'}
                and all(type(row[key]) is int and row[key] >= 0 for key in ('uid', 'gid', 'mode'))
                and row['mode'] <= 0o7777, 'Malformed system Node parent identity')
        require(row['uid'] in (0, receipt['runnerUID']) and not row['mode'] & 0o002
                and (not row['mode'] & 0o020 or row['gid'] == 80), 'Unsafe system Node parent ownership or permissions')
    provisioned = receipt['provisionedEntry']
    require(set(provisioned) == {'kind', 'uid', 'gid', 'mode', 'sha256'}
            and provisioned['kind'] == 'file' and type(provisioned['uid']) is int and provisioned['uid'] == 0
            and type(provisioned['gid']) is int and provisioned['gid'] >= 0
            and type(provisioned['mode']) is int and provisioned['mode'] == 0o755
            and provisioned['sha256'] == node['executableSHA256'], 'Provisioned Node file identity differs')
    probe = receipt['probe']
    require(set(probe) == {'path', 'status', 'version', 'sqliteVersion'}
            and probe['path'] == receipt['target'] and probe['status'] == 'supported'
            and probe['version'] == '24.21.0' and isinstance(probe['sqliteVersion'], str)
            and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', probe['sqliteVersion']), 'Pinned upstream system Node probe did not pass')
    module_path = 'dist/runtime-paths-4M-K3zyp.mjs'
    require(receipt['probeModule'] == module_path
            and receipt['probeModuleSHA256'] == openclaw_inventory['files'][module_path]['sha256']
            and receipt['probeSHA256'] == node['executableSHA256'] and receipt['probeWarnings'] == [],
            'Upstream system Node probe module, executable or warnings differ')
    require(receipt['probeLog'] == 'system-node-probe.json'
            and sha(directory / receipt['probeLog']) == receipt['probeLogSHA256']
            and read_json(directory / receipt['probeLog']) == probe, 'Retained system Node probe differs')
    return sha(directory / 'system-node.json')


def audit_native(directory, label, metadata, metadata_sha, identity, commit, repository, run_id):
    regular_tree(directory)
    runner = read_json(directory / 'runner.json')
    require(runner['platform'] == 'darwin' and runner['architecture'] == 'arm64'
            and runner['runnerLabel'] == label and runner['runnerOS'] == 'macOS'
            and runner['runnerArchitecture'] == 'ARM64' and runner['runnerEnvironment'] == 'github-hosted'
            and runner['uid'] == 0 and runner['operatorAccountsUsed'] is False
            and runner['productionQualified'] is False, 'Native runner identity differs')
    require(runner['repository'] == repository and runner['workflowCommit'] == commit
            and str(runner['githubRunId']) == str(run_id), 'Native workflow provenance differs')
    require(str(runner['macOS']).split('.')[0] == label.removeprefix('macos-'), 'Native macOS major version differs')
    require(read_json(directory / 'release-metadata.json') == metadata
            and sha(directory / 'release-metadata.json') == metadata_sha, 'Native release metadata differs')
    tree, sources, selection, fixture_lock, openclaw_inventory = identity
    require(read_json(directory / 'tested-archive-tree.json') == tree, 'Native extracted tree differs from archive')
    audit_host_gates(directory, tree, runner['macOS'])
    node = read_json(directory / 'node-download.json')
    require(node['sha256'] == NODE_SHA and node['version'] == '24.21.0'
            and node['url'] == 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.xz'
            and type(node['bytes']) is int and node['bytes'] > 0
            and re.fullmatch('[0-9a-f]{64}', node['executableSHA256']), 'Pinned Darwin Node differs')
    require(read_json(directory / 'node-identity.json') == {
        'platform': 'darwin', 'architecture': 'arm64', 'version': '24.21.0'}, 'Node was not native Darwin arm64')
    system_node_sha = audit_ci_system_node(directory, node, openclaw_inventory, commit, repository, run_id)
    fixture = read_json(directory / 'fixture-download.json')
    require(fixture == {'url': 'https://github.com/' + repository + '/releases/download/v1.0.6-qualification/'
                        'AGI_Regression_Fixtures_v1.19.6.zip', 'bytes': FIXTURE_BYTES, 'sha256': FIXTURE_SHA},
            'Pinned historical fixture archive differs')
    require(read_json(directory / 'native-capability.json') == {'unixSocketRoundTrip': 'PASS',
        'foreignSocketOwnership': 'PASS', 'foreignDirectoryOwnership': 'PASS'}, 'Native ownership capabilities failed')
    cli = read_json(directory / 'openclaw-cli-version.json')
    require(cli['expected'] == '2026.9.5' and '2026.9.5' in cli['output'].split(), 'Pinned OpenClaw CLI differs')
    saved = read_json(directory / 'saved-archive-validation.json')
    require(saved['status'] == 'PASS_ARCHIVE_INTEGRITY' and saved['sha256'] == metadata['sha256']
            and saved['bytes'] == metadata['bytes'] and saved['freshExtraction'] is True
            and all(saved[key] is True for key in ('crcVerified', 'allManifestsVerified',
                'sourceInventoryVerified', 'executableModesVerified')), 'Native saved archive verification differs')
    complete = audit_complete(directory / 'complete', tree, sources, selection, node, fixture_lock)
    summary = read_json(directory / 'summary.json')
    require(summary['schema'] == 'agi-macos-native-acceptance/v1' and summary['status'] == summary['nativeAcceptance'] == 'PASS'
            and summary['version'] == metadata['version'] and summary['releaseSHA256'] == metadata['sha256']
            and summary['releaseMetadataSHA256'] == metadata_sha and summary['platform'] == 'darwin'
            and summary['architecture'] == 'arm64' and summary['physicalQualification'] == 'NOT_RUN'
            and summary['productionQualified'] is False and summary['operatorAccountsUsed'] is False
            and summary['archiveTreeUnchanged'] is True and summary['packagedHostGates'] == 'PASS',
            'Native acceptance summary differs')
    require(summary['systemNodeProvisioning'] == 'PASS', 'Disposable system Node provisioning was not fully restored')
    require(summary['workflowCommit'] == commit and str(summary['githubRunId']) == str(run_id)
            and summary['repository'] == repository and summary['runnerLabel'] == label, 'Native summary provenance differs')
    reported = summary['complete']
    require(reported['status'] == 'PASS' and reported['runnerExitCode'] == 0
            and reported['counts'] == complete['counts'] and reported['testFiles'] == complete['testFiles'],
            'Native suite summary differs')
    # The runtime records safe offline probes; these never imply GUI/Docker qualification.
    smoke = read_json(directory / 'mac-launcher-smoke.json')
    require(summary['launcherSmoke'] == smoke['status'] == 'PASS'
            and smoke['scope'] == 'SEVEN_PACKAGE_INTEGRITY_LAUNCHERS_AND_OFFLINE_PRACTICE'
            and all(smoke[key] == 'NOT_RUN' for key in ('installation', 'FinderGatekeeper', 'DockerDesktop')),
            'Native launcher smoke differs')
    expected_launchers = {'Verify-Package.command', 'Practice-Offline.command',
        *('packages/AGI_' + role + '/Verify-Package.command'
          for role in ('Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery'))}
    require(len(smoke['cases']) == 8 and {row['launcher'] for row in smoke['cases']} == expected_launchers,
            'Native launcher coverage differs')
    smoke_logs = set()
    for row in smoke['cases']:
        require(row['status'] == 'PASS' and type(row['exitCode']) is int and row['exitCode'] == 0
                and row['sha256'] == tree[row['launcher']]['sha256'], 'Native launcher failed or changed')
        log = row['log']
        require(isinstance(log, str) and re.fullmatch(r'mac-launcher-[0-7]\.log', log)
                and log not in smoke_logs, 'Duplicate or unsafe launcher log')
        smoke_logs.add(log)
        require(sha(directory / log) == row['logSHA256'], 'Native launcher log changed')
        marker = ('Complete public example: approve' if row['launcher'] == 'Practice-Offline.command'
                  else 'files verified; 0 missing or changed.')
        require(marker in (directory / log).read_text(), 'Native launcher evidence is incomplete')
    require({path.name for path in directory.glob('mac-launcher-*.log')} == smoke_logs,
            'Native launcher retained log coverage differs')
    return {'status': 'PASS', 'runnerLabel': label, 'platform': 'darwin', 'architecture': 'arm64',
            'macOS': runner['macOS'], 'workflowCommit': commit, 'workflowRun': str(run_id),
            'repository': repository, 'complete': complete, 'summarySHA256': sha(directory / 'summary.json'),
            'systemNodeProvisioningSHA256': system_node_sha,
            'productionQualified': False, 'physicalQualification': 'NOT_RUN'}


def audit_integration_filesystem(directory):
    receipt = read_json(directory / 'filesystem.json')
    require(receipt == {'schema': 'agi-macos-integration-filesystem/v1', 'caseSensitive': True,
                        'distinctCaseNames': True, 'scope': 'disposable engineering workspace only'}
            and receipt['caseSensitive'] is True and receipt['distinctCaseNames'] is True,
            'Integration filesystem did not preserve distinct case-sensitive paths')
    return sha(directory / 'filesystem.json')


def audit_integration(directory, metadata, receipt, commit, repository, run_id, extraction):
    regular_tree(directory)
    filesystem_sha = audit_integration_filesystem(directory)
    require(read_json(directory / 'candidate-binding.json') == candidate_binding(metadata, commit, repository, run_id),
            'Integration candidate binding differs')
    report = read_json(directory / 'summary.json')
    require(report['platform'] == 'darwin' and report['runnerLabel'] == 'macos-26'
            and report['repository'] == repository, 'Integration native platform differs')
    auditor = adapt_baseline('audit-job-evidence.py', {
        (str, '1.0.9'): metadata['version'], (int, 4816): metadata['sourceFiles'],
        (int, 57853): sum(row['manifestFiles'] for row in receipt['editions'].values()),
        (str, 'fleet/packages/AGI_Agent/contract'): metadata['prefix'] + '/packages/AGI_Agent/contract',
    }, extra_expected_files=('candidate-binding.json', 'filesystem.json'))
    auditor.SHA256, auditor.SIZE, auditor.ROOT = metadata['sha256'], metadata['bytes'], extraction
    auditor.runner.NODE_SHA = {**auditor.runner.NODE_SHA, 'arm64': NODE_SHA}
    result = auditor.audit_run(directory, 'arm64', str(run_id), commit)
    return {**result, 'platform': 'darwin', 'runnerLabel': 'macos-26', 'repository': repository,
            'filesystemSHA256': filesystem_sha}


def audit(release, evidence, commit, repository, run_id):
    release, evidence = Path(release), Path(evidence)
    regular_tree(release); regular_tree(evidence)
    metadata_path = release / 'release.json'
    metadata = read_json(metadata_path)
    validate_metadata(metadata, commit, repository, run_id)
    archive = release / metadata['name']
    builder = module('macos_independent_archive_builder', ROOT / 'macos/build.py')
    receipt = builder.verify(archive, metadata)
    require(set(path.name for path in evidence.iterdir()) == {*LABELS, 'macos-integration-26'},
            'Exact native and integration evidence groups required')
    identity = archive_identity(archive, metadata)
    native = [audit_native(evidence / label, label, metadata, sha(metadata_path), identity,
                           commit, repository, run_id) for label in LABELS]
    require(native[0]['complete']['counts'] == native[1]['complete']['counts'], 'Native macOS coverage differs')
    with tempfile.TemporaryDirectory(prefix='agi-macos-independent-audit-') as temporary:
        extraction = Path(temporary) / 'release'
        extract(archive, extraction)
        integration = audit_integration(evidence / 'macos-integration-26', metadata, receipt,
                                        commit, repository, run_id, extraction)
    return {'schema': 'agi-macos-independent-audit/v1', 'status': 'PASS', 'version': metadata['version'],
            'releaseSHA256': metadata['sha256'], 'releaseBytes': metadata['bytes'],
            'releaseMetadataSHA256': sha(metadata_path), 'sourceRevisionSHA256': metadata['sourceRevisionSHA256'],
            'workflowCommit': commit, 'repository': repository, 'workflowRun': str(run_id),
            'native': native, 'integration': integration,
            'verifiedTapLogs': sum(row['complete']['verifiedLogs'] for row in native),
            'verifiedIntegrationLogs': integration['verifiedLogs'], 'archiveVerification': receipt,
            'nativeAcceptance': 'PASS', 'jobIntegrationAcceptance': 'PASS',
            'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL',
            'productionQualified': False, 'physicalQualification': 'NOT_RUN', 'signedNotarized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--repository', default=os.environ.get('GITHUB_REPOSITORY', REPOSITORY))
    parser.add_argument('--run-id', default=os.environ.get('GITHUB_RUN_ID'))
    args = parser.parse_args()
    require(not args.output.exists() and not args.output.is_symlink(), 'Audit output already exists')
    result = audit(args.release_dir, args.evidence_dir, args.commit, args.repository, args.run_id)
    write_json(args.output, result)
    print(json.dumps({key: result[key] for key in ('status', 'releaseSHA256', 'workflowCommit',
        'verifiedTapLogs', 'verifiedIntegrationLogs', 'productionQualified')}))


if __name__ == '__main__':
    main()
