#!/usr/bin/env python3
"""Accept an exact macOS archive on disposable hosted Apple-silicon CI only.

This is an engineering regression run under a disposable root identity. It is
never an installer and cannot qualify a real Standard-account Mac deployment.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import runpy
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
VERSION = '1.20.2'
NODE_VERSION = '24.21.0'
NODE_SHA256 = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe'
FIXTURE_NAME = 'AGI_Regression_Fixtures_v1.19.6.zip'
FIXTURE_BYTES = 211966077
FIXTURE_SHA256 = '4e95b35a90a2f212f2686f2c31bd4eb0d7de8131f1733d4d51e8647359b47014'
COUNT_KEYS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
ROLES = ('Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery')
SYSTEM_NODE = Path('/opt/homebrew/bin/node')
SYSTEM_NODE_PARENTS = ('/opt/homebrew/bin', '/opt/homebrew', '/opt', '/')
SYSTEM_NODE_CANDIDATES = ('/opt/homebrew/bin/node', '/opt/homebrew/opt/node/bin/node',
                          '/opt/homebrew/opt/node@24/bin/node', '/opt/homebrew/opt/node@22/bin/node',
                          '/usr/local/bin/node', '/usr/local/opt/node/bin/node',
                          '/usr/local/opt/node@24/bin/node', '/usr/local/opt/node@22/bin/node', '/usr/bin/node')
PROBE_MODULE = 'dist/runtime-paths-4M-K3zyp.mjs'


def need(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def runner_guard(environment, system, machine, euid, home):
    need(system == 'Darwin' and machine == 'arm64', 'Native Darwin arm64 is required; emulation and Linux cannot qualify this archive')
    need(euid == 0 and Path(home).resolve() == Path('/private/var/root'), 'Only the disposable CI root identity may exercise foreign-UID cases')
    need(environment.get('GITHUB_ACTIONS') == 'true' and environment.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'Only an ephemeral GitHub-hosted runner is permitted')
    need(environment.get('GITHUB_REPOSITORY') == REPOSITORY, 'Wrong repository for the macOS acceptance runner')
    need(environment.get('RUNNER_OS') == 'macOS' and environment.get('RUNNER_ARCH') == 'ARM64', 'The runner must advertise native macOS ARM64')
    need(environment.get('AGI_MACOS_RUNNER_LABEL') in ('macos-15', 'macos-26'), 'A pinned macOS 15 or 26 runner label is required')
    need(bool(re.fullmatch(r'[0-9]+', environment.get('GITHUB_RUN_ID', ''))) and bool(re.fullmatch(r'[a-f0-9]{40}', environment.get('GITHUB_SHA', ''))), 'A bound GitHub run and commit are required')
    need(bool(environment.get('GITHUB_WORKSPACE')), 'A checkout workspace is required for retained evidence')


def download(url, target, digest, size=None):
    with urllib.request.urlopen(url, timeout=120) as source, target.open('xb') as output:
        shutil.copyfileobj(source, output, 1024 * 1024)
    need(sha(target) == digest and (size is None or target.stat().st_size == size), 'Downloaded artifact identity mismatch: ' + target.name)
    return {'url': url, 'bytes': target.stat().st_size, 'sha256': digest}


def release_guard(metadata, commit):
    need(metadata.get('schema') == 'agi-macos-candidate-build/v1' and metadata.get('version') == VERSION and
         metadata.get('platform') == 'darwin' and metadata.get('architecture') == 'arm64' and
         metadata.get('nodeVersion') == NODE_VERSION, 'Wrong macOS release identity')
    need(metadata.get('repositoryCommit') == metadata.get('workflowCommit') == commit, 'Release must bind to this exact workflow commit')
    need(metadata.get('productionQualified') is False and metadata.get('physicalQualification') == 'NOT_RUN' and
         metadata.get('nativeAcceptance') == 'NOT_RUN', 'Only an unqualified, unpromoted build can enter native acceptance')


def extract_fixtures(archive, destination):
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as source:
        names = [item.filename for item in source.infolist()]
        need(len(names) == len(set(name.casefold() for name in names)), 'Duplicate fixture archive member')
        for item in source.infolist():
            relative = Path(item.filename)
            mode = stat.S_IFMT(item.external_attr >> 16)
            need(not relative.is_absolute() and '..' not in relative.parts and '\\' not in item.filename and mode in (0, stat.S_IFREG), 'Unsafe fixture archive member')
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as input_stream, target.open('xb') as output:
                shutil.copyfileobj(input_stream, output)
            target.chmod(0o755 if item.external_attr >> 16 & 0o111 else 0o644)


def snapshot(root):
    files = {}
    for path in sorted(root.rglob('*')):
        need(not path.is_symlink(), 'Linked release payload: ' + str(path))
        if path.is_file():
            files[path.relative_to(root).as_posix()] = {'sha256': sha(path), 'mode': stat.S_IMODE(path.stat().st_mode)}
    return files


def accept(result, expected_files, output):
    """Recheck complete file coverage, TAP totals and retained bytes independently."""
    try:
        rows, counts = result['results'], result['counts']
        if any(type(counts[key]) is not int or counts[key] < 0 for key in COUNT_KEYS):
            return False
        if not (result['schema'] == 'agi-full-regressions/v1' and result['status'] == 'PASS' and result['scope'] == 'FULL' and
                result['complete'] is True and result['sourceUnchanged'] is True and result['retainedLogsUnchanged'] is True and
                result['prerequisites']['unixSocket']['available'] is True and result['testFiles'] == len(expected_files) >= 342 and
                len(rows) == len(expected_files) and {row['file'] for row in rows} == set(expected_files) and
                counts['tests'] >= 3898 and counts['pass'] == counts['tests']):
            return False
        totals = collections.Counter()
        logs = set()
        for row in rows:
            if not (row['exitCode'] == 0 and row['timedOut'] is False and row['completeSummary'] is True and
                    row['sourceSHA256'] == expected_files[row['file']] and row['counts']['tests'] > 0 and
                    row['counts']['pass'] == row['counts']['tests'] and all(key in row['counts'] for key in COUNT_KEYS) and
                    not any(row['counts'][key] for key in ('fail', 'cancelled', 'skipped', 'todo'))):
                return False
            if any(type(row['counts'][key]) is not int or row['counts'][key] < 0 for key in COUNT_KEYS):
                return False
            log = output / row['log']
            if Path(row['log']).name != row['log'] or log in logs or log.is_symlink() or not log.is_file():
                return False
            logs.add(log)
            if log.stat().st_size != row['logBytes'] or sha(log) != row['logSHA256']:
                return False
            text = log.read_text(errors='replace')
            actual = {key: int(matches[-1]) for key in COUNT_KEYS if (matches := re.findall(r'^# ' + key + r' (\d+)$', text, re.M))}
            if actual != row['counts']:
                return False
            totals.update(actual)
        return all(totals[key] == counts[key] for key in COUNT_KEYS) and not any(counts[key] for key in ('fail', 'cancelled', 'skipped', 'todo'))
    except (KeyError, TypeError, ValueError, OSError):
        return False


def run(command, log, environment, *, timeout=10800, stdin=None):
    command = list(map(str, command))
    print('RUN ' + ' '.join(command), flush=True)
    with log.open('wb') as output:
        child = subprocess.Popen(command, env=environment, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                 stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        if stdin is not None:
            try:
                child.stdin.write(stdin)
                child.stdin.close()
            except BrokenPipeError:
                pass
        started = time.monotonic()
        previous = None
        while child.poll() is None:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                child.wait(timeout=min(30, remaining))
            except subprocess.TimeoutExpired:
                if '--out' in command:
                    progress = Path(command[command.index('--out') + 1]) / 'progress.json'
                    if progress.is_file():
                        value = json.loads(progress.read_text())
                        rendered = json.dumps({'completedFiles': value['completedFiles'], 'totalFiles': value['totalFiles'],
                                               'failedFiles': [row['file'] for row in value['results'] if row['exitCode'] != 0]})
                        if rendered != previous:
                            print('PROGRESS ' + rendered, flush=True)
                            previous = rendered
    print('EXIT ' + str(child.returncode) + ' ' + log.name, flush=True)
    if child.returncode:
        print(log.read_text(errors='replace')[-16000:], flush=True)
    return child.returncode


def native_capability(temporary):
    folder = temporary / 'ownership-probe'
    folder.mkdir(mode=0o700)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(folder / 's'))
        server.listen(1)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(folder / 's'))
            peer, _ = server.accept()
            with peer:
                client.sendall(b'native')
                need(peer.recv(6) == b'native', 'Native socket round trip failed')
        os.chown(folder / 's', 1, 1)
        need((folder / 's').stat().st_uid == 1, 'Foreign socket ownership could not be exercised')
        os.chown(folder / 's', 0, 0)
    os.chown(folder, 1, 1)
    need(folder.stat().st_uid == 1, 'Foreign directory ownership could not be exercised')
    os.chown(folder, 0, 0)
    return {'unixSocketRoundTrip': 'PASS', 'foreignSocketOwnership': 'PASS', 'foreignDirectoryOwnership': 'PASS'}


def safe_launcher_smoke(source, evidence, environment):
    """Execute only integrity checks and offline practice; never an installer."""
    cases = [(source / 'Verify-Package.command', 'files verified; 0 missing or changed.')]
    cases += [(source / 'packages' / ('AGI_' + role) / 'Verify-Package.command', 'files verified; 0 missing or changed.') for role in ROLES]
    cases += [(source / 'Practice-Offline.command', 'Complete public example: approve')]
    rows = []
    for index, (launcher, marker) in enumerate(cases):
        log = evidence / ('mac-launcher-' + str(index) + '.log')
        code = run([launcher], log, environment, timeout=120, stdin=b'\n')
        passed = code == 0 and marker in log.read_text(errors='replace')
        rows.append({'launcher': launcher.relative_to(source).as_posix(), 'sha256': sha(launcher), 'exitCode': code,
                     'status': 'PASS' if passed else 'NOT_PASS', 'log': log.name, 'logSHA256': sha(log)})
    return {'status': 'PASS' if all(row['status'] == 'PASS' for row in rows) else 'NOT_PASS',
            'scope': 'SEVEN_PACKAGE_INTEGRITY_LAUNCHERS_AND_OFFLINE_PRACTICE', 'cases': rows,
            'installation': 'NOT_RUN', 'FinderGatekeeper': 'NOT_RUN', 'DockerDesktop': 'NOT_RUN'}


def packaged_host_checks(source, evidence, environment, node):
    cases = []
    for index, (edition, root) in enumerate([('fleet', source), *((role.lower(), source / 'packages' / ('AGI_' + role)) for role in ROLES)]):
        script = root / 'scripts/check-mac-host.mjs'
        module = root / 'shared/runtime/compute/mac-host.mjs'
        code = ('await import(' + json.dumps(script.as_uri()) + ');if(process.exitCode)process.exit(process.exitCode);'
                'const {assertMacHost}=await import(' + json.dumps(module.as_uri()) + ');console.log(JSON.stringify(assertMacHost()));')
        log = evidence / ('mac-host-' + str(index) + '.log')
        exit_code = run([node, '--input-type=module', '-e', code], log, environment, timeout=60)
        row = {'edition': edition, 'script': script.relative_to(source).as_posix(), 'scriptSHA256': sha(script),
               'module': module.relative_to(source).as_posix(), 'moduleSHA256': sha(module), 'exitCode': exit_code,
               'status': 'NOT_PASS', 'log': log.name, 'logSHA256': sha(log)}
        if exit_code == 0:
            try:
                value = json.loads(log.read_text())
                row['observation'] = value
                if value == {'schema': 'agi-macos-host/v1', 'platform': 'darwin', 'arch': 'arm64',
                             'osVersion': platform.mac_ver()[0], 'translated': False, 'productionQualified': False}:
                    row['status'] = 'PASS'
            except (ValueError, OSError):
                pass
        cases.append(row)
    return {'schema': 'agi-macos-packaged-host-gates/v1', 'status': 'PASS' if all(row['status'] == 'PASS' for row in cases) else 'NOT_PASS',
            'platform': 'darwin', 'architecture': 'arm64', 'cases': cases, 'productionQualified': False}


def entry_identity(path):
    if not path.exists() and not path.is_symlink():
        return {'kind': 'absent'}
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode), 'System Node entry must be a file or symbolic link')
    result = {'kind': 'symlink' if path.is_symlink() else 'file', 'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode)}
    if path.is_symlink():
        result['linkTarget'] = os.readlink(path)
        result['sha256'] = hashlib.sha256(os.fsencode(result['linkTarget'])).hexdigest()
    else:
        result['sha256'] = sha(path)
    return result


def parent_permissions():
    rows = []
    for name in SYSTEM_NODE_PARENTS:
        path = Path(name)
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and not path.is_symlink(), 'System Node parent must be an ordinary directory')
        rows.append({'path': name, 'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode)})
    return rows


def safe_ci_parents(rows, runner_uid):
    need([row['path'] for row in rows] == list(SYSTEM_NODE_PARENTS), 'Unexpected system Node parent chain')
    for row in rows:
        need(row['uid'] in (0, runner_uid) and not row['mode'] & 0o002 and
             (not row['mode'] & 0o020 or row['gid'] == 80), 'Unsafe system Node parent ownership or permissions')


def provision_system_node(node, runner_uid, state):
    # This is only engineering preparation on an ephemeral hosted machine.
    # Never use this operation for a Standard-account Mac installation.
    runner_guard(os.environ, platform.system(), platform.machine(), os.geteuid(), os.environ.get('HOME', ''))
    parents = parent_permissions()
    safe_ci_parents(parents, runner_uid)
    state.update(schema='agi-macos-ci-system-node/v1', status='NOT_PASS', scope='DISPOSABLE_GITHUB_HOSTED_CI_ONLY',
                 operatorAccountsUsed=False, target=str(SYSTEM_NODE), version=NODE_VERSION, archiveSHA256=NODE_SHA256,
                 executableSHA256=sha(node), originalEntry=entry_identity(SYSTEM_NODE), parentsBefore=parents,
                 runnerUID=runner_uid,
                 repository=REPOSITORY, githubRunId=os.environ['GITHUB_RUN_ID'], workflowCommit=os.environ['GITHUB_SHA'])
    nonce = os.environ['GITHUB_RUN_ID'] + '-' + str(os.getpid())
    backup = SYSTEM_NODE.with_name('.node-agi-' + nonce + '-original')
    stage = SYSTEM_NODE.with_name('.node-agi-' + nonce + '-pinned')
    need(not backup.exists() and not backup.is_symlink() and not stage.exists() and not stage.is_symlink(), 'System Node preparation already exists')
    state['_backup'] = backup
    state['_stage'] = stage
    state['_prepared'] = True
    if state['originalEntry']['kind'] != 'absent':
        SYSTEM_NODE.rename(backup)
        need(entry_identity(backup) == state['originalEntry'], 'Original system Node identity was not preserved')
    with node.open('rb') as source, stage.open('xb') as destination:
        shutil.copyfileobj(source, destination)
    stage.chmod(0o755)
    need(sha(stage) == state['executableSHA256'], 'Provisioned system Node differs from the verified private binary')
    stage.rename(SYSTEM_NODE)
    state['provisionedEntry'] = entry_identity(SYSTEM_NODE)
    need(state['provisionedEntry']['uid'] == 0 and state['provisionedEntry']['mode'] == 0o755, 'Provisioned Node must be root-owned and executable')
    need(parent_permissions() == parents, 'System Node parent permissions changed')


def probe_system_node(package, evidence, environment, node, state):
    module = package / PROBE_MODULE
    candidates = re.search(r'if \(platform === "darwin"\) return (\[[\s\S]*?\]);', module.read_text())
    need(candidates is not None, 'Pinned upstream Darwin candidate policy was not found')
    state['systemNodeCandidates'] = json.loads(candidates[1])
    need(state['systemNodeCandidates'] == list(SYSTEM_NODE_CANDIDATES) and state['systemNodeCandidates'][0] == str(SYSTEM_NODE),
         'Pinned upstream Darwin candidate policy changed')
    state['probeModule'] = PROBE_MODULE
    state['probeModuleSHA256'] = sha(module)
    code = ('const m=await import(' + json.dumps(module.as_uri()) + ');const v=await m.l({env:process.env});'
            'const warning=m.r(v,' + json.dumps(str(node)) + ');if(warning)throw Error(warning);'
            'console.log(JSON.stringify({path:v?.path,status:v?.status,version:v?.version,sqliteVersion:v?.sqliteVersion}));')
    log = evidence / 'system-node-probe.json'
    need(run([node, '--input-type=module', '-e', code], log, environment, timeout=90) == 0, 'Pinned upstream system Node probe reported a warning or failed')
    value = json.loads(log.read_text())
    need(value.get('path') == str(SYSTEM_NODE) and value.get('status') == 'supported' and value.get('version') == NODE_VERSION,
         'Pinned upstream selected an unexpected system Node')
    need(sha(Path(value['path'])) == state['executableSHA256'], 'Upstream selected Node bytes differ from the verified private binary')
    state.update(probe=value, probeSHA256=sha(Path(value['path'])), probeWarnings=[], probeLog=log.name, probeLogSHA256=sha(log))


def restore_system_node(state):
    if not state.get('_prepared'):
        return
    backup, stage = state['_backup'], state['_stage']
    if SYSTEM_NODE.exists() or SYSTEM_NODE.is_symlink():
        need(entry_identity(SYSTEM_NODE) == state.get('provisionedEntry'), 'System Node changed during engineering checks; preserve evidence')
        SYSTEM_NODE.unlink()
    if stage.exists():
        need(stage.is_file() and not stage.is_symlink(), 'Unexpected system Node staging entry')
        stage.unlink()
    if state['originalEntry']['kind'] != 'absent':
        need(entry_identity(backup) == state['originalEntry'], 'Preserved system Node changed during engineering checks')
        backup.rename(SYSTEM_NODE)
    state['restoredEntry'] = entry_identity(SYSTEM_NODE)
    state['parentsAfter'] = parent_permissions()
    need(state['restoredEntry'] == state['originalEntry'] and state['parentsAfter'] == state['parentsBefore'], 'System Node restoration differs from the original entry or parent permissions')
    state.update(originalPreserved=True, restoration='PASS', parentPermissionsUnchanged=True)
    if state.get('probeWarnings') == [] and state.get('probeSHA256') == state['executableSHA256']:
        state['status'] = 'PASS'


def readable_evidence(root):
    for path in root.rglob('*'):
        if not path.is_symlink():
            path.chmod(0o755 if path.is_dir() else 0o644)
    root.chmod(0o755)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    runner_guard(os.environ, platform.system(), platform.machine(), os.geteuid(), os.environ.get('HOME', ''))
    need(platform.mac_ver()[0].split('.')[0] == os.environ['AGI_MACOS_RUNNER_LABEL'].split('-')[1], 'macOS version must match its pinned runner label')
    work, evidence = args.work.resolve(), args.evidence.resolve()
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve()
    need(work.is_relative_to('/private/var/root') and work != Path('/private/var/root'), 'Work must be a new private CI directory under /private/var/root')
    need(evidence.is_relative_to(workspace) and evidence != workspace and not evidence.is_relative_to(work), 'Evidence must be a new directory under the checkout workspace')
    need(not work.exists() and not evidence.exists(), 'Work and evidence destinations must be new')
    work.mkdir(mode=0o700, parents=True)
    evidence.mkdir(mode=0o755, parents=True)
    os.umask(0o022)
    summary = {'schema': 'agi-macos-native-acceptance/v1', 'version': VERSION, 'status': 'NOT_PASS',
               'nativeAcceptance': 'NOT_PASS', 'platform': 'darwin', 'architecture': 'arm64',
               'physicalQualification': 'NOT_RUN', 'productionQualified': False, 'operatorAccountsUsed': False,
               'githubRunId': os.environ['GITHUB_RUN_ID'], 'workflowCommit': os.environ['GITHUB_SHA'],
               'repository': REPOSITORY, 'runnerLabel': os.environ['AGI_MACOS_RUNNER_LABEL'],
               'runnerOS': os.environ['RUNNER_OS'], 'runnerArchitecture': os.environ['RUNNER_ARCH'],
               'runnerEnvironment': os.environ['RUNNER_ENVIRONMENT']}
    temporary = None
    system_node = {}
    try:
        save(evidence / 'runner.json', {**summary, 'platformDetail': platform.platform(), 'macOS': platform.mac_ver()[0], 'uid': os.geteuid()})
        # macOS AF_UNIX paths are limited to 104 bytes; avoid the long hosted
        # runner temporary-directory default without weakening socket checks.
        temporary = Path(tempfile.mkdtemp(prefix='t', dir='/private/var/root'))
        save(evidence / 'native-capability.json', native_capability(temporary))
        metadata = json.loads(args.metadata.read_text())
        release_guard(metadata, os.environ['GITHUB_SHA'])
        builder = runpy.run_path(str(ROOT / 'macos/build.py'))
        receipt = builder['verify'](args.archive.resolve(), metadata, work / 'release')
        source = work / 'release' / metadata['prefix']
        summary['releaseSHA256'] = sha(args.archive)
        summary['releaseMetadataSHA256'] = sha(args.metadata)
        shutil.copyfile(args.metadata, evidence / 'release-metadata.json')
        save(evidence / 'saved-archive-validation.json', receipt)
        before = snapshot(source)
        save(evidence / 'tested-archive-tree.json', before)
        expected_files = {relative: item['sha256'] for relative, item in before.items()
                          if re.fullmatch(r'(?:tests|packages/AGI_[^/]+/tests)/[^/]+\.test\.mjs', relative)}
        need(len(expected_files) >= 342, 'The complete Fleet/six-role test inventory is required')
        home = Path(os.environ['HOME']).resolve()
        runtime = home / '.agi-genesis-runtime'
        runtime.mkdir(mode=0o700)
        node_name = 'node-v' + NODE_VERSION + '-darwin-arm64'
        node_archive = work / (node_name + '.tar.xz')
        receipt = download('https://nodejs.org/dist/v' + NODE_VERSION + '/' + node_archive.name, node_archive, NODE_SHA256)
        with tarfile.open(node_archive) as archive:
            archive.extractall(runtime, filter='data')
        node_root = runtime / ('node-' + NODE_VERSION)
        (runtime / node_name).rename(node_root)
        node_root.chmod(0o700)
        node, npm = node_root / 'bin/node', node_root / 'bin/npm'
        need(node.is_file() and not node.is_symlink() and os.access(node, os.X_OK), 'Pinned Darwin Node must retain its archive executable mode')
        need(NODE_SHA256 in (source / 'scripts/standard-node.sh').read_text(), 'Engineering Node pin differs from the packaged Mac bootstrap')
        ownership = []
        for path in (node, *node.parents):
            info = path.lstat()
            need(not path.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o022, 'Unsafe pinned Node ownership chain: ' + str(path))
            ownership.append({'path': str(path), 'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode)})
        save(evidence / 'node-ownership-chain.json', ownership)
        receipt['executableSHA256'] = sha(node)
        receipt['version'] = NODE_VERSION
        save(evidence / 'node-download.json', receipt)
        environment = {'HOME': os.environ['HOME'], 'PATH': str(node.parent) + os.pathsep + str(Path(sys.executable).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin',
                       'TMPDIR': str(temporary), 'TMP': str(temporary), 'TEMP': str(temporary), 'LANG': 'en_US.UTF-8',
                       'USER': 'root', 'LOGNAME': 'root', 'CI': 'true', 'AGI_REQUIRE_LIVE_PLUGIN_CATALOG': '1'}
        node_identity = json.loads(subprocess.check_output([str(node), '-p', 'JSON.stringify({platform:process.platform,architecture:process.arch,version:process.versions.node})'], env=environment, text=True, timeout=30))
        need(node_identity == {'platform': 'darwin', 'architecture': 'arm64', 'version': NODE_VERSION}, 'Node must execute natively on Apple silicon')
        save(evidence / 'node-identity.json', node_identity)
        host_checks = packaged_host_checks(source, evidence, environment, node)
        save(evidence / 'mac-host.json', host_checks)
        summary['packagedHostGates'] = host_checks['status']
        need(host_checks['status'] == 'PASS', 'The packaged native Mac host gates did not pass on every edition')
        fixture = work / FIXTURE_NAME
        receipt = download('https://github.com/' + REPOSITORY + '/releases/download/v1.0.6-qualification/' + FIXTURE_NAME, fixture, FIXTURE_SHA256, FIXTURE_BYTES)
        save(evidence / 'fixture-download.json', receipt)
        extract_fixtures(fixture, work / 'fixture-archives')
        dependencies = work / 'dependencies'
        code = run([sys.executable, source / 'scripts/prepare-regression-fixtures.py', '--archives', work / 'fixture-archives' / FIXTURE_NAME[:-4],
                    '--destination', dependencies, '--node', node, '--npm', npm], evidence / 'prepare-fixtures.log', environment, timeout=1800)
        if (dependencies / 'npm-ci.log').is_file():
            shutil.copyfile(dependencies / 'npm-ci.log', evidence / 'npm-ci.log')
        need(code == 0, 'Verified dependency preparation failed')
        shutil.copyfile(dependencies / 'fixture-receipts.json', evidence / 'historical-fixture-receipts.json')
        version = subprocess.check_output([str(node), str(dependencies / 'runtime/node_modules/openclaw/openclaw.mjs'), '--version'], env=environment, text=True, timeout=30).strip()
        need('2026.9.5' in version.split(), 'Unexpected OpenClaw CLI version')
        save(evidence / 'openclaw-cli-version.json', {'output': version, 'expected': '2026.9.5'})
        package = dependencies / 'runtime/node_modules/openclaw'
        before_code = ('const m=await import(' + json.dumps((package / PROBE_MODULE).as_uri()) + ');const v=await m.l({env:process.env});'
                       'console.log(JSON.stringify({path:v?.path,status:v?.status,version:v?.version,sqliteVersion:v?.sqliteVersion,warning:m.r(v,' + json.dumps(str(node)) + ')}));')
        run([node, '--input-type=module', '-e', before_code], evidence / 'system-node-before.json', environment, timeout=90)
        provision_system_node(node, workspace.stat().st_uid, system_node)
        probe_system_node(package, evidence, environment, node, system_node)
        smoke = safe_launcher_smoke(source, evidence, environment)
        save(evidence / 'mac-launcher-smoke.json', smoke)
        code = run([sys.executable, source / 'scripts/run-regressions.py', '--node', node, '--openclaw', dependencies / 'runtime/node_modules/openclaw',
                    '--historical', dependencies / 'historical', '--jobs', '2', '--out', evidence / 'complete'], evidence / 'complete-run.log', environment)
        result = json.loads((evidence / 'complete/results.json').read_text())
        unchanged = before == snapshot(source)
        passed = code == 0 and accept(result, expected_files, evidence / 'complete') and unchanged and smoke['status'] == 'PASS'
        summary.update(status='PASS' if passed else 'NOT_PASS', nativeAcceptance='PASS' if passed else 'NOT_PASS',
                       complete={'status': 'PASS' if passed else 'NOT_PASS', 'runnerExitCode': code, 'counts': result.get('counts'), 'testFiles': result.get('testFiles')},
                       archiveTreeUnchanged=unchanged, launcherSmoke=smoke['status'])
    except Exception as error:
        summary['error'] = type(error).__name__ + ': ' + str(error)
        print(summary['error'], file=sys.stderr, flush=True)
    finally:
        if system_node:
            try:
                restore_system_node(system_node)
            except Exception as error:
                system_node['restoration'] = 'NOT_PASS'
                system_node['error'] = type(error).__name__ + ': ' + str(error)
            save(evidence / 'system-node.json', {key: value for key, value in system_node.items() if not key.startswith('_')})
        summary['systemNodeProvisioning'] = system_node.get('status', 'NOT_PASS')
        if summary['systemNodeProvisioning'] != 'PASS':
            summary['status'] = summary['nativeAcceptance'] = 'NOT_PASS'
            if 'complete' in summary:
                summary['complete']['status'] = 'NOT_PASS'
        save(evidence / 'summary.json', summary)
        readable_evidence(evidence)
        if temporary is not None:
            shutil.rmtree(temporary)
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if summary['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
