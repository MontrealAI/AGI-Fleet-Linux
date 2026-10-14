#!/usr/bin/env python3
"""Build and independently verify the complete Apple silicon qualification ZIP.

Only the public, hash-pinned Linux archive supplies dependencies and historical
material. The reviewed Mac overlay is applied to a temporary extraction. Neither
the frozen fleet mirror nor the published archive is modified.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engineering'))
from release_tools import LIMIT, download, extract, members, require, sha

VERSION = '1.20.2'
PREFIX = 'AGI_Fleet_macOS_v' + VERSION
ROLES = {'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'}
BASE_SHA = 'bb21983d654291a860f2f78c2b69bbcd49423b5f41ffc9178864c41acc347695'
BASE_BYTES = 403770769
BASELINE = {
    'version': '1.0.10', 'tag': 'v1.0.10-qualification',
    'prefix': 'AGI_Fleet_Linux_v1.0.10', 'name': 'AGI_Fleet_Linux_v1.0.10.zip',
    'bytes': BASE_BYTES, 'sha256': BASE_SHA,
    'sourceRevisionSHA256': 'ba5d4b30cc7b02d60e7211a3201ad74129dce0056d64655a222c4fe08e699ba7',
    'sourceFiles': 4816,
    'url': 'https://github.com/MontrealAI/AGI-Fleet-Linux/releases/download/'
           'v1.0.10-qualification/AGI_Fleet_Linux_v1.0.10.zip',
}
DOCS = {'START_HERE.md', 'FRESH_INSTALL.md', 'TROUBLESHOOTING.md',
        'PHYSICAL_QUALIFICATION.md', 'PARITY.md', 'RELEASE_NOTES.md'}


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def specification(repository=ROOT):
    value = json.loads((repository / 'macos/release.json').read_text())
    require(value['version'] == VERSION and value['prefix'] == PREFIX
            and value['name'] == PREFIX + '.zip'
            and value['tag'] == 'v' + VERSION + '-macos-qualification', 'Mac release identity differs')
    require(value['maximumFileBytes'] == LIMIT and value['productionQualified'] is False
            and value['signedNotarized'] is False, 'Mac candidate cannot claim qualification or signing')
    require(type(value['sourceDateEpoch']) is int and 315532800 <= value['sourceDateEpoch'] < 4354819200,
            'Invalid deterministic ZIP timestamp')
    require(value['platform'] == 'darwin' and value['architecture'] == 'arm64'
            and value['minimumMacOS'] == '15' and value['nodeVersion'] == '24.21.0',
            'Mac platform or runtime pin differs')
    base = value['base']
    # This Mac track retains its original Linux input when newer Linux releases ship.
    require(base == BASELINE and type(base['bytes']) is int and type(base['sourceFiles']) is int,
            'Pinned public baseline differs')
    return value


def editions(root):
    registry = json.loads((root / 'config/role-registry.json').read_text())['roles']
    require(set(registry) == ROLES, 'All six roles are required')
    names = set()
    result = [('fleet', root)]
    for role, entry in registry.items():
        name = entry['package']
        require(re.fullmatch(r'AGI_[A-Za-z]+', name) and name not in names, 'Invalid role package path')
        names.add(name)
        result.append((role, root / 'packages' / name))
    return result


def baseline_tools(base, repository=ROOT):
    tool = module('macos_baseline_verifier', repository / 'engineering/release_tools.py')
    for key, attribute in [('version', 'VERSION'), ('prefix', 'PREFIX'), ('name', 'ASSET'),
                           ('bytes', 'SIZE'), ('sha256', 'SHA256'), ('sourceRevisionSHA256', 'SOURCE_REVISION')]:
        setattr(tool, attribute, base[key])
    return tool


def verify_baseline(archive, base, repository=ROOT):
    tool = baseline_tools(base, repository)
    result = tool.verify_archive(archive)
    inventory = json.loads(tool.zipfile_inventory(archive))
    require(inventory['revisionSHA256'] == base['sourceRevisionSHA256']
            and len(inventory['files']) == base['sourceFiles'], 'Base source identity differs')
    return result


def preserve_history(root, base):
    for role, app in editions(root):
        history = app / 'evidence/history/linux'
        history.mkdir(parents=True, exist_ok=True)
        for name in ('release-manifest.json', 'source-inventory.json'):
            destination = history / (Path(name).stem + '-v' + base['version'] + '.json')
            require(not destination.exists(), 'Historical record already exists: ' + str(destination))
            shutil.copyfile(app / name, destination)
        write_json(history / 'PUBLIC_BASELINE.json', {
            'schema': 'agi-historical-public-baseline/v1', 'classification': 'historical Linux evidence',
            'candidateQualification': False, 'base': base,
            'notice': 'Earlier Linux and Mac results are retained for traceability. They do not qualify this Mac ZIP.'})


def add_guides(root, repository, version):
    renderer = module('macos_guide_renderer', repository / 'engineering/build-next-release.py')
    sources = {file.name: file for file in (repository / 'macos/docs').glob('*.md')}
    require(DOCS <= set(sources), 'Mac operator guides are incomplete')
    for role, app in editions(root):
        destination = app / 'docs/macos-current'
        destination.mkdir(parents=True, exist_ok=True)
        for name, source in sorted(sources.items()):
            content = source.read_text()
            (destination / name).write_text(content)
            (destination / name).with_suffix('.html').write_text(renderer.render_markdown(content, '../../START_HERE.html'))
        welcome = f'''# AGI Fleet for Apple silicon Mac {version}

**{role.title()} edition — engineering and qualification candidate.**

For M1 and M2 Mac mini, MacBook and other Apple silicon Macs, using native ARM64 and macOS 15 or later. Keep the complete Fleet folder together.

1. [Start with the Mac welcome guide](docs/macos-current/START_HERE.md).
2. Follow the [fresh installation guide](docs/macos-current/FRESH_INSTALL.md) with separate signer and Standard compute accounts.
3. Check the exact archive's native acceptance and SHA-256 on the [release page](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v{version}-macos-qualification).
4. Record the [physical Mac checks](docs/macos-current/PHYSICAL_QUALIFICATION.md) before funded work.

Native acceptance must be published for this exact ZIP before controlled installation. Physical qualification, production qualification and Apple signing/notarization are pending. Earlier Linux and Mac evidence does not qualify this archive.

[Get help safely](docs/macos-current/TROUBLESHOOTING.md) · [What is included](docs/macos-current/PARITY.md) · [Release notes](docs/macos-current/RELEASE_NOTES.md)

Agent, Node, Moderator, Employer, Evidence and Recovery retain separate bounded authority. Use the Mac `.command` launchers named in the fresh installation guide. Do not follow the preserved Linux `.sh` installation guide on a Mac.

On failure, stop and preserve reports, accounts, profiles and COMPUTE_STOP. Never delete STOP manually, weaken ownership checks, or share wallet words, keys, OAuth tokens or private setup files.
'''
        for name in ('START_HERE.md', 'README.md'):
            (app / name).write_text(welcome)
            (app / name).with_suffix('.html').write_text(renderer.render_markdown(welcome))
        (app / 'READ_ME_FIRST.txt').write_text(
            f'AGI Fleet for Apple silicon Mac {version} — {role.title()} edition\n\n'
            'Open START_HERE.html in this complete release folder.\n'
            'Plain text: docs/macos-current/START_HERE.md\n'
            'Installation: docs/macos-current/FRESH_INSTALL.md\n'
            'Help: docs/macos-current/TROUBLESHOOTING.md\n'
            'Physical checks: docs/macos-current/PHYSICAL_QUALIFICATION.md\n\n'
            'Use fresh, separate signer and Standard compute accounts.\n'
            'Native acceptance is required before controlled installation.\n'
            'Physical and production qualification are pending.\n'
            'Do not enable funded work before the physical checks pass.\n'
            'On failure, preserve accounts, profiles, reports and COMPUTE_STOP.\n')
        for file in (app / 'docs').glob('*.md'):
            content = file.read_text()
            if not re.match(r'^# (Historical|Changelog)', content, re.I):
                content = re.sub(r'(Current application:\s*\*\*)[\d.]+(\*\*)',
                                 lambda match: match[1] + version + match[2], content)
                content = re.sub(r'AGI_Autonomous_Fleet_v\d+\.\d+\.\d+', PREFIX, content)
            file.write_text(content)
            file.with_suffix('.html').write_text(renderer.render_markdown(content, '../START_HERE.html'))
        for relative in ('NOTICE.md', 'contract/PROVENANCE.md'):
            file = app / relative
            if file.exists():
                back = os.path.relpath(app / 'START_HERE.html', file.parent)
                file.with_suffix('.html').write_text(renderer.render_markdown(file.read_text(), back))
        # The previous Linux guide remains usable, explicitly as historical reference.
        for relative in ('Linux-Guide.txt', 'Linux-Guide.html'):
            file = app / relative
            if file.exists():
                file.rename(app / ('Historical-' + relative))
                notice = '# Historical Linux guide\n\nThis Linux guide is retained for engineering traceability. For this Apple silicon Mac release, [start here](START_HERE.md).\n\n[Open the historical Linux guide](Historical-' + relative + ')\n'
                file.write_text(renderer.render_markdown(notice) if file.suffix == '.html' else notice)


def check_mac_guides(root):
    class Links(HTMLParser):
        def __init__(self):
            super().__init__(); self.links = []; self.ids = set()
        def handle_starttag(self, tag, attributes):
            data = dict(attributes)
            if 'id' in data: self.ids.add(data['id'])
            if tag == 'a' and 'href' in data: self.links.append(data['href'])
    checked = 0
    for _, app in editions(root):
        for page in [app / 'START_HERE.html', app / 'README.html', *sorted((app / 'docs/macos-current').glob('*.html'))]:
            content = page.read_text()
            source = page.with_suffix('.md')
            require('<meta name="source-sha256" content="' + sha(source) + '">' in content,
                    'Stale current Mac guide: ' + str(page))
            parser = Links(); parser.feed(content)
            for link in parser.links:
                target = urlsplit(link)
                if target.scheme or target.netloc: continue
                file = (page.parent / unquote(target.path)).resolve() if target.path else page.resolve()
                require(file.is_relative_to(app.resolve()) and file.is_file(),
                        'Missing or unsafe Mac guide link: ' + str(page) + ' -> ' + link)
                if target.fragment and file.suffix == '.html':
                    other = Links(); other.feed(file.read_text())
                    require(unquote(target.fragment) in other.ids, 'Missing Mac guide anchor: ' + link)
                checked += 1
    return checked


def current_manifests(root, spec):
    versions = {role: spec['version'] for role, _ in editions(root)}
    validation = {
        'release': versions, 'status': 'PENDING_SAVED_ARCHIVE_NATIVE_MAC_VALIDATION',
        'productionQualified': False, 'checks': {},
        'external': {name: 'NOT_RUN' for name in ('nativeMacOS15Arm64', 'nativeMacOS26Arm64',
                     'physicalM1', 'physicalM2', 'dockerDesktop', 'oauthInference', 'liveDocuments',
                     'baseAndBrowserCleanup', 'rebootIdentity', 'endurance72Hours')},
        'evidenceDirectory': 'external-hash-bound-macos-addendum'}
    for role, app in editions(root):
        write_json(app / 'release-manifest.json', {
            'schema': 'agi-coordinated-release/v2', 'release': versions, 'edition': role,
            'date': datetime.fromtimestamp(spec['sourceDateEpoch'], timezone.utc).date().isoformat(),
            'classification': 'engineering and qualification candidate',
            'platformEdition': 'macOS Apple silicon', 'architecture': 'arm64',
            'productionQualified': False, 'signedNotarized': False, 'localValidation': validation,
            'physicalQualification': validation['external'], 'evidence': validation['evidenceDirectory'],
            'compatibility': {'nodeRange': '>=24.19.0 <25', 'testedNode': spec['nodeVersion'],
                              'openclaw': '2026.9.5', 'operatingSystem': 'macOS 15 or later',
                              'architecture': 'arm64'},
            'productionArchitecture': {'default': 'fresh-install', 'productionQualified': False},
            'perFileIntegrity': 'MANIFEST.sha256', 'sourceInventory': 'source-inventory.json',
            'releasePublication': 'Immutable Mac qualification candidate; earlier artifacts remain historical'})
    return validation


def write_archive(root, target, epoch, rules):
    require(not target.exists() and not target.is_symlink(), 'Archive output already exists')
    require(not target.absolute().is_relative_to(root.absolute()), 'Archive must be outside the staged tree')
    require(not any(path.is_symlink() for path in root.rglob('*')), 'Release inputs must be materialized')
    all_files = rules.tree_files(root)
    for name, file in all_files.items():
        require(file.stat().st_size < LIMIT and not file.is_symlink(), 'Unsafe staged file: ' + name)
    # Child manifests must be final before the enclosing Fleet manifest is made.
    for _, app in list(editions(root))[1:] + [('fleet', root)]:
        files = rules.tree_files(app)
        (app / 'MANIFEST.sha256').write_text(''.join(
            sha(file) + '  ' + name + '\n' for name, file in files.items() if name != 'MANIFEST.sha256'))
    stamp = datetime.fromtimestamp(epoch, timezone.utc).timetuple()[:6]
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as saved:
        for name, file in rules.tree_files(root).items():
            entry = zipfile.ZipInfo(PREFIX + '/' + name, stamp)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | (0o755 if file.stat().st_mode & 0o111 else 0o644)) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            with file.open('rb') as source, saved.open(entry, 'w') as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
    require(0 < target.stat().st_size < LIMIT, 'Mac ZIP exceeds the 450 MB bound')


def verify(archive, metadata, extract_to=None, repository=ROOT):
    """Read the saved bytes independently, including all seven manifests and modes."""
    archive = Path(archive)
    require(archive.is_file() and not archive.is_symlink(), 'Candidate archive must be a regular file')
    require(metadata['version'] == VERSION and metadata['prefix'] == PREFIX
            and metadata['name'] == PREFIX + '.zip', 'Candidate identity differs')
    require(metadata['productionQualified'] is False, 'Unqualified candidate cannot claim production')
    require(type(metadata['bytes']) is int and 0 < metadata['bytes'] < LIMIT
            and archive.stat().st_size == metadata['bytes'] and sha(archive) == metadata['sha256'],
            'Saved archive identity differs')
    rules = module('macos_verification_rules', repository / 'fleet/scripts/prepare-release.py')
    hashes, modes = {}, {}
    with zipfile.ZipFile(archive) as saved:
        entries = members(saved)
        require(all(entry.filename.startswith(PREFIX + '/') for entry in entries), 'Unexpected archive root')
        for entry in entries:
            with saved.open(entry) as stream:
                hashes[entry.filename] = hashlib.file_digest(stream, 'sha256').hexdigest()
            mode = entry.external_attr >> 16
            require(stat.S_IMODE(mode) in (0o644, 0o755), 'Noncanonical executable mode')
            modes[entry.filename] = bool(mode & 0o111)
            if entry.filename.endswith('.command') or '/Contents/MacOS/' in entry.filename:
                require(modes[entry.filename], 'Mac launcher is not executable: ' + entry.filename)
        prefix = PREFIX + '/'
        registry = json.loads(saved.read(prefix + 'config/role-registry.json'))['roles']
        require(set(registry) == ROLES, 'All six roles are required')
        scopes = [('fleet', '')]
        names = set()
        for role, config in registry.items():
            name = config['package']
            require(re.fullmatch(r'AGI_[A-Za-z]+', name) and name not in names, 'Unsafe role package')
            names.add(name)
            scopes.append((role, 'packages/' + name + '/'))
        verified = {}
        for role, relative in scopes:
            folder = prefix + relative
            manifest = {}
            for line in saved.read(folder + 'MANIFEST.sha256').decode().splitlines():
                require(re.fullmatch(r'[a-f0-9]{64}  .+', line), 'Invalid manifest record')
                digest, name = line.split('  ', 1)
                require(name not in manifest, 'Duplicate manifest record')
                manifest[name] = digest
            actual = {name[len(folder):]: digest for name, digest in hashes.items()
                      if name.startswith(folder) and name != folder + 'MANIFEST.sha256'}
            require(manifest == actual, 'Manifest coverage or bytes differ: ' + role)
            inventory = json.loads(saved.read(folder + 'source-inventory.json'))
            records = inventory['files']
            revision = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            require(revision == inventory['revisionSHA256'], 'Source inventory digest differs')
            paths = [record['path'] for record in records]
            require(len(set(paths)) == len(paths) and len({name.casefold() for name in paths}) == len(paths),
                    'Source inventory duplicate or case collision')
            require(set(paths) == {name for name in actual if rules.source_path(name)},
                    'Source inventory coverage differs: ' + role)
            for record in records:
                member = folder + record['path']
                require(hashes.get(member) == record['sha256'] and type(record['executable']) is bool
                        and modes.get(member) == record['executable'], 'Source bytes or mode differ')
            release = json.loads(saved.read(folder + 'release-manifest.json'))
            config = json.loads(saved.read(folder + 'config/companion-releases.json'))
            package = json.loads(saved.read(folder + 'package.json'))
            lock = json.loads(saved.read(folder + 'package-lock.json'))
            require(config['role'] == role and package['version'] == lock['version']
                    == lock['packages']['']['version'] == VERSION, 'Edition or package version differs')
            require(all(release['release'][key] == config[key] == VERSION for key in ROLES | {'fleet'}),
                    'Coordinated release versions differ')
            require(release['productionQualified'] is False and release['signedNotarized'] is False
                    and release['platformEdition'] == 'macOS Apple silicon'
                    and release['sourceRevisionSHA256'] == revision, 'Mac release metadata differs')
            for name in actual:
                if name.endswith('.app/Contents/Info.plist') and '/' not in name.split('.app/')[0]:
                    plist = plistlib.loads(saved.read(folder + name))
                    require(plist['CFBundleVersion'] == plist['CFBundleShortVersionString'] == VERSION,
                            'Mac application version differs')
            for required in ('START_HERE.html', 'START_HERE.md', 'README.html', 'README.md', 'READ_ME_FIRST.txt'):
                require(required in actual, 'Current Mac entry point missing')
            verified[role] = {'sourceFiles': len(records), 'sourceRevisionSHA256': revision,
                              'manifestFiles': len(manifest)}
        require(verified['fleet']['sourceRevisionSHA256'] == metadata['sourceRevisionSHA256']
                and verified['fleet']['sourceFiles'] == metadata['sourceFiles'], 'Build source binding differs')
    if extract_to is not None:
        extract(archive, extract_to)
        for name, digest in hashes.items():
            file = Path(extract_to) / name
            require(file.is_file() and not file.is_symlink() and sha(file) == digest
                    and bool(file.stat().st_mode & 0o111) == modes[name], 'Fresh extraction differs: ' + name)
    return {'schema': 'agi-macos-archive-verification/v1', 'status': 'PASS_ARCHIVE_INTEGRITY',
            'sha256': metadata['sha256'], 'bytes': metadata['bytes'], 'files': len(hashes),
            'crcVerified': True, 'allManifestsVerified': True, 'sourceInventoryVerified': True,
            'executableModesVerified': True, 'freshExtraction': extract_to is not None,
            'editions': verified, 'nativeAcceptance': 'NOT_RUN', 'physicalQualification': 'NOT_RUN',
            'productionQualified': False}


def build(args):
    repository = args.repository.resolve(strict=True)
    spec = specification(repository)
    renderer = module('macos_reviewed_source', repository / 'engineering/build-next-release.py')
    commit = args.commit or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repository, text=True).strip()
    require(re.fullmatch(r'[a-f0-9]{40}', commit), 'A full reviewed commit is required')
    node = Path(shutil.which(args.node) or args.node).resolve(strict=True)
    node_environment = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'NODE_PATH')}
    require(subprocess.check_output([str(node), '--version'], text=True, env=node_environment).strip() == 'v' + spec['nodeVersion'],
            'Use pinned Node ' + spec['nodeVersion'])
    out = args.output.absolute()
    work = args.work.absolute() if args.work else Path(tempfile.mkdtemp(prefix='agi-macos-build-')) / 'work'
    for path in (out, work):
        require(not path.exists() and not path.is_symlink(), 'Use absent build and output directories')
        require(path.parent.resolve(strict=True) == path.parent, 'Build parent must be canonical')
        require(not path.is_relative_to(repository), 'Build and output directories must be outside the repository')
    require(not work.is_relative_to(repository), 'Temporary stage must be outside the repository')
    require(not out.is_relative_to(work) and not work.is_relative_to(out), 'Separate build and output directories')
    out.mkdir(); work.mkdir()
    archive = args.archive.resolve(strict=True) if args.archive else work / spec['base']['name']
    if not args.archive:
        download(spec['base']['url'], archive, spec['base']['sha256'], spec['base']['bytes'])
    baseline = verify_baseline(archive, spec['base'], repository)
    extract(archive, work / 'source')
    root = work / 'source' / spec['base']['prefix']
    require(json.loads((root / 'source-inventory.json').read_text())['revisionSHA256']
            == spec['base']['sourceRevisionSHA256'], 'Base source revision differs')
    preserve_history(root, spec['base'])
    preparation = module('macos_preparation', root / 'scripts/prepare-release.py')
    preparation.bump(root, {role: VERSION for role, _ in editions(root)},
                     datetime.fromtimestamp(spec['sourceDateEpoch'], timezone.utc).date().isoformat())
    env = {**os.environ, 'PATH': str(node.parent) + os.pathsep + os.environ.get('PATH', ''),
           'SOURCE_DATE_EPOCH': str(spec['sourceDateEpoch'])}
    env.pop('NODE_OPTIONS', None); env.pop('NODE_PATH', None)
    def run(label, command):
        with (out / (label + '.log')).open('w') as log:
            result = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        require(result.returncode == 0, label + ' failed; inspect ' + str(out / (label + '.log')))
    run('mac-runtime-overlay', [sys.executable, str(repository / 'macos/runtime/apply.py'), '--root', str(root), '--version', VERSION])
    for tool in ('sync-shared-runtime.py', 'sync-shared-operator.py', 'sync-release-tools.py'):
        run(tool[:-3], [sys.executable, str(root / 'scripts' / tool), '--root', str(root), '--check'])
    add_guides(root, repository, VERSION)
    check_mac_guides(root)
    validation = current_manifests(root, spec)
    inputs = [{'path': path.relative_to(repository).as_posix(), 'sha256': sha(path)}
              for path in sorted((repository / 'macos').rglob('*'))
              if path.is_file() and not path.is_symlink() and '__pycache__' not in path.parts]
    write_json(root / ('evidence/current-v' + VERSION) / 'build-inputs.json', {
        'schema': 'agi-macos-build-inputs/v1', 'repositoryCommit': commit, 'base': spec['base'],
        'inputs': inputs, 'productionQualified': False,
        'history': 'All earlier Linux and Mac evidence is historical, not current Mac qualification.'})
    for role, app in editions(root):
        run(role + '-commands', [str(node), str(app / 'scripts/current-guides.mjs'), '--write'])
        commands = app / 'docs/COMMANDS.md'
        commands.with_suffix('.html').write_text(renderer.render_markdown(commands.read_text(), '../START_HERE.html'))
        run(role + '-guides', [str(node), str(app / 'scripts/check-guides.mjs')])
    pending = work / 'pending-validation.json'; write_json(pending, validation)
    preparation.metadata(root, archive, spec['sourceDateEpoch'], pending)
    inventory = json.loads((root / 'source-inventory.json').read_text())
    target = out / spec['name']
    write_archive(root, target, spec['sourceDateEpoch'], preparation)
    receipt = {**spec, 'schema': 'agi-macos-candidate-build/v1', 'bytes': target.stat().st_size,
               'sha256': sha(target), 'sourceRevisionSHA256': inventory['revisionSHA256'],
               'sourceFiles': len(inventory['files']), 'repositoryCommit': commit, 'workflowCommit': commit,
               'baseline': baseline, 'buildInputs': inputs}
    verification = verify(target, receipt, work / 'verified-extraction', repository)
    receipt['archiveVerification'] = verification
    write_json(out / 'archive-verification.json', verification)
    write_json(out / 'release.json', receipt)
    (out / ('SHA256SUMS-macOS-v' + VERSION + '.txt')).write_text(receipt['sha256'] + '  ' + target.name + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('build')
    create.add_argument('--repository', type=Path, default=ROOT)
    create.add_argument('--archive', type=Path, help='Optional local copy of the exact pinned public base')
    create.add_argument('--output', type=Path, required=True)
    create.add_argument('--work', type=Path)
    create.add_argument('--node', default='node')
    create.add_argument('--commit', default=os.environ.get('GITHUB_SHA'))
    check = commands.add_parser('verify')
    check.add_argument('--archive', type=Path, required=True)
    check.add_argument('--metadata', type=Path, required=True)
    check.add_argument('--extract-to', type=Path)
    args = parser.parse_args()
    result = build(args) if args.command == 'build' else verify(
        args.archive, json.loads(args.metadata.read_text()), args.extract_to)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
