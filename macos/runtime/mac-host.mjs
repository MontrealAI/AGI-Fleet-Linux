import {spawnSync} from 'node:child_process';

export const MAC_HOST_FAILURES = Object.freeze(['MAC_APPLE_SILICON_REQUIRED','MAC_NATIVE_EXECUTION_REQUIRED','MAC_HOST_OBSERVATION_FAILED','MACOS_15_REQUIRED']);
const need = (value, code) => { if (!value) throw Error(code); };

export function assertMacHost({platform=process.platform, arch=process.arch, run=spawnSync}={}) {
  need(platform==='darwin' && arch==='arm64', 'MAC_APPLE_SILICON_REQUIRED');
  const observe = (file, args) => {
    let result;
    try { result=run(file,args,{encoding:'utf8',stdio:'pipe',timeout:5000,maxBuffer:4096,shell:false,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'}}); }
    catch { throw Error('MAC_HOST_OBSERVATION_FAILED'); }
    need(result && !result.error && !result.signal && typeof result.stdout==='string', 'MAC_HOST_OBSERVATION_FAILED');
    // Apple treats an absent translation key (ENOENT) as native:
    // https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment
    // Its sysctl CLI uses this exact diagnostic only for a missing OID; other
    // lookup errors append their error description. Do not accept spawn ENOENT.
    // https://github.com/apple-oss-distributions/system_cmds/blob/main/sysctl/sysctl.c
    if (file==='/usr/sbin/sysctl' && args.length===2 && args[0]==='-n' && args[1]==='sysctl.proc_translated' &&
        result.status===1 && result.stdout==='' && result.stderr==="sysctl: unknown oid 'sysctl.proc_translated'\n") return '0';
    need(result.status===0 && (result.stderr===undefined || result.stderr===''), 'MAC_HOST_OBSERVATION_FAILED');
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
