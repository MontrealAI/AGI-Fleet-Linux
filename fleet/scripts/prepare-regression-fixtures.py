#!/usr/bin/env python3
"""Prepare isolated test dependencies from exact historical archives and npm lock.

The archive directory contains commissioning/ and authority/ subdirectories.
This never installs services or modifies an operator profile. Use a disposable
engineering account, with Python 3.10+, npm, and trusted Node 24.21.0 available.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archives', type=Path, required=True)
    p.add_argument('--destination', type=Path, required=True, help='New disposable directory')
    p.add_argument('--node', type=Path, required=True)
    p.add_argument('--npm', type=Path, required=True)
    a = p.parse_args()
    a.node, a.npm, a.archives, a.destination = (x.resolve() for x in (a.node, a.npm, a.archives, a.destination))
    lock = json.loads((ROOT / 'test-support/regression-fixtures.json').read_text())
    if subprocess.check_output([str(a.node), '--version'], text=True, timeout=10).strip() != 'v' + lock['node']:
        raise ValueError('Node version must be ' + lock['node'])
    if a.destination.exists() or a.destination.is_relative_to(ROOT):
        raise ValueError('Destination must be a new directory outside the release')
    archives = []
    for row in lock['historical']:
        archive = a.archives / row['label'] / row['archiveName']
        if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != row['archiveBytes'] or sha(archive) != row['archiveSHA256']:
            raise ValueError('Historical archive identity mismatch: ' + str(archive))
        archives.append((row, archive))
    a.destination.mkdir(mode=0o700, parents=True)
    verify = runpy.run_path(str(ROOT / 'scripts/prepare-release.py'))['verify_archive']
    receipts = []
    for row, archive in archives:
        parent = a.destination / 'historical' / row['label'] / row['role']
        receipt = verify(archive, parent)
        expected = a.destination / 'historical' / row['relativeRoot']
        if Path(receipt['freshExtraction']) != expected or sha(expected / 'MANIFEST.sha256') != row['manifestSHA256']:
            raise ValueError('Extracted fixture identity mismatch')
        receipts.append(receipt)
    runtime = a.destination / 'runtime'
    runtime.mkdir(mode=0o700)
    for source, target in [('runtime-package.json', 'package.json'), ('runtime-package-lock.json', 'package-lock.json')]:
        shutil.copyfile(ROOT / 'test-support' / source, runtime / target)
    env = {**os.environ, 'PATH': str(a.node.parent) + os.pathsep + os.environ.get('PATH', '')}
    with (a.destination / 'npm-ci.log').open('w') as log:
        subprocess.run([str(a.npm), 'ci', '--prefix', str(runtime), '--ignore-scripts', '--omit=dev', '--omit=optional',
                        '--no-audit', '--no-fund', '--cache', str(a.destination / 'npm-cache')],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
    (a.destination / 'fixture-receipts.json').write_text(json.dumps(receipts, indent=2) + '\n')
    command = ['python3', str(ROOT / 'scripts/run-regressions.py'), '--node', str(a.node),
               '--openclaw', str(runtime / 'node_modules/openclaw'), '--historical', str(a.destination / 'historical'),
               '--out', str(a.destination / 'preflight'), '--preflight-only']
    subprocess.run(command, check=True, timeout=300)
    print('Fixtures verified. Run scripts/run-regressions.py with the same --node, --openclaw and --historical paths and a new --out directory.')

if __name__ == '__main__':
    main()
