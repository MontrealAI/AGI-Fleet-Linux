import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import urllib.error
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
        manifest_path = self.output / 'Release-Manifest-v1.1.5.json'
        self.publisher.write(manifest_path, manifest)
        assets = [archive, evidence, manifest_path]
        sums = self.output / 'SHA256SUMS-v1.1.5.txt'
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
        self.tag_exists = self.release_exists = True
        self.main_commit = self.acceptance.commit
        self.main_responses = []
        self.main_reads = 0
        self.calls = []

    def api(self, path, token, **kwargs):
        method = kwargs.get('method', 'GET')
        self.calls.append((path, method))
        if path.endswith('/git/ref/heads/main'):
            self.main_reads += 1
            if self.main_responses:
                response = self.main_responses.pop(0)
                if isinstance(response, Exception):
                    raise response
                return response
            return {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': self.main_commit}}
        if '/git/ref/tags/' in path:
            if not self.tag_exists:
                raise urllib.error.HTTPError(path, 404, 'Not found', {}, None)
            return {'object': {'type': 'commit', 'sha': self.acceptance.commit}}
        if path.endswith('/git/refs') and method == 'POST':
            self.tag_exists = True
            self.assertEqual(json.loads(kwargs['data'])['sha'], self.acceptance.commit)
            return {'object': {'type': 'commit', 'sha': self.acceptance.commit}}
        if path.endswith('/releases') and method == 'POST':
            self.release_exists = True
            self.remote.update(json.loads(kwargs['data']), assets=[])
            return copy.deepcopy(self.remote)
        if '/assets?name=' in path and method == 'POST':
            data = kwargs['data']
            self.remote['assets'].append({'name': path.split('?name=', 1)[1], 'size': len(data),
                'digest': 'sha256:' + hashlib.sha256(data).hexdigest()})
            return copy.deepcopy(self.remote['assets'][-1])
        if method == 'PATCH':
            payload = json.loads(kwargs['data'])
            self.patches.append(payload)
            self.remote.update(payload)
            result = copy.deepcopy(self.remote)
            if self.returned_body is not None:
                result['body'] = self.returned_body
            return result
        if '/releases/tags/' in path:
            if not self.release_exists:
                raise urllib.error.HTTPError(path, 404, 'Not found', {}, None)
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
        self.main_commit = 'b' * 40
        self.publish()
        self.assertEqual(self.patches, [])
        self.assertEqual(self.main_reads, 0)
        self.assertFalse(any(method != 'GET' for _, method in self.calls))
        self.assertEqual(self.remote['body'], self.notes)

    def test_public_release_retry_still_rejects_changed_remote_assets(self):
        self.remote['draft'] = False
        self.main_commit = 'b' * 40
        self.remote['assets'][0]['digest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(ValueError, 'Existing asset differs'):
            self.publish()
        self.assertFalse(any(method != 'GET' for _, method in self.calls))

    def test_stale_run_cannot_reserve_a_fresh_release_tag(self):
        self.tag_exists = self.release_exists = False
        self.main_commit = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'exact current main'):
            self.publish()
        self.assertEqual(self.main_reads, 1)
        self.assertFalse(any(method != 'GET' for _, method in self.calls))

    def test_main_advance_after_reservation_keeps_the_release_private(self):
        self.tag_exists = self.release_exists = False
        self.main_responses = [
            {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': self.acceptance.commit}},
            {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': 'b' * 40}}]
        with self.assertRaisesRegex(ValueError, 'exact current main'):
            self.publish()
        self.assertTrue(self.tag_exists)
        self.assertEqual(self.main_reads, 2)
        self.assertTrue(self.remote['draft'])
        self.assertEqual(self.patches, [])

    def test_current_main_can_reserve_and_publish_the_exact_release(self):
        self.tag_exists = self.release_exists = False
        self.publish()
        self.assertEqual(self.main_reads, 2)
        self.assertFalse(self.remote['draft'])
        mutations = [(path, method) for path, method in self.calls if method != 'GET']
        self.assertTrue(mutations[0][0].endswith('/git/refs'))
        self.assertEqual(mutations[-1][1], 'PATCH')

    def test_existing_draft_cannot_be_published_from_a_superseded_main(self):
        self.main_commit = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'exact current main'):
            self.publish()
        self.assertTrue(self.remote['draft'])
        self.assertFalse(any(method != 'GET' for _, method in self.calls))

    def test_invalid_main_response_fails_closed_at_both_boundaries(self):
        invalid = [None, {}, {'object': {'type': 'commit', 'sha': self.acceptance.commit}},
            {'ref': 'refs/heads/other', 'object': {'type': 'commit', 'sha': self.acceptance.commit}},
            {'ref': 'refs/heads/main', 'object': {'type': 'tag', 'sha': self.acceptance.commit}},
            urllib.error.HTTPError('synthetic', 503, 'Unavailable', {}, None)]
        for reserve in (True, False):
            for response in invalid:
                with self.subTest(reserve=reserve, response=type(response).__name__):
                    self.tag_exists = self.release_exists = not reserve
                    self.main_responses = [response]
                    self.calls = []
                    with self.assertRaises((ValueError, urllib.error.HTTPError)):
                        self.publish()
                    self.assertTrue(self.remote['draft'])
                    self.assertFalse(any(method != 'GET' for _, method in self.calls))


if __name__ == '__main__':
    unittest.main()
