// Capture explicitly installed committed code, rather than execute a mutable checkout.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {need} from '../primitives.mjs';
import {createTIReceivers} from './receivers.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bridge=fileURLToPath(new URL('./native.py',import.meta.url));
const bridgeSha=sha(fs.readFileSync(bridge));
const environment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>
  ['PATH','HOME','LANG','LC_ALL','TZ','TMPDIR','LD_LIBRARY_PATH'].includes(key)));
export function gitBytes(root,args) {
  return execFileSync('git',['--no-replace-objects','-C',root,...args],{
    env:{...environment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'},
    maxBuffer:40_000_000,timeout:30_000});
}
function capture(source,prefixes,destination,select=()=>true) {
  need(path.isAbsolute(source.root)&&fs.realpathSync(source.root)===source.root,'TI_INSTALLED_ROOT');
  need(/^[a-f0-9]{40}$/.test(source.commit),'TI_INSTALLED_COMMIT');
  need(fs.realpathSync(gitBytes(source.root,['rev-parse','--show-toplevel']).toString().trim())===source.root,'TI_INSTALLED_REPOSITORY');
  need(gitBytes(source.root,['cat-file','-t',source.commit]).toString().trim()==='commit','TI_INSTALLED_COMMIT');
  const tree=gitBytes(source.root,['rev-parse',source.commit+'^{tree}']).toString().trim();
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
  }
  for(const prefix of prefixes)need(Object.keys(files).some(name=>name===prefix||name.startsWith(prefix+'/')),'TI_INSTALLED_SOURCE_MISSING');
  return {commit:source.commit,tree,files,bytes:total};
}
/** roots/commits are operator CLI configuration, never read from a project. */
export async function openInstalledTI(sources,directory) {
  need(path.isAbsolute(directory)&&fs.realpathSync(path.dirname(directory))===path.dirname(directory),'TI_CAPTURE_DIRECTORY');
  fs.mkdirSync(directory,{mode:0o700});
  const records={};
  records.alpha=capture(sources.alpha,[
    'alpha_factory_v1','examples/transformational-intelligence','docs/assets/successor',
    'examples/successor-alpha','examples/successor-workbench','examples/build-successor'],path.join(directory,'alpha'),
    name=>!name.startsWith('alpha_factory_v1/')||name.endsWith('.py')
      ||name.startsWith('alpha_factory_v1/core/runtime/')||name.startsWith('alpha_factory_v1/utils/'));
  records.manager=capture(sources.manager,['scripts/integrations/transformational-work-request.mjs','site/assets/successor/safe.mjs'],path.join(directory,'manager'));
  records.jobs=capture(sources.jobs,['integrations/alpha-agent/transformational-work-request.mjs',
    'integrations/alpha-agent/vendor/alpha/docs/assets/successor/engine.mjs'],path.join(directory,'jobs'));
  const load=(name,file)=>import(pathToFileURL(path.join(directory,name,file)).href);
  const [alpha,computer,project,manager,jobs]=await Promise.all([
    load('alpha','examples/transformational-intelligence/inspector.mjs'),
    load('alpha','examples/successor-alpha/computer.mjs'),load('alpha','examples/successor-alpha/project.mjs'),
    load('manager','scripts/integrations/transformational-work-request.mjs'),
    load('jobs','integrations/alpha-agent/transformational-work-request.mjs')]);
  const runtimeBindings=new Map();
  const receivers=createTIReceivers({alpha,manager,jobs,computer,runtimeBindings,
    managerSha256:records.manager.files['scripts/integrations/transformational-work-request.mjs'].sha256,
    jobsSha256:records.jobs.files['integrations/alpha-agent/transformational-work-request.mjs'].sha256});
  return {records,receivers,alpha,computer,project,alphaRoot:path.join(directory,'alpha'),
    // Only the installed caller may register a binding read from its own native
    // journal. Never invoke this while importing a portable project/result.
    trustRuntimeBinding:(campaign,binding)=>{
      need(typeof campaign==='string'&&/^[a-f0-9]{64}$/.test(binding),'TI_RUNTIME_BINDING');runtimeBindings.set(campaign,binding);
    },
    close:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
/** Isolated thin native API adapter. The complete Alpha CLI/package has separate gates. */
export function nativeCLI(installed,python,home,args) {
  need(path.isAbsolute(python)&&fs.realpathSync(python)===python,'TI_PHYSICAL_PYTHON_REQUIRED');
  need(sha(fs.readFileSync(bridge))===bridgeSha,'TI_NATIVE_BRIDGE_CHANGED');
  const expected=installed.records.alpha.files,seen=new Set();
  function verify(directory,relative='') {
    for(const name of fs.readdirSync(directory)) {
      const rel=relative?relative+'/'+name:name,file=path.join(directory,name),stat=fs.lstatSync(file);
      need(!stat.isSymbolicLink()&&fs.realpathSync(file)===file,'TI_CAPTURE_CHANGED');
      if(stat.isDirectory()) {
        need(Object.keys(expected).some(key=>key.startsWith(rel+'/')),'TI_CAPTURE_EXTRA_SOURCE');verify(file,rel);
      } else {
        need(stat.isFile()&&expected[rel]&&sha(fs.readFileSync(file))===expected[rel].sha256,'TI_CAPTURE_CHANGED');seen.add(rel);
      }
    }
  }
  verify(installed.alphaRoot);need(seen.size===Object.keys(expected).length,'TI_CAPTURE_MISSING_SOURCE');
  const code=`import runpy,sys,sysconfig,importlib.machinery
from pathlib import Path
class SourceOnly(importlib.machinery.SourceFileLoader):
 def get_code(self,fullname):return self.source_to_code(self.get_data(self.path),self.path)
sys.path_hooks.insert(0,importlib.machinery.FileFinder.path_hook((SourceOnly,importlib.machinery.SOURCE_SUFFIXES),(importlib.machinery.ExtensionFileLoader,importlib.machinery.EXTENSION_SUFFIXES)))
sys.path_importer_cache.clear()
p=Path(sys.executable).parent.parent
d=p/'lib'/('python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor))/'site-packages' if (p/'pyvenv.cfg').is_file() else Path(sysconfig.get_path('purelib'))
sys.path.append(str(d));sys.path.insert(0,sys.argv.pop(1));runpy.run_path(sys.argv.pop(1),run_name='__main__')`;
  return JSON.parse(execFileSync(python,['-I','-S','-B','-c',code,installed.alphaRoot,bridge,'--home',home,...args],
    {env:environment(),encoding:'utf8',maxBuffer:4_000_000,timeout:60_000}));
}
