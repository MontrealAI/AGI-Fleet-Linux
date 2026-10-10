import copy
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
        self.metadata = {'version': '1.0.10', 'tag': 'v1.0.10-qualification', 'name': 'AGI_Fleet_Linux_v1.0.10.zip',
                         'bytes': 100, 'sha256': 'b' * 64, 'sourceRevisionSHA256': 'c' * 64}
        self.audit = {'status': 'PASS', 'releaseSHA256': 'b' * 64, 'sourceRevisionSHA256': 'c' * 64,
                      'workflowCommit': self.commit, 'productionQualified': False, 'physicalQualification': 'NOT_RUN',
                      'architectures': ['x64', 'arm64'], 'native': [], 'integration': []}
        for arch in self.audit['architectures']:
            common = {'architecture': arch, 'status': 'PASS', 'workflowCommit': self.commit, 'productionQualified': False}
            native = {**common, 'runs': {}}
            for scope, tests, files in [('targeted', 291, 25), ('complete', 3898, 342)]:
                native['runs'][scope] = {'status': 'PASS', 'verifiedLogs': files, 'counts': {'tests': tests, 'pass': tests,
                    'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}}
            self.audit['native'].append(native)
            self.audit['integration'].append({**common, 'standaloneIntegrationScripts': 8, 'managerTestsPassed': 777,
                'productionSourcesMatched': 11, 'contractArtifactsMatched': 11})

    def test_complete_candidate_can_be_prepared(self):
        publisher.validate(self.metadata, self.audit, self.commit)

    def test_incomplete_or_unrelated_acceptance_is_rejected(self):
        changes = [lambda a: a.update(workflowCommit='d' * 40), lambda a: a.update(productionQualified=True),
                   lambda a: a.update(native=a['native'][:1]), lambda a: a.update(integration=[]),
                   lambda a: a['native'][0]['runs']['complete']['counts'].update(skipped=1),
                   lambda a: a['integration'][0].update(managerTestsPassed=0),
                   lambda a: a.update(releaseSHA256='0' * 64), lambda a: a.update(sourceRevisionSHA256='0' * 64)]
        for change in changes:
            audit = copy.deepcopy(self.audit); change(audit)
            with self.subTest(change=change), self.assertRaises(ValueError):
                publisher.validate(self.metadata, audit, self.commit)


if __name__ == '__main__':
    unittest.main()
