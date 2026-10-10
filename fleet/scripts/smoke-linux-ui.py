#!/usr/bin/env python3
"""Real loopback UI smoke using empty disposable profiles; not native installation acceptance."""
import argparse,hashlib,json,os,pathlib,signal,subprocess,tempfile,time,urllib.request
p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[1];rows=[]
for role in ['Agent','Node','Moderator','Employer','Evidence','Recovery']:
 app=root/'packages'/('AGI_'+role);record={'role':role,'state':'FAIL','realHTTP':False,'walletAccessed':False,'providerCalled':False}
 with tempfile.TemporaryDirectory(prefix='agi-linux-ui-') as td:
  home=pathlib.Path(td);profile=home/'profile';cmd=[a.node,str(app/('src/launch.mjs' if role in ('Agent','Node') else 'ops/launch.mjs')),'--home',str(profile),'--no-open','--port','0']
  if role not in ('Agent','Node'):cmd+=['--role',role.lower()]
  if role!='Evidence':cmd+=['--seed-profile']
  with (home/'process.log').open('w') as log:
   child=subprocess.Popen(cmd,cwd=app,env={**os.environ,'HOME':str(home),'NODE_NO_WARNINGS':'1'},stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    for attempt in range(150):
     if child.poll() is not None:break
     records=[*home.rglob('launch.json'),*home.rglob('panel.json')]
     if records:
      v=json.loads(records[0].read_text());url=v.get('url') or 'http://127.0.0.1:'+str(v['port'])+'/'
      try:
       with urllib.request.urlopen(url.split('#')[0],timeout=1) as res:
        data=res.read(4*1024*1024);expected=(app/('app/index.html' if role in ('Agent','Node') else 'web/index.html')).read_bytes()
        if res.status==200 and data==expected:record.update(state='PASS',realHTTP=True,exactHTMLSHA256=hashlib.sha256(data).hexdigest(),seedProfile=role!='Evidence');break
      except (OSError,ValueError):pass
     time.sleep(.1)
    if record['state']!='PASS':record['diagnostic']=(home/'process.log').read_text()[-1500:]
   finally:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:child.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
 rows.append(record)
value={'schema':'agi-linux-real-ui-smoke/v1','status':'PASS' if all(x['state']=='PASS' for x in rows) else 'FAIL','scope':'Real Node launch modules and exact served HTML using empty disposable profiles; shell bootstrap, desktop keyring, systemd, Docker, native ownership and OAuth installation are NOT exercised.','results':rows};a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value,indent=2));raise SystemExit(0 if value['status']=='PASS' else 1)
