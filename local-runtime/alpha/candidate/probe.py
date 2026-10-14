"""Fixed candidate isolation probes, mounted only by the qualification harness.

This file is not part of the artifact and is never a Fleet action or task input.
"""
import sys
sys.path[:] = ['/opt/alpha/source', '/opt/alpha/wheels', '/opt/alpha/python/lib/python3.12',
               '/opt/alpha/python/lib/python3.12/lib-dynload']
import importlib.util
import json
import os
import socket
import time
from pathlib import Path

mode = sys.argv[1]
identity = {'pidNamespace': os.readlink('/proc/self/ns/pid'),
            'networkNamespace': os.readlink('/proc/self/ns/net')}
if mode == 'isolation':
    absent = {name: importlib.util.find_spec(name) is None
              for name in ['agents', 'google_adk', 'faiss', 'sentence_transformers', 'sitecustomize']}
    assert all(absent.values()), absent
    assert not Path('/host-secret').exists()
    assert not Path('/etc/passwd').exists()
    assert not Path('/home').exists()
    assert not Path('/workspace').exists()
    assert not Path('/usr/bin').exists()
    assert not Path('/usr/lib/python3/dist-packages').exists()
    try:
        Path('/opt/alpha/source/write-probe').write_text('forbidden')
        raise AssertionError('Immutable source is writable')
    except OSError:
        pass
    try:
        socket.create_connection(('192.0.2.1', 9), timeout=0.2)
        raise AssertionError('Network unexpectedly connected')
    except OSError:
        pass
    assert os.environ.get('PYTHONPATH') is None and os.environ.get('HOME') == '/nonexistent'
    print(json.dumps({**identity, 'optionalImportsAbsent': absent, 'readOnly': True,
                      'hostFilesAbsent': True, 'networkConnectDenied': True}), flush=True)
    time.sleep(0.1)
elif mode in ('timeout', 'cancel'):
    ready_read, ready_write = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(ready_read)
        os.setsid()
        # Detached descendant cannot keep harness pipes open or stay in its pgid.
        for descriptor in (0, 1, 2):
            os.close(descriptor)
        os.write(ready_write, b'ready')
        os.close(ready_write)
        while True:
            time.sleep(1)
    os.close(ready_write)
    assert os.read(ready_read, 5) == b'ready'
    os.close(ready_read)
    print(json.dumps({**identity, 'forkedChild': child, 'probe': mode, 'detachedChild': True}), flush=True)
    while True:
        time.sleep(1)
elif mode == 'cpu':
    print(json.dumps({**identity, 'probe': mode}), flush=True)
    while True:
        pass
elif mode == 'output':
    print(json.dumps(identity), flush=True)
    while True:
        print('x' * 8192, flush=True)
else:
    raise SystemExit('UNKNOWN_FIXED_PROBE')
