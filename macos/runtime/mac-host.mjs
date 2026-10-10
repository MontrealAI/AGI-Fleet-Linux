import {spawnSync} from 'node:child_process';

export const MAC_HOST_FAILURES = Object.freeze(['MAC_APPLE_SILICON_REQUIRED','MAC_NATIVE_EXECUTION_REQUIRED','MAC_HOST_OBSERVATION_FAILED','MACOS_15_REQUIRED']);
const need = (value, code) => { if (!value) throw Error(code); };

export function assertMacHost({platform=process.platform, arch=process.arch, run=spawnSync}={}) {
  need(platform==='darwin' && arch==='arm64', 'MAC_APPLE_SILICON_REQUIRED');
  const observe = (file, args) => {
    let result;
    try { result=run(file,args,{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:4096,shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}}); }
    catch { throw Error('MAC_HOST_OBSERVATION_FAILED'); }
    need(result && result.status===0 && !result.error && !result.signal && typeof result.stdout==='string', 'MAC_HOST_OBSERVATION_FAILED');
    return result.stdout.trim();
  };
  const translated=observe('/usr/sbin/sysctl',['-n','sysctl.proc_translated']);
  need(translated==='0' || translated==='1', 'MAC_HOST_OBSERVATION_FAILED');
  need(translated==='0', 'MAC_NATIVE_EXECUTION_REQUIRED');
  need(observe('/usr/sbin/sysctl',['-n','hw.optional.arm64'])==='1', 'MAC_APPLE_SILICON_REQUIRED');
  const osVersion=observe('/usr/bin/sw_vers',['-productVersion']);
  need(/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(osVersion), 'MAC_HOST_OBSERVATION_FAILED');
  need(Number(osVersion.split('.')[0])>=15, 'MACOS_15_REQUIRED');
  return {schema:'agi-macos-host/v1',platform,arch,osVersion,translated:false,productionQualified:false};
}
