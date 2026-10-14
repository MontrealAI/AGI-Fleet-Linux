"""Transactional, unprivileged installation of an explicitly verified Local Skills package.

This module does not create accounts, install system packages, start services,
import credentials or activate actors. State is outside versioned application
directories and is never removed or rolled back by software maintenance.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
import unicodedata
import uuid
import zipfile

SCHEMA = 'agi-fleet/local-installation/v1'
CEILING = 450_000_000
ROOT = Path(__file__).resolve().parent.parent


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_JSON_KEY')
        value[key] = item
    return value


def read_json(data):
    return json.loads(data, object_pairs_hook=unique, parse_constant=lambda _: require(False, 'NONFINITE_JSON'))


def private(directory, create=False):
    directory = Path(directory).absolute()
    require(directory == directory.resolve(), 'PATH_ALIAS_FORBIDDEN')
    if create:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    s = directory.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and s.st_mode & 0o077 == 0, 'PRIVATE_DIRECTORY_REQUIRED')
    return directory


def regular(file, maximum=CEILING):
    s = file.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size < maximum, 'REGULAR_BOUNDED_FILE_REQUIRED')


def snapshot(source, target):
    """Validate only the private copy used for extraction, closing input races."""
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as src:
        before = os.fstat(src.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size < CEILING, 'REGULAR_BOUNDED_FILE_REQUIRED')
        with target.open('xb') as out:
            remaining = before.st_size
            while remaining:
                block = src.read(min(remaining, 1_048_576))
                require(block, 'ARCHIVE_CHANGED_DURING_COPY')
                out.write(block)
                remaining -= len(block)
            require(not src.read(1), 'ARCHIVE_CHANGED_DURING_COPY')
            out.flush()
            os.fsync(out.fileno())
        after = os.fstat(src.fileno())
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'ARCHIVE_CHANGED_DURING_COPY')


def sync_tree(directory):
    for file in directory.rglob('*'):
        if file.is_file():
            with file.open('rb') as stream:
                os.fsync(stream.fileno())
    for folder in [*sorted((x for x in directory.rglob('*') if x.is_dir()), reverse=True), directory]:
        fd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic(file, value):
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf8') as stream:
            os.chmod(temp, 0o600)
            json.dump(value, stream, sort_keys=True, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, file)
        fd = os.open(file.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


def inspect_archive(archive, expected):
    archive = Path(archive).absolute()
    regular(archive)
    require(re.fullmatch(r'[0-9a-f]{64}', expected) and sha(archive) == expected, 'ARCHIVE_SHA256_MISMATCH')
    with zipfile.ZipFile(archive) as z:
        names, folded, total = set(), set(), 0
        for info in z.infolist():
            name = info.filename
            p = PurePosixPath(name)
            require(not p.is_absolute() and str(p) == name and '\\' not in name and ':' not in name and '\x00' not in name, 'ARCHIVE_PATH_INVALID')
            require(all(x not in ('', '.', '..') and x == x.rstrip(' .') for x in p.parts), 'ARCHIVE_PATH_INVALID')
            require(unicodedata.normalize('NFC', name) == name and name.casefold() not in folded, 'ARCHIVE_PATH_COLLISION')
            require(stat.S_ISREG(info.external_attr >> 16) and stat.S_IMODE(info.external_attr >> 16) in (0o644, 0o755), 'ARCHIVE_MODE_INVALID')
            require(not info.flag_bits & 1 and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'ARCHIVE_ENCODING_INVALID')
            require(0 <= info.file_size < CEILING, 'ARCHIVE_MEMBER_LIMIT')
            total += info.file_size
            names.add(name)
            folded.add(name.casefold())
        require(0 < len(names) <= 25_000 and total < CEILING, 'ARCHIVE_EXPANSION_LIMIT')
        manifests = [x for x in names if re.fullmatch(r'agi-fleet-local-[0-9A-Za-z.-]+/local-preview-manifest.json', x)]
        require(len(manifests) == 1, 'MANIFEST_REQUIRED')
        manifest_name = manifests[0]
        require(z.getinfo(manifest_name).file_size < 4_000_000, 'MANIFEST_LIMIT')
        m = read_json(z.read(manifest_name))
        require(m.get('schema') == 'agi-fleet/local-source-preview/v1' and m.get('productionQualified') is False, 'MANIFEST_SCHEMA')
        require(re.fullmatch(r'[0-9a-f]{40}', m.get('commit', '')) and type(m.get('workingTreeDirty')) is bool, 'MANIFEST_SOURCE')
        prefix = manifest_name.split('/')[0]
        require(prefix == 'agi-fleet-local-' + m.get('version', ''), 'MANIFEST_VERSION')
        expected_names = {manifest_name}
        for row in m['files']:
            require(set(row) == {'path', 'bytes', 'sha256', 'mode'}, 'MANIFEST_ENTRY')
            name = prefix + '/' + row['path']
            require(name in names and name not in expected_names, 'MANIFEST_COVERAGE')
            expected_names.add(name)
            info = z.getinfo(name)
            require(type(row['bytes']) is int and type(row['mode']) is int and info.file_size == row['bytes'], 'MANIFEST_SIZE')
            require(stat.S_IMODE(info.external_attr >> 16) == row['mode'], 'MANIFEST_MODE')
            with z.open(info) as stream:
                require(hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256'], 'MANIFEST_SHA256')
        require(expected_names == names and z.testzip() is None, 'MANIFEST_COVERAGE')
        require({prefix + '/local-runtime/cli/main.mjs', prefix + '/local-runtime/validate.mjs', prefix + '/LICENSE'} <= names, 'RUNTIME_INCOMPLETE')
    return m, prefix


def node_pin():
    system = {'Linux': 'linux', 'Darwin': 'darwin'}.get(platform.system())
    machine = {'x86_64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(platform.machine())
    require(system == 'linux' and machine in ('x64', 'arm64') or system == 'darwin' and machine == 'arm64', 'PLATFORM_UNSUPPORTED')
    pins = read_json((ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json').read_bytes())['node']
    item = next(x for x in pins['archives'] if x['platform'] == system + '-' + machine)
    return item, pins['preferredVersion']


def install_node(archive, destination):
    pin, version = node_pin()
    regular(archive)
    require(sha(archive) == pin['sha256'], 'NODE_ARCHIVE_SHA256_MISMATCH')
    prefix = 'node-v' + version + '-' + pin['platform']
    destination.mkdir(mode=0o700)
    with tarfile.open(archive, 'r:xz') as t:
        for source, target, mode in [(prefix + '/bin/node', destination / 'node', 0o755), (prefix + '/LICENSE', destination / 'LICENSE', 0o644)]:
            members = [x for x in t.getmembers() if x.name == source]
            require(len(members) == 1 and members[0].isfile() and 0 < members[0].size < CEILING, 'NODE_MEMBER_INVALID')
            with t.extractfile(members[0]) as src, target.open('xb') as out:
                shutil.copyfileobj(src, out)
            os.chmod(target, mode)
    result = subprocess.run([str(destination / 'node'), '--version'], env={'PATH': '/usr/bin:/bin', 'NODE_OPTIONS': ''}, capture_output=True, text=True, timeout=10, check=True)
    require(result.stdout.strip() == 'v' + version, 'NODE_VERSION_MISMATCH')
    return {'version': version, 'platform': pin['platform'], 'archiveSHA256': pin['sha256'], 'binarySHA256': sha(destination / 'node'), 'licenseSHA256': sha(destination / 'LICENSE')}


def boot_identity():
    if platform.system() == 'Linux':
        return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if platform.system() == 'Darwin':
        return subprocess.check_output(['/usr/sbin/sysctl', '-n', 'kern.boottime'], text=True, timeout=5).strip()
    raise ValueError('PLATFORM_UNSUPPORTED')


@contextlib.contextmanager
def maintenance(root, recover=False):
    lock = root / 'operation.lock'
    if recover and lock.exists():
        private(lock)
        require(set(x.name for x in lock.iterdir()) == {'owner.json'}, 'LOCK_OWNERSHIP_UNKNOWN')
        regular(lock / 'owner.json', 4096)
        owner = read_json((lock / 'owner.json').read_bytes())
        require(type(owner.get('pid')) is int and owner['pid'] > 1 and isinstance(owner.get('boot'), str), 'LOCK_OWNERSHIP_UNKNOWN')
        if owner['boot'] == boot_identity():
            try:
                os.kill(owner['pid'], 0)
            except ProcessLookupError:
                pass
            else:
                raise ValueError('INSTALLATION_OPERATION_STILL_ACTIVE')
        (lock / 'owner.json').unlink()
        lock.rmdir()
    lock.mkdir(mode=0o700)  # Atomic exclusion shared with the installed launcher.
    try:
        atomic(lock / 'owner.json', {'pid': os.getpid(), 'boot': boot_identity()})
        yield
    finally:
        (lock / 'owner.json').unlink(missing_ok=True)
        lock.rmdir()


def installation(root, allow_pending=False):
    root = private(root)
    require(allow_pending or not os.path.lexists(root / 'pending-install.json'), 'RECOVER_INSTALLATION_FIRST')
    file = root / 'installation.json'
    regular(file, 100_000)
    m = read_json(file.read_bytes())
    require(m.get('schema') == SCHEMA and m.get('root') == str(root), 'INSTALLATION_NOT_OWNED')
    require(isinstance(m.get('versions'), list) and len(m['versions']) == len(set(m['versions']))
            and all(isinstance(x, str) and re.fullmatch(r'[0-9a-f]{64}', x) for x in m['versions'])
            and m.get('current') in m['versions'] and type(m.get('generation')) is int and m['generation'] > 0,
            'INSTALLATION_VERSION_INVALID')
    private(m['state'])
    require(not Path(m['state']).is_relative_to(root), 'STATE_MUST_BE_OUTSIDE_INSTALLATION')
    return root, m


def directory_identity(directory):
    s = private(directory).stat()
    return [s.st_dev, s.st_ino]


def pending_installation(root):
    """A pre-install journal binds recovery to the original private directories."""
    root = private(root)
    file = root / 'pending-install.json'
    regular(file, 4096)
    s = file.lstat()
    require(s.st_uid == os.getuid() and s.st_mode & 0o077 == 0, 'INSTALLATION_JOURNAL_INVALID')
    m = read_json(file.read_bytes())
    require(set(m) == {'schema', 'root', 'state', 'rootIdentity', 'stateIdentity', 'archiveSHA256', 'pid', 'boot', 'resumable'}
            and m['schema'] == 'agi-fleet/pending-installation/v1' and m['root'] == str(root)
            and type(m['pid']) is int and m['pid'] > 1 and isinstance(m['boot'], str) and m['boot']
            and type(m['resumable']) is bool and isinstance(m['archiveSHA256'], str)
            and re.fullmatch(r'[a-f0-9]{64}', m['archiveSHA256']), 'INSTALLATION_JOURNAL_INVALID')
    state = private(m['state'])
    require(not root.is_relative_to(ROOT) and not state.is_relative_to(ROOT)
            and not state.is_relative_to(root) and not root.is_relative_to(state), 'INSTALLATION_PATH_SCOPE')
    require(m['rootIdentity'] == directory_identity(root) and m['stateIdentity'] == directory_identity(state), 'INSTALLATION_DIRECTORY_CHANGED')
    return root, m


def require_dead_owner(record):
    if record['boot'] == boot_identity():
        try:
            os.kill(record['pid'], 0)
        except ProcessLookupError:
            pass
        else:
            raise ValueError('INSTALLATION_OPERATION_STILL_ACTIVE')


def quiescent(state, reserved=False):
    state = private(state)
    require(reserved or not os.path.lexists(state / 'control.sock'), 'STOP_SUPERVISOR_BEFORE_MAINTENANCE')
    file = state / 'ledger.sqlite'
    if not file.exists():
        return
    regular(file, 256_000_000)
    with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True) as db:
        require(not db.execute("SELECT 1 FROM runs WHERE state IN ('running','uncertain')").fetchone(), 'RECONCILE_OBLIGATIONS_FIRST')
        require(not db.execute("SELECT 1 FROM grants WHERE state IN ('prepared','authorized')").fetchone(), 'REVOKE_PENDING_GRANTS_FIRST')


@contextlib.contextmanager
def reserve_state(state):
    """Reserve the exact CLI socket path atomically, including raw CLI launches.

    A regular private marker cannot accept requests, and the server cannot bind
    over it. Never remove a live or pre-existing socket to acquire this fence.
    """
    state = private(state)
    socket = state / 'control.sock'
    try:
        fd = os.open(socket, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        raise ValueError('STOP_SUPERVISOR_BEFORE_MAINTENANCE') from None
    identity = os.fstat(fd)
    try:
        data = {'schema': 'agi-fleet/state-maintenance/v1', 'pid': os.getpid(), 'boot': boot_identity(), 'state': str(state)}
        os.write(fd, json.dumps(data).encode())
        os.fsync(fd)
        quiescent(state, reserved=True)
        yield
    finally:
        os.close(fd)
        current = socket.lstat()
        require(stat.S_ISREG(current.st_mode) and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino), 'MAINTENANCE_FENCE_CHANGED')
        socket.unlink()


def recover_maintenance(root):
    root = private(root)
    incomplete = not (root / 'installation.json').exists()
    journal = pending_installation(root)[1] if incomplete or (root / 'pending-install.json').exists() else None
    if journal:
        require_dead_owner(journal)
    root, m = (root, journal) if incomplete else installation(root, allow_pending=True)
    if journal and not incomplete:
        require(journal['state'] == m['state'] and journal['archiveSHA256'] == m['current'], 'INSTALLATION_JOURNAL_INVALID')
    with maintenance(root, recover=True):
        require(incomplete == (not (root / 'installation.json').exists()), 'INSTALLATION_JOURNAL_CHANGED')
        if journal:
            require(pending_installation(root)[1] == journal, 'INSTALLATION_JOURNAL_CHANGED')
        if not incomplete:
            require(installation(root, allow_pending=True)[1] == m, 'INSTALLATION_JOURNAL_CHANGED')
        socket = Path(m['state']) / 'control.sock'
        if socket.exists():
            regular(socket, 4096)
            s = socket.lstat()
            require(s.st_uid == os.getuid() and s.st_mode & 0o077 == 0, 'MAINTENANCE_OWNERSHIP_UNKNOWN')
            record = read_json(socket.read_bytes())
            require(set(record) == {'schema', 'pid', 'boot', 'state'} and record['schema'] == 'agi-fleet/state-maintenance/v1'
                    and record['state'] == m['state'] and type(record['pid']) is int and record['pid'] > 1, 'MAINTENANCE_OWNERSHIP_UNKNOWN')
            if record['boot'] == boot_identity():
                try:
                    os.kill(record['pid'], 0)
                except ProcessLookupError:
                    pass
                else:
                    raise ValueError('INSTALLATION_OPERATION_STILL_ACTIVE')
            current = socket.lstat()
            require((current.st_dev, current.st_ino) == (s.st_dev, s.st_ino), 'MAINTENANCE_FENCE_CHANGED')
            socket.unlink()
        if journal:
            if incomplete:
                journal['resumable'] = True
                atomic(root / 'pending-install.json', journal)
            else:
                (root / 'pending-install.json').unlink()
    return {'state': 'installation-retry-required' if incomplete else 'maintenance-unlocked', 'authorityRestored': False,
            'replayed': False, 'stagingContentDeleted': False,
            'next': 'Repeat install with the same archive, root and state. Unknown files and staging content remain preserved.' if incomplete
            else 'Run recover-service --confirm before restarting; inspect any unselected staging content.'}


def stage(archive, expected, node_archive, root):
    directory = Path(tempfile.mkdtemp(prefix='stage-', dir=root))
    try:
        snapshot(archive, directory / 'package.zip')
        snapshot(node_archive, directory / 'node.tar.xz')
        manifest, prefix = inspect_archive(directory / 'package.zip', expected)
        app = directory / 'application'
        app.mkdir(mode=0o700)
        with zipfile.ZipFile(directory / 'package.zip') as z:
            for info in z.infolist():
                relative = PurePosixPath(info.filename).relative_to(prefix)
                target = app.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with z.open(info) as src, target.open('xb') as out:
                    shutil.copyfileobj(src, out)
                os.chmod(target, stat.S_IMODE(info.external_attr >> 16))
        node = install_node(directory / 'node.tar.xz', directory / 'runtime')
        subprocess.run([str(directory / 'runtime/node'), '--check', str(app / 'local-runtime/cli/main.mjs')], env={'PATH': '/usr/bin:/bin', 'NODE_OPTIONS': ''}, check=True, capture_output=True, timeout=10)
        receipt = {'archiveSHA256': expected, 'sourceCommit': manifest['commit'], 'version': manifest['version'], 'node': node,
                   'manifestSHA256': sha(app / 'local-preview-manifest.json'),
                   'classification': 'development-package', 'productionQualified': False}
        atomic(directory / 'receipt.json', receipt)
        (directory / 'package.zip').unlink()
        (directory / 'node.tar.xz').unlink()
        sync_tree(directory)
        return directory, receipt
    except BaseException:
        shutil.rmtree(directory)
        raise


def install(archive, expected, node_archive, root, state, update=False):
    root, state = Path(root).absolute(), Path(state).absolute()
    require(not root.is_relative_to(ROOT) and not state.is_relative_to(ROOT)
            and not state.is_relative_to(root) and not root.is_relative_to(state), 'INSTALLATION_PATH_SCOPE')
    inspect_archive(archive, expected)  # No installation paths exist before validation.
    fresh = False
    if update:
        root, metadata = installation(root)
        require(str(state) == metadata['state'], 'STATE_IDENTITY_CHANGED')
    else:
        if root.exists() or state.exists():
            require(root.exists() and not (root / 'installation.json').exists(), 'FRESH_INSTALL_REQUIRED')
            _, journal = pending_installation(root)
            require(journal['resumable'] and journal['state'] == str(state) and journal['archiveSHA256'] == expected,
                    'RECOVER_MATCHING_INSTALLATION_FIRST')
        else:
            private(root, create=True)
            private(state, create=True)
            journal = {'schema': 'agi-fleet/pending-installation/v1', 'root': str(root), 'state': str(state),
                       'rootIdentity': directory_identity(root), 'stateIdentity': directory_identity(state),
                       'archiveSHA256': expected, 'pid': os.getpid(), 'boot': boot_identity(), 'resumable': False}
            atomic(root / 'pending-install.json', journal)  # Durable before either maintenance fence.
            fresh = True
        metadata = {'schema': SCHEMA, 'root': str(root), 'state': str(state), 'versions': [], 'current': None, 'generation': 0}
    try:
        with maintenance(root):
            if not update:
                _, observed = pending_installation(root)
                require(observed == journal, 'INSTALLATION_JOURNAL_CHANGED')
                require(not any(state.iterdir()), 'FRESH_STATE_REQUIRED')
                journal.update(pid=os.getpid(), boot=boot_identity(), resumable=False)
                atomic(root / 'pending-install.json', journal)
            with reserve_state(state):
                result = install_version(archive, expected, node_archive, root, state, metadata, update=update)
            if not update:
                (root / 'pending-install.json').unlink()
            return result
    except BaseException:
        if fresh and not (root / 'installation.json').exists():
            versions = root / 'versions'
            if versions.exists() and not any(versions.iterdir()):
                versions.rmdir()
            # Normal failure can remove only our journal and empty directories.
            # Crash recovery retains all unknown or partially staged content.
            if set(x.name for x in root.iterdir()) == {'pending-install.json'} and not any(state.iterdir()):
                (root / 'pending-install.json').unlink()
                root.rmdir()
                state.rmdir()
        raise


def install_version(archive, expected, node_archive, root, state, metadata, update):
    target = root / 'versions' / expected
    require(not update or not target.exists(), 'VERSION_ALREADY_INSTALLED')
    staged = None
    if target.exists():
        receipt = verify_version(root, expected)  # Crash after rename, before pointer commit.
    else:
        staged, receipt = stage(archive, expected, Path(node_archive), root)
    try:
        target.parent.mkdir(exist_ok=True, mode=0o700)
        if staged:
            staged.rename(target)
        metadata['versions'].append(expected)
        metadata['previous'] = metadata['current']
        metadata['current'] = expected
        metadata['generation'] += 1
        atomic(root / 'installation.json', metadata)
    except BaseException:
        # A failed switch preserves the old pointer. If the new pointer
        # reached disk, leave that complete version available to inspect.
        selected = read_json((root / 'installation.json').read_bytes()).get('current') if (root / 'installation.json').exists() else None
        if staged and target.exists() and selected != expected:
            verify_version(root, expected)
            shutil.rmtree(target)
        raise
    finally:
        if staged and staged.exists():
            shutil.rmtree(staged)
    return {**receipt, 'installation': str(root), 'state': str(state), 'started': False, 'authority': 'none'}

def verify_version(root, version):
    require(re.fullmatch(r'[0-9a-f]{64}', version), 'VERSION_NOT_OWNED')
    folder = root / 'versions' / version
    require(folder.resolve() == folder and set(x.name for x in folder.iterdir()) == {'application', 'runtime', 'receipt.json'}, 'UNOWNED_VERSION_CONTENT')
    regular(folder / 'receipt.json', 100_000)
    receipt = read_json((folder / 'receipt.json').read_bytes())
    require(receipt['archiveSHA256'] == version, 'VERSION_RECEIPT_MISMATCH')
    app = folder / 'application'
    manifest_file = app / 'local-preview-manifest.json'
    regular(manifest_file, 4_000_000)
    require(sha(manifest_file) == receipt['manifestSHA256'], 'INSTALLED_MANIFEST_CHANGED')
    manifest = read_json(manifest_file.read_bytes())
    expected = {'local-preview-manifest.json'}
    directories = set()
    for row in manifest['files']:
        file = app / row['path']
        require(file.resolve() == file and file.is_relative_to(app), 'INSTALLED_PATH_ALIAS')
        s = file.lstat()
        require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size == row['bytes']
                and stat.S_IMODE(s.st_mode) == row['mode'] and sha(file) == row['sha256'], 'INSTALLED_SOURCE_CHANGED')
        expected.add(row['path'])
        directories.update(p.as_posix() for p in PurePosixPath(row['path']).parents if str(p) != '.')
    actual = set()
    actual_directories = set()
    for file in app.rglob('*'):
        require(not file.is_symlink(), 'INSTALLED_PATH_ALIAS')
        if file.is_file():
            actual.add(file.relative_to(app).as_posix())
        elif file.is_dir():
            actual_directories.add(file.relative_to(app).as_posix())
        else:
            raise ValueError('UNOWNED_APPLICATION_CONTENT')
    require(actual == expected and actual_directories == directories, 'UNOWNED_APPLICATION_CONTENT')
    require(set(x.name for x in (folder / 'runtime').iterdir()) == {'node', 'LICENSE'}, 'UNOWNED_RUNTIME_CONTENT')
    regular(folder / 'runtime/node')
    require(sha(folder / 'runtime/node') == receipt['node']['binarySHA256'], 'NODE_IDENTITY_CHANGED')
    require(stat.S_IMODE((folder / 'runtime/node').stat().st_mode) == 0o755, 'NODE_MODE_CHANGED')
    regular(folder / 'runtime/LICENSE')
    require(sha(folder / 'runtime/LICENSE') == receipt['node']['licenseSHA256'], 'NODE_LICENSE_CHANGED')
    return receipt


def select(root, target):
    root, m = installation(root)
    with maintenance(root), reserve_state(m['state']):
        require(re.fullmatch(r'[0-9a-f]{64}', target) and target in m['versions'], 'VERSION_NOT_OWNED')
        verify_version(root, target)
        m['previous'], m['current'] = m['current'], target
        m['generation'] += 1
        atomic(root / 'installation.json', m)
    return {'current': target, 'stateRestored': False, 'authorityRestored': False, 'generation': m['generation']}


def launch(root, args):
    root, m = installation(root)
    require(args and args[0] in ('init', 'serve', 'status', 'doctor', 'request', 'help', 'recover-service'), 'COMMAND_REQUIRED')
    version = root / 'versions' / m['current']
    node = version / 'runtime/node'
    verify_version(root, m['current'])
    env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(Path.home()), 'AGI_LOCAL_STATE': m['state'], 'NODE_OPTIONS': ''}
    # The operator credential remains in its private state directory.
    context = maintenance(root, recover=args[0] == 'recover-service') if args[0] in ('init', 'serve', 'recover-service') else contextlib.nullcontext()
    with context:
        if args[0] == 'init':
            require(not any(Path(m['state']).iterdir()), 'FRESH_STATE_REQUIRED')
            Path(m['state']).rmdir()  # Runtime init owns creation, with the same 0700 contract.
        return subprocess.call([str(node), str(version / 'application/local-runtime/cli/main.mjs'), *args], env=env)


def uninstall(root):
    root, m = installation(root)
    with maintenance(root), reserve_state(m['state']):
        expected = {'installation.json', 'versions', 'operation.lock'}
        require(set(x.name for x in root.iterdir()) == expected, 'UNOWNED_INSTALLATION_CONTENT')
        require(set(x.name for x in (root / 'versions').iterdir()) == set(m['versions']), 'UNOWNED_VERSION_CONTENT')
        # Remove only receipt-bound code versions. Leave the authority ledger,
        # operator recovery data and all external deliverables untouched.
        for version in m['versions']:
            require(re.fullmatch(r'[0-9a-f]{64}', version), 'VERSION_NOT_OWNED')
            verify_version(root, version)
        for version in m['versions']:
            shutil.rmtree(root / 'versions' / version)
        (root / 'versions').rmdir()
        (root / 'installation.json').unlink()
    root.rmdir()
    return {'removed': str(root), 'preservedState': m['state'], 'credentialsDeleted': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['inspect', 'install', 'update', 'rollback', 'launch', 'uninstall', 'recover-maintenance'])
    p.add_argument('--archive', type=Path)
    p.add_argument('--sha256')
    p.add_argument('--node-archive', type=Path)
    p.add_argument('--root', type=Path)
    p.add_argument('--state', type=Path)
    p.add_argument('--version')
    p.add_argument('--confirm', action='store_true')
    a, arguments = p.parse_known_args()
    require(a.action == 'launch' or not arguments, 'UNKNOWN_ARGUMENTS')
    if a.action == 'inspect':
        m, _ = inspect_archive(a.archive, a.sha256)
        result = {'version': m['version'], 'commit': m['commit'], 'files': len(m['files']), 'productionQualified': False, 'authority': 'none'}
    elif a.action == 'launch':
        raise SystemExit(launch(a.root, arguments[1:] if arguments[:1] == ['--'] else arguments))
    else:
        require(a.confirm, 'CONFIRM_REQUIRED')
        if a.action in ('install', 'update'):
            require(a.archive and a.sha256 and a.node_archive and a.root and a.state, 'INSTALL_ARGUMENTS_REQUIRED')
            result = install(a.archive, a.sha256, a.node_archive, a.root, a.state, update=a.action == 'update')
        elif a.action == 'rollback':
            result = select(a.root, a.version)
        elif a.action == 'recover-maintenance':
            result = recover_maintenance(a.root)
        else:
            result = uninstall(a.root)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, subprocess.SubprocessError) as e:
        raise SystemExit('Local installation stopped: ' + str(e))
