"""Audit exact development packages; publish only a separate immutable preview."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import urllib.error
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = 'MontrealAI/AGI-Fleet-Linux'
LIMIT = 450_000_000
ROLES = ('agent', 'node', 'moderator', 'employer', 'evidence', 'recovery')


def require(value, message):
    if not value:
        raise ValueError(message)


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


INSTALL = module('local_install', ROOT / 'local-runtime/install.py')


def load(file):
    require(file.is_file() and not file.is_symlink() and file.stat().st_size < 8_000_000, 'Unsafe JSON input')
    return INSTALL.read_json(file.read_bytes())


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(file):
    require(file.is_file() and not file.is_symlink() and 0 < file.stat().st_size < LIMIT, 'Unsafe asset')
    return {'name': file.name, 'bytes': file.stat().st_size, 'sha256': sha(file)}


def write(file, value):
    file.write_text(json.dumps(value, indent=2) + '\n')


def context():
    commit, run = os.environ.get('GITHUB_SHA', ''), os.environ.get('GITHUB_RUN_ID', '')
    require(re.fullmatch('[0-9a-f]{40}', commit) and re.fullmatch('[1-9][0-9]*', run), 'Exact workflow identity required')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == commit, 'Checkout identity differs')
    return commit, run


def tap(file, expected):
    require(file.is_file() and not file.is_symlink() and file.stat().st_size < 8_000_000, 'Missing bounded TAP log')
    text = file.read_text()
    result = {}
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        values = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.M)
        require(len(values) == 1, 'Missing or ambiguous TAP summary')
        result[key] = int(values[0])
    require(result['tests'] == result['pass'] == expected and all(result[k] == 0 for k in ('fail', 'cancelled', 'skipped', 'todo')), 'Incomplete TAP acceptance')
    require(not re.search(r'^not ok\b|^Bail out!', text, re.M), 'Failed TAP case')
    return result


def audit(evidence, commit, run, specification=None):
    spec = specification or load(ROOT / 'local-runtime/preview-release.json')
    require(spec.get('schema') == 'agi-fleet/local-preview-release/v1' and spec.get('qualificationScope') == 'bounded-offline-linux-development-preview'
            and all(spec.get(k) is False for k in ('operatorInstaller', 'fullHandoffComplete', 'productionQualified'))
            and spec.get('physicalQualification') == spec.get('liveProviderQualification') == 'NOT_RUN' and spec.get('fundedWork') == 'DISABLED', 'Preview specification scope differs')
    require(all(type(spec['tests'].get(k)) is int and spec['tests'][k] >= n for k, n in {'module':55, 'native':4, 'installer':29, 'browser':2}.items()), 'Required preview gates reduced')
    archive_identity, observations = None, {}
    pins = load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node']
    for arch in ('x64', 'arm64'):
        folder = evidence / ('local-skills-preview-' + arch)
        archive = folder / 'local-preview' / spec['archive']
        observed = identity(archive)
        manifest, _ = INSTALL.inspect_archive(archive, observed['sha256'])
        require(manifest['commit'] == commit and manifest['workingTreeDirty'] is False, 'Archive source differs or is dirty')
        require(manifest['version'] == spec['version'] and manifest.get('operatorInstaller') is False and manifest['productionQualified'] is False, 'Archive scope differs')
        require(archive_identity is None or archive_identity == observed, 'Architecture packages differ')
        archive_identity = observed
        logs = folder / 'local-host-evidence'
        binding = load(logs / 'qualification.json')
        require(binding == {'commit': commit, 'workflowRun': run, 'architecture': arch, 'archiveSHA256': observed['sha256']}, 'Evidence source/run binding differs')
        counts = {name: tap(logs / (name + '.tap'), spec['tests'][scope]) for name, scope in
                  [('source', 'module'), ('extracted', 'module'), ('native-source', 'native'), ('native-archive', 'native')]}
        installer_file = logs / 'installer.log'
        require(installer_file.is_file() and not installer_file.is_symlink() and installer_file.stat().st_size < 8_000_000, 'Missing bounded installer log')
        installer = installer_file.read_text()
        require(len(re.findall(r'^Ran ' + str(spec['tests']['installer']) + r' tests? in ', installer, re.M)) == 1
                and re.search(r'^OK\s*$', installer, re.M) and not re.search(r'^FAILED|\bskipped=', installer, re.M), 'Installer acceptance differs')
        installed = load(logs / 'installed-journey.json')
        require(installed['archiveSHA256'] == observed['sha256'] and installed['platform'] == 'linux' and installed['arch'] == arch, 'Installed package identity differs')
        require(all(installed.get(k) is True for k in ('actualInstallation', 'actualIPC', 'actualSandbox', 'actualServiceRecovery', 'stableAssistantRestart', 'removalPreservedState', 'removalPreservedOutputs')),
                'Installed lifecycle acceptance incomplete')
        require(installed.get('restartPreservedReservations') == 2 and installed.get('oldGrantReplayed') is False
                and installed.get('provider') == 'none' and installed.get('independentReview') is False
                and installed.get('physical') == 'NOT_RUN' and installed.get('productionQualified') is False, 'Installed scope differs')
        pin = next(p for p in pins['archives'] if p['platform'] == 'linux-' + arch)
        require(installed['node']['archiveSHA256'] == pin['sha256'] and installed['node']['version'] == pins['preferredVersion'], 'Installed Node pin differs')
        for role in ROLES:
            gateway = load(logs / ('openclaw-' + role + '.json'))
            require(gateway.get('role') == role and gateway.get('openclaw') == '2026.9.5'
                    and all(gateway.get(k) is True for k in ('actualGateway', 'actualRuntime', 'actualSandbox', 'skillObserved', 'separateAuthorization', 'scopedActor')),
                    'Missing actual scoped Gateway path')
            require(gateway.get('providerTransport') == 'local-synthetic-fixture' and gateway.get('evidenceClass') == 'NATIVE_LOCAL_RUNTIME'
                    and gateway.get('offeredTools') == ['fleet_local'] and gateway.get('productionQualified') is False
                    and gateway.get('liveProviderJudgment') is False and gateway.get('independentReview') is False, 'Gateway qualification scope differs')
        observations[arch] = {'native': counts, 'installerTests': spec['tests']['installer'], 'installedJourney': 'PASS', 'gatewayRoles': list(ROLES)}
    browser = evidence / 'local-dashboard-observations'
    binding = load(browser / 'qualification.json')
    require(binding == {'commit': commit, 'workflowRun': run, 'evidenceClass': 'BROWSER_WITH_DECLARED_SYNTHETIC_WORKER'}, 'Browser source/run binding differs')
    browser_counts = tap(browser / 'browser.tap', spec['tests']['browser'])
    screenshots = {}
    for language in ('en', 'fr'):
        for size in ('desktop', 'mobile'):
            file = browser / (language + '-' + size + '.png')
            require(file.is_file() and not file.is_symlink() and 8 < file.stat().st_size < 5_000_000
                    and file.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n', 'Missing browser screenshot')
            screenshots[file.name] = sha(file)
    return {**spec, 'schema': 'agi-fleet/local-preview-audit/v1', 'status': 'PASS', 'commit': commit, 'workflowRun': run,
            'archive': archive_identity, 'architectures': observations, 'browser': browser_counts, 'screenshots': screenshots,
            'providerTransport': 'local-synthetic-fixture', 'independentEconomicReview': 'DISABLED', 'humanAccessibility': 'NOT_RUN'}


def bundle(evidence, output, commit, run):
    result = audit(evidence, commit, run)
    require(not output.exists(), 'Output must be absent')
    output.mkdir()
    shutil.copyfile(evidence / 'local-skills-preview-x64/local-preview' / result['archive']['name'], output / result['archive']['name'])
    write(output / 'local-audit.json', result)
    with zipfile.ZipFile(output / 'local-evidence.zip', 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for path in sorted(evidence.rglob('*')):
            require(not path.is_symlink(), 'Evidence links forbidden')
            if not path.is_file() or 'local-preview' in path.relative_to(evidence).parts:
                continue
            require(path.stat().st_size < LIMIT, 'Evidence member too large')
            info = zipfile.ZipInfo(path.relative_to(evidence).as_posix(), (2026, 10, 14, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            target.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    require((output / 'local-evidence.zip').stat().st_size < LIMIT, 'Evidence archive too large')
    print(json.dumps({'status': 'PASS', 'archive': result['archive'], 'scope': result['qualificationScope']}))


def validate_fleet(fleet, commit, run):
    sys.path.insert(0, str(ROOT / 'engineering'))
    publisher = module('fleet_preview_regression', ROOT / 'engineering/publish-next-release.py')
    specification = load(ROOT / 'engineering/next-release.json')
    manifest = load(fleet / f"Release-Manifest-v{specification['version']}.json")
    require(str(manifest.get('workflowRun')) == run and manifest.get('workflowCommit') == commit, 'Fleet workflow identity differs')
    publisher.validate(manifest, manifest['audit'], commit)
    artifact = fleet / manifest['evidence']['name']
    require(identity(artifact) == manifest['evidence'], 'Fleet evidence identity differs')
    return manifest


def notes(manifest, assets):
    commit, run = manifest['commit'], manifest['workflowRun']
    base = f'https://github.com/{REPOSITORY}/blob/{commit}/docs/local-skills/'
    text = ('## Local Skills — Linux development preview / Aperçu de développement Linux\n\n'
            'One installation, multiple separate actors, six portable skills and a bilingual local dashboard. '
            'Try a zero-model-cost offline report, inspect its real files, authorize internal checking, and preserve a SUCCESSOR capsule.\n\n'
            '**Development preview, not the completed Local Skills product or a production-qualified operator installer.** '
            'Linux x64 and ARM64 bounded offline paths are tested. Local browser/desktop execution, native Mac local execution, '
            'live-provider qualification, independent economic review and funded work remain unavailable. '
            'The full 22-case product acceptance matrix remains open. Physical, human-accessibility and endurance commissioning remain NOT_RUN.\n\n'
            '**Aperçu de développement, pas un produit Local Skills terminé ni qualifié pour la production.** '
            'Les parcours Linux x64/ARM64 hors ligne sont testés. Le bureau/navigateur local, le mode local Mac, '
            'les fournisseurs réels et le travail rémunéré ne sont pas qualifiés.\n\n'
            f'[Start here / Commencer ici]({base}DOWNLOAD.md) · [Install and recover]({base}INSTALL_AND_RECOVER.md) '
            f'· [Remaining requirements]({base}acceptance.json)\n\n'
            'Download the named ZIP and checksum file below; verify before extracting. GitHub’s automatic source archives '
            'omit the packaged dependencies. Node 24.21.0 is a separately downloaded, hash-pinned prerequisite; the guide lists both architectures. '
            'No installation starts work, connects a provider, enrolls a startup service or activates a wallet.\n\n'
            f'Exact source: `{commit}`. [Coordinated qualification](https://github.com/{REPOSITORY}/actions/runs/{run}). '
            'The evidence includes source/extracted tests, saved install/recovery, six real Gateway paths with synthetic model transport, '
            'EN/FR browser checks and the complete inherited Fleet regression audit. Existing Dedicated Fleet releases are unchanged.\n\n'
            '| Asset | Bytes | SHA-256 |\n| --- | ---: | --- |\n')
    return text + ''.join(f'| {p.name} | {p.stat().st_size:,} | `{sha(p)}` |\n' for p in assets) + '\n'


def publish_assets(api, spec, commit, assets, body):
    try:
        tag = api('/git/ref/tags/' + spec['tag'])
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        tag = api('/git/refs', method='POST', data=json.dumps({'ref': 'refs/tags/' + spec['tag'], 'sha': commit}).encode())
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Tag identity differs')
    try:
        release = api('/releases/tags/' + spec['tag'])
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        release = api('/releases', method='POST', data=json.dumps({'tag_name': spec['tag'], 'target_commitish': commit,
                      'name': spec['name'], 'body': body, 'draft': True, 'prerelease': True}).encode())
    require(release['prerelease'] is True and release['target_commitish'] == commit and release.get('body') == body, 'Existing release identity or notes differ')
    existing = {a['name']: a for a in release['assets']}
    require(set(existing) <= {p.name for p in assets}, 'Unexpected assets')
    for file in assets:
        record = identity(file)
        if file.name in existing:
            require(existing[file.name]['size'] == record['bytes'] and existing[file.name].get('digest') == 'sha256:' + record['sha256'], 'Existing asset differs; replacement forbidden')
        else:
            require(release['draft'], 'Published assets are immutable')
            api(f'/releases/{release["id"]}/assets?name=' + file.name, method='POST', data=file.read_bytes(), content_type='application/octet-stream', upload=True)
    observed = api(f'/releases/{release["id"]}')
    remote = {a['name']: a for a in observed['assets']}
    require(observed.get('body') == body and set(remote) == {p.name for p in assets}
            and all(remote[p.name]['size'] == p.stat().st_size and remote[p.name].get('digest') == 'sha256:' + sha(p) for p in assets), 'Remote assets or notes differ')
    tag = api('/git/ref/tags/' + spec['tag'])
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Tag changed before publication')
    if observed['draft']:
        observed = api(f'/releases/{release["id"]}', method='PATCH', data=json.dumps({'draft': False, 'prerelease': True, 'make_latest': 'false', 'body': body}).encode())
    require(observed['draft'] is False and observed['prerelease'] is True and observed.get('body') == body, 'Published classification or notes differ')
    tag = api('/git/ref/tags/' + spec['tag'])
    require(tag['object']['type'] == 'commit' and tag['object']['sha'] == commit, 'Published tag differs')
    return observed


def publish(evidence, fleet, output, commit, run):
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_EVENT_NAME') in ('push', 'workflow_dispatch'), 'Publication requires an authorized main workflow')
    local = audit(evidence, commit, run)
    regression = validate_fleet(fleet, commit, run)
    require(not output.exists(), 'Publication output must be absent')
    bundle(evidence, output, commit, run)
    archive = output / local['archive']['name']
    evidence_file = output / ('Local-Skills-Evidence-' + local['version'] + '.zip')
    with zipfile.ZipFile(evidence_file, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
        for name, data in [('local-evidence.zip', (output / 'local-evidence.zip').read_bytes()),
                           ('local-audit.json', (output / 'local-audit.json').read_bytes()),
                           ('fleet-regression-manifest.json', (fleet / f"Release-Manifest-v{regression['version']}.json").read_bytes()),
                           ('fleet-regression-evidence.zip', (fleet / regression['evidence']['name']).read_bytes())]:
            require(len(data) < LIMIT, 'Evidence member exceeds ceiling')
            info = zipfile.ZipInfo(name, (2026, 10, 14, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            target.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    manifest = {**local, 'schema': 'agi-fleet/local-published-preview/v1', 'evidence': identity(evidence_file),
                'fleetRegression': regression['audit'], 'nodePrerequisites': load(ROOT / 'fleet/shared/runtime/compute/runtime-artifacts.lock.json')['node']}
    manifest_file = output / ('Local-Skills-Manifest-' + local['version'] + '.json')
    write(manifest_file, manifest)
    assets = [archive, evidence_file, manifest_file]
    checksums = output / ('SHA256SUMS-local-' + local['version'] + '.txt')
    checksums.write_text(''.join(sha(p) + '  ' + p.name + '\n' for p in assets))
    body = notes(manifest, assets)
    assets.append(checksums)
    for file in assets:
        identity(file)
    sys.path.insert(0, str(ROOT / 'engineering'))
    transport = module('local_release_transport', ROOT / 'engineering/publish-qualified-release.py')
    api = lambda path, **kwargs: transport.api('/repos/' + REPOSITORY + path, os.environ['GH_TOKEN'], **kwargs)
    result = publish_assets(api, local, commit, assets, body)
    print(json.dumps({'status': 'PUBLISHED', 'url': result['html_url'], 'archive': local['archive'], 'productionQualified': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fleet', type=Path)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    commit, run = context()
    if args.publish:
        require(args.fleet is not None, 'Fleet qualification required')
        publish(args.evidence, args.fleet, args.output, commit, run)
    else:
        bundle(args.evidence, args.output, commit, run)
