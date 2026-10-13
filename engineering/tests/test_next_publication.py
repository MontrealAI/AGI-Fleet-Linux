import copy
import json
import os
import importlib.util
from pathlib import Path
import sys
import unittest

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
                      'verifiedTapLogs': 734, 'verifiedIntegrationLogs': 38,
                      'workflowCommit': self.commit, 'productionQualified': False, 'physicalQualification': 'NOT_RUN',
                      'architectures': ['x64', 'arm64'], 'native': [], 'integration': []}
        for arch in self.audit['architectures']:
            common = {'architecture': arch, 'status': 'PASS', 'workflowCommit': self.commit, 'workflowRun': self.run_id, 'productionQualified': False}
            native = {**common, 'runs': {}}
            for scope, tests, files in [('targeted', 291, 25), ('complete', 3898, 342)]:
                native['runs'][scope] = {'status': 'PASS', 'verifiedLogs': files, 'counts': {'tests': tests, 'pass': tests,
                    'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}}
            self.audit['native'].append(native)
            self.audit['integration'].append({**common, 'standaloneIntegrationScripts': 8, 'managerTestsPassed': 780,
                'managerCommit': self.metadata['integration']['commit'], 'verifiedLogs': 19,
                'productionSourcesMatched': 11, 'contractArtifactsMatched': 11})

    def test_complete_candidate_can_be_prepared(self):
        publisher.validate(self.metadata, self.audit, self.commit)

    def test_incomplete_or_unrelated_acceptance_is_rejected(self):
        changes = [lambda a: a.update(workflowCommit='d' * 40), lambda a: a.update(productionQualified=True),
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


if __name__ == '__main__':
    unittest.main()
