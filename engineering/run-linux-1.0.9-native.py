#!/usr/bin/env python3
"""Run the hash-bound Linux 1.0.9 candidate on a disposable native VM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import runpy
import shutil
import socket
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import zipfile

ASSETS = {
    'AGI_Fleet_Linux_v1.0.9.zip': (401420759, '5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102'),
    'AGI_Regression_Fixtures_v1.19.6.zip': (211966077, '4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014'),
    'Linux-Validation-Evidence-v1.0.6.zip': (4346684, 'c85926b733b7f3277c09ada0b9ad7c9e4969ee0fdddac3b84830159fbab339cf'),
}
NODE_HASHES = {
    'x64': 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
    'arm64': '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2',
}
NATIVE_FILES = [f'packages/AGI_{role}/tests/{name}.test.mjs' for role in ('Agent', 'Node') for name in (
    'compute-repair', 'compute-restart', 'public-browser-integration', 'public-browser-runtime',
    'public-web-qualification-import', 'service-stop', 'setup-runtime-socket')]
NATIVE_FILES += [f'packages/AGI_{role}/tests/setup-runtime-materialization.test.mjs' for role in ('Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery')]
NATIVE_FILES += [f'packages/AGI_{role}/tests/setup-standard-readiness.test.mjs' for role in ('Agent', 'Node')]
NATIVE_FILES += ['packages/AGI_Agent/tests/setup-plugin-catalog-policy.test.mjs']
NATIVE_FILES += [f'packages/AGI_{role}/tests/setup-fresh-readiness-resume.test.mjs' for role in ('Agent', 'Node')]


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def download(url, target, expected, size=None):
    with urllib.request.urlopen(url, timeout=120) as source, target.open('xb') as output:
        shutil.copyfileobj(source, output, 1024 * 1024)
    if sha(target) != expected or (size is not None and target.stat().st_size != size):
        raise ValueError('Downloaded artifact identity mismatch: ' + target.name)
    return {'url': url, 'bytes': target.stat().st_size, 'sha256': expected}


def extract_zip(archive, destination):
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as z:
        names = [item.filename for item in z.infolist()]
        if len(names) != len(set(n.casefold() for n in names)):
            raise ValueError('Duplicate archive member')
        for item in z.infolist():
            p = Path(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or stat.S_IFMT(item.external_attr >> 16) not in (0, stat.S_IFREG):
                raise ValueError('Unsafe archive member')
            target = destination / p
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(item) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if item.external_attr >> 16 & 0o111 else 0o644)


def run(command, log, timeout=10800):
    print('RUN ' + ' '.join(map(str, command)), flush=True)
    with log.open('w') as stream:
        result = subprocess.Popen(list(map(str, command)), stdout=stream, stderr=subprocess.STDOUT)
        started = time.monotonic()
        previous = None
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                result.kill()
                result.wait()
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                result.wait(timeout=min(30, remaining))
                break
            except subprocess.TimeoutExpired:
                if '--out' in command:
                    progress = Path(command[command.index('--out') + 1]) / 'progress.json'
                    if progress.exists():
                        value = json.loads(progress.read_text())
                        # Retain the frozen runner's own progress; never synthesize counts.
                        rendered = json.dumps({'completedFiles': value['completedFiles'], 'totalFiles': value['totalFiles'], 'failedFiles': [row['file'] for row in value['results'] if row['exitCode'] != 0]}, sort_keys=True)
                        if rendered != previous:
                            print('PROGRESS ' + rendered, flush=True)
                            previous = rendered
    print('EXIT ' + str(result.returncode) + ' ' + log.name, flush=True)
    if result.returncode:
        print(log.read_text(errors='replace')[-16000:], flush=True)
    return result.returncode


def accept(result, partial=False):
    counts = result.get('counts', {})
    return (result.get('complete') is True and result.get('sourceUnchanged') is True and
            result.get('retainedLogsUnchanged') is True and result.get('scope') == ('PARTIAL' if partial else 'FULL') and
            result.get('testFiles') == (25 if partial else 342) and counts.get('tests') == (291 if partial else 3897) and counts.get('pass') == counts.get('tests') and
            not any(counts.get(k, 0) for k in ('fail', 'cancelled', 'skipped', 'todo')) and
            all(row['exitCode'] == 0 and not row['timedOut'] and row['completeSummary'] for row in result.get('results', [])) and
            result['prerequisites']['unixSocket']['available'] is True and
            (partial or result.get('status') == 'PASS'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or platform.system() != 'Linux':
        raise ValueError('Requires the explicitly authorized disposable Linux VM root context')
    work, evidence = args.work.resolve(), args.evidence.resolve()
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    evidence.mkdir(mode=0o755, parents=True, exist_ok=False)
    os.umask(0o022)
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}[platform.machine()]
    save(evidence / 'runner.json', {'platform': platform.platform(), 'architecture': arch, 'uid': os.getuid(),
         'githubRunId': os.environ.get('GITHUB_RUN_ID'), 'workflowCommit': os.environ.get('GITHUB_SHA'),
         'operatorAccountsUsed': False, 'productionQualified': False})
    with tempfile.TemporaryDirectory(prefix='agi-native-capability-', dir=work) as directory:
        folder = Path(directory)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(folder / 'probe.sock')); server.listen(1)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect(str(folder / 'probe.sock'))
                peer, _ = server.accept()
                with peer:
                    client.sendall(b'native'); assert peer.recv(6) == b'native'
            os.chown(folder / 'probe.sock', 1, 1)
            assert (folder / 'probe.sock').stat().st_uid == 1
            os.chown(folder / 'probe.sock', 0, 0)
        os.chown(folder, 1, 1); assert folder.stat().st_uid == 1; os.chown(folder, 0, 0)
    save(evidence / 'native-capability.json', {'unixSocketRoundTrip': 'PASS', 'foreignSocketOwnership': 'PASS', 'foreignDirectoryOwnership': 'PASS'})
    receipts = {}
    for name, (size, digest) in ASSETS.items():
        receipts[name] = download('https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/' + ('v1.0.9-qualification/' if name == 'AGI_Fleet_Linux_v1.0.9.zip' else 'v1.0.6-qualification/') + name, work / name, digest, size)
        save(evidence / 'download-receipts.json', receipts)
        print('VERIFIED ' + name + ' ' + digest, flush=True)
    release_zip = work / 'AGI_Fleet_Linux_v1.0.9.zip'
    bootstrap = work / 'bootstrap' / 'AGI_Fleet_Linux_v1.0.9'
    with zipfile.ZipFile(release_zip) as z:
        for relative in ('scripts/prepare-release.py', 'config/role-registry.json'):
            target = bootstrap / relative; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read('AGI_Fleet_Linux_v1.0.9/' + relative))
    verifier = runpy.run_path(str(bootstrap / 'scripts/prepare-release.py'))['verify_archive']
    receipt = verifier(release_zip, work / 'frozen')
    save(evidence / 'saved-archive-validation.json', receipt)
    source = Path(receipt['freshExtraction'])
    extract_zip(work / 'AGI_Regression_Fixtures_v1.19.6.zip', work / 'fixture-archives')
    extract_zip(work / 'Linux-Validation-Evidence-v1.0.6.zip', work / 'original-evidence')
    node_name = 'node-v24.21.0-linux-' + arch
    node_archive = work / (node_name + '.tar.xz')
    node_receipt = download('https://nodejs.org/dist/v24.21.0/' + node_archive.name, node_archive, NODE_HASHES[arch])
    with tarfile.open(node_archive) as tar:
        tar.extractall(work / 'node', filter='data')
    node = work / 'node' / node_name / 'bin/node'
    npm = node.parent / 'npm'
    node_receipt['executableSHA256'] = sha(node)
    save(evidence / 'node-download.json', node_receipt)
    chain = []
    for path in (node, *node.parents, Path('/opt')):
        s = path.lstat()
        chain.append({'path': str(path), 'uid': s.st_uid, 'gid': s.st_gid, 'mode': oct(stat.S_IMODE(s.st_mode))})
    save(evidence / 'node-ownership-chain.json', chain)
    print(json.dumps({'nodeOwnershipChain': chain}), flush=True)
    os.environ['PATH'] = str(node.parent) + os.pathsep + os.environ['PATH']
    provisioned = []
    backup = work / 'system-node-originals'
    backup.mkdir()
    # Quarantine the runner's non-pinned /usr/local Node without changing any
    # directory permissions. The SDK's system lookup can then reach the exact
    # verified binary at the trusted /usr/bin/node location.
    ambient = Path('/usr/local/bin/node')
    if ambient.exists() or ambient.is_symlink():
        original = {'path': str(ambient), 'classification': 'NON_PINNED_NODE_PRESERVED',
                    'previousLink': os.readlink(ambient) if ambient.is_symlink() else None,
                    'previousSHA256': sha(ambient) if ambient.exists() else None}
        shutil.copy2(ambient, backup / 'usr-local-node', follow_symlinks=False)
        ambient.unlink()
        provisioned.append(original)
    for target in (Path('/usr/bin/node'),):
        chain = [target.parent, *target.parent.parents]
        for directory in chain:
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Unsafe system Node parent: ' + str(directory))
        prior = {'path': str(target), 'previousLink': os.readlink(target) if target.is_symlink() else None,
                 'previousSHA256': sha(target) if target.exists() else None}
        if target.exists():
            shutil.copyfile(target, backup / ('usr-local-node' if 'local' in target.parts else 'usr-node'))
        temporary = target.with_name('node-agi-provisioned')
        with node.open('rb') as src, temporary.open('xb') as dst:
            shutil.copyfileobj(src, dst)
        temporary.chmod(0o755)
        temporary.replace(target)
        prior['verifiedSHA256'] = sha(target)
        assert prior['verifiedSHA256'] == sha(node)
        provisioned.append(prior)
    save(evidence / 'system-node-provisioning.json', provisioned)
    dependencies = work / 'dependencies'
    prepared = run(['python3', source / 'scripts/prepare-regression-fixtures.py', '--archives',
        work / 'fixture-archives/AGI_Regression_Fixtures_v1.19.6', '--destination', dependencies,
        '--node', node, '--npm', npm], evidence / 'prepare-fixtures.log', timeout=1800)
    if prepared:
        if (dependencies / 'npm-ci.log').exists():
            shutil.copyfile(dependencies / 'npm-ci.log', evidence / 'npm-ci.log')
        raise RuntimeError('Verified dependency preparation failed')
    shutil.copyfile(dependencies / 'fixture-receipts.json', evidence / 'historical-fixture-receipts.json')
    version = subprocess.check_output([str(node), str(dependencies / 'runtime/node_modules/openclaw/openclaw.mjs'), '--version'], text=True, timeout=30).strip()
    if '2026.9.5' not in version.split():
        raise ValueError('OpenClaw CLI version mismatch: ' + version)
    save(evidence / 'openclaw-cli-version.json', {'output': version, 'expected': '2026.9.5'})
    base = ['python3', source / 'scripts/run-regressions.py', '--node', node, '--openclaw',
            dependencies / 'runtime/node_modules/openclaw', '--historical', dependencies / 'historical', '--jobs', '2']
    os.environ['AGI_REQUIRE_LIVE_PLUGIN_CATALOG'] = '1'
    native_code = run(base + ['--out', evidence / 'targeted'] + [part for name in NATIVE_FILES for part in ('--file', name)], evidence / 'targeted-run.log')
    full_code = run(base + ['--out', evidence / 'complete'], evidence / 'complete-run.log')
    native = json.loads((evidence / 'targeted/results.json').read_text())
    full = json.loads((evidence / 'complete/results.json').read_text())
    summary = {'schema': 'agi-capable-native-validation/v1', 'architecture': arch, 'releaseSHA256': ASSETS['AGI_Fleet_Linux_v1.0.9.zip'][1],
        'targeted': {'status': 'PASS' if accept(native, partial=True) else 'NOT_PASS', 'runnerExitCode': native_code,
                     'counts': native.get('counts'), 'testFiles': native.get('testFiles'),
                     'note': 'The frozen runner intentionally returns 1 for every partial selection; each native case is independently checked here.'},
        'complete': {'status': 'PASS' if accept(full) and full_code == 0 else 'NOT_PASS', 'runnerExitCode': full_code,
                     'counts': full.get('counts'), 'testFiles': full.get('testFiles')},
        'productionQualified': False, 'physicalQualification': 'NOT_RUN', 'originalRestrictedEvidencePreserved': True}
    save(evidence / 'summary.json', summary)
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if summary['targeted']['status'] == summary['complete']['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
