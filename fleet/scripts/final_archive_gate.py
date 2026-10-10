"""Mandatory final ZIP executable gate shared by all seven release packagers."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_FILE_BYTES = 450_000_000


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_final_archive(archive, scripts=None, node='node'):
    archive = Path(archive).resolve(strict=True)
    scripts = Path(scripts or Path(__file__).parent).resolve()
    node = shutil.which(str(node))
    require(node is not None, 'Node runtime not found')
    node = str(Path(node).resolve(strict=True))
    output = archive.parent / (archive.stem + '-checks')
    require(not output.exists(), 'Use a new archive/evidence destination: ' + str(output))
    output.mkdir()
    report = {'schema': 'agi-final-archive-gate/v1', 'archive': archive.name,
              'sha256': digest(archive), 'bytes': archive.stat().st_size,
              'maximumFileBytes': MAX_FILE_BYTES, 'status': 'FAIL',
              'physicalMacQualification': 'NOT_RUN', 'platform': sys.platform}
    try:
        require(report['bytes'] < MAX_FILE_BYTES, 'Archive exceeds or equals the 450,000,000-byte ceiling')
        with tempfile.TemporaryDirectory(prefix='agi-final-extracted-') as temporary:
            destination = Path(temporary)
            identities = {}
            with zipfile.ZipFile(archive) as source:
                entries = source.infolist()
                names = [entry.filename for entry in entries]
                require(len(names) == len(set(names)) == len({name.casefold() for name in names}), 'Duplicate archive paths')
                roots = {name.split('/')[0] for name in names}
                require(len(roots) == 1, 'Archive must have exactly one root')
                for entry in entries:
                    parts = entry.filename.split('/')
                    require(not entry.is_dir() and all(part not in ('', '.', '..') for part in parts)
                            and not entry.filename.startswith('/') and '\\' not in entry.filename,
                            'Unsafe archive path: ' + entry.filename)
                    mode = entry.external_attr >> 16
                    require(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'Archive links/special files are forbidden')
                    require(entry.file_size < MAX_FILE_BYTES, 'Archive member exceeds file size ceiling')
                    target = destination / entry.filename
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(entry) as src, target.open('xb') as dst:
                        shutil.copyfileobj(src, dst)
                    target.chmod(0o755 if mode & 0o111 else 0o644)
                    identities[entry.filename] = (digest(target), bool(mode & 0o111))
                root = destination / next(iter(roots))
                report['extractedFiles'] = len(identities)
                report['freshExtraction'] = True
                report['allArchiveCRCsVerified'] = True
            shell_records = []
            for file in sorted(root.rglob('*')):
                if not file.is_file():
                    continue
                with file.open('rb') as header_stream:
                    header = header_stream.readline(256).strip()
                shell = 'bash' if header.endswith(b'/bash') or header.endswith(b'env bash') else 'sh' if header.endswith(b'/sh') or header.endswith(b'env sh') else None
                if shell:
                    checked = subprocess.run([shell, '-n', str(file)], text=True, capture_output=True)
                    shell_records.append({'path': file.relative_to(root).as_posix(), 'shell': shell,
                                          'exitCode': checked.returncode, 'stderr': checked.stderr})
            (output / 'shell-syntax.json').write_text(json.dumps(shell_records, indent=2) + '\n')
            report['shellSyntax'] = {'files': len(shell_records), 'fail': sum(row['exitCode'] != 0 for row in shell_records)}
            require(report['shellSyntax']['fail'] == 0, 'Final extracted shell parser failed')
            environment = {key: value for key, value in os.environ.items() if key not in {'NODE_OPTIONS', 'NODE_PATH'}}
            executable_report = output / 'executables.json'
            result = subprocess.run([sys.executable, str(scripts / 'validate-executables.py'),
                                     '--root', str(root), '--output', str(executable_report),
                                     '--node', str(node), '--jobs', '4'], text=True, capture_output=True, env=environment)
            (output / 'executables.log').write_text(result.stdout + result.stderr)
            report['executables'] = json.loads(executable_report.read_text())
            report['executables'].pop('files', None)
            report['executableEvidence'] = 'executables.json'
            require(result.returncode == 0 and report['executables']['status'] == 'PASS', 'Final extracted JS executable gate failed')
            launcher_directory = output / 'launchers'
            result = subprocess.run([sys.executable, str(scripts / 'smoke-native-launchers.py'),
                                     '--root', str(root), '--output', str(launcher_directory),
                                     '--node', str(node)], text=True, capture_output=True, env=environment)
            (output / 'launchers.log').write_text(result.stdout + result.stderr)
            launcher_report = json.loads((launcher_directory / 'launcher-smoke.json').read_text())
            report['launcherEvidence'] = 'launchers/launcher-smoke.json'
            report['launchers'] = {key: value for key, value in launcher_report.items()
                                   if key in ('status', 'summary', 'environment', 'platform', 'physicalMacQualification')}
            require(result.returncode == 0 and launcher_report.get('status') == 'PASS', 'Final extracted launcher gate failed')
            observed = {file.relative_to(destination).as_posix(): (digest(file), bool(file.stat().st_mode & 0o111))
                        for file in destination.rglob('*') if file.is_file()}
            require(observed == identities, 'Launcher smoke changed packaged files or added files to the extraction')
            report['extractedBytesAndModesUnchangedAfterTests'] = True
        require(digest(archive) == report['sha256'], 'Archive changed during final verification')
        report['status'] = 'PASS_PACKAGED_EXECUTABLES_AND_LINUX_LAUNCHER_SMOKE'
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (output / 'final-gate.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
