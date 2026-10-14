"""Installer fault/security cases; the installed-runtime journey is a separate native gate."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import sqlite3
import stat
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

    def archive(self, name='one', extra=None):
        entries = {'LICENSE': b'Installer fixture only\n', 'local-runtime/validate.mjs': b'export const fixture=true;\n',
                   'local-runtime/cli/main.mjs': ('// Syntax-check fixture ' + name + '\n').encode()}
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


if __name__ == '__main__':
    unittest.main()
