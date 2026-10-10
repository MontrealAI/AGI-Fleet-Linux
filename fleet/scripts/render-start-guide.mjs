import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apps=[root,...Object.values(JSON.parse(fs.readFileSync(path.join(root,'config/role-registry.json'))).roles).map(role=>path.join(root,'packages',role.package))];
const css='*{box-sizing:border-box}body{margin:0;background:#0c1020;color:#f5f6fd;font:17px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}main{max-width:1040px;margin:auto;padding:64px 24px;overflow-wrap:anywhere}small{color:#b9bdd9;letter-spacing:.1em}h1{font-size:clamp(34px,5vw,52px);letter-spacing:-.04em;line-height:1.15}h2{font-size:25px;margin-top:2em}p,li{color:#c8cee3}li{margin:.65em 0}a{color:#d5d1ff;text-underline-offset:4px}strong{color:#f5f6fd}a:focus-visible{outline:3px solid #eed8a5;outline-offset:4px}table{border-collapse:collapse;width:100%}td,th{padding:.75em;border:1px solid #4b5272}code{overflow-wrap:anywhere}@media(max-width:600px){main{padding:32px 20px}h1{font-size:34px}}@media print{body{background:white;color:black}p,li,a,strong{color:black}}';
for(const app of apps){
 const md=fs.readFileSync(path.join(app,'START_HERE.md'),'utf8'),version=JSON.parse(fs.readFileSync(path.join(app,'package.json'))).version,title=md.split('\n')[0].replace(/^#+\s*/,'');
 const body=marked.parse(md).replace(/href="([^"#:]+)\.md(#[^"]*)?"/g,'href="$1.html$2"');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="source-sha256" content="${crypto.createHash('sha256').update(md).digest('hex')}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${css}</style></head><body><main><small>MONTREAL.AI / ${version} / CONTROLLED CANDIDATE</small>${body}</main></body></html>\n`;
 const destination=path.join(app,'START_HERE.html');
 if(process.argv.includes('--check')){if(fs.readFileSync(destination,'utf8')!==html)throw Error('START_GUIDE_STALE');}else fs.writeFileSync(destination,html);
}
console.log('Start guides match the existing-account commissioning procedure.');
