import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MaterializationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='mac-preview-materialize-')
        cls.stage = Path(cls.temp.name) / 'candidate'
        cls.module = load('mac_preview_materialize_test', HERE / 'materialize.py')
        cls.module.materialize(cls.stage)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_source_binding_and_qualification_separation(self):
        checked = load('mac_preview_inventory_test', HERE / 'check.py').check()
        sources = {item['path'] for item in json.loads((HERE / 'source-inventory.json').read_text())['files']}
        self.assertTrue({'.github/workflows/macos-preview.yml', 'macos/release.json',
                         'workstation/candidate.json', 'workstation/tests/studio.test.mjs',
                         'engineering/next-release.json'}.issubset(sources))
        for app in [self.stage, *(self.stage / 'packages').glob('AGI_*')]:
            note = json.loads((app / 'PREVIEW-NOT-A-RELEASE.json').read_text())
            self.assertEqual(note['previewSourceSha256'], checked['sourceSha256'])
            self.assertEqual(note['materializedSourceBasis']['revisionSHA256'], checked['fleetSource']['revisionSHA256'])
            self.assertEqual(note['materializedSourceBasis']['version'], json.loads((ROOT / 'engineering/next-release.json').read_text())['version'])
            self.assertEqual(note['reusedPreviewHistoricalBasis']['frozenFleetVersion'], '1.0.9')
            self.assertEqual(note['productionExecution'], 'DISABLED')
            self.assertFalse(note['productionQualified'])
            self.assertFalse(note['qualificationInherited'])
            self.assertFalse(note['includedInMacReleaseZip'])
            self.assertEqual(note['macRuntimeOverlayVersion'], json.loads((ROOT / 'macos/release.json').read_text())['version'])
            self.assertEqual([name for name in note if name.startswith('includedInMac')], ['includedInMacReleaseZip'])
            self.assertEqual(set(note['physicalQualification'].values()), {'NOT_RUN'})
            self.assertEqual(note['physicalQualification']['endurance72h'], 'NOT_RUN')
            self.assertFalse((app / 'release-manifest.json').exists())
            self.assertFalse((app / 'MANIFEST.sha256').exists())
            self.assertIn('SOURCE PREVIEW', (app / 'READ_ME_FIRST.txt').read_text())
            for guide in ('QUICKSTART.md', 'STUDIO.md'):
                self.assertTrue((app / guide).is_file())
                self.assertIn('href="' + guide + '"', (app / 'START_HERE.html').read_text())

    def test_original_mac_provider_and_shared_composer_are_exact(self):
        for directory in [self.stage / 'workforce', *(self.stage / 'packages').glob('*/workforce')]:
            for name in ('platform.mjs', 'gateway.mjs', 'native.mjs', 'authority.mjs', 'envelope.mjs', 'project.mjs'):
                self.assertEqual((directory / name).read_bytes(), (ROOT / 'fleet/workforce' / name).read_bytes())
            self.assertEqual((directory / 'job-draft.mjs').read_bytes(), (ROOT / 'workstation/engine/job-draft.mjs').read_bytes())

    def test_preview_rejects_stale_or_qualified_release_flags(self):
        checker = load('mac_preview_boundary_test', HERE / 'check.py')
        candidate_file = HERE / 'candidate.json'
        candidate = json.loads(candidate_file.read_text())
        original_read = Path.read_text
        for changed in ({'includedInMacReleaseZip': True}, {'includedInMac1201Zip': False},
                        {'productionQualified': True}):
            with self.subTest(changed=changed):
                def read(file, *args, **kwargs):
                    if file == candidate_file:
                        return json.dumps({**candidate, **changed})
                    return original_read(file, *args, **kwargs)
                with patch.object(Path, 'read_text', read):
                    with self.assertRaisesRegex(ValueError, 'Preview qualification boundary changed'):
                        checker.check()

    def test_studio_reuses_all_functional_code_with_only_mac_help_changes(self):
        overlay = ROOT / 'workstation/studio-overlay'
        for file in overlay.rglob('*'):
            if file.is_file():
                relative = file.relative_to(overlay)
                if relative.name != 'index.html' and relative.as_posix().split('/')[-2:] != ['control', 'messages.mjs']:
                    self.assertEqual((self.stage / relative).read_bytes(), file.read_bytes(), str(relative))
        for role in ('Agent', 'Node'):
            page = (self.stage / f'packages/AGI_{role}/app/index.html').read_text()
            self.assertIn('Mac source preview', page)
            self.assertNotIn('/docs/Linux-Guide.html', page)
            self.assertNotIn('Fresh Ubuntu setup', page)
            self.assertNotIn('Transfer-Setup.sh', page)
            self.assertIn('/macos/preview/STUDIO.md', page)
            self.assertNotIn('/macos/preview/QUICKSTART.md', page)

    def test_native_launchers_bootstrap_private_node_then_check_mac(self):
        for app in [self.stage, self.stage / 'packages/AGI_Agent', self.stage / 'packages/AGI_Node']:
            launcher = (app / 'Launch-Native-Workforce.command').read_text()
            self.assertLess(launcher.index('agi_standard_node\n'), launcher.index('check-mac-host.mjs'))
            self.assertIn('workforce/cli.mjs menu', launcher)
            self.assertTrue((app / 'Launch-Native-Workforce.command').stat().st_mode & 0o111)

    def test_output_refuses_existing_directory_and_repository(self):
        marker = self.stage / 'preserve.txt'
        marker.write_text('unchanged')
        for output in (self.stage, ROOT / 'macos/preview/should-not-exist'):
            with self.assertRaisesRegex(ValueError, 'new output directory outside'):
                self.module.materialize(output)
        self.assertEqual(marker.read_text(), 'unchanged')

    def test_failure_retains_no_partial_release_at_destination(self):
        output = Path(self.temp.name) / 'failed-output'
        existing = set(Path(self.temp.name).iterdir())
        def fail(staging, checked):
            staging.mkdir()
            (staging / 'release-manifest.json').write_text('inherited release')
            raise ValueError('SIMULATED_OVERLAY_FAILURE')
        with patch.object(self.module, 'populate', side_effect=fail):
            with self.assertRaisesRegex(ValueError, 'SIMULATED_OVERLAY_FAILURE'):
                self.module.materialize(output)
        self.assertFalse(output.exists())
        self.assertEqual(set(Path(self.temp.name).iterdir()), existing)

    def test_reapplication_is_rejected_before_changing_engine(self):
        before = (self.stage / 'workforce/runner.mjs').read_bytes()
        overlay = load('mac_preview_overlay_test', HERE / 'overlay.py')
        with self.assertRaisesRegex(ValueError, 'already applied'):
            overlay.apply(self.stage)
        self.assertEqual((self.stage / 'workforce/runner.mjs').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
