#!/usr/bin/env python3
import json,os,time,tkinter as tk
from pathlib import Path

ROOT=Path('/workspace/selftest')
EXPECTED='AGI keyboard and mouse verified'

def main():
    ROOT.mkdir(exist_ok=True)
    r=tk.Tk();r.title('AGI local input check');r.geometry('500x220+100+100');r.resizable(False,False)
    value=tk.StringVar()
    entry=tk.Entry(r,textvariable=value,font=('DejaVu Sans',16),insertontime=600,insertofftime=0,exportselection=False)
    entry.place(x=20,y=20,width=450,height=40)
    last=[time.monotonic()];events=[];saved=[False]
    def event(kind):
        last[0]=time.monotonic();events.append({'kind':kind,'at':last[0]});del events[:-20]
    def save():
        (ROOT/'typed.txt').write_text(entry.get());saved[0]=True;event('save')
    button=tk.Button(r,text='Save',command=save,takefocus=0,activebackground='#d9d9d9',background='#d9d9d9')
    button.place(x=20,y=90,width=120,height=40)
    value.trace_add('write',lambda *args:event('text'))
    for sequence,kind in [('<FocusIn>','focus-in'),('<FocusOut>','focus-out'),('<KeyRelease>','key-release'),('<<Paste>>','paste'),('<Configure>','configure'),('<Expose>','expose')]:
        entry.bind(sequence,lambda e,k=kind:event(k),add='+')
    for sequence,kind in [('<Configure>','configure'),('<Expose>','expose')]:r.bind(sequence,lambda e,k=kind:event(k),add='+')
    def pulse():
        r.update_idletasks()
        state={'schema':'agi-synthetic-fixture/v1','ready':bool(r.winfo_viewable()),'at':time.monotonic(),'lastVisualEvent':last[0],
          'textMatches':value.get()==EXPECTED,'textLength':len(value.get()),'focus':'entry' if r.focus_get() is entry else 'other',
          'windowID':r.winfo_id(),'entryID':entry.winfo_id(),'selected':bool(entry.selection_present()),'saved':saved[0],
          'geometry':{'X':r.winfo_rootx(),'Y':r.winfo_rooty(),'WIDTH':r.winfo_width(),'HEIGHT':r.winfo_height()},
          'entryGeometry':{'X':entry.winfo_rootx(),'Y':entry.winfo_rooty(),'WIDTH':entry.winfo_width(),'HEIGHT':entry.winfo_height()},
          'saveGeometry':{'X':button.winfo_rootx(),'Y':button.winfo_rooty(),'WIDTH':button.winfo_width(),'HEIGHT':button.winfo_height()},
          'caret':{'on':int(entry.cget('insertontime')),'off':int(entry.cget('insertofftime'))},'events':list(events)}
        tmp=ROOT/'fixture-state.tmp';tmp.write_text(json.dumps(state));os.replace(tmp,ROOT/'fixture-state.json');r.after(50,pulse)
    r.after_idle(pulse);r.mainloop()

if __name__=='__main__':main()
