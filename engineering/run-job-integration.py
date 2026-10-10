#!/usr/bin/env python3
"""Reproduce saved-Fleet/current-manager compatibility without public RPC or keys."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import time
import urllib.request

from release_tools import ASSET, PREFIX, ROOT, SHA256, SIZE, URL, download, extract, require, sha, verify_archive

MANAGER_REPOSITORY = 'MontrealAI/AGIJobManager'
MANAGER_BASELINE = '191cf3590e5cdc08df1bb0af500ee28a91c8b010'
NODE_VERSION = '24.21.0'
NODE_SHA = {
    'x64': 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
    'arm64': '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2',
}
SCRIPTS = {
    'AGI_Agent': ['integration.mjs', 'integration-identity.mjs', 'integration-finalization.mjs',
                  'integration-budget-recovery.mjs', 'integration-images.mjs', 'integration-computer.mjs'],
    'AGI_Node': ['integration.mjs', 'integration-finalization.mjs'],
}
ARTIFACTS = ['AGIJobManager', 'UriUtils', 'TransferUtils', 'BondMath', 'ReputationMath',
             'ENSOwnership', 'NftEligibility', 'JobSettlement', 'JobValidation', 'MockERC20', 'FailingERC20']


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def immutable_locations(references):
    # AST IDs change when unrelated test contracts are added to a compilation.
    # The complete sorted bytecode offsets and lengths must still match exactly.
    return sorted((item['start'], item['length']) for rows in references.values() for item in rows)


def compare_contracts(fleet, manager):
    bundled = fleet / 'packages/AGI_Agent/contract'
    provenance = json.loads((bundled / 'artifact-provenance.json').read_text())
    build_id = provenance['artifacts']['AGIJobManager']['buildInfoId']
    original = json.loads((bundled / 'compiler-inputs' / (build_id + '.json')).read_text())
    # Compare every production source, including utilities not individually deployed.
    paths = sorted(name for name in original['sources'] if name.startswith('project/contracts/'))
    require(len(paths) == 11, 'Production Solidity source coverage differs')
    sources = []
    for name in paths:
        relative = name.removeprefix('project/')
        current = (manager / relative).read_bytes()
        expected = original['sources'][name]['content'].encode()
        require(current == expected, 'Manager production source changed: ' + relative)
        sources.append({'path': relative, 'sha256': hashlib.sha256(current).hexdigest()})
    artifact_results = []
    for name in ARTIFACTS:
        old = json.loads((bundled / 'artifacts' / (name + '.json')).read_text())
        new = json.loads((manager / 'build/contracts' / (name + '.json')).read_text())
        for field in ['abi', 'bytecode', 'deployedBytecode', 'linkReferences', 'deployedLinkReferences']:
            require(old[field] == new[field], f'Compiled {name}.{field} differs')
        require(immutable_locations(old['immutableReferences']) == immutable_locations(new['immutableReferences']),
                'Compiled immutable locations differ: ' + name)
        artifact_results.append({
            'name': name, 'abiSHA256': hashlib.sha256(canonical(new['abi'])).hexdigest(),
            'bytecodeSHA256': hashlib.sha256(new['bytecode'].encode()).hexdigest(),
            'deployedBytecodeSHA256': hashlib.sha256(new['deployedBytecode'].encode()).hexdigest(),
            'immutableOffsetsMatch': True,
        })
    return {'status': 'PASS', 'bundledSourceCommit': provenance['sourceCommit'],
            'productionSources': sources, 'artifacts': artifact_results,
            'comparison': 'exact source bytes, ABI, creation/runtime bytecode, links and immutable byte offsets'}


def install_node(work):
    require(platform.system() == 'Linux', 'Run on Linux')
    architecture = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine())
    require(architecture in NODE_SHA, 'Unsupported architecture')
    name = f'node-v{NODE_VERSION}-linux-{architecture}'
    archive = work / (name + '.tar.xz')
    request = urllib.request.Request(f'https://nodejs.org/dist/v{NODE_VERSION}/{archive.name}',
                                     headers={'User-Agent': 'AGI-Fleet-job-integration'})
    with urllib.request.urlopen(request, timeout=120) as source, archive.open('xb') as output:
        total = 0
        while data := source.read(1024 * 1024):
            total += len(data)
            require(total < 100000000, 'Node download exceeded the bound')
            output.write(data)
    require(sha(archive) == NODE_SHA[architecture], 'Pinned Node archive hash differs')
    with tarfile.open(archive) as source:
        source.extractall(work, filter='data')
    return work / name / 'bin', architecture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True, help='Absent engineering workspace under an existing parent')
    parser.add_argument('--evidence', type=Path, required=True, help='Absent output directory outside --work')
    parser.add_argument('--archive', type=Path, help='Already downloaded exact Fleet ZIP')
    parser.add_argument('--manager-ref', default=MANAGER_BASELINE, help='Exact manager commit or main for an upstream compatibility probe')
    args = parser.parse_args()
    require(re.fullmatch(r'[0-9a-f]{40}|main', args.manager_ref), 'Manager ref must be a full commit SHA or main')
    work, evidence = args.work.absolute(), args.evidence.absolute()
    require(not work.exists() and not work.is_symlink(), 'Engineering workspace must be absent')
    require(not evidence.exists() and not evidence.is_symlink(), 'Evidence output must be absent')
    require(not evidence.is_relative_to(work) and not work.is_relative_to(evidence), 'Separate evidence from working files')
    require(work.parent.resolve(strict=True) == work.parent and evidence.parent.resolve(strict=True) == evidence.parent,
            'Output parents must exist and be canonical')
    work.mkdir(); evidence.mkdir()
    report = {
        'schema': 'agi-fleet-manager-integration/v1', 'status': 'RUNNING',
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'workflowRun': os.environ.get('GITHUB_RUN_ID'), 'workflowCommit': os.environ.get('GITHUB_SHA'),
        'fleet': {'version': '1.0.9', 'sha256': SHA256, 'bytes': SIZE},
        'manager': {'repository': MANAGER_REPOSITORY, 'requestedRef': args.manager_ref},
        'steps': [], 'limitations': {
            'localChainId': 31337, 'realUSDC': False, 'liveInference': False,
            'publicIPFS': False, 'independentOperators': False, 'independentRPCBackends': False,
            'physicalInstallation': False, 'realTimeEndurance': False,
        },
    }
    env = dict(os.environ)
    # The isolated network never consumes operator connection or signer settings.
    for name in list(env):
        if re.search(r'(PRIVATE_KEY|MNEMONIC|RPC_URL|API_KEY|ACCESS_TOKEN|AUTH_TOKEN)', name):
            env.pop(name)
    env.update({'CI': 'true', 'NO_COLOR': '1', 'HARDHAT_DISABLE_TELEMETRY_PROMPT': 'true'})

    def run(label, command, cwd, timeout=600):
        log = evidence / (label + '.log')
        started = time.monotonic()
        print('RUN ' + label, flush=True)
        with log.open('xb') as output:
            result = subprocess.run([str(value) for value in command], cwd=cwd, env=env,
                                    stdout=output, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        step = {'name': label, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - started, 3),
                'log': log.name, 'logSHA256': sha(log)}
        report['steps'].append(step)
        require(result.returncode == 0, f'{label} failed; inspect {log.name}')
        return log

    try:
        archive = args.archive or work / ASSET
        if args.archive is None:
            download(URL, archive, SHA256, SIZE)
        report['archiveVerification'] = verify_archive(archive)
        extract(archive, work / 'release')
        fleet = work / 'release' / PREFIX
        node_bin, architecture = install_node(work)
        env['PATH'] = str(node_bin) + os.pathsep + env['PATH']
        node, npm = node_bin / 'node', node_bin / 'npm'
        report['runtime'] = {'node': NODE_VERSION, 'architecture': architecture,
                             'nodeArchiveSHA256': NODE_SHA[architecture]}
        manager = work / 'manager'; manager.mkdir()
        run('manager-init', ['git', 'init', '.'], manager)
        run('manager-remote', ['git', 'remote', 'add', 'origin', f'https://github.com/{MANAGER_REPOSITORY}.git'], manager)
        run('manager-fetch', ['git', 'fetch', '--depth=1', 'origin', args.manager_ref], manager)
        run('manager-checkout', ['git', 'checkout', '--detach', 'FETCH_HEAD'], manager)
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=manager, text=True).strip()
        require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Invalid manager commit')
        if args.manager_ref != 'main':
            require(commit == args.manager_ref, 'Manager checkout differs from the pinned commit')
        report['manager'].update({'commit': commit, 'version': json.loads((manager / 'package.json').read_text())['version'],
                                  'lockfileSHA256': sha(manager / 'package-lock.json'),
                                  'hardhatLockfileSHA256': sha(manager / 'hardhat/package-lock.json')})
        run('manager-dependencies', [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], manager)
        run('hardhat-dependencies', [npm, '--prefix', 'hardhat', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], manager)
        run('compiler-compatibility', [node, 'scripts/security/patch-openzeppelin-compiler.cjs'], manager)
        run('manager-build', [npm, 'run', 'build'], manager)
        report['contractCompatibility'] = compare_contracts(fleet, manager)
        # Dev dependencies are engineering-only and cannot alter the saved Fleet files.
        (work / 'node_modules').symlink_to(manager / 'node_modules', target_is_directory=True)
        env['AGI_NODE_ROOT'] = str(fleet / 'packages/AGI_Node')
        agent = fleet / 'packages/AGI_Agent'
        for package, scripts in SCRIPTS.items():
            discovered = sorted(path.name for path in (fleet / 'packages' / package / 'tests').glob('integration*.mjs'))
            require(discovered == sorted(scripts), 'Standalone integration coverage changed: ' + package)
        run('fleet-artifact-reproduction', [node, 'scripts/verify-contract-artifacts.mjs'], agent)
        for package, scripts in SCRIPTS.items():
            for script in scripts:
                run(package + '-' + script.removesuffix('.mjs'), [node, 'tests/' + script], fleet / 'packages' / package)
        lifecycle = evidence / 'current-manager-lifecycle.json'
        run('current-manager-lifecycle', [node, ROOT / 'engineering/job-lifecycle.mjs', fleet, manager, lifecycle], agent)
        report['currentManagerLifecycle'] = json.loads(lifecycle.read_text())
        require(report['currentManagerLifecycle']['status'] == 'PASS', 'Lifecycle did not pass')
        log = run('manager-regression', [node, 'scripts/test-contract-shard.js', '0', '1'], manager)
        counts = [json.loads(line) for line in log.read_text().splitlines() if line.startswith('{"collectedTests":')]
        require(len(counts) == 1, 'Manager test collection evidence is missing or ambiguous')
        counts = counts[0]
        require(counts['collectedTests'] > 0 and counts['collectedTests'] == counts['executedTests'] == counts['passedTests'],
                'Manager tests are missing, skipped or failed')
        report['managerRegression'] = counts
        require(not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=manager),
                'Manager tracked source changed during validation')
        # Check every inventoried source after execution, including executable modes.
        inventory = json.loads((fleet / 'source-inventory.json').read_text())
        for row in inventory['files']:
            file = fleet / row['path']
            require(not file.is_symlink() and sha(file) == row['sha256']
                    and bool(file.stat().st_mode & 0o111) == row['executable'],
                    'Frozen source changed during execution: ' + row['path'])
        report['standaloneIntegrationScripts'] = sum(len(scripts) for scripts in SCRIPTS.values())
        report['status'] = 'PASS'
    except BaseException as error:
        report['status'] = 'FAIL'
        report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (evidence / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'evidence': str(evidence)}, indent=2), flush=True)


if __name__ == '__main__':
    main()
