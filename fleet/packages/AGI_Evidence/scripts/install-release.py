#!/usr/bin/env python3
"""Verify one release ZIP, extract privately, verify all inventories, publish atomically."""
import argparse, ctypes, errno, hashlib, json, os, re, shutil, stat, sys, tempfile, zipfile
from pathlib import Path, PurePosixPath
MAX_ARCHIVE=1024**3
MAX_EXPANDED=2*1024**3
MAX_ENTRIES=50000

def fail(code):
    raise ValueError(code)

def digest_file(file):
    h=hashlib.sha256()
    for block in iter(lambda:file.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def publish(stage,destination):
    # No merge, overwrite, or check-then-rename race, including an empty destination.
    libc=ctypes.CDLL(None,use_errno=True)
    if sys.platform=='darwin':
        result=libc.renamex_np(os.fsencode(stage),os.fsencode(destination),4) # RENAME_EXCL
    elif sys.platform.startswith('linux') and hasattr(libc,'renameat2'):
        result=libc.renameat2(-100,os.fsencode(stage),-100,os.fsencode(destination),1) # RENAME_NOREPLACE
    else:fail('ATOMIC_NO_REPLACE_UNAVAILABLE')
    if result:raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))

def inventories(folder):
    apps=[folder]
    config=folder/'config/companion-releases.json'
    edition=json.loads(config.read_text()).get('role') if config.exists() else 'fleet'
    registry=folder/'config/role-registry.json'
    if edition=='fleet':
        roles=json.loads(registry.read_text())['roles'] if registry.exists() else {'agent':{'package':'AGI_Agent'},'node':{'package':'AGI_Node'}}
        expected={'agent':'AGI_Agent','node':'AGI_Node','moderator':'AGI_Moderator','employer':'AGI_Employer','evidence':'AGI_Evidence','recovery':'AGI_Recovery'}
        if not isinstance(roles,dict) or not roles or any(role not in expected or not isinstance(c,dict) or c.get('package')!=expected[role] for role,c in roles.items()):fail('ROLE_REGISTRY_INVALID')
        apps += [folder/'packages'/c['package'] for c in roles.values()]
    for app in apps:
        manifest=app/'MANIFEST.sha256'
        if not manifest.is_file():fail('MANIFEST_MISSING')
        seen=set()
        for line in manifest.read_text(encoding='utf-8').splitlines():
            if not re.fullmatch(r'[a-f0-9]{64}  .+',line):fail('MANIFEST_FORMAT')
            expected,name=line.split('  ',1);parts=PurePosixPath(name).parts
            if not parts or name.startswith('/') or '\\' in name or any(x in ('..','.') for x in parts) or name in seen:fail('MANIFEST_PATH')
            seen.add(name);p=app/name
            if not p.is_file() or p.is_symlink():fail('MANIFEST_FILE_MISSING')
            with p.open('rb') as f:
                if digest_file(f)!=expected:fail('MANIFEST_HASH_MISMATCH')
        actual={p.relative_to(app).as_posix() for p in app.rglob('*') if p.is_file() and p!=manifest}
        if seen!=actual:fail('MANIFEST_COVERAGE_MISMATCH')

def install(archive,parent,expected_sha,expected_bytes=None):
    if not re.fullmatch('[a-fA-F0-9]{64}',expected_sha):fail('TRUSTED_SHA256_REQUIRED')
    parent=Path(parent).expanduser()
    s=parent.lstat()
    if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or s.st_uid!=os.getuid():fail('DESTINATION_MUST_BE_OWNED_DIRECTORY')
    if not s.st_mode&stat.S_IWUSR or not os.access(parent,os.W_OK|os.X_OK):fail('DESTINATION_NOT_WRITABLE')
    parent=parent.resolve()
    fd=os.open(Path(archive).expanduser(),os.O_RDONLY|os.O_NOFOLLOW)
    stage=None;lock=None
    try:
        with os.fdopen(fd,'rb') as source:
            info=os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid():fail('ARCHIVE_MUST_BE_OWNED_REGULAR_FILE')
            if info.st_size<=0 or info.st_size>MAX_ARCHIVE or expected_bytes is not None and info.st_size!=expected_bytes:fail('ARCHIVE_SIZE_MISMATCH')
            actual_sha=digest_file(source)
            if actual_sha!=expected_sha.lower():fail('ARCHIVE_SHA256_MISMATCH')
            source.seek(0)
            with zipfile.ZipFile(source) as z:
                entries=z.infolist()
                if not entries or len(entries)>MAX_ENTRIES:fail('ARCHIVE_ENTRY_LIMIT')
                names=set();folded=set();roots=set();total=0
                for item in entries:
                    name=item.filename;parts=PurePosixPath(name).parts;mode=item.external_attr>>16
                    if not parts or name.startswith('/') or '\\' in name or '\x00' in name or any(x in ('..','.') for x in name.split('/')):fail('ARCHIVE_PATH_UNSAFE')
                    if name in names or name.casefold() in folded:fail('ARCHIVE_DUPLICATE_PATH')
                    if stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR) or stat.S_ISLNK(mode):fail('ARCHIVE_LINK_OR_SPECIAL_FILE')
                    if item.flag_bits&1:fail('ARCHIVE_ENCRYPTED')
                    if item.file_size>128*1024**2:fail('ARCHIVE_MEMBER_LIMIT')
                    total+=item.file_size
                    if total>MAX_EXPANDED:fail('ARCHIVE_EXPANSION_LIMIT')
                    names.add(name);folded.add(name.casefold());roots.add(parts[0])
                if len(roots)!=1:fail('ARCHIVE_SINGLE_RELEASE_REQUIRED')
                top=roots.pop()
                if not re.fullmatch(r'AGI_Autonomous_Fleet_v\d+\.\d+\.\d+',top):fail('ARCHIVE_RELEASE_NAME')
                if shutil.disk_usage(parent).free<total+256*1024**2:fail('DISK_SPACE_REQUIRED')
                destination=parent/top
                if destination.exists() or destination.is_symlink():fail('RELEASE_ALREADY_EXISTS_USE_A_NEW_PARENT')
                lock=parent/('.'+top+'.install-lock')
                try:lock.mkdir(mode=0o700)
                except FileExistsError:lock=None;fail('ANOTHER_EXTRACTION_OR_INTERRUPTED_LOCK')
                stage=Path(tempfile.mkdtemp(prefix='.'+top+'.staging-',dir=parent))
                for item in entries:
                    target=stage/item.filename
                    if item.is_dir():target.mkdir(parents=True,exist_ok=True,mode=0o700);continue
                    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    with z.open(item) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
                    if target.stat().st_size!=item.file_size:fail('ARCHIVE_TRUNCATED')
                    target.chmod(0o755 if item.external_attr>>16&0o111 else 0o644)
                extracted=stage/top
                version=json.loads((extracted/'package.json').read_text())['version']
                if top!='AGI_Autonomous_Fleet_v'+version:fail('RELEASE_VERSION_MISMATCH')
                inventories(extracted)
                publish(extracted,destination)
                return {'schema':'agi-release-extraction/v1','destination':str(destination),'sha256':actual_sha,'bytes':info.st_size,'files':len([x for x in entries if not x.is_dir()]),'allManifestsVerified':True,'existingReleasesChanged':False}
    finally:
        if stage is not None:shutil.rmtree(stage,ignore_errors=True)
        if lock is not None:lock.rmdir()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--zip',required=True);p.add_argument('--parent',required=True);p.add_argument('--sha256',required=True);p.add_argument('--bytes',type=int)
    a=p.parse_args()
    try:
        result=install(a.zip,a.parent,a.sha256,a.bytes);print(json.dumps(result,indent=2));print('Verified release ready. Open START_HERE.html inside the reported destination.')
    except (ValueError,OSError,zipfile.BadZipFile,KeyError) as e:
        print('Release was not installed: '+str(e),file=sys.stderr)
        print('Keep the original ZIP. Use a folder owned by the current account, outside protected Downloads if access is denied. Never merge into an older release.',file=sys.stderr)
        return 1
    return 0
if __name__=='__main__':sys.exit(main())
