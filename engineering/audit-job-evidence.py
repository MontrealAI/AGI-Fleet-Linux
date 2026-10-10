#!/usr/bin/env python3
"""Audit retained cross-repository integration evidence against frozen source."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import zipfile

from release_tools import LIMIT, ROOT, SHA256, SIZE, extract, require, sha

spec = importlib.util.spec_from_file_location('job_integration', ROOT / 'engineering/run-job-integration.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

STEPS = ['manager-init', 'manager-remote', 'manager-fetch', 'manager-checkout',
         'manager-dependencies', 'hardhat-dependencies', 'compiler-compatibility', 'manager-build',
         'fleet-artifact-reproduction',
         *[package + '-' + script.removesuffix('.mjs') for package, scripts in runner.SCRIPTS.items() for script in scripts],
         'current-manager-lifecycle', 'manager-regression']


def audit_run(directory, architecture, workflow_run, workflow_commit):
    report = json.loads((directory / 'summary.json').read_text())
    require(report['schema'] == 'agi-fleet-manager-integration/v1' and report['status'] == 'PASS', 'Integration did not pass')
    require(report['workflowRun'] == str(workflow_run) and report['workflowCommit'] == workflow_commit,
            'Workflow provenance differs')
    require(report['fleet'] == {'version': '1.0.9', 'sha256': SHA256, 'bytes': SIZE}, 'Fleet identity differs')
    verification = report['archiveVerification']
    require(verification['status'] == 'PASS' and verification['sha256'] == SHA256 and verification['bytes'] == SIZE
            and verification['editions'] == 7 and verification['sourceFiles'] == 4816
            and verification['manifestEntriesVerified'] == 57853, 'Incomplete archive verification')
    require(report['runtime'] == {'node': runner.NODE_VERSION, 'architecture': architecture,
                                 'nodeArchiveSHA256': runner.NODE_SHA[architecture]}, 'Pinned runtime differs')
    require(report['manager']['repository'] == runner.MANAGER_REPOSITORY
            and report['manager']['commit'] == runner.MANAGER_BASELINE
            and report['manager']['requestedRef'] == runner.MANAGER_BASELINE
            and report['manager']['version'] == '1.13.0', 'Manager baseline differs')
    require(report['standaloneIntegrationScripts'] == 8 and [step['name'] for step in report['steps']] == STEPS,
            'Integration coverage differs')
    expected_files = {'summary.json', 'current-manager-lifecycle.json', *(step + '.log' for step in STEPS)}
    actual_files = {path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file()}
    require(actual_files == expected_files, 'Retained log coverage differs')
    for step in report['steps']:
        require(step['exitCode'] == 0 and step['log'] == step['name'] + '.log'
                and sha(directory / step['log']) == step['logSHA256'], 'Integration log differs or failed')
    require('zero compiler warnings or errors.' in (directory / 'manager-build.log').read_text(),
            'Compiler diagnostic gate is missing')
    artifacts_log = (directory / 'fleet-artifact-reproduction.log').read_text()
    require(set(re.findall(r'^MATCH (\w+)$', artifacts_log, re.MULTILINE)) == set(runner.ARTIFACTS)
            and 'All 11 artifacts reproduced exactly' in artifacts_log, 'Artifact reproduction is incomplete')
    regression = (directory / 'manager-regression.log').read_text()
    counts = [json.loads(line) for line in regression.splitlines() if line.startswith('{"collectedTests":')]
    require(counts == [report['managerRegression']] and counts[0] == {
        'collectedTests': 777, 'executedTests': 777, 'passedTests': 777}, 'Manager regression counts differ')
    compatibility = report['contractCompatibility']
    require(compatibility['status'] == 'PASS', 'Contract compatibility failed')
    bundled = ROOT / 'fleet/packages/AGI_Agent/contract'
    provenance = json.loads((bundled / 'artifact-provenance.json').read_text())
    require(compatibility['bundledSourceCommit'] == provenance['sourceCommit'], 'Source pin differs')
    build_id = provenance['artifacts']['AGIJobManager']['buildInfoId']
    original = json.loads((bundled / 'compiler-inputs' / (build_id + '.json')).read_text())
    sources = [{'path': name.removeprefix('project/'), 'sha256': hashlib.sha256(row['content'].encode()).hexdigest()}
               for name, row in sorted(original['sources'].items()) if name.startswith('project/contracts/')]
    require(len(sources) == 11 and compatibility['productionSources'] == sources, 'Production source comparison differs')
    expected_artifacts = []
    for name in runner.ARTIFACTS:
        artifact = json.loads((bundled / 'artifacts' / (name + '.json')).read_text())
        expected_artifacts.append({
            'name': name, 'abiSHA256': hashlib.sha256(runner.canonical(artifact['abi'])).hexdigest(),
            'bytecodeSHA256': hashlib.sha256(artifact['bytecode'].encode()).hexdigest(),
            'deployedBytecodeSHA256': hashlib.sha256(artifact['deployedBytecode'].encode()).hexdigest(),
            'immutableOffsetsMatch': True,
        })
    require(compatibility['artifacts'] == expected_artifacts, 'Contract artifact comparison differs')
    lifecycle = json.loads((directory / 'current-manager-lifecycle.json').read_text())
    require(lifecycle == report['currentManagerLifecycle'] and lifecycle['status'] == 'PASS'
            and lifecycle['schema'] == 'agi-fleet-job-lifecycle/v1' and lifecycle['chainId'] == 31337,
            'Lifecycle report differs')
    require(lifecycle['linkedProductionContracts'] == 9 and lifecycle['defaultVoteQuorum'] == 3
            and lifecycle['defaultReviewPeriodSeconds'] == 604800 and lifecycle['agentGenerationCount'] == 1
            and lifecycle['publicationCount'] == 1 and lifecycle['managerTokenBalanceAfter'] == '0'
            and lifecycle['conservedTotalMockUSDC'] == '5000000000', 'Lifecycle accounting differs')
    for field in ['persistedAgentPreparationAndApproval', 'threePersistedNodeVotes', 'exactBondAllowancesConsumed',
                  'persistedFinalization', 'deferredClaimsConservedUSDC', 'persistedAgentAndNodeClaims',
                  'noDuplicateTransactionsAfterRestart', 'releasedAllClientExposure']:
        require(lifecycle[field] is True, 'Lifecycle coverage is incomplete: ' + field)
    require(report['limitations'] == {
        'localChainId': 31337, 'realUSDC': False, 'liveInference': False, 'publicIPFS': False,
        'independentOperators': False, 'independentRPCBackends': False,
        'physicalInstallation': False, 'realTimeEndurance': False}, 'Integration limits were broadened')
    for field in ['liveInference', 'publicIPFS', 'nativeUSDC', 'independentlyOperatedValidators',
                  'independentRPCBackends', 'realTimeEndurance']:
        require(lifecycle['limitations'][field] is False, 'Lifecycle limits were broadened')
    return {'architecture': architecture, 'status': 'PASS', 'summarySHA256': sha(directory / 'summary.json'),
            'verifiedLogs': len(STEPS), 'standaloneIntegrationScripts': 8, 'productionSourcesMatched': 11,
            'contractArtifactsMatched': 11, 'managerTestsPassed': 777,
            'currentManagerLifecycleSHA256': sha(directory / 'current-manager-lifecycle.json'),
            'managerCommit': runner.MANAGER_BASELINE, 'workflowRun': str(workflow_run),
            'workflowCommit': workflow_commit, 'productionQualified': False}


def build(artifacts, workflow_run, workflow_commit, output):
    require(set(artifacts) == {'x64', 'arm64'}, 'Both architectures are required')
    require(re.fullmatch(r'[0-9a-f]{40}', workflow_commit), 'Invalid workflow commit')
    require(not output.exists(), 'Evidence bundle already exists')
    with tempfile.TemporaryDirectory(prefix='agi-job-evidence-') as temporary:
        work = Path(temporary)
        runs = []
        for architecture in ['x64', 'arm64']:
            extract(artifacts[architecture], work / architecture)
            runs.append(audit_run(work / architecture, architecture, workflow_run, workflow_commit))
        audit = {
            'schema': 'agi-fleet-manager-integration-audit/v1', 'status': 'PASS', 'releaseSHA256': SHA256,
            'workflowRun': str(workflow_run), 'workflowCommit': workflow_commit,
            'managerCommit': runner.MANAGER_BASELINE, 'runs': runs, 'verifiedLogs': sum(run['verifiedLogs'] for run in runs),
            'productionQualified': False,
        }
        audit_file = work / 'integration-audit.json'
        audit_file.write_text(json.dumps(audit, indent=2) + '\n')
        files = {f'artifacts/{architecture}.zip': path for architecture, path in artifacts.items()}
        files.update({'integration-audit.json': audit_file,
                      'audit-job-evidence.py': ROOT / 'engineering/audit-job-evidence.py',
                      'run-job-integration.py': ROOT / 'engineering/run-job-integration.py',
                      'job-lifecycle.mjs': ROOT / 'engineering/job-lifecycle.mjs'})
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, file in sorted(files.items()):
                info = zipfile.ZipInfo(name, (2026, 10, 10, 0, 0, 0))
                info.create_system = 3; info.external_attr = 0o100644 << 16
                archive.writestr(info, file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        require(output.stat().st_size < LIMIT, 'Evidence bundle exceeds the size bound')
        return {'schema': 'agi-fleet-manager-evidence/v1', 'name': output.name, 'bytes': output.stat().st_size,
                'sha256': sha(output), 'releaseSHA256': SHA256, 'workflowRun': str(workflow_run),
                'workflowCommit': workflow_commit, 'managerCommit': runner.MANAGER_BASELINE,
                'verifiedLogs': audit['verifiedLogs'], 'productionQualified': False, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--x64', type=Path, required=True)
    parser.add_argument('--arm64', type=Path, required=True)
    parser.add_argument('--workflow-run', required=True)
    parser.add_argument('--workflow-commit', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    args = parser.parse_args()
    metadata = build({'x64': args.x64, 'arm64': args.arm64}, args.workflow_run, args.workflow_commit, args.out)
    args.metadata.write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
