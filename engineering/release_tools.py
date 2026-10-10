import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.request
import zipfile

REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
VERSION = '1.0.9'
PREFIX = 'AGI_Fleet_Linux_v1.0.9'
ASSET = PREFIX + '.zip'
SIZE = 401420759
SHA256 = '5e17bac752ae8dfc8756fe8dc612ceb8820616723808232f3541d552addce102'
SOURCE_REVISION = '0bf5b82329a7f743759fa7f8a6383ef985df286f3c702143719b8667c5051f97'
URL = f'https://github.com/{REPOSITORY}/releases/download/v1.0.9-qualification/{ASSET}'
LIMIT = 450000000
ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, destination, expected_sha, expected_size):
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Download destination already exists')
    require(0 < expected_size < LIMIT, 'Invalid download size')
    request = urllib.request.Request(url, headers={'User-Agent': 'AGI-Fleet-Linux-release-tools'})
    with urllib.request.urlopen(request, timeout=120) as source, destination.open('xb') as output:
        total = 0
        while data := source.read(1024 * 1024):
            total += len(data)
            require(total <= expected_size, 'Download exceeds the pinned size')
            output.write(data)
    require(total == expected_size and sha(destination) == expected_sha, 'Downloaded artifact identity mismatch')


def members(archive):
    entries = archive.infolist()
    require(len(entries) <= 40000, 'Archive has too many members')
    names = set()
    total = 0
    for entry in entries:
        name = entry.filename
        parts = name.split('/')
        kind = stat.S_IFMT(entry.external_attr >> 16)
        require(name and not name.startswith('/') and '\\' not in name and '\x00' not in name,
                'Unsafe archive member')
        require(all(part not in ('', '.', '..') for part in parts), 'Unsafe archive member')
        require(kind in (0, stat.S_IFREG) and not entry.is_dir(), 'Nonregular archive member')
        require(name.casefold() not in names, 'Duplicate archive member')
        names.add(name.casefold())
        require(0 <= entry.file_size < LIMIT, 'Archive member exceeds the size limit')
        total += entry.file_size
    require(total <= 1000000000, 'Archive expands beyond the release bound')
    return entries


def verify_archive(path):
    require(Path(path).stat().st_size == SIZE and sha(path) == SHA256, 'Frozen release identity mismatch')
    with zipfile.ZipFile(path) as archive:
        entries = members(archive)
        require(all(entry.filename.startswith(PREFIX + '/') for entry in entries), 'Wrong release prefix')
        require(archive.testzip() is None, 'Archive CRC verification failed')
        registry = json.loads(archive.read(PREFIX + '/config/role-registry.json'))['roles']
        require(set(registry) == {'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'},
                'Release does not contain all six roles')
        paths = ['', *['packages/' + value['package'] + '/' for value in registry.values()]]
        all_names = {entry.filename for entry in entries}
        checked = 0
        for relative in paths:
            base = PREFIX + '/' + relative
            expected = {}
            for line in archive.read(base + 'MANIFEST.sha256').decode().splitlines():
                digest, name = line.split('  ', 1)
                require(len(digest) == 64 and all(c in '0123456789abcdef' for c in digest), 'Invalid manifest hash')
                require(not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in name.split('/')),
                        'Invalid manifest path')
                require(name not in expected, 'Duplicate manifest entry')
                expected[name] = digest
            actual = {name[len(base):] for name in all_names if name.startswith(base) and name != base + 'MANIFEST.sha256'}
            require(set(expected) == actual, 'Manifest coverage differs')
            for name, digest in expected.items():
                require(hashlib.sha256(archive.read(base + name)).hexdigest() == digest, 'Manifest member differs: ' + name)
                checked += 1
            inventory = json.loads(archive.read(base + 'source-inventory.json'))
            records = inventory['files']
            require(hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                    == inventory['revisionSHA256'], 'Source inventory identity differs')
            require(len({row['path'] for row in records}) == len(records), 'Duplicate source inventory entry')
            for row in records:
                entry = archive.getinfo(base + row['path'])
                require(hashlib.sha256(archive.read(entry)).hexdigest() == row['sha256'], 'Source bytes differ')
                require(bool(entry.external_attr >> 16 & 0o111) == row['executable'], 'Source executable mode differs')
    return {'status': 'PASS', 'sha256': SHA256, 'bytes': SIZE, 'manifestEntriesVerified': checked,
            'editions': len(paths), 'sourceFiles': len(json.loads(zipfile_inventory(path))['files'])}


def zipfile_inventory(path):
    with zipfile.ZipFile(path) as archive:
        return archive.read(PREFIX + '/source-inventory.json')


def extract(archive_path, destination, selected=None):
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Extraction destination must be absent')
    parent = destination.parent.resolve(strict=True)
    require(parent == destination.parent.absolute(), 'Destination parent must be canonical')
    stage = Path(tempfile.mkdtemp(prefix='.agi-extract-', dir=parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            entries = members(archive)
            if selected is not None:
                require(set(selected) <= {entry.filename for entry in entries}, 'Selected source member is absent')
            for entry in entries:
                if selected is not None and entry.filename not in selected:
                    continue
                target = stage / entry.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                target.chmod(0o755 if entry.external_attr >> 16 & 0o111 else 0o644)
        require(not destination.exists() and not destination.is_symlink(), 'Extraction destination changed')
        os.rename(stage, destination)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def verify_source(root):
    root = Path(root)
    require(not root.is_symlink(), 'Source directory cannot be a link')
    inventory = json.loads((root / 'source-inventory.json').read_text())
    require(inventory['revisionSHA256'] == SOURCE_REVISION, 'Frozen source revision differs')
    records = inventory['files']
    require(hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            == inventory['revisionSHA256'], 'Source inventory identity differs')
    expected = {row['path'] for row in records} | {'source-inventory.json'}
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    require(actual == expected and len(records) == 4816, 'Source mirror coverage differs')
    for row in records:
        path = root / row['path']
        require(not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), 'Unsafe source file')
        require(sha(path) == row['sha256'] and bool(path.stat().st_mode & 0o111) == row['executable'],
                'Source mirror differs: ' + row['path'])
    return {'status': 'PASS', 'files': len(records), 'revisionSHA256': inventory['revisionSHA256']}
