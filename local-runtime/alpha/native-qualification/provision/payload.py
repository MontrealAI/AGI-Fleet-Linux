"""Read-only actual payload identity. Synthetic /proc fixtures are test-only."""
from __future__ import annotations
import os
from pathlib import Path
import stat
from prepare import file_bytes, need, sha

PYTHON_ARGV0 = b'/opt/alpha/python/bin/python3.12'


def phase_from_argv(raw):
    for phase in ('validate', 'work'):
        expected = [PYTHON_ARGV0, b'-I', b'-S', b'-B', b'/opt/alpha/launch-' + phase.encode() + b'.py', b'']
        if raw.split(b'\0') == expected:
            return phase
    # prlimit/bwrap wrappers contain the launcher as an argument but are not it.
    return None


def process_stat(raw):
    fields = raw[raw.rindex(')') + 2:].split()
    need(len(fields) >= 20 and fields[1].isdigit() and fields[19].isdigit(), 'Invalid process identity')
    return {'parent': int(fields[1]), 'startTimeTicks': fields[19]}


def interpreter_identity(file):
    value = file.lstat()
    need(stat.S_ISREG(value.st_mode) and value.st_nlink == 1, 'Interpreter must be a regular unlinked file')
    return {'device': str(value.st_dev), 'inode': str(value.st_ino), 'bytes': value.st_size, 'sha256': sha(file_bytes(file))}


def observe_payload(proc, driver_pid, interpreter, proc_root=Path('/proc')):
    """Return only exact descendants executing the provisioned Python inode.

    A matching genuine interpreter in the host namespace is a failure, not a
    wrapper to skip. A disappearing process is inconclusive to the caller.
    """
    phase = phase_from_argv((proc / 'cmdline').read_bytes())
    if phase is None:
        return None
    first = process_stat((proc / 'stat').read_text())
    cursor = int(proc.name)
    for _ in range(32):
        cursor = process_stat((proc_root / str(cursor) / 'stat').read_text())['parent']
        if cursor == driver_pid or cursor <= 1:
            break
    if cursor != driver_pid:
        return None
    namespace = os.readlink(proc / 'ns/pid')
    need(namespace != os.readlink(proc_root / 'self/ns/pid'), 'Actual payload has host PID namespace')
    # /proc/PID/exe is an intentionally followed kernel magic link. Verify the
    # open inode before reading; do not trust argv or the symlink's display name.
    fd = os.open(proc / 'exe', os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        value = os.fstat(stream.fileno())
        need(stat.S_ISREG(value.st_mode) and str(value.st_dev) == interpreter['device'] and str(value.st_ino) == interpreter['inode'] and value.st_size == interpreter['bytes'], 'Payload executable is not the installed interpreter')
        need(sha(stream.read(interpreter['bytes'] + 1)) == interpreter['sha256'], 'Payload interpreter bytes changed')
    need(process_stat((proc / 'stat').read_text()) == first and os.readlink(proc / 'ns/pid') == namespace and phase_from_argv((proc / 'cmdline').read_bytes()) == phase, 'Payload identity changed during observation')
    return {'pid': int(proc.name), 'startTimeTicks': first['startTimeTicks'], 'pidNamespace': namespace, 'phase': phase, 'interpreter': interpreter}
