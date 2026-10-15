// Test harness only. Never substitutes the production transport or its signals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const requireValue=(value,code)=>{if(!value)throw Error(code);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const argvFor=phase=>['/opt/alpha/python/bin/python3.12','-I','-S','-B','/opt/alpha/launch-'+phase+'.py',''];
function processStat(raw){
  const fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);
  requireValue(fields.length>=20&&/^\d+$/.test(fields[1])&&/^\d+$/.test(fields[19]),'CANCEL_PROCESS_IDENTITY');
  return {parent:Number(fields[1]),startTimeTicks:fields[19]};
}
export function interpreterIdentity(file){
  const stat=fs.lstatSync(file,{bigint:true});
  requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n,'CANCEL_INTERPRETER_TYPE');
  return {device:String(stat.dev),inode:String(stat.ino),bytes:Number(stat.size),sha256:sha(fs.readFileSync(file))};
}
export function verifyCancellationTarget(request,{driverPid,interpreter,procRoot='/proc',nonce}){
  requireValue(request&&Object.keys(request).sort().join(',')==='kind,nonce,payload'&&request.kind==='cancel-native-phase'&&request.nonce===nonce&&/^[a-f0-9]{64}$/.test(nonce),'CANCEL_REQUEST_INVALID');
  const p=request.payload;
  requireValue(p&&Object.keys(p).sort().join(',')==='interpreter,phase,pid,pidNamespace,startTimeTicks'&&Number.isSafeInteger(p.pid)&&p.pid>1&&/^\d+$/.test(p.startTimeTicks)&&/^pid:\[\d+\]$/.test(p.pidNamespace)&&['validate','work'].includes(p.phase),'CANCEL_TARGET_INVALID');
  requireValue(p.interpreter&&Object.keys(p.interpreter).sort().join(',')==='bytes,device,inode,sha256'&&Object.entries(interpreter).every(([key,value])=>p.interpreter[key]===value),'CANCEL_INTERPRETER_BINDING');
  const directory=path.join(procRoot,String(p.pid)),first=processStat(fs.readFileSync(path.join(directory,'stat'),'utf8'));
  const argv=()=>fs.readFileSync(path.join(directory,'cmdline')).toString('utf8').split('\0');
  requireValue(JSON.stringify(argv())===JSON.stringify(argvFor(p.phase)),'CANCEL_TARGET_NOT_PAYLOAD');
  requireValue(first.startTimeTicks===p.startTimeTicks,'CANCEL_PID_REUSED');
  let cursor=p.pid;
  for(let i=0;i<32;i++){
    cursor=processStat(fs.readFileSync(path.join(procRoot,String(cursor),'stat'),'utf8')).parent;
    if(cursor===driverPid||cursor<=1)break;
  }
  requireValue(cursor===driverPid,'CANCEL_NOT_DRIVER_DESCENDANT');
  const namespace=fs.readlinkSync(path.join(directory,'ns/pid'));
  requireValue(namespace===p.pidNamespace&&namespace!==fs.readlinkSync(path.join(procRoot,'self/ns/pid')),'CANCEL_NAMESPACE_CHANGED');
  // Follow only the PID-specific kernel exe link, then compare its opened inode.
  const fd=fs.openSync(path.join(directory,'exe'),fs.constants.O_RDONLY);
  try{
    const s=fs.fstatSync(fd,{bigint:true});
    requireValue(s.isFile()&&String(s.dev)===interpreter.device&&String(s.ino)===interpreter.inode&&Number(s.size)===interpreter.bytes,'CANCEL_WRONG_EXECUTABLE');
    requireValue(sha(fs.readFileSync(fd))===interpreter.sha256,'CANCEL_EXECUTABLE_CHANGED');
  }finally{fs.closeSync(fd);}
  // This final synchronous check immediately precedes applying the real runtime
  // stop/revoke. A later transport/receipt check rejects an already-ended phase.
  requireValue(JSON.stringify(processStat(fs.readFileSync(path.join(directory,'stat'),'utf8')))===JSON.stringify(first)&&fs.readlinkSync(path.join(directory,'ns/pid'))===namespace&&JSON.stringify(argv())===JSON.stringify(argvFor(p.phase)),'CANCEL_TARGET_RACED');
  return structuredClone(request);
}
export function requireCancelledReceipt({request,errorCode,retained}){
  requireValue(request&&errorCode==='RUN_CANCELLED'&&retained?.state==='uncertain'&&retained.receipt?.error==='RUN_CANCELLED','CANCEL_WRONG_RUNTIME_OUTCOME');
  const phases=retained.receipt?.observation?.phases;
  requireValue(Array.isArray(phases)&&phases.length>=1&&phases.length<=2,'CANCEL_PHASES_MISSING');
  const phase=phases.at(-1),payload=request.payload;
  requireValue(phase.phase===payload.phase&&'pid:['+phase.status?.namespaces?.pid+']'===payload.pidNamespace&&phase.launchAttempted===true&&phase.evidenceClass==='NATIVE_FIXED_ALPHA_IPC','CANCEL_RECEIPT_TARGET_MISMATCH');
  requireValue(phase.processGroupGone===true&&phase.privateNamespacesEnded===true&&phase.namespaceLifetimeEOF===true,'CANCEL_CLEANUP_UNCONFIRMED');
  // Successful completion followed by late STOP/revalidation is not cancellation
  // of a native phase. Require an actually killed/failing native transport phase.
  requireValue(phase.signal==='SIGKILL'||(Number.isInteger(phase.exitStatus)&&phase.exitStatus!==0)||(Number.isInteger(phase.status?.exitCode)&&phase.status.exitCode!==0),'CANCEL_PHASE_ALREADY_ENDED');
  return true;
}
