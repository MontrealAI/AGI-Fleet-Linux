#!/usr/bin/env python3
"""Synthetic offline input fixture; never accesses the host desktop."""
import json, os, time, tkinter as tk
from pathlib import Path
ROOT = Path('/workspace/selftest')
INPUT = json.loads(Path('/proof-input/input.json').read_text())
EXPECTED = INPUT['desktopChallenge']
def main():
    ROOT.mkdir(exist_ok=True)
    r = tk.Tk(); r.title('AGI local input check'); r.geometry('680x260+100+100'); r.resizable(False,False)
    tk.Label(r,text='Offline challenge: '+EXPECTED,font=('DejaVu Sans',11)).place(x=20,y=10,width=640,height=30)
    value=tk.StringVar(); entry=tk.Entry(r,textvariable=value,font=('DejaVu Sans',13),insertontime=600,insertofftime=0,exportselection=False)
    entry.place(x=20,y=60,width=630,height=40); last=[time.monotonic()]; events=[]; saved=[False]; clicks=[0]
    def event(kind):
        last[0]=time.monotonic(); events.append({'kind':kind,'at':last[0]}); del events[:-20]
    def save():
        clicks[0]+=1; (ROOT/'submitted.json').write_text(json.dumps({'runID':INPUT['runID'],'value':entry.get(),'clicks':clicks[0]})); saved[0]=True; event('save')
    button=tk.Button(r,text='Submit challenge',command=save,takefocus=0); button.place(x=20,y=130,width=180,height=40)
    value.trace_add('write',lambda *args:event('text'))
    for sequence,kind in [('<FocusIn>','focus-in'),('<FocusOut>','focus-out'),('<KeyRelease>','key-release'),('<<Paste>>','paste'),('<Configure>','configure'),('<Expose>','expose')]: entry.bind(sequence,lambda e,k=kind:event(k),add='+')
    for sequence,kind in [('<Configure>','configure'),('<Expose>','expose')]: r.bind(sequence,lambda e,k=kind:event(k),add='+')
    def geom(widget): return {'X':widget.winfo_rootx(),'Y':widget.winfo_rooty(),'WIDTH':widget.winfo_width(),'HEIGHT':widget.winfo_height()}
    def pulse():
        r.update_idletasks(); state={'schema':'agi-synthetic-fixture/v1','ready':bool(r.winfo_viewable()),'at':time.monotonic(),'lastVisualEvent':last[0],'textMatches':value.get()==EXPECTED,'focus':'entry' if r.focus_get() is entry else 'other','windowID':r.winfo_id(),'entryID':entry.winfo_id(),'selected':bool(entry.selection_present()),'saved':saved[0],'geometry':geom(r),'entryGeometry':geom(entry),'saveGeometry':geom(button),'caret':{'on':int(entry.cget('insertontime')),'off':int(entry.cget('insertofftime'))},'events':list(events)}
        temp=ROOT/'fixture-state.tmp'; temp.write_text(json.dumps(state)); os.replace(temp,ROOT/'fixture-state.json'); r.after(50,pulse)
    r.after_idle(pulse); r.mainloop()
if __name__=='__main__': main()
