#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

from release_tools import ASSET, PREFIX, SHA256, SIZE, URL, download, extract, verify_archive, verify_source


def main():
    parser = argparse.ArgumentParser(description='Verify and unpack the frozen Linux release without installing services or opening a wallet.')
    parser.add_argument('--archive', type=Path, help='Use an already downloaded ZIP instead of the pinned HTTPS download')
    parser.add_argument('--output', type=Path, required=True, help='Absent directory under an existing canonical parent')
    parser.add_argument('--source-only', action='store_true', help='Extract the exact inventoried source without dependencies or historical evidence')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='agi-release-download-') as temporary:
        archive = args.archive or Path(temporary) / ASSET
        if args.archive is None:
            download(URL, archive, SHA256, SIZE)
        verification = verify_archive(archive)
        selection = None
        if args.source_only:
            with zipfile.ZipFile(archive) as source:
                inventory = json.loads(source.read(PREFIX + '/source-inventory.json'))
            selection = {PREFIX + '/' + row['path'] for row in inventory['files']} | {PREFIX + '/source-inventory.json'}
        extract(archive, args.output.absolute(), selection)
        if args.source_only:
            verification['sourceMirror'] = verify_source(args.output / PREFIX)
        verification['directory'] = str((args.output / PREFIX).absolute())
        verification['sourceOnly'] = args.source_only
        print(json.dumps(verification, indent=2))


if __name__ == '__main__':
    main()
