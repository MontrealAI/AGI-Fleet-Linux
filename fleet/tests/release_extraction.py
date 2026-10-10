import importlib.util,unittest,tempfile,zipfile,hashlib,json,stat,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'scripts/install-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReleaseExtraction(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name);self.top='AGI_Autonomous_Fleet_v9.9.9'
 def tearDown(self):self.tmp.cleanup()
 def archive(self,change=None):
  files={'package.json':b'{"version":"9.9.9"}','packages/AGI_Agent/a':b'agent','packages/AGI_Node/a':b'node'}
  for prefix in ['packages/AGI_Agent/','packages/AGI_Node/','']:
   files[prefix+'MANIFEST.sha256']=''.join(hashlib.sha256(v).hexdigest()+'  '+k[len(prefix):]+'\n' for k,v in sorted(files.items()) if k.startswith(prefix)).encode()
  if change:change(files)
  z=self.p/'release.zip'
  with zipfile.ZipFile(z,'w') as archive:
   for k,v in files.items():archive.writestr(self.top+'/'+k,v)
  return z,hashlib.sha256(z.read_bytes()).hexdigest()
 def test_verified_atomic_release_and_collision(self):
  z,h=self.archive();r=m.install(z,self.p,h,z.stat().st_size);self.assertTrue(r['allManifestsVerified']);self.assertTrue((self.p/self.top/'package.json').is_file())
  with self.assertRaisesRegex(ValueError,'ALREADY_EXISTS'):m.install(z,self.p,h)
 def test_hash_and_size_fail_before_extraction(self):
  z,h=self.archive()
  for sha,size in [('a'*64,None),(h,1)]:
   with self.assertRaisesRegex(ValueError,'MISMATCH'):m.install(z,self.p,sha,size)
  self.assertFalse((self.p/self.top).exists())
 def test_manifest_mismatch_cleans_partial_stage(self):
  z,h=self.archive(lambda f:f.update({'packages/AGI_Agent/a':b'changed'}))
  with self.assertRaisesRegex(ValueError,'HASH_MISMATCH'):m.install(z,self.p,h)
  self.assertEqual(list(self.p.iterdir()),[z])
 def test_unmanifested_files_fail_closed(self):
  z,h=self.archive(lambda f:f.update({'unexpected':b'no'}))
  with self.assertRaisesRegex(ValueError,'COVERAGE'):m.install(z,self.p,h)
 def test_parent_traversal_rejected(self):
  z,h=self.archive(lambda f:f.update({'../escape':b'no'}))
  with self.assertRaisesRegex(ValueError,'PATH_UNSAFE'):m.install(z,self.p,h)
  self.assertFalse((self.p/'escape').exists())
 def test_symlink_member_rejected(self):
  z,h=self.archive()
  with zipfile.ZipFile(z,'a') as archive:
   item=zipfile.ZipInfo(self.top+'/link');item.create_system=3;item.external_attr=(stat.S_IFLNK|0o777)<<16;archive.writestr(item,'/tmp')
  with self.assertRaisesRegex(ValueError,'LINK_OR_SPECIAL'):m.install(z,self.p,hashlib.sha256(z.read_bytes()).hexdigest())
 def test_unwritable_or_symlink_destination_rejected(self):
  z,h=self.archive();d=self.p/'blocked';d.mkdir(mode=0o500)
  try:
   with self.assertRaisesRegex(ValueError,'NOT_WRITABLE'):m.install(z,d,h)
  finally:d.chmod(0o700)
  link=self.p/'link';link.symlink_to(d)
  with self.assertRaisesRegex(ValueError,'OWNED_DIRECTORY'):m.install(z,link,h)
if __name__=='__main__':unittest.main()
