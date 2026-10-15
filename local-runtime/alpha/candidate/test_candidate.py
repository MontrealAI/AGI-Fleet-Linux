"""Synthetic builder/adversarial regressions. These never qualify native isolation."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build
import qualify


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def tar(self, entries):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as archive:
            for name, kind, value in entries:
                item = tarfile.TarInfo(name)
                item.mode = 0o444
                if kind == 'file':
                    item.size = len(value)
                    archive.addfile(item, io.BytesIO(value))
                else:
                    item.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE if kind == 'hardlink' else tarfile.FIFOTYPE
                    item.linkname = value
                    archive.addfile(item)
        data.seek(0)
        return data

    def wheel(self, entries):
        path = self.root / 'test.whl'
        with zipfile.ZipFile(path, 'w') as archive:
            for name, raw in entries:
                archive.writestr(name, raw)
        return path

    def test_checked_in_lock_has_official_pins_and_no_activation(self):
        lock = build.read_lock()
        self.assertEqual(set(lock['targets']), {'linux-x64', 'linux-arm64'})
        for target in lock['targets'].values():
            self.assertEqual(len(target['wheels']), 10)
            self.assertEqual({x['package'] for x in target['runtimePackages']}, {'libc6','libgcc-s1','gcc-14-base','libstdc++6','zlib1g','libcrypt1'})
        self.assertIn('alpha_factory_v1/core/simulation/surrogate_fitness.yaml', lock['sourceFiles'])

    def test_only_official_https(self):
        for url in ['http://github.com/a', 'https://github.com.evil/a', 'https://user:pass@github.com/a', 'https://github.com:444/a', 'file:///tmp/a']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                build.safe_url(url)

    def test_redirect_rechecks_host(self):
        with self.assertRaises(ValueError):
            build.OfficialRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid/pkg')

    def test_cache_hash_fails_closed(self):
        p = self.root / 'p'; p.write_bytes(b'wrong')
        target = {'python': {'filename':'p','bytes':5,'sha256':'0'*64}, 'runtimePackages':[], 'wheels':[]}
        with self.assertRaisesRegex(ValueError, 'absent or changed'):
            build.checked_assets(target, self.root)

    def test_cache_symlink_refused(self):
        (self.root / 'real').write_bytes(b'x'); (self.root / 'p').symlink_to('real')
        target = {'python': {'filename':'p','bytes':1,'sha256':build.sha(b'x')}, 'runtimePackages':[], 'wheels':[]}
        with self.assertRaises(ValueError):
            build.checked_assets(target, self.root)

    def test_tar_traversal_absolute_and_backslash(self):
        for name in ['../out', '/out', 'a/../../out', 'a\\out']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                build.extract_tar(self.tar([(name,'file',b'x')]), self.root)

    def test_tar_special_and_hardlinks(self):
        for kind in ['hardlink','fifo']:
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                build.extract_tar(self.tar([('x',kind,'target')]), self.root)

    def test_tar_duplicate_refused(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            build.extract_tar(self.tar([('x','file',b'x'),('x','file',b'x')]), self.root)

    def test_tar_escaping_and_absolute_links(self):
        for target in ['../../escape','/etc/passwd']:
            destination = self.root / str(len(list(self.root.iterdir())))
            destination.mkdir()
            with self.subTest(target=target), self.assertRaises((ValueError, FileNotFoundError)):
                build.extract_tar(self.tar([('link','symlink',target)]), destination)

    def test_tar_link_parent_cannot_redirect_extraction(self):
        with self.assertRaises(ValueError):
            build.extract_tar(self.tar([('link','symlink','.'),('link/x','file',b'x')]), self.root)

    def test_safe_link_and_readonly_bytes_survive(self):
        build.extract_tar(self.tar([('x','file',b'alpha'),('link','symlink','x')]), self.root)
        self.assertEqual((self.root/'link').read_bytes(), b'alpha')
        self.assertEqual(stat.S_IMODE((self.root/'x').stat().st_mode), 0o444)

    def test_wheel_traversal(self):
        with self.assertRaises(ValueError):
            build.install_wheel(self.wheel([('../x', b'x')]), self.root/'wheels')

    def test_wheel_startup_hook_and_script_rejected(self):
        for name in ['evil.pth','sitecustomize.py','x.data/scripts/run']:
            p = self.root/'test.whl'
            if p.exists(): p.unlink()
            with self.subTest(name=name), self.assertRaises(ValueError):
                build.install_wheel(self.wheel([(name,b'x')]), self.root/'wheels')

    def test_wheel_collision_refused(self):
        p = self.wheel([('x.py',b'x')]); build.install_wheel(p,self.root/'wheels')
        with self.assertRaisesRegex(ValueError,'collision'):
            build.install_wheel(p,self.root/'wheels')

    def test_wheel_no_install_code_execution(self):
        p = self.wheel([('pkg/__init__.py',b'raise RuntimeError("never execute")'),('pkg-1.dist-info/LICENSE',b'test license')])
        build.install_wheel(p,self.root/'wheels')
        self.assertTrue((self.root/'wheels/pkg/__init__.py').is_file())

    def test_manifest_detects_bytes_mode_and_link_changes(self):
        p = self.root/'x'; p.write_bytes(b'x'); before = build.tree_manifest(self.root)
        p.write_bytes(b'y'); self.assertNotEqual(before,build.tree_manifest(self.root))
        p.write_bytes(b'x'); p.chmod(0o400); self.assertNotEqual(before,build.tree_manifest(self.root))
        p.unlink(); p.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): build.tree_manifest(self.root)

    def test_archive_is_reproducible_without_host_metadata(self):
        root = self.root/'rootfs'; root.mkdir(); (root/'file').write_bytes(b'bytes')
        a=self.root/'a.gz'; b=self.root/'b.gz'
        build.deterministic_archive(root,a); os.utime(root/'file',(123,123)); build.deterministic_archive(root,b)
        self.assertEqual(a.read_bytes(),b.read_bytes())

    def test_elf_unresolved_dependency_fails_closed(self):
        (self.root/'binary').write_bytes(b'\x7fELF')
        out="Class: ELF64\nData: 2's complement, little endian\n"+'Machine: Advanced Micro Devices X86-64\n (NEEDED) Shared library: [missing.so]\n'
        with patch('build.subprocess.check_output',return_value=out), self.assertRaisesRegex(ValueError,'Unresolved'):
            build.elf_audit(self.root,{'triplet':'x86_64-linux-gnu','machine':'x86_64','loader':'/lib64/ld-linux-x86-64.so.2'})

    def test_elf_ambient_search_and_wrong_arch_refused(self):
        (self.root/'binary').write_bytes(b'\x7fELF')
        for out in ['Machine: AArch64\n','Machine: Advanced Micro Devices X86-64\n (RUNPATH) Library runpath: [/usr/local/lib]\n']:
            with patch('build.subprocess.check_output',return_value=out), self.assertRaises(ValueError):
                build.elf_audit(self.root,{'triplet':'x86_64-linux-gnu','machine':'x86_64','loader':'x'})

    def test_fixed_launcher_has_no_ambient_site_or_module_argument(self):
        text=(build.HERE/'launcher.py.in').read_text()
        self.assertIn('len(sys.argv) != 1',text)
        self.assertIn('sys.flags.isolated and sys.flags.no_site',text)
        self.assertNotIn('os.environ',text)
        self.assertEqual(text.count('@MODULE@'),2)

    def test_sandbox_arguments_mount_only_candidate_root(self):
        with patch('qualify.trusted',side_effect=str):
            argv=qualify.command(self.root,'work')
        self.assertEqual(argv.count('--ro-bind'),1)
        self.assertIn('--unshare-all',argv)
        self.assertEqual(argv[-4:],['-I','-S','-B','/opt/alpha/launch-work.py'])
        self.assertNotIn('/usr/lib',argv)
        self.assertIn('--cpu=10',argv)

    def test_unrecognized_entrypoint_or_probe_refused(self):
        with self.assertRaises(ValueError): qualify.command(self.root,'shell')
        with patch('qualify.trusted',side_effect=str), self.assertRaises(ValueError): qualify.command(self.root,'probe','custom')
        with patch('qualify.trusted',side_effect=str), self.assertRaises(ValueError): qualify.command(self.root,'work','isolation')

    def test_limits_cannot_be_widened(self):
        with self.assertRaises(ValueError): qualify.run(self.root,'work',wall=16)
        with self.assertRaises(ValueError): qualify.run(self.root,'work',data=b'x'*512001)


    def test_synthetic_runner_preserves_exact_stdin(self):
        code = 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())'
        data = ('café 🧪\n' * 1000).encode()
        with patch('qualify.command', return_value=[sys.executable, '-I', '-S', '-c', code]):
            result = qualify.run(self.root, 'work', data=data)
        self.assertEqual(result['stdout'], data)
        self.assertEqual(result['status'], 0)
        self.assertTrue(result['processGroupGone'])

    def test_synthetic_runner_wall_and_cancellation(self):
        code = 'import time; time.sleep(30)'
        for kwargs, expected in [({'wall': 0.1}, 'WALL_TIMEOUT'), ({'cancel_after': 0.1}, 'CANCELLED')]:
            with patch('qualify.command', return_value=[sys.executable, '-I', '-S', '-c', code]):
                result = qualify.run(self.root, 'work', **kwargs)
            self.assertEqual(result['reason'], expected)
            self.assertTrue(result['processGroupGone'])

    def test_synthetic_runner_output_bound(self):
        code = 'import os\nwhile True: os.write(1,b"x"*65536)'
        with patch('qualify.command', return_value=[sys.executable, '-I', '-S', '-c', code]):
            result = qualify.run(self.root, 'work')
        self.assertEqual(result['reason'], 'OUTPUT_LIMIT')
        self.assertLessEqual(len(result['stdout']), qualify.MAX_STDOUT)
        self.assertTrue(result['processGroupGone'])

    def test_fixture_digest_is_part_of_reviewed_inputs(self):
        lock = build.read_lock()
        self.assertEqual(build.file_sha(build.ALPHA.parent/'tests/fixtures/alpha-contract.json'), lock['contractFixtureSha256'])

    def test_empty_or_duplicate_fixtures_fail_even_with_matching_file_hash(self):
        lock = build.read_lock()
        for cases in ([], [{'kind': 'research'}] * 4):
            with patch('qualify.json.loads', return_value={'cases': cases}), self.assertRaises(ValueError):
                qualify.load_fixtures(lock)

    def test_altered_fixture_digest_fails(self):
        lock = build.read_lock()
        lock['contractFixtureSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'changed'):
            qualify.load_fixtures(lock)

    def test_native_requires_complete_vectors_and_reconstruction(self):
        source = (build.HERE/'qualify.py').read_text()
        self.assertIn('manifest == expected', source)
        self.assertIn("len(fixture['cases']) == 4", source)
        self.assertIn("len(report['tests']) == 28", source)
        self.assertIn("9 <= result['namespaceCpuSecondsObserved'] <= 11", source)

    def test_fixed_probe_detaches_child_and_closes_stdio(self):
        source = (build.HERE/'probe.py').read_text()
        self.assertIn('os.setsid()', source)
        self.assertIn('os.close(descriptor)', source)


    def test_probe_readonly_mount_is_inside_previously_created_private_tmpfs(self):
        with patch('qualify.trusted', side_effect=str):
            argv = qualify.command(self.root, 'probe', 'isolation')
        mounts = [i for i, arg in enumerate(argv) if arg == '--ro-bind']
        self.assertEqual(len(mounts), 2)
        self.assertEqual(argv[mounts[0] + 2], '/')
        self.assertLess(mounts[0], argv.index('--tmpfs'))
        self.assertLess(argv.index('--tmpfs'), mounts[1])
        self.assertEqual(argv[argv.index('--tmpfs') + 1], '/tmp')
        self.assertEqual(argv[mounts[1] + 2], '/tmp/candidate-probe.py')
        self.assertEqual(argv[-2], '/tmp/candidate-probe.py')
        self.assertNotIn('/candidate-probe.py', argv)
        self.assertNotIn('--bind', argv)

    def test_failed_probe_diagnostics_are_kept_before_fail_closed_check(self):
        # Synthetic reproduction of a setup failure; no native qualification claim.
        stderr = b"bwrap: Can't create file at /candidate-probe.py: Read-only file system\n"
        code = 'import sys; sys.stderr.buffer.write(' + repr(stderr) + '); sys.exit(1)'
        with patch('qualify.command', return_value=[sys.executable, '-I', '-S', '-c', code]):
            result = qualify.run(self.root, 'probe', probe='isolation')
        attempts = [qualify.probe_attempt('isolation', result)]
        with self.assertRaisesRegex(ValueError, 'Read-only file system'):
            qualify.check_probe('isolation', result, 'pid:[host]', 'net:[host]')
        self.assertEqual(attempts[0]['stderr'], stderr.decode())
        self.assertEqual(attempts[0]['stderrSha256'], build.sha(stderr))
        self.assertEqual(attempts[0]['status'], 1)
        self.assertEqual(attempts[0]['probeObservations'], [])

    def cpu_stat(self, user, system, start):
        fields = ['0'] * 24
        fields[0] = 'R'
        for index, value in [(11, user), (12, system), (19, start)]:
            fields[index] = str(value)
        return '123 (name with ) and spaces) ' + ' '.join(fields)

    def test_process_cpu_parser_uses_own_ticks_not_child_ticks(self):
        raw = self.cpu_stat(997, 2, 12345)
        self.assertEqual(qualify.process_cpu_stat(raw), {'userTicks': 997, 'systemTicks': 2, 'startTimeTicks': 12345})
        with self.assertRaises(ValueError):
            qualify.process_cpu_stat('123 (short) R 1')

    def test_namespace_cpu_samples_bind_pid_start_time_and_monotonic_ticks(self):
        proc = self.root/'123'; proc.mkdir()
        samples = {}
        with patch('qualify.namespace_members', return_value=[123]), patch('qualify.os.readlink', return_value='pid:[private]'):
            (proc/'stat').write_text(self.cpu_stat(920, 2, 100))
            qualify.sample_namespace_cpu({'pid:[private]': [123]}, samples, self.root)
            (proc/'stat').write_text(self.cpu_stat(990, 3, 100))
            qualify.sample_namespace_cpu({'pid:[private]': [123]}, samples, self.root)
            self.assertEqual(samples['123:100']['userTicks'], 990)
            (proc/'stat').write_text(self.cpu_stat(1, 0, 200))
            qualify.sample_namespace_cpu({'pid:[private]': [123]}, samples, self.root)
            self.assertEqual(set(samples), {'123:100', '123:200'})
            (proc/'stat').write_text(self.cpu_stat(989, 3, 100))
            with self.assertRaisesRegex(ValueError, 'backwards'):
                qualify.sample_namespace_cpu({'pid:[private]': [123]}, samples, self.root)

    def test_cpu_sampling_does_not_attribute_reused_pid_outside_namespace(self):
        proc = self.root/'123'; proc.mkdir(); (proc/'stat').write_text(self.cpu_stat(9999, 0, 200))
        samples = {}
        with patch('qualify.namespace_members', return_value=[123]), patch('qualify.os.readlink', side_effect=['pid:[private]', 'pid:[other]']):
            qualify.sample_namespace_cpu({'pid:[private]': [123]}, samples, self.root)
        self.assertEqual(samples, {})

    def test_cpu_probe_needs_namespace_ticks_signal_and_exact_limit(self):
        good = {'probeObservations': [{'pidNamespace':'pid:[private]', 'networkNamespace':'net:[private]', 'cpuLimitSeconds':[10,10]}],
                'status':137, 'reason':None, 'stderr':b'', 'namespaceCpuSecondsObserved':9.98,
                'launcherCpuSeconds':0.002, 'wallMilliseconds':10500}
        qualify.check_probe('cpu', good, 'pid:[host]', 'net:[host]')
        for update in [{'namespaceCpuSecondsObserved':0.002, 'launcherCpuSeconds':10}, {'status':1},
                       {'wallMilliseconds':15001}, {'probeObservations':[{'pidNamespace':'pid:[private]',
                        'networkNamespace':'net:[private]', 'cpuLimitSeconds':[11,11]}]}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                qualify.check_probe('cpu', {**good, **update}, 'pid:[host]', 'net:[host]')

    def test_production_lock_remains_null(self):
        lock=json.loads((build.ALPHA/'package-lock.json').read_text())
        self.assertEqual(lock['state'],'UNPROVISIONED')
        self.assertTrue(all(v is None for v in lock['targets'].values()))


if __name__=='__main__': unittest.main()
