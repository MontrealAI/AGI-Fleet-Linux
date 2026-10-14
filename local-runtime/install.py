"""Transactional, unprivileged installation of an explicitly verified Local Skills package.

This module does not create accounts, install system packages, start services,
import credentials or activate actors. State is outside versioned application
directories and is never removed or rolled back by software maintenance.
"""
import argparse
import contextlib
import ctypes
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


def regular(file, maximum=CEILING, allow_empty=False):
    s = file.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and (0 <= s.st_size if allow_empty else 0 < s.st_size) and s.st_size < maximum, 'REGULAR_BOUNDED_FILE_REQUIRED')


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


def preflight(archive, expected, node_archive, root, state, update=False):
    """Inspect prerequisites without creating paths, locks or executing packages."""
    checks, verified_node = [], None
    def check(name, fn, help):
        try:
            value = fn()
            checks.append({'prerequisite': name, 'status': 'present', 'detail': value})
            return value
        except (ValueError, OSError, KeyError, TypeError, StopIteration, zipfile.BadZipFile, tarfile.TarError) as e:
            checks.append({'prerequisite': name, 'status': 'blocked', 'code': str(e), 'next': help})
    manifest = check('package identity', lambda: inspect_archive(archive, expected)[0], 'Supply the reviewed Local Skills ZIP and its independently verified digest.')
    if manifest:
        checks[-1]['detail'] = {'commit': manifest['commit'], 'version': manifest['version'], 'archiveSHA256': expected}
    pin = check('platform and pinned Node', node_pin, 'Use a supported Linux x64/ARM64 host. Native Mac execution remains unimplemented.')
    if pin:
        item, version = pin
        checks[-1]['detail'] = {'platform': item['platform'], 'version': version}
        def node_identity():
            regular(Path(node_archive))
            require(sha(node_archive) == item['sha256'], 'NODE_ARCHIVE_SHA256_MISMATCH')
            return {'archiveSHA256': item['sha256']}
        verified_node = check('Node archive identity', node_identity, 'Download the exact platform archive recorded in runtime-artifacts.lock.json.')
    root, state = Path(root).absolute(), Path(state).absolute()
    def paths():
        require(root == root.resolve() and state == state.resolve(), 'PATH_ALIAS_FORBIDDEN')
        require(not root.is_relative_to(ROOT) and not state.is_relative_to(ROOT)
                and not state.is_relative_to(root) and not root.is_relative_to(state), 'INSTALLATION_PATH_SCOPE')
        if update:
            _, m = installation(root)
            require(m['state'] == str(state), 'STATE_IDENTITY_CHANGED')
            require(not os.path.lexists(state / 'control.sock'), 'STOP_SUPERVISOR_BEFORE_MAINTENANCE')
        else:
            require(not root.exists() and not state.exists(), 'FRESH_INSTALL_REQUIRED')
        for path in (root, state):
            ancestor = path
            while not ancestor.exists():
                ancestor = ancestor.parent
            require(ancestor.is_dir() and os.access(ancestor, os.W_OK | os.X_OK), 'PARENT_NOT_WRITABLE')
        return {'root': str(root), 'state': str(state), 'mode': 'update' if update else 'fresh-install'}
    check('private installation paths', paths, 'Choose separate fresh writable directories; stop the existing service before update. Run as the standard compute user.')
    if manifest and pin and verified_node:
        def storage():
            prefix = 'node-v' + version + '-' + item['platform']
            with tarfile.open(node_archive, 'r:xz') as archive_file:
                node_bytes = sum(archive_file.getmember(prefix + '/' + name).size for name in ('bin/node', 'LICENSE'))
            required = sum(row['bytes'] for row in manifest['files']) + Path(archive).stat().st_size + Path(node_archive).stat().st_size + node_bytes + 1_048_576
            ancestor = root
            while not ancestor.exists():
                ancestor = ancestor.parent
            free = shutil.disk_usage(ancestor).free
            require(free >= required, 'INSUFFICIENT_STAGE_DISK_SPACE')
            return {'stagingRequiredBytes': required, 'availableBytes': free, 'reservation': False}
        check('staging disk capacity', storage, 'Free sufficient space for the verified package, pinned runtime and staged extracted files; this inspection does not reserve storage.')
    for executable in ('/usr/bin/bwrap', '/usr/bin/prlimit'):
        def executable_identity(file=Path(executable)):
            require(platform.system() == 'Linux', 'LOCAL_EXECUTION_BACKEND_UNIMPLEMENTED')
            s = file.stat()
            require(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022 and os.access(file, os.X_OK), 'SANDBOX_PREREQUISITE_MISSING_OR_UNTRUSTED')
            return str(file)
        check(executable, executable_identity, 'An administrator may install the documented distribution bubblewrap/util-linux prerequisites. Fleet remains a standard-user process; do not disable OS safeguards.')
    if platform.system() == 'Linux':
        for file in ('/proc/sys/kernel/unprivileged_userns_clone', '/proc/sys/user/max_user_namespaces'):
            if Path(file).exists():
                def namespace_setting(path=Path(file)):
                    value = int(path.read_text().strip())
                    require(value > 0, 'SANDBOX_NAMESPACE_DISABLED')
                    return value
                check(file, namespace_setting, 'Use a host with supported isolation policy; do not turn off safeguards to force admission.')
    return {'schema': 'agi-fleet/local-install-preflight/v1', 'readOnly': True, 'hostModified': False,
            'readyForInstallInspection': all(x['status'] == 'present' for x in checks), 'checks': checks,
            'runtimeAdmission': 'NOT_RUN; run installed doctor and fresh task admission', 'productionQualified': False,
            'authority': 'none', 'administratorRequiredForInstaller': False, 'runAs': 'standard compute user',
            'provider': 'NOT_INSPECTED', 'crossHostAuthorityRestore': 'BLOCKED_NOT_IMPLEMENTED'}


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
    require(not os.path.lexists(completion_path(root)), 'RESUME_REMOVAL_FIRST')
    require(not os.path.lexists(root / 'pending-removal.json'), 'RESUME_REMOVAL_FIRST')
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


def release_dead_fence(state):
    socket = state / 'control.sock'
    if not os.path.lexists(socket):
        return
    regular(socket, 4096)
    s = socket.lstat()
    require(s.st_uid == os.getuid() and s.st_mode & 0o077 == 0, 'MAINTENANCE_OWNERSHIP_UNKNOWN')
    record = read_json(socket.read_bytes())
    require(set(record) == {'schema', 'pid', 'boot', 'state'} and record['schema'] == 'agi-fleet/state-maintenance/v1'
            and record['state'] == str(state) and type(record['pid']) is int and record['pid'] > 1,
            'MAINTENANCE_OWNERSHIP_UNKNOWN')
    require_dead_owner(record)
    current = socket.lstat()
    require((current.st_dev, current.st_ino) == (s.st_dev, s.st_ino), 'MAINTENANCE_FENCE_CHANGED')
    socket.unlink()


def removal_plan(root):
    root = private(root)
    journal = root / 'pending-removal.json'
    regular(journal, 16_000_000)
    s = journal.lstat()
    require(s.st_uid == os.getuid() and s.st_mode & 0o077 == 0, 'REMOVAL_JOURNAL_INVALID')
    m = read_json(journal.read_bytes())
    require(set(m) == {'schema', 'root', 'state', 'rootIdentity', 'stateIdentity', 'files', 'directories'}
            and m['schema'] == 'agi-fleet/pending-removal/v1' and m['root'] == str(root), 'REMOVAL_JOURNAL_INVALID')
    state = private(m['state'])
    require(not state.is_relative_to(root) and not root.is_relative_to(state)
            and m['rootIdentity'] == directory_identity(root) and m['stateIdentity'] == directory_identity(state),
            'INSTALLATION_DIRECTORY_CHANGED')
    expected = {'pending-removal.json', 'operation.lock', 'operation.lock/owner.json'}
    require(isinstance(m['files'], list) and isinstance(m['directories'], list)
            and 0 < len(m['files']) + len(m['directories']) <= 100_000, 'REMOVAL_JOURNAL_INVALID')
    for kind, rows in [('file', m['files']), ('directory', m['directories'])]:
        for row in rows:
            fields = {'path', 'identity', 'sha256', 'mode'} if kind == 'file' else {'path', 'identity'}
            require(set(row) == fields and isinstance(row['path'], str), 'REMOVAL_JOURNAL_INVALID')
            relative = row['path']
            p = PurePosixPath(relative)
            require(str(p) == relative and not p.is_absolute() and all(x not in ('.', '..') for x in p.parts)
                    and (relative == 'installation.json' and kind == 'file' or relative == 'versions' and kind == 'directory'
                         or re.fullmatch(r'versions/[a-f0-9]{64}(?:/[^\\\x00]+)?', relative))
                    and relative not in expected, 'REMOVAL_PATH_INVALID')
            expected.add(relative)
            file = root / relative
            require(file.resolve() == file, 'INSTALLED_PATH_ALIAS')
            if not os.path.lexists(file):
                continue  # Only journaled members already removed may be absent.
            s = file.lstat()
            require([s.st_dev, s.st_ino] == row['identity'] and s.st_uid == os.getuid(), 'REMOVAL_MEMBER_CHANGED')
            if kind == 'directory':
                require(stat.S_ISDIR(s.st_mode), 'REMOVAL_MEMBER_CHANGED')
            else:
                regular(file, allow_empty=True)
                require(stat.S_IMODE(s.st_mode) == row['mode'] and sha(file) == row['sha256'], 'REMOVAL_MEMBER_CHANGED')
    require(all(file.relative_to(root).as_posix() in expected for file in root.rglob('*')), 'UNOWNED_INSTALLATION_CONTENT')
    return root, m


def recover_maintenance(root):
    if os.path.lexists(completion_path(Path(root).absolute())):
        return finalize_removal(Path(root).absolute())
    root = private(root)
    if os.path.lexists(root / 'pending-removal.json'):
        _, removal = removal_plan(root)
        with maintenance(root, recover=True):
            release_dead_fence(Path(removal['state']))
        return {'state': 'removal-retry-required', 'authorityRestored': False, 'replayed': False,
                'next': 'Repeat uninstall with the same root and --confirm; committed state remains preserved.'}
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
        release_dead_fence(Path(m['state']))
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


@contextlib.contextmanager
def directory_fd(path):
    path = Path(path).absolute()
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


@contextlib.contextmanager
def removal_parent(root_fd, row, plan):
    expected = {r['path']: r['identity'] for r in plan['directories']}
    parts = PurePosixPath(row['path']).parts
    fd = os.dup(root_fd)
    try:
        for i, part in enumerate(parts[:-1]):
            try:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                yield None
                return
            except OSError:
                raise ValueError('REMOVAL_PARENT_CHANGED') from None
            os.close(fd)
            fd = next_fd
            s = os.fstat(fd)
            require([s.st_dev, s.st_ino] == expected.get('/'.join(parts[:i + 1])) and s.st_uid == os.getuid(), 'REMOVAL_PARENT_CHANGED')
        yield fd
    finally:
        os.close(fd)


def remove_member(root_fd, row, plan, directory=False):
    with removal_parent(root_fd, row, plan) as parent:
        if parent is None:
            return
        name = PurePosixPath(row['path']).name
        try:
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return
        require([before.st_dev, before.st_ino] == row['identity'] and before.st_uid == os.getuid(), 'REMOVAL_MEMBER_CHANGED')
        if directory:
            require(stat.S_ISDIR(before.st_mode), 'REMOVAL_MEMBER_CHANGED')
        else:
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == row['mode'], 'REMOVAL_MEMBER_CHANGED')
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, 'rb') as stream:
                opened = os.fstat(stream.fileno())
                require((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino)
                        and hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256'], 'REMOVAL_MEMBER_CHANGED')
                after = os.fstat(stream.fileno())
                require((opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'REMOVAL_MEMBER_CHANGED')
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        require((current.st_dev, current.st_ino, current.st_mode) == (before.st_dev, before.st_ino, before.st_mode), 'REMOVAL_MEMBER_CHANGED')
        # Descriptor-relative deletion never follows a replaced parent symlink.
        (os.rmdir if directory else os.unlink)(name, dir_fd=parent)
        os.fsync(parent)


def completion_path(root):
    return root.with_name(root.name + '.removal.json')


def finalize_removal(root, plan=None):
    root = Path(root).absolute()
    receipt = completion_path(root)
    with directory_fd(root.parent) as parent:
        parent_stat = os.fstat(parent)
        if plan is not None:
            value = {'schema': 'agi-fleet/removal-completion/v1', 'root': str(root), 'state': plan['state'],
                     'rootIdentity': plan['rootIdentity'], 'stateIdentity': plan['stateIdentity'],
                     'parentIdentity': [parent_stat.st_dev, parent_stat.st_ino]}
            temporary = '.agi-fleet-removal-' + uuid.uuid4().hex + '.tmp'
            try:
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
                with os.fdopen(fd, 'w') as out:
                    json.dump(value, out)
                    out.flush()
                    os.fsync(out.fileno())
                # Linux renameat2 commits complete bytes atomically without
                # replacing an existing completion record. No destructive
                # operation begins until the record and its parent are durable.
                library = ctypes.CDLL(None, use_errno=True)
                require(hasattr(library, 'renameat2'), 'ATOMIC_REMOVAL_NOT_SUPPORTED')
                rename = library.renameat2
                rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
                rename.restype = ctypes.c_int
                if rename(parent, os.fsencode(temporary), parent, os.fsencode(receipt.name), 1):
                    code = ctypes.get_errno()
                    raise OSError(code, os.strerror(code), str(receipt))
                os.fsync(parent)
            finally:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass
        fd = os.open(receipt.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            record_stat = os.fstat(stream.fileno())
            require(stat.S_ISREG(record_stat.st_mode) and record_stat.st_nlink == 1 and record_stat.st_uid == os.getuid()
                    and record_stat.st_mode & 0o077 == 0 and 0 < record_stat.st_size < 4096, 'REMOVAL_COMPLETION_INVALID')
            value = read_json(stream.read(4096))
        require(set(value) == {'schema', 'root', 'state', 'rootIdentity', 'stateIdentity', 'parentIdentity'}
                and value['schema'] == 'agi-fleet/removal-completion/v1' and value['root'] == str(root)
                and value['parentIdentity'] == [parent_stat.st_dev, parent_stat.st_ino]
                and value['stateIdentity'] == directory_identity(value['state']), 'REMOVAL_COMPLETION_INVALID')
        try:
            root_fd = os.open(root.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        except FileNotFoundError:
            root_fd = None
        if root_fd is not None:
            try:
                s = os.fstat(root_fd)
                require([s.st_dev, s.st_ino] == value['rootIdentity'] and s.st_uid == os.getuid()
                        and not s.st_mode & 0o077, 'INSTALLATION_DIRECTORY_CHANGED')
                require(set(os.listdir(root_fd)) <= {'pending-removal.json'}, 'UNOWNED_INSTALLATION_CONTENT')
                try:
                    journal_fd = os.open('pending-removal.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
                except FileNotFoundError:
                    journal_fd = None
                if journal_fd is not None:
                    with os.fdopen(journal_fd, 'rb') as stream:
                        journal_stat = os.fstat(stream.fileno())
                        require(stat.S_ISREG(journal_stat.st_mode) and journal_stat.st_nlink == 1 and journal_stat.st_uid == os.getuid()
                                and journal_stat.st_mode & 0o077 == 0 and journal_stat.st_size < 16_000_000, 'REMOVAL_JOURNAL_INVALID')
                        journal = read_json(stream.read(16_000_000))
                    require(journal['root'] == value['root'] and journal['state'] == value['state']
                            and journal['rootIdentity'] == value['rootIdentity'] and journal['stateIdentity'] == value['stateIdentity'], 'REMOVAL_JOURNAL_INVALID')
                    current = os.stat('pending-removal.json', dir_fd=root_fd, follow_symlinks=False)
                    require((current.st_dev, current.st_ino) == (journal_stat.st_dev, journal_stat.st_ino), 'REMOVAL_JOURNAL_INVALID')
                    os.unlink('pending-removal.json', dir_fd=root_fd)
                    os.fsync(root_fd)
                current = os.stat(root.name, dir_fd=parent, follow_symlinks=False)
                require([current.st_dev, current.st_ino] == value['rootIdentity'], 'INSTALLATION_DIRECTORY_CHANGED')
                os.rmdir(root.name, dir_fd=parent)
                os.fsync(parent)
            finally:
                os.close(root_fd)
        current = os.stat(receipt.name, dir_fd=parent, follow_symlinks=False)
        require((current.st_dev, current.st_ino) == (record_stat.st_dev, record_stat.st_ino), 'REMOVAL_COMPLETION_INVALID')
        os.unlink(receipt.name, dir_fd=parent)
        os.fsync(parent)
    return {'removed': str(root), 'preservedState': value['state'], 'credentialsDeleted': False, 'authorityRestored': False}


def uninstall(root):
    root = Path(root).absolute()
    if os.path.lexists(completion_path(root)):
        return finalize_removal(root)
    root = private(root)
    resuming = os.path.lexists(root / 'pending-removal.json')
    root, m = removal_plan(root) if resuming else installation(root)
    with maintenance(root), reserve_state(m['state']):
        if not resuming:
            require(set(x.name for x in root.iterdir()) == {'installation.json', 'versions', 'operation.lock'}, 'UNOWNED_INSTALLATION_CONTENT')
            require(set(x.name for x in (root / 'versions').iterdir()) == set(m['versions']), 'UNOWNED_VERSION_CONTENT')
            for version in m['versions']:
                verify_version(root, version)
            files, directories = [], []
            for file in root.rglob('*'):
                if file.is_relative_to(root / 'operation.lock'):
                    continue
                relative = file.relative_to(root).as_posix()
                if file.is_dir() and not file.is_symlink():
                    s = file.lstat()
                    directories.append({'path': relative, 'identity': [s.st_dev, s.st_ino]})
                else:
                    regular(file, allow_empty=True)
                    s = file.lstat()
                    files.append({'path': relative, 'sha256': sha(file), 'mode': stat.S_IMODE(s.st_mode), 'identity': [s.st_dev, s.st_ino]})
            m = {'schema': 'agi-fleet/pending-removal/v1', 'root': str(root), 'state': m['state'],
                 'rootIdentity': directory_identity(root), 'stateIdentity': directory_identity(m['state']),
                 'files': files, 'directories': directories}
            atomic(root / 'pending-removal.json', m)
        removal_plan(root)  # Validate every remaining member before deleting one.
        with directory_fd(root) as root_fd:
            s = os.fstat(root_fd)
            require([s.st_dev, s.st_ino] == m['rootIdentity'], 'INSTALLATION_DIRECTORY_CHANGED')
            for row in m['files']:
                remove_member(root_fd, row, m)
            for row in sorted(m['directories'], key=lambda x: len(PurePosixPath(x['path']).parts), reverse=True):
                remove_member(root_fd, row, m, directory=True)
    return finalize_removal(root, m)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['inspect', 'preflight', 'install', 'update', 'rollback', 'launch', 'uninstall', 'recover-maintenance'])
    p.add_argument('--archive', type=Path)
    p.add_argument('--sha256')
    p.add_argument('--node-archive', type=Path)
    p.add_argument('--root', type=Path)
    p.add_argument('--state', type=Path)
    p.add_argument('--version')
    p.add_argument('--confirm', action='store_true')
    p.add_argument('--for-update', action='store_true')
    a, arguments = p.parse_known_args()
    require(a.action == 'launch' or not arguments, 'UNKNOWN_ARGUMENTS')
    if a.action == 'preflight':
        require(a.archive and a.sha256 and a.node_archive and a.root and a.state, 'INSTALL_ARGUMENTS_REQUIRED')
        result = preflight(a.archive, a.sha256, a.node_archive, a.root, a.state, update=a.for_update)
    elif a.action == 'inspect':
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
