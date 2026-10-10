#!/usr/bin/env python3
"""Create an isolated Mac developer source fixture; never modify an installation."""
import argparse
import html
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def populate(output, checked):
    shutil.copytree(ROOT / 'fleet', output, symlinks=False, ignore=shutil.ignore_patterns('__pycache__'))
    # Reuse the exact current shared Studio implementation before converting its
    # platform-specific onboarding through the reviewed Mac overlay.
    studio = ROOT / 'workstation/studio-overlay'
    for source in sorted(studio.rglob('*')):
        if source.is_symlink():
            raise ValueError('Unexpected Studio source symlink')
        if source.is_file():
            destination = output / source.relative_to(studio)
            if not destination.is_file():
                raise ValueError('Studio replacement source missing')
            shutil.copyfile(source, destination)
    version = json.loads((ROOT / 'macos/release.json').read_text())['version']
    load('mac_preview_runtime', ROOT / 'macos/runtime/apply.py').apply(output, version)
    applied = load('mac_preview_overlay', HERE / 'overlay.py').apply(output)
    (output / 'source-inventory.json').unlink(missing_ok=True)
    for app in [output, *(output / 'packages').glob('AGI_*')]:
        (app / 'release-manifest.json').unlink(missing_ok=True)
        (app / 'MANIFEST.sha256').unlink(missing_ok=True)
        note = json.loads((HERE / 'candidate.json').read_text())
        note.update(purpose='Disposable source preview; dependencies are not bundled. Not the Mac release ZIP or an operator distribution.',
                    materializedSourceBasis=checked['fleetSource'], previewSourceSha256=checked['sourceSha256'],
                    macRuntimeOverlayVersion=version, overlay=applied)
        (app / 'PREVIEW-NOT-A-RELEASE.json').write_text(json.dumps(note, indent=2) + '\n')
        shutil.copyfile(HERE / 'README.md', app / 'MAC-PREVIEW.md')
        shutil.copyfile(HERE / 'QUICKSTART.md', app / 'QUICKSTART.md')
        shutil.copyfile(HERE / 'STUDIO.md', app / 'STUDIO.md')
        for name in ('README.md', 'START_HERE.md'):
            shutil.copyfile(HERE / 'README.md', app / name)
        welcome = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mac source preview · AGI Fleet</title><style>body{font:20px/1.6 system-ui,sans-serif;color:#173334;background:#f4f7f2;max-width:850px;margin:5vh auto;padding:24px}a{color:#075654}h1{line-height:1.15;font-size:2.2rem}nav a{display:inline-block;padding:14px 20px;border:2px solid #075654;border-radius:12px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}strong{color:#7d3700}</style><main><p>AGI FLEET · APPLE SILICON</p><h1>Explore the Mac workspace preview</h1><p><strong>Source preview. Outside the Mac release ZIP. Production native execution is disabled; no release qualification is inherited.</strong></p><nav aria-label="Preview guides"><a href="MAC-PREVIEW.md">Read the preview guide</a><a href="QUICKSTART.md">Native Mac setup</a><a href="STUDIO.md">Public Studio setup</a></nav><p>Use separate test accounts. Keep signing keys and personal logins out of the native task account. All physical gates remain NOT_RUN.</p><pre>''' + html.escape((HERE / 'README.md').read_text()) + '</pre></main></html>\n'
        for name in ('START_HERE.html', 'README.html'):
            (app / name).write_text(welcome)
        (app / 'READ_ME_FIRST.txt').write_text('MAC SOURCE PREVIEW — NOT AN OPERATOR DISTRIBUTION\nOpen START_HERE.html. Native production execution is disabled. Physical checks: NOT_RUN.\n')


def materialize(output):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(ROOT):
        raise ValueError('Choose a new output directory outside the repository')
    checked = load('mac_preview_check', HERE / 'check.py').check()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Failed overlays never leave a source tree carrying inherited release
    # labels at the requested destination. Only this invocation's scratch is
    # removed; existing installations are never cleanup targets.
    with tempfile.TemporaryDirectory(prefix='agi-mac-preview-build-', dir=output.parent) as temporary:
        staging = Path(temporary) / 'candidate'
        populate(staging, checked)
        if output.exists() or output.is_symlink():
            raise ValueError('Output appeared during materialization; preserved')
        staging.rename(output)
    print(json.dumps({'output': str(output), 'sourceSha256': checked['sourceSha256'], 'classification': 'DEVELOPMENT_PREVIEW',
                      'productionQualified': False, 'productionExecution': 'DISABLED', 'qualificationInherited': False}))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    materialize(parser.parse_args().output)
