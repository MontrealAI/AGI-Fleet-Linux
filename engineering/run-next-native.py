#!/usr/bin/env python3
"""Run fresh candidate tests on a disposable GitHub-hosted Linux VM only."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import sys

from next_release_tools import adapt_baseline, load_candidate, provenance, verify_candidate, write_json
from release_tools import require, sha


def require_disposable_runner():
    require(platform.system() == 'Linux' and os.geteuid() == 0
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('GITHUB_REPOSITORY') == 'MontrealAI/AGI-Fleet-Linux',
            'Native provisioning requires the disposable GitHub-hosted Linux CI VM; never run on an operator machine')


def bind_runner(candidate, archive):
    old = 'AGI_Fleet_Linux_v1.0.9'
    runner = adapt_baseline('run-linux-1.0.9-native.py', {
        (str, old): candidate['prefix'], (str, old + '.zip'): candidate['name'],
        (str, old + '/'): candidate['prefix'] + '/', (int, 3897): candidate['native']['complete']['tests'], (int, 342): candidate['native']['complete']['files'],
    })
    require(candidate['native']['targeted'] == {'tests': 291, 'files': 25}
            and candidate['native']['complete'] == {'tests': 3932, 'files': 344}, 'Native harness selection needs explicit review')
    runner.ASSETS = {candidate['name']: (candidate['bytes'], candidate['sha256']),
                     **{name: value for name, value in runner.ASSETS.items() if name != candidate['name']}}
    original_download = runner.download
    def download(url, target, expected, size=None):
        if target.name != candidate['name']:
            return original_download(url, target, expected, size)
        with Path(archive).open('rb') as source, target.open('xb') as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
        require(target.stat().st_size == size and sha(target) == expected, 'Saved candidate changed before execution')
        return {'source': 'saved-candidate-archive', 'bytes': size, 'sha256': expected}
    runner.download = download
    return runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    require_disposable_runner()
    candidate = load_candidate(args.metadata, args.archive)
    verify_candidate(args.archive, candidate)
    runner = bind_runner(candidate, args.archive.resolve())
    previous = sys.argv
    sys.argv = [runner.__file__, '--work', str(args.work), '--evidence', str(args.evidence)]
    try:
        return runner.main()
    finally:
        sys.argv = previous
        if args.evidence.is_dir():
            write_json(args.evidence / 'candidate-binding.json', provenance(candidate))


if __name__ == '__main__':
    raise SystemExit(main())
