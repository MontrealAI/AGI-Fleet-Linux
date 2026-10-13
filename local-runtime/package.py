import argparse, hashlib, json, os, stat, subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'agi-fleet-local-0.1.0-alpha.1'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def build(output):
    output = Path(output).resolve()
    if output.exists() or output.is_relative_to(ROOT):
        raise ValueError('Use an absent output directory outside the checkout')
    entries = {}
    for relative in ['local-runtime', 'local-dashboard', 'role-skills', 'docs/local-skills', 'fleet/shared', 'fleet/successor', 'fleet/node_modules', 'fleet/packages/AGI_Agent/src/admission-core', 'fleet/packages/AGI_Node/src']:
        base = ROOT / relative
        if not base.is_dir():
            raise ValueError('Missing locked dependencies or source: ' + relative)
        for file in sorted(base.rglob('*')):
            if '__pycache__' in file.parts or file.suffix == '.pyc':
                continue
            if file.is_symlink():
                if file.parent.name == '.bin' and file.resolve().is_relative_to(ROOT / 'fleet/node_modules'):
                    continue
                raise ValueError('Unexpected source link: ' + str(file))
            if file.is_file():
                entries[file.relative_to(ROOT).as_posix()] = (file.read_bytes(), 0o755 if file.stat().st_mode & 0o111 else 0o644)
    for relative in ['LOCAL_SKILLS.md', 'LICENSE', 'fleet/package.json', 'fleet/package-lock.json']:
        entries[relative] = ((ROOT / relative).read_bytes(), 0o644)
    records = [{'path': name, 'bytes': len(data), 'sha256': sha(data), 'mode': mode} for name, (data, mode) in sorted(entries.items())]
    if any(r['bytes'] >= 450_000_000 for r in records):
        raise ValueError('Artifact member exceeds size ceiling')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT))
    manifest = {'schema': 'agi-fleet/local-source-preview/v1', 'version': '0.1.0-alpha.1', 'commit': commit, 'workingTreeDirty': dirty, 'operatorInstaller': False, 'productionQualified': False, 'nativeAcceptance': 'NOT_RUN', 'files': records}
    entries['local-preview-manifest.json'] = ((json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode(), 0o644)
    output.mkdir(mode=0o700)
    archive = output / (PREFIX + '.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, (data, mode) in sorted(entries.items()):
            info = zipfile.ZipInfo(PREFIX + '/' + name, date_time=(2026, 10, 13, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    if archive.stat().st_size >= 450_000_000:
        raise ValueError('Archive exceeds size ceiling')
    result = {'schema': 'agi-fleet/local-package-receipt/v1', 'name': archive.name, 'bytes': archive.stat().st_size, 'sha256': sha(archive.read_bytes()), 'files': len(records), 'operatorInstaller': False, 'productionQualified': False}
    (output / 'package-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

def verify(archive):
    with zipfile.ZipFile(archive) as z:
        seen = set()
        total = 0
        for info in z.infolist():
            path = Path(info.filename)
            key = info.filename.casefold()
            if path.is_absolute() or '..' in path.parts or key in seen or '\\' in info.filename or info.file_size >= 450_000_000 or not stat.S_ISREG(info.external_attr >> 16):
                raise ValueError('Unsafe archive member')
            seen.add(key)
            total += info.file_size
        if len(seen) > 25_000 or total > 450_000_000 or z.testzip() is not None:
            raise ValueError('Archive bounds or CRC failure')
        manifest = json.loads(z.read(PREFIX + '/local-preview-manifest.json'))
        expected = {PREFIX + '/' + r['path'] for r in manifest['files']} | {PREFIX + '/local-preview-manifest.json'}
        if expected != set(z.namelist()) or manifest['operatorInstaller'] or manifest['productionQualified']:
            raise ValueError('Manifest coverage or qualification mismatch')
        for row in manifest['files']:
            info = z.getinfo(PREFIX + '/' + row['path'])
            data = z.read(info)
            if len(data) != row['bytes'] or sha(data) != row['sha256'] or stat.S_IMODE(info.external_attr >> 16) != row['mode']:
                raise ValueError('Member identity mismatch')
        print(json.dumps({'status': 'PASS', 'files': len(manifest['files']), 'archiveSHA256': sha(Path(archive).read_bytes()), 'qualification': 'source-preview-only'}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--output')
    group.add_argument('--verify')
    args = parser.parse_args()
    build(args.output) if args.output else verify(args.verify)
