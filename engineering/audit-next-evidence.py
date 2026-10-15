#!/usr/bin/env python3
"""Independently bind fresh native TAP and integration evidence to one candidate."""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

from next_release_tools import adapt_baseline, candidate_tools, load_candidate, load_module, provenance, verify_candidate, write_json
from release_tools import ROOT, require, sha
from saved_profile_audit import audit_saved_profile

KEYS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
BAD = ('fail', 'cancelled', 'skipped', 'todo')
BASELINE_SHA = 'c3faed24d51472a7a69dede9f9d015c433e5b5c7e09aab331b61a02e681340e1'


def read_json(path):
    return json.loads(Path(path).read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check_binding(directory, candidate):
    require(not directory.is_symlink() and directory.is_dir(), 'Evidence directory is missing or linked')
    require(not any(path.is_symlink() for path in directory.rglob('*')), 'Evidence contains a link')
    require(read_json(directory / 'candidate-binding.json') == provenance(candidate), 'Candidate evidence binding differs')


def parse_tap(data):
    text = data.decode('utf-8')
    require(text.startswith('TAP version 13\n'), 'Missing TAP header')
    require(not re.search(r'^\s*not ok\b|^\s*ok \d+ .* #\s*(?:SKIP|TODO)\b', text, re.M | re.I),
            'Failed or skipped TAP case')
    plans = re.findall(r'^1\.\.(\d+)$', text, re.M)
    assertions = re.findall(r'^ok (\d+) - ', text, re.M)
    require(len(plans) == 1 and int(plans[0]) > 0
            and list(map(int, assertions)) == list(range(1, int(plans[0]) + 1)), 'Incomplete TAP plan')
    counts = {}
    for key in KEYS:
        values = re.findall(r'^# ' + key + r' (\d+)$', text, re.M)
        require(len(values) == 1, 'Missing or ambiguous TAP summary: ' + key)
        counts[key] = int(values[0])
    require(counts['tests'] == counts['pass'] > 0 and not any(counts[key] for key in BAD), 'TAP counts did not pass')
    return counts


def audit_native(directory, archive, candidate, cases):
    check_binding(directory, candidate)
    runner = read_json(directory / 'runner.json')
    architecture = runner['architecture']
    baseline = load_module('run-linux-1.0.9-native.py')
    require(architecture in baseline.NODE_HASHES and runner['uid'] == 0
            and runner['operatorAccountsUsed'] is False and runner['productionQualified'] is False,
            'Native runner identity differs')
    require(read_json(directory / 'native-capability.json') == {
        'unixSocketRoundTrip': 'PASS', 'foreignSocketOwnership': 'PASS', 'foreignDirectoryOwnership': 'PASS'},
        'Native capabilities did not pass')
    receipts = read_json(directory / 'download-receipts.json')
    require(set(receipts) == {candidate['name'], *(n for n in baseline.ASSETS if n != 'AGI_Fleet_Linux_v1.0.9.zip')},
            'Fixture receipt coverage differs')
    require(receipts[candidate['name']] == {'source': 'saved-candidate-archive', 'bytes': candidate['bytes'],
                                           'sha256': candidate['sha256']}, 'Saved candidate receipt differs')
    for name, (size, expected) in baseline.ASSETS.items():
        if name == 'AGI_Fleet_Linux_v1.0.9.zip':
            continue
        require(receipts[name]['bytes'] == size and receipts[name]['sha256'] == expected, 'Fixture identity differs')
    node = read_json(directory / 'node-download.json')
    require(node['sha256'] == baseline.NODE_HASHES[architecture], 'Pinned Node archive differs')
    cli = read_json(directory / 'openclaw-cli-version.json')
    require(cli['expected'] == '2026.9.5' and '2026.9.5' in cli['output'].split(), 'Pinned OpenClaw differs')
    saved = read_json(directory / 'saved-archive-validation.json')
    require(saved['sha256'] == candidate['sha256'] and saved['bytes'] == candidate['bytes']
            and all(saved[key] is True for key in ('crcVerified', 'allManifestsVerified', 'sourceInventoryVerified')),
            'Saved archive verification differs')
    summary = read_json(directory / 'summary.json')
    require(summary['releaseSHA256'] == candidate['sha256'] and summary['architecture'] == architecture
            and summary['productionQualified'] is False and summary['physicalQualification'] == 'NOT_RUN',
            'Native summary candidate differs')
    prefix = candidate['prefix'] + '/'
    source_inventory = {row['path']: row['sha256'] for row in json.loads(archive.read(prefix + 'source-inventory.json'))['files']}
    runs, resolved = {}, []
    for scope in ('targeted', 'complete'):
        output = directory / scope
        result = read_json(output / 'results.json')
        expected = candidate['native'][scope]
        require(result['schema'] == 'agi-full-regressions/v1'
                and all(result[key] is True for key in ('complete', 'sourceUnchanged', 'retainedLogsUnchanged')),
                'Native run incomplete or changed')
        require(result['testFiles'] == len(result['results']) == expected['files'], 'Native file count differs')
        selection = set(baseline.NATIVE_FILES) if scope == 'targeted' else {
            name.removeprefix(prefix) for name in archive.namelist()
            if re.fullmatch(re.escape(prefix) + r'(?:tests|packages/[^/]+/tests)/[^/]+\.test\.mjs', name)}
        require({row['file'] for row in result['results']} == selection and len(selection) == expected['files'],
                'Native test selection differs')
        inventory = read_json(output / 'tested-source.json')
        require(inventory == source_inventory, 'Tested source coverage or bytes differ from candidate')
        prerequisites = result['prerequisites']
        require(prerequisites == read_json(output / 'prerequisites.json')
                and prerequisites['unixSocket']['available'] is True
                and prerequisites['node'] == {'version': 'v24.21.0', 'sha256': node['executableSHA256']}
                and prerequisites['openclaw']['version'] == '2026.9.5'
                and prerequisites['openclaw']['verifiedFiles'] > 0, 'Native prerequisites differ')
        totals, sources, logs = Counter(), {}, set()
        for row in result['results']:
            require(Path(row['log']).name == row['log'] and row['log'] not in logs, 'Unsafe or duplicate retained log')
            logs.add(row['log'])
            data = (output / row['log']).read_bytes()
            require(len(data) == row['logBytes'] and digest(data) == row['logSHA256'], 'Retained TAP bytes differ')
            require(digest(archive.read(prefix + row['file'])) == row['sourceSHA256'], 'Executed source differs')
            counts = parse_tap(data)
            require(counts == row['counts'] and row['exitCode'] == 0 and row['timedOut'] is False
                    and row['completeSummary'] is True, 'TAP result differs or failed')
            if row['file'].endswith('/setup-runtime-materialization.test.mjs'):
                require(data.decode().count('Real pinned Gateway persisted the hosted discovery cache; versioned identity validates it.') == 2,
                        'Real pinned Gateway evidence is incomplete')
            totals.update(counts)
            sources[row['file']] = (row, data.decode())
        require({path.name for path in output.glob('*.tap')} == logs, 'Retained TAP log coverage differs')
        require(dict(totals) == result['counts'] and totals['tests'] == totals['pass'] == expected['tests'], 'Native total counts differ')
        require(result['scope'] == ('PARTIAL' if scope == 'targeted' else 'FULL')
                and (scope == 'targeted' or result['status'] == 'PASS'), 'Native scope or status differs')
        require(summary[scope]['status'] == 'PASS' and summary[scope]['counts'] == dict(totals)
                and summary[scope]['testFiles'] == expected['files']
                and summary[scope]['runnerExitCode'] == (1 if scope == 'targeted' else 0), 'Native summary differs')
        for case in cases:
            row, text = sources[case['source']]
            require(row['sourceSHA256'] == case['sourceSHA256'], 'Original native regression source changed')
            matches = re.findall(r'^(ok|not ok) \d+ - ' + re.escape(case['test']) + r'(?: # (.*))?$', text, re.M)
            require(matches == [('ok', '')], 'Original native regression did not pass: ' + case['test'])
            resolved.append({'source': case['source'], 'test': case['test'], 'previousStatus': case['status'],
                             'scope': scope, 'status': 'PASS', 'sourceSHA256': row['sourceSHA256'], 'logSHA256': row['logSHA256']})
        runs[scope] = {'status': 'PASS', 'counts': dict(totals), 'verifiedLogs': len(logs),
                       'verifiedSourceFiles': len(inventory), 'resultsSHA256': sha(output / 'results.json')}
    return {'architecture': architecture, 'status': 'PASS', 'workflowRun': runner['githubRunId'],
            'workflowCommit': runner['workflowCommit'], 'runs': runs, 'resolvedCases': resolved,
            'previousFailureCasesResolved': sum(case['status'] == 'FAIL' for case in cases),
            'previousSkipCasesResolved': sum(case['status'] == 'SKIP' for case in cases), 'productionQualified': False}


def audit_integration(directory, candidate, archive_receipt, extraction):
    check_binding(directory, candidate)
    report = read_json(directory / 'summary.json')
    auditor = adapt_baseline('audit-job-evidence.py', {
        (str, '1.0.9'): candidate['version'], (int, 4816): candidate['sourceFiles'],
        (int, 57853): archive_receipt['manifestEntriesVerified'],
        (str, '1.13.0'): candidate['integration']['version'],
        (int, 777): candidate['integration']['managerTests'],
        (str, 'fleet/packages/AGI_Agent/contract'): candidate['prefix'] + '/packages/AGI_Agent/contract',
    }, extra_expected_files=('candidate-binding.json',))
    auditor.SHA256, auditor.SIZE, auditor.ROOT = candidate['sha256'], candidate['bytes'], extraction
    auditor.runner.MANAGER_BASELINE = candidate['integration']['commit']
    return auditor.audit_run(directory, report['runtime']['architecture'], report['workflowRun'], report['workflowCommit'])


def audit_successor(directory, candidate, commit, run_id):
    files = list(Path(directory).rglob('evidence.json'))
    require(len(files) == 1, 'Exactly one saved-archive browser observation is required')
    file = files[0]
    require(not file.is_symlink(), 'Browser evidence cannot be linked')
    result = read_json(file)
    require(result['status'] == 'PASS' and result['archiveSHA256'] == candidate['sha256']
            and result['sourceRevisionSHA256'] == candidate['sourceRevisionSHA256']
            and result['workflowCommit'] == commit and str(result['workflowRun']) == str(run_id),
            'Browser evidence belongs to another archive or workflow')
    require(all(result.get(key) is True for key in ('actualBrowserEffects','actualComputeWorker','downloadedBytesChecked',
                                                  'authenticatedAgentDispatch','separatelyAuthorizedReview',
                                                  'explicitVersionChoice','freshOfflineRestoreAndRerun'))
            and result['provider'] == 'NOT_RUN_SIMULATED_PROVIDER_TRANSPORT'
            and result['sandbox'] == 'FIXTURE_NO_DOCKER_QUALIFICATION'
            and result['independentController'] == 'UNVERIFIED' and result['authority'] == 'none',
            'Browser evidence scope differs')
    screenshot = file.parent / 'actual-browser-work.png'
    require(screenshot.is_file() and not screenshot.is_symlink() and sha(screenshot) == result['screenshotSHA256'],
            'Browser screenshot differs')
    journey_file = file.parent / 'journey.json'
    require(journey_file.is_file() and not journey_file.is_symlink() and sha(journey_file) == result.get('journeySHA256'),
            'Browser journey evidence differs')
    journey = read_json(journey_file)
    require(journey.get('schema') == 'agi-fleet/successor-browser-journey/v1'
            and all(journey.get(key) is True for key in ('inspectionRetainedIncumbent','agentAuthorization','separateReviewAuthorization'))
            and journey.get('authority') == 'none' and journey.get('payment') == 'unfunded',
            'Browser journey authority or authorization differs')
    require(all(re.fullmatch(r'[a-f0-9]{64}', str(journey.get(key, ''))) for key in ('original','returned','selected'))
            and journey['original'] != journey['returned']
            and journey['returned'] == journey['selected'] == result.get('candidate') == result.get('selected'),
            'Browser journey candidate selection differs')
    offline = journey.get('offline')
    require(isinstance(offline, list) and len(offline) == 2
            and {row.get('language') for row in offline} == {'en','fr'}
            and all(row.get('active') == journey['selected'] and row.get('artifactBytesEqual') is True
                    and row.get('authority') == 'none' and re.fullmatch(r'[a-f0-9]{64}', str(row.get('capsuleSHA256', '')))
                    for row in offline), 'Both fresh offline reruns must preserve the selected artifacts')
    return result


def audit(archive_path, candidate, native, integration, workflow_commit=None, workflow_run=None, successor=None, profiles=None):
    require(len(native) == len(integration) == 2, 'Exactly two native and integration architecture runs are required')
    require(profiles is not None and len(profiles) == 2, 'Exactly two saved-archive profile runs are required')
    receipt = verify_candidate(archive_path, candidate)
    ledger = read_json(ROOT / 'validation/original-native-case-ledger.json')
    require(ledger['releaseSHA256'] == BASELINE_SHA and len(ledger['cases']) == 50, 'Original case ledger differs')
    with zipfile.ZipFile(archive_path) as saved:
        native_runs = [audit_native(path, saved, candidate, ledger['cases']) for path in native]
    with tempfile.TemporaryDirectory(prefix='agi-next-independent-audit-') as temporary:
        extraction = Path(temporary) / 'release'
        candidate_tools(candidate).extract(archive_path, extraction)
        integration_runs = [audit_integration(path, candidate, receipt, extraction) for path in integration]
    for group in (native_runs, integration_runs):
        require({run['architecture'] for run in group} == {'x64', 'arm64'}, 'Both architectures are required')
    runs = native_runs + integration_runs
    commits = {run['workflowCommit'] for run in runs}
    run_ids = {str(run['workflowRun']) for run in runs}
    require(len(commits) == len(run_ids) == 1 and re.fullmatch(r'[a-f0-9]{40}', next(iter(commits)))
            and re.fullmatch(r'[1-9][0-9]*', next(iter(run_ids))), 'Workflow provenance differs or is missing')
    commit, run_id = next(iter(commits)), next(iter(run_ids))
    require(not workflow_commit or commit == workflow_commit, 'Expected workflow commit differs')
    require(not workflow_run or run_id == str(workflow_run), 'Expected workflow run differs')
    profile_runs = [audit_saved_profile(path, archive_path, candidate, commit, run_id) for path in profiles]
    require({row['architecture'] for row in profile_runs} == {'x64', 'arm64'}, 'Both profile architectures are required')
    return {'schema': 'agi-next-release-independent-audit/v1', 'status': 'PASS',
            'version': candidate['version'], 'releaseSHA256': candidate['sha256'],
            'sourceRevisionSHA256': candidate['sourceRevisionSHA256'], 'workflowCommit': commit, 'workflowRun': run_id,
            'architectures': ['x64', 'arm64'], 'native': native_runs, 'integration': integration_runs,
            'integrationTarget': candidate['integration'], 'contractProfiles': profile_runs,
            'successorAcceptance': audit_successor(successor, candidate, commit, run_id),
            'verifiedTapLogs': sum(run['runs'][scope]['verifiedLogs'] for run in native_runs for scope in ('targeted', 'complete')),
            'verifiedIntegrationLogs': sum(run['verifiedLogs'] for run in integration_runs),
            'productionQualified': False, 'physicalQualification': 'NOT_RUN'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--native', type=Path, action='append', required=True)
    parser.add_argument('--integration', type=Path, action='append', required=True)
    parser.add_argument('--profile', type=Path, action='append', required=True)
    parser.add_argument('--workflow-commit', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--workflow-run', default=os.environ.get('GITHUB_RUN_ID'))
    parser.add_argument('--successor', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    candidate = load_candidate(args.metadata, args.archive)
    result = audit(args.archive, candidate, args.native, args.integration, args.workflow_commit, args.workflow_run, args.successor, args.profile)
    require(not args.out.exists(), 'Audit output already exists')
    write_json(args.out, result)
    print(json.dumps({key: result[key] for key in ('status', 'version', 'releaseSHA256', 'workflowCommit', 'architectures',
                                                 'verifiedTapLogs', 'verifiedIntegrationLogs', 'productionQualified')}, indent=2))


if __name__ == '__main__':
    main()
