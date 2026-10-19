"""Explicit locked npm reference generation and packaged-byte comparison.

The reference is produced only by a new private npm installation of committed
inputs. Comparing a package to it never blesses its existing ignored directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'local-runtime/transformation/dependency-reference.json'
INPUTS = ('fleet/package.json', 'fleet/package-lock.json')
SCHEMA = 'agi-fleet/ti-locked-dependency-reference/v1'
NODE = 'v24.21.0'
NPM = '11.19.0'
COMMAND = ['npm', 'ci', '--ignore-scripts', '--omit=dev']
REFRESH_COMMAND = COMMAND + ['--no-audit', '--no-fund', '--bin-links=false', '--fetch-retries=0',
                             '--fetch-timeout=30000', '--maxsockets=4', '--logs-max=0',
                             '--loglevel=error', '--progress=false', '--update-notifier=false']
REFRESH_CONTROLS = {'registry': 'https://registry.npmjs.org/', 'timeoutSeconds': 180,
                    'umask': '0022', 'stdout': 'discarded', 'stderr': 'discarded'}
GENERATED_NPM_LOCK = '.package-lock.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def identities(inputs):
    return {name: {'sha256': sha(inputs[name]), 'bytes': len(inputs[name])} for name in INPUTS}


def records(entries):
    return [{'path': name, 'sha256': sha(data), 'bytes': len(data), 'mode': mode}
            for name, (data, mode) in sorted(entries.items())]


def validate_public_lock(inputs):
    lock = json.loads(inputs['fleet/package-lock.json'])
    packages = lock.get('packages')
    if lock.get('lockfileVersion') != 3 or not isinstance(packages, dict) or len(packages) > 25_000:
        raise ValueError('TI_REFERENCE_PUBLIC_LOCK_REQUIRED')
    for name, package in packages.items():
        if not name:
            continue
        if not isinstance(package, dict):
            raise ValueError('TI_REFERENCE_PUBLIC_INTEGRITY_REQUIRED')
        url = urlsplit(package.get('resolved', ''))
        if (not name.startswith('node_modules/') or '..' in Path(name).parts or package.get('link')
                or url.scheme != 'https' or url.netloc != 'registry.npmjs.org' or url.query or url.fragment
                or not re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', package.get('integrity', ''))):
            raise ValueError('TI_REFERENCE_PUBLIC_INTEGRITY_REQUIRED')


def packaged_members(directory):
    """Capture only bounded regular payloads; npm's root cache is not payload."""
    if directory.is_symlink() or directory.resolve() != directory or not directory.is_dir():
        raise ValueError('TI_REFERENCE_DEPENDENCIES_MISSING')
    entries, total = {}, 0
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise ValueError('TI_REFERENCE_DEPENDENCY_LINK')
        relative = file.relative_to(directory).as_posix()
        if relative == GENERATED_NPM_LOCK:
            continue
        if file.is_file():
            size = file.stat().st_size
            total += size
            if size > 8_000_000 or len(entries) >= 25_000 or total >= 100_000_000:
                raise ValueError('TI_REFERENCE_DEPENDENCY_CAPACITY')
            mode = 0o755 if file.stat().st_mode & 0o111 else 0o644
            entries[relative] = (file.read_bytes(), mode)
    if not entries:
        raise ValueError('TI_REFERENCE_DEPENDENCIES_MISSING')
    return entries


def verify_reference(reference, inputs, members):
    """Compare already captured archive members, without rereading the tree."""
    if (reference.get('schema') != SCHEMA or reference.get('inputs') != identities(inputs)
            or reference.get('installation', {}).get('command') != COMMAND
            or type(reference.get('installation', {}).get('exitCode')) is not int
            or reference.get('installation', {}).get('exitCode') != 0
            or reference.get('installation', {}).get('node') != NODE
            or reference.get('installation', {}).get('npm') != NPM
            or ('invocation' in reference.get('installation', {})
                and (reference['installation']['invocation'] != REFRESH_COMMAND
                     or reference['installation'].get('controls') != REFRESH_CONTROLS))
            or ('controls' in reference.get('installation', {}) and 'invocation' not in reference['installation'])
            or not members or GENERATED_NPM_LOCK in members or reference.get('files') != records(members)):
        raise ValueError('TI_LOCKED_DEPENDENCY_REFERENCE_MISMATCH')
    return {'schema': SCHEMA, 'method': 'captured-members-equal-reviewed-fresh-public-npm-reference',
            'referenceSha256': sha(encoded(reference)), 'excludedGeneratedMembers': [GENERATED_NPM_LOCK],
            'inputs': identities(inputs), 'files': len(members),
            'bytes': sum(len(data) for data, _ in members.values()),
            'referenceEnvironment': reference['installation'],
            'scope': 'packaged bytes equal the reviewed fresh locked npm reference; target native qualification remains required'}


def verify_packaged_dependencies(entries):
    raw = entries['local-runtime/transformation/dependency-reference.json'][0]
    reference = json.loads(raw)
    inputs = {name: entries[name][0] for name in INPUTS}
    prefix = 'fleet/node_modules/'
    members = {name[len(prefix):]: value for name, value in entries.items() if name.startswith(prefix)}
    result = verify_reference(reference, inputs, members)
    # Bind the exact committed receipt bytes, including their serialization.
    result['referenceSha256'] = sha(raw)
    return result


def refresh(node, npm_cli, cache, temporary_root):
    node, npm_cli = Path(node).resolve(strict=True), Path(npm_cli).resolve(strict=True)
    for tool in (node, npm_cli):
        if not stat.S_ISREG(tool.stat().st_mode):
            raise ValueError('TI_REFERENCE_BUILD_TOOL_REQUIRED')
    git_env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
    commit = subprocess.check_output(['git', '--no-replace-objects', 'rev-parse', 'HEAD'],
                                     cwd=ROOT, env=git_env, text=True).strip()
    inputs = {name: subprocess.check_output(['git', '--no-replace-objects', 'show', commit + ':' + name],
                                           cwd=ROOT, env=git_env) for name in INPUTS}
    validate_public_lock(inputs)
    if any((ROOT / name).read_bytes() != data for name, data in inputs.items()):
        raise ValueError('TI_REFERENCE_REQUIRES_COMMITTED_PACKAGE_INPUTS')
    env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    # Preserve only standard network routing, never npm credentials/configuration.
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
                'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
                'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'):
        if key in os.environ:
            env[key] = os.environ[key]
    node_version = subprocess.check_output([str(node), '--version'], env=env, text=True, timeout=10).strip()
    with tempfile.TemporaryDirectory(prefix='fleet-ti-locked-reference-', dir=temporary_root) as temporary:
        for key, name in [('NPM_CONFIG_USERCONFIG', 'user.npmrc'), ('NPM_CONFIG_GLOBALCONFIG', 'global.npmrc')]:
            config = Path(temporary) / name
            config.write_bytes(b'')
            env[key] = str(config)
        npm_version = subprocess.check_output([str(node), str(npm_cli), '--version'], env=env, text=True, timeout=10).strip()
        if node_version != NODE or npm_version != NPM:
            raise ValueError('TI_REFERENCE_PINNED_BUILD_TOOLS_REQUIRED')
        stage = Path(temporary) / 'fleet'
        stage.mkdir()
        for name, data in inputs.items():
            (stage / Path(name).name).write_bytes(data)
        (Path(temporary) / 'tmp').mkdir()
        env['TMPDIR'] = str(Path(temporary) / 'tmp')
        command = [str(node), str(npm_cli), *REFRESH_COMMAND[1:],
                   '--prefix', str(stage), '--cache', str(Path(cache).resolve()),
                   '--registry=https://registry.npmjs.org/']
        subprocess.run(command, cwd=stage, env=env, check=True, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180, umask=0o022)
        if any((stage / Path(name).name).read_bytes() != data for name, data in inputs.items()):
            raise ValueError('TI_REFERENCE_INSTALL_CHANGED_LOCKED_INPUTS')
        value = {'schema': SCHEMA, 'inputSourceCommit': commit, 'inputs': identities(inputs),
                 'installation': {'command': COMMAND, 'invocation': REFRESH_COMMAND, 'controls': REFRESH_CONTROLS, 'exitCode': 0, 'node': node_version, 'npm': npm_version,
                                  'nodeBinarySha256': sha(node.read_bytes()), 'npmCliSha256': sha(npm_cli.read_bytes()),
                                  'system': platform.system(), 'machine': platform.machine(),
                                  'context': 'fresh private staging install; no existing node_modules input'},
                 'files': records(packaged_members(stage / 'node_modules'))}
        REFERENCE.write_bytes(encoded(value))
    print(json.dumps({'reference': str(REFERENCE), 'sha256': sha(REFERENCE.read_bytes()),
                      'files': len(value['files']), 'inputSourceCommit': commit}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--npm-cli', required=True)
    parser.add_argument('--cache', required=True)
    parser.add_argument('--temporary-root', required=True)
    args = parser.parse_args()
    refresh(args.node, args.npm_cli, args.cache, args.temporary_root)


if __name__ == '__main__':
    main()
