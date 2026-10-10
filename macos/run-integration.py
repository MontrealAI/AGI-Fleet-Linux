#!/usr/bin/env python3
"""Exercise the exact Mac Fleet against the pinned manager on native Apple silicon."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engineering'))
from next_release_tools import adapt_baseline
from release_tools import extract, require, sha
from build import module, verify, write_json

NODE_SHA = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe'


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
            value.update(platform='darwin', runnerLabel='macos-26', repository=os.environ['GITHUB_REPOSITORY'])
            write_json(summary, value)
            write_json(args.evidence / 'candidate-binding.json', {
                'schema': 'agi-macos-validation-binding/v1',
                'candidate': {key: candidate[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')},
                'workflowCommit': os.environ['GITHUB_SHA'], 'repository': os.environ['GITHUB_REPOSITORY'],
                'workflowRun': os.environ['GITHUB_RUN_ID'], 'productionQualified': False})


if __name__ == '__main__':
    main()
