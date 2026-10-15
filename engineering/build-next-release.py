#!/usr/bin/env python3
"""Build a pending Linux candidate from the verified baseline and reviewed source.

No installation, provider call, signing, or publication occurs. The saved ZIP must
still pass its own native acceptance before the operator gate can be opened.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import html
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

from release_tools import ASSET, LIMIT, PREFIX, ROOT, SHA256, SIZE, URL, download, extract, require, sha, verify_archive

ROLES = {'agent', 'node', 'moderator', 'employer', 'evidence', 'recovery'}


def verify_maintenance_archive(archive):
    """Local Skills may coexist in the repository, never in the 1.1.1 installer."""
    excluded = {'local-runtime', 'local-dashboard', 'role-skills'}
    with zipfile.ZipFile(archive) as saved:
        require(not any(excluded.intersection(PurePosixPath(row.filename).parts)
                        for row in saved.infolist()),
                'Unqualified Local Skills code is excluded from the maintenance installer')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def inventory(root, expected_revision=None, expected_files=None):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'Source mirror must be an ordinary directory')
    data = json.loads((root / 'source-inventory.json').read_text())
    records = data['files']
    revision = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    require(revision == data['revisionSHA256'], 'Source inventory digest differs')
    if expected_revision is not None:
        require(revision == expected_revision, 'Candidate source revision differs')
    if expected_files is not None:
        require(len(records) == expected_files, 'Candidate source count differs')
    names = set()
    for record in records:
        name = record['path']
        require(name and not name.startswith('/') and '\\' not in name and '\x00' not in name
                and all(part not in ('', '.', '..') for part in name.split('/')), 'Unsafe candidate source path')
        require(name.casefold() not in names, 'Duplicate candidate source path')
        names.add(name.casefold())
        path = root / name
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()),
                'Unsafe or missing source file: ' + name)
        require(path.stat().st_size < LIMIT and sha(path) == record['sha256']
                and bool(path.stat().st_mode & 0o111) == record['executable'], 'Candidate source differs: ' + name)
    actual = {path.relative_to(root).as_posix() for path in root.rglob('*')
              if (path.is_file() or path.is_symlink()) and '__pycache__' not in path.relative_to(root).parts}
    require(actual == {record['path'] for record in records} | {'source-inventory.json'}, 'Candidate mirror coverage differs')
    return data


def overlay_source(root, source, records):
    prior = json.loads((root / 'source-inventory.json').read_text())['files']
    wanted = {record['path'] for record in records}
    for record in prior:
        if record['path'] not in wanted:
            (root / record['path']).unlink()
    for record in records:
        destination = root / record['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / record['path'], destination)
        destination.chmod(0o755 if record['executable'] else 0o644)


def inline(text):
    escaped = html.escape(text, quote=False)
    tokens = []
    def token(value):
        tokens.append(value)
        return '\x01' + str(len(tokens) - 1) + '\x02'
    escaped = re.sub(r'`([^`]+)`', lambda match: token('<code>' + match[1] + '</code>'), escaped)
    def link(match):
        label, target = match.groups()
        target = html.unescape(target)
        if re.match(r'(?i)^(?:javascript|data|vbscript):', target):
            return label
        if not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
            target = re.sub(r'\.md(?=#|$)', '.html', target)
        return token('<a href="' + html.escape(target, quote=True) + '">' + label + '</a>')
    escaped = re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)', link, escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    while '\x01' in escaped:
        escaped = re.sub(r'\x01(\d+)\x02', lambda match: tokens[int(match[1])], escaped)
    return escaped


def render_markdown(text, back='START_HERE.html', *, language='en'):
    """Render the bounded repository guide format without network dependencies."""
    require(language in ('en', 'fr'), 'Unsupported guide language')
    navigation = 'Commencer ici' if language == 'fr' else 'Start here'
    lines, result, paragraph = text.splitlines(), [], []
    listing = None
    seen_ids = {}
    def flush():
        if paragraph:
            result.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
    def close_list():
        nonlocal listing
        if listing:
            result.append('</' + listing + '>')
            listing = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith('```') or line.startswith('    '):
            flush(); close_list()
            fenced = line.startswith('```')
            code = []
            if fenced:
                index += 1
                while index < len(lines) and not lines[index].startswith('```'):
                    code.append(lines[index]); index += 1
            else:
                while index < len(lines) and (lines[index].startswith('    ') or not lines[index]):
                    code.append(lines[index][4:] if lines[index].startswith('    ') else '')
                    index += 1
                index -= 1
            result.append('<pre><code>' + html.escape('\n'.join(code).rstrip()) + '</code></pre>')
        elif line.startswith('|') and index + 1 < len(lines) and re.match(r'^\|?[\s:|-]+\|\s*$', lines[index + 1]):
            flush(); close_list()
            headings = [cell.strip() for cell in line.strip('|').split('|')]
            result.append('<div class="table"><table><thead><tr>' + ''.join('<th>' + inline(cell) + '</th>' for cell in headings) + '</tr></thead><tbody>')
            index += 2
            while index < len(lines) and lines[index].startswith('|'):
                result.append('<tr>' + ''.join('<td>' + inline(cell.strip()) + '</td>' for cell in lines[index].strip('|').split('|')) + '</tr>')
                index += 1
            result.append('</tbody></table></div>'); index -= 1
        elif match := re.match(r'^(#{1,6})\s+(.+)', line):
            flush(); close_list()
            level, title = len(match[1]), match[2]
            slug = re.sub(r'[^\w\s-]', '', title.lower()).replace(' ', '-')
            suffix = seen_ids.get(slug, 0); seen_ids[slug] = suffix + 1
            anchor = slug + ('-' + str(suffix) if suffix else '')
            result.append(f'<h{level} id="{html.escape(anchor, quote=True)}">{inline(title)}</h{level}>')
        elif match := re.match(r'^\s*(?:([-*])|\d+\.)\s+(.+)', line):
            flush()
            kind = 'ul' if match[1] else 'ol'
            if listing != kind:
                close_list(); listing = kind; result.append('<' + kind + '>')
            result.append('<li>' + inline(match[2]) + '</li>')
        elif not line.strip():
            flush(); close_list()
        elif re.fullmatch(r'[-*_]{3,}', line.strip()):
            flush(); close_list(); result.append('<hr>')
        elif line.startswith('> '):
            flush(); close_list(); result.append('<blockquote>' + inline(line[2:]) + '</blockquote>')
        else:
            paragraph.append(line)
        index += 1
    flush(); close_list()
    title = html.escape(lines[0].lstrip('# ') if lines else 'AGI Fleet Linux')
    digest = hashlib.sha256(text.encode()).hexdigest()
    css = 'html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0d16;color:#eef1fa;font:16px/1.65 system-ui,sans-serif}main{max-width:1060px;margin:auto;padding:32px 24px 80px}a{color:#c9b6ff}nav{padding-bottom:18px;border-bottom:1px solid #43475c}h1{font-size:clamp(30px,5vw,44px);line-height:1.15}h2{margin-top:38px}pre{padding:18px;background:#151a2b;border:1px solid #4f5570;border-radius:8px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}code{font-size:.88em}p,li{overflow-wrap:anywhere}.table{overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #43475c}a:focus-visible{outline:3px solid #d4c4ff;outline-offset:3px}blockquote{border-left:3px solid #bda6ed;margin-left:0;padding-left:16px}@media print{html{color-scheme:light}body,pre{background:white;color:black}a{color:black}}'
    return '<!doctype html><html lang="' + language + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="source-sha256" content="' + digest + '"><meta name="referrer" content="no-referrer"><title>' + title + '</title><style>' + css + '</style></head><body><main><nav><a href="' + html.escape(back, quote=True) + '">' + navigation + '</a></nav>' + '\n'.join(result) + '</main></body></html>\n'


def edition_paths(root):
    registry = json.loads((root / 'config/role-registry.json').read_text())['roles']
    require(set(registry) == ROLES, 'All six roles are required')
    return [('fleet', root)] + [(role, root / 'packages' / entry['package']) for role, entry in registry.items()]


def plain_text_guide(version, role):
    return f'''AGI Fleet Linux {version} — {role.title()} edition
Current Linux installation and qualification guide

START HERE
Open START_HERE.html in this verified release folder.

Fresh installation:
  docs/linux-current/docs/FRESH_INSTALL.html
Plain-text instructions:
  docs/linux-current/docs/FRESH_INSTALL.md
Troubleshooting and safe failure reporting:
  docs/linux-current/docs/TROUBLESHOOTING.html
  docs/linux-current/docs/TROUBLESHOOTING.md
Physical qualification ledger:
  docs/linux-current/docs/PHYSICAL_QUALIFICATION.html
Release status:
  docs/linux-current/README.html

BEFORE INSTALLATION
Use the complete AGI_Fleet_Linux_v{version}.zip and verify its SHA-256
against SHA256SUMS-v{version}.txt from the same published release.
Confirm that this exact archive has passed native acceptance on both
architectures and its controlled fresh-install gate is open.
Earlier releases' results do not qualify this archive.

The supported target is Ubuntu Desktop 24.04 LTS, x86-64 or ARM64.
Follow the current fresh-install guide in order with NEW nonadministrator accounts
for separate signer and compute roles. Keep the complete Fleet folder.
Keep previous installations inactive and preserved.
No migration, engineering fixtures or manual profile/state edits are required.
The administrator follows Prepare-Ubuntu.sh in the guide. In the separate
compute desktop session, follow Prepare-Compute.sh and the role's
Install.sh --file PRIVATE_SETUP.json instructions. Use only the Linux .sh
entry points named in the guide. Qualify each role independently.

Physical installation, rootless Docker, OAuth/inference, live documents,
base and browser cleanup, reboot identity and 72-hour endurance require
their own recorded results. Production qualification remains pending.

ON FAILURE
Stop and preserve accounts, state, reports and COMPUTE_STOP. Follow the
current troubleshooting guide above. Never remove STOP manually, weaken
ownership checks or substitute the root Docker daemon. Keep wallet
material, setup JSON, tokens and private documents out of support reports.

Historical instructions and evidence remain for engineering traceability.
Use the current guide paths above for this release.
'''


def add_operator_guides(root, repository, version, commit):
    guides = [repository / 'README.md', *sorted((repository / 'docs').glob('*.md')),
              repository / 'engineering/README.md', *sorted((repository / 'validation').glob('*.md'))]
    selection = {path.relative_to(repository).as_posix() for path in guides}
    for role, app in edition_paths(root):
        copied = app / 'docs/linux-current'
        for source in guides:
            relative = source.relative_to(repository)
            text = source.read_text()
            def portable_link(match):
                target = match[2]
                if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                    return match[0]
                base, separator, anchor = target.partition('#')
                resolved = (source.parent / base).resolve()
                if resolved.is_relative_to(repository) and resolved.relative_to(repository).as_posix() in selection:
                    return match[0]
                require(resolved.is_relative_to(repository), 'Guide link escapes the repository: ' + target)
                url = 'https://github.com/MontrealAI/AGI-Fleet-Linux/blob/' + commit + '/' + resolved.relative_to(repository).as_posix()
                return '[' + match[1] + '](' + url + (separator + anchor if separator else '') + ')'
            text = re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)', portable_link, text)
            destination = copied / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(text)
            back = os.path.relpath(app / 'START_HERE.html', destination.parent)
            destination.with_suffix('.html').write_text(render_markdown(text, back,
                language='fr' if relative.as_posix() == 'docs/COMMENCER_ICI.md' else 'en'))
        welcome = f'''# AGI Fleet Linux {version}

**Engineering and physical-qualification candidate — {role.title()} edition.**

Native acceptance for this exact release must be published before a controlled fresh installation. Production qualification is pending. Physical qualification remains pending. Earlier releases' results do not qualify this ZIP.

## Build your SUCCESSOR Ω

Open the [English Builder](docs/successor/My-SUCCESSOR-Omega-en.html) or [Builder en français](docs/successor/My-SUCCESSOR-Omega-fr.html) for a useful first result, entirely offline. No installation, wallet or provider is needed for the two local missions. Keep your capsule and [editable source](docs/successor/SUCCESSOR-Omega-Fleet-source.zip).

For real Fleet work, follow the [connection, review and recovery guide](docs/successor/GUIDE.html). The installed Agent and Node expose SUCCESSOR Ω + Fleet within Work Studio. Existing roles, installation, STOP, backup and settlement workflows remain available below.

1. Read the [Linux fresh-install guide](docs/linux-current/docs/FRESH_INSTALL.md).
2. Check the [release status](docs/linux-current/README.md) and exact SHA-256 on the release page.
3. Follow the guide using new, separate signer and compute accounts. Keep the complete Fleet folder.
4. Record each physical gate in the [qualification ledger](docs/linux-current/docs/PHYSICAL_QUALIFICATION.md).

The supported target is Ubuntu Desktop 24.04 LTS, x86-64 or ARM64. Use the Linux `.sh` entry points named in the guide. Agent, Node, Moderator, Employer, Evidence and Recovery retain separate bounded authority.

On any failure, preserve accounts, state, reports and COMPUTE_STOP. Follow the guide's failure instructions. Never remove STOP manually or weaken ownership and cleanup checks.

[AGIJobManager integration](docs/linux-current/docs/JOB_INTEGRATION.md) · [Mainnet deployment observation](docs/linux-current/docs/MAINNET_DEPLOYMENT.md)

Historical Mac instructions and prior evidence remain available for engineering traceability. Begin with the current Linux guide above.
'''
        for name in ['README.md', 'START_HERE.md']:
            (app / name).write_text(welcome)
            (app / name.replace('.md', '.html')).write_text(render_markdown(welcome).replace('<body>', '<body><span id="agi-fleet-linux-1011"></span>'))
        if role == 'fleet':
            (app / 'NOTICE.html').write_text(render_markdown((app / 'NOTICE.md').read_text()))
        (app / 'Linux-Guide.html').write_text(render_markdown(welcome).replace('<body>', '<body><span id="agi-fleet-linux-1011"></span>'))
        (app / 'Linux-Guide.txt').write_text(plain_text_guide(version, role))
        (app / 'READ_ME_FIRST.txt').write_text(f'AGI Fleet Linux {version}\nOpen START_HERE.html for the current Linux installation and qualification guide.\nProduction and physical qualification remain pending.\n')
        # Refresh only current release labels; historical prose and evidence stay intact.
        for source in (app / 'docs').glob('*.md'):
            before = source.read_text()
            if re.match(r'^# (Historical|Changelog)', before, re.I):
                continue
            after = re.sub(r'(Current application:\s*\*\*)[\d.]+(\*\*)', lambda match: match[1] + version + match[2], before)
            after = re.sub(r'AGI_Autonomous_Fleet_v\d+\.\d+\.\d+', 'AGI_Autonomous_Fleet_v' + version, after)
            if after != before:
                source.write_text(after)
                source.with_suffix('.html').write_text(render_markdown(after, '../START_HERE.html'))


def update_manifests(root, version, epoch):
    versions = {role: version for role, _ in edition_paths(root)}
    validation = {'release': versions, 'status': 'PENDING_SAVED_ARCHIVE_NATIVE_VALIDATION',
                  'productionQualified': False, 'checks': {},
                  'external': {'nativeX64': 'NOT_RUN', 'nativeArm64': 'NOT_RUN', 'physicalLinux': 'NOT_RUN',
                               'rootlessDocker': 'NOT_RUN', 'oauthInference': 'NOT_RUN', 'liveDocuments': 'NOT_RUN',
                               'baseAndBrowserCleanup': 'NOT_RUN', 'rebootIdentity': 'NOT_RUN', 'endurance72Hours': 'NOT_RUN'},
                  'evidenceDirectory': 'external-hash-bound-Linux-addendum'}
    for role, app in edition_paths(root):
        for name in ['package.json', 'package-lock.json']:
            data = json.loads((app / name).read_text())
            require(data['version'] == version, 'Candidate edition version differs: ' + role)
        config = json.loads((app / 'config/companion-releases.json').read_text())
        require(all(config[name] == value for name, value in versions.items()), 'Candidate companion versions differ')
        old = app / 'release-manifest.json'
        history = app / 'evidence/history/linux/release-manifest-v1.0.9.json'
        if history.exists():
            require(history.read_bytes() == old.read_bytes(), 'Historical manifest already differs')
        else:
            history.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(old, history)
        write_json(old, {'schema': 'agi-coordinated-release/v2', 'release': versions, 'edition': role,
                        'date': datetime.fromtimestamp(epoch, timezone.utc).date().isoformat(),
                        'classification': 'engineering and qualification candidate', 'platformEdition': 'Ubuntu 24.04 LTS',
                        'productionQualified': False, 'signedNotarized': False, 'localValidation': validation,
                        'physicalQualification': validation['external'], 'evidence': 'external-hash-bound-Linux-addendum',
                        'compatibility': {'nodeRange': '>=24.19.0 <25', 'testedNode': '24.21.0', 'openclaw': '2026.9.5',
                                          'dockerTarget': '29.8.2', 'operatingSystem': 'Ubuntu Desktop 24.04 LTS'},
                        'productionArchitecture': {'default': 'fresh-install', 'productionQualified': False},
                        'perFileIntegrity': 'MANIFEST.sha256', 'sourceInventory': 'source-inventory.json',
                        'releasePublication': 'Public immutable qualification candidate; no earlier asset overwritten'})
    return validation


def add_successor(root, repository, node):
    """Materialize the same offline Builder in all seven complete editions."""
    first = root / 'docs/successor'
    subprocess.run([str(node), str(root / 'successor/build.mjs'), '--out', str(first)], check=True)
    guide = (repository / 'successor/docs/GUIDE.md').read_text()
    (first / 'GUIDE.md').write_text(guide)
    (first / 'GUIDE.html').write_text(render_markdown(guide, '../../START_HERE.html'))
    for source in (repository / 'successor/docs').glob('*'):
        if source.is_file() and source.name != 'GUIDE.md':
            shutil.copyfile(source, first / source.name)
            if source.suffix == '.md': (first / source.with_suffix('.html').name).write_text(render_markdown(source.read_text(), '../../START_HERE.html'))
    for role, app in edition_paths(root):
        if role != 'fleet':
            shutil.copytree(first, app / 'docs/successor')


def build(args):
    repository = args.repository.resolve(strict=True)
    specification = json.loads(args.specification.read_text())
    version = specification['version']
    require(re.fullmatch(r'\d+\.\d+\.\d+', version) and version != '1.0.9', 'A new release version is required')
    prefix = 'AGI_Fleet_Linux_v' + version
    require(specification['tag'] == 'v' + version + '-qualification', 'Candidate must remain a qualification prerelease')
    require(specification.get('prefix', prefix) == prefix, 'Candidate prefix differs')
    epoch = specification.get('sourceDateEpoch', specification.get('epoch'))
    require(isinstance(epoch, int) and 315532800 <= epoch < 4354819200, 'Invalid deterministic ZIP timestamp')
    source = repository / 'fleet'
    source_inventory = inventory(source, specification['sourceRevisionSHA256'], specification['sourceFiles'])
    if args.commit is None:
        args.commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repository, text=True).strip()
    require(re.fullmatch(r'[0-9a-f]{40}', args.commit), 'A full reviewed repository commit is required')
    node = Path(shutil.which(args.node) or args.node).resolve(strict=True)
    require(subprocess.check_output([str(node), '--version'], text=True).strip() == 'v24.21.0', 'Use pinned Node 24.21.0')
    out = args.output.absolute()
    work = args.work.absolute() if args.work else Path(tempfile.mkdtemp(prefix='agi-linux-build-')) / 'work'
    for destination in [out, work]:
        require(not destination.exists() and not destination.is_symlink(), 'Use absent build/output directories')
        require(destination.parent.resolve(strict=True) == destination.parent, 'Build/output parent must be canonical')
        require(not destination.is_relative_to(source), 'Build/output must be outside the reviewed source mirror')
    require(not work.is_relative_to(repository), 'Build workspace must be outside the repository')
    require(not out.is_relative_to(work) and not work.is_relative_to(out), 'Separate build and output directories')
    out.mkdir(); work.mkdir()
    archive = args.archive or work / ASSET
    if args.archive is None:
        download(URL, archive, SHA256, SIZE)
    baseline = verify_archive(archive)
    extract(archive, work / 'extracted')
    root = work / 'extracted' / PREFIX
    overlay_source(root, source, source_inventory['files'])
    add_operator_guides(root, repository, version, args.commit)
    add_successor(root, repository, node)
    validation = update_manifests(root, version, epoch)
    validation_path = work / 'pending-validation.json'; write_json(validation_path, validation)
    environment = {**os.environ, 'PATH': str(node.parent) + os.pathsep + os.environ.get('PATH', ''),
                   'SOURCE_DATE_EPOCH': str(epoch)}
    environment.pop('NODE_OPTIONS', None); environment.pop('NODE_PATH', None)
    def run(label, command):
        with (out / (label + '.log')).open('w') as output:
            result = subprocess.run(command, cwd=root, env=environment, stdout=output, stderr=subprocess.STDOUT)
        require(result.returncode == 0, label + ' failed; inspect ' + str(out / (label + '.log')))
    for role, app in edition_paths(root):
        run(role + '-commands', [str(node), str(app / 'scripts/current-guides.mjs'), '--write'])
        commands = app / 'docs/COMMANDS.md'
        commands.with_suffix('.html').write_text(render_markdown(commands.read_text(), '../START_HERE.html'))
    run('metadata', [sys.executable, str(root / 'scripts/prepare-release.py'), '--root', str(root), 'metadata',
                     '--baseline', str(archive.resolve()), '--epoch', str(epoch), '--validation', str(validation_path)])
    regenerated = json.loads((root / 'source-inventory.json').read_text())
    if regenerated['files'] != source_inventory['files']:
        expected = {row['path']: row for row in source_inventory['files']}
        observed = {row['path']: row for row in regenerated['files']}
        write_json(out / 'source-inventory-differences.json', {
            'status': 'FAIL', 'expectedRevisionSHA256': source_inventory['revisionSHA256'],
            'observedRevisionSHA256': regenerated['revisionSHA256'],
            'differences': [{'path': name, 'expected': expected.get(name), 'observed': observed.get(name)}
                            for name in sorted(expected.keys() | observed.keys())
                            if expected.get(name) != observed.get(name)]})
    require(regenerated['files'] == source_inventory['files']
            and regenerated['revisionSHA256'] == source_inventory['revisionSHA256'],
            'Materialized source inventory differs from the reviewed mirror')
    destination = out / (prefix + '.zip')
    run('package', [sys.executable, str(root / 'scripts/package-release.py'), '--root', str(root), '--out', str(destination)])
    spec = importlib.util.spec_from_file_location('candidate_preparation', root / 'scripts/prepare-release.py')
    preparation = importlib.util.module_from_spec(spec); spec.loader.exec_module(preparation)
    verified = preparation.verify_archive(destination)
    if version in ('1.1.1', '1.1.2', '1.1.3'):
        verify_maintenance_archive(destination)
    gate_path = out / (prefix + '-checks/final-gate.json')
    gate = json.loads(gate_path.read_text())
    require(gate['status'] == 'PASS_PACKAGED_EXECUTABLES_AND_LINUX_LAUNCHER_SMOKE'
            and gate['sha256'] == verified['sha256'] and verified['bytes'] < LIMIT, 'Final extracted gate differs')
    run('successor-saved-archive', [sys.executable, str(repository / 'engineering/check-successor-archive.py'), '--archive', str(destination), '--node', str(node), '--out', str(out / (prefix + '-checks/successor-archive.json'))])
    result = {'schema': 'agi-linux-candidate-build/v1', 'version': version, 'tag': specification['tag'],
              'prefix': prefix, 'name': destination.name, 'bytes': verified['bytes'], 'sha256': verified['sha256'],
              'sourceRevisionSHA256': source_inventory['revisionSHA256'], 'sourceFiles': len(source_inventory['files']),
              'repositoryCommit': args.commit, 'workflowCommit': args.commit, 'sourceDateEpoch': epoch, 'epoch': epoch, 'baseline': baseline,
              'archiveVerification': verified, 'finalExtractedGate': gate,
              'nativeAcceptance': 'NOT_RUN', 'operatorGate': 'CLOSED_PENDING_NATIVE_ACCEPTANCE',
              'productionQualified': False, 'physicalQualification': validation['external']}
    for key in ['native', 'integration', 'counts', 'targetedFiles', 'targetedTests', 'completeFiles', 'completeTests']:
        if key in specification:
            result[key] = specification[key]
    write_json(out / 'release.json', result)
    (out / ('SHA256SUMS-v' + version + '.txt')).write_text(result['sha256'] + '  ' + destination.name + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=ROOT)
    parser.add_argument('--specification', type=Path, default=ROOT / 'engineering/next-release.json')
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--work', type=Path, help='Absent workspace; defaults to an isolated temporary build')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', default=os.environ.get('GITHUB_SHA'), help='Full reviewed commit; defaults to GITHUB_SHA or checkout HEAD')
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    print(json.dumps(build(args), indent=2))


if __name__ == '__main__':
    main()
