#!/usr/bin/env python3
"""Fail closed on misplaced hashbang bytes and Node 24 parse errors in extracted releases."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

JS_SUFFIXES = {'.js', '.mjs', '.cjs'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def clean_environment():
    return {key: value for key, value in os.environ.items() if key not in {'NODE_OPTIONS', 'NODE_PATH'}}


def node_runtime(node):
    resolved = shutil.which(str(node))
    if not resolved:
        raise ValueError('Node runtime was not found: ' + str(node))
    resolved = str(Path(resolved).resolve())
    result = subprocess.run([resolved, '--version'], text=True, capture_output=True,
                            timeout=30, env=clean_environment())
    version = result.stdout.strip()
    if result.returncode != 0 or not re.fullmatch(r'v24\.\d+\.\d+', version):
        raise ValueError('Release validation requires an actual Node 24 runtime; got ' + repr(version))
    return {'path': resolved, 'version': version, 'sha256': digest(Path(resolved).read_bytes())}


def misplaced_hashbangs(data):
    positions = []
    start = 1
    while True:
        offset = data.find(b'#!', start)
        if offset < 0:
            return positions
        positions.append({'byteOffset': offset, 'line': data.count(b'\n', 0, offset) + 1,
                          'byteColumn': offset - data.rfind(b'\n', 0, offset)})
        start = offset + 2


def inspect_file(root, file, node, timeout):
    relative = file.relative_to(root).as_posix()
    if file.is_symlink():
        return {'path': relative, 'status': 'FAIL', 'error': 'Symbolic link in extracted executable tree'}
    data = file.read_bytes()
    record = {'path': relative, 'bytes': len(data), 'sha256': digest(data),
              'hashbangAtByteZero': data.startswith(b'#!'),
              'misplacedHashbangs': misplaced_hashbangs(data)}
    try:
        result = subprocess.run([node, '--check', str(file)], capture_output=True, timeout=timeout,
                                env=clean_environment())
        record['nodeCheck'] = {'exitCode': result.returncode, 'status': 'PASS' if result.returncode == 0 else 'FAIL'}
        for name, output in [('stdout', result.stdout), ('stderr', result.stderr)]:
            if output:
                record['nodeCheck'][name] = output[-16384:].decode('utf-8', errors='replace')
                record['nodeCheck'][name + 'Bytes'] = len(output)
                record['nodeCheck'][name + 'SHA256'] = digest(output)
    except subprocess.TimeoutExpired:
        record['nodeCheck'] = {'status': 'FAIL', 'error': 'Node syntax check timed out', 'timeoutSeconds': timeout}
    except OSError as error:
        record['nodeCheck'] = {'status': 'FAIL', 'error': str(error)}
    record['unchangedDuringCheck'] = not file.is_symlink() and file.read_bytes() == data
    record['status'] = ('PASS' if not record['misplacedHashbangs'] and
                        record['nodeCheck']['status'] == 'PASS' and record['unchangedDuringCheck'] else 'FAIL')
    return record


def validate(root, node='node', jobs=4, timeout=30):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Extracted release root must be a directory')
    if not 1 <= jobs <= 16 or timeout <= 0:
        raise ValueError('Jobs must be 1..16 and timeout must be positive')
    runtime = node_runtime(node)
    files = sorted(file for file in root.rglob('*') if file.suffix.lower() in JS_SUFFIXES and (file.is_file() or file.is_symlink()))
    if not files:
        raise ValueError('No shipped JS-family files found; empty validation is forbidden')
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        records = list(pool.map(lambda file: inspect_file(root, file, runtime['path'], timeout), files))
    passed = sum(record['status'] == 'PASS' for record in records)
    return {'schema': 'agi-final-executable-validation/v1',
            'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
            'root': str(root), 'runtime': runtime,
            'scope': 'Every shipped .js, .mjs and .cjs file, including tests, dependencies and historical evidence; no exclusions.',
            'hashbangPolicy': 'The literal byte pair 0x23 0x21 is permitted only at byte offset 0; even comments and string literals are rejected elsewhere.',
            'parseCommand': ['<runtime.path>', '--check', '<absolute-file-path>'],
            'nodeOptionsCleared': True, 'jobs': jobs,
            'status': 'PASS' if passed == len(records) else 'FAIL',
            'summary': {'files': len(records), 'pass': passed, 'fail': len(records) - passed,
                        'nodeChecksPassed': sum(record.get('nodeCheck', {}).get('status') == 'PASS' for record in records),
                        'misplacedHashbangFiles': sum(bool(record.get('misplacedHashbangs')) for record in records)},
            'files': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--timeout', type=float, default=30)
    args = parser.parse_args()
    try:
        report = validate(args.root, args.node, args.jobs, args.timeout)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        report = {'schema': 'agi-final-executable-validation/v1', 'status': 'FAIL', 'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key in {'status', 'runtime', 'summary', 'error'}}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
