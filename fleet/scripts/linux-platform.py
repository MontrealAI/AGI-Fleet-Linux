#!/usr/bin/env python3
"""Fresh Ubuntu preparation. No wallet handling, migration or STOP reconciliation."""
import argparse,hashlib,json,os,pathlib,pwd,re,shutil,stat,subprocess,sys,tarfile,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def need(v,c):
 if not v:raise RuntimeError(c)
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def output(args):return subprocess.check_output(args,text=True,timeout=20).strip()
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def ubuntu():
 d=dict(line.split('=',1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
 need(d.get('ID')=='ubuntu' and d.get('VERSION_ID','').strip('"')=='24.04','UBUNTU_24_04_REQUIRED')
 need(os.uname().machine in ('x86_64','aarch64'),'LINUX_ARCHITECTURE_REQUIRED')
def private(p,uid=None,directory=False):
 s=p.lstat();need(not p.is_symlink() and s.st_uid==(os.getuid() if uid is None else uid) and not s.st_mode&0o077 and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode) and s.st_nlink==1),'PRIVATE_PATH_REQUIRED')
 need(p.resolve()==p.absolute(),'CANONICAL_PATH_REQUIRED');return s
def account():
 need(os.getuid()>=1000,'STANDARD_ACCOUNT_REQUIRED');home=pathlib.Path(pwd.getpwuid(os.getuid()).pw_dir);need(str(home)==os.environ.get('HOME'),'LOGIN_HOME_REQUIRED');private(home,directory=True)
 groups=set(output(['/usr/bin/id','-Gn']).split());need(groups and not groups.intersection({'root','sudo','wheel','admin','docker','lxd','incus','incus-admin','disk','shadow','kmem'}),'STANDARD_ACCOUNT_REQUIRED');return home
def download(url,dest):
 run(['/usr/bin/curl','--fail','--location','--proto','=https','--tlsv1.2','--connect-timeout','15','--max-time','600',url,'--output',str(dest)],stdout=sys.stderr,stderr=sys.stderr)
def bootstrap():
 ubuntu();home=account();parent=home/'.agi-genesis-runtime'
 if not parent.exists():parent.mkdir(mode=0o700)
 private(parent,directory=True);target=parent/'node-24.21.0';arch='x64' if os.uname().machine=='x86_64' else 'arm64'
 expected={'x64':'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6','arm64':'6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2'}[arch]
 if target.exists():
  private(target,directory=True);receipt=target/'agi-linux-node-receipt.json';private(receipt);r=json.loads(receipt.read_text());need(r.get('archiveSHA256')==expected and r.get('nodeSHA256')==sha(target/'bin/node'),'NODE_RUNTIME_CHANGED')
 else:
  stage=pathlib.Path(tempfile.mkdtemp(prefix='.node-preparing-',dir=parent));archive=stage/'node.tar.xz'
  print('Preparing pinned Node 24.21.0 privately…',file=sys.stderr);download(f'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-{arch}.tar.xz',archive);need(sha(archive)==expected,'NODE_ARCHIVE_INTEGRITY')
  with tarfile.open(archive) as t:t.extractall(stage,filter='data')
  extracted=stage/f'node-v24.21.0-linux-{arch}';extracted.chmod(0o700)
  need(output([str(extracted/'bin/node'),'--version'])=='v24.21.0','NODE_VERSION_MISMATCH')
  receipt=extracted/'agi-linux-node-receipt.json';receipt.write_text(json.dumps({'schema':'agi-linux-node/v1','archiveSHA256':expected,'nodeSHA256':sha(extracted/'bin/node')}));receipt.chmod(0o600)
  need(not target.exists(),'NODE_RUNTIME_EXISTS');extracted.rename(target);shutil.rmtree(stage)
 print(target/'bin/node')
def prepare(signer,compute):
 ubuntu();need(os.geteuid()==0,'ADMINISTRATOR_REQUIRED');need(signer!=compute and all(re.fullmatch('[a-z][a-z0-9_-]{2,30}',n) for n in (signer,compute)),'NEW_ACCOUNT_NAMES_REQUIRED')
 for name in (signer,compute):
  try:pwd.getpwnam(name);raise RuntimeError('ACCOUNT_ALREADY_EXISTS')
  except KeyError:pass
  need(not pathlib.Path('/home',name).exists(),'HOME_ALREADY_EXISTS')
 for package in ['docker.io','docker-ce','docker-ce-cli','docker-ce-rootless-extras','podman-docker','containerd','containerd.io','runc']:
  p=subprocess.run(['/usr/bin/dpkg-query','-W','-f=${Status}',package],capture_output=True,text=True)
  need('install ok installed' not in p.stdout,'EXISTING_CONTAINER_INSTALLATION_PRESERVED')
 for p in [pathlib.Path('/etc/apt/sources.list'),*pathlib.Path('/etc/apt/sources.list.d').glob('*')]:
  if p.is_file():need('download.docker.com' not in p.read_text(errors='replace'),'EXISTING_DOCKER_REPOSITORY_PRESERVED')
 need(not pathlib.Path('/etc/apt/keyrings/agi-docker.asc').exists() and not pathlib.Path('/etc/apt/sources.list.d/agi-docker.sources').exists(),'EXISTING_DOCKER_REPOSITORY_PRESERVED')
 print(f'Create NEW private accounts {signer} and {compute}; install Ubuntu prerequisites and signed Docker Engine 29.8.2; disable the newly installed root Docker service; enable only compute lingering and cgroup delegation. Existing profiles, journals, Docker data and STOP markers are not removed.')
 need(input('Type PREPARE: ').strip()=='PREPARE','CANCELLED')
 run(['/usr/bin/apt-get','update']);run(['/usr/bin/apt-get','install','-y','ca-certificates','curl','gnupg','python3','xz-utils','uidmap','dbus-user-session','slirp4netns','fuse-overlayfs','libsecret-tools','unzip'])
 with tempfile.TemporaryDirectory(prefix='agi-docker-key-') as d:
  key=pathlib.Path(d)/'key.asc';download('https://download.docker.com/linux/ubuntu/gpg',key)
  r=output(['/usr/bin/gpg','--batch','--show-keys','--with-colons',str(key)]);fps=[l.split(':')[9] for l in r.splitlines() if l.startswith('fpr:')]
  need(fps and fps[0]=='9DC858229FC7DD38854AE2D88D81803C0EBFCD88','DOCKER_SIGNING_KEY_MISMATCH')
  keydir=pathlib.Path('/etc/apt/keyrings');keydir.mkdir(mode=0o755,exist_ok=True);need(not keydir.is_symlink(),'APT_KEYRING_UNSAFE')
  target=keydir/'agi-docker.asc';target.write_bytes(key.read_bytes());target.chmod(0o644)
 arch=output(['/usr/bin/dpkg','--print-architecture']);need(arch in ('amd64','arm64'),'LINUX_ARCHITECTURE_REQUIRED')
 repo=pathlib.Path('/etc/apt/sources.list.d/agi-docker.sources');repo.write_text(f'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: {arch}\nSigned-By: /etc/apt/keyrings/agi-docker.asc\n');repo.chmod(0o644)
 run(['/usr/bin/apt-get','update']);packages=[]
 for name in ['docker-ce','docker-ce-cli','docker-ce-rootless-extras']:
  versions=[line.split('|')[1].strip() for line in output(['/usr/bin/apt-cache','madison',name]).splitlines() if '|' in line]
  version=next((v for v in versions if re.fullmatch(r'(?:\d+:)?29\.8\.2-\d+~ubuntu\.24\.04~noble',v)),None);need(version,'PINNED_DOCKER_PACKAGE_UNAVAILABLE');packages.append(name+'='+version)
 run(['/usr/bin/apt-get','install','-y',*packages,'docker-buildx-plugin','docker-compose-plugin'])
 run(['/usr/bin/systemctl','disable','--now','docker.service','docker.socket'])
 for name in (signer,compute):
  run(['/usr/sbin/adduser','--disabled-password','--gecos','AGI isolated account',name]);u=pwd.getpwnam(name);pathlib.Path(u.pw_dir).chmod(0o700);run(['/usr/bin/passwd',name])
 u=pwd.getpwnam(compute);drop=pathlib.Path(f'/etc/systemd/system/user@{u.pw_uid}.service.d');need(not drop.exists(),'EXISTING_DELEGATION_PRESERVED');drop.mkdir(mode=0o755)
 (drop/'50-agi-delegate.conf').write_text('[Service]\nDelegate=cpu cpuset io memory pids\n');run(['/usr/bin/systemctl','daemon-reload']);run(['/usr/bin/loginctl','enable-linger',compute])
 print('Preparation complete. Log into the signer and compute accounts using the Ubuntu login screen. Follow Linux-Guide.html.')
def transfer(source,compute):
 ubuntu();need(os.geteuid()==0,'ADMINISTRATOR_REQUIRED');u=pwd.getpwnam(compute);need(u.pw_uid>=1000,'COMPUTE_ACCOUNT_REQUIRED');home=pathlib.Path(u.pw_dir);private(home,uid=u.pw_uid,directory=True)
 p=pathlib.Path(source).absolute();s=p.lstat();need(p.resolve()==p and not p.is_symlink() and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=8192,'PRIVATE_SETUP_KIT_REQUIRED')
 signer=pwd.getpwuid(s.st_uid);signer_home=pathlib.Path(signer.pw_dir);private(signer_home,uid=s.st_uid,directory=True);need(p.is_relative_to(signer_home),'SIGNER_HOME_REQUIRED')
 for parent in p.parents:
  if parent==signer_home:break
  ps=parent.lstat();need(stat.S_ISDIR(ps.st_mode) and not parent.is_symlink() and ps.st_uid==s.st_uid and not ps.st_mode&0o022,'PRIVATE_SETUP_KIT_REQUIRED')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  opened=os.fstat(fd);need((opened.st_ino,opened.st_dev)==(s.st_ino,s.st_dev),'SETUP_KIT_CHANGED');data=os.read(fd,1024*1024+1);need(len(data)==s.st_size,'SETUP_KIT_CHANGED');after=os.fstat(fd);current=p.lstat();need((after.st_ino,after.st_dev,after.st_size,after.st_mtime_ns,after.st_ctime_ns)==(s.st_ino,s.st_dev,s.st_size,s.st_mtime_ns,s.st_ctime_ns) and (current.st_ino,current.st_dev)==(s.st_ino,s.st_dev),'SETUP_KIT_CHANGED')
 finally:os.close(fd)
 kit=json.loads(data);need(isinstance(kit,dict),'SETUP_KIT_INVALID');need(kit.get('schema') in ('agi-agent-openclaw-setup/v1','agi-node-openclaw-setup/v1','agi-fleet-role-openclaw-setup/v2') and kit.get('signerUID')==s.st_uid and s.st_uid>=1000 and s.st_uid!=u.pw_uid and kit.get('openclawVersion')=='2026.9.5' and re.fullmatch('[a-f0-9]{64}',kit.get('token','')),'SETUP_KIT_INVALID')
 allowed={'schema','openclawVersion','token','port','agent','model','mode','signerUID','role','publicWebAuthority'};need(isinstance(kit,dict) and set(kit)<=allowed,'SETUP_KIT_INVALID')
 registry=json.loads((ROOT/'config/role-registry.json').read_text())['roles'];role=kit.get('role') or ('agent' if kit['schema']=='agi-agent-openclaw-setup/v1' else 'node' if kit['schema']=='agi-node-openclaw-setup/v1' else None);c=registry.get(role);need(c and kit['schema']==c['schema'] and kit.get('port')==c['port'] and isinstance(kit.get('agent'),str) and len(kit['agent'])<=128 and re.fullmatch(r'openai/[a-zA-Z0-9._-]{1,100}',kit.get('model','')) and kit.get('mode')=='workstation','SETUP_KIT_INVALID')
 if 'publicWebAuthority' in kit:need(isinstance(kit['publicWebAuthority'],str) and re.fullmatch(r'-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]{32,4096}-----END PUBLIC KEY-----\n?',kit['publicWebAuthority']),'SETUP_KIT_INVALID')
 dest=home/'AGI-Setup';dest.mkdir(mode=0o700);os.chown(dest,u.pw_uid,u.pw_gid);file=dest/'OpenClaw-Setup.json';fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(data);stream.flush();os.fchown(fd,u.pw_uid,u.pw_gid);os.fsync(fd)
 finally:os.close(fd)
 print('Private setup kit copied to '+str(file)+'. No wallet was copied.')
def compute():
 ubuntu();home=account();runtime=pathlib.Path('/run/user')/str(os.getuid());private(runtime,directory=True)
 for key in ('SUDO_USER','SUDO_UID'):need(not os.environ.get(key),'DESKTOP_LOGIN_REQUIRED')
 need(os.environ.get('XDG_RUNTIME_DIR')==str(runtime) and (runtime/'bus').is_socket(),'DESKTOP_LOGIN_REQUIRED')
 need(not pathlib.Path('/var/run/docker.sock').exists() or not os.access('/var/run/docker.sock',os.R_OK|os.W_OK),'ROOT_DOCKER_ACCESS_FORBIDDEN')
 env={**os.environ,'DOCKER_HOST':'unix://'+str(runtime/'docker.sock'),'DBUS_SESSION_BUS_ADDRESS':'unix:path='+str(runtime/'bus')}
 service=home/'.config/systemd/user/docker.service'
 if not service.exists():
  need(not (home/'.local/share/docker').exists(),'EXISTING_DOCKER_STATE_PRESERVED');run(['/usr/bin/dockerd-rootless-setuptool.sh','install'],env=env)
 run(['/usr/bin/systemctl','--user','enable','--now','docker.service'],env=env)
 r=json.loads(subprocess.check_output(['/usr/bin/docker','info','--format','{{json .}}'],env=env,text=True,timeout=30))
 need(r.get('ServerVersion')=='29.8.2' and 'name=rootless' in r.get('SecurityOptions',[]) and str(r.get('CgroupVersion'))=='2' and r.get('CgroupDriver')=='systemd','ROOTLESS_DOCKER_REQUIRED')
 need(all(r.get(k) is True for k in ['MemoryLimit','SwapLimit','PidsLimit']) and (r.get('CpuCfsQuota') is True or r.get('CPUCfsQuota') is True),'CGROUP_LIMITS_REQUIRED')
 print('Rootless Docker ready. Install.sh will independently verify the account, socket, runtime and enforced limits.')
def main():
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='action',required=True)
 sub.add_parser('node');sub.add_parser('compute');a=sub.add_parser('prepare');a.add_argument('signer');a.add_argument('compute');a=sub.add_parser('transfer');a.add_argument('source');a.add_argument('compute');o=p.parse_args()
 if o.action=='node':bootstrap()
 elif o.action=='prepare':prepare(o.signer,o.compute)
 elif o.action=='compute':compute()
 else:transfer(o.source,o.compute)
if __name__=='__main__':
 os.umask(0o077)
 try:main()
 except (RuntimeError,OSError,ValueError,TypeError,KeyError,AttributeError,subprocess.SubprocessError) as e:
  code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'LINUX_PREPARATION_FAILED';print('Stopped: '+code+'. Preserve this attempt; do not change security settings or remove STOP markers.',file=sys.stderr);sys.exit(1)
