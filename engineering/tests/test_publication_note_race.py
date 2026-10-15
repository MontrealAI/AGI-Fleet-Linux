import copy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_next_publication as acceptance


class PublicationNoteRaceTests(unittest.TestCase):
    def setUp(self):
        self.acceptance = acceptance.PublicationAcceptance()
        self.acceptance.setUp()
        self.publisher = acceptance.publisher
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.release = root / 'release'; self.output = root / 'output'
        self.release.mkdir(); self.output.mkdir()
        metadata = copy.deepcopy(self.acceptance.metadata)
        archive = self.release / metadata['name']; archive.write_bytes(b'archive fixture')
        metadata.update(bytes=archive.stat().st_size, sha256=self.publisher.sha(archive))
        audit = copy.deepcopy(self.acceptance.audit)
        audit['releaseSHA256'] = metadata['sha256']
        audit['successorAcceptance']['archiveSHA256'] = metadata['sha256']
        for row in audit['contractProfiles']:
            row['archiveSHA256'] = metadata['sha256']
        evidence = self.output / 'evidence.zip'; evidence.write_bytes(b'evidence fixture')
        manifest = {'workflowCommit': self.acceptance.commit, 'workflowRun': self.acceptance.run_id,
            'sha256': metadata['sha256'], 'audit': audit,
            'evidence': {'name': evidence.name, 'sha256': self.publisher.sha(evidence)}}
        self.publisher.write(self.release / 'release.json', metadata)
        manifest_path = self.output / 'Release-Manifest-v1.1.3.json'
        self.publisher.write(manifest_path, manifest)
        assets = [archive, evidence, manifest_path]
        sums = self.output / 'SHA256SUMS-v1.1.3.txt'
        sums.write_text(''.join(self.publisher.sha(p) + '  ' + p.name + '\n' for p in assets))
        self.notes = self.publisher.publication_notes(assets, self.acceptance.commit, self.acceptance.run_id)
        (self.output / 'release-notes.md').write_text(self.notes)
        self.remote = {'id': 123, 'draft': True, 'prerelease': True,
            'target_commitish': self.acceptance.commit, 'body': self.notes,
            'html_url': 'https://github.com/example/repo/releases/tag/test',
            'assets': [{'name': p.name, 'size': p.stat().st_size,
                'digest': 'sha256:' + self.publisher.sha(p)} for p in assets + [sums]]}
        self.patches = []
        self.concurrent_body = None
        self.returned_body = None

    def api(self, path, token, **kwargs):
        method = kwargs.get('method', 'GET')
        if '/git/ref/tags/' in path:
            return {'object': {'type': 'commit', 'sha': self.acceptance.commit}}
        if method == 'PATCH':
            payload = json.loads(kwargs['data'])
            self.patches.append(payload)
            self.remote.update(payload)
            result = copy.deepcopy(self.remote)
            if self.returned_body is not None:
                result['body'] = self.returned_body
            return result
        if '/releases/tags/' in path:
            return copy.deepcopy(self.remote)
        if path.endswith('/releases/123'):
            checked_snapshot = copy.deepcopy(self.remote)
            if self.concurrent_body is not None:
                self.remote['body'] = self.concurrent_body
            return checked_snapshot
        raise AssertionError('Unexpected remote action: ' + method + ' ' + path)

    def publish(self):
        remote_module = SimpleNamespace(api=self.api)
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
        environment = {'GITHUB_SHA': self.acceptance.commit,
            'GITHUB_RUN_ID': self.acceptance.run_id, 'GH_TOKEN': 'synthetic-test-token'}
        with mock.patch.dict(os.environ, environment), \
             mock.patch.object(self.publisher.importlib.util, 'spec_from_file_location', return_value=spec), \
             mock.patch.object(self.publisher.importlib.util, 'module_from_spec', return_value=remote_module), \
             mock.patch('sys.stdout', new_callable=io.StringIO):
            self.publisher.publish(self.release, self.output)

    def test_concurrent_draft_edit_cannot_replace_canonical_publication(self):
        self.concurrent_body = 'Changed after the checked GET'
        self.publish()
        self.assertEqual(len(self.patches), 1)
        self.assertEqual(self.patches[0]['body'], self.notes)
        self.assertEqual(self.remote['body'], self.notes)
        self.assertFalse(self.remote['draft'])

    def test_publication_response_body_mismatch_is_not_reported_successful(self):
        self.returned_body = 'Unexpected publication response body'
        with self.assertRaisesRegex(ValueError, 'Published release notes differ'):
            self.publish()
        self.assertEqual(self.patches[0]['body'], self.notes)

    def test_prior_unreviewed_draft_edit_is_rejected_before_publication(self):
        self.remote['body'] = 'Changed before the checked GET'
        with self.assertRaisesRegex(ValueError, 'Remote release notes differ'):
            self.publish()
        self.assertEqual(self.patches, [])

    def test_matching_already_published_release_is_not_mutated(self):
        self.remote['draft'] = False
        self.publish()
        self.assertEqual(self.patches, [])
        self.assertEqual(self.remote['body'], self.notes)


if __name__ == '__main__':
    unittest.main()
