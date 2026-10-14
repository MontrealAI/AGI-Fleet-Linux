#!/usr/bin/env python3
"""Prepare only the reviewed 1.1.1 maintenance source. No installation/publication."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys

BASE_TREE = '9cde3e1ce5dc0ec5a34862c7d31b671559f42811'
OLD, NEW = '1.1.0', '1.1.1'
NOTES = '''# Linux 1.1.1 — clearer setup and verified release instructions

This is an additive maintenance qualification candidate for the existing SUCCESSOR Ω + Fleet system. It includes the English and French starting guides, clearer platform and preview choices, and corrected publication of release instructions. It does not include unfinished Local Skills PR #26.

## Start with the right journey

Open the [English starting guide](START_HERE.md) or [guide de démarrage en français](COMMENCER_ICI.md). Choose the free offline Builder, a dedicated Linux installer, the separate Mac distribution, or an explicitly labelled development preview. The seven Linux editions now link to both starting guides from their welcome pages.

The [fresh-install guide](FRESH_INSTALL.md), [troubleshooting](TROUBLESHOOTING.md) and blank [physical qualification ledger](PHYSICAL_QUALIFICATION.md) use the 1.1.1 archive identity. Download the installer and its checksums from the same publication. GitHub's automatic source ZIP and CI review-source ZIP are not installers.

## Corrected release-note publication

Public guide links resolve against the source Markdown and name the exact reviewed commit. Offline guides are retained. Missing or escaping local destinations stop preparation. The publisher regenerates canonical notes from the reviewed source and exact asset identities, refuses altered notes, sends that canonical body in the same request that publishes the draft, and verifies the returned body. Dedicated regressions cover concurrent draft edits and unexpected publication responses.

Per-commit review and qualification runs retain their own evidence without cancelling prior PR revisions. The existing main publication lock, exact-archive checks and write permissions remain bounded to their original roles.

## What remains unchanged

Execution logic, contracts, dependencies, signer/compute separation, STOP, recovery, budgets and paid-intake policies are unchanged. The vendored Builder and integration target remain AGIJobManager 1.16.1 at `09d89fb22d52a8df194e8dd0a00beff9f7771d82`. Linux package labels and source inventories are regenerated for this distinct release; prior release assets and historical observations are not overwritten or relabelled. Mac 1.20.2 is unchanged and needs its own platform qualification.

The [Builder guide](../successor/docs/GUIDE.md), [architecture](../successor/docs/ARCHITECTURE.md) and [acceptance map](../successor/docs/ACCEPTANCE.md) retain the same execution, separately authorized review, capsule inspection, explicit version selection, offline recovery and rerun journey.

## Qualification boundary

Publication requires fresh checks of this saved 1.1.1 archive: 291 targeted and 3,908 complete native cases on each of x86-64 and ARM64; the pinned Manager integration on both architectures; the saved-archive browser journey; and the source/log/asset-bound evidence audit. These are required gates, not observations imported from 1.1.0. The manifest and evidence attached to a successfully published release report the actual results and exact workflow commit.

**Qualification prerelease only; `productionQualified: false`.** Physical installation, real provider/OAuth participation and costs, independently administered operation, human usability and endurance remain unobserved unless separately recorded. Browser qualification uses its declared engineering provider/sandbox fixtures. Keep funded work disabled while operating qualification and the recorded intake HOLD remain open. This release grants no execution, signing or payment authority.
'''


def load(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def replace(path, before, after, required=True):
    text = path.read_text()
    if required and before not in text:
        raise ValueError('Expected source not found in ' + str(path) + ': ' + before)
    path.write_text(text.replace(before, after))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args(); root = args.root.resolve(strict=True)
    run = lambda *command: subprocess.check_output(command, cwd=root, text=True).strip()
    if run('git', 'rev-parse', 'HEAD^{tree}') != BASE_TREE or run('git', 'status', '--porcelain'):
        raise ValueError('Preparation requires the clean exact reviewed PR29 source tree')
    fleet = root / 'fleet'
    registry = load(fleet / 'config/role-registry.json')
    editions = [fleet] + [fleet / 'packages' / r['package'] for r in registry['roles'].values()]
    versions = {role: NEW for role in ['fleet', *registry['roles']]}
    for app in editions:
        for name in ('package.json', 'package-lock.json'):
            path = app / name; value = load(path)
            if value['version'] != OLD:
                raise ValueError('Unexpected original package version: ' + str(path))
            value['version'] = NEW
            if name == 'package-lock.json':
                value['packages']['']['version'] = NEW
            write(path, value)
        path = app / 'config/companion-releases.json'; value = load(path)
        if any(value[role] != OLD for role in versions):
            raise ValueError('Unexpected original companion versions')
        value.update(versions); write(path, value)
        path = app / 'config/role-registry.json'
        if path.exists():
            value = load(path); value['fleet'] = NEW
            for role in value['roles'].values(): role['version'] = NEW
            write(path, value)
        for path in app.glob('*.app/Contents/Info.plist'):
            value = plistlib.loads(path.read_bytes())
            value['CFBundleShortVersionString'] = value['CFBundleVersion'] = NEW
            path.write_bytes(plistlib.dumps(value, sort_keys=False))
        for relative in ('app/index.html', 'web/index.html'):
            path = app / relative
            if path.exists():
                text = path.read_text().replace('blob/v1.1.0-qualification/docs/FRESH_INSTALL.md', 'blob/v1.1.1-qualification/docs/FRESH_INSTALL.md')
                text = re.sub(r'((?:id="appVersion"|data-app-version)>)[^<]+', lambda m: m[1] + NEW, text)
                path.write_text(text)
    path = root / 'engineering/next-release.json'; value = load(path)
    value.update(version=NEW, tag='v'+NEW+'-qualification', prefix='AGI_Fleet_Linux_v'+NEW,
                 name='AGI_Fleet_Linux_v'+NEW+'.zip', sourceDateEpoch=int(datetime(2026,10,14,tzinfo=timezone.utc).timestamp()))
    write(path, value)
    for relative in ('.github/workflows/next-release.yml', 'engineering/publish-next-release.py',
                     'engineering/tests/test_next_publication.py', 'engineering/tests/test_publication_note_race.py',
                     'docs/FRESH_INSTALL.md', 'docs/TROUBLESHOOTING.md', 'docs/PHYSICAL_QUALIFICATION.md',
                     'docs/DEVELOPMENT.md', 'engineering/README.md'):
        replace(root / relative, OLD, NEW)
    for relative in ('engineering/publish-next-release.py', 'engineering/tests/test_next_publication.py', 'docs/DEVELOPMENT.md'):
        replace(root / relative, 'RELEASE_NOTES_1_1_0.md', 'RELEASE_NOTES_1_1_1.md')
    replace(root / 'engineering/check-successor-preservation.py', 'distinct 1.1.0 candidate', 'distinct current Linux candidate')
    path = root / 'docs/physical-qualification-template.json'; value = load(path)
    if value['releaseSHA256'] or value['productionQualified'] or any(g['status']!='NOT_RUN' for g in value['gates'].values()):
        raise ValueError('Blank qualification ledger contains observations')
    value['release'] = NEW; write(path, value)
    (root / 'docs/RELEASE_NOTES_1_1_1.md').write_text(NOTES)
    replace(root / 'engineering/build-next-release.py', '## Build your SUCCESSOR Ω\n', '## Choose your first step\n\n[English starting guide](docs/linux-current/docs/START_HERE.html) · [Commencer en français](docs/linux-current/docs/COMMENCER_ICI.html)\n\n## Build your SUCCESSOR Ω\n')
    replace(root / 'README.md', '# AGI Fleet · Linux & Apple silicon Mac\n', '# AGI Fleet · Linux & Apple silicon Mac\n\n**Linux 1.1.1 maintenance candidate:** clearer English/French starting guides and verified release instructions. [Scope and qualification requirements](docs/RELEASE_NOTES_1_1_1.md). Install this version only after its [distinct release page](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.1-qualification) contains the verified installer, checksums and passing manifest. Earlier publication records below remain historical and do not qualify 1.1.1.\n')
    for relative in ('docs/START_HERE.md', 'docs/COMMENCER_ICI.md'):
        replace(root / relative, OLD, NEW)
    path = root / 'docs/START_HERE.md'
    replace(path, 'Use the published Linux **1.1.1 qualification prerelease**, then record your own machine\'s readiness.', 'Use Linux **1.1.1**, a qualification candidate, only after its distinct release is published with passing evidence. Then record your own machine\'s readiness.')
    replace(path, "The Linux and Mac release labels above reflect the published manifests at this documentation checkpoint. A newer source commit does not silently replace those downloads.", "This Linux guide targets the distinct 1.1.1 candidate: require its published passing manifest before installation. [Linux 1.1.0](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.0-qualification) remains a separate historical release; its evidence does not qualify 1.1.1. Mac 1.20.2 is unchanged.")
    path = root / 'docs/COMMENCER_ICI.md'
    replace(path, 'Utilisez la **préversion de qualification Linux 1.1.1** publiée, puis consignez l\'état de préparation de votre propre machine.', 'Utilisez **Linux 1.1.1**, une version candidate, seulement après sa publication distincte avec des preuves réussies. Consignez ensuite l\'état de préparation de votre machine.')
    replace(path, 'Les versions ci-dessus correspondent aux manifestes publiés à ce point de documentation. Une nouvelle révision des sources ne remplace pas silencieusement ces téléchargements.', 'Ce guide Linux vise la version candidate 1.1.1 : exigez son manifeste publié et réussi avant toute installation. [Linux 1.1.0](https://github.com/MontrealAI/AGI-Fleet-Linux/releases/tag/v1.1.0-qualification) reste une publication historique distincte; ses preuves ne qualifient pas 1.1.1. Mac 1.20.2 reste inchangé.')
    path = root / 'engineering/tests/test_start_guides.py'
    replace(path, 'test_guides_match_the_published_platform_versions', 'test_guides_match_the_linux_candidate_and_published_mac_versions')
    replace(path, "ROOT / 'engineering/published-release.json'", "ROOT / 'engineering/next-release.json'")
    subprocess.run([sys.executable, 'engineering/refresh-successor-source.py'], cwd=root, check=True)
    changed = run('git','diff','--name-only').splitlines()
    if any(p.startswith(('macos/','validation/','workstation/','successor/')) for p in changed):
        raise ValueError('Preparation changed an excluded platform or historical scope')
    if any(p.endswith(('.mjs','.js','.sol')) for p in changed):
        raise ValueError('A maintenance release must not change runtime, contract or test JS')
    for command in ([sys.executable,'engineering/check-repository.py','--require-source'],
                    [sys.executable,'engineering/check-successor-preservation.py'],
                    [sys.executable,'-m','unittest','discover','-s','engineering/tests','-v']):
        subprocess.run(command,cwd=root,check=True)
    subprocess.run(['git','add','-A'],cwd=root,check=True)
    tree = run('git','write-tree')
    print(json.dumps({'status':'PREPARED_SOURCE_ONLY','tree':tree,'version':NEW,'productionQualified':False,'releasePublished':False}))


if __name__ == '__main__':
    main()
