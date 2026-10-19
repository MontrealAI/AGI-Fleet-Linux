import importlib.util
import importlib
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('source_guard',Path(__file__).with_name('source_guard.py'))
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)


class SourceGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.root=Path(self.directory.name)
        subprocess.run(['git','init','--quiet',str(self.root)],check=True)
        self.sources=self.root/'sources';self.sources.mkdir();self.file=self.sources/'module.py';self.file.write_text('VALUE=1\n')
        self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Synthetic source guard fixture')
    def tearDown(self):self.directory.cleanup()
    def git(self,*arguments):return subprocess.check_output(['git',*arguments],cwd=self.root)
    def check(self):return guard.verify_tree(self.root,[('sources',True)])
    def sdk(self):
        package=self.root/'alpha_factory_v1';package.mkdir()
        for name,raw in {'__init__.py':'','companion.py':'VALUE=1\n',
                         'module.py':'from .companion import VALUE\ndef later():\n from .late import VALUE\n return VALUE\n',
                         'late.py':'VALUE=1\n'}.items():(package/name).write_text(raw)
        self.git('add','alpha_factory_v1');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Synthetic Alpha source snapshot')
        return package,self.git('rev-parse','HEAD').decode().strip()
    def launcher(self):
        selected=importlib.util.spec_from_file_location('fixture_alpha_snapshot',Path(__file__).resolve().parents[2]/'local-runtime/computer/launcher.py')
        module=importlib.util.module_from_spec(selected);selected.loader.exec_module(module);return module
    def test_clean_exact_git_source_and_ignored_pycache(self):
        before=self.check();cache=self.sources/'__pycache__';cache.mkdir();(cache/'module.cpython-312.pyc').write_bytes(b'IGNORED INTERPRETER CACHE')
        self.assertEqual(self.check(),before)
    def test_changed_tracked_bytes_fail_even_when_assume_unchanged(self):
        self.git('update-index','--assume-unchanged','sources/module.py');self.file.write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_BYTES_CHANGED'):self.check()
    def test_unicode_tracked_html_is_verified_without_git_path_quoting(self):
        file=self.sources/'trace‑graph.html';file.write_text('<script>const reviewed=true;</script>')
        self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Tracked Unicode GUI source')
        self.check();self.git('update-index','--assume-unchanged','sources/trace‑graph.html');file.write_text('<script>const reviewed=false;</script>')
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_BYTES_CHANGED'):self.check()
    def test_untracked_importable_file_is_refused(self):
        (self.sources/'injected.py').write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):self.check()
    def test_linked_tracked_file_is_refused_even_for_identical_bytes(self):
        target=self.root/'outside.py';target.write_bytes(self.file.read_bytes());self.file.unlink();self.file.symlink_to(target)
        with self.assertRaisesRegex(ValueError,'SOURCE_LINK'):self.check()
    def test_untracked_linked_import_directory_is_refused(self):
        outside=self.root/'outside';outside.mkdir();(outside/'injected.py').write_text('VALUE=2\n');(self.sources/'linked').symlink_to(outside,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'SOURCE_LINK'):self.check()
    def test_later_exact_source_change_produces_a_different_snapshot(self):
        before=self.check();self.file.write_text('VALUE=2\n');self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','New synthetic source')
        self.assertNotEqual(self.check(),before)
    def test_valid_cached_bytecode_cannot_override_verified_source_import(self):
        from importlib._bootstrap_external import _code_to_timestamp_pyc
        code=compile('VALUE=2\n',str(self.file),'exec');cached=Path(importlib.util.cache_from_source(str(self.file)));cached.parent.mkdir()
        info=self.file.stat();cached.write_bytes(_code_to_timestamp_pyc(code,int(info.st_mtime),info.st_size))
        self.check()
        baseline=subprocess.check_output([sys.executable,'-B','-c','import sys;sys.path.insert(0,sys.argv[1]);import module;print(module.VALUE)',str(self.sources)],text=True)
        self.assertEqual(baseline.strip(),'2')
        with guard.source_only_imports():
            selected=importlib.util.spec_from_file_location('verified_source_fixture',self.file);module=importlib.util.module_from_spec(selected);selected.loader.exec_module(module)
            self.assertEqual(module.VALUE,1)
    def test_legacy_sourceless_package_cannot_shadow_reviewed_module(self):
        from importlib._bootstrap_external import _code_to_timestamp_pyc
        package=self.sources/'module';package.mkdir();(package/'__init__.pyc').write_bytes(_code_to_timestamp_pyc(compile('VALUE=2\n','harmless-constant-fixture','exec'),0,0))
        actual=subprocess.check_output([sys.executable,'-B','-X','pycache_prefix='+str(self.root/'empty-cache'),'-c','import sys;sys.path.insert(0,sys.argv[1]);import module;print(module.VALUE)',str(self.sources)],text=True)
        self.assertEqual(actual.strip(),'2')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):self.check()
        import importlib
        previous=list(sys.path)
        try:
            sys.path.insert(0,str(self.sources))
            with guard.source_only_imports():self.assertEqual(importlib.import_module('module').VALUE,1)
        finally:sys.path[:]=previous;sys.modules.pop('module',None)
    def test_top_level_import_shadow_is_refused(self):
        (self.root/'pydantic.py').write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):guard.verify_tree(self.root,guard.root_import_scopes(self.root))
    def test_top_level_package_import_shadow_is_refused(self):
        package=self.root/'pydantic';package.mkdir();(package/'__init__.py').write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):guard.verify_tree(self.root,guard.root_import_scopes(self.root))
    def test_replacement_refs_cannot_change_verified_commit_contents(self):
        original=self.git('rev-parse','HEAD').decode().strip();self.file.write_text('VALUE=2\n');self.git('add','sources');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Replacement fixture')
        replacement=self.git('rev-parse','HEAD').decode().strip();self.git('checkout','--quiet',original);self.git('replace',original,replacement);self.file.write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_BYTES_CHANGED'):self.check()
    def test_captured_entry_and_companion_execute_original_bytes_after_replacement(self):
        package,commit=self.sdk();entry=package/'module.py';companion=package/'companion.py';original=entry.read_bytes()
        with guard.source_only_imports(self.root,commit) as capture:
            entry.write_text('VALUE=2\n');companion.write_text('VALUE=2\n')
            module=importlib.import_module('alpha_factory_v1.module')
            self.assertEqual(module.VALUE,1);self.assertEqual(module.__file__,str(entry))
            entry.write_bytes(original);companion.write_text('VALUE=1\n')
            self.assertEqual(module.VALUE,1);self.assertEqual(capture['mode'],'CAPTURED_ALPHA_GIT_SOURCE')
            self.assertEqual(capture['moduleCount'],4)
        self.assertNotIn('alpha_factory_v1.module',sys.modules)
    def test_lazy_captured_import_and_original_sibling_resources_are_preserved(self):
        package,commit=self.sdk();resource=package/'public.txt';resource.write_text('public fixture data')
        with guard.source_only_imports(self.root,commit):
            module=importlib.import_module('alpha_factory_v1.module');(package/'late.py').write_text('VALUE=2\n')
            self.assertEqual(module.later(),1);self.assertEqual(Path(module.__file__).with_name('public.txt').read_text(),'public fixture data')
    def test_new_alpha_module_and_checkout_dependency_shadow_cannot_fall_back(self):
        package,commit=self.sdk()
        with guard.source_only_imports(self.root,commit):
            self.assertNotIn(str(self.root),sys.path)
            (package/'added.py').write_text('VALUE=2\n')
            with self.assertRaisesRegex(ModuleNotFoundError,'SOURCE_ALPHA_MODULE_NOT_CAPTURED'):importlib.import_module('alpha_factory_v1.added')
            (self.root/'fixture_dependency_marker.py').write_text('VALUE=2\n');sys.path.insert(0,str(self.root))
            with self.assertRaisesRegex(ValueError,'SOURCE_CHECKOUT_DEPENDENCY_SHADOW'):importlib.import_module('fixture_dependency_marker')
            self.assertNotIn('fixture_dependency_marker',sys.modules)
    def test_preloaded_alpha_and_overlapping_contexts_fail_without_removing_prior_modules(self):
        package,commit=self.sdk();prior=ModuleType('alpha_factory_v1');sys.modules['alpha_factory_v1']=prior
        try:
            with self.assertRaisesRegex(ValueError,'SOURCE_ALPHA_ALREADY_IMPORTED'):
                with guard.source_only_imports(self.root,commit):pass
            self.assertIs(sys.modules['alpha_factory_v1'],prior)
        finally:sys.modules.pop('alpha_factory_v1',None)
        with guard.source_only_imports(self.root,commit):
            with self.assertRaisesRegex(ValueError,'SOURCE_ALPHA_CONTEXT_ACTIVE'):
                with guard.source_only_imports(self.root,commit):pass
    def test_capture_refuses_masked_bytes_mode_and_file_graph_count_limits(self):
        package,commit=self.sdk();bridge=self.launcher()
        self.git('update-index','--assume-unchanged','alpha_factory_v1/companion.py');(package/'companion.py').write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_BYTES_CHANGED'):bridge.capture_alpha_sources(self.root,commit)
        (package/'companion.py').write_text('VALUE=1\n');(package/'companion.py').chmod(0o755)
        with self.assertRaisesRegex(ValueError,'SOURCE_GIT_FILE_MODE'):bridge.capture_alpha_sources(self.root,commit)
        (package/'companion.py').chmod(0o644)
        for constant,value,error in [('ALPHA_MODULE_BYTES',2,'SOURCE_FILE_LIMIT'),('ALPHA_GRAPH_BYTES',2,'SOURCE_GRAPH_LIMIT'),('ALPHA_MODULE_COUNT',1,'SOURCE_GRAPH_LIMIT')]:
            with self.subTest(constant=constant),patch.object(bridge,constant,value):
                with self.assertRaisesRegex(ValueError,error):bridge.capture_alpha_sources(self.root,commit)
    def test_capture_refuses_untracked_linked_and_legacy_native_alpha_sources(self):
        package,commit=self.sdk();bridge=self.launcher();added=package/'added.py';added.write_text('VALUE=2\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):bridge.capture_alpha_sources(self.root,commit)
        added.unlink();added.symlink_to(package/'companion.py')
        with self.assertRaisesRegex(ValueError,'SOURCE_LINK'):bridge.capture_alpha_sources(self.root,commit)
        added.unlink();(package/'legacy.pyc').write_bytes(b'non-executable fixture bytes')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNTRACKED_IMPORTABLE'):bridge.capture_alpha_sources(self.root,commit)
    def test_captured_runtime_delegates_to_an_explicit_installed_dependency(self):
        package,commit=self.sdk()
        with tempfile.TemporaryDirectory() as installed:
            outside=Path(installed);(outside/'fixture_installed_marker.py').write_text('VALUE=7\n');sys.path.insert(0,str(outside))
            try:
                with guard.source_only_imports(self.root,commit):self.assertEqual(importlib.import_module('fixture_installed_marker').VALUE,7)
            finally:sys.path.remove(str(outside));sys.modules.pop('fixture_installed_marker',None)
    def test_native_worker_frame_is_unchanged_or_refused_before_any_child_execution(self):
        package,commit=self.sdk();successor=package/'core/runtime/successor';successor.mkdir(parents=True)
        for relative in ['core/__init__.py','core/runtime/__init__.py','core/runtime/successor/__init__.py']:(package/relative).write_text('')
        for name in ['computer_worker.py','computer_read.py']:(successor/name).write_text('VALUE=1\n')
        # A benign native-shaped frame producer reads constants, never launches
        # a process. The bridge must inspect the actual returned frame unchanged.
        (successor/'computer.py').write_text('''import hashlib,json
from pathlib import Path
READ_BOOTSTRAP='reviewed fixture bootstrap'
WORKER=Path(__file__).with_name('computer_worker.py')
READ_WORKER=Path(__file__).with_name('computer_read.py')
canonical=lambda value:json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def _worker_source_snapshot():
 reader=READ_WORKER.read_bytes();dependencies=b'reviewed fixture dependencies'
 identity=hashlib.sha256(canonical({'browser':hashlib.sha256(WORKER.read_bytes()).hexdigest(),'reader':hashlib.sha256(reader).hexdigest(),'reader_bootstrap':hashlib.sha256(READ_BOOTSTRAP.encode()).hexdigest(),'reader_dependencies':hashlib.sha256(dependencies).hexdigest()})).hexdigest()
 return identity,reader,dependencies
NATIVE_SNAPSHOT=_worker_source_snapshot
''')
        self.git('add','alpha_factory_v1');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Benign child frame fixture');commit=self.git('rev-parse','HEAD').decode().strip()
        with guard.source_only_imports(self.root,commit):
            computer=importlib.import_module('alpha_factory_v1.core.runtime.successor.computer')
            self.assertEqual(computer._worker_source_snapshot(),computer.NATIVE_SNAPSHOT())
            for name in ['computer_read.py','computer_worker.py']:
                with self.subTest(name=name):
                    (successor/name).write_text('VALUE=2\n')
                    with self.assertRaisesRegex(ValueError,'SOURCE_ALPHA_WORKER_CHANGED'):computer._worker_source_snapshot()
                    (successor/name).write_text('VALUE=1\n')
                    self.assertEqual(computer._worker_source_snapshot(),computer.NATIVE_SNAPSHOT())
    def test_fd_growth_cannot_read_beyond_captured_size_plus_one(self):
        package,commit=self.sdk();bridge=self.launcher();target=package/'companion.py';size=target.stat().st_size;read=bridge.os.read;observed=[]
        def growing(descriptor,count):
            if Path('/proc/self/fd/'+str(descriptor)).resolve()==target:
                observed.append(count)
                if len(observed)==1:
                    with target.open('ab') as stream:stream.write(b'VALUE=2\n')
            return read(descriptor,count)
        with patch.object(bridge.os,'read',growing):
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED_DURING_CAPTURE'):bridge.capture_alpha_sources(self.root,commit)
        self.assertEqual(sum(observed),size+1)
    def test_missing_tracked_initializer_cannot_become_a_namespace(self):
        package,commit=self.sdk();sub=package/'nested';sub.mkdir();(sub/'__init__.py').write_text('VALUE=1\n');(sub/'module.py').write_text('VALUE=1\n')
        self.git('add','alpha_factory_v1');self.git('-c','user.name=Source fixture','-c','user.email=source-fixture@example.invalid','commit','--quiet','-m','Tracked initializer fixture');commit=self.git('rev-parse','HEAD').decode().strip()
        (sub/'__init__.py').unlink()
        with self.assertRaisesRegex(ValueError,'SOURCE_CAPTURE_INCOMPLETE'):self.launcher().capture_alpha_sources(self.root,commit)
    def test_dependency_returns_the_checked_spec_and_denies_checkout_alias_paths(self):
        package,commit=self.sdk();bridge=self.launcher();snapshot=bridge.capture_alpha_sources(self.root,commit)
        selected=importlib.machinery.ModuleSpec('fixture_installed_marker',loader=None,origin='/usr/lib/fixture_installed_marker.py')
        with patch.object(bridge.importlib.machinery.PathFinder,'find_spec',return_value=selected) as finder:
            self.assertIs(snapshot.find_spec('fixture_installed_marker'),selected);finder.assert_called_once()
        alias=self.root.parent/(self.root.name+'-alias');alias.symlink_to(self.root,target_is_directory=True)
        try:
            with patch.object(sys,'path',[str(alias)]):
                with self.assertRaisesRegex(ValueError,'SOURCE_CHECKOUT_DEPENDENCY_SHADOW'):snapshot.find_spec('fixture_installed_marker')
        finally:alias.unlink()


if __name__=='__main__':unittest.main()
