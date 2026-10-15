"""Synthetic environment/directory fixtures only; no GitHub or root action."""
from pathlib import Path
import os
import shlex
import prepare
import tempfile
import unittest
import runner_paths

class RunnerPathsTests(unittest.TestCase):
    def fixture(self,tmp):
        root=Path(tmp);workspace=root/'workspace';workspace.mkdir();temp=root/'temp';temp.mkdir()
        return {'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY':'MontrealAI/AGI-Fleet-Linux','RUNNER_ARCH':'X64','GITHUB_SHA':'a'*40,'GITHUB_WORKFLOW_SHA':'a'*40,'GITHUB_WORKSPACE':str(workspace),'RUNNER_TEMP':str(temp)}

    def test_fixed_derived_names_architecture_and_no_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=self.fixture(tmp)
            for arch,target in [('X64','linux-x64'),('ARM64','linux-arm64')]:
                env['RUNNER_ARCH']=arch;paths=runner_paths.runner_paths(env)
                self.assertEqual(paths['target'],target);self.assertEqual(paths['root'],env['RUNNER_TEMP']+'/fleet-alpha-fixed-'+target)
                self.assertEqual(paths['installationBase'],'/opt/agi-fleet-alpha');self.assertFalse(Path(paths['root']).exists())

    def test_approved_command_runner_retention_and_documented_paths_agree(self):
        with tempfile.TemporaryDirectory(prefix='synthetic path agreement ') as tmp:
            env=self.fixture(tmp)
            for arch in ('X64','ARM64'):
                env['RUNNER_ARCH']=arch;paths=runner_paths.runner_paths(env)
                report={'python':'/synthetic pinned python','pythonSha256':'a'*64,'nodeSha256':'b'*64,'harnessFiles':{},'fixtureSnapshotSha256':'c'*64,'expected':{'fixture':'SYNTHETIC_NOT_NATIVE'},'inputs':{},'fixtureLockSha256':'d'*64,'installation':'/opt/agi-fleet-alpha/'+paths['target']+'/'+'e'*64,'nativeTarget':paths['target']}
                packet=prepare.approval_packet(report,'f'*64,Path(paths['preparation']))
                command=shlex.split(packet['subsequentNonrootCommand'])
                approved=command[command.index('--evidence')+1]
                self.assertEqual(approved,paths['evidence'])
                self.assertEqual(packet['evidenceDirectory'],paths['evidence'])
                self.assertEqual(packet['reportPath'],str(Path(paths['evidence'])/'fixed-path.json'))
                self.assertEqual(paths['evidence'],str(Path(paths['root'])/'actual-evidence'))
                self.assertIn('EVIDENCE = ROOT/actual-evidence',(Path(__file__).parent/'WORKFLOW_PROPOSAL.md').read_text())
                self.assertFalse(Path(paths['root']).exists())

    def test_aliases_missing_roots_overlap_and_existing_destination_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=self.fixture(tmp);root=Path(tmp);(root/'alias').symlink_to(root/'workspace')
            for value in (str(root/'alias'),str(root/'alias/missing'),str(root/'workspace'),str(root/'workspace/new/../')):
                with self.assertRaises((ValueError,FileNotFoundError)):runner_paths.runner_paths({**env,'RUNNER_TEMP':value})
            (root/'temp/fleet-alpha-fixed-linux-x64').mkdir()
            with self.assertRaises(ValueError):runner_paths.runner_paths(env)

    def test_nonhosted_wrong_repository_moved_workflow_and_other_architecture_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=self.fixture(tmp)
            for key,value in [('GITHUB_ACTIONS','false'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_REPOSITORY','untrusted/fork'),('RUNNER_ARCH','RISCV64'),('GITHUB_SHA','main'),('GITHUB_WORKFLOW_SHA','b'*40)]:
                with self.assertRaises(ValueError):runner_paths.runner_paths({**env,key:value})

if __name__=='__main__':unittest.main()
