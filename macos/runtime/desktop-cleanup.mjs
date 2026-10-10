export function confirmDesktopCleanup(run, docker, name) {
  const safe = operation => { try { return operation(); } catch { return null; } };
  const removed=safe(()=>run(docker,['rm','--force',name],true));
  const after=safe(()=>run(docker,['ps','-aq','--filter','name=^/'+name+'$'],true));
  const ok = result => result && result.status===0 && !result.error && !result.signal;
  if (!ok(removed) || !ok(after) || typeof after.stdout!=='string' || after.stdout.trim()!=='') throw Error('COMPUTE_SANDBOX_CLEANUP_FAILED');
  return {schema:'agi-desktop-cleanup/v1',removalConfirmed:true,exactContainerAbsent:true};
}
