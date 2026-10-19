"""Inspect the same-run saved package and bind every extracted regular file and mode."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import zipfile


def sha(raw): return hashlib.sha256(raw).hexdigest()

def inventory(root):
    rows=[]
    for file in sorted(root.rglob('*')):
        if file.is_symlink() or not (file.is_dir() or file.is_file()): raise ValueError('PACKAGE_NONREGULAR')
        if file.is_file():
            raw=file.read_bytes();rows.append({'name':file.relative_to(root).as_posix(),'bytes':len(raw),'sha256':sha(raw),'mode':stat.S_IMODE(file.stat().st_mode)})
    rows.sort(key=lambda row:row['name'].encode('utf-16-be'))
    return sha(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['extract','verify']);parser.add_argument('--archive',type=Path,required=True);parser.add_argument('--application',type=Path,required=True);parser.add_argument('--commit',required=True);parser.add_argument('--observation',type=Path,required=True)
    args=parser.parse_args();source=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('fleet_saved_package_installer',source/'local-runtime/install.py');installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
    raw=args.archive.read_bytes();manifest,prefix=installer.inspect_archive(args.archive,sha(raw));prefix+='/'
    if manifest['commit']!=args.commit or manifest['workingTreeDirty'] is not False:raise ValueError('PACKAGE_SOURCE_IDENTITY')
    if args.action=='extract':
        if args.application.exists():raise ValueError('PACKAGE_DESTINATION_EXISTS')
        args.application.mkdir(parents=True,mode=0o700)
        with zipfile.ZipFile(args.archive) as archive:
            for entry in archive.infolist():
                relative=entry.filename[len(prefix):] if entry.filename.startswith(prefix) else None
                if not relative or entry.is_dir():continue
                destination=args.application/relative;destination.parent.mkdir(parents=True,exist_ok=True)
                destination.write_bytes(archive.read(entry));destination.chmod(stat.S_IMODE(entry.external_attr>>16))
        value={'manifestSha256':sha((args.application/'local-preview-manifest.json').read_bytes()),'inventoryBeforeSha256':inventory(args.application),'inventoryAfterSha256':inventory(args.application),'unchanged':True}
        expected={record['path'] for record in manifest['files']}|{'local-preview-manifest.json'}
        if {file.relative_to(args.application).as_posix() for file in args.application.rglob('*') if file.is_file()}!=expected:raise ValueError('PACKAGE_INVENTORY_COVERAGE')
        args.observation.write_text(json.dumps(value,separators=(',',':'))+'\n')
    else:
        value=json.loads(args.observation.read_text());actual=inventory(args.application)
        if actual!=value['inventoryBeforeSha256']:raise ValueError('PACKAGE_CHANGED_DURING_SERVICE_JOURNEY')
        if sha((args.application/'local-preview-manifest.json').read_bytes())!=value['manifestSha256']:raise ValueError('PACKAGE_MANIFEST_CHANGED')
    print(json.dumps({'archiveSHA256':sha(raw),'package':value,'application':str(args.application)},separators=(',',':')))


if __name__=='__main__':main()
