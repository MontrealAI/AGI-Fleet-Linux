import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const need=(v)=>{if(!v)throw Error('SERVICE_UNAVAILABLE');};
const quote=s=>'"'+String(s).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"';
export function linuxBackground({label,args,enabled}){
 need(process.platform==='linux'&&process.getuid()>=1000&&/^[a-zA-Z0-9._-]+$/.test(label)&&args.every(x=>typeof x==='string'&&!/[\x00-\x1f\x7f]/.test(x)));
 let directory=os.homedir();const safe=dir=>{const s=fs.lstatSync(dir);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022));};safe(directory);
 for(const part of ['.config','systemd','user']){directory=path.join(directory,part);if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});safe(directory);}
 const file=path.join(directory,label+'.service'),env={HOME:os.homedir(),PATH:'/usr/bin:/bin',XDG_RUNTIME_DIR:'/run/user/'+process.getuid(),DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+process.getuid()+'/bus'};
 const control=a=>{const r=spawnSync('/usr/bin/systemctl',['--user',...a],{env,encoding:'utf8',timeout:15000,maxBuffer:65536});need(r.status===0&&!r.error&&!r.signal);};
 if(fs.existsSync(file)){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&s.nlink===1&&!(s.mode&0o077));}
 if(enabled){
  const content='[Unit]\nDescription=AGI signer login service\nAfter=graphical-session.target\n[Service]\nType=simple\nExecStart='+args.map(quote).join(' ')+'\nRestart=on-failure\nRestartSec=15\nUMask=0077\nNoNewPrivileges=yes\nLimitCORE=0\nStandardOutput=null\nStandardError=journal\n[Install]\nWantedBy=default.target\n';
  const temporary=file+'.new';const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);control(['daemon-reload']);control(['enable',label+'.service']);
 }else{control(['disable',label+'.service']);fs.rmSync(file,{force:true});control(['daemon-reload']);}
 return {enabled,nextLogin:true};
}
