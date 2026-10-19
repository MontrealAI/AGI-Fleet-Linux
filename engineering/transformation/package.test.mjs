// Whole bytes and modes, including actual CLI entrypoint; no refreshed-in-CI waiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
