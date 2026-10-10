import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Wallet,getAddress} from 'ethers';
import {stageOperational,checkBackupSize} from './operational-state.mjs';
const ensure=(v,c)=>{if(!v)throw Error(c);};
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const backupHash=hash;
const RECORDS=['config','vault','database','operational','profile','companion','pin','settings'];
export function addBackupIntegrity(data){data.integrity={schema:'agi-backup-integrity/v1',records:Object.fromEntries(RECORDS.filter(k=>Object.hasOwn(data,k)).map(k=>[k,hash(JSON.stringify(data[k]))]))};return checkBackupSize(data);}
export async function verifyDownloadedBackup(envelope,password,{role,kind,profileID,expectedAddress,issuedHash,openBackup,Vault,checkRecovery,validate,inspectState,vaultPassword=password}={}){
  ensure(envelope&&typeof envelope==='object'&&!Array.isArray(envelope)&&Buffer.byteLength(JSON.stringify(envelope))<64*1024*1024,'BACKUP_TOO_LARGE');
  const value=await openBackup(envelope,password);checkBackupSize(value);
  const fleet=kind==='fleet';
  ensure(fleet?['agi-fleet-backup/v1','agi-fleet-backup/v2'].includes(value?.schema):[2,3].includes(value?.schema),'BACKUP_FORMAT');
  ensure(value.config&&value.vault,'BACKUP_FORMAT');
  ensure(!fleet||value.config.role===role,'BACKUP_ROLE');
  ensure(!([3,'agi-fleet-backup/v2'].includes(value.schema))||value.operational,'BACKUP_STATE_FORMAT');
  if(value.profile){ensure(value.profile.role===role,'BACKUP_ROLE');ensure(value.profile.id===profileID,'BACKUP_PROFILE_MISMATCH');}
  if(value.integrity){
    ensure(value.integrity.schema==='agi-backup-integrity/v1'&&value.integrity.records&&typeof value.integrity.records==='object','BACKUP_INTEGRITY');
    for(const k of RECORDS.filter(k=>Object.hasOwn(value,k)))ensure(value.integrity.records[k]===hash(JSON.stringify(value[k])),'BACKUP_INTEGRITY');
    ensure(Object.keys(value.integrity.records).every(k=>RECORDS.includes(k)&&Object.hasOwn(value,k)),'BACKUP_INTEGRITY');
  }
  const address=value.config.agent??value.config.validator??value.config.wallet;
  if(role!=='evidence')ensure(expectedAddress&&address&&getAddress(address)===getAddress(expectedAddress),'BACKUP_WALLET_MISMATCH');
  if(validate)validate(value);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'agi-backup-verify-'));fs.chmodSync(temp,0o700);
  let fileCount=0,dbChecked=false;
  try{
    fs.writeFileSync(path.join(temp,'vault.json'),JSON.stringify(value.vault),{mode:0o600});
    const vault=new Vault(temp);
    try{
      await vault.unlock(vaultPassword);const key=vault.get('privateKey'),recovery=vault.get('walletRecovery');
      if(role==='evidence')ensure(!key&&!recovery,'EVIDENCE_HAS_NO_SIGNING_KEY');
      else{ensure(key&&new Wallet(key).address===getAddress(expectedAddress),'BACKUP_WALLET_MISMATCH');if(recovery)checkRecovery(recovery,key,address);}
    }finally{vault.lock();}
    if(value.database!==null&&value.database!==undefined){
      ensure(typeof value.database==='string'&&value.database.length<48*1024*1024,'BACKUP_DATABASE_FORMAT');
      const bytes=Buffer.from(value.database,'base64');ensure(bytes.toString('base64')===value.database&&bytes.subarray(0,16).toString()==='SQLite format 3\0','BACKUP_DATABASE_FORMAT');
      if(value.sha256)ensure(hash(bytes)===value.sha256,'BACKUP_INTEGRITY');
      const file=path.join(temp,'journal.sqlite');fs.writeFileSync(file,bytes,{mode:0o600});const db=new DatabaseSync(file,{readOnly:true});
      try{
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
        ensure(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','BACKUP_DATABASE_INVALID');
        ensure(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n===0,'BACKUP_DATABASE_INVALID');
        for(const table of ['meta','jobs','txs',...(kind==='agent'?['work']:[])])ensure(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),'BACKUP_DATABASE_INVALID');
        if(fleet){const row=db.prepare('SELECT v FROM meta WHERE k=?').get('identity');if(row){const identity=JSON.parse(row.v);ensure(identity.role===role&&identity.chain===value.config.chainId&&getAddress(identity.wallet)===getAddress(address)&&getAddress(identity.manager)===getAddress(value.config.manager),'BACKUP_IDENTITY_MISMATCH');}}
        dbChecked=true;
      }finally{db.close();}
    }else ensure(!fleet,'BACKUP_DATABASE_FORMAT');
    if(value.operational)fileCount=stageOperational(temp,value.operational,kind).files;
    if(inspectState)inspectState(temp,value);
    const studioExcluded=value.operational?.excludedTrees?.includes('work-studio')===true;
    const digest=backupHash(envelope),currentReady=Boolean(value.profile?.id===profileID&&value.integrity&&value.operational&&issuedHash===digest);
    return {schema:'agi-backup-verification/v1',valid:true,currentReady,hash:digest,role,profileID:value.profile?.id??null,address:address??null,createdAt:typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))?new Date(value.createdAt).toISOString():null,verifiedAt:new Date().toISOString(),checks:{decryption:true,integrity:true,wallet:true,role:true,profile:Boolean(value.profile),database:dbChecked?'verified':'not-created-at-backup',operationalFiles:fileCount,applicationState:Boolean(value.operational),studioWork:studioExcluded?'excluded-by-operator':value.operational?'included':'not-recorded'},note:(studioExcluded?'Studio work was excluded by your choice; keep its separate exports. ':'')+(currentReady?'Downloaded file verified. Confirm your off-machine copy separately.':'Valid historical backup. Download and verify a fresh backup for this release before live operation.')};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
export function backupProgress({issued,verified,receipt,saved=false}={}){
  const proof=verified??(saved&&!issued?receipt:null);
  return {downloaded:Boolean(issued||saved&&receipt),verified:Boolean(proof?.currentReady),safelyStored:Boolean(!issued&&saved&&receipt?.currentReady),createdAt:proof?.createdAt??null,verifiedAt:proof?.verifiedAt??null,checks:proof?.checks??null};
}
