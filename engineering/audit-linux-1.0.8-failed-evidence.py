#!/usr/bin/env python3
"""Independently reconcile retained TAP evidence against the frozen source."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import zipfile

KEYS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
RELEASE_SHA = 'fa2bafdf957c3b3ecf36639ecd47adb4f7bf33c2ddfb13a99500fdd4625f4fb8'
BASELINE_SHA = 'c3faed24d51472a7a69dede9f9d015c433e5b5c7e09aab331b61a02e681340e1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def audit(root, release, cases):
    report = {'architecture': json.loads((root / 'runner.json').read_text())['architecture'], 'runs': {}, 'resolvedCases': []}
    archive = json.loads((root / 'saved-archive-validation.json').read_text())
    assert archive['sha256'] == RELEASE_SHA
    assert all(archive[k] is True for k in ('crcVerified', 'allManifestsVerified', 'sourceInventoryVerified'))
    for scope, expected_files in [('targeted', 23), ('complete', 342)]:
        directory = root / scope
        result = json.loads((directory / 'results.json').read_text())
        assert result['sourceUnchanged'] is result['retainedLogsUnchanged'] is result['complete'] is True
        assert result['testFiles'] == len(result['results']) == expected_files
        actual_files = {row['file'] for row in result['results']}
        expected_selection = ({c['source'] for c in cases} | {f'packages/AGI_{role}/tests/setup-runtime-materialization.test.mjs' for role in ('Agent','Node','Moderator','Employer','Evidence','Recovery')} | {f'packages/AGI_{role}/tests/setup-standard-readiness.test.mjs' for role in ('Agent','Node')} | {'packages/AGI_Agent/tests/setup-plugin-catalog-policy.test.mjs'}) if scope == 'targeted' else {
            n.removeprefix('AGI_Fleet_Linux_v1.0.8/') for n in release.namelist()
            if re.fullmatch(r'AGI_Fleet_Linux_v1\.0\.8/(?:tests|packages/[^/]+/tests)/[^/]+\.test\.mjs', n)}
        assert actual_files == expected_selection and len(actual_files) == expected_files
        inventory = json.loads((directory / 'tested-source.json').read_text())
        for name, expected in inventory.items():
            assert digest(release.read('AGI_Fleet_Linux_v1.0.8/' + name)) == expected, name
        totals = Counter()
        sources = {}
        for row in result['results']:
            data = (directory / row['log']).read_bytes()
            assert len(data) == row['logBytes'] and digest(data) == row['logSHA256'], row['log']
            assert digest(release.read('AGI_Fleet_Linux_v1.0.8/' + row['file'])) == row['sourceSHA256']
            counts = {key: int(re.findall(r'^# ' + key + r' (\d+)$', data.decode(), re.M)[-1]) for key in KEYS}
            assert counts == row['counts']
            assert row['timedOut'] is False and row['completeSummary'] is True
            assert (row['exitCode'] == 0) == (counts['fail'] == 0)
            assert not any(counts[k] for k in ('cancelled', 'skipped', 'todo'))
            if row['file'].endswith('/setup-runtime-materialization.test.mjs'):
                assert data.decode().count('Real pinned Gateway persisted the hosted discovery cache; versioned identity validates it.') == 2, row['file']
            totals.update(counts)
            sources[row['file']] = row
        assert dict(totals) == result['counts']
        if scope == 'complete':
            assert result['status'] == 'NOT_PASS' and result['scope'] == 'FULL'
            assert totals['tests'] == totals['pass'] + totals['fail'] == 3897 and totals['fail'] == 6
        else:
            assert result['scope'] == 'PARTIAL' and totals['tests'] == totals['pass'] + totals['fail'] == 285 and totals['fail'] == 0
        failed = [row for row in result['results'] if row['exitCode'] != 0]
        expected_failures = set()
        if scope == 'complete':
            expected_failures |= {f'packages/AGI_{role}/tests/setup-fresh-readiness-resume.test.mjs' for role in ('Agent','Node')}
        assert {row['file'] for row in failed} == expected_failures
        for row in failed:
            names = re.findall(r'^not ok \d+ - (.*)$', (directory / row['log']).read_text(), re.M)
            if row['file'].endswith('/public-web-qualification-import.test.mjs'):
                assert names == ['execution fingerprint is mode-transition stable but binds machine, credentials, source and settings'], names
                assert 'assert.ok(Object.keys(before.sourceHashes).length<=128)' in (directory / row['log']).read_text()
            else:
                role = 'agent' if '/AGI_Agent/' in row['file'] else 'node'
                assert names == [role + ' ' + name for name in (
                    'known approved 1.18.6 stopped failure retains exact evidence, current OAuth, state and limits, then reaches new approval/readiness',
                    'recovery admission rejects authority, provenance, state and quiescence changes without mutation',
                    'write-ahead retention resumes an interruption after the profile atomic rename and never opens installed SQLite')]
                assert (directory / row['log']).read_text().count('Error: SETUP_RUNTIME_SECURITY_VERSION') == 3
        for case in cases:
            row = sources[case['source']]
            assert row['sourceSHA256'] == case['sourceSHA256']
            text = (directory / row['log']).read_text()
            matches = re.findall(r'^(ok|not ok) \d+ - ' + re.escape(case['test']) + r'(?: # (.*))?$', text, re.M)
            assert matches == [('ok', '')], (scope, case['test'], matches)
            report['resolvedCases'].append({'source': case['source'], 'test': case['test'], 'previousStatus': case['status'],
                'scope': scope, 'status': 'PASS', 'log': row['log'], 'logSHA256': row['logSHA256'], 'sourceSHA256': row['sourceSHA256']})
        report['runs'][scope] = {'status': 'PASS' if scope == 'targeted' else 'NOT_PASS', 'counts': dict(totals), 'verifiedLogs': expected_files,
            'verifiedSourceFiles': len(inventory), 'resultsSHA256': digest((directory / 'results.json').read_bytes())}
    report['previousFailureCasesResolved'] = sum(c['status'] == 'FAIL' for c in cases)
    report['previousSkipCasesResolved'] = sum(c['status'] == 'SKIP' for c in cases)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--release', type=Path, required=True)
    p.add_argument('--case-audit', type=Path, required=True)
    p.add_argument('--run', type=Path, action='append', required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    with args.release.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == RELEASE_SHA
    if zipfile.is_zipfile(args.case_audit):
        with zipfile.ZipFile(args.case_audit) as z:
            ledger = json.loads(z.read('case-ledger.json'))
    else:
        ledger = json.loads(args.case_audit.read_text())
    assert ledger['releaseSHA256'] == BASELINE_SHA and len(ledger['cases']) == 50
    with zipfile.ZipFile(args.release) as release:
        runs = [audit(directory, release, ledger['cases']) for directory in args.run]
    assert {r['architecture'] for r in runs} == {'x64', 'arm64'}
    result = {'schema': 'agi-native-failed-run-evidence-audit/v1', 'status': 'NOT_PASS', 'evidenceIntegrity': 'PASS', 'releaseSHA256': RELEASE_SHA,
        'frozenCandidateSourceChanged': False, 'previousReleaseChanged': True, 'previousReleaseSHA256': BASELINE_SHA, 'runs': runs, 'verifiedTapLogs': 730, 'productionQualified': False,
        'physicalQualification': {'Linux': 'NOT_RUN', 'M1': 'NOT_RUN', 'M2': 'NOT_RUN'}}
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'architectures': [r['architecture'] for r in runs],
                      'verifiedTapLogs': result['verifiedTapLogs'], 'previousFailuresResolvedPerArchitecture': 44,
                      'previousSkipsResolvedPerArchitecture': 6, 'productionQualified': False}, indent=2))


if __name__ == '__main__':
    main()
