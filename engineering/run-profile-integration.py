#!/usr/bin/env python3
"""Validate an explicit contract profile from reviewed source on local mock USDC.

No downloads, installs, public RPC, deployment, publication or operator state.
This is source validation, never saved-installer or physical qualification.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from contract_profiles import CONTRACT_PROFILES, baseline, compare_contracts
from release_tools import ROOT, require, sha


def source_identity(fleet):
    inventory = json.loads((fleet / 'source-inventory.json').read_text())
    rows = inventory['files']
    revision = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    require(revision == inventory['revisionSHA256'], 'Source inventory digest differs')
    observed = {p.relative_to(fleet).as_posix() for p in fleet.rglob('*')
                if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'}
    require(observed == {row['path'] for row in rows} | {'source-inventory.json'}, 'Source inventory coverage differs')
    for row in rows:
        p = fleet / row['path']
        require(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(fleet)
                and sha(p) == row['sha256'] and bool(p.stat().st_mode & 0o111) == row['executable'],
                'Source changed: ' + row['path'])
    return {'files': len(rows), 'revisionSHA256': revision}


def main(*, identity_checker=None, validation_context=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fleet', type=Path, required=True, help='Reviewed source mirror, not an operator profile')
    parser.add_argument('--manager', type=Path, required=True, help='Clean exact upstream checkout with locked build/dependencies already present')
    parser.add_argument('--contract-profile', choices=CONTRACT_PROFILES, required=True)
    parser.add_argument('--node', type=Path, required=True, help='Pinned Node 24.21.0 executable')
    parser.add_argument('--evidence', type=Path, required=True, help='Absent evidence directory outside both source trees')
    args = parser.parse_args()
    fleet, manager, node = args.fleet.resolve(strict=True), args.manager.resolve(strict=True), args.node.resolve(strict=True)
    evidence = args.evidence.absolute()
    require(not evidence.exists() and evidence.parent.resolve(strict=True) == evidence.parent
            and not evidence.is_relative_to(fleet) and not evidence.is_relative_to(manager), 'Evidence directory must be absent, canonical and separate')
    require(subprocess.check_output([node, '--version'], text=True).strip() == 'v24.21.0', 'Pinned Node 24.21.0 required')
    definition = CONTRACT_PROFILES[args.contract_profile]
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=manager, text=True).strip()
    require(commit == definition['commit'], 'Manager checkout differs from explicit profile commit')
    require(not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=manager), 'Manager tracked source is not clean')
    # The saved-archive adapter supplies its stricter complete-archive checker.
    # This is an internal API, never a CLI path/hash/verification override.
    identity_checker = identity_checker or source_identity
    before = identity_checker(fleet)
    evidence.mkdir()
    report = {'schema': 'agi-fleet-contract-profile-source-validation/v1', 'status': 'RUNNING',
              'classification': 'SOURCE_ONLY_NOT_RELEASE_QUALIFICATION', 'productionQualified': False,
              'startedAt': datetime.now(timezone.utc).isoformat(), 'source': before,
              'profile': args.contract_profile, 'profileManifestSHA256': definition['manifestSHA256'],
              'managerCommit': commit, 'managerLockfileSHA256': sha(manager / 'package-lock.json'),
              'managerHardhatLockfileSHA256': sha(manager / 'hardhat/package-lock.json'),
              'node': '24.21.0', 'nodeBinarySHA256': sha(node), 'steps': [],
              'limitations': {'chainId': 31337, 'mockUSDCOnly': True, 'deterministicFixtureWallets': True,
                             'liveInference': False, 'publicIPFS': False, 'publicChainDeployment': False,
                             'independentOperators': False, 'physicalInstallation': False, 'savedArchiveQualification': False}}
    if validation_context is not None:
        report['classification'] = 'SAVED_ARCHIVE_LOCAL_MOCK_VALIDATION_NOT_RELEASE_QUALIFICATION'
        report['savedArchiveBinding'] = validation_context
        report['limitations']['savedArchiveBytesExercised'] = True
    env = {key: value for key, value in os.environ.items()
           if not re.search(r'(PRIVATE_KEY|MNEMONIC|RPC_URL|API_KEY|ACCESS_TOKEN|AUTH_TOKEN)', key)}
    env.update(CI='true', NO_COLOR='1', HARDHAT_DISABLE_TELEMETRY_PROMPT='true',
               AGI_NODE_ROOT=str(fleet / 'packages/AGI_Node'), PATH=str(node.parent) + os.pathsep + env.get('PATH', ''))

    def run(label, command, cwd, timeout=600):
        log = evidence / (label + '.log')
        started = time.monotonic()
        print('RUN ' + label, flush=True)
        with log.open('xb') as output:
            result = subprocess.run([str(arg) for arg in command], cwd=cwd, env=env,
                                    stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
        report['steps'].append({'name': label, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - started, 3),
                                'log': log.name, 'logSHA256': sha(log)})
        require(result.returncode == 0, label + ' failed; inspect ' + log.name)
        return log

    try:
        report['contractCompatibility'] = compare_contracts(fleet, manager, args.contract_profile)
        agent = fleet / 'packages/AGI_Agent'
        run('legacy-artifact-reproduction', [node, 'scripts/verify-contract-artifacts.mjs'], agent)
        run('profile-artifact-reproduction', [node, 'scripts/verify-contract-artifacts.mjs', '--contract-profile', args.contract_profile], agent)
        for package, scripts in baseline.SCRIPTS.items():
            require(sorted(p.name for p in (fleet / 'packages' / package / 'tests').glob('integration*.mjs')) == sorted(scripts),
                    'Standalone integration coverage changed: ' + package)
            for script in scripts:
                run(package + '-' + script.removesuffix('.mjs'), [node, 'tests/' + script], fleet / 'packages' / package)
        lifecycle = evidence / 'profile-lifecycle.json'
        run('profile-lifecycle', [node, ROOT / 'engineering/job-lifecycle.mjs', fleet, manager, lifecycle,
                                  '--contract-profile', args.contract_profile], agent)
        report['lifecycle'] = json.loads(lifecycle.read_text())
        require(report['lifecycle']['status'] == 'PASS' and report['lifecycle']['contractProfile'] == args.contract_profile
                and report['lifecycle']['contractProfileSHA256'] == definition['manifestSHA256'], 'Lifecycle profile binding differs')
        log = run('manager-regression', [node, 'scripts/test-contract-shard.js', '0', '1'], manager)
        counts = [json.loads(line) for line in log.read_text().splitlines() if line.startswith('{"collectedTests":')]
        require(len(counts) == 1, 'Missing or ambiguous Manager test counts')
        counts = counts[0]
        require(counts['collectedTests'] > 0 and counts['collectedTests'] == counts['executedTests'] == counts['passedTests'], 'Manager tests missing, skipped or failed')
        if 'managerTests' in definition:
            require(counts['passedTests'] == definition['managerTests'], 'Explicit profile manager regression count differs')
        report['managerRegression'] = counts
        require(identity_checker(fleet) == before, 'Fleet source changed during validation')
        require(not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=manager), 'Manager tracked source changed during validation')
        report['status'] = 'PASS'
    except BaseException as error:
        report['status'] = 'FAIL'
        report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (evidence / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'evidence': str(evidence)}), flush=True)


if __name__ == '__main__':
    main()
