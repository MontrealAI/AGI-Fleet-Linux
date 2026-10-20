// Capture explicitly installed committed code, rather than execute a mutable checkout.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks,isBuiltin} from 'node:module';
import {need,parseStrict,decodeUTF8} from '../primitives.mjs';
import {createTIReceivers} from './receivers.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bridge=fileURLToPath(new URL('./native.py',import.meta.url));
const bridgeBytes=fs.readFileSync(bridge),bridgeSha=sha(bridgeBytes);
const installationSnapshots=new WeakMap();
let frozenPins;
function shippedPins() {
  if(frozenPins)return frozenPins;
  // This is application source, never a path from operator configuration or CWD.
  // Load lazily: the separate alpha.6 package does not ship the TI pin file.
  const raw=fs.readFileSync(new URL('../../engineering/transformation/source-pins.json',import.meta.url));
  need(raw.length<=1_000_000,'TI_INSTALLED_PINS');
  const value=parseStrict(decodeUTF8(raw),1_000_000);
  need(value?.schema==='agi-fleet/ti-installed-source-pins/v1'&&value.publicNonpersonalOnly===true
    &&value.paidTI===false&&value.liveProvider===false&&value.productionQualified===false
    &&value.importedAuthority==='none','TI_INSTALLED_PINS');
  const repositories={alpha:'MontrealAI/AGI-Alpha-Agent-v0',manager:'MontrealAI/AGIJobManager',jobs:'MontrealAI/AGIJobsv0'},pins={};
  for(const [name,repository] of Object.entries(repositories)){
    const pin=value[name];
    need(pin?.repository===repository&&/^[a-f0-9]{40}$/.test(pin.commit)&&/^[a-f0-9]{40}$/.test(pin.tree),'TI_INSTALLED_PINS');
    pins[name]=Object.freeze({commit:pin.commit,tree:pin.tree});
  }
  return frozenPins=Object.freeze(pins);
}
/** Metadata-only check against this application's shipped, immutable pin record. */
export function requireInstalledTIPin(name,commit,tree) {
  const pins=shippedPins(),pin=Object.hasOwn(pins,name)?pins[name]:null;
  need(pin&&commit===pin.commit,'TI_INSTALLED_COMMIT');
  need(tree===pin.tree,'TI_INSTALLED_TREE');
  return pin;
}
const environment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>
  ['PATH','HOME','LANG','LC_ALL','TZ','TMPDIR','LD_LIBRARY_PATH'].includes(key)));
export function gitBytes(root,args) {
  return execFileSync('git',['--no-replace-objects','-C',root,...args],{
    env:{...environment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'},
    maxBuffer:40_000_000,timeout:30_000});
}
function selectedSource(name,configured) {
  const pin=shippedPins()[name],source=Object.freeze({root:configured?.root,commit:configured?.commit});
  need(/^[a-f0-9]{40}$/.test(source.commit)&&source.commit===pin.commit,'TI_INSTALLED_COMMIT');
  need(typeof source.root==='string'&&path.isAbsolute(source.root)&&fs.realpathSync(source.root)===source.root,'TI_INSTALLED_ROOT');
  need(fs.realpathSync(gitBytes(source.root,['rev-parse','--show-toplevel']).toString().trim())===source.root,'TI_INSTALLED_REPOSITORY');
  need(gitBytes(source.root,['cat-file','-t',source.commit]).toString().trim()==='commit','TI_INSTALLED_COMMIT');
  const tree=gitBytes(source.root,['rev-parse',source.commit+'^{tree}']).toString().trim();
  return Object.freeze({root:source.root,...requireInstalledTIPin(name,source.commit,tree)});
}
function capture(source,prefixes,destination,select=()=>true,snapshot) {
  const tree=source.tree;
  const rows=gitBytes(source.root,['ls-tree','-rz','-l','--full-tree',source.commit,'--',...prefixes]).toString('utf8').split('\0').filter(Boolean);
  need(rows.length>0&&rows.length<=2048,'TI_INSTALLED_SOURCE_COUNT');
  fs.mkdirSync(destination,{mode:0o700});
  const files={};let total=0;
  for(const row of rows) {
    const rawName=row.slice(row.indexOf('\t')+1);
    if(!select(rawName))continue;
    const match=/^(100644|100755) blob ([a-f0-9]{40}) +([0-9]+)\t(.+)$/.exec(row);
    need(match,'TI_INSTALLED_REGULAR_SOURCE');
    const [,mode,blob,length,name]=match;
    need(/^[A-Za-z0-9_.\/-]+$/.test(name)&&!name.split('/').some(part=>part==='..'||!part),'TI_INSTALLED_SOURCE_PATH');
    total+=Number(length);need(Number(length)<=2_000_000&&total<=32_000_000,'TI_INSTALLED_SOURCE_SIZE');
    const bytes=gitBytes(source.root,['cat-file','blob',blob]);
    need(bytes.length===Number(length),'TI_INSTALLED_SOURCE_SIZE');
    const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600}); files[name]={sha256:sha(bytes),mode};
    snapshot.set(name,Buffer.from(bytes));
  }
  for(const prefix of prefixes)need(Object.keys(files).some(name=>name===prefix||name.startsWith(prefix+'/')),'TI_INSTALLED_SOURCE_MISSING');
  return {commit:source.commit,tree,files,bytes:total};
}
/** roots/commits are operator CLI configuration, never read from a project. */
export async function openInstalledTI(sources,directory) {
  need(path.isAbsolute(directory)&&fs.realpathSync(path.dirname(directory))===path.dirname(directory),'TI_CAPTURE_DIRECTORY');
  // Finish all three identity checks before writing captures or importing targets.
  const selected=Object.freeze(Object.fromEntries(['alpha','manager','jobs'].map(name=>[name,selectedSource(name,sources?.[name])])));
  fs.mkdirSync(directory,{mode:0o700});
  const records={},snapshots={alpha:new Map(),manager:new Map(),jobs:new Map()};
  records.alpha=capture(selected.alpha,[
    'alpha_factory_v1','examples/transformational-intelligence','docs/assets/successor',
    'examples/successor-alpha','examples/successor-workbench','examples/build-successor'],path.join(directory,'alpha'),
    name=>!name.startsWith('alpha_factory_v1/')||name.endsWith('.py')
      ||name.startsWith('alpha_factory_v1/core/runtime/')||name.startsWith('alpha_factory_v1/utils/'),snapshots.alpha);
  records.manager=capture(selected.manager,['scripts/integrations/transformational-work-request.mjs','site/assets/successor/safe.mjs'],path.join(directory,'manager'),()=>true,snapshots.manager);
  records.jobs=capture(selected.jobs,['integrations/alpha-agent/transformational-work-request.mjs',
    'integrations/alpha-agent/vendor/alpha/docs/assets/successor/engine.mjs'],path.join(directory,'jobs'),()=>true,snapshots.jobs);
  // Import the bytes read from exact Git blobs, without reopening writable captures.
  const moduleSources=new Map();
  for(const [name,files] of Object.entries(snapshots))
    for(const [file,bytes] of files)moduleSources.set(pathToFileURL(path.join(directory,name,file)).href,bytes);
  const captureURL=pathToFileURL(directory+path.sep).href;
  const owned=url=>typeof url==='string'&&url.startsWith(captureURL);
  const hooks=registerHooks({
    resolve(specifier,context,nextResolve) {
      if(owned(context.parentURL)||owned(specifier)) {
        if(isBuiltin(specifier))return nextResolve(specifier,context);
        const url=new URL(specifier,context.parentURL).href;
        need(owned(url)&&moduleSources.has(url)&&url.endsWith('.mjs'),'TI_CAPTURE_IMPORT');
        return {url,shortCircuit:true};
      }
      return nextResolve(specifier,context);
    },
    load(url,context,nextLoad) {
      if(owned(url)) {
        need(moduleSources.has(url)&&url.endsWith('.mjs'),'TI_CAPTURE_IMPORT');
        return {format:'module',source:moduleSources.get(url),shortCircuit:true};
      }
      return nextLoad(url,context);
    },
  });
  const load=(name,file)=>import(pathToFileURL(path.join(directory,name,file)).href);
  try {
  const attempts=await Promise.allSettled([
    load('alpha','examples/transformational-intelligence/inspector.mjs'),
    load('alpha','examples/successor-alpha/computer.mjs'),load('alpha','examples/successor-alpha/project.mjs'),
    load('manager','scripts/integrations/transformational-work-request.mjs'),
    load('jobs','integrations/alpha-agent/transformational-work-request.mjs')]);
  const failed=attempts.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  const [alpha,computer,project,manager,jobs]=attempts.map(result=>result.value);
  const runtimeBindings=new Map();
  const receivers=createTIReceivers({alpha,manager,jobs,computer,runtimeBindings,
    managerSha256:records.manager.files['scripts/integrations/transformational-work-request.mjs'].sha256,
    jobsSha256:records.jobs.files['integrations/alpha-agent/transformational-work-request.mjs'].sha256});
  const installed={records,receivers,alpha,computer,project,alphaRoot:path.join(directory,'alpha'),
    // Only the installed caller may register a binding read from its own native
    // journal. Never invoke this while importing a portable project/result.
    trustRuntimeBinding:(campaign,binding)=>{
      need(typeof campaign==='string'&&/^[a-f0-9]{64}$/.test(binding),'TI_RUNTIME_BINDING');runtimeBindings.set(campaign,binding);
    },
    close:()=>{hooks.deregister();installationSnapshots.delete(installed);fs.rmSync(directory,{recursive:true,force:true});}};
  const files=Object.freeze(Object.fromEntries(Object.entries(records.alpha.files).map(([name,value])=>[name,Object.freeze({...value})])));
  installationSnapshots.set(installed,{root:installed.alphaRoot,files,bytes:snapshots.alpha});
  return installed;
  } catch(error){hooks.deregister();throw error;}
}
/** Isolated thin native API adapter. The complete Alpha CLI/package has separate gates. */
export function nativeCLI(installed,python,home,args) {
  need(path.isAbsolute(python)&&fs.realpathSync(python)===python,'TI_PHYSICAL_PYTHON_REQUIRED');
  need(sha(fs.readFileSync(bridge))===bridgeSha,'TI_NATIVE_BRIDGE_CHANGED');
  const retained=installationSnapshots.get(installed);
  need(retained&&installed.alphaRoot===retained.root,'TI_INSTALLED_HANDLE');
  const expected=retained.files,seen=new Set();
  function verify(directory,relative='') {
    for(const name of fs.readdirSync(directory)) {
      const rel=relative?relative+'/'+name:name,file=path.join(directory,name),stat=fs.lstatSync(file);
      need(!stat.isSymbolicLink()&&fs.realpathSync(file)===file,'TI_CAPTURE_CHANGED');
      if(stat.isDirectory()) {
        need(Object.keys(expected).some(key=>key.startsWith(rel+'/')),'TI_CAPTURE_EXTRA_SOURCE');verify(file,rel);
      } else {
        need(stat.isFile()&&expected[rel],'TI_CAPTURE_CHANGED');
        const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
        try {
          const opened=fs.fstatSync(descriptor);
          need(opened.isFile()&&opened.dev===stat.dev&&opened.ino===stat.ino&&opened.nlink===1
            &&opened.uid===process.getuid()&&!(opened.mode&0o077)&&opened.size<=2_000_000,'TI_CAPTURE_CHANGED');
          const buffer=Buffer.alloc(2_000_001);let offset=0;
          while(offset<buffer.length) {
            const count=fs.readSync(descriptor,buffer,offset,buffer.length-offset,offset);
            if(count===0)break;offset+=count;
          }
          const bytes=buffer.subarray(0,offset),after=fs.fstatSync(descriptor);
          need(bytes.length<=2_000_000&&bytes.length===opened.size
            &&['dev','ino','size','mtimeMs','ctimeMs','mode'].every(key=>opened[key]===after[key])
            &&sha(bytes)===expected[rel].sha256&&bytes.equals(retained.bytes.get(rel)),'TI_CAPTURE_CHANGED');
        } finally{fs.closeSync(descriptor);}
        seen.add(rel);
      }
    }
  }
  verify(installed.alphaRoot);need(seen.size===Object.keys(expected).length,'TI_CAPTURE_MISSING_SOURCE');
  const code="import base64,hashlib,importlib.abc,importlib.machinery,importlib.util,json,linecache,sys,sysconfig\nfrom pathlib import Path\nfrom types import MappingProxyType\nraw=sys.stdin.buffer.read(48_000_001)\nif len(raw)>48_000_000 or hashlib.sha256(raw).hexdigest()!=sys.argv.pop(1):\n raise ValueError(\"TI_NATIVE_SNAPSHOT\")\ncapsule=json.loads(raw)\nif set(capsule)!={\"root\",\"files\",\"bridge\",\"bridgePath\"} or not isinstance(capsule[\"files\"],dict) or not 0<len(capsule[\"files\"])<=2048:\n raise ValueError(\"TI_NATIVE_SNAPSHOT\")\nroot=Path(capsule[\"root\"])\nif not root.is_absolute() or str(root)!=capsule[\"root\"]:\n raise ValueError(\"TI_NATIVE_SNAPSHOT\")\nfiles={}\ntotal=0\nfor name,encoded in capsule[\"files\"].items():\n if not isinstance(name,str) or not name or any(part in {\"\",\".\",\"..\"} for part in name.split(\"/\")) or name.startswith(\"/\"):\n  raise ValueError(\"TI_NATIVE_SNAPSHOT\")\n value=base64.b64decode(encoded,validate=True)\n total+=len(value)\n if len(value)>2_000_000 or total>32_000_000:\n  raise ValueError(\"TI_NATIVE_SNAPSHOT\")\n files[str(root/name)]=value\nfiles=MappingProxyType(files)\nclass SourceOnly(importlib.machinery.SourceFileLoader):\n def get_code(self,fullname):return self.source_to_code(self.get_data(self.path),self.path)\nsys.path_hooks.insert(0,importlib.machinery.FileFinder.path_hook((SourceOnly,importlib.machinery.SOURCE_SUFFIXES),(importlib.machinery.ExtensionFileLoader,importlib.machinery.EXTENSION_SUFFIXES)))\nsys.path_importer_cache.clear()\nclass SnapshotLoader(importlib.abc.SourceLoader):\n def __init__(self,filename):self.filename=filename\n def get_filename(self,fullname):return self.filename\n def verified_source_bytes(self,filename):\n  if filename not in files:raise ImportError(\"TI_SNAPSHOT_SOURCE_MISSING\")\n  return files[filename]\n def get_data(self,filename):return self.verified_source_bytes(filename)\n def get_source(self,fullname):return importlib.util.decode_source(self.get_data(self.filename))\n def get_code(self,fullname):\n  source=self.get_data(self.filename)\n  text=importlib.util.decode_source(source)\n  linecache.cache[self.filename]=(len(source),None,text.splitlines(keepends=True),self.filename)\n  return compile(source,self.filename,\"exec\",dont_inherit=True)\n def set_data(self,filename,data):raise ImportError(\"TI_SNAPSHOT_WRITE_DENIED\")\nclass SnapshotFinder(importlib.abc.MetaPathFinder):\n def find_spec(self,fullname,path=None,target=None):\n  if fullname!=\"alpha_factory_v1\" and not fullname.startswith(\"alpha_factory_v1.\"):return None\n  relative=fullname.replace(\".\",\"/\")\n  package=str(root/(relative+\"/__init__.py\"))\n  module=str(root/(relative+\".py\"))\n  if package in files:\n   spec=importlib.util.spec_from_file_location(fullname,package,loader=SnapshotLoader(package),submodule_search_locations=[str(Path(package).parent)])\n   return spec\n  if module in files:return importlib.util.spec_from_file_location(fullname,module,loader=SnapshotLoader(module))\n  directory=str(root/relative)+\"/\"\n  if any(filename.startswith(directory) for filename in files):\n   spec=importlib.machinery.ModuleSpec(fullname,loader=None,is_package=True)\n   spec.submodule_search_locations=[directory[:-1]]\n   return spec\n  raise ModuleNotFoundError(\"TI_SNAPSHOT_MODULE_MISSING\",name=fullname)\nsys.meta_path.insert(0,SnapshotFinder())\np=Path(sys.executable).parent.parent\nd=p/'lib'/('python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor))/'site-packages' if (p/'pyvenv.cfg').is_file() else Path(sysconfig.get_path('purelib'))\nsys.path.append(str(d))\nbridge=base64.b64decode(capsule[\"bridge\"],validate=True)\nif not 0<len(bridge)<=128_000:raise ValueError(\"TI_NATIVE_SNAPSHOT\")\nsys.argv=[capsule[\"bridgePath\"],*sys.argv[1:]]\nnamespace={\"__name__\":\"__main__\",\"__file__\":capsule[\"bridgePath\"],\"__package__\":None}\nexec(compile(bridge,capsule[\"bridgePath\"],\"exec\",dont_inherit=True),namespace)\n";
  const input=JSON.stringify({root:retained.root,files:Object.fromEntries([...retained.bytes].map(([name,bytes])=>[name,bytes.toString('base64')])),
    bridge:bridgeBytes.toString('base64'),bridgePath:bridge});
  need(Buffer.byteLength(input)<=48_000_000,'TI_NATIVE_SNAPSHOT');
  return JSON.parse(execFileSync(python,['-I','-S','-B','-c',code,sha(input),'--home',home,...args],
    {env:environment(),input,encoding:'utf8',maxBuffer:4_000_000,timeout:60_000}));
}
