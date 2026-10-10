#!/usr/bin/env python3
"""Coordinate local release metadata and deterministic archives; no publication or installs.

Use bump once, then metadata after source/docs/evidence freeze, then build.
Tests and documentation rendering are explicit preceding steps, not invented here.
"""
import argparse
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import subprocess
import sys
import zipfile

ROLES = ('fleet', 'agent', 'node')
APP_PATHS = {'fleet': '', 'agent': 'packages/AGI_Agent', 'node': 'packages/AGI_Node'}
PREFIXES = {'fleet': 'AGI_Autonomous_Fleet_v', 'agent': 'AGI_Agent_Private_v', 'node': 'AGI_Node_Private_v'}
GENERATED = {'MANIFEST.sha256', 'source-inventory.json', 'changed-files.json', 'source-changes.patch', 'release-manifest.json', 'SBOM.cdx.json'}
CACHES = {'__pycache__', '.pytest_cache', '.rsync-tmp', '.git'}

def need(condition, message):
    if not condition:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def file_sha(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def load(file):
    return json.loads(Path(file).read_text())

def write(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def record_validation(root, validation):
    """Keep historical evidence bytes, then record only the coordinated current run."""
    current = versions(root)
    need(validation.get('release') == current, 'Validation release must match all coordinated versions')
    labels = {'fleet': 'Fleet', 'agent': 'AGI_Agent', 'node': 'AGI_Node'}
    for role, app in apps(root):
        target = app / 'evidence/release-validation.json'
        if target.exists():
            old = load(target)
            if old.get('release') != current[role]:
                previous = str(old.get('release', 'unknown'))
                need(re.fullmatch(r'\d+\.\d+\.\d+|unknown', previous), 'Invalid historical validation version')
                saved = app / 'evidence/history' / ('release-validation-v' + previous + '.json')
                saved.parent.mkdir(parents=True, exist_ok=True)
                if saved.exists():
                    need(saved.read_bytes() == target.read_bytes(), 'Historical validation already differs')
                else:
                    saved.write_bytes(target.read_bytes())
        suite = validation.get('suites', {}).get(labels[role])
        value = {'schema': 'agi-genesis-release-validation/v2', 'release': current[role], 'role': role,
                 'coordinatedRelease': current, 'status': validation.get('status', 'PENDING'),
                 'unitTests': suite if suite else {'status': 'PENDING'},
                 'checks': validation.get('checks', {}), 'external': validation.get('external', {}),
                 'evidenceDirectory': validation.get('evidenceDirectory', 'evidence/current-v' + current['fleet']),
                 'productionQualified': False, 'signedNotarized': False}
        write(target, value)
        write(app / 'evidence' / ('current-v' + current['fleet']) / 'validation-summary.json', validation)

def apps(root):
    return [(role, root / APP_PATHS[role]) for role in ROLES]

def versions(root):
    found = {role: load(app / 'package.json')['version'] for role, app in apps(root)}
    for role, app in apps(root):
        config = load(app / 'config/companion-releases.json')
        need(all(config[key] == found[key] for key in ROLES), 'Coordinated version mismatch: ' + role)
        need(config['role'] == role, 'Edition mismatch: ' + role)
        lock = load(app / 'package-lock.json')
        need(lock['version'] == found[role] == lock['packages']['']['version'], 'Lockfile root version mismatch: ' + role)
    return found

def ordinary(relative):
    p = PurePosixPath(relative)
    return not any(part in CACHES for part in p.parts) and p.suffix != '.pyc'

def source_path(relative):
    p = PurePosixPath(relative)
    return ordinary(relative) and not any(part in {'node_modules', 'docs', 'evidence'} or part.startswith(('previous-', 'current-')) for part in p.parts) and p.name not in GENERATED and not (len(p.parts) == 1 and p.suffix in {'.md', '.html', '.txt', '.pdf', '.patch'})

def change_path(relative):
    p = PurePosixPath(relative)
    return ordinary(relative) and not any(part in {'node_modules', 'evidence'} or part.startswith(('previous-', 'current-')) for part in p.parts) and p.name not in GENERATED

def tree_files(root, predicate=lambda _: True):
    result = {}
    for file in sorted(root.rglob('*')):
        if not file.is_file():
            continue
        relative = file.relative_to(root).as_posix()
        if ordinary(relative) and predicate(relative):
            need(not file.is_symlink(), 'Release inputs must be materialized: ' + relative)
            result[relative] = file
    return result

def verify_archive(archive, extract_to=None):
    """Check exact manifest coverage, safe names/modes, source identity and fresh extraction."""
    archive = Path(archive)
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        names = [item.filename for item in entries]
        need(len(names) == len(set(names)) == len({n.casefold() for n in names}), 'Duplicate or case-colliding archive paths')
        roots = set()
        hashes = {}
        for item in entries:
            name = item.filename
            need(not name.startswith('/') and '\\' not in name and '\x00' not in name and not any(p in ('', '.', '..') for p in name.split('/')), 'Unsafe archive path: ' + name)
            need(not item.is_dir(), 'Unexpected explicit directory member')
            mode = item.external_attr >> 16
            need(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'Archive links or special files are forbidden')
            roots.add(name.split('/')[0])
            with z.open(item) as stream:
                h = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
            hashes[name] = h.hexdigest()  # ZipFile also verifies each CRC while reading.
        need(len(roots) == 1, 'Archive must contain one root')
        prefix = roots.pop() + '/'
        manifest_names = [prefix + 'MANIFEST.sha256']
        if prefix + 'packages/AGI_Agent/package.json' in hashes:
            manifest_names += [prefix + 'packages/' + name + '/MANIFEST.sha256' for name in ('AGI_Agent', 'AGI_Node')]
        for manifest in manifest_names:
            need(manifest in hashes, 'Missing archive manifest: ' + manifest)
            folder = manifest[:-len('MANIFEST.sha256')]
            expected_names = set()
            for line in z.read(manifest).decode('utf-8').splitlines():
                need(re.fullmatch(r'[a-f0-9]{64}  .+', line), 'Invalid archive manifest line')
                expected, name = line.split('  ', 1)
                need(name not in expected_names, 'Duplicate manifest entry')
                expected_names.add(name)
                need(hashes.get(folder + name) == expected, 'Archive manifest mismatch: ' + folder + name)
            actual = {n[len(folder):] for n in hashes if n.startswith(folder) and n != manifest}
            need(actual == expected_names, 'Archive manifest coverage mismatch: ' + folder)
            inv = json.loads(z.read(folder + 'source-inventory.json'))
            need(sha(json.dumps(inv['files'], sort_keys=True, separators=(',', ':')).encode()) == inv['revisionSHA256'], 'Source revision mismatch')
            for record in inv['files']:
                member = folder + record['path']
                need(hashes.get(member) == record['sha256'], 'Source inventory mismatch: ' + member)
                need(bool(z.getinfo(member).external_attr >> 16 & 0o111) == record['executable'], 'Source mode mismatch: ' + member)
            release = json.loads(z.read(folder + 'release-manifest.json'))
            config = json.loads(z.read(folder + 'config/companion-releases.json'))
            package = json.loads(z.read(folder + 'package.json'))
            need(all(release['release'][r] == config[r] for r in ROLES) and package['version'] == config[config['role']], 'Archive release metadata mismatch')
            need(release['sourceRevisionSHA256'] == inv['revisionSHA256'], 'Release source identity mismatch')
        extracted = None
        if extract_to is not None:
            parent = Path(extract_to).resolve()
            need(not parent.exists(), 'Fresh extraction destination already exists')
            parent.mkdir(parents=True, mode=0o700)
            for item in entries:
                target = parent / item.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(item) as src, target.open('xb') as dst:
                    for block in iter(lambda: src.read(1024 * 1024), b''):
                        dst.write(block)
                target.chmod(0o755 if item.external_attr >> 16 & 0o111 else 0o644)
                need(file_sha(target) == hashes[item.filename], 'Fresh extraction hash mismatch')
            extracted = str(parent / prefix[:-1])
        return {'file': str(archive), 'bytes': archive.stat().st_size, 'sha256': file_sha(archive), 'files': len(entries), 'crcVerified': True, 'allManifestsVerified': True, 'sourceInventoryVerified': True, 'freshExtraction': extracted}

def bump(root, target, date):
    before = versions(root)
    for key in ROLES:
        need(re.fullmatch(r'\d+\.\d+\.\d+', target[key]), 'Invalid version')
        need(tuple(map(int, target[key].split('.'))) >= tuple(map(int, before[key].split('.'))), 'Version downgrade forbidden')
    if before == target:
        return {'changed': False, 'versions': target}
    edits = []
    for role, app in apps(root):
        for name in ('package.json', 'package-lock.json'):
            file = app / name
            value = load(file)
            value['version'] = target[role]
            if name == 'package-lock.json':
                value['packages']['']['version'] = target[role]  # Never rewrite dependency versions.
            edits.append((file, value))
        file = app / 'config/companion-releases.json'
        value = load(file)
        value.update(target)
        edits.append((file, value))
        file = app / 'release-manifest.json'
        value = load(file)
        value['release'] = target
        value['date'] = date
        value['localValidation'] = {'status': 'PENDING', 'reason': 'New release requires fresh final validation; prior evidence is historical.'}
        value.pop('sourceRevisionSHA256', None)
        value['evidence'] = 'evidence/current-v' + target['fleet']
        value['classification'] = 'engineering and qualification candidate'
        value['productionQualified'] = False
        edits.append((file, value))
    for file, value in edits:
        write(file, value)
    for role, app in apps(root):
        for file in app.glob('*.app/Contents/Info.plist'):
            value = plistlib.loads(file.read_bytes())
            value['CFBundleShortVersionString'] = value['CFBundleVersion'] = target[role]
            file.write_bytes(plistlib.dumps(value, sort_keys=False))
        for relative in ('README.md', 'READ_ME_FIRST.txt', 'START_HERE.md', 'app/index.html', 'web/index.html'):
            file = app / relative
            if file.is_file():
                text = file.read_text()
                for key in ROLES:
                    text = re.sub(r'(?<![\d.])' + re.escape(before[key]) + r'(?!\d|\.\d)', target[key], text)
                file.write_text(text)
    need(versions(root) == target, 'Version bump verification failed')
    return {'changed': True, 'before': before, 'versions': target, 'date': date, 'workingDirectoryRenamed': False, 'dependencyVersionsChanged': False, 'priorValidationReused': False}

def metadata(root, baseline, epoch, validation=None):
    current = versions(root)
    final_validation = load(validation) if validation else None
    if final_validation:
        record_validation(root, final_validation)
    base_report = verify_archive(baseline)
    stamp = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    sbom = subprocess.run([sys.executable, str(root / 'scripts/build-sbom.py'), '--root', str(root), '--epoch', str(epoch)], text=True, capture_output=True, check=True)
    result = {'schema': 'agi-release-preparation/v1', 'release': current, 'timestamp': stamp, 'baseline': base_report, 'SBOM': json.loads(sbom.stdout), 'editions': {}}
    with zipfile.ZipFile(baseline) as z:
        prefix = z.namelist()[0].split('/')[0] + '/'
        base_versions = json.loads(z.read(prefix + 'release-manifest.json'))['release']
        for role, app in apps(root):
            scope = (APP_PATHS[role] + '/') if APP_PATHS[role] else ''
            files = [{'path': name, 'sha256': file_sha(file), 'executable': bool(file.stat().st_mode & 0o111)} for name, file in tree_files(app, source_path).items()]
            revision = sha(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())
            write(app / 'source-inventory.json', {'schema': 'agi-source-inventory/v1', 'revisionSHA256': revision, 'definition': 'SHA256 of compact sorted-key JSON files array. Excludes docs/evidence/dependencies/historical folders/generated release metadata/root prose; complete file bytes are in MANIFEST.sha256.', 'files': files})
            old = {item.filename[len(prefix + scope):]: item for item in z.infolist() if item.filename.startswith(prefix + scope) and change_path(item.filename[len(prefix + scope):])}
            new = tree_files(app, change_path)
            changes, patch = [], []
            for name in sorted(set(old) | set(new)):
                a = z.read(old[name]) if name in old else b''
                b = new[name].read_bytes() if name in new else b''
                old_mode = bool(old[name].external_attr >> 16 & 0o111) if name in old else None
                new_mode = bool(new[name].stat().st_mode & 0o111) if name in new else None
                if name in old and name in new and a == b and old_mode == new_mode:
                    continue
                changes.append({'path': name, 'change': 'added' if name not in old else 'removed' if name not in new else 'modified', 'beforeSHA256': sha(a) if name in old else None, 'afterSHA256': sha(b) if name in new else None, 'beforeExecutable': old_mode, 'afterExecutable': new_mode})
                try:
                    ta, tb = a.decode('utf-8'), b.decode('utf-8')
                    if '\x00' in ta + tb:
                        raise UnicodeError()
                    for line in difflib.unified_diff(ta.splitlines(True), tb.splitlines(True), fromfile='baseline/' + scope + name, tofile='release/' + scope + name):
                        patch.append(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n')
                    if old_mode != new_mode:
                        patch.append(f'# Executable mode: {scope + name}: {old_mode} -> {new_mode}\n')
                except UnicodeError:
                    patch.append('# Binary change: ' + scope + name + '; SHA-256 identities in changed-files.json\n')
            write(app / 'changed-files.json', {'schema': 'agi-release-changes/v1', 'baselineFleet': base_versions['fleet'], 'baselineZIPSHA256': base_report['sha256'], 'release': current, 'role': role, 'scope': 'Non-dependency current source/docs changes; excludes evidence, historical folders, caches and generated release metadata. Binary changes are hash-indexed.', 'changes': changes})
            (app / 'source-changes.patch').write_text(''.join(patch))
            manifest = load(app / 'release-manifest.json')
            manifest.update({'release': current, 'edition': role, 'date': stamp[:10], 'sourceRevisionSHA256': revision, 'baseline': {**base_versions, 'zipSHA256': base_report['sha256'], 'bytes': base_report['bytes']}, 'sourceInventory': 'source-inventory.json', 'reviewableChanges': ['changed-files.json', 'source-changes.patch'], 'SBOM': 'docs/SBOM.cdx.json', 'productionQualified': False, 'signedNotarized': False})
            if final_validation:
                manifest['localValidation'] = final_validation
            write(app / 'release-manifest.json', manifest)
            result['editions'][role] = {'sourceRevisionSHA256': revision, 'sourceFiles': len(files), 'changedFiles': len(changes)}
    return result

def build(root, out, epoch):
    need(not out.exists(), 'Use a fresh output directory')
    need(not out.is_relative_to(root), 'Archives must be outside the source tree')
    current = versions(root)
    out.mkdir(parents=True)
    reports = {}
    for role in ('agent', 'node', 'fleet'):
        app = root / APP_PATHS[role]
        target = out / (PREFIXES[role] + current[role] + '.zip')
        env = {**os.environ, 'SOURCE_DATE_EPOCH': str(epoch)}
        process = subprocess.run([sys.executable, str(app / 'scripts/package-release.py'), '--root', str(app), '--out', str(target)], text=True, capture_output=True, env=env)
        (out / (role + '-packaging.log')).write_text(process.stdout + process.stderr)
        need(process.returncode == 0, 'Packaging failed; inspect ' + role + '-packaging.log')
        reports[role] = verify_archive(target, out / ('extracted-' + role))
    with zipfile.ZipFile(reports['fleet']['file']) as fleet:
        prefix = PREFIXES['fleet'] + current['fleet'] + '/'
        for role in ('agent', 'node'):
            with zipfile.ZipFile(reports[role]['file']) as companion:
                standalone_prefix = PREFIXES[role] + current[role] + '/'
                a = {n[len(standalone_prefix):]: sha(companion.read(n)) for n in companion.namelist()}
                embedded_prefix = prefix + APP_PATHS[role] + '/'
                b = {n[len(embedded_prefix):]: sha(fleet.read(n)) for n in fleet.namelist() if n.startswith(embedded_prefix)}
                need(a == b, 'Standalone and embedded companion bytes differ: ' + role)
    result = {'schema': 'agi-release-archive-verification/v1', 'release': current, 'archives': reports, 'standaloneMatchesEmbedded': True, 'signed': False, 'published': False, 'testsAfterExtraction': 'PENDING; run final tests against the fresh extraction paths before delivery.'}
    write(out / 'Release-Verification.json', result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('bump')
    for role in ROLES:
        p.add_argument('--' + role, required=True)
    p.add_argument('--date', required=True)
    p = sub.add_parser('metadata')
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--epoch', type=int, required=True)
    p.add_argument('--validation', type=Path)
    p = sub.add_parser('build')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--epoch', type=int, required=True)
    p = sub.add_parser('verify')
    p.add_argument('--archive', type=Path, required=True)
    p.add_argument('--extract-to', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.action == 'bump':
        datetime.date.fromisoformat(args.date)
        result = bump(root, {r: getattr(args, r) for r in ROLES}, args.date)
    elif args.action == 'metadata':
        result = metadata(root, args.baseline.resolve(), args.epoch, args.validation)
    elif args.action == 'build':
        result = build(root, args.out.resolve(), args.epoch)
    else:
        result = verify_archive(args.archive.resolve(), args.extract_to)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
