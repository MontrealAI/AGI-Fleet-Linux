import copy,importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('children',ROOT/'engineering/governance/check_children.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class GovernanceGate(unittest.TestCase):
 def test_all_required_children_succeed(self):self.assertEqual(m.verify({k:{'result':'success'} for k in m.REQUIRED})['status'],'PASS')
 def test_missing_failed_cancelled_skipped_and_extra_children_fail(self):
  base={k:{'result':'success'} for k in m.REQUIRED}
  for name in m.REQUIRED:
   for state in ['failure','cancelled','skipped',None]:
    value=copy.deepcopy(base);value[name]['result']=state
    with self.subTest(name=name,state=state),self.assertRaises(ValueError):m.verify(value)
  for change in [lambda x:x.pop('audit'),lambda x:x.update(untrusted={'result':'success'})]:
   value=copy.deepcopy(base);change(value)
   with self.assertRaises(ValueError):m.verify(value)
 def test_policy_requires_reviews_and_protects_admin_force_push_deletion(self):
  p=json.loads((ROOT/'engineering/governance/main-protection.json').read_text());self.assertTrue(p['enforce_admins']);self.assertFalse(p['allow_force_pushes']);self.assertFalse(p['allow_deletions']);self.assertTrue(p['required_pull_request_reviews']['require_last_push_approval']);self.assertGreaterEqual(p['required_pull_request_reviews']['required_approving_review_count'],1)

 def test_aggregate_is_a_job_and_dispatch_keeps_its_boolean_input(self):
  workflow=(ROOT/'.github/workflows/next-release.yml').read_text()
  triggers,jobs=workflow.split('\njobs:\n',1)
  self.assertNotIn('qualification-gate:',triggers)
  self.assertNotIn('runs-on:',triggers)
  self.assertIn('  pull_request:\n',triggers)
  self.assertNotIn('    paths:',triggers.split('  pull_request:',1)[1].split('  push:',1)[0])
  self.assertIn('  workflow_dispatch:\n    inputs:\n      publish:',triggers)
  self.assertEqual(jobs.count('\n  qualification-gate:'),1)
  aggregate=jobs.split('\n  qualification-gate:',1)[1].split('\n  publish:',1)[0]
  self.assertIn('    if: always()',aggregate)
  self.assertIn('needs: [build, native, integration, successor, audit]',aggregate)
  self.assertIn('needs: [build, native, integration, successor, audit, qualification-gate]',jobs.split('\n  publish:',1)[1])
