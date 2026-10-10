#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import re

from release_tools import ROOT, SHA256, SIZE, require, sha, verify_source


def main():
    parser = argparse.ArgumentParser(description='Check the current Linux handoff and, when present, its frozen source mirror.')
    parser.add_argument('--require-source', action='store_true')
    args = parser.parse_args()
    current = json.loads((ROOT / 'engineering/current-release.json').read_text())
    require(current['sha256'] == SHA256 and current['bytes'] == SIZE, 'Current release identity differs')
    require(current['nativeAcceptance'] == 'PASS' and current['productionQualified'] is False, 'Invalid release classification')
    require(current['operatorGate'] == 'OPEN_FOR_CONTROLLED_FRESH_INSTALL', 'Invalid operator gate')
    audit_path = ROOT / current['nativeAudit']['path']
    require(sha(audit_path) == current['nativeAudit']['sha256'], 'Evidence audit digest differs')
    audit = json.loads(audit_path.read_text())
    require(audit['releaseSHA256'] == SHA256 and audit['status'] == 'PASS' and audit['verifiedTapLogs'] == 734,
            'Invalid native audit')
    require({r['architecture'] for r in audit['runs']} == {'x64', 'arm64'} and len(audit['runs']) == 2, 'Both native architectures are required')
    for run in audit['runs']:
        require(run['previousFailureCasesResolved'] == 44 and run['previousSkipCasesResolved'] == 6, 'Original case reconciliation differs')
        for scope, count, files in [('targeted', 291, 25), ('complete', 3897, 342)]:
            result = run['runs'][scope]
            require(result['status'] == 'PASS' and result['counts']['tests'] == result['counts']['pass'] == count
                    and result['verifiedLogs'] == files, 'Incomplete native acceptance')
            require(all(result['counts'][k] == 0 for k in ('fail', 'cancelled', 'skipped', 'todo')), 'Native evidence contains unsuccessful cases')
    require(all(v == 'NOT_RUN' for v in current['physicalQualification'].values()), 'Physical results require a separate reviewed ledger')
    for path in [ROOT / 'README.md', *(ROOT / 'docs').glob('*.md'), ROOT / 'engineering/README.md']:
        for target in re.findall(r'\]\(([^\s)]+)\)', path.read_text()):
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            require((path.parent / target.split('#')[0]).exists(), 'Broken documentation link: ' + target)
    mirror = ROOT / 'fleet'
    source = verify_source(mirror) if mirror.exists() else None
    require(not args.require_source or source is not None, 'Frozen source mirror is missing')
    print(json.dumps({'status': 'PASS', 'nativeAcceptance': 'PASS', 'operatorGate': current['operatorGate'],
                      'sourceMirror': source, 'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
