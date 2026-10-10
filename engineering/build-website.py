#!/usr/bin/env python3
"""Build Pages from the published release pointer or the frozen baseline."""
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'website'
OUTPUT = ROOT / '_site'
REPO = 'https://github.com/MontrealAI/AGI-Fleet-Linux'
PUBLIC_FILES = ('index.html', 'fr.html', 'start.html', 'start-fr.html', 'mac.html', 'mac-fr.html',
                'styles.css', 'app.js', 'onboarding.css', 'onboarding.js', 'favicon.svg')


def read_release():
    published = ROOT / 'engineering/published-release.json'
    selected = published if published.exists() or published.is_symlink() else ROOT / 'engineering/current-release.json'
    if selected.is_symlink() or not selected.is_file():
        raise ValueError('Release metadata must be a regular repository file')
    release = json.loads(selected.read_text())
    expected = 'agi-linux-published-release/v1' if selected == published else 'agi-linux-current-release/v1'
    if not isinstance(release, dict) or release.get('schema') != expected:
        raise ValueError('Unexpected release metadata schema')
    return release


def published_evidence(release):
    audit = release['audit']
    commit, run_id = release['workflowCommit'], str(release['workflowRun'])
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[1-9][0-9]*', run_id):
        raise ValueError('Published release workflow provenance is invalid')
    if (audit.get('schema') != 'agi-next-release-independent-audit/v1' or audit.get('status') != 'PASS'
            or audit.get('version') != release['version'] or audit.get('releaseSHA256') != release['sha256']
            or audit.get('sourceRevisionSHA256') != release['sourceRevisionSHA256']
            or audit.get('workflowCommit') != commit or str(audit.get('workflowRun')) != run_id
            or audit.get('architectures') != ['x64', 'arm64']
            or audit.get('productionQualified') is not False or audit.get('physicalQualification') != 'NOT_RUN'):
        raise ValueError('Published audit is incomplete or belongs to a different release')
    if (not re.fullmatch(r'[0-9a-f]{64}', release['sourceRevisionSHA256'])
            or release['nativeAcceptance'] != 'PASS' or release['jobIntegrationAcceptance'] != 'PASS'
            or release['productionQualified'] is not False or release['physicalQualification'] != 'NOT_RUN'
            or release['operatorGate'] != 'OPEN_FOR_CONTROLLED_FRESH_INSTALL'):
        raise ValueError('Published qualification classification contradicts its audit')
    if type(release['sourceFiles']) is not int or release['sourceFiles'] <= 0:
        raise ValueError('Published source inventory count is invalid')
    native_logs, integration_logs = 0, 0
    for group in ('native', 'integration'):
        runs = audit[group]
        if len(runs) != 2 or {run['architecture'] for run in runs} != {'x64', 'arm64'}:
            raise ValueError('Published audit must cover both supported architectures')
        for run in runs:
            if (run['status'] != 'PASS' or run['workflowCommit'] != commit
                    or str(run['workflowRun']) != run_id or run['productionQualified'] is not False):
                raise ValueError('Published per-architecture provenance or result differs')
            if group == 'native':
                for scope in ('targeted', 'complete'):
                    result, expected = run['runs'][scope], release['native'][scope]
                    counts = result['counts']
                    if (result['status'] != 'PASS' or result['verifiedLogs'] != expected['files']
                            or not 0 < counts['tests'] == counts['pass'] == expected['tests']
                            or not 0 < result['verifiedLogs'] == expected['files']
                            or result['verifiedSourceFiles'] != release['sourceFiles']
                            or any(counts[key] != 0 for key in ('fail', 'cancelled', 'skipped', 'todo'))):
                        raise ValueError('Published native result is incomplete or not passing')
                    native_logs += result['verifiedLogs']
            elif (run['standaloneIntegrationScripts'] <= 0 or run['managerTestsPassed'] <= 0
                    or not 0 < run['productionSourcesMatched'] == run['contractArtifactsMatched']):
                raise ValueError('Published integration result is incomplete')
            elif run['verifiedLogs'] <= 0:
                raise ValueError('Published integration log count is invalid')
            else:
                integration_logs += run['verifiedLogs']
    if native_logs != audit['verifiedTapLogs'] or integration_logs != audit['verifiedIntegrationLogs']:
        raise ValueError('Published audit log totals differ from architecture results')
    evidence = release['evidence']
    if (not re.fullmatch(r'[A-Za-z0-9._-]+\.zip', evidence['name'])
            or type(evidence['bytes']) is not int or not 0 < evidence['bytes'] < 450_000_000
            or not re.fullmatch(r'[0-9a-f]{64}', evidence['sha256'])):
        raise ValueError('Published evidence archive identity is invalid')
    base = f"{REPO}/releases/download/{release['tag']}"
    manifest = f"{base}/Release-Manifest-v{release['version']}.json"
    physical = {'physicalHostQualification': 'NOT_RUN'}
    return physical, release['jobIntegrationAcceptance'], manifest, f"{base}/{evidence['name']}", manifest


def release_tokens(release):
    version, tag, name = (release[key] for key in ('version', 'tag', 'name'))
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Release version must be an explicit semantic version')
    if not re.fullmatch(r'[A-Za-z0-9._-]+', tag) or not re.fullmatch(r'[A-Za-z0-9._-]+\.zip', name):
        raise ValueError('Unsafe release tag or archive name')
    if not re.fullmatch(r'[0-9a-f]{64}', release['sha256']):
        raise ValueError('Release SHA-256 is invalid')
    if type(release['bytes']) is not int or not 0 < release['bytes'] < 450_000_000:
        raise ValueError('Release archive must be positive and below 450 MB')
    if release['schema'] == 'agi-linux-published-release/v1':
        if tag != f'v{version}-qualification' or name != f'AGI_Fleet_Linux_v{version}.zip':
            raise ValueError('Published release tag or archive version differs')
        physical, integration, native_url, integration_url, manifest_url = published_evidence(release)
    else:
        physical, integration = release['physicalQualification'], release['jobIntegration']['status']
        audit = Path(release['nativeAudit']['path'])
        if audit.is_absolute() or '..' in audit.parts or not (ROOT / audit).is_file():
            raise ValueError('Native audit must reference an existing repository file')
        if hashlib.sha256((ROOT / audit).read_bytes()).hexdigest() != release['nativeAudit']['sha256']:
            raise ValueError('Native audit digest does not match release metadata')
        native_url = f'{REPO}/blob/main/{audit.as_posix()}'
        integration_url = f'{REPO}/blob/main/docs/JOB_INTEGRATION.md'
        manifest_url = f'{REPO}/blob/main/engineering/current-release.json'
    known = {'PASS', 'NOT_RUN', 'PENDING', 'FAIL', 'NOT_PASS', 'BLOCKED'}
    if not physical or not all(value in known for value in physical.values()):
        raise ValueError('Physical qualification status requires explicit website review')
    passed = sum(value == 'PASS' for value in physical.values())
    complete = passed == len(physical)
    all_not_run = all(value == 'NOT_RUN' for value in physical.values())
    opened = release['operatorGate'] == 'OPEN_FOR_CONTROLLED_FRESH_INSTALL'
    production = release['productionQualified']
    if not isinstance(production, bool):
        raise ValueError('Production qualification must be an explicit boolean')
    if production and (not complete or release['nativeAcceptance'] != 'PASS' or integration != 'PASS'):
        raise ValueError('Production label contradicts recorded qualification evidence')
    tokens = {
        'REPO': REPO, 'VERSION': version, 'ASSET_NAME': name,
        'RELEASE_URL': f'{REPO}/releases/tag/{tag}',
        'DOWNLOAD_URL': f'{REPO}/releases/download/{tag}/{name}',
        'SHA256': release['sha256'], 'BYTES': f"{release['bytes']:,}",
        'SIZE_MB': f"{release['bytes'] / 1_000_000:.1f}",
        'RELEASE_LABEL_EN': 'Production-qualified release' if production else 'Qualification prerelease',
        'RELEASE_LABEL_FR': 'Version qualifiée pour la production' if production else 'Préversion de qualification',
        'GATE_EN': 'Open for controlled fresh installation.' if opened else 'Installation gate is not open. Review the release manifest before proceeding.',
        'GATE_FR': 'Installation initiale contrôlée autorisée.' if opened else 'Installation non autorisée à ce stade. Consultez le manifeste avant de poursuivre.',
        'NATIVE': release['nativeAcceptance'], 'INTEGRATION': integration,
        'NATIVE_AUDIT_URL': native_url, 'INTEGRATION_EVIDENCE_URL': integration_url,
        'RELEASE_MANIFEST_URL': manifest_url,
        'PHYSICAL_EN': 'Recorded' if complete else ('Not run' if all_not_run else 'Incomplete'),
        'PHYSICAL_FR': 'Consignée' if complete else ('Non réalisée' if all_not_run else 'Incomplète'),
        'PHYSICAL_COUNT_EN': ('No physical qualification is recorded in the published manifest.'
                              if release['schema'] == 'agi-linux-published-release/v1'
                              else f'{passed} of {len(physical)} manifest gates have recorded PASS.'),
        'PHYSICAL_COUNT_FR': ('Aucune qualification physique n’est consignée dans le manifeste publié.'
                              if release['schema'] == 'agi-linux-published-release/v1'
                              else f'{passed} des {len(physical)} critères du manifeste ont un résultat PASS consigné.'),
        'PRODUCTION_EN': 'recorded in the manifest' if production else 'not complete',
        'PRODUCTION_FR': 'consignée dans le manifeste' if production else 'non terminée',
    }
    if tokens['NATIVE'] not in known or tokens['INTEGRATION'] not in known:
        raise ValueError('Unknown qualification status requires review')
    return tokens



def read_mac_release():
    published = ROOT / 'macos/published-release.json'
    selected = published if published.exists() or published.is_symlink() else ROOT / 'macos/release.json'
    if selected.is_symlink() or not selected.is_file():
        raise ValueError('Mac release metadata must be a regular repository file')
    release = json.loads(selected.read_text())
    expected = 'agi-macos-published-release/v1' if selected == published else 'agi-macos-release-specification/v1'
    if not isinstance(release, dict) or release.get('schema') != expected:
        raise ValueError('Unexpected Mac release metadata schema')
    return release, selected == published



def mac_published_evidence(release):
    """Bind website claims to the exact independent publication audit."""
    def require(condition, message):
        if not condition:
            raise ValueError('Published Mac evidence: ' + message)

    def digest(value):
        return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)

    def integer(value, minimum=0):
        return type(value) is int and value >= minimum

    repository = 'MontrealAI/AGI-Fleet-Linux'
    commit, run_id = release.get('workflowCommit'), release.get('workflowRun')
    require(release.get('repository') == repository
            and release.get('repositoryCommit') == commit
            and isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit)
            and isinstance(run_id, str) and re.fullmatch(r'[1-9][0-9]*', run_id), 'workflow provenance differs')
    require(digest(release.get('sourceRevisionSHA256')) and integer(release.get('sourceFiles'), 4816),
            'source identity is incomplete')
    evidence, audit = release.get('evidence'), release.get('audit')
    require(isinstance(evidence, dict) and evidence.get('name') == f'macOS-Qualification-Evidence-v{release["version"]}.zip'
            and integer(evidence.get('bytes'), 1) and evidence['bytes'] < 450_000_000
            and digest(evidence.get('sha256')), 'evidence archive identity is invalid')
    require(isinstance(audit, dict) and audit.get('schema') == 'agi-macos-independent-audit/v1'
            and audit.get('status') == 'PASS' and digest(audit.get('releaseMetadataSHA256')),
            'independent audit is missing or incomplete')
    # publish.py preserves candidate key order and values, replaces these three
    # fields, and adds five publication-only fields. Reconstruct build.py's
    # exact UTF-8 serialization so the audit binds *all* candidate metadata,
    # including the build inputs, base, toolchain and archive verification.
    candidate = {key: value for key, value in release.items()
                 if key not in {'repository', 'workflowRun', 'jobIntegrationAcceptance', 'audit', 'evidence'}}
    candidate.update(schema='agi-macos-candidate-build/v1', nativeAcceptance='NOT_RUN',
                     operatorGate='CLOSED_PENDING_NATIVE_ACCEPTANCE')
    candidate_bytes = (json.dumps(candidate, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    require(hashlib.sha256(candidate_bytes).hexdigest() == audit['releaseMetadataSHA256'],
            'audit metadata digest differs from the published candidate')
    expected = {'version': release['version'], 'releaseSHA256': release['sha256'], 'releaseBytes': release['bytes'],
                'sourceRevisionSHA256': release['sourceRevisionSHA256'], 'repository': repository,
                'workflowCommit': commit, 'workflowRun': run_id, 'nativeAcceptance': 'PASS',
                'jobIntegrationAcceptance': 'PASS', 'operatorGate': 'OPEN_FOR_CONTROLLED_FRESH_INSTALL',
                'physicalQualification': 'NOT_RUN'}
    require(all(audit.get(key) == value for key, value in expected.items())
            and audit.get('productionQualified') is False and audit.get('signedNotarized') is False,
            'audit belongs to a different release or qualification scope')

    def provenance(row):
        return (row.get('status') == 'PASS' and row.get('repository') == repository
                and row.get('workflowCommit') == commit and row.get('workflowRun') == run_id
                and row.get('platform') == 'darwin' and row.get('architecture') == 'arm64'
                and row.get('productionQualified') is False)

    native = audit.get('native')
    require(isinstance(native, list) and len(native) == 2 and all(isinstance(row, dict) for row in native)
            and {row.get('runnerLabel') for row in native} == {'macos-15', 'macos-26'},
            'both native macOS versions are required')
    native_logs, native_counts = 0, []
    for row in native:
        require(provenance(row) and row.get('physicalQualification') == 'NOT_RUN'
                and str(row.get('macOS', '')).split('.')[0] == row['runnerLabel'].removeprefix('macos-')
                and digest(row.get('summarySHA256')) and digest(row.get('systemNodeProvisioningSHA256')),
                'native result provenance differs')
        complete = row.get('complete')
        require(isinstance(complete, dict) and complete.get('status') == 'PASS'
                and integer(complete.get('testFiles'), 342) and complete.get('verifiedLogs') == complete['testFiles']
                and complete.get('verifiedSourceFiles') == release['sourceFiles']
                and digest(complete.get('resultsSHA256')) and digest(complete.get('testedSourceSHA256')),
                'complete native suite is missing')
        counts = complete.get('counts')
        require(isinstance(counts, dict) and all(integer(counts.get(key)) for key in
                ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'))
                and counts['tests'] == counts['pass'] >= 3898
                and all(counts[key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo')),
                'native suite did not pass without omissions')
        native_logs += complete['verifiedLogs']
        native_counts.append(counts)
    require(native_counts[0] == native_counts[1] and audit.get('verifiedTapLogs') == native_logs,
            'native coverage or log total differs')
    integration = audit.get('integration')
    require(isinstance(integration, dict) and provenance(integration)
            and integration.get('runnerLabel') == 'macos-26'
            and integration.get('standaloneIntegrationScripts') == 8 and integration.get('managerTestsPassed') == 777
            and integration.get('productionSourcesMatched') == integration.get('contractArtifactsMatched') == 11
            and integration.get('verifiedLogs') == audit.get('verifiedIntegrationLogs') == 19
            and integration.get('managerCommit') == '191cf3590e5cdc08df1bb0af500ee28a91c8b010'
            and all(digest(integration.get(key)) for key in
                    ('summarySHA256', 'currentManagerLifecycleSHA256', 'filesystemSHA256')),
            'complete integration and lifecycle evidence is missing')


def mac_release_tokens(release, published=False):
    expected = 'agi-macos-published-release/v1' if published else 'agi-macos-release-specification/v1'
    if not isinstance(release, dict) or release.get('schema') != expected:
        raise ValueError('Mac release schema does not match publication status')
    version, tag, name = (release[key] for key in ('version', 'tag', 'name'))
    if (not re.fullmatch(r'\d+\.\d+\.\d+', version)
            or tag != f'v{version}-macos-qualification'
            or name != f'AGI_Fleet_macOS_v{version}.zip'):
        raise ValueError('Mac release identity requires an explicit reviewed version')
    if (release.get('platform') != 'darwin' or release.get('architecture') != 'arm64'
            or release.get('productionQualified') is not False
            or release.get('physicalQualification') != 'NOT_RUN'
            or release.get('signedNotarized') is not False):
        raise ValueError('Mac website qualification and signing claims require explicit review')
    native = release.get('nativeAcceptance')
    if native not in {'NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'}:
        raise ValueError('Unknown Mac native acceptance status')
    guide = f'{REPO}/blob/main/macos/docs/FRESH_INSTALL.md'
    notes = f'{REPO}/blob/main/macos/docs/RELEASE_NOTES.md'
    if published:
        if (native != 'PASS' or release.get('jobIntegrationAcceptance') != 'PASS'
                or release.get('operatorGate') != 'OPEN_FOR_CONTROLLED_FRESH_INSTALL'
                or type(release.get('bytes')) is not int or not 0 < release['bytes'] < 450_000_000
                or not re.fullmatch(r'[0-9a-f]{64}', release.get('sha256', ''))
                or not re.fullmatch(r'[0-9a-f]{40}', release.get('workflowCommit', ''))
                or not re.fullmatch(r'[1-9][0-9]*', str(release.get('workflowRun', '')))):
            raise ValueError('Published Mac archive needs native and integration acceptance with exact workflow provenance')
        mac_published_evidence(release)
    elif release.get('operatorGate') != 'CLOSED_PENDING_NATIVE_ACCEPTANCE':
        raise ValueError('Unpublished Mac candidate must keep its installation gate closed')
    return {
        'MAC_VERSION': version, 'MAC_ASSET_NAME': name,
        'MAC_CHECKSUM_NAME': f'SHA256SUMS-macOS-v{version}.txt',
        'MAC_RELEASE_URL': f'{REPO}/releases/tag/{tag}' if published else notes,
        'MAC_DOWNLOAD_URL': f'{REPO}/releases/download/{tag}/{name}' if published else guide,
        'MAC_DOWNLOAD_LABEL_EN': 'Download the complete Mac ZIP' if published else 'Read the Mac preparation guide',
        'MAC_DOWNLOAD_LABEL_FR': 'Télécharger le ZIP Mac complet' if published else 'Lire le guide de préparation Mac (anglais)',
        'MAC_RELEASE_LABEL_EN': 'Mac qualification prerelease' if published else 'Mac qualification candidate',
        'MAC_RELEASE_LABEL_FR': 'Préversion Mac de qualification' if published else 'Version candidate Mac de qualification',
        'MAC_GATE_EN': ('Native acceptance is recorded. Controlled fresh installation is open.' if published else
                        'The installation gate is closed while native acceptance and publication are pending.'),
        'MAC_GATE_FR': ('Acceptation native consignée. Installation initiale contrôlée autorisée.' if published else
                        'L’installation reste fermée en attendant l’acceptation native et la publication.'),
        'MAC_PRODUCTION_EN': 'not complete', 'MAC_PRODUCTION_FR': 'non terminée',
        'MAC_AVAILABILITY_EN': (f'The published complete archive is {release["bytes"] / 1_000_000:.1f} MB.' if published else
                                'The candidate archive has not been published. Read the preparation guide now; wait for the native acceptance gate before downloading or installing.'),
        'MAC_AVAILABILITY_FR': (f'L’archive complète publiée fait {release["bytes"] / 1_000_000:.1f} Mo.' if published else
                                'L’archive candidate n’est pas encore publiée. Consultez le guide maintenant; attendez l’acceptation native avant de télécharger ou d’installer.'),
    }


def website_tokens(release):
    mac, published = read_mac_release()
    return {**release_tokens(release), **mac_release_tokens(mac, published)}


def render(contents, suffix, tokens):
    if suffix == '.html':
        contents = re.sub(r'@@([A-Z][A-Z0-9_]+)@@', lambda match: html.escape(str(tokens[match[1]]), quote=True), contents)
    if '@@' in contents:
        raise ValueError('Unresolved template token')
    return contents


def build():
    release = read_release()
    tokens = website_tokens(release)
    if OUTPUT.is_symlink():
        raise ValueError('Output must not be a symlink')
    OUTPUT.mkdir(exist_ok=True)
    files = list(PUBLIC_FILES)
    for name in files + ['release.json', 'mac-release.json', '.nojekyll']:
        destination = OUTPUT / name
        if destination.is_symlink() or (destination.exists() and (not destination.is_file() or destination.stat().st_nlink != 1)):
            raise ValueError('Website output must be a regular file without links')
    for name in files:
        source = SOURCE / name
        if source.is_symlink():
            raise ValueError('Website input must not be a symlink')
        contents = source.read_text(encoding='utf-8')
        contents = render(contents, source.suffix, tokens)
        destination = OUTPUT / name
        if destination.is_symlink():
            raise ValueError('Website output must not be a symlink')
        destination.write_text(contents, encoding='utf-8')
    (OUTPUT / 'release.json').write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
    mac, published = read_mac_release()
    (OUTPUT / 'mac-release.json').write_text(json.dumps({**mac, 'published': published}, indent=2) + '\n', encoding='utf-8')
    (OUTPUT / '.nojekyll').write_text('', encoding='utf-8')
    print(f"Built EN/FR GitHub Pages site for Mac and Linux {release['version']} in {OUTPUT}")


if __name__ == '__main__':
    build()
