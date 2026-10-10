"""A planned Mac release must never become a download or production claim by accident."""
import copy
import hashlib
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
        candidate = {**self.release, 'schema': 'agi-macos-candidate-build/v1',
                     'bytes': 300_000_000, 'sha256': 'a' * 64, 'sourceRevisionSHA256': 'c' * 64, 'sourceFiles': 4900,
                     'repositoryCommit': 'b' * 40, 'workflowCommit': 'b' * 40,
                     'baseline': {'sha256': self.release['base']['sha256']},
                     'buildInputs': [{'path': 'macos/runtime/apply.py', 'sha256': '7' * 64}],
                     'archiveVerification': {'status': 'PASS', 'editions': 7}}
        metadata_sha = hashlib.sha256((json.dumps(candidate, indent=2, ensure_ascii=False) + '\n').encode('utf-8')).hexdigest()
        release = {**candidate, 'schema': 'agi-macos-published-release/v1',
                   'nativeAcceptance': 'PASS', 'jobIntegrationAcceptance': 'PASS',
                   'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL', 'repository': 'MontrealAI/AGI-Fleet-Linux',
                   'workflowRun': '12345'}
        common = {key: release[key] for key in ('repository', 'workflowCommit', 'workflowRun', 'platform',
                                               'architecture', 'productionQualified')}
        counts = {'tests': 4000, 'suites': 50, 'pass': 4000, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
        native = [{**common, 'status': 'PASS', 'runnerLabel': label, 'macOS': label.removeprefix('macos-') + '.0',
                   'physicalQualification': 'NOT_RUN', 'summarySHA256': 'd' * 64,
                   'systemNodeProvisioningSHA256': 'e' * 64,
                   'complete': {'status': 'PASS', 'counts': copy.deepcopy(counts), 'testFiles': 349,
                                'verifiedLogs': 349, 'verifiedSourceFiles': 4900,
                                'resultsSHA256': 'f' * 64, 'testedSourceSHA256': '1' * 64}}
                  for label in ('macos-15', 'macos-26')]
        integration = {**common, 'status': 'PASS', 'runnerLabel': 'macos-26', 'verifiedLogs': 19,
                       'standaloneIntegrationScripts': 8, 'managerTestsPassed': 777,
                       'productionSourcesMatched': 11, 'contractArtifactsMatched': 11,
                       'managerCommit': '191cf3590e5cdc08df1bb0af500ee28a91c8b010',
                       'summarySHA256': '2' * 64, 'currentManagerLifecycleSHA256': '3' * 64,
                       'filesystemSHA256': '4' * 64}
        audit = {key: release[key] for key in ('version', 'sourceRevisionSHA256', 'repository', 'workflowCommit',
                 'workflowRun', 'nativeAcceptance', 'jobIntegrationAcceptance', 'operatorGate',
                 'physicalQualification', 'productionQualified', 'signedNotarized')}
        audit.update({'schema': 'agi-macos-independent-audit/v1', 'status': 'PASS', 'releaseSHA256': release['sha256'],
                      'releaseBytes': release['bytes'], 'releaseMetadataSHA256': metadata_sha, 'native': native,
                      'integration': integration, 'verifiedTapLogs': 698, 'verifiedIntegrationLogs': 19})
        return {**release, 'audit': audit, 'evidence': {'name': 'macOS-Qualification-Evidence-v1.20.0.zip',
                                                     'bytes': 1234567, 'sha256': '6' * 64}}

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
        cases = {'nativeAcceptance': 'NOT_RUN', 'jobIntegrationAcceptance': 'NOT_RUN', 'operatorGate': 'CLOSED_PENDING_NATIVE_ACCEPTANCE',
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


    def test_candidate_or_spec_cannot_be_promoted_by_setting_pass_fields(self):
        for schema in ('agi-macos-candidate-build/v1', 'agi-macos-release-specification/v1'):
            release = self.published()
            release['schema'] = schema
            with self.subTest(schema=schema), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)
        with self.assertRaises(ValueError):
            builder.mac_release_tokens(self.published(), published=False)

    def test_metadata_paths_require_their_exact_schema(self):
        previous = builder.ROOT
        try:
            with tempfile.TemporaryDirectory() as directory:
                builder.ROOT = Path(directory)
                mac = builder.ROOT / 'macos'
                mac.mkdir()
                specification = mac / 'release.json'
                pointer = mac / 'published-release.json'
                for schema in ('agi-macos-candidate-build/v1', 'agi-macos-published-release/v1'):
                    specification.write_text(json.dumps({**self.release, 'schema': schema}))
                    with self.subTest(path='specification', schema=schema), self.assertRaises(ValueError):
                        builder.read_mac_release()
                specification.write_text(json.dumps(self.release))
                for schema in ('agi-macos-candidate-build/v1', 'agi-macos-release-specification/v1'):
                    pointer.write_text(json.dumps({**self.published(), 'schema': schema}))
                    with self.subTest(path='published', schema=schema), self.assertRaises(ValueError):
                        builder.read_mac_release()
        finally:
            builder.ROOT = previous

    def test_publication_requires_the_evidence_archive_and_independent_audit(self):
        for field in ('evidence', 'audit', 'repository', 'sourceRevisionSHA256', 'sourceFiles', 'jobIntegrationAcceptance'):
            release = self.published()
            del release[field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)
        for field, value in {'name': 'other.zip', 'bytes': 450_000_000, 'sha256': 'bad'}.items():
            release = self.published()
            release['evidence'][field] = value
            with self.subTest(evidence=field), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)

    def test_audit_cannot_describe_another_release_or_workflow(self):
        for field, value in {'schema': 'candidate', 'status': 'NOT_RUN', 'releaseSHA256': '7' * 64,
                             'releaseBytes': 1, 'sourceRevisionSHA256': '8' * 64, 'workflowCommit': '9' * 40,
                             'workflowRun': '999', 'repository': 'someone/else', 'productionQualified': True,
                             'jobIntegrationAcceptance': 'NOT_RUN'}.items():
            release = self.published()
            release['audit'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)

    def test_both_native_versions_need_matching_complete_passing_suites(self):
        changes = [lambda audit: audit['native'].pop(),
                   lambda audit: audit['native'][1].update(runnerLabel='macos-15'),
                   lambda audit: audit['native'][0].update(workflowRun='999'),
                   lambda audit: audit['native'][0]['complete'].update(verifiedSourceFiles=1),
                   lambda audit: audit['native'][0]['complete']['counts'].update(skipped=1),
                   lambda audit: audit['native'][0]['complete']['counts'].update(tests=4001, **{'pass': 4001}),
                   lambda audit: audit.update(verifiedTapLogs=1)]
        for index, change in enumerate(changes):
            release = self.published()
            change(release['audit'])
            with self.subTest(case=index), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)

    def test_stale_audit_cannot_accept_changed_candidate_metadata(self):
        changes = [lambda release: release['buildInputs'][0].update(sha256='8' * 64),
                   lambda release: release['archiveVerification'].update(editions=6),
                   lambda release: release['base'].update(sha256='9' * 64),
                   lambda release: release['baseline'].update(sha256='0' * 64),
                   lambda release: release.update(nodeVersion='24.99.0'),
                   lambda release: release.update(unreviewedMetadata=True),
                   lambda release: release.pop('buildInputs'),
                   lambda release: release['audit'].update(releaseMetadataSHA256='5' * 64)]
        for index, change in enumerate(changes):
            release = copy.deepcopy(self.published())
            change(release)
            with self.subTest(case=index), self.assertRaisesRegex(ValueError, 'audit metadata digest differs'):
                builder.mac_release_tokens(release, published=True)

    def test_native_pass_without_complete_integration_and_lifecycle_is_rejected(self):
        cases = {'status': 'NOT_RUN', 'runnerLabel': 'macos-15', 'workflowRun': '999',
                 'standaloneIntegrationScripts': 7, 'managerTestsPassed': 776, 'verifiedLogs': 18,
                 'currentManagerLifecycleSHA256': '', 'filesystemSHA256': '', 'contractArtifactsMatched': 10}
        for field, value in cases.items():
            release = self.published()
            release['audit']['integration'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                builder.mac_release_tokens(release, published=True)


if __name__ == '__main__':
    unittest.main()
