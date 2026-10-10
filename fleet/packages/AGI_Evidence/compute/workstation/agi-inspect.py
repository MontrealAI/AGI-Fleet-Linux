#!/usr/bin/env python3
import argparse,json,os,subprocess,sys,zipfile,tempfile
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description='Render actual files inside the disposable work container.');p.add_argument('file');p.add_argument('--out',required=True);a=p.parse_args();f=Path(a.file).resolve();out=Path(a.out).resolve()
 if not any(f.is_relative_to(r) for r in [Path('/workspace'),Path('/job-input')]) or not out.is_relative_to(Path('/workspace')):raise RuntimeError('INSPECT_SCOPE')
 if not f.is_file() or f.stat().st_size>4194304:raise RuntimeError('INSPECT_SIZE')
 out.mkdir(parents=True,exist_ok=True);env={**os.environ,'HOME':'/tmp/agi-inspect-home'};Path(env['HOME']).mkdir(exist_ok=True);suffix=f.suffix.lower();results=[]
 if suffix in ['.docx','.xlsx','.pptx']:
  pdf=out/(f.stem+'.pdf')
  if pdf.exists() or pdf.is_symlink():pdf.unlink()
  with tempfile.TemporaryDirectory(prefix='agi-render-') as profile:
   subprocess.run(['libreoffice','-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','pdf','--outdir',str(out),str(f)],env=env,check=True,timeout=90,capture_output=True)
  if not pdf.is_file() or pdf.is_symlink():raise RuntimeError('INSPECT_CONVERSION_FAILED')
 elif suffix=='.pdf':pdf=f
 else:pdf=None
 if pdf:
  subprocess.run(['pdftotext','-layout',str(pdf),str(out/'text.txt')],check=True,timeout=30,capture_output=True)
  info=subprocess.run(['pdfinfo',str(pdf)],check=True,timeout=15,capture_output=True,text=True).stdout
  pages=int(next(line.split(':',1)[1].strip() for line in info.splitlines() if line.startswith('Pages:')))
  if pages>24:raise RuntimeError('INSPECT_PAGE_LIMIT_REVIEW_INCOMPLETE')
  subprocess.run(['pdftoppm','-png','-scale-to','1280','-f','1','-l',str(pages),str(pdf),str(out/'page')],check=True,timeout=90,capture_output=True)
  results=[str(x) for x in sorted(out.iterdir()) if x.is_file()]
 else:results=[str(f)]
 return {'source':str(f),'rendered':results,'note':'Inspect every relevant page, source formula and test result. Rendering alone is not acceptance.'}
if __name__=='__main__':
 try:print(json.dumps(main()))
 except Exception as e:print(json.dumps({'error':str(e)[:200]}));sys.exit(1)
