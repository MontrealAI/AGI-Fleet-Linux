#!/usr/bin/env python3
"""Actual frame-bound local input probe. This is not model vision proof."""
import hashlib, importlib.util, json, os, subprocess, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('selftest','/usr/local/lib/agi-workstation-selftest.py')
helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
def main():
    incoming=json.loads(Path('/proof-input/input.json').read_text()); challenge=incoming['desktopChallenge']
    helper.desktop('start'); child=subprocess.Popen(['python3','/proof/desktop-fixture.py'],env={**os.environ,'DISPLAY':':99'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        actions=helper.FixtureActions(); actions.perform('focus-entry','click',target='entry')
        actions.perform('type-text','type',arguments=['--text',challenge],focus=True)
        actions.perform('save-button','click',target='save',focus=True,typed=True)
        target=Path('/workspace/selftest/submitted.json'); end=time.monotonic()+5
        while not target.exists() and time.monotonic()<end: time.sleep(.05)
        effect=json.loads(target.read_text())
        if effect!={'runID':incoming['runID'],'value':challenge,'clicks':1}: raise RuntimeError('CONTROLS_DESKTOP_EFFECT')
        helper.desktop('screenshot'); screenshot=Path('/workspace/.agi-desktop/screen.png').read_bytes(); Path('/workspace/proof/desktop.png').write_bytes(screenshot)
        trace=[json.loads(line) for line in Path('/tmp/agi-desktop/actions.jsonl').read_text().splitlines()]
        if not any(e['action']=='type' and e['textHash']==hashlib.sha256(challenge.encode()).hexdigest() for e in trace): raise RuntimeError('CONTROLS_DESKTOP_TRACE')
        return {'status':'PASS','capability':'local-desktop-input','effect':effect,'actions':trace,'screenshotSHA256':hashlib.sha256(screenshot).hexdigest(),'modelDriven':False,'visionTested':False,'challengeReadMethod':'trusted-fixture-input','attempts':[{'action':a['action'],'attempt':a['attempt'],'outcome':a.get('outcome'),'frameBefore':a['frameBefore']} for a in actions.attempts]}
    finally:
        child.terminate()
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
if __name__=='__main__':
    try: print(json.dumps(main()))
    except Exception as e: print(json.dumps({'status':'FAIL','code':str(e) if str(e).startswith('CONTROLS_') else 'CONTROLS_DESKTOP_UNAVAILABLE','modelDriven':False})); raise SystemExit(1)
