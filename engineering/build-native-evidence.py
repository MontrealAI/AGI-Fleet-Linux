#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

from release_tools import LIMIT, ROOT, SHA256, extract, require, sha

ARTIFACTS = {
    'x64': {'id': 11659292213, 'bytes': 1073642, 'sha256': '365982a939335671ebefa657ae3073ce5fb4c89b8f7b84c83b107b86d192bd5f'},
    'arm64': {'id': 11659562690, 'bytes': 1074018, 'sha256': 'eb2f8a7f62719bfc168d27ac8c20c0c6fd73651f659a4114a7b0c0e856c1d698'},
}
RUN = '38022168787'
COMMIT = '30d337265e6ec459ed54d9572949a6d0d6980ff4'
NAME = 'Linux-Native-Evidence-v1.0.9.zip'


def build(artifacts, release, output):
    require(not output.exists(), 'Evidence output already exists')
    with tempfile.TemporaryDirectory(prefix='agi-evidence-audit-') as temporary:
        work = Path(temporary)
        for architecture, expected in ARTIFACTS.items():
            artifact = artifacts[architecture]
            require(artifact.stat().st_size == expected['bytes'] and sha(artifact) == expected['sha256'], 'Artifact identity differs')
            extract(artifact, work / architecture)
            runner = json.loads((work / architecture / 'runner.json').read_text())
            require(runner['architecture'] == architecture and runner['githubRunId'] == RUN
                    and runner['workflowCommit'] == COMMIT and runner['operatorAccountsUsed'] is False, 'Runner provenance differs')
        audit = work / 'native-evidence-audit.json'
        subprocess.run([sys.executable, str(ROOT / 'engineering/audit-linux-1.0.9-evidence.py'),
                        '--release', str(release), '--case-audit', str(ROOT / 'validation/original-native-case-ledger.json'),
                        '--run', str(work / 'x64'), '--run', str(work / 'arm64'), '--out', str(audit)], check=True)
        require(audit.read_bytes() == (ROOT / 'validation/capable-38022168787-audit.json').read_bytes(), 'Reproduced audit differs')
        paths = {f'artifacts/{a}.zip': p for a, p in artifacts.items()}
        paths.update({'native-evidence-audit.json': audit,
                      'audit-linux-1.0.9-evidence.py': ROOT / 'engineering/audit-linux-1.0.9-evidence.py',
                      'case-ledger.json': ROOT / 'validation/original-native-case-ledger.json',
                      'LINUX_1_0_9_NATIVE_ADDENDUM.md': ROOT / 'validation/LINUX_1_0_9_NATIVE_ADDENDUM.md'})
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, path in sorted(paths.items()):
                info = zipfile.ZipInfo(name, (2026, 10, 10, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        require(output.stat().st_size < LIMIT, 'Evidence bundle exceeds the download limit')
        return {'name': output.name, 'bytes': output.stat().st_size, 'sha256': sha(output),
                'releaseSHA256': SHA256, 'nativeAcceptance': 'PASS', 'verifiedTapLogs': 734}


def main():
    parser = argparse.ArgumentParser(description='Re-audit the original native artifacts and create a deterministic durable evidence bundle.')
    parser.add_argument('--x64', type=Path, required=True)
    parser.add_argument('--arm64', type=Path, required=True)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build({'x64': args.x64, 'arm64': args.arm64}, args.release, args.out), indent=2))


if __name__ == '__main__':
    main()
