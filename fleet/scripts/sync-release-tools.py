"""Keep mandatory final-archive gates byte-identical across all role packagers."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = args.root.resolve()
registry = json.loads((root / 'config/role-registry.json').read_text())['roles']
names = ('final_archive_gate.py', 'validate-executables.py', 'smoke-native-launchers.py', 'update-signer.mjs')
result = {}
for role, contract in registry.items():
    hashes = {}
    for name in names:
        source = root / 'scripts' / name
        target = root / 'packages' / contract['package'] / 'scripts' / name
        if not args.check:
            shutil.copyfile(source, target)
            target.chmod(source.stat().st_mode & 0o777)
        if not target.is_file() or target.is_symlink() or target.read_bytes() != source.read_bytes():
            raise SystemExit('Final archive gate divergence: ' + role + '/' + name)
        hashes[name] = hashlib.sha256(source.read_bytes()).hexdigest()
    result[role] = hashes
    for relative in ('Update-Signer.command', 'Verify-Package.command', 'docs/IN_PLACE_UPDATE.md'):
        source = root / relative
        target = root / 'packages' / contract['package'] / relative
        if not args.check:
            shutil.copyfile(source, target)
            target.chmod(source.stat().st_mode & 0o777)
        if not target.is_file() or target.is_symlink() or target.read_bytes() != source.read_bytes():
            raise SystemExit('Signer updater divergence: ' + role + '/' + relative)
print(json.dumps({'status': 'PASS', 'roles': result}, indent=2))
