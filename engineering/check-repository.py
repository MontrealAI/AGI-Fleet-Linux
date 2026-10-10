#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import re

from release_tools import ROOT, SHA256, SIZE, require, sha, verify_source
from mainnet_evidence import check_mainnet


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
    integration = current.get('jobIntegration')
    metadata_path = ROOT / 'validation/Linux-Job-Integration-Evidence-v1.0.9.json'
    require(integration is not None or not metadata_path.exists(), 'Integration evidence has no reviewed release anchor')
    if integration is not None:
        require(integration['status'] == 'PASS' and integration['managerRepository'] == 'MontrealAI/AGIJobManager'
                and integration['managerCommit'] == '191cf3590e5cdc08df1bb0af500ee28a91c8b010'
                and integration['managerVersion'] == '1.13.0', 'Integration manager identity differs')
        integration_audit_path = ROOT / integration['audit']['path']
        require(sha(integration_audit_path) == integration['audit']['sha256'], 'Integration audit digest differs')
        integration_audit = json.loads(integration_audit_path.read_text())
        metadata = json.loads(metadata_path.read_text())
        require(integration_audit['status'] == 'PASS' and integration_audit['releaseSHA256'] == SHA256
                and integration_audit['productionQualified'] is False and integration_audit['verifiedLogs'] == 38,
                'Integration audit classification differs')
        require(metadata['audit'] == integration_audit and metadata['productionQualified'] is False
                and metadata['releaseSHA256'] == SHA256 and metadata['name'] == integration['evidence']['name']
                and metadata['bytes'] == integration['evidence']['bytes']
                and metadata['sha256'] == integration['evidence']['sha256'], 'Integration evidence identity differs')
        for record in [integration_audit, metadata]:
            require(record['managerCommit'] == integration['managerCommit']
                    and record['workflowRun'] == integration['workflowRun']
                    and record['workflowCommit'] == integration['workflowCommit'], 'Integration provenance differs')
        require(len(integration_audit['runs']) == 2
                and {run['architecture'] for run in integration_audit['runs']} == {'x64', 'arm64'},
                'Both integration architectures are required')
        for run in integration_audit['runs']:
            require(run['status'] == 'PASS' and run['verifiedLogs'] == 19 and run['standaloneIntegrationScripts'] == 8
                    and run['productionSourcesMatched'] == run['contractArtifactsMatched'] == 11
                    and run['managerTestsPassed'] == 777 and run['productionQualified'] is False,
                    'Integration acceptance is incomplete')
    mainnet = current.get('mainnetDeploymentObservation')
    require(mainnet is not None or not (ROOT / 'validation/mainnet-cfa78f9980ea9b55c705b3e44467bae383ce1fa7.json').exists(),
            'Mainnet evidence has no reviewed release anchor')
    if mainnet is not None:
        report_path = ROOT / mainnet['path']
        require(sha(report_path) == mainnet['sha256'], 'Mainnet observation digest differs')
        report = json.loads(report_path.read_text())
        replay = check_mainnet(report)
        require(mainnet['chainId'] == report['chainId'] == 1 and mainnet['manager'] == report['manager']
                and mainnet['deploymentBlock'] == report['creation']['block']
                and mainnet['observationBlock'] == replay['observationBlock']
                and mainnet['runtimeCompatibility'] == replay['status']
                and mainnet['intakeOpenAtObservedBlock'] == replay['intakeOpenAtObservedBlock']
                and mainnet['productionQualified'] is False, 'Mainnet observation anchor differs')
    for path in [ROOT / 'README.md', *(ROOT / 'docs').glob('*.md'), ROOT / 'engineering/README.md']:
        for target in re.findall(r'\]\(([^\s)]+)\)', path.read_text()):
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            require((path.parent / target.split('#')[0]).exists(), 'Broken documentation link: ' + target)
    mirror = ROOT / 'fleet'
    source = verify_source(mirror) if mirror.exists() else None
    require(not args.require_source or source is not None, 'Frozen source mirror is missing')
    print(json.dumps({'status': 'PASS', 'nativeAcceptance': 'PASS', 'jobIntegration': integration['status'] if integration else None,
                      'mainnetDeploymentObservation': replay if mainnet else None,
                      'operatorGate': current['operatorGate'],
                      'sourceMirror': source, 'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
