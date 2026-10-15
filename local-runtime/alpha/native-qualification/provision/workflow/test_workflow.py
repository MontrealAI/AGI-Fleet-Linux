"""SYNTHETIC SOURCE TESTS ONLY. No fetch, install, extraction, sudo or payload.

Real commit labels identify the proposal; all environments and transfer bytes are
synthetic. Execution/network adapters below are always mocked.
"""
import ast
import io
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.error
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import driver as d

HERE = Path(__file__).resolve().parent
SYNTHETIC = b'SYNTHETIC_NOT_NATIVE_QUALIFICATION'


class WorkflowTests(unittest.TestCase):
    def environment(self, tmp, target='linux-x64'):
        base = Path(tmp)
        for name in ('workspace', 'temporary'):
            (base/name).mkdir()
        return {'GITHUB_ACTIONS':'true', 'RUNNER_ENVIRONMENT':'github-hosted', 'GITHUB_REPOSITORY':d.REPOSITORY,
                'GITHUB_EVENT_NAME':'workflow_dispatch', 'GITHUB_RUN_ATTEMPT':'1', 'GITHUB_RUN_ID':'123',
                'GITHUB_SHA':'a'*40, 'GITHUB_WORKFLOW_SHA':'a'*40, 'GITHUB_REF':'refs/heads/synthetic-review',
                'GITHUB_WORKFLOW_REF':d.REPOSITORY+'/'+str(d.LIVE_WORKFLOW)+'@refs/heads/synthetic-review',
                'GITHUB_WORKSPACE':str(base/'workspace'), 'RUNNER_TEMP':str(base/'temporary'),
                'RUNNER_ARCH':'X64' if target=='linux-x64' else 'ARM64', 'FLEET_MATRIX_TARGET':target}

    def context(self, tmp):
        with patch.object(d.os,'geteuid',return_value=1000):
            c=d.paths(self.environment(tmp))
        c['root'].mkdir()
        for name in ('public','private','evidence','preparation'):
            c[name].mkdir()
        return c

    def test_exact_separate_source_constants_and_inert_location(self):
        self.assertEqual(d.HARNESS_COMMIT,'6bbf81c68001bb8262f4df9e300d27b5ab8e5993')
        self.assertEqual(d.HARNESS_TREE,'566b30a0abcad4d98af17a28447340cc81627245')
        self.assertEqual(d.RUNTIME_COMMIT,'2d5d62369d57db9abc9f622ccb4781e6cccd90d2')
        self.assertEqual(d.RUNTIME_TREE,'7c52bc0cdd85b87f2219b46b6be6caeafa136b43')
        self.assertNotEqual(d.HARNESS_COMMIT,d.RUNTIME_COMMIT)
        self.assertNotIn('.github/workflows',str(d.PROPOSAL))

    def test_paths_are_derived_for_both_architectures_without_writes(self):
        for target in ('linux-x64','linux-arm64'):
            with tempfile.TemporaryDirectory(prefix='synthetic workflow paths ') as tmp,patch.object(d.os,'geteuid',return_value=1000):
                c=d.paths(self.environment(tmp,target))
                self.assertEqual(c['source'],c['root']/'source')
                self.assertEqual(c['evidence'],c['root']/'actual-evidence')
                self.assertEqual(c['retained'],c['root']/'retained')
                self.assertFalse(c['root'].exists());self.assertFalse(c['harnessSource'].exists())
                self.assertFalse(c['harnessSource'].is_relative_to(c['root']))

    def test_invalid_context_rerun_and_workflow_substitution_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d.os,'geteuid',return_value=1000):
            env=self.environment(tmp)
            for key,value in [('GITHUB_ACTIONS','false'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_REPOSITORY','fork/name'),('GITHUB_EVENT_NAME','pull_request'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_RUN_ID','0'),('GITHUB_SHA','main'),('GITHUB_WORKFLOW_SHA','b'*40),('GITHUB_WORKFLOW_REF','other'),('RUNNER_ARCH','PPC'),('FLEET_MATRIX_TARGET','linux-arm64')]:
                with self.subTest(key=key),self.assertRaises(ValueError):d.paths({**env,key:value})
            with patch.object(d.os,'geteuid',return_value=0),self.assertRaises(ValueError):d.paths(env)

    def test_runner_and_nested_output_symlink_aliases_refused(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d.os,'geteuid',return_value=1000):
            env=self.environment(tmp);base=Path(tmp);(base/'alias').symlink_to(base/'temporary')
            with self.assertRaises(ValueError):d.paths({**env,'RUNNER_TEMP':str(base/'alias')})
            c=d.paths(env);c['root'].mkdir();(c['root']/'retained').symlink_to(base/'workspace')
            with self.assertRaises(ValueError):d.paths(env)

    def test_overlapping_and_writable_runner_roots_refused(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(d.os,'geteuid',return_value=1000):
            env=self.environment(tmp)
            with self.assertRaises(ValueError):d.paths({**env,'RUNNER_TEMP':env['GITHUB_WORKSPACE']})
            Path(env['RUNNER_TEMP']).chmod(0o777)
            with self.assertRaises(ValueError):d.paths(env)

    def test_exact_checkout_commit_tree_and_cleanliness(self):
        for answers in (['wrong','tree',''],['commit','wrong',''],['commit','tree',' M file']):
            with patch.object(d,'git',side_effect=answers),self.assertRaises(ValueError):d.verify_checkout(Path('/synthetic'),'commit','tree')
        with patch.object(d,'git',side_effect=['commit','tree','']):self.assertEqual(d.verify_checkout(Path('/synthetic'),'commit','tree'),'tree')

    def test_live_workflow_must_match_the_reviewed_source_bytes(self):
        with patch.object(d,'verify_checkout',return_value='tree'),patch.object(d,'read',side_effect=[b'changed',b'proposal']),self.assertRaises(ValueError):
            d.workflow_identity({'workspace':Path('/synthetic'),'workflowCommit':'a'*40})

    def test_implementation_inventory_and_hashes_are_exact(self):
        d.verify_implementation(HERE)
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            manifest=json.loads((HERE/'implementation.json').read_text())
            for name in manifest['filesSha256']:(directory/name).write_bytes((HERE/name).read_bytes())
            (directory/'implementation.json').write_text(json.dumps(manifest))
            (directory/'driver.py').write_text('SYNTHETIC_CHANGED_SOURCE')
            with self.assertRaises(ValueError):d.verify_implementation(directory)
            manifest['filesSha256'].pop('driver.py')
            (directory/'implementation.json').write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):d.verify_implementation(directory)

    def test_child_environments_never_inherit_token_or_runtime_options(self):
        env=d.clean_env({'PATH':'/usr/bin','HOME':'/synthetic','GH_TOKEN':'secret','GITHUB_TOKEN':'secret','NODE_OPTIONS':'--import evil','PYTHONPATH':'evil','NPM_CONFIG_REGISTRY':'evil'})
        self.assertEqual(set(env),{'PATH','HOME','PYTHONDONTWRITEBYTECODE','GIT_TERMINAL_PROMPT'})
        self.assertNotIn('secret',str(env))

    def test_fixed_prerequisite_command_scope_contains_no_weakening(self):
        c={'source':Path('/synthetic exact source')};commands=d.prerequisite_commands(c,Path('/synthetic/python'))
        self.assertEqual(commands,[('apt-update',['sudo','apt-get','update']),('apt-install',['sudo','apt-get','install','-y','bubblewrap','util-linux','apparmor-profiles','binutils']),('host-policy',['sudo',d.PRESERVE,'/synthetic/python','-B','/synthetic exact source/local-runtime/prepare-engineering-host.py'])])
        for forbidden in ('sysctl','chmod','chown','rm','upgrade','--disable'):
            self.assertNotIn(forbidden,[part for _,argv in commands for part in argv])

    def test_storage_redirect_restrictions(self):
        self.assertEqual(d.artifact_redirect('https://synthetic.blob.core.windows.net/a?signature=synthetic'),'https://synthetic.blob.core.windows.net/a?signature=synthetic')
        for url in ('http://synthetic.blob.core.windows.net/a','https://evil.example/a','https://evil.blob.core.windows.net.evil.example/a','https://user:pass@synthetic.blob.core.windows.net/a','https://synthetic.blob.core.windows.net:444/a'):
            with self.assertRaises(ValueError):d.artifact_redirect(url)

    def test_synthetic_api_redirect_strips_credential(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake=Mock();fake.open.side_effect=[urllib.error.HTTPError('synthetic',302,'redirect',{'Location':'https://synthetic.blob.core.windows.net/a?signature=fixture'},None),io.BytesIO(SYNTHETIC)]
            with patch.object(d.urllib.request,'build_opener',return_value=fake):
                d.download('https://api.github.com/repos/'+d.REPOSITORY+'/actions/artifacts/123/zip',Path(tmp)/'synthetic',d.digest(SYNTHETIC),len(SYNTHETIC),'SYNTHETIC_TOKEN')
            first,second=(call.args[0] for call in fake.open.call_args_list)
            self.assertEqual(first.get_header('Authorization'),'Bearer SYNTHETIC_TOKEN')
            self.assertIsNone(second.get_header('Authorization'))

    def test_synthetic_transfer_hash_length_and_token_destination_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            for i,(sha,length) in enumerate([('f'*64,len(SYNTHETIC)),(d.digest(SYNTHETIC),1),(d.digest(SYNTHETIC),len(SYNTHETIC)+1)]):
                fake=Mock();fake.open.return_value=io.BytesIO(SYNTHETIC)
                with patch.object(d.urllib.request,'build_opener',return_value=fake),self.assertRaises(ValueError):d.download('https://nodejs.org/synthetic',Path(tmp)/str(i),sha,length)
            with patch.object(d.urllib.request,'build_opener') as opener,self.assertRaises(ValueError):d.download('https://untrusted.example/',Path(tmp)/'never',d.digest(SYNTHETIC),token='synthetic')
            opener.assert_not_called()

    def test_node_archive_member_parser_permits_internal_npm_link_only(self):
        root='node-v24.21.0-linux-x64';regular=tarfile.TarInfo(root+'/bin/node');regular.size=10
        link=tarfile.TarInfo(root+'/bin/npm');link.type=tarfile.SYMTYPE;link.linkname='../lib/node_modules/npm/bin/npm-cli.js'
        self.assertEqual(d.check_node_members([regular,link],'linux-x64'),root)
        for name,kind,target in [(root+'/../escape',tarfile.REGTYPE,''),(root+'/bin/link',tarfile.SYMTYPE,'../../outside'),(root+'/bin/link',tarfile.SYMTYPE,'/etc/passwd'),(root+'/bin/link',tarfile.LNKTYPE,'bin/node'),('other/file',tarfile.REGTYPE,'')]:
            m=tarfile.TarInfo(name);m.type=kind;m.linkname=target
            with self.assertRaises(ValueError):d.check_node_members([m],'linux-x64')
        regular.size=512_000_001
        with self.assertRaises(ValueError):d.check_node_members([regular],'linux-x64')

    def test_public_retention_never_recurses_into_private_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(tmp)
            (c['public']/'stage-qualify.json').write_text('{"status":"FAILED"}')
            (c['public']/'unlisted-secret.txt').write_text('PRIVATE')
            (c['evidence']/'fixed-path.json').write_text('{"status":"FAILED","productionQualified":false}')
            (c['evidence']/'drift.json').write_text('{"token":"PRIVATE"}')
            (c['evidence']/'state-0').mkdir();(c['evidence']/'state-0/runtime.db').write_text('PRIVATE')
            (c['private']/'qualify.log').write_text('PRIVATE')
            d.collect(c)
            self.assertEqual({p.name for p in c['retained'].iterdir()},{'stage-qualify.json','actual-fixed-path.json','retention.json'})
            self.assertNotIn('PRIVATE',''.join(p.read_text() for p in c['retained'].iterdir()))
            self.assertTrue((c['evidence']/'drift.json').exists())
            with self.assertRaises(ValueError):d.collect(c)

    def test_partial_secret_and_symlink_reports_are_excluded_but_failure_receipts_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(tmp)
            (c['public']/'stage-qualify.json').write_text('{"status":"FAILED"}')
            (c['evidence']/'fixed-path.json').write_text('{"token":"PRIVATE"}')
            (c['evidence']/'attempt-0.json').write_text('{incomplete')
            (c['evidence']/'attempt-1.json').symlink_to(c['public']/'stage-qualify.json')
            d.collect(c)
            retained=json.loads((c['retained']/'retention.json').read_text())
            self.assertEqual(len(retained['excludedPartialReports']),3)
            self.assertEqual({p.name for p in c['retained'].iterdir()},{'stage-qualify.json','retention.json'})

    def test_secret_keys_are_refused_at_any_depth(self):
        for key in ('token','clientToken','password','Authorization','secret'):
            with self.assertRaises(ValueError):d.reject_secrets({'nested':[{'more':{key:'synthetic'}}]})
        d.reject_secrets({'authority':'none','productionQualified':False})

    def test_run_adapter_records_failure_without_token_or_raw_log_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(tmp)
            with patch.object(d.subprocess,'run',return_value=Mock(returncode=2)) as run,self.assertRaises(ValueError):d.run(c,'qualify',['/synthetic/python','/synthetic/run.py'])
            call=run.call_args
            self.assertNotIn('GH_TOKEN',call.kwargs['env'])
            record=json.loads((c['public']/'command-qualify.json').read_text())
            self.assertEqual(record['exitStatus'],2)
            self.assertTrue((c['private']/'qualify.log').exists())

    def test_command_packet_must_match_frozen_generator_and_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(tmp)
            expected={'fixture':'SYNTHETIC_ONLY'}
            report={'expected':expected,'installation':'/opt/agi-fleet-alpha/linux-x64/'+'a'*64}
            packet={'privilegedCommand':'sudo /synthetic/python -B /synthetic/privileged.py','subsequentNonrootCommand':'/synthetic/python -B /synthetic/run.py'}
            (c['preparation']/'preparation.json').write_text('{}')
            (c['preparation']/'approval.json').write_text(json.dumps(packet))
            frozen=Mock();frozen.REVIEWED_EXPECTATION=expected;frozen.approval_packet.return_value=packet
            verifier=Mock();verifier.verify_preparation.return_value=report
            with patch.object(d,'harness',return_value=frozen),patch.object(d,'runtime_identity'),patch.object(d,'node_path'),patch.object(d,'python_identity'),patch.object(d,'references',return_value={'targets':{c['target']:{'installation':report['installation']}}}),patch.object(d.importlib,'import_module',return_value=verifier):
                root,normal=d.approved_commands(c)
                self.assertEqual(root[0],'sudo');self.assertNotIn('sudo',normal)
                (c['preparation']/'approval.json').write_text(json.dumps({**packet,'privilegedCommand':'sudo /unreviewed'}))
                with self.assertRaises(ValueError):d.approved_commands(c)

    def test_python_changes_are_refused_before_privilege(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(tmp)
            (c['public']/'invocation.json').write_text(json.dumps({'python':str(Path(sys.executable).resolve()),'pythonSha256':'f'*64}))
            with self.assertRaises(ValueError):d.python_identity(c)

    def test_yaml_has_no_inputs_write_permissions_cleanup_or_unpinned_actions(self):
        source=(HERE/'alpha-fixed-path.workflow.yml').read_text()
        self.assertIn('on:\n  workflow_dispatch:\npermissions:\n  contents: read\n  actions: read',source)
        self.assertNotIn('inputs:',source);self.assertNotIn('pull_request:',source)
        self.assertNotIn('write',source.replace('without credentials',''))
        uses=re.findall(r'uses: (\S+)',source)
        self.assertEqual(uses,['actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'])
        self.assertIn("if: always() && steps.collect.outcome == 'success'",source)
        self.assertIn('/retained/',source);self.assertNotIn('/actual-evidence/',source)
        self.assertNotIn('continue-on-error',source);self.assertNotIn('rm -',source)
        self.assertIn('cancel-in-progress: false',source)
        self.assertEqual(source.count('GH_TOKEN:'),1)

    def test_yaml_bootstrap_and_all_python_files_are_syntactically_valid(self):
        source=(HERE/'alpha-fixed-path.workflow.yml').read_text()
        bootstrap=source.split("python3 -B - <<'PY'\n",1)[1].split('\n          PY\n',1)[0]
        ast.parse('\n'.join(line[10:] for line in bootstrap.splitlines()))
        for file in HERE.glob('*.py'):ast.parse(file.read_text())


if __name__=='__main__':unittest.main()
