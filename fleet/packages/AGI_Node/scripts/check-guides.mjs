import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {digest} from './guide-support.mjs';
export function auditCurrent(text,c){
 const errors=[];
 for(const m of text.matchAll(/Current application:\s*\*\*([\d.]+)\*\*/g))if(m[1]!==c[c.role])errors.push('Stale current application '+m[1]);
 for(const m of text.matchAll(/AGI_Autonomous_Fleet_v(\d+\.\d+\.\d+)/g))if(m[1]!==c.fleet)errors.push('Stale setup folder '+m[1]);
 if(/Current upgrade.{0,30}review retainers|employer-funded reviewer retainers, confirmed collection before paid Node work/i.test(text))errors.push('Obsolete retainer instruction');
 if(/schemaVersion: 2.*legacy 1|Version 2 for action-bound integration/.test(text))errors.push('Obsolete current admission reference');
 return errors;
}
export function auditVersionLabels(text,version){return [...text.matchAll(/(?:id="appVersion"|data-app-version)[^>]*>([\d.]+)/g)].filter(m=>m[1]!==version).map(m=>'Stale UI version '+m[1]);}
export function freshness(source,html){return html.includes('<meta name="source-sha256" content="'+digest(source)+'">');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const c=JSON.parse(read('config/companion-releases.json')),pkg=JSON.parse(read('package.json')),errors=[];
 execFileSync(process.execPath,[path.join(root,'scripts/current-guides.mjs')],{stdio:['ignore','ignore','inherit']});
 const docs=['README.md',...fs.readdirSync(path.join(root,'docs')).filter(x=>x.endsWith('.md')).map(x=>'docs/'+x),...['NOTICE.md','contract/PROVENANCE.md'].filter(x=>fs.existsSync(path.join(root,x)))];
 const pages=['START_HERE.html',...docs.map(x=>x.replace(/\.md$/,'.html'))];let links=0;
 for(const md of docs){
  const source=read(md),html=md.replace(/\.md$/,'.html');
  if(!fs.existsSync(path.join(root,html))||!freshness(source,read(html)))errors.push(md+': stale HTML');
  if(!/^# Historical|^# Changelog/i.test(source))for(const issue of auditCurrent(source,c))errors.push(md+': '+issue);
 }
 for(const page of pages){if(!fs.existsSync(path.join(root,page))){errors.push(page+': missing page');continue;}
  for(const m of read(page).matchAll(/(?:href|src)="([^"<>]+)"/g)){
   const href=m[1];if(/^[a-z]+:/i.test(href)||href.startsWith('//'))continue;
   const [file,anchor]=href.split('#'),target=path.resolve(root,path.dirname(page),decodeURIComponent(file.split('?')[0]||path.basename(page)));links++;
   if(!(target===root||target.startsWith(root+path.sep))||!fs.existsSync(target)){errors.push(page+' -> '+href+': outside or missing');continue;}
   if(anchor&&target.endsWith('.html')){const ids=[...fs.readFileSync(target,'utf8').matchAll(/(?:id|name)="([^"]+)"/g)].map(x=>x[1]);if(!ids.includes(decodeURIComponent(anchor)))errors.push(page+' -> '+href+': missing anchor');}
  }
 }
 if(!read('START_HERE.html').includes(pkg.version))errors.push('Start page edition differs');
 const plist=read('AGI Node.app/Contents/Info.plist');
 for(const key of ['CFBundleShortVersionString','CFBundleVersion'])if(!plist.includes('<key>'+key+'</key>\n\t<string>'+pkg.version+'</string>'))errors.push('Mac app version differs: '+key);
 for(const [name,command] of Object.entries(pkg.scripts))for(const m of command.matchAll(/(?:^|\s)(?:node\s+)?((?:src|scripts|ops|tests|fleet|workforce)\/[\w./*-]+\.[cm]?js)/g))if(!m[1].includes('*')&&!fs.existsSync(path.join(root,m[1])))errors.push('Missing script: '+name+' -> '+m[1]);
 const ui=c.role==='fleet'?'web/index.html':'app/index.html';
 for(const issue of auditVersionLabels(read(ui),pkg.version))errors.push(ui+': '+issue);
 const lock=JSON.parse(read('package-lock.json'));if(lock.version!==pkg.version||lock.packages?.['']?.version!==pkg.version)errors.push('Package-lock version differs');
 if(c[c.role]!==pkg.version)errors.push('Companion release metadata differs');
 if(!freshness(read('START_HERE.md'),read('START_HERE.html')))errors.push('Start Here Markdown/HTML differ');
 for(const name of fs.readdirSync(root).filter(x=>x.endsWith('.app'))){const plist=read(name+'/Contents/Info.plist');for(const m of plist.matchAll(/<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>([^<]+)<\/string>/g))if(m[1]!==pkg.version)errors.push(name+': stale launcher version '+m[1]);}
 const launchers=fs.readdirSync(root).filter(x=>x.endsWith('.command'));
 for(const name of launchers)if((fs.statSync(path.join(root,name)).mode&0o111)===0)errors.push('Launcher not executable: '+name);
 const result={role:c.role,version:pkg.version,passed:errors.length===0,markdown:docs.length,pages:pages.length,localLinks:links,launchers:launchers.length,errors};console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
}
