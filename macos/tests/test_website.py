"""A planned Mac release must never become a download or production claim by accident."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('mac_website_builder', ROOT / 'engineering/build-website.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MacWebsiteMetadataTests(unittest.TestCase):
    def setUp(self):
        self.release = json.loads((ROOT / 'macos/release.json').read_text())

    def published(self):
        return {**self.release, 'schema': 'agi-macos-published-release/v1',
                'nativeAcceptance': 'PASS', 'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL',
                'bytes': 300_000_000, 'sha256': 'a' * 64,
                'workflowCommit': 'b' * 40, 'workflowRun': '12345'}

    def test_unpublished_candidate_has_preparation_links_and_closed_gate(self):
        tokens = builder.mac_release_tokens(self.release)
        self.assertIn('/macos/docs/FRESH_INSTALL.md', tokens['MAC_DOWNLOAD_URL'])
        self.assertNotIn('/releases/download/', tokens['MAC_DOWNLOAD_URL'])
        self.assertIn('closed', tokens['MAC_GATE_EN'])
        self.assertIn('not been published', tokens['MAC_AVAILABILITY_EN'])
        self.assertEqual(tokens['MAC_PRODUCTION_EN'], 'not complete')

    def test_published_accepted_archive_uses_mac_asset_and_stays_unqualified(self):
        tokens = builder.mac_release_tokens(self.published(), published=True)
        self.assertEqual(tokens['MAC_DOWNLOAD_URL'],
                         f"{builder.REPO}/releases/download/{self.release['tag']}/{self.release['name']}")
        self.assertIn('macOS', tokens['MAC_CHECKSUM_NAME'])
        self.assertEqual(tokens['MAC_PRODUCTION_EN'], 'not complete')

    def test_missing_acceptance_identity_or_workflow_provenance_blocks_publication(self):
        cases = {'nativeAcceptance': 'NOT_RUN', 'operatorGate': 'CLOSED_PENDING_NATIVE_ACCEPTANCE',
                 'bytes': 450_000_000, 'sha256': 'invalid', 'workflowCommit': '', 'workflowRun': 0}
        for field, value in cases.items():
            with self.subTest(field=field):
                release = self.published()
                release[field] = value
                with self.assertRaises(ValueError):
                    builder.mac_release_tokens(release, published=True)

    def test_platform_and_production_claims_cannot_change_without_explicit_review(self):
        cases = {'platform': 'linux', 'architecture': 'x64', 'productionQualified': True,
                 'physicalQualification': 'PASS', 'signedNotarized': True,
                 'tag': 'latest', 'name': 'AGI_Fleet_Linux_v1.0.10.zip'}
        for field, value in cases.items():
            with self.subTest(field=field):
                release = self.published()
                release[field] = value
                with self.assertRaises(ValueError):
                    builder.mac_release_tokens(release, published=True)

    def test_opening_unpublished_gate_is_rejected(self):
        release = copy.deepcopy(self.release)
        release['operatorGate'] = 'OPEN_FOR_CONTROLLED_FRESH_INSTALL'
        with self.assertRaises(ValueError):
            builder.mac_release_tokens(release)

    def test_only_explicit_published_pointer_enables_published_classification(self):
        previous = builder.ROOT
        try:
            with tempfile.TemporaryDirectory() as directory:
                builder.ROOT = Path(directory)
                mac = builder.ROOT / 'macos'
                mac.mkdir()
                (mac / 'release.json').write_text(json.dumps(self.release))
                self.assertFalse(builder.read_mac_release()[1])
                (mac / 'published-release.json').write_text(json.dumps(self.published()))
                actual, published = builder.read_mac_release()
                self.assertTrue(published)
                self.assertEqual(actual['workflowRun'], '12345')
                (mac / 'published-release.json').unlink()
                (mac / 'published-release.json').symlink_to(mac / 'release.json')
                with self.assertRaises(ValueError):
                    builder.read_mac_release()
        finally:
            builder.ROOT = previous


if __name__ == '__main__':
    unittest.main()
