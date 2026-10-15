#!/usr/bin/env python3
"""Exercise an explicit profile from the complete, exact saved candidate archive.

Requires an already prepared, clean exact Manager checkout and pinned Node.
No downloads, installs, public RPC, deployment, operator state or provisioning.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import stat
import subprocess
import sys
import zipfile

from contract_profiles import CONTRACT_PROFILES, baseline
from next_release_tools import candidate_tools, load_candidate, load_module, provenance, verify_candidate, write_json
from release_tools import ROOT, members, require, sha

EXPECTED_STEPS = ['legacy-artifact-reproduction', 'profile-artifact-reproduction',
                  *[package + '-' + script.removesuffix('.mjs')
                    for package, scripts in baseline.SCRIPTS.items() for script in scripts],
                  'profile-lifecycle', 'manager-regression']


def archive_records(archive, candidate):
    """Bind every member, including dependencies, manifests, docs and evidence."""
    prefix = candidate['prefix'] + '/'
    records = {}
    with zipfile.ZipFile(archive) as saved:
        for entry in members(saved):
            require(entry.filename.startswith(prefix), 'Wrong candidate archive prefix')
            name = entry.filename[len(prefix):]
            require(name and name not in records, 'Duplicate candidate member')
            with saved.open(entry) as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            records[name] = {'sha256': digest, 'bytes': entry.file_size,
                             'executable': bool(entry.external_attr >> 16 & 0o111)}
    require('MANIFEST.sha256' in records and 'source-inventory.json' in records,
            'Complete saved candidate metadata is missing')
    return records


def verify_saved_tree(root, archive, candidate, records):
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size == candidate['bytes']
            and sha(archive) == candidate['sha256'], 'Saved candidate archive identity changed')
    require(root.is_dir() and not root.is_symlink() and root.resolve() == root,
            'Saved candidate root must be canonical')
    expected_directories = {parent.as_posix() for name in records
                            for parent in PurePosixPath(name).parents if parent.as_posix() != '.'}
    actual_files, actual_directories = set(), set()
    for current, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            file = Path(current) / name
            require(stat.S_ISDIR(file.lstat().st_mode), 'Saved candidate directory is not ordinary: ' + str(file))
            actual_directories.add(file.relative_to(root).as_posix())
        for name in files:
            file = Path(current) / name
            relative = file.relative_to(root).as_posix()
            info = file.lstat()
            require(stat.S_ISREG(info.st_mode), 'Saved candidate file is not ordinary: ' + relative)
            actual_files.add(relative)
            require(relative in records, 'Added saved candidate file: ' + relative)
            row = records[relative]
            require(info.st_size == row['bytes'] and bool(info.st_mode & 0o111) == row['executable']
                    and sha(file) == row['sha256'], 'Saved candidate member changed: ' + relative)
    require(actual_files == set(records) and actual_directories == expected_directories,
            'Complete saved candidate coverage differs')
    inventory = json.loads((root / 'source-inventory.json').read_text())
    rows = inventory['files']
    revision = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    require(revision == inventory['revisionSHA256'] == candidate['sourceRevisionSHA256']
            and len(rows) == candidate['sourceFiles'], 'Saved candidate source binding differs')
    require(len({row['path'] for row in rows}) == len(rows), 'Duplicate saved source inventory entry')
    for row in rows:
        require(row['path'] in records and records[row['path']]['sha256'] == row['sha256']
                and records[row['path']]['executable'] == row['executable'], 'Saved source inventory member differs')
    return {'files': len(rows), 'revisionSHA256': revision}


def require_manager(manager, profile):
    require(manager.is_dir() and manager.resolve() == manager, 'Manager checkout must be canonical')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=manager, text=True).strip()
    require(commit == CONTRACT_PROFILES[profile]['commit'], 'Manager checkout differs from explicit profile commit')
    require(not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=manager),
            'Manager tracked source is not clean')
    for name in ('package-lock.json', 'hardhat/package-lock.json', 'build/contracts/AGIJobManager.json'):
        require((manager / name).is_file(), 'Preprepared Manager input missing: ' + name)
    require((manager / 'node_modules').is_dir(), 'Preprepared locked Manager dependencies are missing')
    return {'commit': commit, 'lockfileSHA256': sha(manager / 'package-lock.json'),
            'hardhatLockfileSHA256': sha(manager / 'hardhat/package-lock.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True, help='Absent separate work directory')
    parser.add_argument('--evidence', type=Path, required=True, help='Absent separate retained evidence directory')
    parser.add_argument('--manager', type=Path, required=True, help='Preprepared clean exact profile checkout; locked deps and build required')
    parser.add_argument('--node', type=Path, required=True, help='Verified Node 24.21.0 executable for this architecture')
    parser.add_argument('--contract-profile', choices=CONTRACT_PROFILES, required=True)
    args = parser.parse_args()
    work, evidence, manager = args.work.absolute(), args.evidence.absolute(), args.manager.absolute()
    for directory in (work, evidence):
        require(not directory.exists() and not directory.is_symlink()
                and directory.parent.resolve(strict=True) == directory.parent,
                'Use absent canonical work/evidence directories')
        require(not directory.is_relative_to(ROOT) and not directory.is_relative_to(manager),
                'Work/evidence must be outside reviewed source and Manager trees')
    require(not work.is_relative_to(evidence) and not evidence.is_relative_to(work), 'Separate work from evidence')
    evidence.mkdir()
    report = {'schema': 'agi-fleet-saved-profile-integration/v1', 'status': 'RUNNING',
              'classification': 'SAVED_ARCHIVE_LOCAL_MOCK_VALIDATION_NOT_RELEASE_QUALIFICATION',
              'productionQualified': False, 'profile': args.contract_profile,
              'profileManifestSHA256': CONTRACT_PROFILES[args.contract_profile]['manifestSHA256'],
              'startedAt': datetime.now(timezone.utc).isoformat(),
              'workflowRun': os.environ.get('GITHUB_RUN_ID'), 'workflowCommit': os.environ.get('GITHUB_SHA'),
              'workflowRunAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
              'limitations': {'localChainId': 31337, 'mockUSDCOnly': True, 'physicalInstallation': False,
                              'publicChainDeployment': False, 'independentOperators': False}}
    candidate = fleet = records = None
    previous = sys.argv
    try:
        candidate = load_candidate(args.metadata, args.archive)
        report['candidateBinding'] = provenance(candidate)
        write_json(evidence / 'candidate-binding.json', report['candidateBinding'])
        report['archiveVerification'] = verify_candidate(args.archive, candidate)
        report['manager'] = require_manager(manager, args.contract_profile)
        architecture = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine())
        require(platform.system() == 'Linux' and architecture, 'Saved profile gate requires Linux x64 or arm64')
        node = args.node.resolve(strict=True)
        require(subprocess.check_output([node, '--version'], text=True).strip() == 'v24.21.0', 'Pinned Node 24.21.0 required')
        require(subprocess.check_output([node, '-p', 'process.arch'], text=True).strip() == architecture,
                'Pinned Node architecture differs from native runner')
        report['runtime'] = {'node': '24.21.0', 'architecture': architecture, 'platform': 'linux',
                             'nodeArchiveSHA256': baseline.NODE_SHA[architecture]}
        report['nodeBinarySHA256'] = sha(node)
        work.mkdir()
        candidate_tools(candidate).extract(args.archive, work / 'release')
        fleet = work / 'release' / candidate['prefix']
        records = archive_records(args.archive, candidate)
        write_json(evidence / 'archive-members.json', records)
        report['archiveMembersSHA256'] = sha(evidence / 'archive-members.json')
        report['completeArchiveFiles'] = len(records)
        archive_identity = {'files': len(records), 'membersSHA256': hashlib.sha256(
            json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
        identity = lambda root: verify_saved_tree(root, args.archive, candidate, records)
        report['before'] = identity(fleet)
        report['completeArchiveBefore'] = archive_identity
        # Only missing engineering packages resolve here; saved dependencies stay
        # inside the immutable complete extraction and are checked byte-for-byte.
        (work / 'node_modules').symlink_to(manager / 'node_modules', target_is_directory=True)
        runner = load_module('run-profile-integration.py')
        sys.argv = [runner.__file__, '--fleet', str(fleet), '--manager', str(manager),
                    '--node', str(node), '--contract-profile', args.contract_profile,
                    '--evidence', str(evidence / 'profile-integration')]
        runner.main(identity_checker=identity, validation_context=report['candidateBinding'])
        result_path = evidence / 'profile-integration/summary.json'
        result = json.loads(result_path.read_text())
        require(result['status'] == 'PASS' and result['profile'] == args.contract_profile
                and result['profileManifestSHA256'] == report['profileManifestSHA256']
                and result['managerCommit'] == report['manager']['commit']
                and result['source'] == report['before'], 'Saved profile result binding differs')
        require(result['savedArchiveBinding'] == report['candidateBinding']
                and result['limitations']['savedArchiveBytesExercised'] is True,
                'Saved archive execution binding differs')
        require([step['name'] for step in result['steps']] == EXPECTED_STEPS and len(EXPECTED_STEPS) == 12,
                'Saved profile integration step coverage differs')
        for step in result['steps']:
            require(step['exitCode'] == 0 and step['log'] == step['name'] + '.log'
                    and sha(evidence / 'profile-integration' / step['log']) == step['logSHA256'],
                    'Saved profile integration step log differs: ' + step['name'])
        report['steps'] = [{**step, 'log': 'profile-integration/' + step['log']} for step in result['steps']]
        report['integrationSteps'] = len(result['steps'])
        report['integrationSummarySHA256'] = sha(result_path)
        report['managerRegression'] = result['managerRegression']
        count = CONTRACT_PROFILES[args.contract_profile].get('managerTests')
        require(report['managerRegression']['collectedTests'] == report['managerRegression']['executedTests']
                == report['managerRegression']['passedTests'] > 0
                and (count is None or report['managerRegression']['passedTests'] == count),
                'Saved profile Manager test count differs')
        report['lifecycle'] = result['lifecycle']
        require(report['lifecycle']['status'] == 'PASS' and report['lifecycle']['contractProfile'] == args.contract_profile
                and report['lifecycle']['contractProfileSHA256'] == report['profileManifestSHA256'],
                'Saved profile lifecycle binding differs')
        report['lifecycleReportSHA256'] = sha(evidence / 'profile-integration/profile-lifecycle.json')
        report['status'] = 'PASS'
    except BaseException as error:
        report['status'] = 'FAIL'
        report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        sys.argv = previous
        # Run even if a test fails. Preserve the original failure and record any
        # independent integrity failure; no cleanup destroys the evidence.
        integrity_error = None
        if fleet is not None and records is not None:
            try:
                report['after'] = verify_saved_tree(fleet, args.archive, candidate, records)
                require(report['after'] == report['before'], 'Saved archive source changed during execution')
                report['completeArchiveAfter'] = archive_identity
                report['completeArchiveUnchanged'] = True
            except BaseException as error:
                integrity_error = error
                report['status'] = 'FAIL'
                report['completeArchiveUnchanged'] = False
                report['integrityError'] = type(error).__name__ + ': ' + str(error)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        write_json(evidence / 'summary.json', report)
        print(json.dumps({'status': report['status'], 'evidence': str(evidence)}), flush=True)
        if integrity_error is not None and 'error' not in report:
            raise integrity_error


if __name__ == '__main__':
    main()
