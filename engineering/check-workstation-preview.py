#!/usr/bin/env python3
"""Verify the separate workstation preview and its actual reviewed Fleet source."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

from release_tools import ROOT, SOURCE_REVISION, VERSION, require, verify_source

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


def verify_fleet_source():
    specification = ROOT / 'engineering/next-release.json'
    if not specification.exists() and not specification.is_symlink():
        return {**verify_source(ROOT / 'fleet'), 'version': VERSION,
                'reviewedSourceAnchor': 'engineering/release_tools.py'}
    require(specification.is_file() and not specification.is_symlink(), 'Candidate source anchor must be a regular file')
    release = json.loads(specification.read_text())
    require(release['schema'] == 'agi-linux-next-release/v1' and release['productionQualified'] is False
            and re.fullmatch(r'\d+\.\d+\.\d+', release['version'])
            and re.fullmatch(r'[0-9a-f]{64}', release['sourceRevisionSHA256'])
            and type(release['sourceFiles']) is int and release['sourceFiles'] > 0,
            'Invalid reviewed candidate source identity')
    spec = importlib.util.spec_from_file_location('preview_source_verifier', ROOT / 'engineering/build-next-release.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    inventoried = verifier.inventory(ROOT / 'fleet', release['sourceRevisionSHA256'], release['sourceFiles'])
    result = {'status': 'PASS', 'files': len(inventoried['files']), 'revisionSHA256': inventoried['revisionSHA256']}
    package = json.loads((ROOT / 'fleet/package.json').read_text())
    config = json.loads((ROOT / 'fleet/config/companion-releases.json').read_text())
    require(package['version'] == config['fleet'] == release['version'], 'Reviewed candidate Fleet version differs')
    return {**result, 'version': release['version'], 'reviewedSourceAnchor': 'engineering/next-release.json'}


def check_preview(write_inventory=False):
    fleet_source = verify_fleet_source()
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
    if write_inventory:
        INVENTORY.write_text(json.dumps(actual, indent=2) + '\n')
    require(INVENTORY.is_file() and json.loads(INVENTORY.read_text()) == actual, 'Preview inventory differs')
    return {'status': 'PASS', 'classification': candidate['classification'],
            'files': len(actual['files']), 'sourceSha256': actual['sourceSha256'],
            'historicalBasis': candidate['basis'], 'fleetSource': fleet_source,
            'qualificationInherited': False, 'productionQualified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-inventory', action='store_true', help='Explicitly record reviewed preview bytes')
    args = parser.parse_args()
    print(json.dumps(check_preview(args.write_inventory), indent=2))


if __name__ == '__main__':
    main()
