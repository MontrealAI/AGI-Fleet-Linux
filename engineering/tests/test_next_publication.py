import copy
import json
import os
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest import mock
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('next_publisher', Path(__file__).resolve().parents[1] / 'publish-next-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublicationAcceptance(unittest.TestCase):
    def setUp(self):
        self.commit = 'a' * 40
        self.run_id = os.environ.get('GITHUB_RUN_ID', '123')
        self.metadata = json.loads((publisher.ROOT / 'engineering/next-release.json').read_text())
        self.metadata.update(bytes=100, sha256='b' * 64, repositoryCommit=self.commit, workflowCommit=self.commit)
        self.audit = {'status': 'PASS', 'version': self.metadata['version'], 'releaseSHA256': 'b' * 64,
                      'sourceRevisionSHA256': self.metadata['sourceRevisionSHA256'],
                      'workflowRun': self.run_id, 'integrationTarget': self.metadata['integration'],
                      'verifiedTapLogs': 2 * sum(v['files'] for v in self.metadata['native'].values()), 'verifiedIntegrationLogs': 38,
                      'workflowCommit': self.commit, 'productionQualified': False, 'physicalQualification': 'NOT_RUN',
                      'architectures': ['x64', 'arm64'], 'native': [], 'integration': []}
        self.audit['successorAcceptance'] = {'status':'PASS','archiveSHA256':self.metadata['sha256'],'sourceRevisionSHA256':self.metadata['sourceRevisionSHA256'],'workflowCommit':self.commit,'workflowRun':self.run_id,'authority':'none'}
        for arch in self.audit['architectures']:
            common = {'architecture': arch, 'status': 'PASS', 'workflowCommit': self.commit, 'workflowRun': self.run_id, 'productionQualified': False}
            native = {**common, 'runs': {}}
            for scope, target in self.metadata['native'].items():
                tests, files = target['tests'], target['files']
                native['runs'][scope] = {'status': 'PASS', 'verifiedLogs': files, 'counts': {'tests': tests, 'pass': tests,
                    'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}}
            self.audit['native'].append(native)
            self.audit['integration'].append({**common, 'standaloneIntegrationScripts': 8, 'managerTestsPassed': 780,
                'managerCommit': self.metadata['integration']['commit'], 'verifiedLogs': 19,
                'productionSourcesMatched': 11, 'contractArtifactsMatched': 11})

    def test_complete_candidate_can_be_prepared(self):
        publisher.validate(self.metadata, self.audit, self.commit)

    def test_incomplete_or_unrelated_acceptance_is_rejected(self):
        changes = [lambda a: a.update(successorAcceptance={}), lambda a: a.update(workflowCommit='d' * 40), lambda a: a.update(productionQualified=True),
                   lambda a: a.update(native=a['native'][:1]), lambda a: a.update(integration=[]),
                   lambda a: a['native'][0]['runs']['complete']['counts'].update(skipped=1),
                   lambda a: a['integration'][0].update(managerTestsPassed=0),
                   lambda a: a['integration'][0].update(managerCommit='d' * 40),
                   lambda a: a['integration'][0].update(workflowRun='456'),
                   lambda a: a['native'][1].update(workflowRun='456'),
                   lambda a: a.update(verifiedTapLogs=0), lambda a: a.update(verifiedIntegrationLogs=0),
                   lambda a: a.update(integrationTarget={}), lambda a: a.update(version='1.0.10'),
                   lambda a: a.update(releaseSHA256='0' * 64), lambda a: a.update(sourceRevisionSHA256='0' * 64)]
        for change in changes:
            audit = copy.deepcopy(self.audit); change(audit)
            with self.subTest(change=change), self.assertRaises(ValueError):
                publisher.validate(self.metadata, audit, self.commit)

    def test_candidate_provenance_cannot_be_relabelled(self):
        for key, value in [('repositoryCommit', 'd' * 40), ('workflowCommit', 'd' * 40),
                           ('integration', {}), ('sourceFiles', 0), ('sourceRevisionSHA256', 'e' * 64)]:
            metadata = copy.deepcopy(self.metadata); metadata[key] = value
            with self.subTest(field=key), self.assertRaises(ValueError):
                publisher.validate(metadata, self.audit, self.commit)

    def test_published_guides_are_bound_to_the_validated_commit(self):
        source = publisher.ROOT / 'docs/RELEASE_NOTES_1_1_1.md'
        before = source.read_bytes()
        notes = publisher.publication_notes([], self.commit, self.run_id)
        for path in ('successor/docs/GUIDE.md', 'successor/docs/ARCHITECTURE.md',
                     'successor/docs/ACCEPTANCE.md', 'docs/FRESH_INSTALL.md'):
            self.assertIn(f'https://github.com/{publisher.REPOSITORY}/blob/{self.commit}/{path}', notes)
        self.assertNotIn('](../successor/', notes)
        self.assertNotIn('](FRESH_INSTALL.md)', notes)
        self.assertEqual(source.read_bytes(), before)

    def test_note_artifact_table_tracks_exact_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            asset = Path(temporary) / 'test.zip'; asset.write_bytes(b'fixture')
            notes = publisher.publication_notes([asset], self.commit, self.run_id)
            self.assertIn(f'| test.zip | 7 | `{publisher.sha(asset)}` |', notes)
            asset.write_bytes(b'changed')
            self.assertNotEqual(notes, publisher.publication_notes([asset], self.commit, self.run_id))

    def test_invalid_note_workflow_is_rejected(self):
        for run in (None, '', '0', '../latest', '1.2'):
            with self.subTest(run=run), self.assertRaises(ValueError):
                publisher.publication_notes([], self.commit, run)

    def test_changed_notes_stop_before_any_remote_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); release = root / 'release'; output = root / 'output'
            release.mkdir(); output.mkdir()
            metadata = copy.deepcopy(self.metadata)
            archive = release / metadata['name']; archive.write_bytes(b'archive fixture')
            metadata.update(bytes=archive.stat().st_size, sha256=publisher.sha(archive))
            audit = copy.deepcopy(self.audit); audit['releaseSHA256'] = metadata['sha256']
            audit['successorAcceptance']['archiveSHA256'] = metadata['sha256']
            evidence = output / 'evidence.zip'; evidence.write_bytes(b'evidence fixture')
            manifest = {'workflowCommit': self.commit, 'workflowRun': self.run_id,
                'sha256': metadata['sha256'], 'audit': audit,
                'evidence': {'name': evidence.name, 'sha256': publisher.sha(evidence)}}
            publisher.write(release / 'release.json', metadata)
            manifest_path = output / 'Release-Manifest-v1.1.1.json'; publisher.write(manifest_path, manifest)
            assets = [archive, evidence, manifest_path]
            (output / 'SHA256SUMS-v1.1.1.txt').write_text(''.join(publisher.sha(p) + '  ' + p.name + '\n' for p in assets))
            expected = publisher.publication_notes(assets, self.commit, self.run_id)
            (output / 'release-notes.md').write_text(expected + '\nUnreviewed instructions.\n')
            with mock.patch.dict(os.environ, {'GITHUB_SHA': self.commit, 'GITHUB_RUN_ID': self.run_id}):
                with self.assertRaisesRegex(ValueError, 'Release notes differ'):
                    publisher.publish(release, output)


if __name__ == '__main__':
    unittest.main()
