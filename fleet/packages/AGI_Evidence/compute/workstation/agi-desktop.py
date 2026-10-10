#!/usr/bin/env python3
import argparse,hashlib,json,os,shutil,subprocess,sys,time,uuid
from pathlib import Path
from PIL import ImageGrab
ROOT=Path('/tmp/agi-desktop'); DISPLAY=':99'; WIDTH=1440; HEIGHT=900

def run(args,**kwargs):
 return subprocess.run(args,env={**os.environ,'DISPLAY':DISPLAY,'HOME':str(ROOT/'home'),'XDG_CONFIG_HOME':str(ROOT/'home'/'.config'),'XDG_CACHE_HOME':str(ROOT/'home'/'.cache')},check=True,timeout=kwargs.pop('timeout',20),capture_output=True,**kwargs)
def load():
 p=ROOT/'state.json'
 if not p.exists():raise RuntimeError('DESKTOP_NOT_STARTED')
 s=json.loads(p.read_text());os.kill(s['pid'],0);return s
def start():
 if (ROOT/'state.json').exists():
  try:return load()
  except (ProcessLookupError,FileNotFoundError):pass
 ROOT.mkdir(mode=0o700,parents=True,exist_ok=True);(ROOT/'home').mkdir(exist_ok=True)
 log=open(ROOT/'desktop.log','ab')
 child=subprocess.Popen(['Xvfb',DISPLAY,'-screen','0',f'{WIDTH}x{HEIGHT}x24','-nolisten','tcp','-noreset'],stdout=log,stderr=log,start_new_session=True)
 s={'pid':child.pid,'session':str(uuid.uuid4()),'display':DISPLAY,'width':WIDTH,'height':HEIGHT}
 for _ in range(100):
  if child.poll() is not None:raise RuntimeError('DESKTOP_START_FAILED')
  try:run(['xdpyinfo','-display',DISPLAY]);break
  except Exception:time.sleep(.05)
 else:child.terminate();raise RuntimeError('DESKTOP_START_TIMEOUT')
 env={**os.environ,'DISPLAY':DISPLAY,'HOME':str(ROOT/'home')}
 subprocess.Popen(['fluxbox'],env=env,stdout=log,stderr=log,start_new_session=True)
 (ROOT/'state.json').write_text(json.dumps(s));return s

def shot():
 s=load();im=ImageGrab.grab(xdisplay=DISPLAY)
 if im.size!=(WIDTH,HEIGHT):raise RuntimeError('DESKTOP_GEOMETRY_CHANGED')
 frame=hashlib.sha256(s['session'].encode()+im.tobytes()).hexdigest();target=Path('/workspace/.agi-desktop/screen.png');target.parent.mkdir(parents=True,exist_ok=True);im.save(target)
 record={'frame':frame,'at':time.time(),'screenshot':str(target),'width':WIDTH,'height':HEIGHT,'session':s['session']};(ROOT/'frame.json').write_text(json.dumps(record));return record

def observed(frame):
 previous=json.loads((ROOT/'frame.json').read_text())
 if previous['frame']!=frame or time.time()-previous['at']>30:raise RuntimeError('DESKTOP_FRESH_SCREENSHOT_REQUIRED')
 current=shot()
 if current['frame']!=frame:raise RuntimeError('DESKTOP_SCENE_CHANGED_OBSERVE_AGAIN')

def coord(x,y):
 if x is None or y is None or not (0<=x<WIDTH and 0<=y<HEIGHT):raise RuntimeError('DESKTOP_COORDINATES')
 return str(x),str(y)
def file_path(value):
 p=Path(value).resolve()
 if not any(p.is_relative_to(root) for root in [Path('/workspace'),Path('/job-input')]):raise RuntimeError('DESKTOP_FILE_SCOPE')
 return str(p)
def main():
 p=argparse.ArgumentParser(description='See and operate only this disposable Linux work desktop.')
 p.add_argument('action',choices=['start','screenshot','click','double-click','right-click','move','drag','scroll','type','key','wait','launch','status'])
 p.add_argument('--frame');p.add_argument('--x',type=int);p.add_argument('--y',type=int);p.add_argument('--to-x',type=int);p.add_argument('--to-y',type=int);p.add_argument('--text',default='');p.add_argument('--key');p.add_argument('--direction',choices=['up','down','left','right']);p.add_argument('--amount',type=int,default=3);p.add_argument('--seconds',type=float,default=.3);p.add_argument('--app',choices=['writer','calc','impress','draw','editor','browser']);p.add_argument('--file')
 a=p.parse_args();start()
 if a.action in ['start','screenshot','status']:return shot()
 if a.action=='wait':
  if not 0<=a.seconds<=5:raise RuntimeError('DESKTOP_WAIT_LIMIT')
  time.sleep(a.seconds);return shot()
 if a.action=='launch':
  programs={'writer':['libreoffice','--writer'],'calc':['libreoffice','--calc'],'impress':['libreoffice','--impress'],'draw':['libreoffice','--draw'],'editor':['mousepad'],'browser':['chromium','--no-sandbox','--disable-dev-shm-usage','--disable-extensions','--user-data-dir='+str(ROOT/'browser')]}
  if a.app not in programs:raise RuntimeError('DESKTOP_APP_REQUIRED')
  args=programs[a.app]+([file_path(a.file)] if a.file else [])
  env={**os.environ,'DISPLAY':DISPLAY,'HOME':str(ROOT/'home'),'XDG_CONFIG_HOME':str(ROOT/'home'/'.config')}
  log=open(ROOT/'apps.log','ab');subprocess.Popen(args,env=env,stdout=log,stderr=log,start_new_session=True);time.sleep(.7);return shot()
 observed(a.frame)
 if a.action in ['click','double-click','right-click','move','drag']:
  run(['xdotool','mousemove','--sync',*coord(a.x,a.y)])
  if a.action=='drag':run(['xdotool','mousedown','1','mousemove','--sync',*coord(a.to_x,a.to_y),'mouseup','1'])
  elif a.action!='move':run(['xdotool','click','--repeat','2' if a.action=='double-click' else '1','--delay','80','3' if a.action=='right-click' else '1'])
 elif a.action=='scroll':
  if a.direction is None or not 1<=a.amount<=20:raise RuntimeError('DESKTOP_SCROLL_LIMIT')
  run(['xdotool','click','--repeat',str(a.amount),{'up':'4','down':'5','left':'6','right':'7'}[a.direction]])
 elif a.action=='type':
  if not a.text or len(a.text.encode())>20000 or '\0' in a.text:raise RuntimeError('DESKTOP_TEXT_LIMIT')
  subprocess.run(['xclip','-selection','clipboard'],input=a.text.encode(),env={**os.environ,'DISPLAY':DISPLAY},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5);run(['xdotool','key','--clearmodifiers','ctrl+v'])
 elif a.action=='key':
  allowed=set('abcdefghijklmnopqrstuvwxyz0123456789')|{'ctrl','alt','shift','super','Return','Tab','Escape','BackSpace','Delete','Left','Right','Up','Down','Home','End','Page_Up','Page_Down','space'}|{f'F{i}' for i in range(1,13)}
  if not a.key or len(a.key)>60 or any(k not in allowed for k in a.key.split('+')):raise RuntimeError('DESKTOP_KEY_INVALID')
  run(['xdotool','key','--clearmodifiers',a.key])
 time.sleep(.15)
 trace=ROOT/'actions.jsonl'
 if trace.exists() and trace.stat().st_size>1048576:raise RuntimeError('DESKTOP_ACTION_LIMIT')
 with trace.open('a') as f:f.write(json.dumps({'at':time.time(),'action':a.action,'frame':a.frame,'textBytes':len(a.text.encode()),'textHash':hashlib.sha256(a.text.encode()).hexdigest() if a.text else None})+'\n')
 return shot()
if __name__=='__main__':
 try:print(json.dumps(main()))
 except Exception as e:print(json.dumps({'error':str(e)[:200]}));sys.exit(1)
