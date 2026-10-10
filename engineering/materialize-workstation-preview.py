#!/usr/bin/env python3
"""Create a disposable source fixture for preview development, never a release."""
import argparse
import json
from pathlib import Path
import shutil

from release_tools import ROOT, require, verify_source


def materialize(output):
    output = Path(output).absolute()
    require(not output.exists() and not output.is_symlink(), 'Output must not exist')
    require(not output.is_relative_to(ROOT), 'Use a directory outside the repository')
    verify_source(ROOT / 'fleet')
    shutil.copytree(ROOT / 'fleet', output, symlinks=False)
    engine = ROOT / 'workstation/engine'
    for directory in [output / 'workforce', *(output / 'packages').glob('*/workforce')]:
        shutil.copytree(engine, directory, dirs_exist_ok=True)
    overlay = ROOT / 'workstation/studio-overlay'
    if overlay.exists():
        for source in sorted(overlay.rglob('*')):
            require(not source.is_symlink(), 'Preview overlay must not contain symlinks')
            if source.is_file():
                relative = source.relative_to(overlay)
                destination = output / relative
                require(destination.is_file(), f'Overlay must replace an existing source: {relative}')
                shutil.copyfile(source, destination)
    # This source fixture is no longer the inventoried baseline. Remove the root
    # inventory instead of leaving a stale release identity for tooling to trust.
    (output / 'source-inventory.json').unlink(missing_ok=True)
    note = json.loads((ROOT / 'workstation/candidate.json').read_text())
    note['purpose'] = 'Disposable source fixture. No bundled dependencies. Not an operator distribution.'
    (output / 'PREVIEW-NOT-A-RELEASE.json').write_text(json.dumps(note, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'classification': note['classification'], 'productionQualified': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    materialize(parser.parse_args().output)
