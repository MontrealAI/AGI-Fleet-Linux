#!/usr/bin/env python3
import os
import selectors
import socket
import sys
import time

s = socket.create_connection(('127.0.0.1', 9222), timeout=5)
s.setblocking(False)
selector = selectors.DefaultSelector()
selector.register(s, selectors.EVENT_READ, 'socket')
selector.register(sys.stdin.buffer, selectors.EVENT_READ, 'stdin')
deadline = time.monotonic() + 300
try:
    while time.monotonic() < deadline:
        for key, _ in selector.select(timeout=min(1, max(0, deadline-time.monotonic()))):
            data = s.recv(65536) if key.data == 'socket' else os.read(sys.stdin.fileno(), 65536)
            if not data:
                sys.exit(0)
            if key.data == 'socket':
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            else:
                s.settimeout(5)
                s.sendall(data)
                s.setblocking(False)
finally:
    selector.close()
    s.close()
