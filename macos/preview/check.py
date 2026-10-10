#!/usr/bin/env python3
"""Bind the separate Mac preview, its reused source and the frozen Fleet basis."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inventory():
    sources = []
    for base in [HERE, ROOT / 'workstation/studio-overlay', ROOT / 'macos/runtime']:
        for file in sorted(base.rglob('*')):
            if any(part in {'__pycache__', 'node_modules'} for part in file.parts) or file == HERE / 'source-inventory.json':
                continue
            if file.is_symlink():
                raise ValueError('Unexpected source symlink: ' + str(file))
            if file.is_file():
                sources.append(file)
    for name in ('workstation/engine/job-draft.mjs', 'workstation/tests/studio.test.mjs',
                 'macos/release.json', 'workstation/candidate.json', '.github/workflows/macos-preview.yml',
                 'engineering/check-workstation-preview.py', 'engineering/release_tools.py',
                 'engineering/next-release.json', 'engineering/build-next-release.py'):
        file = ROOT / name
        if file.is_symlink() or not file.is_file():
            raise ValueError('Reviewed preview input must be a regular file: ' + name)
        sources.append(file)
    records = [{'path': file.relative_to(ROOT).as_posix(), 'bytes': file.stat().st_size,
                'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in sorted(sources)]
    encoded = json.dumps(records, sort_keys=True, separators=(',', ':')).encode()
    return {'schema': 'agi-macos-preview-source-inventory/v1', 'sourceSha256': hashlib.sha256(encoded).hexdigest(), 'files': records}


def check(write_inventory=False):
    sys.path.insert(0, str(ROOT / 'engineering'))
    source = load('mac_preview_basis', ROOT / 'engineering/check-workstation-preview.py').verify_fleet_source()
    candidate = json.loads((HERE / 'candidate.json').read_text())
    reused_basis = json.loads((ROOT / 'workstation/candidate.json').read_text())['basis']
    if candidate['reusedPreviewHistoricalBasis'] != reused_basis:
        raise ValueError('Shared preview historical basis differs')
    if not (candidate['classification'] == 'DEVELOPMENT_PREVIEW' and candidate['executionMode'] == 'PILOT_ONLY'
            and candidate['productionExecution'] == 'DISABLED' and candidate['productionQualified'] is False
            and candidate['qualificationInherited'] is False and candidate['includedInMacReleaseZip'] is False
            and not any(name.startswith('includedInMac') and name != 'includedInMacReleaseZip' for name in candidate)
            and all(value == 'NOT_RUN' for value in candidate['physicalQualification'].values())):
        raise ValueError('Preview qualification boundary changed')
    actual = inventory()
    file = HERE / 'source-inventory.json'
    if write_inventory:
        file.write_text(json.dumps(actual, indent=2) + '\n')
    if not file.is_file() or json.loads(file.read_text()) != actual:
        raise ValueError('Mac preview source inventory differs; review the changes')
    return {'status': 'PASS', 'sourceSha256': actual['sourceSha256'], 'sourceFiles': len(actual['files']), 'fleetSource': source,
            'productionExecution': 'DISABLED', 'productionQualified': False, 'qualificationInherited': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-inventory', action='store_true')
    print(json.dumps(check(parser.parse_args().write_inventory), indent=2))
