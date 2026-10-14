import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import urllib.error
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('local_release', ROOT / 'local-runtime/release.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


class PreviewReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.evidence = self.root / 'evidence'
        self.commit, self.run = 'a' * 40, '123'
        self.spec = R.load(ROOT / 'local-runtime/preview-release.json')
        self.create_evidence()

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        R.write(path, value)

    def tap(self, path, count):
        path.write_text('TAP version 13\n' + ''.join(f'ok {i + 1} - synthetic auditor fixture\n' for i in range(count))
                        + f'1..{count}\n# tests {count}\n# pass {count}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')

    def create_evidence(self):
        prefix = 'agi-fleet-local-' + self.spec['version']
        entries = {'local-runtime/cli/main.mjs': b'synthetic unit fixture', 'local-runtime/validate.mjs': b'synthetic', 'LICENSE': b'fixture license'}
        manifest = {'schema': 'agi-fleet/local-source-preview/v1', 'commit': self.commit, 'workingTreeDirty': False,
                    'version': self.spec['version'], 'operatorInstaller': False, 'productionQualified': False,
                    'files': [{'path': name, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'mode': 0o644} for name, value in entries.items()]}
        entries['local-preview-manifest.json'] = json.dumps(manifest).encode()
        pins = R.load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node']
        for arch in ('x64', 'arm64'):
            folder = self.evidence / ('local-skills-preview-' + arch)
            (folder / 'local-preview').mkdir(parents=True)
            archive = folder / 'local-preview' / self.spec['archive']
            with zipfile.ZipFile(archive, 'w') as target:
                for name, data in entries.items():
                    info = zipfile.ZipInfo(prefix + '/' + name)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    target.writestr(info, data)
            logs = folder / 'local-host-evidence'
            self.write(logs / 'qualification.json', {'commit': self.commit, 'workflowRun': self.run, 'architecture': arch, 'archiveSHA256': R.sha(archive)})
            for name, scope in [('source', 'module'), ('extracted', 'module'), ('native-source', 'native'), ('native-archive', 'native')]:
                self.tap(logs / (name + '.tap'), self.spec['tests'][scope])
            (logs / 'installer.log').write_text('Ran 15 tests in 1.0s\n\nOK\n')
            pin = next(p for p in pins['archives'] if p['platform'] == 'linux-' + arch)
            installed = {'archiveSHA256': R.sha(archive), 'platform': 'linux', 'arch': arch,
                         'restartPreservedReservations': 2, 'oldGrantReplayed': False, 'provider': 'none',
                         'independentReview': False, 'physical': 'NOT_RUN', 'productionQualified': False,
                         'node': {'archiveSHA256': pin['sha256'], 'version': pins['preferredVersion']}}
            installed.update({k: True for k in ('actualInstallation', 'actualIPC', 'actualSandbox', 'actualServiceRecovery', 'stableAssistantRestart', 'removalPreservedState', 'removalPreservedOutputs')})
            self.write(logs / 'installed-journey.json', installed)
            for role in R.ROLES:
                gateway = {'role': role, 'openclaw': '2026.9.5', 'providerTransport': 'local-synthetic-fixture',
                           'evidenceClass': 'NATIVE_LOCAL_RUNTIME', 'offeredTools': ['fleet_local'], 'productionQualified': False,
                           'liveProviderJudgment': False, 'independentReview': False}
                gateway.update({k: True for k in ('actualGateway', 'actualRuntime', 'actualSandbox', 'skillObserved', 'separateAuthorization', 'scopedActor')})
                self.write(logs / ('openclaw-' + role + '.json'), gateway)
        browser = self.evidence / 'local-dashboard-observations'
        self.write(browser / 'qualification.json', {'commit': self.commit, 'workflowRun': self.run, 'evidenceClass': 'BROWSER_WITH_DECLARED_SYNTHETIC_WORKER'})
        self.tap(browser / 'browser.tap', 2)
        for lang in ('en', 'fr'):
            for size in ('desktop', 'mobile'):
                (browser / (lang + '-' + size + '.png')).write_bytes(b'\x89PNG\r\n\x1a\nsynthetic fixture')

    def audit(self):
        return R.audit(self.evidence, self.commit, self.run, self.spec)

    def test_matching_fixture_audits_and_bundles_without_production_claim(self):
        result = self.audit()
        self.assertEqual(result['status'], 'PASS')
        self.assertFalse(result['fullHandoffComplete'])
        self.assertFalse(result['productionQualified'])
        output = self.root / 'bundle'
        R.bundle(self.evidence, output, self.commit, self.run)
        self.assertEqual(R.sha(output / self.spec['archive']), result['archive']['sha256'])
        with zipfile.ZipFile(output / 'local-evidence.zip') as z:
            self.assertIsNone(z.testzip())
            self.assertTrue(any(n.endswith('native-archive.tap') for n in z.namelist()))
            self.assertFalse(any('/local-preview/' in n for n in z.namelist()))

    def test_wrong_source_or_run_rejected(self):
        for commit, run in [('b' * 40, self.run), (self.commit, '999')]:
            with self.assertRaises(ValueError):
                R.audit(self.evidence, commit, run, self.spec)

    def test_missing_or_failing_or_skipped_native_result_rejected(self):
        file = self.evidence / 'local-skills-preview-arm64/local-host-evidence/native-archive.tap'
        original = file.read_text()
        for text in ['', original.replace('# pass 4', '# pass 3').replace('# fail 0', '# fail 1'), original.replace('# skipped 0', '# skipped 1'), original + '# tests 4\n']:
            file.write_text(text)
            with self.assertRaises(ValueError):
                self.audit()
        file.write_text(original)

    def test_installed_package_and_restart_evidence_are_required(self):
        file = self.evidence / 'local-skills-preview-x64/local-host-evidence/installed-journey.json'
        original = R.load(file)
        for key, value in [('archiveSHA256', 'b' * 64), ('actualSandbox', False), ('oldGrantReplayed', True), ('restartPreservedReservations', 0), ('physical', 'PASS')]:
            altered = {**original, key: value}
            self.write(file, altered)
            with self.assertRaises(ValueError):
                self.audit()
        self.write(file, original)

    def test_all_six_scoped_gateway_paths_are_required(self):
        for role in R.ROLES:
            file = self.evidence / 'local-skills-preview-arm64/local-host-evidence' / ('openclaw-' + role + '.json')
            original = R.load(file)
            for key, value in [('separateAuthorization', False), ('offeredTools', ['shell']), ('providerTransport', 'live'), ('actualGateway', False)]:
                self.write(file, {**original, key: value})
                with self.assertRaises(ValueError):
                    self.audit()
            self.write(file, original)

    def test_browser_images_and_source_binding_are_required(self):
        file = self.evidence / 'local-dashboard-observations/fr-mobile.png'
        file.unlink()
        with self.assertRaises(ValueError):
            self.audit()

    def test_preview_scope_and_minimum_gates_cannot_be_promoted_or_reduced(self):
        original = copy.deepcopy(self.spec)
        for key, value in [('productionQualified', True), ('fullHandoffComplete', True), ('fundedWork', 'ENABLED'), ('operatorInstaller', True)]:
            self.spec = {**original, key: value}
            with self.assertRaises(ValueError):
                self.audit()
        self.spec = copy.deepcopy(original)
        self.spec['tests']['native'] = 0
        with self.assertRaises(ValueError):
            self.audit()

    def test_altered_architecture_archive_is_rejected(self):
        file = self.evidence / 'local-skills-preview-arm64/local-preview' / self.spec['archive']
        file.write_bytes(file.read_bytes() + b'changed archive bytes')
        with self.assertRaises(ValueError):
            self.audit()

    def test_linked_installer_log_is_rejected(self):
        file = self.evidence / 'local-skills-preview-arm64/local-host-evidence/installer.log'
        outside = self.root / 'outside.log'
        file.rename(outside)
        file.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.audit()

    def test_dirty_or_overclaimed_archives_are_rejected(self):
        file = self.evidence / 'local-skills-preview-x64/local-preview' / self.spec['archive']
        original = file.read_bytes()
        for key, value in [('workingTreeDirty', True), ('operatorInstaller', True), ('productionQualified', True)]:
            file.write_bytes(original)
            with zipfile.ZipFile(file) as source:
                entries = [(i, source.read(i.filename)) for i in source.infolist()]
            with zipfile.ZipFile(file, 'w') as target:
                for info, data in entries:
                    if info.filename.endswith('/local-preview-manifest.json'):
                        manifest = json.loads(data)
                        manifest[key] = value
                        data = json.dumps(manifest).encode()
                    target.writestr(info, data)
            with self.assertRaises(ValueError):
                self.audit()

    def test_publication_requires_full_fleet_and_keeps_legacy_publication_disabled(self):
        local = (ROOT / '.github/workflows/local-skills.yml').read_text()
        legacy = (ROOT / '.github/workflows/next-release.yml').read_text()
        self.assertIn('needs: [native, browser, audit, fleet]', local)
        self.assertIn('uses: ./.github/workflows/next-release.yml', local)
        self.assertIn('validation_only: true', local)
        self.assertIn('!inputs.validation_only &&', legacy)
        self.assertIn('needs: [build, native, integration, successor, audit]', legacy)
        self.assertIn('cancel-in-progress: false', local)
        self.assertIn('cancel-in-progress: false', legacy)

    def api_fixture(self, wrong_asset=False, wrong_tag=False):
        self.asset = self.root / 'sample.zip'
        self.asset.write_bytes(b'exact synthetic publication fixture')
        record = {'name': self.asset.name, 'size': self.asset.stat().st_size, 'digest': 'sha256:' + R.sha(self.asset)}
        if wrong_asset:
            record['digest'] = 'sha256:' + 'b' * 64
        release = {'id': 17, 'draft': True, 'prerelease': True, 'target_commitish': self.commit, 'body': 'canonical notes', 'assets': [record], 'html_url': 'fixture'}
        self.calls = []
        def api(path, **kwargs):
            self.calls.append((path, kwargs))
            if path.startswith('/git/ref/'):
                return {'object': {'type': 'commit', 'sha': 'b' * 40 if wrong_tag else self.commit}}
            if kwargs.get('method') == 'PATCH':
                payload = json.loads(kwargs['data'])
                self.assertEqual(payload, {'draft': False, 'prerelease': True, 'make_latest': 'false', 'body': 'canonical notes'})
                release.update(payload)
            return copy.deepcopy(release)
        return api

    def test_publication_keeps_canonical_notes_on_final_patch_and_rechecks_tag(self):
        api = self.api_fixture()
        result = R.publish_assets(api, self.spec, self.commit, [self.asset], 'canonical notes')
        self.assertFalse(result['draft'])
        self.assertTrue(result['prerelease'])
        self.assertEqual(sum(path.startswith('/git/ref/') for path, _ in self.calls), 3)

    def test_differing_tag_or_existing_asset_is_never_replaced(self):
        for wrong_asset, wrong_tag in [(True, False), (False, True)]:
            api = self.api_fixture(wrong_asset, wrong_tag)
            with self.assertRaises(ValueError):
                R.publish_assets(api, self.spec, self.commit, [self.asset], 'canonical notes')
            self.assertFalse(any(kwargs.get('method') in ('PATCH', 'DELETE', 'POST') for _, kwargs in self.calls))


if __name__ == '__main__':
    unittest.main()
