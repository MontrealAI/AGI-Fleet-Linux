#!/usr/bin/env python3
"""Recheck retained 1.14.0 compatibility logs offline, without rerunning contracts."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
RECORD = 'AGIJobManager-1.14.0-compatibility-2026-10-11.json'
RECORD_SHA256 = '4dd604f2fc1fc7c386bbf2ca731d9a6e9c7bcc7806a4d48fd4d3f2b652df3560'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    raw = (ROOT / RECORD).read_bytes()
    require(digest(raw) == RECORD_SHA256, 'Compatibility record identity differs')
    record = json.loads(raw)
    require(record['status'] == 'PASS' and record['productionQualified'] is False
            and {r['architecture'] for r in record['runs']} == {'x64', 'arm64'}, 'Record scope differs')
    total = 0
    for run in record['runs']:
        artifact = ROOT / ('AGIJobManager-1.14.0-compatibility-' + run['architecture'] + '.zip')
        require(artifact.stat().st_size == run['artifactBytes'], 'Archive size differs')
        require(digest(artifact.read_bytes()) == run['artifactSHA256'], 'Archive identity differs')
        with zipfile.ZipFile(artifact) as archive:
            require(archive.testzip() is None, 'Archive CRC differs')
            summary_bytes = archive.read('summary.json')
            require(digest(summary_bytes) == run['summarySHA256'], 'Summary identity differs')
            summary = json.loads(summary_bytes)
            require(summary == run['summary'] and summary['status'] == 'PASS', 'Summary differs')
            require(summary['workflowRun'] == record['workflowRun']
                    and summary['workflowCommit'] == record['workflowCommit']
                    and summary['manager']['commit'] == record['managerCommit']
                    and summary['manager']['version'] == record['managerVersion']
                    and summary['runtime']['architecture'] == run['architecture']
                    and summary['fleet']['sha256'] == record['fleetSHA256'], 'Run provenance differs')
            steps = summary['steps']
            expected = {'summary.json', 'current-manager-lifecycle.json', *[s['log'] for s in steps]}
            require(len(archive.namelist()) == len(expected) and set(archive.namelist()) == expected,
                    'Retained file coverage differs')
            for step in steps:
                require(step['exitCode'] == 0 and digest(archive.read(step['log'])) == step['logSHA256'],
                        'Retained log differs or failed: ' + step['name'])
            require(len(steps) == run['verifiedLogs'] == 19, 'Log count differs')
            counts = [json.loads(line) for line in archive.read('manager-regression.log').decode().splitlines()
                      if line.startswith('{"collectedTests":')]
            require(counts == [summary['managerRegression']]
                    == [{'collectedTests': 779, 'executedTests': 779, 'passedTests': 779}],
                    'Manager regression evidence differs')
            lifecycle = json.loads(archive.read('current-manager-lifecycle.json'))
            require(lifecycle == summary['currentManagerLifecycle'] and lifecycle['status'] == 'PASS'
                    and lifecycle['chainId'] == 31337 and summary['standaloneIntegrationScripts'] == 8,
                    'Lifecycle evidence differs')
            total += len(steps)
    require(total == record['verifiedLogs'] == 38, 'Total log coverage differs')
    print(json.dumps({'status': 'PASS', 'recordSHA256': RECORD_SHA256, 'verifiedLogs': total,
                      'architectures': ['x64', 'arm64'], 'managerTestsPerArchitecture': 779,
                      'productionQualified': False,
                      'scope': 'Retained log integrity and consistency only; no fresh execution or RPC.'}, indent=2))


if __name__ == '__main__':
    main()
