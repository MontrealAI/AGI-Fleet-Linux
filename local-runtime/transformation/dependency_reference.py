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
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'local-runtime/transformation/dependency-reference.json'
INPUTS = ('fleet/package.json', 'fleet/package-lock.json')
SCHEMA = 'agi-fleet/ti-locked-dependency-reference/v1'
NODE = 'v24.21.0'
NPM = '11.19.0'
COMMAND = ['npm', 'ci', '--ignore-scripts', '--omit=dev']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def identities(inputs):
    return {name: {'sha256': sha(inputs[name]), 'bytes': len(inputs[name])} for name in INPUTS}


def records(entries):
    return [{'path': name, 'sha256': sha(data), 'bytes': len(data), 'mode': mode}
            for name, (data, mode) in sorted(entries.items())]


def packaged_members(directory):
    """Use precisely the existing alpha.7 packaged dependency member rules."""
    entries = {}
    for file in sorted(directory.rglob('*')):
        if '__pycache__' in file.parts or file.suffix == '.pyc':
            continue
        if file.is_symlink():
            if file.parent.name == '.bin' and file.resolve().is_relative_to(directory):
                continue
            raise ValueError('TI_REFERENCE_DEPENDENCY_LINK')
        if file.is_file():
            mode = 0o755 if file.stat().st_mode & 0o111 else 0o644
            entries[file.relative_to(directory).as_posix()] = (file.read_bytes(), mode)
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
            or not members or reference.get('files') != records(members)):
        raise ValueError('TI_LOCKED_DEPENDENCY_REFERENCE_MISMATCH')
    return {'schema': SCHEMA, 'referenceSha256': sha(encoded(reference)),
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
    if any((ROOT / name).read_bytes() != data for name, data in inputs.items()):
        raise ValueError('TI_REFERENCE_REQUIRES_COMMITTED_PACKAGE_INPUTS')
    env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    # Preserve only standard network routing, never npm credentials/configuration.
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
                'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
                'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR'):
        if key in os.environ:
            env[key] = os.environ[key]
    node_version = subprocess.check_output([str(node), '--version'], env=env, text=True).strip()
    with tempfile.TemporaryDirectory(prefix='fleet-ti-locked-reference-', dir=temporary_root) as temporary:
        for key, name in [('NPM_CONFIG_USERCONFIG', 'user.npmrc'), ('NPM_CONFIG_GLOBALCONFIG', 'global.npmrc')]:
            config = Path(temporary) / name
            config.write_bytes(b'')
            env[key] = str(config)
        npm_version = subprocess.check_output([str(node), str(npm_cli), '--version'], env=env, text=True).strip()
        if node_version != NODE or npm_version != NPM:
            raise ValueError('TI_REFERENCE_PINNED_BUILD_TOOLS_REQUIRED')
        stage = Path(temporary) / 'fleet'
        stage.mkdir()
        for name, data in inputs.items():
            (stage / Path(name).name).write_bytes(data)
        command = [str(node), str(npm_cli), 'ci', '--ignore-scripts', '--omit=dev',
                   '--prefix', str(stage), '--cache', str(Path(cache).resolve())]
        subprocess.run(command, env=env, check=True, capture_output=True, timeout=300)
        if any((stage / Path(name).name).read_bytes() != data for name, data in inputs.items()):
            raise ValueError('TI_REFERENCE_INSTALL_CHANGED_LOCKED_INPUTS')
        value = {'schema': SCHEMA, 'inputSourceCommit': commit, 'inputs': identities(inputs),
                 'installation': {'command': COMMAND, 'exitCode': 0, 'node': node_version, 'npm': npm_version,
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
