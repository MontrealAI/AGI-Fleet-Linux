#!/usr/bin/env python3
"""Exercise the exact Mac Fleet against the pinned manager on native Apple silicon."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engineering'))
from next_release_tools import adapt_baseline
from release_tools import extract, require, sha
from build import module, verify, write_json

NODE_SHA = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe'


def case_sensitive_workspace(parent):
    """The pinned Manager has distinct tracked paths that differ only by case."""
    with tempfile.TemporaryDirectory(prefix='agi-case-probe-', dir=parent) as temporary:
        lower, upper = Path(temporary) / 'case-probe', Path(temporary) / 'CASE-PROBE'
        lower.write_bytes(b'lower')
        with upper.open('xb') as output:
            output.write(b'upper')
        require(lower.read_bytes() == b'lower' and upper.read_bytes() == b'upper'
                and lower.stat().st_ino != upper.stat().st_ino, 'Case-sensitive integration workspace required')
    return {'schema': 'agi-macos-integration-filesystem/v1', 'caseSensitive': True,
            'distinctCaseNames': True, 'scope': 'disposable engineering workspace only'}


def retain_manager_diagnostics(manager, evidence):
    if not (manager / '.git').is_dir():
        return
    with (evidence / 'manager-source-change.log').open('w') as output:
        for arguments in (['status', '--porcelain=v1', '--untracked-files=no'],
                          ['diff', '--no-ext-diff', '--no-textconv', '--stat', '--summary']):
            print('git ' + ' '.join(arguments), file=output, flush=True)
            try:
                subprocess.run(['git', *arguments], cwd=manager, stdout=output,
                               stderr=subprocess.STDOUT, check=False, timeout=30)
            except (OSError, subprocess.TimeoutExpired) as error:
                print(type(error).__name__ + ': diagnostic command unavailable', file=output)


def guard(environment, system, machine):
    require(system == 'Darwin' and machine == 'arm64', 'Native Apple silicon is required')
    require(environment.get('GITHUB_ACTIONS') == 'true'
            and environment.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and environment.get('GITHUB_REPOSITORY') == 'MontrealAI/AGI-Fleet-Linux'
            and environment.get('RUNNER_OS') == 'macOS'
            and environment.get('RUNNER_ARCH') == 'ARM64'
            and environment.get('AGI_MACOS_RUNNER_LABEL') == 'macos-26',
            'Use only the disposable macos-26 hosted runner')
    require(re.fullmatch(r'[0-9a-f]{40}', environment.get('GITHUB_SHA', ''))
            and re.fullmatch(r'[0-9]+', environment.get('GITHUB_RUN_ID', '')), 'Missing workflow identity')


def install_node(work):
    native = module('macos_integration_native', ROOT / 'macos/run-native.py')
    name = 'node-v24.21.0-darwin-arm64'
    archive = work / (name + '.tar.xz')
    native.download('https://nodejs.org/dist/v24.21.0/' + archive.name, archive, NODE_SHA)
    with tarfile.open(archive) as source:
        source.extractall(work, filter='data')
    return work / name / 'bin', 'arm64'


def bind_runner(candidate):
    runner = adapt_baseline('run-job-integration.py', {(str, '1.0.9'): candidate['version']})
    runner.ASSET, runner.PREFIX = candidate['name'], candidate['prefix']
    runner.SHA256, runner.SIZE = candidate['sha256'], candidate['bytes']
    runner.NODE_SHA = {'arm64': NODE_SHA}
    runner.install_node = install_node
    runner.extract = extract
    # Detect an incomplete checkout before dependency installation and tests.
    # Keep the historical final tracked-source guard unchanged as well.
    original_check_output = subprocess.check_output
    def checked_output(command, **kwargs):
        result = original_check_output(command, **kwargs)
        if command == ['git', 'rev-parse', 'HEAD']:
            require(not original_check_output(['git', 'status', '--porcelain', '--untracked-files=no'],
                                             cwd=kwargs['cwd']), 'Manager checkout is not exact before validation')
        return result
    runner.subprocess = SimpleNamespace(**{**vars(subprocess), 'check_output': checked_output})

    def verify_saved(archive):
        receipt = verify(archive, candidate)
        return {**receipt, 'status': 'PASS', 'editions': len(receipt['editions']),
                'sourceFiles': candidate['sourceFiles'],
                'manifestEntriesVerified': sum(row['manifestFiles'] for row in receipt['editions'].values())}
    runner.verify_archive = verify_saved
    return runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('metadata', 'archive', 'work', 'evidence'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    guard(os.environ, platform.system(), platform.machine())
    candidate = json.loads(args.metadata.read_text())
    require(candidate['workflowCommit'] == os.environ['GITHUB_SHA'], 'Candidate commit differs')
    filesystem = case_sensitive_workspace(args.work.absolute().parent)
    runner = bind_runner(candidate)
    previous = sys.argv
    sys.argv = [runner.__file__, '--archive', str(args.archive.resolve()), '--work', str(args.work),
                '--evidence', str(args.evidence), '--manager-ref', runner.MANAGER_BASELINE]
    try:
        runner.main()
    finally:
        sys.argv = previous
        summary = args.evidence / 'summary.json'
        if summary.is_file():
            value = json.loads(summary.read_text())
            write_json(args.evidence / 'filesystem.json', filesystem)
            value.update(platform='darwin', runnerLabel='macos-26', repository=os.environ['GITHUB_REPOSITORY'])
            write_json(summary, value)
            write_json(args.evidence / 'candidate-binding.json', {
                'schema': 'agi-macos-validation-binding/v1',
                'candidate': {key: candidate[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')},
                'workflowCommit': os.environ['GITHUB_SHA'], 'repository': os.environ['GITHUB_REPOSITORY'],
                'workflowRun': os.environ['GITHUB_RUN_ID'], 'productionQualified': False})
            if value.get('status') != 'PASS':
                try:
                    retain_manager_diagnostics(args.work / 'manager', args.evidence)
                except OSError:
                    print('Manager diagnostics unavailable; original failure and provenance retained', file=sys.stderr)


if __name__ == '__main__':
    main()
