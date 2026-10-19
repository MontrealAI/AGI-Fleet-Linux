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
