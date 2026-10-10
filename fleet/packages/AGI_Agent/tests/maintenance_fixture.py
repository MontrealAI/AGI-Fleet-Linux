import importlib.util,unittest,subprocess,json
from pathlib import Path
from unittest.mock import patch
from PIL import Image
spec=importlib.util.spec_from_file_location('selftest',Path(__file__).resolve().parents[1]/'compute/workstation/selftest.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MaintenanceFixture(unittest.TestCase):
 def test_waits_for_typed_text_focus_and_quiet(self):
  ticks=[0]
  def pause(t):ticks[0]+=t
  def state():return {'ready':True,'focus':'entry' if ticks[0]>=.2 else 'other','textMatches':ticks[0]>=.5,'caret':{'off':0},'lastVisualEvent':.5,'geometry':{},'selected':False}
  m.quiescent_frame(observe=lambda *a:{'frame':'same'},state=state,clock=lambda:ticks[0],pause=pause,quiet=.2,timeout=2,focus=True,typed=True)
  self.assertGreaterEqual(ticks[0],.7)
 def test_blinking_caret_never_qualifies(self):
  ticks=[0]
  def pause(t):ticks[0]+=t
  with self.assertRaisesRegex(RuntimeError,'DID_NOT_SETTLE'):m.quiescent_frame(state=lambda:{'ready':True,'caret':{'off':300}},clock=lambda:ticks[0],pause=pause,timeout=.2)
 def test_pending_visual_event_invalidates_otherwise_stable_scene(self):
  ticks=[0];calls=[0]
  def pause(t):ticks[0]+=t
  def state():calls[0]+=1;return {'ready':True,'caret':{'off':0},'lastVisualEvent':ticks[0],'geometry':{}}
  with self.assertRaisesRegex(RuntimeError,'DID_NOT_SETTLE'):m.quiescent_frame(observe=lambda *a:{'frame':'same'},state=state,clock=lambda:ticks[0],pause=pause,quiet=.2,timeout=.5)
 def run_actions(self,exitcode,failures):
  image=Image.new('RGB',(1440,900));n=[0];sent=[]
  state={'entryGeometry':{'X':120,'Y':141,'WIDTH':450,'HEIGHT':40},'saveGeometry':{'X':120,'Y':211,'WIDTH':120,'HEIGHT':40},'geometry':{},'focus':'entry','entryID':1,'windowID':2,'textMatches':True,'selected':False,'caret':{'on':600,'off':0},'events':[]}
  def acquire(**kw):n[0]+=1;return {'frame':'frame-'+str(n[0])},state
  def send(*args):
   sent.append(args)
   if len(sent)<=failures:raise m.CheckFailure('desktop-click',[],subprocess.CompletedProcess([],exitcode,json.dumps({'error':'DESKTOP_SCENE_CHANGED_OBSERVE_AGAIN'}),''))
   return {'frame':'after'}
  actions=m.FixtureActions(capture=True)
  with patch.object(m,'quiescent_frame',side_effect=acquire),patch.object(m,'desktop',side_effect=send),patch('PIL.Image.open',return_value=image),patch.object(m.Path,'read_text',return_value='{"frame":"rejected"}'):
   try:actions.perform('save-button','click',target='save',focus=True,typed=True)
   except m.CheckFailure:pass
  return actions,sent
 def test_save_uses_real_widget_center_and_new_exact_frame_after_predispatch_rejection(self):
  a,sent=self.run_actions(1,1);self.assertEqual(len(sent),2);self.assertEqual(sent[0],('click','--frame','frame-1','--x','180','--y','231'));self.assertEqual(sent[1][2],'frame-2');self.assertEqual(a.attempts[0]['outcome'],'rejected-before-dispatch');self.assertEqual(len(a.images),2)
 def test_ambiguous_exit_never_replays_action(self):
  a,sent=self.run_actions(124,3);self.assertEqual(len(sent),1);self.assertEqual(a.attempts[0]['outcome'],'ambiguous-failure')
 def test_known_rejections_are_bounded_and_all_attempts_retained(self):
  a,sent=self.run_actions(1,9);self.assertEqual(len(sent),3);self.assertEqual(len(a.attempts),3);self.assertEqual(len(a.images),6)
 def test_diff_reports_exact_changed_pixels_and_box(self):
  a=Image.new('RGB',(5,5));b=a.copy();b.putpixel((2,3),(1,0,0));self.assertEqual(m.pixel_diff(a,b),{'changedPixels':1,'bbox':(2,3,3,4)})
if __name__=='__main__':unittest.main()
