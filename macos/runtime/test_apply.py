import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / 'fleet'
SPEC = importlib.util.spec_from_file_location('mac_runtime_overlay', HERE / 'apply.py')
OVERLAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OVERLAY)


class RuntimeOverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='mac-runtime-overlay-test-')
        cls.stage = Path(cls.temporary.name) / 'fleet'
        shutil.copytree(SOURCE, cls.stage)
        cls.receipt = OVERLAY.apply(cls.stage, '1.20.2')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_staged_hashes_and_all_six_copies_match(self):
        for row in self.receipt['files']:
            self.assertEqual(hashlib.sha256((self.stage / row['path']).read_bytes()).hexdigest(), row['afterSHA256'])
        self.assertFalse(self.receipt['productionQualified'])
        for role in OVERLAY.ROLES:
            app = self.stage / 'packages' / ('AGI_' + role)
            self.assertIn('assertMacHost();', (app / 'scripts/setup-openclaw.mjs').read_text())
            self.assertIn('report.host=assertMacHost();', (app / 'scripts/qualify-mac.mjs').read_text())
            self.assertIn('strictCleanup:true', (app / 'scripts/qualify-mac.mjs').read_text())
            self.assertEqual((app / 'shared/runtime/compute/mac-host.mjs').read_bytes(), (HERE / 'mac-host.mjs').read_bytes())
            self.assertTrue((app / 'qualification/macos-clean-install.template.json').exists())

    def test_every_installer_uses_the_shared_decoder_and_preserves_argv(self):
        entries = [self.stage / 'scripts/setup-openclaw.mjs']
        entries += [self.stage / 'packages' / ('AGI_' + role) / 'scripts/setup-openclaw.mjs' for role in OVERLAY.ROLES]
        for entry in entries:
            text = entry.read_text()
            self.assertIn('file = setupFilePath(file,{argument:', text)
            self.assertNotIn('file.trim()', text)
            self.assertIn('.file != null}', text)
            result = subprocess.run(['node', '--check', str(entry)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        script = r'''
import assert from 'node:assert/strict';
const {readSetupArguments}=await import(process.argv[1]);
const {setupFilePath}=await import(process.argv[2]);
const prompted=readSetupArguments(['--standard-install']);
assert.equal(prompted.file,null);
assert.equal(setupFilePath('/Users/a/first\\ name.json',{argument:prompted.file!=null}),'/Users/a/first name.json');
const literal='/Users/a/literal\\(1).json',provided=readSetupArguments([literal,'--standard-install']);
assert.equal(setupFilePath(provided.file,{argument:provided.file!=null}),literal);
'''
        args = [str(self.stage / 'shared/runtime/compute' / name) for name in ('setup-ledger.mjs', 'setup-file-path.mjs')]
        result = subprocess.run(['node', '--input-type=module', '-e', script, *args], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(['node', '--test', str(self.stage / 'tests/macos-setup-file-path.test.mjs')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_installer_checks_host_before_setup_and_always_requires_cleanup(self):
        text = (self.stage / 'shared/runtime/compute/setup.mjs').read_text()
        self.assertLess(text.index("if(process.platform==='darwin')assertMacHost();"), text.index('const home=dependencies.home'))
        self.assertIn('desktopTest(run,docker,imageID,{strictCleanup:true})', text)

    def test_standard_cache_is_prepared_before_authority_and_review_without_weakening_validation(self):
        text = (self.stage / 'shared/runtime/compute/setup.mjs').read_text()
        prepare = text.index('(dependencies.preparePinnedControlUICache??preparePinnedControlUICache)')
        self.assertLess(prepare, text.index('c.standardOAuthAuthority=captureStandardOAuthAuthority'))
        self.assertLess(prepare, text.index('review=transaction.bindReview('))
        self.assertIn('transaction.candidate,runtime.artifact?.packageRoot', text)
        for name in ('setup-standard-authority.mjs', 'setup-runtime-materialization.mjs'):
            relative = Path('shared/runtime/compute') / name
            self.assertEqual((self.stage / relative).read_bytes(), (SOURCE / relative).read_bytes())
        for role in OVERLAY.ROLES:
            tests = self.stage / 'packages' / ('AGI_' + role) / 'tests'
            self.assertIn('delete f.dependencies.preparePinnedControlUICache;', (tests / 'setup-standard-lifecycle-fixture.mjs').read_text())
            self.assertIn("if(mode==='standard')preparePinnedControlUICache(tx.candidate,packageRoot);", (tests / 'setup-runtime-materialization.test.mjs').read_text())

    def test_actual_staged_desktop_check_rejects_failed_cleanup_and_records_success(self):
        module = (self.stage / 'packages/AGI_Agent/compute/setup-support.mjs').as_uri()
        script = """
import assert from 'node:assert/strict';
const {desktopCheck,safeDesktopReport}=await import(process.argv[1]);
const run=(mode)=>(file,args)=>args[0]==='run'?{status:0,stdout:JSON.stringify({schema:'agi-workstation-check/v3',passed:true})}:args[0]==='inspect'?{status:0,stdout:JSON.stringify({OOMKilled:false,ExitCode:0})}:args[0]==='rm'?{status:mode==='remove-fails'?1:0,stdout:''}:{status:0,stdout:mode==='remains'?'container-id':''};
for(const mode of ['remove-fails','remains'])assert.throws(()=>desktopCheck(run(mode),'docker','sha256:'+'a'.repeat(64),{strictCleanup:true}),/COMPUTE_SANDBOX_CLEANUP_FAILED/);
const result=desktopCheck(run('pass'),'docker','sha256:'+'a'.repeat(64),{strictCleanup:true});
assert.equal(result.passed,true);assert.equal(result.cleanup.exactContainerAbsent,true);assert.equal(safeDesktopReport(result).cleanup.removalConfirmed,true);
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script, module], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_signer_launchers_prepare_private_node_without_compute_install(self):
        for role in ('Agent', 'Node'):
            text = (self.stage / f'packages/AGI_{role}/AGI {role}.app/Contents/MacOS/start').read_text()
            self.assertIn('agi_standard_node', text)
            self.assertIn('check-mac-host.mjs', text)
            self.assertNotIn('official installer', text)
        for role in ('Employer', 'Moderator', 'Recovery', 'Evidence'):
            text = (self.stage / f'packages/AGI_{role}/Launch-AGI-{role}.command').read_text()
            self.assertIn('agi_standard_node', text)
            self.assertNotIn('setup-openclaw', text)

    def test_mac_app_instructions_have_no_ubuntu_actions(self):
        for role in ('Agent', 'Node'):
            text = (self.stage / f'packages/AGI_{role}/app/index.html').read_text()
            for obsolete in ['Fresh Ubuntu setup', 'Fresh Linux deployment', 'Transfer-Setup.sh', 'Prepare-Compute.sh', 'Linux systemd']:
                self.assertNotIn(obsolete, text)
            self.assertIn('/macos/docs/FRESH_INSTALL.md', text)

    def test_historical_qualification_and_linux_source_remain_unchanged(self):
        for name in ['release-gate.mjs', 'source-assessment.json', 'release-qualification-template.json']:
            self.assertEqual((self.stage / 'qualification' / name).read_bytes(), (SOURCE / 'qualification' / name).read_bytes())
        self.assertNotIn('assertMacHost', (SOURCE / 'shared/runtime/compute/setup.mjs').read_text())

    def test_reapplication_and_frozen_source_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'Overlay already applied'):
            OVERLAY.apply(self.stage, '1.20.2')
        with self.assertRaisesRegex(ValueError, 'Refusing to modify frozen'):
            OVERLAY.apply(SOURCE, '1.20.2')


if __name__ == '__main__':
    unittest.main()
