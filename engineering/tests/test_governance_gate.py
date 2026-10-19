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
  self.assertIn('needs: [build, native, integration, profile-integration, successor, audit]',aggregate)
  self.assertIn('needs: [build, native, integration, profile-integration, successor, audit, qualification-gate]',jobs.split('\n  publish:',1)[1])

 def test_profile_gate_keeps_two_architectures_same_archive_and_no_root(self):
  workflow=(ROOT/'.github/workflows/next-release.yml').read_text()
  profile=workflow.split('\n  profile-integration:',1)[1].split('\n  audit:',1)[0]
  self.assertIn('runner: ubuntu-24.04, arch: x64',profile)
  self.assertIn('runner: ubuntu-24.04-arm, arch: arm64',profile)
  self.assertIn('- *download_candidate',profile)
  self.assertIn('baseline.install_node(root)',profile)
  self.assertIn('CONTRACT_PROFILE: ${{ matrix.profile }}',profile)
  self.assertIn("CONTRACT_PROFILES[os.environ['CONTRACT_PROFILE']]",profile)
  self.assertIn('--contract-profile "$CONTRACT_PROFILE"',profile)
  self.assertNotIn('sudo',profile)
  for profile_id in ['manager-1.17.0-b7218196','manager-1.19.3-d0c2cbaf']:
   for runner,arch in [('ubuntu-24.04','x64'),('ubuntu-24.04-arm','arm64')]:
    self.assertIn('runner: '+runner+', arch: '+arch+', profile: '+profile_id,profile)
    self.assertIn('--profile evidence/next-profile-'+profile_id+'-'+arch,workflow)

 def test_local_skills_requalifies_packaged_fleet_changes(self):
  workflow=(ROOT/'.github/workflows/local-skills.yml').read_text()
  pull_request=workflow.split('  pull_request:',1)[1].split('  push:',1)[0]
  self.assertIn("'fleet/**'",pull_request)
  self.assertIn("'local-runtime/**'",pull_request)
