// Whole bytes and modes, including actual CLI entrypoint; no refreshed-in-CI waiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const builder=fileURLToPath(new URL('../../local-runtime/transformation/package.py',import.meta.url));
test('finite TI inventory binds exact source bytes and refuses drift before packaging',()=>{
  const result=execFileSync(process.env.TI_PYTHON,['-B','-c',String.raw`
import json,runpy,tempfile,shutil
from pathlib import Path
m=runpy.run_path(${JSON.stringify(builder)})
assert json.loads(m['INVENTORY'].read_bytes())==m['reviewed_inventory']()
assert m['PROFILE'].is_file()
profile=json.loads(m['PROFILE'].read_bytes())
assert profile['version']=='0.1.0-alpha.7' and profile['legacyRuntimeVersion']=='0.1.0-alpha.6'
assert profile['entrypoint']==['node','local-runtime/transformation/cli.mjs']
assert not profile['productionQualified'] and not profile['operatorInstaller']
with tempfile.TemporaryDirectory() as raw:
 root=Path(raw)/'source';root.mkdir()
 for name in m['TI_FILES']:
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(m['ROOT']/name,target)
 for name in m['TI_ROOTS']:shutil.copytree(m['ROOT']/name,root/name)
 g=m['build'].__globals__;g['ROOT']=root;g['PROFILE']=root/'local-runtime/transformation/release-profile.json';g['INVENTORY']=root/'local-runtime/transformation/source-inventory.json'
 assert json.loads(g['INVENTORY'].read_bytes())==m['reviewed_inventory']()
 changed=root/'local-runtime/transformation/cli.mjs'
 original=changed.read_bytes();changed.write_bytes(original.replace(b'TI_COMMAND_UNKNOWN',b'TI_COMMAND_ALTERED'))
 assert changed.read_bytes()!=original
 output=Path(raw)/'artifact'
 try:m['build'](output)
 except ValueError as e:assert str(e)=='TI_REVIEWED_SOURCE_INVENTORY_CHANGED'
 else:raise AssertionError('whole-byte change was accepted')
 assert not output.exists()
 changed.write_bytes(original)
 outside=Path(raw)/'outside';outside.mkdir();(outside/'source.txt').write_text('outside source must not enter package')
 (root/'linked-parent').symlink_to(outside,target_is_directory=True)
 try:m['regular'](root/'linked-parent/source.txt')
 except ValueError as e:assert str(e).startswith('TI_PACKAGE_REGULAR_BOUNDED_SOURCE:')
 else:raise AssertionError('symlinked parent source was accepted')
 g['ROOTS']=['linked-parent']
 try:m['build'](output)
 except ValueError as e:assert str(e).startswith('TI_PACKAGE_MISSING_SOURCE:')
 else:raise AssertionError('symlinked package root was accepted')
 target=root/'local-runtime/transformation';moved=Path(raw)/'moved-ti';target.rename(moved);target.symlink_to(moved,target_is_directory=True)
 try:m['reviewed_inventory']()
 except ValueError as e:assert str(e).startswith('TI_PACKAGE_SOURCE_ROOT:')
 else:raise AssertionError('symlinked finite inventory root was accepted')
print('FINITE_SOURCE_AND_ENTRYPOINT_PASS')
`],{encoding:'utf8',timeout:30_000});
  assert.match(result,/FINITE_SOURCE_AND_ENTRYPOINT_PASS/);
});


test('source preview reports every tracked and untracked extra packaged input',()=>{
  const result=execFileSync(process.env.TI_PYTHON,['-B','-c',String.raw`
import contextlib,io,json,os,runpy,subprocess,tempfile,zipfile
from pathlib import Path
m=runpy.run_path(${JSON.stringify(builder)})
extras=['LOCAL_SKILLS.md','LICENSE','fleet/package.json','fleet/package-lock.json']
with tempfile.TemporaryDirectory() as raw:
 root=Path(raw)/'source';root.mkdir()
 g=m['build'].__globals__;g['ROOT']=root
 # Isolate ordinary Git dirty metadata from the separately checked locked npm reference.
 # This artificial archive is not dependency or release qualification.
 g['verify_dependency_provenance']=lambda entries:{'scope':'INERT_GIT_DIRTY_METADATA_FIXTURE_ONLY'}
 g['PROFILE']=root/'local-runtime/transformation/release-profile.json'
 g['INVENTORY']=root/'local-runtime/transformation/source-inventory.json'
 for name in [*m['ROOTS'],*m['TI_ROOTS']]:(root/name).mkdir(parents=True,exist_ok=True)
 for name in [*m['TI_FILES'],*extras,'outside-package.txt']:
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('public fixture input: '+name+'\n')
 g['PROFILE'].write_bytes(m['encoded']({'version':'0.1.0-alpha.7','archive':'ti-fixture.zip','scope':'packaging regression fixture'}))
 g['INVENTORY'].write_bytes(m['encoded'](m['reviewed_inventory']()))
 git_env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 git_env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull,GIT_CONFIG_SYSTEM=os.devnull)
 def git(*args):
  return subprocess.check_output(['git','-c','core.excludesFile='+os.devnull,*args],cwd=root,env=git_env)
 def commit(message):
  git('-c','user.name=TI package fixture','-c','user.email=ti-package-fixture@example.invalid','commit','-qm',message)
 def clean():
  assert git('status','--porcelain','--untracked-files=all')==b''
 def package(name,expected_dirty):
  output=Path(raw)/name
  with contextlib.redirect_stdout(io.StringIO()):m['build'](output)
  receipt=json.loads((output/'package-receipt.json').read_bytes())
  archive=output/receipt['archive']
  assert receipt['workingTreeDirty'] is expected_dirty,(name,'receipt',receipt['workingTreeDirty'])
  assert receipt['sha256']==m['sha'](archive.read_bytes())
  with zipfile.ZipFile(archive) as saved:
   prefix='agi-fleet-local-0.1.0-alpha.7/'
   manifest=json.loads(saved.read(prefix+'local-preview-manifest.json'))
   assert manifest['workingTreeDirty'] is expected_dirty,(name,'manifest',manifest['workingTreeDirty'])
   assert manifest['commit']==git('rev-parse','HEAD').decode().strip()
   assert manifest['operatorInstaller'] is False and manifest['productionQualified'] is False
   assert manifest['nativeAcceptance']=='NOT_RUN'
   entries={row['path']:row for row in manifest['files']}
   for extra in extras:
    content=(root/extra).read_bytes()
    assert saved.read(prefix+extra)==content
    assert entries[extra]['sha256']==m['sha'](content)
   assert 'outside-package.txt' not in entries and 'outside-untracked.txt' not in entries
 git('init','--quiet');git('add','-f','--','.');commit('clean packaging fixture');clean()
 package('clean',False)
 for index,name in enumerate(extras):
  target=root/name;original=target.read_bytes();target.write_bytes(original+b'tracked change\n')
  assert git('status','--porcelain','--',name)
  package('tracked-'+str(index),True)
  target.write_bytes(original);clean()
 for index,name in enumerate(extras):
  git('rm','--cached','--',name);commit('leave one packaged input untracked')
  target=root/name;original=target.read_bytes();target.write_bytes(original+b'untracked change\n')
  assert git('status','--porcelain','--untracked-files=all','--',name).splitlines()==[('?? '+name).encode()]
  package('untracked-'+str(index),True)
  target.write_bytes(original);git('add','-f','--',name);commit('restore tracked packaged input');clean()
 (root/'outside-package.txt').write_text('changed excluded tracked input\n')
 (root/'outside-untracked.txt').write_text('new excluded untracked input\n')
 assert git('status','--porcelain','--untracked-files=all')
 package('excluded-paths',False)
print('DIRTY_INCLUDED_INPUTS_PASS 10_SCENARIOS')
`],{encoding:'utf8',timeout:30_000});
  assert.match(result,/DIRTY_INCLUDED_INPUTS_PASS 10_SCENARIOS/);
});

test('normal installed qualification binds installer receipt, application and Node',()=>{
  const workflow=fileURLToPath(new URL('../../.github/workflows/transformational-project.yml',import.meta.url));
  const text=fs.readFileSync(workflow,'utf8');
  assert.equal((text.match(/TI_APPLICATION: \$\{\{ steps\.installed\.outputs\.application \}\}/g)||[]).length,2);
  assert.equal((text.match(/TI_NODE: \$\{\{ steps\.installed\.outputs\.node \}\}/g)||[]).length,2);
  assert.match(text,/"\$TI_NODE" --test "\$TI_APPLICATION\/engineering\/transformation\/"\*\.test\.mjs/);
  assert.match(text,/"\$TI_NODE" "\$TI_APPLICATION\/engineering\/transformation\/qualify\.mjs" "\$TI_APPLICATION"/);
  assert.match(text,/installer\['verify_version'\]\(Path\(binding\['installation'\]\),binding\['archiveSHA256'\]\)/);
  const result=execFileSync(process.env.TI_PYTHON,['-I','-B','-c',String.raw`
import hashlib,json,os,re,tempfile,textwrap,urllib.request
from pathlib import Path
from unittest import mock
workflow=Path(${JSON.stringify(workflow)}).read_text()
start=workflow.index('      - name: Require the unchanged unprivileged installer with the new source-preview manifest')
end=workflow.index('      - name: Require native command controls from the normal installed application and Node',start)
step=workflow[start:end]
assert '\n        id: installed\n' in step
code=textwrap.dedent(step.split("python3 - <<'PY'\n",1)[1].rsplit('\n          PY',1)[0])
code=code.replace('$'+'{{ matrix.arch }}','x64')
source='a'*40
cases=['valid','archive','source','version','installation','state','started','authority','node-hash','manifest-hash','root','syntax']
for scenario in cases:
 with tempfile.TemporaryDirectory(prefix='ti-install-argument-fixture-') as temporary:
  root=Path(temporary).resolve();workspace=root/'workspace';workspace.mkdir();runner=root/'runner';runner.mkdir()
  (workspace/'reports/ti').mkdir(parents=True)
  lock=workspace/'fleet/shared/runtime/compute/runtime-artifacts.lock.json';lock.parent.mkdir(parents=True)
  node_archive=b'inert Node archive fixture';lock.write_text(json.dumps({'node':{'archives':[{'platform':'linux-x64','url':'https://example.invalid/inert-node-fixture','sha256':hashlib.sha256(node_archive).hexdigest()}]}}))
  package=runner/'ti-package';package.mkdir();archive=b'inert source package fixture';archive_sha=hashlib.sha256(archive).hexdigest()
  (package/'agi-fleet-local-0.1.0-alpha.7.zip').write_bytes(archive)
  inventory=b'{}\n';manifest=json.dumps({'commit':source,'workingTreeDirty':False}).encode();node=b'inert installed Node fixture'
  package_receipt={'sha256':archive_sha,'archive':'agi-fleet-local-0.1.0-alpha.7.zip','commit':source,'version':'0.1.0-alpha.7','inventorySha256':hashlib.sha256(inventory).hexdigest()}
  (package/'package-receipt.json').write_text(json.dumps(package_receipt))
  outputs=root/'github-output';outputs.write_text('');installation=runner/'ti-installed';state=runner/'ti-installed-state'
  app=installation/'versions'/archive_sha/'application';runtime=installation/'versions'/archive_sha/'runtime/node';checked=[]
  def download(url,target):
   assert url=='https://example.invalid/inert-node-fixture';Path(target).write_bytes(node_archive)
  def check_output(argv,**kwargs):
   assert argv[:3]==['python3','-B','local-runtime/install.py']
   if argv[3]=='preflight':return json.dumps({'readyForInstallInspection':True})
   assert argv[3]=='install' and argv[-1]=='--confirm'
   assert argv[argv.index('--root')+1]==str(installation) and argv[argv.index('--state')+1]==str(state)
   (app/'local-runtime/transformation').mkdir(parents=True);runtime.parent.mkdir(parents=True)
   runtime.write_bytes(node);runtime.chmod(0o755)
   (app/'local-runtime/transformation/cli.mjs').write_text('// inert CLI fixture\n')
   (app/'local-runtime/transformation/source-inventory.json').write_bytes(inventory)
   (app/'local-preview-manifest.json').write_bytes(manifest)
   value={'installation':str(installation),'state':str(state),'archiveSHA256':archive_sha,'sourceCommit':source,'version':'0.1.0-alpha.7','started':False,'authority':'none','node':{'binarySHA256':hashlib.sha256(node).hexdigest()},'manifestSHA256':hashlib.sha256(manifest).hexdigest()}
   if scenario=='archive':value['archiveSHA256']='0'*64
   if scenario=='source':value['sourceCommit']='b'*40
   if scenario=='version':value['version']='0.1.0-alpha.6'
   if scenario=='installation':value['installation']=str(root/'separate-extraction')
   if scenario=='state':value['state']=str(root/'different-state')
   if scenario=='started':value['started']=True
   if scenario=='authority':value['authority']='fixture-invalid-authority'
   if scenario=='node-hash':value['node']['binarySHA256']='0'*64
   if scenario=='manifest-hash':value['manifestSHA256']='0'*64
   return json.dumps(value)
  def run(argv,**kwargs):
   assert argv==[str(runtime),'--check',str(app/'local-runtime/transformation/cli.mjs')] and kwargs['check'] is True
   checked.append(argv)
   if scenario=='syntax':raise RuntimeError('inert syntax-check failure')
  original=Path.cwd()
  try:
   os.chdir(workspace)
   with mock.patch.dict(os.environ,{'RUNNER_TEMP':str(runner),'GITHUB_OUTPUT':str(outputs),'GITHUB_SHA':source}),mock.patch('os.getuid',return_value=0 if scenario=='root' else 1001),mock.patch('urllib.request.urlretrieve',side_effect=download),mock.patch('subprocess.check_output',side_effect=check_output),mock.patch('subprocess.run',side_effect=run):
    try:exec(compile(code,'<inert normal-installer argument fixture>','exec'),{})
    except (AssertionError,RuntimeError):
     assert scenario!='valid',scenario
     assert outputs.read_bytes()==b'' and not (workspace/'reports/ti/installed-binding.json').exists(),scenario
    else:
     assert scenario=='valid',scenario
     observed=dict(line.split('=',1) for line in outputs.read_text().splitlines())
     assert observed=={'application':str(app),'node':str(runtime),'archive':archive_sha}
     binding=json.loads((workspace/'reports/ti/installed-binding.json').read_bytes())
     assert binding['application']==str(app) and binding['nodeExecutable']==str(runtime)
     assert binding['sourceCommit']==source and binding['archiveSHA256']==archive_sha
     assert binding['uid']==1001 and binding['started'] is False and binding['authority']=='none'
     assert checked==[[str(runtime),'--check',str(app/'local-runtime/transformation/cli.mjs')]]
  finally:os.chdir(original)
print('NORMAL_INSTALLER_ARGUMENT_BINDING_PASS 12_INERT_SCENARIOS_NO_INSTALL_OR_EXECUTION')
`],{encoding:'utf8',timeout:30_000});
  assert.match(result,/NORMAL_INSTALLER_ARGUMENT_BINDING_PASS 12_INERT_SCENARIOS_NO_INSTALL_OR_EXECUTION/);
});
