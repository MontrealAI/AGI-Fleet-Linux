import importlib.util,unittest,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('selftest',Path(__file__).resolve().parents[1]/'compute/workstation/selftest.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FixtureProtocol(unittest.TestCase):
 def test_settles_on_three_matching_frames(self):
  frames=iter(['a','b','b','b']);ticks=[0]
  def pause(x):ticks[0]+=x
  frame,g=m.stable_frame(observe=lambda *a:{'frame':next(frames)},locate=lambda:{'X':100,'Y':100,'WIDTH':500,'HEIGHT':220},clock=lambda:ticks[0],pause=pause)
  self.assertEqual(frame['frame'],'b');self.assertEqual(round(ticks[0],2),.45)
 def test_unstable_scene_times_out(self):
  ticks=[0]
  def pause(x):ticks[0]+=x
  with self.assertRaisesRegex(RuntimeError,'DID_NOT_SETTLE'):m.stable_frame(observe=lambda *a:{'frame':str(ticks[0])},locate=lambda:{},clock=lambda:ticks[0],pause=pause,timeout=.4)
 def test_scene_change_reacquires_exact_frame(self):
  tokens=[];n=[0]
  def acquire():n[0]+=1;return {'frame':str(n[0])},{}
  def observe(*a):
   tokens.append(a[2])
   if len(tokens)<2:raise m.CheckFailure('click',['agi-desktop'],subprocess.CompletedProcess([],1,'{"error":"DESKTOP_SCENE_CHANGED_OBSERVE_AGAIN"}','diagnostic'))
   return {'ok':True}
  self.assertTrue(m.fixture_action('click',[],observe=observe,acquire=acquire)['ok']);self.assertEqual(tokens,['1','2'])
 def test_other_failure_never_retries(self):
  n=[0]
  def acquire():n[0]+=1;return {'frame':'exact'},{}
  def observe(*a):raise m.CheckFailure('click',['agi-desktop'],subprocess.CompletedProcess([],2,'{"error":"DESKTOP_FRESH_SCREENSHOT_REQUIRED"}','inner stderr'))
  with self.assertRaises(m.CheckFailure) as e:m.fixture_action('click',[],observe=observe,acquire=acquire)
  self.assertEqual(n[0],1);self.assertEqual(e.exception.detail['stderr'],'inner stderr');self.assertEqual(e.exception.detail['exitCode'],2)
 def test_bounded_scene_retries(self):
  n=[0]
  def acquire():n[0]+=1;return {'frame':str(n[0])},{}
  def observe(*a):raise m.CheckFailure('click',[],subprocess.CompletedProcess([],1,'{"error":"DESKTOP_SCENE_CHANGED_OBSERVE_AGAIN"}',''))
  with self.assertRaises(m.CheckFailure):m.fixture_action('click',[],observe=observe,acquire=acquire)
  self.assertEqual(n[0],3)
if __name__=='__main__':unittest.main()
