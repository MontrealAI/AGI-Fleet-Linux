"""Installer fault/security cases; the installed-runtime journey is a separate native gate."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

I = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'install.py'))
G = I['install'].__globals__


class Installation(unittest.TestCase):
    def setUp(self):
        self.mask = os.umask(0o077)
        self.temp = tempfile.TemporaryDirectory(prefix='fleet-installer-test-')
        self.base = Path(self.temp.name)
        self.root, self.state = self.base / 'application', self.base / 'private-state'
        self.node = Path(os.environ['AGI_LOCAL_NODE_ARCHIVE'])

    def tearDown(self):
        self.temp.cleanup()
        os.umask(self.mask)

    def archive(self, name='one', extra=None, empty=False):
        entries = {'LICENSE': b'Installer fixture only\n', 'local-runtime/validate.mjs': b'export const fixture=true;\n',
                   'local-runtime/cli/main.mjs': ('// Syntax-check fixture ' + name + '\n').encode()}
        if empty:
            entries['local-runtime/empty-owned.txt'] = b''
        records = [{'path': key, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'mode': 0o644} for key, data in entries.items()]
        manifest = {'schema': 'agi-fleet/local-source-preview/v1', 'version': '0.1.0-alpha.1', 'commit': '1' * 40,
                    'productionQualified': False, 'workingTreeDirty': False, 'files': records}
        entries['local-preview-manifest.json'] = json.dumps(manifest).encode()
        archive = self.base / (name + '.zip')
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for key, data in entries.items():
                info = zipfile.ZipInfo('agi-fleet-local-0.1.0-alpha.1/' + key)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                z.writestr(info, data)
            if extra:
                info = zipfile.ZipInfo(extra)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                z.writestr(info, b'unowned')
        return archive, I['sha'](archive)

    def install(self, pair=None, update=False):
        archive, digest = pair or self.archive()
        return I['install'](archive, digest, self.node, self.root, self.state, update=update)

    def crash_install(self, point):
        archive, digest = self.archive()
        script = '''
import os, runpy, sys
from pathlib import Path
i = runpy.run_path(sys.argv[1]); g = i['install'].__globals__; point = sys.argv[7]
atomic = g['atomic']; stage = g['stage']
def interrupted_atomic(file, value):
    if file.name == 'installation.json' and point == 'before-pointer': os._exit(75)
    atomic(file, value)
    if file.name == 'installation.json' and point == 'after-pointer': os._exit(75)
def interrupted_stage(*args):
    if point == 'before-stage': os._exit(75)
    result = stage(*args)
    if point == 'after-stage': os._exit(75)
    return result
g.update(atomic=interrupted_atomic, stage=interrupted_stage)
os.umask(0o077)
i['install'](Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), Path(sys.argv[5]), Path(sys.argv[6]))
'''
        result = subprocess.run([sys.executable, '-c', script, str(Path(__file__).resolve().parents[1] / 'install.py'),
                                 str(archive), digest, str(self.node), str(self.root), str(self.state), point], capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertTrue((self.state / 'control.sock').exists())
        return archive, digest

    def test_exact_source_and_node_required_before_activation(self):
        receipt = self.install()
        self.assertFalse(receipt['started'])
        self.assertEqual(receipt['authority'], 'none')
        self.assertEqual(list(self.state.iterdir()), [])
        root, m = I['installation'](self.root)
        self.assertEqual(I['verify_version'](root, m['current']), {k: v for k, v in receipt.items() if k not in ('installation', 'state', 'started', 'authority')})
        self.assertEqual((self.state.stat().st_mode & 0o777), 0o700)

    def test_bad_digest_and_traversal_create_no_installation(self):
        archive, _ = self.archive()
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SHA256_MISMATCH'):
            I['install'](archive, '0' * 64, self.node, self.root, self.state)
        for name in ('../escape', '/absolute', 'agi-fleet-local-0.1.0-alpha.1/../escape', 'agi-fleet-local-0.1.0-alpha.1/LICENSE'):
            pair = self.archive(hashlib.sha256(name.encode()).hexdigest()[:8], name)
            with self.assertRaises(ValueError):
                self.install(pair)
        self.assertFalse(self.root.exists())
        self.assertFalse(self.state.exists())

    def test_update_rollback_and_removal_preserve_authority_and_other_installation(self):
        dedicated = self.base / 'dedicated-installation'
        dedicated.mkdir()
        (dedicated / 'wallet-and-output').write_text('untouched')
        first = self.install()
        (self.state / 'revoked-and-reserved.json').write_text('{"revoked":true,"reserved":19}')
        before = (self.state / 'revoked-and-reserved.json').read_bytes()
        second = self.install(self.archive('two'), update=True)
        self.assertNotEqual(first['archiveSHA256'], second['archiveSHA256'])
        result = I['select'](self.root, first['archiveSHA256'])
        self.assertFalse(result['stateRestored'])
        self.assertFalse(result['authorityRestored'])
        self.assertEqual(result['generation'], 3)
        self.assertEqual((self.state / 'revoked-and-reserved.json').read_bytes(), before)
        I['uninstall'](self.root)
        self.assertFalse(self.root.exists())
        self.assertEqual((self.state / 'revoked-and-reserved.json').read_bytes(), before)
        self.assertEqual((dedicated / 'wallet-and-output').read_text(), 'untouched')

    def test_failed_validation_and_pointer_switch_preserve_previous_version(self):
        first = self.install()
        prior = (self.root / 'installation.json').read_bytes()
        pair = self.archive('two')
        atomic = G['atomic']
        def fail_switch(file, value):
            if file.name == 'installation.json':
                raise OSError('ENOSPC injected before switch')
            return atomic(file, value)
        with patch.dict(G, {'atomic': fail_switch}):
            with self.assertRaisesRegex(OSError, 'ENOSPC'):
                self.install(pair, update=True)
        self.assertEqual((self.root / 'installation.json').read_bytes(), prior)
        self.assertEqual(set(x.name for x in (self.root / 'versions').iterdir()), {first['archiveSHA256']})
        self.assertEqual(set(x.name for x in self.root.iterdir()), {'installation.json', 'versions'})

    def test_wrong_node_identity_leaves_no_fresh_installation(self):
        bad = self.base / 'bad-node.tar.xz'
        bad.write_bytes(b'not the pinned Node runtime')
        self.node = bad
        with self.assertRaisesRegex(ValueError, 'NODE_ARCHIVE_SHA256_MISMATCH'):
            self.install()
        self.assertFalse(self.root.exists())
        self.assertFalse(self.state.exists())

    def test_pending_or_uncertain_work_blocks_maintenance(self):
        self.install()
        with sqlite3.connect(self.state / 'ledger.sqlite') as db:
            db.executescript("CREATE TABLE runs(state TEXT); CREATE TABLE grants(state TEXT); INSERT INTO runs VALUES('uncertain');")
        with self.assertRaisesRegex(ValueError, 'RECONCILE_OBLIGATIONS_FIRST'):
            I['uninstall'](self.root)
        with sqlite3.connect(self.state / 'ledger.sqlite') as db:
            db.executescript("DELETE FROM runs; INSERT INTO grants VALUES('authorized');")
        with self.assertRaisesRegex(ValueError, 'REVOKE_PENDING_GRANTS_FIRST'):
            I['uninstall'](self.root)
        self.assertTrue(self.root.exists())

    def test_changed_or_unowned_resources_are_never_removed(self):
        self.install()
        _, m = I['installation'](self.root)
        folder = self.root / 'versions' / m['current'] / 'application'
        for mode in ('directory', 'symlink', 'file'):
            extra = folder / 'operator-output'
            if mode == 'directory':
                extra.mkdir()
            elif mode == 'symlink':
                extra.symlink_to(self.state, target_is_directory=True)
            else:
                extra.write_text('save me')
            with self.assertRaisesRegex(ValueError, 'UNOWNED|ALIAS'):
                I['uninstall'](self.root)
            self.assertTrue(extra.exists())
            extra.rmdir() if mode == 'directory' else extra.unlink()

    def test_live_maintenance_cannot_be_stolen_and_state_symlink_is_rejected(self):
        self.install()
        with I['maintenance'](self.root):
            with self.assertRaisesRegex(ValueError, 'INSTALLATION_OPERATION_STILL_ACTIVE'):
                with I['maintenance'](self.root, recover=True):
                    self.fail('stole lock')
        self.state.rmdir()
        other = self.base / 'another-state'
        other.mkdir(mode=0o700)
        self.state.symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'PATH_ALIAS_FORBIDDEN'):
            I['uninstall'](self.root)

    def test_state_fence_blocks_raw_service_start_and_live_recovery(self):
        self.install()
        with I['reserve_state'](self.state):
            self.assertTrue((self.state / 'control.sock').is_file())
            with self.assertRaises(FileExistsError):
                os.open(self.state / 'control.sock', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with self.assertRaisesRegex(ValueError, 'INSTALLATION_OPERATION_STILL_ACTIVE'):
                I['recover_maintenance'](self.root)
        self.assertFalse((self.state / 'control.sock').exists())

    def test_only_recorded_dead_maintenance_can_release_its_state_fence(self):
        self.install()
        marker = self.state / 'control.sock'
        marker.write_text(json.dumps({'schema': 'agi-fleet/state-maintenance/v1', 'pid': os.getpid(), 'boot': 'a-prior-boot', 'state': str(self.state)}))
        result = I['recover_maintenance'](self.root)
        self.assertFalse(result['authorityRestored'])
        self.assertFalse(marker.exists())
        marker.write_text('unowned data')
        with self.assertRaises(ValueError):
            I['recover_maintenance'](self.root)
        self.assertEqual(marker.read_text(), 'unowned data')

    def test_first_install_crash_recovers_before_staging_without_deleting_unknown_files(self):
        pair = self.crash_install('before-stage')
        unknown = self.root / 'operator-notes'; unknown.write_text('preserve me')
        with self.assertRaisesRegex(ValueError, 'RECOVER_MATCHING_INSTALLATION_FIRST'):
            self.install(pair)
        result = I['recover_maintenance'](self.root)
        self.assertEqual(result['state'], 'installation-retry-required')
        self.assertFalse(result['stagingContentDeleted'])
        with self.assertRaisesRegex(ValueError, 'RECOVER_MATCHING_INSTALLATION_FIRST'):
            self.install(self.archive('different'))
        self.install(pair)
        self.assertEqual(unknown.read_text(), 'preserve me')
        self.assertFalse((self.root / 'pending-install.json').exists())
        with self.assertRaisesRegex(ValueError, 'UNOWNED_INSTALLATION_CONTENT'):
            I['uninstall'](self.root)

    def test_first_install_crash_retains_unselected_staging_and_can_retry(self):
        pair = self.crash_install('after-stage')
        staged = next(self.root.glob('stage-*'))
        before = I['sha'](staged / 'receipt.json')
        I['recover_maintenance'](self.root)
        self.install(pair)
        self.assertEqual(I['sha'](staged / 'receipt.json'), before)

    def test_first_install_crash_before_pointer_reuses_only_verified_target(self):
        pair = self.crash_install('before-pointer')
        version = self.root / 'versions' / pair[1]
        inode = version.stat().st_ino
        I['recover_maintenance'](self.root)
        self.install(pair)
        self.assertEqual(version.stat().st_ino, inode)
        I['uninstall'](self.root)

    def test_crash_after_first_pointer_cleans_only_its_validated_journal(self):
        self.crash_install('after-pointer')
        pointer = (self.root / 'installation.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'RECOVER_INSTALLATION_FIRST'):
            I['installation'](self.root)
        result = I['recover_maintenance'](self.root)
        self.assertEqual(result['state'], 'maintenance-unlocked')
        self.assertEqual((self.root / 'installation.json').read_bytes(), pointer)
        self.assertFalse((self.root / 'pending-install.json').exists())
        I['uninstall'](self.root)

    def test_incomplete_recovery_refuses_live_owner_changed_directories_and_existing_state(self):
        pair = self.crash_install('before-stage')
        file = self.root / 'pending-install.json'; original = file.read_bytes()
        record = json.loads(original); record.update(pid=os.getpid(), boot=I['boot_identity']())
        file.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'INSTALLATION_OPERATION_STILL_ACTIVE'):
            I['recover_maintenance'](self.root)
        file.write_bytes(original)
        moved = self.base / 'retained-state'; self.state.rename(moved); self.state.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'INSTALLATION_DIRECTORY_CHANGED'):
            I['recover_maintenance'](self.root)
        self.state.rmdir(); moved.rename(self.state)
        I['recover_maintenance'](self.root)
        output = self.state / 'unknown-output'; output.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'FRESH_STATE_REQUIRED'):
            self.install(pair)
        self.assertEqual(output.read_bytes(), b'keep')

    def test_preflight_is_read_only_and_distinguishes_inspection_from_execution(self):
        archive, digest = self.archive()
        before = set(self.base.iterdir())
        result = I['preflight'](archive, digest, self.node, self.root, self.state)
        self.assertTrue(result['readOnly'])
        self.assertFalse(result['hostModified'])
        self.assertEqual(set(self.base.iterdir()), before)
        self.assertFalse(self.root.exists())
        self.assertEqual(result['authority'], 'none')
        self.assertIn('NOT_RUN', result['runtimeAdmission'])
        self.assertEqual(result['crossHostAuthorityRestore'], 'BLOCKED_NOT_IMPLEMENTED')
        self.assertEqual(next(x['status'] for x in result['checks'] if x['prerequisite'] == 'package identity'), 'present')

    def test_preflight_reports_exact_bad_identity_and_existing_state_without_mutation(self):
        archive, _ = self.archive()
        self.state.mkdir(mode=0o700)
        output = self.state / 'work'; output.write_bytes(b'committed')
        result = I['preflight'](archive, '0' * 64, self.node, self.root, self.state)
        self.assertFalse(result['readyForInstallInspection'])
        codes = {x.get('code') for x in result['checks']}
        self.assertIn('ARCHIVE_SHA256_MISMATCH', codes)
        self.assertIn('FRESH_INSTALL_REQUIRED', codes)
        self.assertEqual(output.read_bytes(), b'committed')
        self.assertFalse(self.root.exists())

    def test_preflight_reports_insufficient_staging_capacity_without_reserving_space(self):
        archive, digest = self.archive()
        low = G['shutil'].disk_usage(self.base)._replace(free=0)
        with patch.object(G['shutil'], 'disk_usage', return_value=low):
            result = I['preflight'](archive, digest, self.node, self.root, self.state)
        self.assertFalse(result['readyForInstallInspection'])
        self.assertIn('INSUFFICIENT_STAGE_DISK_SPACE', {x.get('code') for x in result['checks']})
        self.assertFalse(self.root.exists())
        self.assertFalse(self.state.exists())

    def crash_removal(self, point):
        script = '''
import os, runpy, sys
from pathlib import Path
i = runpy.run_path(sys.argv[1]); g = i['uninstall'].__globals__; point = sys.argv[3]
atomic = g['atomic']; unlink = os.unlink; rmdir = os.rmdir
def interrupted_atomic(file, value):
    atomic(file, value)
    if file.name == 'pending-removal.json' and point == 'after-journal': os._exit(76)
def interrupted_unlink(file, *args, **kwargs):
    unlink(file, *args, **kwargs)
    name = Path(str(file)).name
    if name == 'LICENSE' and point == 'during-files': os._exit(76)
    if name == 'pending-removal.json' and point == 'before-root-removal': os._exit(76)
def interrupted_rmdir(file, *args, **kwargs):
    rmdir(file, *args, **kwargs)
    name = Path(str(file)).name
    if name == 'versions' and point == 'after-versions': os._exit(76)
    if name == Path(sys.argv[2]).name and point == 'after-root-removal' and kwargs.get('dir_fd') is not None:
        parent = os.fstat(kwargs['dir_fd']); expected = Path(sys.argv[2]).parent.stat()
        if (parent.st_dev, parent.st_ino) == (expected.st_dev, expected.st_ino): os._exit(76)
g['atomic'] = interrupted_atomic; os.unlink = interrupted_unlink; os.rmdir = interrupted_rmdir
os.umask(0o077); i['uninstall'](Path(sys.argv[2]))
'''
        result = subprocess.run([sys.executable, '-c', script, str(Path(__file__).resolve().parents[1] / 'install.py'),
                                 str(self.root), point], capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 76, result.stderr)

    def test_removal_crash_after_journal_recovers_and_preserves_state(self):
        self.install()
        output = self.state / 'work-and-reservations'; output.write_bytes(b'committed')
        self.crash_removal('after-journal')
        with self.assertRaisesRegex(ValueError, 'RESUME_REMOVAL_FIRST'):
            I['installation'](self.root)
        result = I['recover_maintenance'](self.root)
        self.assertEqual(result['state'], 'removal-retry-required')
        self.assertFalse(result['authorityRestored'])
        I['uninstall'](self.root)
        self.assertFalse(self.root.exists())
        self.assertEqual(output.read_bytes(), b'committed')

    def test_removal_crash_during_member_deletion_is_resumable(self):
        self.install()
        self.crash_removal('during-files')
        self.assertTrue((self.root / 'pending-removal.json').exists())
        I['recover_maintenance'](self.root)
        I['uninstall'](self.root)
        self.assertFalse(self.root.exists())
        self.assertTrue(self.state.is_dir())

    def test_removal_crash_after_versions_deleted_is_resumable(self):
        self.install()
        self.crash_removal('after-versions')
        self.assertFalse((self.root / 'versions').exists())
        I['recover_maintenance'](self.root)
        I['uninstall'](self.root)
        self.assertFalse(self.root.exists())

    def test_removal_retry_rejects_changed_or_added_members_before_further_deletion(self):
        self.install()
        self.crash_removal('after-journal')
        _, plan = I['removal_plan'](self.root)
        owned = self.root / next(r['path'] for r in plan['files'] if r['path'].endswith('/LICENSE'))
        original = owned.read_bytes(); owned.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'REMOVAL_MEMBER_CHANGED'):
            I['recover_maintenance'](self.root)
        self.assertTrue((self.root / 'installation.json').exists())
        owned.write_bytes(original)
        unknown = self.root / 'operator-note'; unknown.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'UNOWNED_INSTALLATION_CONTENT'):
            I['recover_maintenance'](self.root)
        self.assertEqual(unknown.read_bytes(), b'keep')

    def test_pending_removal_cannot_be_started_with_a_live_owner(self):
        self.install()
        self.crash_removal('after-journal')
        lock = self.root / 'operation.lock' / 'owner.json'
        lock.write_text(json.dumps({'pid': os.getpid(), 'boot': I['boot_identity']()}))
        with self.assertRaisesRegex(ValueError, 'INSTALLATION_OPERATION_STILL_ACTIVE'):
            I['recover_maintenance'](self.root)

    def test_final_removal_crash_after_journal_unlink_can_finish_empty_root(self):
        self.install()
        output = self.state / 'committed'; output.write_bytes(b'keep')
        self.crash_removal('before-root-removal')
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertTrue(I['completion_path'](self.root).exists())
        result = I['uninstall'](self.root)
        self.assertFalse(result['authorityRestored'])
        self.assertFalse(self.root.exists())
        self.assertFalse(I['completion_path'](self.root).exists())
        self.assertEqual(output.read_bytes(), b'keep')

    def test_final_removal_crash_after_root_removal_can_finish_receipt(self):
        self.install()
        self.crash_removal('after-root-removal')
        self.assertFalse(self.root.exists())
        self.assertTrue(I['completion_path'](self.root).exists())
        result = I['recover_maintenance'](self.root)
        self.assertFalse(result['authorityRestored'])
        self.assertFalse(I['completion_path'](self.root).exists())
        self.assertTrue(self.state.exists())

    def test_final_removal_refuses_replaced_root_and_preserves_new_files(self):
        self.install()
        self.crash_removal('before-root-removal')
        self.root.rename(self.base / 'original-empty-root')
        self.root.mkdir(mode=0o700)
        note = self.root / 'committed'; note.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'INSTALLATION_DIRECTORY_CHANGED'):
            I['uninstall'](self.root)
        self.assertEqual(note.read_bytes(), b'keep')
        self.assertTrue(I['completion_path'](self.root).exists())

    def test_parent_symlink_swap_after_plan_never_deletes_outside_member(self):
        installed = self.install()
        version = self.root / 'versions' / installed['archiveSHA256']
        outside = self.base / 'outside-version'; (outside / 'application').mkdir(parents=True)
        target = outside / 'application' / 'LICENSE'; target.write_bytes(b'outside committed work')
        remove = G['remove_member']; swapped = False
        def swap_parent(root_fd, row, plan, directory=False):
            nonlocal swapped
            if not swapped and row['path'].endswith('/application/LICENSE'):
                swapped = True
                version.rename(self.base / 'retained-original-version')
                version.symlink_to(outside, target_is_directory=True)
            return remove(root_fd, row, plan, directory)
        with patch.dict(G, {'remove_member': swap_parent}):
            with self.assertRaisesRegex(ValueError, 'REMOVAL_PARENT_CHANGED'):
                I['uninstall'](self.root)
        self.assertTrue(swapped)
        self.assertEqual(target.read_bytes(), b'outside committed work')
        self.assertTrue(self.state.exists())

    def test_partial_completion_write_preserves_resumable_journal(self):
        self.install()
        dump = G['json'].dump
        def interrupted_dump(value, stream, *args, **kwargs):
            if value.get('schema') == 'agi-fleet/removal-completion/v1':
                stream.write('{')
                raise OSError('TEST_PARTIAL_COMPLETION_WRITE')
            return dump(value, stream, *args, **kwargs)
        with patch.object(G['json'], 'dump', interrupted_dump):
            with self.assertRaisesRegex(OSError, 'TEST_PARTIAL_COMPLETION_WRITE'):
                I['uninstall'](self.root)
        self.assertFalse(I['completion_path'](self.root).exists())
        self.assertTrue((self.root / 'pending-removal.json').is_file())
        self.assertFalse(list(self.base.glob('.agi-fleet-removal-*.tmp')))
        result = I['uninstall'](self.root)
        self.assertFalse(self.root.exists())
        self.assertTrue(self.state.exists())
        self.assertFalse(result['authorityRestored'])

    def test_receipt_owned_empty_code_file_can_be_removed_but_empty_metadata_stays_invalid(self):
        installed = self.install(self.archive(empty=True))
        empty = self.root / 'versions' / installed['archiveSHA256'] / 'application/local-runtime/empty-owned.txt'
        self.assertEqual(empty.read_bytes(), b'')
        metadata = self.root / 'installation.json'; original = metadata.read_bytes(); metadata.write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'REGULAR_BOUNDED_FILE_REQUIRED'):
            I['uninstall'](self.root)
        self.assertTrue(empty.exists()); metadata.write_bytes(original)
        output = self.state / 'kept-output'; output.write_bytes(b'keep')
        result = I['uninstall'](self.root)
        self.assertFalse(self.root.exists())
        self.assertFalse(result['credentialsDeleted'])
        self.assertEqual(output.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
