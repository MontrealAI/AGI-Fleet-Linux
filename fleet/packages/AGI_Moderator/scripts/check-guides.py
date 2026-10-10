#!/usr/bin/env python3
"""Check all standalone guide sets, including content freshness and anchors."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[1]
results=[]
for app in [root,root/'packages/AGI_Agent',root/'packages/AGI_Node']:
 p=subprocess.run(['node','scripts/check-guides.mjs'],cwd=app,text=True,capture_output=True)
 if p.returncode: print(p.stderr);print(p.stdout);raise SystemExit(p.returncode)
 results.append(json.loads(p.stdout))
report={'passed':True,'pages':sum(x['pages'] for x in results),'localLinks':sum(x['localLinks'] for x in results),'components':results,'scope':'Current standalone guides; generated README/inventory, source hashes, file and heading links, script files and executable Mac launchers. Historical evidence is not relabeled.'}
(root/'evidence/offline-links.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
