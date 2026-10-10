#!/usr/bin/env python3
"""Build the public Pages documentation from the reviewed release manifest."""
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'website'
OUTPUT = ROOT / '_site'
REPO = 'https://github.com/MontrealAI/AGI-Fleet-Linux'


def build():
    release = json.loads((ROOT / 'engineering/current-release.json').read_text())
    version, tag, name = (release[key] for key in ('version', 'tag', 'name'))
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Release version must be an explicit semantic version')
    if not re.fullmatch(r'[A-Za-z0-9._-]+', tag) or not re.fullmatch(r'[A-Za-z0-9._-]+\.zip', name):
        raise ValueError('Unsafe release tag or archive name')
    if not re.fullmatch(r'[0-9a-f]{64}', release['sha256']):
        raise ValueError('Release SHA-256 is invalid')
    if not isinstance(release['bytes'], int) or not 0 < release['bytes'] < 450_000_000:
        raise ValueError('Release archive must be positive and below 450 MB')
    physical = release['physicalQualification']
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
    if production and (not complete or release['nativeAcceptance'] != 'PASS' or release['jobIntegration']['status'] != 'PASS'):
        raise ValueError('Production label contradicts recorded qualification evidence')
    audit = Path(release['nativeAudit']['path'])
    if audit.is_absolute() or '..' in audit.parts or not (ROOT / audit).is_file():
        raise ValueError('Native audit must reference an existing repository file')
    if hashlib.sha256((ROOT / audit).read_bytes()).hexdigest() != release['nativeAudit']['sha256']:
        raise ValueError('Native audit digest does not match release metadata')
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
        'NATIVE': release['nativeAcceptance'], 'INTEGRATION': release['jobIntegration']['status'],
        'NATIVE_AUDIT_URL': f'{REPO}/blob/main/{audit.as_posix()}',
        'PHYSICAL_EN': 'Recorded' if complete else ('Not run' if all_not_run else 'Incomplete'),
        'PHYSICAL_FR': 'Consignée' if complete else ('Non réalisée' if all_not_run else 'Incomplète'),
        'PHYSICAL_COUNT_EN': f'{passed} of {len(physical)} manifest gates have recorded PASS.',
        'PHYSICAL_COUNT_FR': f'{passed} des {len(physical)} critères du manifeste ont un résultat PASS consigné.',
        'PRODUCTION_EN': 'recorded in the manifest' if production else 'not complete',
        'PRODUCTION_FR': 'consignée dans le manifeste' if production else 'non terminée',
    }
    if tokens['NATIVE'] not in known or tokens['INTEGRATION'] not in known:
        raise ValueError('Unknown qualification status requires review')
    if OUTPUT.is_symlink():
        raise ValueError('Output must not be a symlink')
    OUTPUT.mkdir(exist_ok=True)
    files = ['index.html', 'fr.html', 'styles.css', 'app.js', 'favicon.svg']
    for name in files + ['release.json', '.nojekyll']:
        destination = OUTPUT / name
        if destination.is_symlink() or (destination.exists() and (not destination.is_file() or destination.stat().st_nlink != 1)):
            raise ValueError('Website output must be a regular file without links')
    for name in files:
        source = SOURCE / name
        if source.is_symlink():
            raise ValueError('Website input must not be a symlink')
        contents = source.read_text(encoding='utf-8')
        if source.suffix == '.html':
            contents = re.sub(r'@@([A-Z][A-Z0-9_]+)@@', lambda match: html.escape(str(tokens[match[1]]), quote=True), contents)
        if '@@' in contents:
            raise ValueError(f'Unresolved template token in {name}')
        destination = OUTPUT / name
        if destination.is_symlink():
            raise ValueError('Website output must not be a symlink')
        destination.write_text(contents, encoding='utf-8')
    (OUTPUT / 'release.json').write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
    (OUTPUT / '.nojekyll').write_text('', encoding='utf-8')
    print(f'Built EN/FR GitHub Pages site for Linux {version} in {OUTPUT}')


if __name__ == '__main__':
    build()
