import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {getAddress} from 'ethers';
import {atomicWrite} from '../util.mjs';
export function loadReleaseProfile(home,{role,version,address,kind,previousVersion,hasState=false}){
  const file=path.join(home,'release-profile.json');let previous=null;
  if(fs.existsSync(file)){previous=JSON.parse(fs.readFileSync(file,'utf8'));if(previous.schema!==1||previous.role!==role||!/^[0-9a-f-]{36}$/.test(previous.id))throw Error('RELEASE_PROFILE_INVALID');}
  const upgraded=Boolean((address||hasState)&&(!previous||previous.version!==version));
  const profile={schema:1,id:previous?.id??crypto.randomUUID(),role,kind,version,expectedAddress:previous?.expectedAddress||address||null,previousVersion:upgraded?(previous?.version??previousVersion):previous?.previousVersion??null};
  if(address&&profile.expectedAddress&&getAddress(address)!==getAddress(profile.expectedAddress))throw Error('UPGRADE_WALLET_MISMATCH');
  if(!previous||JSON.stringify(previous)!==JSON.stringify(profile))atomicWrite(file,JSON.stringify(profile,null,2));
  return {profile,upgraded};
}
export function upgradeStatus(profile,address,historyPresent){
  const expected=profile.expectedAddress||address||null;
  return {release:profile.version,previousVersion:profile.previousVersion,profile:profile.kind,expectedAddress:expected,currentAddress:address??null,match:Boolean(expected&&address&&getAddress(expected)===getAddress(address)),historyPresent:Boolean(historyPresent),source:'Existing local profile identity. Compare with your independently recorded public address.',requiresFreshBackup:Boolean(profile.previousVersion)};
}
export function compareExpectedAddress(expected,current){if(typeof expected!=='string'||!current)throw Error('EXPECTED_ADDRESS_REQUIRED');return {expectedAddress:getAddress(expected),currentAddress:getAddress(current),match:getAddress(expected)===getAddress(current)};}

export function assertRestoreWallet(profile,current,restored){
  for(const expected of [profile?.expectedAddress,current])
    if(expected&&(!restored||getAddress(expected)!==getAddress(restored)))throw Error('RESTORE_WALLET_PROFILE_MISMATCH');
}
