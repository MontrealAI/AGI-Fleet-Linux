#!/usr/bin/env python3
"""Verify the independently inventoried workstation preview and frozen baseline."""
import argparse
import hashlib
import json
from pathlib import Path

from release_tools import ROOT, SOURCE_REVISION, require, verify_source

PREVIEW = ROOT / 'workstation'
INVENTORY = PREVIEW / 'source-inventory.json'


def inventory():
    records = []
    for source in sorted(PREVIEW.rglob('*')):
        relative = source.relative_to(PREVIEW)
        if any(part in {'node_modules', '__pycache__'} for part in relative.parts) or source == INVENTORY:
            continue
        require(not source.is_symlink(), f'Unexpected preview symlink: {relative}')
        if source.is_file():
            records.append({'path': relative.as_posix(), 'bytes': source.stat().st_size,
                            'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    require(records, 'Empty preview')
    encoded = json.dumps(records, sort_keys=True, separators=(',', ':')).encode()
    return {'schema': 'agi-workstation-source-inventory/v1',
            'sourceSha256': hashlib.sha256(encoded).hexdigest(), 'files': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-inventory', action='store_true', help='Explicitly record reviewed preview bytes')
    args = parser.parse_args()
    verify_source(ROOT / 'fleet')
    candidate = json.loads((PREVIEW / 'candidate.json').read_text())
    package = json.loads((PREVIEW / 'package.json').read_text())
    require(candidate['version'] == package['version'] == '0.1.0-preview.1', 'Preview version differs')
    require(candidate['classification'] == 'DEVELOPMENT_PREVIEW' and candidate['productionQualified'] is False,
            'Preview must not inherit release qualification')
    require(candidate['executionMode'] == 'PILOT_ONLY' and candidate['productionExecution'] == 'DISABLED',
            'Production promotion is unavailable in this preview')
    require(candidate['basis']['frozenSourceSha256'] == SOURCE_REVISION, 'Frozen basis differs')
    require(all(s == 'NOT_RUN' for s in candidate['physicalQualification'].values()),
            'Physical results require separately reviewed retained evidence')
    actual = inventory()
    if args.write_inventory:
        INVENTORY.write_text(json.dumps(actual, indent=2) + '\n')
    require(INVENTORY.is_file() and json.loads(INVENTORY.read_text()) == actual, 'Preview inventory differs')
    print(json.dumps({'status': 'PASS', 'classification': candidate['classification'],
                      'files': len(actual['files']), 'sourceSha256': actual['sourceSha256'],
                      'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
