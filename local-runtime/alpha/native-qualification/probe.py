"""Fixed native IPC qualification probes. Never part of a task or runtime image."""
import sys
sys.path[:] = ['/opt/alpha/python/lib/python3.12', '/opt/alpha/python/lib/python3.12/lib-dynload']
import json
import os
import resource
import socket
import time
from pathlib import Path
mode = sys.argv[1]
assert mode in ('isolation', 'detached-exit', 'cancel-after-exit', 'cancel', 'timeout', 'launcher-death', 'cpu', 'output')
identity = {'pidNamespace': os.readlink('/proc/self/ns/pid'),
            'networkNamespace': os.readlink('/proc/self/ns/net'), 'probe': mode}
for descriptor in (3, 4):
    try:
        os.fstat(descriptor)
    except OSError:
        continue
    raise AssertionError('Trusted status/lifetime descriptor leaked to payload')
identity['trustedChannelsAbsent'] = True
assert resource.getrlimit(resource.RLIMIT_CPU) == (5, 5)
identity['cpuLimitSeconds'] = [5, 5]
if mode == 'isolation':
    assert not Path('/etc/passwd').exists() and not Path('/home').exists()
    assert not Path('/workspace').exists() and not Path('/usr/bin').exists()
    assert os.environ.get('PYTHONPATH') is None
    try:
        Path('/opt/alpha/forbidden').write_text('no')
        raise AssertionError('Read-only root is writable')
    except OSError:
        pass
    try:
        socket.create_connection(('192.0.2.1', 9), timeout=0.2)
        raise AssertionError('Network unexpectedly connected')
    except OSError:
        pass
    print(json.dumps({**identity, 'readOnly': True, 'hostFilesAbsent': True, 'networkDenied': True}), flush=True)
    time.sleep(0.3)
elif mode in ('detached-exit', 'cancel-after-exit', 'cancel', 'timeout', 'launcher-death'):
    read, write = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read)
        os.setsid()
        for descriptor in (0, 1, 2):
            os.close(descriptor)
        os.write(write, b'ready')
        os.close(write)
        while True:
            time.sleep(1)
    os.close(write)
    assert os.read(read, 5) == b'ready'
    os.close(read)
    print(json.dumps({**identity, 'detachedChild': True, 'forkedChild': child}), flush=True)
    time.sleep(0.3)
    if mode not in ('detached-exit', 'cancel-after-exit'):
        while True:
            time.sleep(1)
elif mode == 'cpu':
    print(json.dumps(identity), flush=True)
    while True:
        pass
elif mode == 'output':
    print(json.dumps(identity), flush=True)
    time.sleep(0.3)
    while True:
        print('x' * 8192, flush=True)
