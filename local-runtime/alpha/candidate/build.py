#!/usr/bin/env python3
"""Build a candidate rootfs from reviewed bytes without executing its contents.

This is a development artifact builder, never provisioning or runtime authority.
Only official HTTPS assets in the checked-in input lock may be downloaded.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import zlib
import tarfile
import urllib.parse
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
ALPHA = HERE.parent
ROOT = ALPHA.parents[1]
MAX_ARCHIVE = 300_000_000
MAX_EXPANDED = 1_000_000_000
ALLOWED_HOSTS = {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
                 'files.pythonhosted.org', 'archive.ubuntu.com', 'ports.ubuntu.com'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def file_sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def path_parts(name):
    require(isinstance(name, str) and '\\' not in name and '\x00' not in name, 'Unsafe archive path')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts, 'Escaping archive path')
    return p.parts


def safe_url(url):
    u = urllib.parse.urlsplit(url)
    require(u.scheme == 'https' and u.hostname in ALLOWED_HOSTS and not u.username
            and not u.password and u.port in (None, 443), 'Only pinned official HTTPS assets are allowed')
    return url


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def assets(target):
    return [target['python'], *target['runtimePackages'], *target['wheels']]


def read_lock():
    lock = json.loads((HERE / 'inputs.lock.json').read_text())
    require(lock['schema'] == 'agi-fleet/alpha-candidate-inputs/v1', 'Unknown candidate lock')
    trust_path = ALPHA / 'package-lock.json'
    trust = json.loads(trust_path.read_text())
    require(file_sha(trust_path) == lock['productionTrustLockSha256'] and trust['state'] == 'UNPROVISIONED'
            and all(v is None for v in trust['targets'].values()), 'Production trust must remain unchanged and unprovisioned')
    require(trust['source'] == lock['source'], 'Alpha source pin disagreement')
    require(file_sha(ALPHA.parent / 'tests/fixtures/alpha-contract.json') == lock['contractFixtureSha256'],
            'Reviewed contract fixture changed')
    requirements = (ALPHA / 'requirements-fleet.lock').read_bytes()
    require(sha(requirements) == lock['requirementsSha256'], 'Dependency subset changed')
    blocks = re.split(r'\n(?=[a-zA-Z0-9])', requirements.decode())
    packages = {}
    for block in blocks:
        match = re.match(r'([a-z0-9-]+)==([^\s]+)', block)
        if match:
            packages[match[1]] = (match[2], set(re.findall(r'--hash=sha256:([0-9a-f]{64})', block)))
    require(len(packages) == 10, 'Expected the reviewed ten-package closure')
    for target in lock['targets'].values():
        require(len(target['wheels']) == len(packages), 'Incomplete wheel closure')
        require({w['package'] for w in target['wheels']} == set(packages), 'Unexpected wheel package')
        for a in assets(target):
            require(re.fullmatch('[0-9a-f]{64}', a['sha256']) and 0 < a['bytes'] <= MAX_ARCHIVE,
                    'Missing exact artifact identity')
            require(Path(a['filename']).name == a['filename'], 'Unsafe artifact filename')
            safe_url(a['url'])
        for w in target['wheels']:
            version, hashes = packages[w['package']]
            require(w['version'] == version and w['sha256'] in hashes and w['filename'].endswith('.whl'),
                    'Wheel is not in package-specific upstream hash lock')
    return lock


def fetch(target, cache):
    cache.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(OfficialRedirect())
    for item in assets(target):
        dest = cache / item['filename']
        require(not dest.is_symlink(), 'Asset cache symlink refused')
        if not dest.exists():
            partial = dest.with_name(dest.name + '.partial')
            require(not partial.exists(), 'Unfinished download: remove it after inspection')
            try:
                with opener.open(safe_url(item['url']), timeout=60) as response, partial.open('xb') as out:
                    count = 0
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        require(count <= item['bytes'], 'Download exceeds pinned size')
                        out.write(chunk)
                require(partial.stat().st_size == item['bytes'] and file_sha(partial) == item['sha256'], 'Downloaded artifact digest mismatch')
                partial.rename(dest)
            except BaseException:
                # Retain partial evidence; never fall back to unverified bytes.
                raise
        require(dest.is_file() and dest.stat().st_size == item['bytes'] and file_sha(dest) == item['sha256'],
                'Cached artifact differs from reviewed lock')


def checked_assets(target, cache):
    for item in assets(target):
        p = cache / item['filename']
        require(p.is_file() and not p.is_symlink() and p.stat().st_size == item['bytes'] and file_sha(p) == item['sha256'],
                'Verified asset absent or changed: ' + item['filename'])


def extract_tar(stream, destination, select=lambda p: True):
    """Extract regular files/dirs/internal relative symlinks only, never scripts."""
    seen, total, links, directories = set(), 0, [], []
    with tarfile.open(fileobj=stream, mode='r:*') as archive:
        for member in archive:
            parts = path_parts(member.name)
            if not parts or not select(parts):
                continue
            name = '/'.join(parts)
            require(name not in seen, 'Duplicate tar path')
            seen.add(name)
            out = destination.joinpath(*parts)
            require(not any(p.is_symlink() for p in [out, *out.parents] if p != destination.parent), 'Archive symlink parent')
            out.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                out.mkdir(exist_ok=True)
                directories.append((out, member.mode & 0o777))
            elif member.isfile():
                total += member.size
                require(total <= MAX_EXPANDED, 'Expanded archive too large')
                with archive.extractfile(member) as src, out.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
                require(not member.mode & 0o7000, 'Special archive mode bits')
                out.chmod(member.mode & 0o777)
            elif member.issym():
                # Resolve after every regular file: links cannot redirect extraction.
                require(not PurePosixPath(member.linkname).is_absolute() and '\\' not in member.linkname,
                        'Absolute or invalid archive link')
                links.append((out, member.linkname))
            else:
                raise ValueError('Archive special file or hard link refused: ' + name)
    for out, target in links:
        require(not out.exists() and not out.is_symlink(), 'Duplicate archive link')
        out.symlink_to(target)
    audit_paths(destination)
    for directory, mode in sorted(directories, key=lambda pair: len(pair[0].parts), reverse=True):
        directory.chmod(mode)


def audit_paths(root):
    root = root.resolve()
    for p in root.rglob('*'):
        s = p.lstat()
        require(stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode), 'Special filesystem node')
        if p.is_symlink():
            require(not os.path.isabs(os.readlink(p)), 'Absolute rootfs link')
            resolved = p.resolve(strict=True)
            require(resolved.is_relative_to(root), 'Escaping rootfs link')
        require(not s.st_mode & 0o7000, 'Special mode bits refused')


def install_wheel(archive_path, dest):
    total, seen = 0, set()
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            parts = path_parts(entry.filename)
            require(parts and parts not in seen, 'Duplicate wheel path')
            seen.add(parts)
            require(not stat.S_ISLNK(entry.external_attr >> 16), 'Wheel symlinks refused')
            require(not entry.flag_bits & 1, 'Encrypted wheel refused')
            if parts[0].endswith('.data'):
                require(len(parts) >= 3 and parts[1] in ('purelib', 'platlib'), 'Wheel install scheme is not reviewed')
                parts = parts[2:]
            require(not parts[0].endswith('.pth') and parts[0] not in ('sitecustomize.py', 'usercustomize.py'),
                    'Wheel startup hooks refused')
            out = dest.joinpath(*parts)
            if entry.is_dir():
                out.mkdir(parents=True, exist_ok=True)
                continue
            require(not out.exists(), 'Wheel file collision')
            total += entry.file_size
            require(total <= MAX_EXPANDED, 'Wheel expanded size exceeded')
            out.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, out.open('xb') as target:
                shutil.copyfileobj(source, target)
            out.chmod(0o644)


def source_files(lock, repository, destination):
    commit = lock['source']['commit']
    require(re.fullmatch('[0-9a-f]{40}', commit), 'Exact Alpha commit required')
    original = subprocess.check_output(['git', '-C', str(repository), 'show', commit + ':requirements-agent.lock'])
    require(sha(original) == lock['source']['requirementsSha256'], 'Alpha upstream lock changed')
    for name, digest in lock['sourceFiles'].items():
        parts = path_parts(name)
        raw = subprocess.check_output(['git', '-C', str(repository), 'show', commit + ':' + name])
        require(sha(raw) == digest, 'Alpha source resource changed: ' + name)
        dest = destination.joinpath(*parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)


def elf_audit(root, target):
    """Static ELF dependency resolution only. Never run ldd or package binaries."""
    records = []
    version_definitions = {}
    defaults = [root / 'usr/lib' / target['triplet'], root / 'usr/lib', root / 'lib64']
    for p in sorted(root.rglob('*')):
        if p.is_symlink() or not p.is_file():
            continue
        with p.open('rb') as f:
            if f.read(4) != b'\x7fELF':
                continue
        text = subprocess.check_output(['/usr/bin/readelf', '-h', '-lW', '-dW', '-V', str(p)], text=True, env={'LC_ALL': 'C'})
        require(re.search(r'Class:\s+ELF64\s*\n', text) and
                re.search(r'Data:\s+2.s complement, little endian\s*\n', text), 'Unexpected ELF class or byte order')
        machine = 'AArch64' if target['machine'] == 'aarch64' else 'Advanced Micro Devices X86-64'
        require(re.search(r'Machine:\s+' + re.escape(machine) + r'\s*\n', text), 'Wrong ELF architecture: ' + str(p))
        needed = re.findall(r'\(NEEDED\).*?\[([^\]]+)\]', text)
        paths = re.findall(r'\((?:RUNPATH|RPATH)\).*?\[([^\]]*)\]', text)
        searches = []
        for group in paths:
            for value in group.split(':'):
                require(value and value.startswith(('$ORIGIN', '${ORIGIN}')), 'Non-relative ELF search path')
                relative = value.replace('${ORIGIN}', str(p.parent)).replace('$ORIGIN', str(p.parent))
                require('$' not in relative, 'Unreviewed ELF substitution')
                resolved = Path(relative).resolve()
                require(resolved.is_relative_to(root.resolve()), 'ELF search path escapes rootfs')
                searches.append(resolved)
        resolved_deps = {}
        for name in needed:
            if '/' in name:
                require(name.startswith(('$ORIGIN/', '${ORIGIN}/')), 'Unreviewed ELF dependency path')
                expanded = name.replace('${ORIGIN}', str(p.parent)).replace('$ORIGIN', str(p.parent))
                require('$' not in expanded, 'Unreviewed dependency substitution')
                found = Path(expanded) if Path(expanded).is_file() else None
            else:
                found = next((d / name for d in searches + defaults if (d / name).is_file()), None)
            require(found is not None and found.resolve().is_relative_to(root.resolve()),
                    'Unresolved ELF dependency ' + name + ' for ' + str(p.relative_to(root)))
            with found.open('rb') as dependency:
                require(dependency.read(4) == b'\x7fELF', 'ELF dependency resolves to non-ELF bytes')
            resolved_deps[name] = str(found.resolve().relative_to(root))
        # Check GNU version requirements against the actual bundled provider.
        # This remains a static check, not a substitute for native import tests.
        provider = None
        required_versions = {}
        needs = text.split('Version needs section', 1)
        if len(needs) == 2:
            for line in needs[1].splitlines():
                file_match = re.search(r'File: (\S+)', line)
                if file_match:
                    provider = file_match[1]
                    require(provider in resolved_deps, 'Versioned provider missing from DT_NEEDED')
                    required_versions.setdefault(provider, [])
                name_match = re.search(r'Name: (\S+)', line)
                if name_match and provider:
                    required_versions[provider].append(name_match[1])
        for name, versions in required_versions.items():
            dependency = root / resolved_deps[name]
            if dependency not in version_definitions:
                info = subprocess.check_output(['/usr/bin/readelf', '-V', str(dependency)], text=True, env={'LC_ALL': 'C'})
                definition = info.split('Version definition section', 1)
                definitions = definition[1].split('Version needs section', 1)[0] if len(definition) == 2 else ''
                version_definitions[dependency] = set(re.findall(r'Name: (\S+)', definitions))
            require(set(versions) <= version_definitions[dependency], 'Missing bundled ELF symbol version: ' + name)
        interp = re.search(r'Requesting program interpreter: ([^\]]+)\]', text)
        if interp:
            require(interp[1] == target['loader'] and (root / interp[1].lstrip('/')).is_file(), 'Unpinned ELF interpreter')
        records.append({'path': str(p.relative_to(root)), 'sha256': file_sha(p),
                        'needed': resolved_deps, 'requiredSymbolVersions': required_versions, 'searchPaths': paths, 'interpreter': interp[1] if interp else None})
    require(records, 'No ELF files found')
    return records


def tree_manifest(root):
    audit_paths(root)
    entries = []
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        row = {'path': p.relative_to(root).as_posix(), 'mode': stat.S_IMODE(s.st_mode)}
        if p.is_symlink():
            row.update(type='symlink', target=os.readlink(p))
        elif p.is_dir():
            row.update(type='directory')
        else:
            row.update(type='file', bytes=s.st_size, sha256=file_sha(p))
        entries.append(row)
    return entries


def deterministic_archive(root, output):
    with output.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=9) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for p in [root, *sorted(root.rglob('*'))]:
                info = archive.gettarinfo(str(p), arcname='rootfs' if p == root else 'rootfs/' + p.relative_to(root).as_posix())
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                info.pax_headers = {}
                if info.isfile():
                    with p.open('rb') as source:
                        archive.addfile(info, source)
                else:
                    archive.addfile(info)


def build(lock, name, cache, source, output):
    target = lock['targets'][name]
    checked_assets(target, cache)
    require(not output.exists() and not output.is_symlink(), 'Choose an absent output directory')
    output.mkdir(parents=True)
    root = output / 'rootfs'
    root.mkdir()
    alpha = root / 'opt/alpha'
    alpha.mkdir(parents=True)
    with (cache / target['python']['filename']).open('rb') as stream:
        extract_tar(stream, alpha)
    python = alpha / 'python'
    require((python / 'bin/python3.12').is_file(), 'Standalone interpreter missing')
    # Remove all vendor installer scripts and ambient package search paths.
    shutil.rmtree(python / 'lib/python3.12/site-packages')
    for p in (python / 'bin').iterdir():
        if p.name != 'python3.12':
            p.unlink()
    for p in list(python.rglob('__pycache__')):
        shutil.rmtree(p)
    # GUI/Tcl is outside the bounded work closure and carries vendor build-host
    # RPATHs. Omit it explicitly rather than rewriting ELF or trusting host paths.
    shutil.rmtree(python / 'lib/python3.12/tkinter')
    for child in list((python / 'lib').iterdir()):
        if child.is_dir() and child.name.startswith(('tcl', 'tk', 'itcl', 'thread')):
            shutil.rmtree(child)
    for pattern in ('lib/libtcl*.so', 'lib/libtk*.so', 'lib/python3.12/lib-dynload/_tkinter*.so'):
        for p in python.glob(pattern):
            p.unlink()
    for item in target['runtimePackages']:
        data = subprocess.check_output(['/usr/bin/dpkg-deb', '--fsys-tarfile', str(cache / item['filename'])])
        # No maintainer scripts, executables, ld cache or host libraries are used.
        extract_tar(io.BytesIO(data), root, lambda p: p[:3] == ('usr', 'lib', target['triplet']) or
                    p[:3] == ('usr', 'share', 'doc'))
    (root / 'lib').symlink_to('usr/lib')
    if name == 'linux-x64':
        (root / 'lib64').mkdir()
        (root / 'lib64/ld-linux-x86-64.so.2').symlink_to('../usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
    else:
        (root / 'usr/lib/ld-linux-aarch64.so.1').symlink_to('aarch64-linux-gnu/ld-linux-aarch64.so.1')
    source_files(lock, source, alpha / 'source')
    for item in target['wheels']:
        install_wheel(cache / item['filename'], alpha / 'wheels')
    template = (HERE / 'launcher.py.in').read_text()
    for mode, module in [('work', lock['source']['entrypoint']), ('validate', lock['source']['validator'])]:
        (alpha / ('launch-' + mode + '.py')).write_text(template.replace('@MODULE@', module))
    for dirname in ['tmp', 'proc', 'dev', 'nonexistent']:
        (root / dirname).mkdir()
    for p in root.rglob('*'):
        if not p.is_symlink():
            p.chmod(0o555 if p.is_dir() or p.stat().st_mode & 0o111 else 0o444)
    root.chmod(0o555)
    elves = elf_audit(root, target)
    entries = tree_manifest(root)
    manifest = {'schema': 'agi-fleet/alpha-candidate-artifact/v1', 'evidenceClass': 'UNQUALIFIED_CANDIDATE',
                'productionQualified': False, 'settlementAuthority': False, 'target': name,
                'inputsSha256': file_sha(HERE / 'inputs.lock.json'), 'sourceCommit': lock['source']['commit'],
                'builderSha256': file_sha(Path(__file__)), 'launcherSha256': file_sha(HERE / 'launcher.py.in'),
                'treeSha256': sha(canonical(entries)), 'entries': entries, 'elf': elves,
                'buildTools': {'python': sys.version, 'pythonExecutableSha256': file_sha(sys.executable),
                               'zlibCompileVersion': zlib.ZLIB_VERSION, 'zlibRuntimeVersion': zlib.ZLIB_RUNTIME_VERSION,
                               'readelfSha256': file_sha('/usr/bin/readelf'), 'dpkgDebSha256': file_sha('/usr/bin/dpkg-deb')},
                'assets': assets(target), 'qualification': 'NOT_RUN'}
    deterministic_archive(root, output / 'candidate.tar.gz')
    manifest['archiveSha256'] = file_sha(output / 'candidate.tar.gz')
    manifest['archiveBytes'] = (output / 'candidate.tar.gz').stat().st_size
    (output / 'manifest.json').write_bytes(canonical(manifest) + b'\n')
    print(json.dumps({k:manifest[k] for k in ('target','treeSha256','archiveSha256','archiveBytes','evidenceClass')}))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=['linux-x64', 'linux-arm64'])
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--fetch', action='store_true', help='Fetch only reviewed official assets; never execute them')
    parser.add_argument('--alpha-repository', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    lock = read_lock()
    if args.fetch:
        fetch(lock['targets'][args.target], args.cache.resolve())
    if args.output:
        require(args.alpha_repository is not None, 'Pinned Alpha Git source repository is required')
        build(lock, args.target, args.cache.resolve(), args.alpha_repository.resolve(), args.output.resolve())
    else:
        require(args.fetch, 'Choose --fetch and/or --output')


if __name__ == '__main__':
    main()
