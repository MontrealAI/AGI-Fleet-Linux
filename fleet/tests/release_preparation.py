"""Small fixtures for coordinated metadata and source-aware archive verification."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('preparation', Path(__file__).resolve().parents[1] / 'scripts/prepare-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ReleasePreparation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def fixture(self):
        old = dict(fleet='1.16.0', agent='1.22.0', node='2.23.0')
        for role, app in m.apps(self.root):
            m.write(app / 'package.json', {'name': role, 'version': old[role], 'dependencies': {'ws': '8.21.0', 'unrelated': '1.16.0'}})
            m.write(app / 'package-lock.json', {'version': old[role], 'packages': {'': {'version': old[role]}, 'node_modules/unrelated': {'version': '1.16.0'}}})
            m.write(app / 'config/companion-releases.json', {**old, 'public': '1.13.0', 'role': role})
            m.write(app / 'release-manifest.json', {'release': old, 'localValidation': {'totalPassed': 999}, 'sourceRevisionSHA256': 'stale'})
        return old

    def test_version_bump_preserves_dependency_identity_and_discards_old_validation(self):
        self.fixture()
        new = dict(fleet='1.17.0', agent='1.23.0', node='2.24.0')
        (self.root / 'START_HERE.md').write_text('Fleet 1.16.0. Agent 1.22.0. Node 2.23.0.\n')
        self.assertTrue(m.bump(self.root, new, '2026-10-02')['changed'])
        self.assertEqual((self.root / 'START_HERE.md').read_text(), 'Fleet 1.17.0. Agent 1.23.0. Node 2.24.0.\n')
        for _, app in m.apps(self.root):
            self.assertEqual(m.load(app / 'package.json')['dependencies'], {'ws': '8.21.0', 'unrelated': '1.16.0'})
            self.assertEqual(m.load(app / 'package-lock.json')['packages']['node_modules/unrelated']['version'], '1.16.0')
            self.assertEqual(m.load(app / 'config/companion-releases.json')['public'], '1.13.0')
            self.assertEqual(m.load(app / 'release-manifest.json')['localValidation']['status'], 'PENDING')
        self.assertFalse(m.bump(self.root, new, '2026-10-02')['changed'])
        with self.assertRaisesRegex(ValueError, 'downgrade'):
            m.bump(self.root, dict(fleet='1.16.0', agent='1.23.0', node='2.24.0'), '2026-10-02')

    def archive(self, extra=False, wrong_source_mode=False):
        versions = dict(fleet='1.17.0', agent='1.23.0', node='2.24.0')
        records = [{'path': 'script.sh', 'sha256': m.sha(b'echo fixture\n'), 'executable': True}]
        revision = m.sha(json.dumps(records, sort_keys=True, separators=(',', ':')).encode())
        values = {
            'script.sh': b'echo fixture\n',
            'package.json': json.dumps({'version': '1.23.0'}).encode(),
            'config/companion-releases.json': json.dumps({**versions, 'role': 'agent'}).encode(),
            'source-inventory.json': json.dumps({'files': records, 'revisionSHA256': revision}).encode(),
            'release-manifest.json': json.dumps({'release': versions, 'sourceRevisionSHA256': revision}).encode(),
        }
        values['MANIFEST.sha256'] = ''.join(m.sha(data) + '  ' + name + '\n' for name, data in sorted(values.items())).encode()
        if extra:
            values['unexpected'] = b'not inventoried'
        archive = self.root / 'fixture.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            for name, data in values.items():
                info = zipfile.ZipInfo('fixture/' + name)
                info.create_system = 3
                mode = 0o755 if name == 'script.sh' and not wrong_source_mode else 0o644
                info.external_attr = (stat.S_IFREG | mode) << 16
                z.writestr(info, data)
        return archive

    def test_fresh_extraction_checks_manifest_source_identity_and_modes(self):
        report = m.verify_archive(self.archive(), self.root / 'fresh')
        self.assertTrue(report['sourceInventoryVerified'])
        self.assertTrue((Path(report['freshExtraction']) / 'script.sh').stat().st_mode & 0o111)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            m.verify_archive(self.root / 'fixture.zip', self.root / 'fresh')

    def test_extra_file_cannot_hide_outside_manifest(self):
        with self.assertRaisesRegex(ValueError, 'coverage'):
            m.verify_archive(self.archive(extra=True))

    def test_executable_mode_tampering_fails_even_with_identical_file_bytes(self):
        with self.assertRaisesRegex(ValueError, 'mode mismatch'):
            m.verify_archive(self.archive(wrong_source_mode=True))

    def test_source_identity_excludes_generated_and_historical_evidence(self):
        for name in ('source-inventory.json', 'docs/SBOM.cdx.json', 'evidence/run.log', 'node_modules/ws/index.js', 'docs/previous-v1.0.0/release.md'):
            self.assertFalse(m.source_path(name))
        self.assertTrue(m.source_path('compute/public-web-proxy.mjs'))

    def test_current_validation_preserves_history_and_rejects_wrong_release(self):
        current = self.fixture()
        historical = b'{"release":"1.14.0","unitTests":{"pass":794}}\n'
        (self.root / 'evidence').mkdir()
        (self.root / 'evidence/release-validation.json').write_bytes(historical)
        summary = {'release': current, 'status': 'PENDING', 'suites': {'Fleet': {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}}}
        m.record_validation(self.root, summary)
        self.assertEqual((self.root / 'evidence/history/release-validation-v1.14.0.json').read_bytes(), historical)
        self.assertEqual(m.load(self.root / 'evidence/release-validation.json')['unitTests']['pass'], 1)
        self.assertEqual(m.load(self.root / 'packages/AGI_Agent/evidence/release-validation.json')['unitTests']['status'], 'PENDING')
        m.record_validation(self.root, summary)
        with self.assertRaisesRegex(ValueError, 'Validation release'):
            m.record_validation(self.root, {**summary, 'release': dict(current, fleet='1.13.0')})

if __name__ == '__main__':
    unittest.main()
