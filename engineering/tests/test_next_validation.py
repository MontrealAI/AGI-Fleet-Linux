import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ENGINEERING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINEERING))
import next_release_tools as shared


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ENGINEERING / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load('run-next-native.py')
integration = load('run-next-integration.py')
auditor = load('audit-next-evidence.py')


def candidate():
    value = json.loads((ENGINEERING / 'next-release.json').read_text())
    value.update(bytes=42, sha256='c' * 64)
    return value


def save(path, data):
    path.write_text(json.dumps(data))


class CandidateAdapters(unittest.TestCase):
    def test_frozen_native_source_stays_intact_and_candidate_is_bound(self):
        before = {name: shared.sha(ENGINEERING / name) for name in shared.BASELINES}
        bound = native.bind_runner(candidate(), Path('/unused.zip'))
        self.assertEqual(bound.ASSETS[candidate()['name']], (42, 'c' * 64))
        self.assertNotIn('AGI_Fleet_Linux_v1.0.9.zip', bound.ASSETS)
        self.assertEqual(len(bound.NATIVE_FILES), 25)
        self.assertEqual(before, {name: shared.sha(ENGINEERING / name) for name in shared.BASELINES})

    def test_native_requires_reviewed_profile_test_counts(self):
        self.assertEqual(candidate()['native']['complete'], {'tests': 3931, 'files': 344})
        for counts in ({'tests': 3917, 'files': 343}, {'tests': 3930, 'files': 344},
                       {'tests': 3931, 'files': 343}, {'tests': 3932, 'files': 344}):
            changed = candidate()
            changed['native']['complete'] = counts
            with self.subTest(counts=counts), self.assertRaisesRegex(ValueError, 'explicit review'):
                native.bind_runner(changed, Path('/unused.zip'))

    def test_integration_binds_candidate_and_exact_manager_target(self):
        bound = integration.bind_runner(candidate())
        self.assertEqual(bound.PREFIX, candidate()['prefix'])
        self.assertEqual(bound.SHA256, 'c' * 64)
        self.assertIn(candidate()['version'], bound.main.__code__.co_consts)
        self.assertNotIn('1.0.9', bound.main.__code__.co_consts)
        self.assertEqual(bound.MANAGER_BASELINE, candidate()['integration']['commit'])

    def test_native_refuses_operator_environment_before_provisioning(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, 'disposable'):
            native.require_disposable_runner()

    def test_changed_historical_harness_cannot_be_adapted(self):
        with patch.object(shared, 'sha', return_value='0' * 64), self.assertRaisesRegex(ValueError, 'Historical harness'):
            integration.bind_runner(candidate())

    def test_candidate_metadata_and_saved_archive_must_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'candidate.zip'; archive.write_bytes(b'synthetic candidate')
            value = candidate(); value.update(bytes=archive.stat().st_size, sha256=shared.sha(archive))
            metadata = root / 'release.json'; save(metadata, value)
            self.assertEqual(shared.load_candidate(metadata, archive)['sha256'], value['sha256'])
            archive.write_bytes(b'different candidate')
            with self.assertRaisesRegex(ValueError, 'identity differs'):
                shared.load_candidate(metadata, archive)

    def test_previous_release_metadata_cannot_be_relabelled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata = root / 'release.json'
            value = candidate(); value['version'] = '1.0.9'; save(metadata, value)
            with self.assertRaisesRegex(ValueError, 'metadata differs: version'):
                shared.load_candidate(metadata, root / 'unused.zip')


class TapParsing(unittest.TestCase):
    text = 'TAP version 13\n# Subtest: synthetic fixture\nok 1 - synthetic fixture\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'

    def test_complete_tap_summary(self):
        self.assertEqual(auditor.parse_tap(self.text.encode())['pass'], 1)

    def test_pass_label_does_not_hide_failed_skipped_or_truncated_tap(self):
        for text in (self.text.replace('ok 1', 'not ok 1'), self.text.replace('ok 1 - synthetic fixture', 'ok 1 - synthetic fixture # SKIP'),
                     self.text.replace('1..1', '1..2'), self.text + '# pass 1\n', self.text.replace('# todo 0\n', '')):
            with self.subTest(text=text), self.assertRaises(ValueError):
                auditor.parse_tap(text.encode())


class CandidateIntegrationAudit(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / 'evidence'; self.directory.mkdir()
        self.candidate = candidate()
        self.report = json.loads((ENGINEERING / 'tests/fixtures/job-evidence-fixture.json').read_text())
        self.report['fleet'] = {key: self.candidate[key] for key in ('version', 'sha256', 'bytes')}
        self.report['archiveVerification'].update(sha256=self.candidate['sha256'], bytes=self.candidate['bytes'], sourceFiles=self.candidate['sourceFiles'])
        target = self.candidate['integration']
        self.report['manager'].update(commit=target['commit'], requestedRef=target['commit'], version=target['version'])
        self.report['managerRegression'] = {key: target['managerTests'] for key in ('collectedTests', 'executedTests', 'passedTests')}
        self.receipt = self.report['archiveVerification']
        self.extraction = self.root / 'release'; self.extraction.mkdir()
        (self.extraction / self.candidate['prefix']).symlink_to(ENGINEERING.parent / 'fleet', target_is_directory=True)
        runner = integration.bind_runner(self.candidate)
        for step in self.report['steps']:
            text = 'Synthetic test fixture: ' + step['name'] + '\n'
            if step['name'] == 'manager-build':
                text += 'Exported artifacts: zero compiler warnings or errors.\n'
            elif step['name'] == 'fleet-artifact-reproduction':
                text += ''.join('MATCH ' + name + '\n' for name in runner.ARTIFACTS) + 'All 11 artifacts reproduced exactly\n'
            elif step['name'] == 'manager-regression':
                text += json.dumps(self.report['managerRegression'], separators=(',', ':')) + '\n'
            (self.directory / step['log']).write_text(text)
            step['logSHA256'] = hashlib.sha256(text.encode()).hexdigest()
        save(self.directory / 'current-manager-lifecycle.json', self.report['currentManagerLifecycle'])
        save(self.directory / 'candidate-binding.json', shared.provenance(self.candidate))
        self.write_report()

    def write_report(self):
        save(self.directory / 'summary.json', self.report)

    def audit(self):
        return auditor.audit_integration(self.directory, self.candidate, self.receipt, self.extraction)

    def test_fresh_candidate_retains_all_integration_audit_gates(self):
        self.assertEqual(self.audit()['verifiedLogs'], 19)

    def test_previous_version_summary_is_rejected(self):
        self.report['fleet']['version'] = '1.0.9'; self.write_report()
        with self.assertRaisesRegex(ValueError, 'Fleet identity differs'):
            self.audit()

    def test_missing_candidate_binding_is_rejected(self):
        (self.directory / 'candidate-binding.json').unlink()
        with self.assertRaises(FileNotFoundError):
            self.audit()

    def test_corrupted_log_is_rejected(self):
        (self.directory / 'AGI_Agent-integration.log').write_text('PASS')
        with self.assertRaisesRegex(ValueError, 'log differs or failed'):
            self.audit()

    def test_wrong_manager_revision_is_rejected(self):
        self.report['manager']['commit'] = 'a' * 40; self.write_report()
        with self.assertRaisesRegex(ValueError, 'Manager baseline differs'):
            self.audit()

    def test_claiming_live_usdc_is_rejected(self):
        self.report['limitations']['realUSDC'] = True; self.write_report()
        with self.assertRaisesRegex(ValueError, 'limits were broadened'):
            self.audit()


class CandidateNativeAudit(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.candidate = candidate()
        self.baseline = shared.load_module('run-linux-1.0.9-native.py')
        self.files = self.baseline.NATIVE_FILES
        self.candidate['native'] = {scope: {'tests': 25, 'files': 25} for scope in ('targeted', 'complete')}
        self.archive = self.root / 'synthetic-fixture.zip'
        inventory = {name: hashlib.sha256(('synthetic source ' + name).encode()).hexdigest() for name in self.files}
        with zipfile.ZipFile(self.archive, 'w') as saved:
            prefix = self.candidate['prefix'] + '/'
            for name in self.files:
                saved.writestr(prefix + name, 'synthetic source ' + name)
            saved.writestr(prefix + 'source-inventory.json', json.dumps({'files': [
                {'path': name, 'sha256': value} for name, value in inventory.items()]}))
        self.candidate.update(bytes=self.archive.stat().st_size, sha256=shared.sha(self.archive))
        save(self.root / 'candidate-binding.json', shared.provenance(self.candidate))
        save(self.root / 'runner.json', {'architecture': 'x64', 'uid': 0, 'operatorAccountsUsed': False,
                                       'productionQualified': False, 'githubRunId': '123', 'workflowCommit': 'a' * 40})
        save(self.root / 'native-capability.json', {'unixSocketRoundTrip': 'PASS', 'foreignSocketOwnership': 'PASS',
                                                  'foreignDirectoryOwnership': 'PASS'})
        receipts = {name: {'bytes': size, 'sha256': digest} for name, (size, digest) in self.baseline.ASSETS.items()
                    if name != 'AGI_Fleet_Linux_v1.0.9.zip'}
        receipts[self.candidate['name']] = {'source': 'saved-candidate-archive', 'bytes': self.candidate['bytes'],
                                            'sha256': self.candidate['sha256']}
        save(self.root / 'download-receipts.json', receipts)
        save(self.root / 'node-download.json', {'sha256': self.baseline.NODE_HASHES['x64'], 'executableSHA256': 'n' * 64})
        save(self.root / 'openclaw-cli-version.json', {'expected': '2026.9.5', 'output': '2026.9.5'})
        save(self.root / 'saved-archive-validation.json', {'sha256': self.candidate['sha256'], 'bytes': self.candidate['bytes'],
            'crcVerified': True, 'allManifestsVerified': True, 'sourceInventoryVerified': True})
        counts = {'tests': 25, 'suites': 0, 'pass': 25, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
        prerequisites = {'unixSocket': {'available': True}, 'node': {'version': 'v24.21.0', 'sha256': 'n' * 64},
                         'openclaw': {'version': '2026.9.5', 'verifiedFiles': 1}}
        summary = {'releaseSHA256': self.candidate['sha256'], 'architecture': 'x64',
                   'productionQualified': False, 'physicalQualification': 'NOT_RUN'}
        for scope in ('targeted', 'complete'):
            output = self.root / scope; output.mkdir()
            rows = []
            for index, name in enumerate(self.files):
                data = TapParsing.text
                if name.endswith('/setup-runtime-materialization.test.mjs'):
                    data += '# Real pinned Gateway persisted the hosted discovery cache; versioned identity validates it.\n' * 2
                log = str(index) + '.tap'; (output / log).write_text(data)
                rows.append({'file': name, 'sourceSHA256': inventory[name], 'log': log,
                             'logSHA256': hashlib.sha256(data.encode()).hexdigest(), 'logBytes': len(data.encode()),
                             'counts': auditor.parse_tap(data.encode()), 'exitCode': 0, 'timedOut': False, 'completeSummary': True})
            save(output / 'results.json', {'schema': 'agi-full-regressions/v1', 'complete': True, 'sourceUnchanged': True,
                'retainedLogsUnchanged': True, 'testFiles': 25, 'results': rows, 'prerequisites': prerequisites,
                'counts': counts, 'scope': 'PARTIAL' if scope == 'targeted' else 'FULL', 'status': 'PASS'})
            save(output / 'tested-source.json', inventory)
            save(output / 'prerequisites.json', prerequisites)
            summary[scope] = {'status': 'PASS', 'counts': counts, 'testFiles': 25, 'runnerExitCode': 1 if scope == 'targeted' else 0}
        save(self.root / 'summary.json', summary)

    def audit(self):
        with zipfile.ZipFile(self.archive) as saved:
            return auditor.audit_native(self.root, saved, self.candidate, [])

    def test_every_tap_and_source_are_bound(self):
        self.assertEqual(self.audit()['runs']['complete']['verifiedLogs'], 25)

    def test_empty_source_inventory_cannot_pass(self):
        save(self.root / 'complete/tested-source.json', {})
        with self.assertRaisesRegex(ValueError, 'Tested source coverage'):
            self.audit()

    def test_previous_release_digest_cannot_pass(self):
        report = json.loads((self.root / 'summary.json').read_text())
        report['releaseSHA256'] = '0' * 64; save(self.root / 'summary.json', report)
        with self.assertRaisesRegex(ValueError, 'Native summary candidate differs'):
            self.audit()

    def test_edited_log_cannot_pass(self):
        (self.root / 'complete/0.tap').write_text('PASS')
        with self.assertRaisesRegex(ValueError, 'Retained TAP bytes differ'):
            self.audit()

    def test_incorrect_native_architecture_cannot_pass(self):
        report = json.loads((self.root / 'runner.json').read_text())
        report['architecture'] = 'arm64'; save(self.root / 'runner.json', report)
        with self.assertRaisesRegex(ValueError, 'Pinned Node archive differs'):
            self.audit()


if __name__ == '__main__':
    unittest.main()

class SuccessorBrowserAudit(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);self.root=Path(temporary.name);self.c=candidate();self.commit='a'*40;self.run='123'
        self.screenshot=self.root/'actual-browser-work.png';self.screenshot.write_bytes(b'synthetic unit-test screenshot bytes')
        self.record={'status':'PASS','archiveSHA256':self.c['sha256'],'sourceRevisionSHA256':self.c['sourceRevisionSHA256'],'workflowCommit':self.commit,'workflowRun':self.run,'actualBrowserEffects':True,'actualComputeWorker':True,'downloadedBytesChecked':True,'provider':'NOT_RUN_SIMULATED_PROVIDER_TRANSPORT','sandbox':'FIXTURE_NO_DOCKER_QUALIFICATION','independentController':'UNVERIFIED','authority':'none','screenshotSHA256':hashlib.sha256(self.screenshot.read_bytes()).hexdigest()}
        self.record.update(authenticatedAgentDispatch=True,separatelyAuthorizedReview=True,explicitVersionChoice=True,freshOfflineRestoreAndRerun=True,selected='2'*64,candidate='2'*64)
        self.journey={'schema':'agi-fleet/successor-browser-journey/v1','original':'1'*64,'returned':'2'*64,'selected':'2'*64,'inspectionRetainedIncumbent':True,'agentAuthorization':True,'separateReviewAuthorization':True,'authority':'none','payment':'unfunded','offline':[{'language':lang,'active':'2'*64,'artifactBytesEqual':True,'capsuleSHA256':'3'*64,'authority':'none'} for lang in ('en','fr')]}
        self.save_journey()
        self.save()
    def save_journey(self):
        save(self.root/'journey.json',self.journey)
        self.record['journeySHA256']=hashlib.sha256((self.root/'journey.json').read_bytes()).hexdigest()
    def save(self):save(self.root/'evidence.json',self.record)
    def test_exact_archive_browser_evidence_is_accepted(self):
        self.assertEqual(auditor.audit_successor(self.root,self.c,self.commit,self.run),self.record)
    def test_relabelled_or_corrupted_browser_evidence_is_rejected(self):
        for key,value in [('archiveSHA256','d'*64),('sourceRevisionSHA256','e'*64),('workflowCommit','f'*40),('workflowRun','124'),('provider','live-provider'),('authority','granted')]:
            original=self.record[key];self.record[key]=value;self.save()
            with self.subTest(key=key),self.assertRaises(ValueError):auditor.audit_successor(self.root,self.c,self.commit,self.run)
            self.record[key]=original;self.save()
        self.screenshot.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'screenshot'):auditor.audit_successor(self.root,self.c,self.commit,self.run)
    def test_incomplete_journey_cannot_qualify(self):
        for key in ('authenticatedAgentDispatch','separatelyAuthorizedReview','explicitVersionChoice','freshOfflineRestoreAndRerun'):
            self.record[key]=False;self.save()
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'scope'):auditor.audit_successor(self.root,self.c,self.commit,self.run)
            self.record[key]=True
        self.save()
        original=json.loads(json.dumps(self.journey))
        for change in (lambda j:j.update(selected=j['original']),lambda j:j.update(agentAuthorization=False),lambda j:j.update(offline=j['offline'][:1]),lambda j:j['offline'][1].update(artifactBytesEqual=False),lambda j:j['offline'][0].update(active='4'*64)):
            self.journey=json.loads(json.dumps(original));change(self.journey);self.save_journey();self.save()
            with self.assertRaises(ValueError):auditor.audit_successor(self.root,self.c,self.commit,self.run)
    def test_changed_journey_bytes_cannot_qualify(self):
        (self.root/'journey.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'journey evidence'):auditor.audit_successor(self.root,self.c,self.commit,self.run)
