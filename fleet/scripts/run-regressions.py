#!/usr/bin/env python3
"""Run the entire Fleet/six-role JavaScript regression suite with verified fixtures.

No installation, operator-profile repair, Docker action, or STOP reconciliation.
Any failed, cancelled, skipped, TODO, incomplete, or timed-out test prevents PASS.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import signal
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
COUNT_KEYS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')

def sha(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def need(value, message):
    if not value:
        raise ValueError(message)

def atomic_bytes(file, data):
    """Publish a closed, fsynced snapshot; never expose an actively appended log."""
    temporary = file.with_suffix(file.suffix + '.tmp')
    with temporary.open('xb') as stream:
        os.chmod(temporary, 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(file)

def save(file, value):
    atomic_bytes(file, (json.dumps(value, indent=2) + '\n').encode())

def retain_log(file, data):
    atomic_bytes(file, data)
    expected = hashlib.sha256(data).hexdigest()
    need(file.stat().st_size == len(data) and sha(file) == expected,
         'Retained log differs from captured output: ' + file.name)
    return {'logSHA256': expected, 'logBytes': len(data)}

def retained_logs_valid(out, rows):
    try:
        return bool(rows) and all(
            (out / row['log']).stat().st_size == row['logBytes'] and
            sha(out / row['log']) == row['logSHA256'] for row in rows)
    except (OSError, KeyError):
        return False

def verified_file(root, relative):
    file = root / relative
    need(file.is_relative_to(root) and '..' not in Path(relative).parts,
         'Unsafe fixture path: ' + relative)
    need(file.is_file() and not file.is_symlink(), 'Missing or linked fixture: ' + relative)
    need(file.resolve().is_relative_to(root.resolve()), 'Fixture escapes root: ' + relative)
    return file

def preflight(node, package, history):
    lock = json.loads((ROOT / 'test-support/regression-fixtures.json').read_text())
    version = subprocess.check_output([str(node), '--version'], text=True, timeout=10).strip()
    need(version == 'v' + lock['node'], 'Expected Node ' + lock['node'] + ', got ' + version)
    module = (ROOT / 'shared/runtime/compute/runtime-env.mjs').as_uri()
    code = 'const m=await import(' + json.dumps(module) + ');m.inspectExecutable(process.execPath,"node");'
    subprocess.run([str(node), '--input-type=module', '-e', code], check=True, timeout=15)
    inventory = json.loads((ROOT / 'shared/runtime/compute/openclaw-2026.9.5.inventory.json').read_text())
    checked = 0
    for relative, expected in inventory['files'].items():
        if relative in inventory.get('optionalAbsent', []) and not (package / relative).exists():
            continue
        file = verified_file(package, relative)
        need(file.stat().st_size == expected['bytes'] and sha(file) == expected['sha256'],
             'Pinned OpenClaw file mismatch: ' + relative)
        checked += 1
    package_json = json.loads((package / 'package.json').read_text())
    need(package_json['version'] == lock['openclaw'], 'OpenClaw version mismatch')
    allowed = set(inventory['files'])
    extras = []
    for file in package.rglob('*'):
        relative = file.relative_to(package)
        if relative.parts[0] in inventory.get('extraRootAllowed', []):
            continue
        if file.is_file() and relative.as_posix() not in allowed:
            extras.append(relative.as_posix())
    need(not extras, 'Unexpected OpenClaw files: ' + ', '.join(extras[:5]))
    fixtures = {}
    for row in lock['historical']:
        root = history / row['relativeRoot']
        manifest = verified_file(root, 'MANIFEST.sha256')
        need(sha(manifest) == row['manifestSHA256'], 'Historical manifest mismatch: ' + row['relativeRoot'])
        count = 0
        for line in manifest.read_text().splitlines():
            need(re.fullmatch(r'[a-f0-9]{64}  .+', line), 'Malformed historical manifest')
            expected, relative = line.split('  ', 1)
            need(sha(verified_file(root, relative)) == expected, 'Historical fixture changed: ' + relative)
            count += 1
        fixtures.setdefault(row['label'], {})[row['role']] = str(root)
        row['verifiedFiles'] = count
    unix = {'available': False}
    with tempfile.TemporaryDirectory(prefix='agi-regression-capability-') as directory:
        server = None
        try:
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(str(Path(directory) / 'probe.sock'))
            server.listen(1)
            unix = {'available': True}
        except OSError as error:
            unix = {'available': False, 'errno': error.errno, 'reason': error.strerror}
        finally:
            if server is not None:
                server.close()
    return fixtures, {'node': {'version': version, 'sha256': sha(node)},
                      'openclaw': {'version': lock['openclaw'], 'verifiedFiles': checked},
                      'historical': lock['historical'], 'unixSocket': unix}

def source_snapshot():
    release = runpy.run_path(str(ROOT / 'scripts/prepare-release.py'))
    return {name: sha(file) for name, file in release['tree_files'](ROOT, release['source_path']).items()}

def suite_passes(rows, totals, *, unchanged, partial, unix_available, retained_logs=True):
    return (bool(rows) and unchanged and not partial and unix_available and retained_logs and
            all(r['exitCode'] == 0 and not r['timedOut'] and r['completeSummary'] and
                r['counts'].get('tests', 0) > 0 for r in rows) and
            totals.get('tests', 0) > 0 and
            not any(totals.get(k, 0) for k in ('fail', 'cancelled', 'skipped', 'todo')))

def role_environment(base, history, role):
    env = dict(base)
    env.pop('AGI_TEST_STANDARD_FINALIZATION_SOURCE', None)
    env.pop('AGI_TEST_RUNTIME_ROLE', None)
    # The retained authority releases predate the four auxiliary roles.
    # Passing an Agent archive for another role exercises an unrelated identity.
    if role in history['authority']:
        env['AGI_TEST_STANDARD_FINALIZATION_SOURCE'] = history['authority'][role]
    if role != 'fleet':
        env['AGI_TEST_RUNTIME_ROLE'] = role
    return env

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--node', type=Path, required=True)
    p.add_argument('--openclaw', type=Path, required=True)
    p.add_argument('--historical', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True, help='New directory outside the release tree')
    p.add_argument('--jobs', type=int, default=2)
    p.add_argument('--preflight-only', action='store_true')
    p.add_argument('--file', action='append', default=[], help='Exact relative test path; marks result PARTIAL')
    args = p.parse_args()
    need(1 <= args.jobs <= 8, 'jobs must be between 1 and 8')
    args.node, args.openclaw, args.historical = (v.resolve() for v in (args.node, args.openclaw, args.historical))
    out = args.out.resolve()
    need(not out.is_relative_to(ROOT), 'Evidence directory must be outside the source tree')
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        history, prerequisites = preflight(args.node, args.openclaw, args.historical)
    except Exception as error:
        save(out / 'results.json', {'status': 'PREREQUISITE_FAILED', 'error': str(error), 'complete': False})
        raise
    save(out / 'prerequisites.json', prerequisites)
    print(json.dumps({'prerequisites': prerequisites}), flush=True)
    if args.preflight_only:
        save(out / 'results.json', {'status': 'PREFLIGHT_ONLY', 'complete': False, 'prerequisites': prerequisites})
        return 0
    before = source_snapshot()
    save(out / 'tested-source.json', before)
    files = sorted([*ROOT.glob('tests/*.test.mjs'), *ROOT.glob('packages/*/tests/*.test.mjs')])
    if args.file:
        selected = set(args.file)
        need(selected <= {f.relative_to(ROOT).as_posix() for f in files}, 'Unknown test selection')
        files = [f for f in files if f.relative_to(ROOT).as_posix() in selected]
    need(bool(files), 'No tests found')
    environment = {k: v for k, v in os.environ.items() if not k.startswith('AGI_TEST_')}
    environment.update(PATH=str(args.node.parent) + os.pathsep + os.environ.get('PATH', ''),
                       AGI_TEST_OPENCLAW_PACKAGE_ROOT=str(args.openclaw),
                       AGI_TEST_STANDARD_SOURCE_AGENT=history['commissioning']['agent'],
                       AGI_TEST_STANDARD_SOURCE_NODE=history['commissioning']['node'], NODE_NO_WARNINGS='1')
    def run(file):
        app = file.parent.parent
        role = 'fleet' if app == ROOT else json.loads((app / 'config/companion-releases.json').read_text())['role']
        env = role_environment(environment, history, role)
        log = out / (role + '__' + file.name + '.tap')
        capture = log.with_suffix(log.suffix + '.running')
        start, timed = time.monotonic(), False
        with capture.open('xb') as stream:
            child = subprocess.Popen([str(args.node), '--test', '--test-reporter=tap', '--test-timeout=360000', str(file)],
                                     cwd=app, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = child.wait(timeout=1800)
            except subprocess.TimeoutExpired:
                timed = True
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    code = child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    code = child.wait()
            stream.flush()
            os.fsync(stream.fileno())
        data = capture.read_bytes()
        retained = retain_log(log, data)
        capture.unlink()
        text = data.decode(errors='replace')
        counts = {key: int(matches[-1]) for key in COUNT_KEYS
                  if (matches := re.findall(r'^# ' + key + r' (\d+)$', text, re.M))}
        return {'suite': 'Fleet' if role == 'fleet' else app.name, 'file': file.relative_to(ROOT).as_posix(),
                'sourceSHA256': sha(file), 'exitCode': code, 'timedOut': timed,
                'durationSeconds': round(time.monotonic() - start, 3), 'counts': counts,
                'completeSummary': all(k in counts for k in COUNT_KEYS), 'log': log.name, **retained,
                'environmentSignals': sorted({e for e in ('EPERM', 'EACCES', 'EINVAL') if e in text})}
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for future in concurrent.futures.as_completed([pool.submit(run, file) for file in files]):
            row = future.result()
            rows.append(row)
            save(out / 'progress.json', {'completedFiles': len(rows), 'totalFiles': len(files), 'results': rows})
            print(json.dumps({'done': len(rows), 'total': len(files), **row}), flush=True)
    totals = collections.Counter()
    for row in rows:
        totals.update(row['counts'])
    unchanged = before == source_snapshot()
    logs_unchanged = retained_logs_valid(out, rows)
    passed = suite_passes(rows, totals, unchanged=unchanged, partial=bool(args.file),
                          unix_available=prerequisites['unixSocket']['available'],
                          retained_logs=logs_unchanged)
    result = {'schema': 'agi-full-regressions/v1', 'status': 'PASS' if passed else 'NOT_PASS',
              'scope': 'PARTIAL' if args.file else 'FULL', 'complete': True,
              'sourceUnchanged': unchanged, 'retainedLogsUnchanged': logs_unchanged,
              'prerequisites': prerequisites,
              'testFiles': len(files), 'counts': dict(totals), 'results': sorted(rows, key=lambda r: r['file'])}
    save(out / 'results.json', result)
    print(json.dumps({k: v for k, v in result.items() if k not in ('results', 'prerequisites')}), flush=True)
    return 0 if passed else 1

if __name__ == '__main__':
    raise SystemExit(main())
