import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {sanitizeDiagnostics} from '../src/control/system-preflight.mjs';
export const FIXTURE_STAGES=['initialization','fixture-start','stable-frame','focus-entry','keyboard','type-text','save-button','saved-file','docx-render','browser','complete'];
const CODES=new Set(['DESKTOP_SCENE_CHANGED_OBSERVE_AGAIN','DESKTOP_FRESH_SCREENSHOT_REQUIRED','DESKTOP_GEOMETRY_CHANGED','DESKTOP_NOT_STARTED','DESKTOP_START_FAILED','DESKTOP_START_TIMEOUT','SELFTEST_FIXTURE_NOT_READY','SELFTEST_FIXTURE_DID_NOT_SETTLE','SELFTEST_FIXTURE_START_TIMEOUT','SELFTEST_TYPED_FILE_MISMATCH','SELFTEST_RENDER_OUTPUT_MISSING','SELFTEST_BROWSER_OUTPUT_MISSING','SELFTEST_ACTION_ATTEMPTS_EXHAUSTED','SELFTEST_IMAGE_GEOMETRY','UNSTRUCTURED_ACTION_FAILURE']);
const number=(v,max=1e15)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
const error=v=>CODES.has(v)?v:'UNSTRUCTURED_ACTION_FAILURE';
const imageID=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v)?v:null;
const geometry=v=>v&&['X','Y','WIDTH','HEIGHT'].every(k=>Number.isInteger(v[k])&&v[k]>=0&&v[k]<=1440)?Object.fromEntries(['X','Y','WIDTH','HEIGHT'].map(k=>[k,v[k]])):null;
const eventKinds=['focus-in','focus-out','key-release','paste','configure','expose','text','save'];
function attempt(a){
  if(!FIXTURE_STAGES.includes(a?.stage)||!['click','key','type'].includes(a.action)||![1,2,3].includes(a.attempt))return null;
  const out={stage:a.stage,action:a.action,attempt:a.attempt,frameBefore:hash(a.frameBefore),frameAfter:hash(a.frameAfter),frameAtRejection:hash(a.frameAtRejection),geometry:geometry(a.geometry),fixtureWindow:number(a.fixtureWindow,2**32),focusedWidget:number(a.focusedWidget,2**32),focus:['entry','other'].includes(a.focus)?a.focus:null};
  for(const k of ['observedAt','dispatchStartedAt','finishedAt','changedPixels','exitCode'])out[k]=number(a[k],k==='changedPixels'?1440*900:1e15);
  for(const k of ['textMatches','selected'])if(typeof a[k]==='boolean')out[k]=a[k];
  if(a.error)out.error=error(a.error);
  if(['completed','rejected-before-dispatch','ambiguous-failure'].includes(a.outcome))out.outcome=a.outcome;
  out.bbox=Array.isArray(a.bbox)&&a.bbox.length===4&&a.bbox.every(x=>Number.isInteger(x)&&x>=0&&x<=1440)?a.bbox:null;
  out.caret={on:number(a.caret?.on,10000),off:number(a.caret?.off,10000)};
  out.events=(Array.isArray(a.events)?a.events:[]).slice(-20).filter(e=>eventKinds.includes(e.kind)).map(e=>({kind:e.kind,at:number(e.at)}));
  return out;
}
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;};
export function safeFixturePNG(value){
  if(typeof value!=='string'||value.length>240000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))return null;
  try{
    const b=Buffer.from(value,'base64');if(b.toString('base64')!==value||!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return null;
    let pos=8;const chunks=[],idat=[];let header=false,end=false,color;
    while(pos<b.length){const len=b.readUInt32BE(pos),name=b.toString('ascii',pos+4,pos+8);if(len>180000||pos+len+12>b.length)return null;const data=b.subarray(pos+8,pos+8+len);if(crc32(b.subarray(pos+4,pos+8+len))!==b.readUInt32BE(pos+8+len))return null;if(!header&&name!=='IHDR'||name==='IEND'&&len!==0||name==='IDAT'&&!header)return null;
      if(name==='IHDR'){if(header||len!==13||data.readUInt32BE(0)!==1440||data.readUInt32BE(4)!==900||data[8]!==8||![2,6].includes(data[9])||data[10]!==0||data[11]!==0||data[12]!==0)return null;header=true;color=data[9];}
      if(name==='IDAT')idat.push(data);
      if(['IHDR','IDAT','IEND'].includes(name))chunks.push(b.subarray(pos,pos+len+12));
      pos+=len+12;if(name==='IEND'){end=true;break;}
    }
    if(!header||!end||pos!==b.length||!idat.length)return null;
    const decoded=inflateSync(Buffer.concat(idat),{maxOutputLength:1440*900*4+900});if(decoded.length!==(1440*(color===2?3:4)+1)*900)return null;
    return Buffer.concat([b.subarray(0,8),...chunks]).toString('base64');
  }catch{return null;}
}
export function safeDesktopReport(report={}){
  const d=report.detail??{},inner=d.inner??d;
  let parsed={};try{parsed=JSON.parse(inner.stdout??'{}');}catch{}
  const code=d.error??parsed.error??d.attempts?.at(-1)?.error;
  const facts={stage:'desktop',exitCode:report.exitCode,oomKilled:report.oomKilled,walletAccessed:false,paidProviderCall:false,productionFrameRuleUnchanged:true,durationSeconds:d.durationSeconds,containerPeakBytes:Number(d.resources?.['memory.peak']),browserPeakRSSKiB:d.sampledProcessPeakRSSKiB?.browser,officePeakRSSKiB:d.sampledProcessPeakRSSKiB?.libreoffice,failure:report.passed?'NONE':report.oomKilled?'OOM':'DESKTOP_FAILED'};
  const out=sanitizeDiagnostics({facts});out.schema='agi-desktop-support/v2';out.passed=report.passed===true;
  out.runID=typeof report.runID==='string'&&/^[a-f0-9-]{36}$/.test(report.runID)?report.runID:null;
  out.imageID=imageID(report.imageID);out.packageManifestSHA256=hash(report.packageManifestSHA256);
  out.sourceHashes={};for(const name of ['selftest','fixture','desktop','dockerfile'])if(hash(report.sourceHashes?.[name]))out.sourceHashes[name]=report.sourceHashes[name];
  out.versions={};for(const name of ['fleet','agent','node','moderator','employer','evidence','recovery'])if(/^\d+\.\d+\.\d+$/.test(report.versions?.[name]??''))out.versions[name]=report.versions[name];
  out.stage=FIXTURE_STAGES.includes(d.stage)?d.stage:d.passed?'complete':'initialization';
  out.inner={stage:['desktop-click','desktop-key','desktop-type','desktop-screenshot','docx-render','browser','initialization'].includes(inner.stage)?inner.stage:null,exitCode:number(inner.exitCode),error:code?error(code):null,stdout:code?JSON.stringify({error:error(code)}):'',stderr:inner.stderr?'OMITTED_UNSTRUCTURED_STDERR':''};
  out.attempts=(Array.isArray(d.attempts)?d.attempts:[]).slice(0,12).map(attempt).filter(Boolean);
  out.retryCount=out.attempts.filter(a=>a.attempt>1).length;out.stageDurations={};
  for(const stage of FIXTURE_STAGES)if(number(d.stageDurations?.[stage])!==null)out.stageDurations[stage]=number(d.stageDurations[stage]);
  out.memoryEvents={};for(const line of String(d.resources?.['memory.events']??'').split('\n')){const [k,v]=line.split(' ');if(['low','high','max','oom','oom_kill','oom_group_kill','sock_throttled'].includes(k)&&/^\d+$/.test(v??''))out.memoryEvents[k]=Number(v);}
  out.syntheticFixture=report.isolatedSynthetic===true&&d.syntheticFixture===true;out.fixtureImages=[];
  if(out.syntheticFixture)for(const item of (Array.isArray(d.fixtureImages)?d.fixtureImages:[]).slice(0,6)){if(!/^(focus-entry|keyboard|type-text|save-button)-[123]-(before|rejected)\.png$/.test(item.name??''))continue;const png=safeFixturePNG(item.png);if(png)out.fixtureImages.push({name:item.name,png});}
  out.memoryLimitBytes=number(Number(d.resources?.['memory.max']));out.network='none';out.disclaimer='Synthetic disposable-desktop evidence only. No physical-Mac or commercial qualification is implied.';return out;
}
export function releaseIdentity(root){
  const sha=file=>{try{return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');}catch{return null;}};
  let versions={};try{versions=JSON.parse(fs.readFileSync(path.join(root,'config/companion-releases.json')));}catch{}
  return {versions,packageManifestSHA256:sha('MANIFEST.sha256'),sourceHashes:{selftest:sha('compute/workstation/selftest.py'),fixture:sha('compute/workstation/fixture.py'),desktop:sha('compute/workstation/agi-desktop.py'),dockerfile:sha('compute/Dockerfile')}};
}
