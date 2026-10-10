import {assertRootlessInfo} from './linux-host.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {boundedCommand} from './repair.mjs';
import {verifyPublicWebApproval, grantDigest} from './public-web-policy.mjs';

const need = (value, code) => { if (!value) throw Error(code); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const H = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const labelKey = 'ai.montreal.agi.public-web';
const isolatedMode = 'com.docker.network.bridge.gateway_mode_ipv4';
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !/[\0-\x1f\x7f,]/.test(value);
const labels = plan => ({[labelKey]: plan.spec.sessionID, [labelKey + '.task']: plan.spec.taskHash, [labelKey + '.policy']: plan.spec.runtimePolicyHash});
const labelArgs = plan => Object.entries(labels(plan)).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
const ipNumber = ip => ip.split('.').reduce((sum, value) => sum * 256 + Number(value), 0);
const ipv4 = value => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');

export function publicWebImageBuildPlan({computeDirectory, browserBase, proxyBase}) {
  need(absolute(computeDirectory), 'PUBLIC_WEB_BUILD_CONTEXT_REQUIRED');
  const immutable = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
  const baseArguments = (reference, parameter, name) => {
    if (immutable.test(reference ?? '')) return ['--build-arg', parameter + '=' + reference];
    const local = /^oci-layout:\/\/(\/[^\r\n\0]+)@sha256:([a-f0-9]{64})$/.exec(reference ?? '');
    need(local && absolute(local[1]), 'PUBLIC_WEB_BASE_DIGEST_REQUIRED');
    return ['--build-context', `${name}=${reference}`, '--build-arg', `${parameter}=${name}`];
  };
  const browserArguments = baseArguments(browserBase, 'AGI_BROWSER_BASE', 'agi-browser-base'), proxyArguments = baseArguments(proxyBase, 'AGI_PROXY_NODE_BASE', 'agi-proxy-base');
  return {schema: 'agi-public-web-image-build/v1', qualification: 'NOT TESTED', commands: [
    ['buildx', 'build', '--load', '--file', path.join(computeDirectory, 'public-web-images/browser/Dockerfile'), ...browserArguments, '--label', 'ai.montreal.agi.public-web.base=' + hash(browserBase), '--tag', 'agi-public-web-browser:candidate-v1', computeDirectory],
    ['buildx', 'build', '--load', '--file', path.join(computeDirectory, 'public-web-images/proxy/Dockerfile'), ...proxyArguments, '--label', 'ai.montreal.agi.public-web.base=' + hash(proxyBase), '--tag', 'agi-public-web-proxy:candidate-v1', computeDirectory],
  ], next: 'Inspect and record immutable built image IDs; deployment accepts only sha256 IDs in an independently approved task grant.'};
}

export function planPublicWebIsolation(spec) {
  need(spec && H.test(spec.taskHash ?? '') && H.test(spec.runtimePolicyHash ?? '') && UUID.test(spec.sessionID ?? ''), 'PUBLIC_WEB_IDENTITY_REQUIRED');
  need(IMAGE.test(spec.browserImageID ?? '') && IMAGE.test(spec.proxyImageID ?? ''), 'PUBLIC_WEB_IMMUTABLE_IMAGE_REQUIRED');
  need(absolute(spec.sessionDirectory), 'PUBLIC_WEB_PRIVATE_DIRECTORY_REQUIRED');
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/29$/.exec(spec.subnet ?? '');
  need(match && match[1].split('.').every(n => Number(n) < 256 && String(Number(n)) === n), 'PUBLIC_WEB_SUBNET_REQUIRED');
  const base = ipNumber(match[1]);
  need(base % 8 === 0 && (/^10\./.test(match[1]) || /^192\.168\./.test(match[1]) || /^172\.(1[6-9]|2\d|3[01])\./.test(match[1])), 'PUBLIC_WEB_PRIVATE_SUBNET_REQUIRED');
  const uid = spec.uid ?? process.getuid?.(), gid = spec.gid ?? process.getgid?.();
  need(Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid >= 0, 'PUBLIC_WEB_STANDARD_UID_REQUIRED');
  const clean = {...(spec.rootless===true?{rootless:true}:{}),taskHash: spec.taskHash, runtimePolicyHash: spec.runtimePolicyHash, sessionID: spec.sessionID, browserImageID: spec.browserImageID, proxyImageID: spec.proxyImageID, subnet: spec.subnet, sessionDirectory: path.resolve(spec.sessionDirectory), uid, gid};
  const suffix = spec.sessionID.replaceAll('-', ''), prefix = 'agi-web-' + suffix;
  const plan = {schema: 'agi-public-web-isolation-plan/v1', spec: clean, browserIPv4: ipv4(base + 2), proxyIPv4: ipv4(base + 3), names: {internal: prefix + '-internal', egress: prefix + '-egress', browser: prefix + '-browser', proxy: prefix + '-proxy'}, qualification: 'NOT TESTED', activatedByDefault: false, cdpAccess: 'scoped Docker exec stdio relay; no published host ports'};
  plan.prepare = [
    ['network', 'create', '--driver', 'bridge', '--internal', '--ipv6=false', '--subnet', spec.subnet, '--opt', `${isolatedMode}=isolated`, '--opt', 'com.docker.network.bridge.gateway_mode_ipv6=isolated', ...labelArgs(plan), plan.names.internal],
    ['network', 'create', '--driver', 'bridge', '--ipv6=false', ...labelArgs(plan), plan.names.egress],
    ['create', '--name', plan.names.browser, ...labelArgs(plan), '--network', plan.names.internal, '--ip', plan.browserIPv4, '--dns', '127.0.0.1', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--restart', 'no', '--pids-limit', '128', '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--shm-size', '256m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=700', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '--env-file', path.join(clean.sessionDirectory, 'browser.env'), spec.browserImageID],
  ];
  return plan;
}
function ownerFile(file, maxBytes) {
  need(absolute(file), 'PUBLIC_WEB_FILE_PATH');
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes && !(stat.mode & 0o077) && stat.uid === process.getuid?.(), 'PUBLIC_WEB_FILE_PERMISSIONS');
  return fs.readFileSync(file);
}
function privateDirectory(directory) {
  need(!fs.existsSync(directory), 'PUBLIC_WEB_SESSION_EXISTS');
  let current = path.parse(directory).root;
  for (const component of directory.slice(current.length).split(path.sep)) { current = path.join(current, component); if (fs.existsSync(current)) need(!fs.lstatSync(current).isSymbolicLink(), 'PUBLIC_WEB_DIRECTORY_SYMLINK'); }
  fs.mkdirSync(directory, {mode: 0o700, recursive: true}); fs.chmodSync(directory, 0o700);
}
const write = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), {flag: 'wx', mode: 0o600});
async function command(docker, args, run, signal) {
  need(absolute(docker), 'PUBLIC_WEB_DOCKER_REQUIRED');
  const result = await run(docker, args, {timeoutMs: 15000, maxBytes: 262144, signal});
  need(result.status === 0 && (!result.code || result.code === 'OK'), result.code === 'CANCELLED' ? 'PUBLIC_WEB_CANCELLED' : result.code === 'TIMEOUT' ? 'PUBLIC_WEB_DOCKER_TIMEOUT' : 'PUBLIC_WEB_DOCKER_FAILED');
  return result.stdout.trim();
}
async function inspect(docker, kind, id, run, signal, allowMissing = false) {
  const result = await run(docker, [kind, 'inspect', id], {timeoutMs: 15000, maxBytes: 262144, signal, captureStderr: allowMissing});
  if (allowMissing && result.status !== 0 && new RegExp(`No such (?:container|network|object):\\s*${id}(?:\\s|$)`, 'i').test(result.stderr ?? '')) return null;
  need(result.status === 0, 'PUBLIC_WEB_INSPECT_FAILED'); const text = result.stdout;
  const value = JSON.parse(text); need(Array.isArray(value) && value.length === 1, 'PUBLIC_WEB_INSPECT_INVALID'); return value[0];
}
function owned(value, plan, kind) {
  const actual = kind === 'network' ? value.Labels : value.Config?.Labels;
  need(Object.entries(labels(plan)).every(([key, expected]) => actual?.[key] === expected), 'PUBLIC_WEB_RESOURCE_OWNERSHIP_MISMATCH');
}
function resourceInventory(prepared) {
  const fail = 'PUBLIC_WEB_RESOURCE_INVENTORY_INVALID', roles = ['internal', 'egress', 'browser'];
  need(prepared?.schema === 'agi-public-web-prepared/v1' && absolute(prepared.docker) && Array.isArray(prepared.resources), fail);
  need(['PREPARING', 'PREPARED_NOT_STARTED', 'STARTED_UNQUALIFIED'].includes(prepared.status), fail);
  const partial = prepared.status === 'PREPARING';
  need(prepared.proxyContainerID === null || H.test(prepared.proxyContainerID ?? ''), fail);
  if (prepared.proxyContainerID !== null) { need(!partial, fail); roles.push('proxy'); }
  need(partial ? prepared.resources.length <= 3 : prepared.resources.length === roles.length, fail);
  const inventory = {}, ids = new Set();
  for (const [index, item] of prepared.resources.entries()) {
    need(item && roles.includes(item.role) && (!partial || item.role === roles[index]) && !inventory[item.role] && H.test(item.id ?? '') && !ids.has(item.id), fail);
    need(item.kind === (['internal', 'egress'].includes(item.role) ? 'network' : 'container'), fail);
    if (item.kind === 'container') need(item.id === prepared[item.role + 'ContainerID'], fail);
    inventory[item.role] = Object.freeze({kind: item.kind, role: item.role, id: item.id}); ids.add(item.id);
  }
  need(partial || roles.every(role => inventory[role]), fail);
  need(Boolean(inventory.browser) === H.test(prepared.browserContainerID ?? ''), fail);
  return Object.freeze(inventory);
}
function checkNetworkIdentity(value, plan, item) {
  need(value.Id === item.id && value.Name === plan.names[item.role], 'PUBLIC_WEB_NETWORK_IDENTITY_CHANGED');
  checkNetwork(value, plan, item.role === 'internal');
}
function checkNetwork(value, plan, internal) {
  owned(value, plan, 'network');
  need(value.Driver === 'bridge' && value.Internal === internal && value.EnableIPv6 === false, 'PUBLIC_WEB_NETWORK_ISOLATION_CHANGED');
  if (internal) need(value.Options?.[isolatedMode] === 'isolated' && value.IPAM?.Config?.some(x => x.Subnet === plan.spec.subnet), 'PUBLIC_WEB_HOST_GATEWAY_EXPOSED');
}
function checkContainer(value, plan, kind, {running = false, inventory} = {}) {
  owned(value, plan, 'container');
  need(H.test(value.Id ?? '') && value.Image === plan.spec[kind === 'browser' ? 'browserImageID' : 'proxyImageID'], 'PUBLIC_WEB_CONTAINER_IMAGE_MISMATCH');
  const host = value.HostConfig, networks = Object.keys(value.NetworkSettings?.Networks ?? {});
  const required = kind === 'browser' ? [plan.names.internal] : [plan.names.internal, plan.names.egress];
  need(networks.length === required.length && required.every(name => networks.includes(name)), 'PUBLIC_WEB_UNEXPECTED_CONTAINER_NETWORK');
  need(host?.ReadonlyRootfs === true && host.Privileged === false && host.CapDrop?.includes('ALL') && host.SecurityOpt?.includes('no-new-privileges') && !host.ExtraHosts?.length && !Object.keys(host.PortBindings ?? {}).length && host.RestartPolicy?.Name === 'no', 'PUBLIC_WEB_CONTAINER_ISOLATION_CHANGED');
  need(!host.CapAdd?.length && !host.Devices?.length && !host.DeviceRequests?.length && host.NetworkMode !== 'host' && host.PidMode !== 'host' && host.IpcMode !== 'host', 'PUBLIC_WEB_HOST_ACCESS_FORBIDDEN');
  need(host.Sysctls?.['net.ipv6.conf.all.disable_ipv6'] === '1', 'PUBLIC_WEB_IPV6_NOT_DISABLED');
  if (kind === 'browser') need(host.Dns?.length === 1 && host.Dns[0] === '127.0.0.1' && !host.Binds?.length && Array.isArray(value.Mounts) && value.Mounts.every(x => x.Type === 'tmpfs') && value.Config?.User === '1000:1000', 'PUBLIC_WEB_BROWSER_DIRECT_ACCESS');
  else need(host.Sysctls?.['net.ipv4.ip_forward'] === '0' && value.Config?.User === (plan.spec.rootless?'0:0':`${plan.spec.uid}:${plan.spec.gid}`) && value.Mounts?.length === 2 && value.Mounts.every(m => m.Type === 'bind' && m.RW === false && ['/run/agi/grant.json', '/run/agi/authority.pem'].includes(m.Destination) && m.Source === path.join(plan.spec.sessionDirectory, path.basename(m.Destination))), 'PUBLIC_WEB_PROXY_MOUNT_INVALID');
  if (running) {
    need(value.State?.Running === true, 'PUBLIC_WEB_CONTAINER_NOT_RUNNING');
    need(value.NetworkSettings.Networks[plan.names.internal].IPAddress === plan[kind === 'browser' ? 'browserIPv4' : 'proxyIPv4'], 'PUBLIC_WEB_CONTAINER_ADDRESS_CHANGED');
    if (inventory) for (const role of kind === 'browser' ? ['internal'] : ['internal', 'egress']) need(value.NetworkSettings.Networks[plan.names[role]].NetworkID === inventory[role].id, 'PUBLIC_WEB_NETWORK_IDENTITY_CHANGED');
  } else need(value.State?.Running === false, 'PUBLIC_WEB_BROWSER_STARTED_BEFORE_APPROVAL');
  if (inventory) need(value.Id === inventory[kind].id, 'PUBLIC_WEB_RESOURCE_OWNERSHIP_MISMATCH');
}
export async function preparePublicWebIsolation(proposed, {docker, run = boundedCommand, signal, qualificationAcknowledged = false} = {}) {
  need(qualificationAcknowledged === true, 'PUBLIC_WEB_QUALIFICATION_APPROVAL_REQUIRED');
  const plan = planPublicWebIsolation(proposed.spec ?? proposed), version = await command(docker, ['info', '--format', '{{.ServerVersion}}'], run, signal);
  need(/^29\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version), 'PUBLIC_WEB_DOCKER_VERSION_UNQUALIFIED');
  if(plan.spec.rootless)assertRootlessInfo(JSON.parse(await command(docker,['info','--format','{{json .}}'],run,signal)));
  const context = JSON.parse(await command(docker, ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], run, signal));
  need(typeof context === 'string' && /^unix:\/\/\//.test(context) && !/[\r\n\0]/.test(context), 'PUBLIC_WEB_LOCAL_DOCKER_REQUIRED');
  privateDirectory(plan.spec.sessionDirectory);
  write(path.join(plan.spec.sessionDirectory, 'browser.env'), `AGI_PUBLIC_WEB_PROXY_IPV4=${plan.proxyIPv4}\nOPENCLAW_BROWSER_HEADLESS=1\nOPENCLAW_BROWSER_ENABLE_NOVNC=0\nOPENCLAW_BROWSER_NO_SANDBOX=0\nOPENCLAW_BROWSER_CDP_AUTH_TOKEN=${crypto.randomBytes(32).toString('hex')}\n`);
  const prepared = {schema: 'agi-public-web-prepared/v1', plan, docker, resources: [], browserContainerID: null, proxyContainerID: null, status: 'PREPARING', qualification: 'NOT TESTED', createdAt: new Date().toISOString()};
  try {
    for (const [index, args] of plan.prepare.entries()) {
      const id = await command(docker, args, run, signal); need(H.test(id), 'PUBLIC_WEB_RESOURCE_ID_INVALID');
      const kind = index < 2 ? 'network' : 'container'; prepared.resources.push({kind, id, role: index === 0 ? 'internal' : index === 1 ? 'egress' : 'browser'});
      if (kind === 'container') prepared.browserContainerID = id;
      const value = await inspect(docker, kind, id, run, signal);
      if (kind === 'network') checkNetworkIdentity(value, plan, prepared.resources.at(-1)); else checkContainer(value, plan, 'browser');
    }
    prepared.status = 'PREPARED_NOT_STARTED';
    write(path.join(plan.spec.sessionDirectory, 'prepared.json'), prepared); return prepared;
  } catch (error) { try { await cleanupPublicWebIsolation(prepared, {run}); } catch { error.cleanupBlocked = true; } throw error; }
}
export async function activatePublicWebIsolation(prepared, {approvalFile, authorityFile, operatorPublicKey, expectedGrantHash, run = boundedCommand, signal, qualificationAcknowledged = false, now = Date.now, onCleanup = () => {}} = {}) {
  need(qualificationAcknowledged === true, 'PUBLIC_WEB_QUALIFICATION_APPROVAL_REQUIRED');
  const plan = planPublicWebIsolation(prepared.plan.spec), docker = prepared.docker;
  const inventory = resourceInventory(prepared);
  need(prepared.status === 'PREPARED_NOT_STARTED' && prepared.proxyContainerID === null, 'PUBLIC_WEB_SESSION_ALREADY_ACTIVATED');
  const authority = ownerFile(authorityFile, 8192).toString('utf8');
  need(/^-----BEGIN PUBLIC KEY-----/.test(authority.trim()) && typeof operatorPublicKey === 'string', 'PUBLIC_WEB_PINNED_AUTHORITY_REQUIRED');
  const canonicalKey = value => crypto.createPublicKey(value).export({format: 'der', type: 'spki'});
  need(canonicalKey(authority).equals(canonicalKey(operatorPublicKey)), 'PUBLIC_WEB_AUTHORITY_MISMATCH');
  const approvalBytes = ownerFile(approvalFile, 32768), approval = JSON.parse(approvalBytes);
  const grant = verifyPublicWebApproval(approval, authority, {expectedGrantHash, now: now()});
  need(grant.taskHash === plan.spec.taskHash && grant.runtimePolicyHash === plan.spec.runtimePolicyHash && grant.sessionID === plan.spec.sessionID && grant.browserContainerID === prepared.browserContainerID && grant.browserImageID === plan.spec.browserImageID && grant.proxyImageID === plan.spec.proxyImageID && grant.browserIPv4 === plan.browserIPv4 && grant.proxyIPv4 === plan.proxyIPv4, 'PUBLIC_WEB_APPROVAL_IDENTITY_MISMATCH');
  const digest = grantDigest(grant);
  const browser = await inspect(docker, 'container', prepared.browserContainerID, run, signal); checkContainer(browser, plan, 'browser', {inventory});
  for (const item of [inventory.internal, inventory.egress]) { const network = await inspect(docker, 'network', item.id, run, signal); checkNetworkIdentity(network, plan, item); need(Object.keys(network.Containers ?? {}).every(id => item.role === 'internal' && id === prepared.browserContainerID), 'PUBLIC_WEB_NETWORK_CONTAINS_OTHER_WORK'); }
  const grantPath = path.join(plan.spec.sessionDirectory, 'grant.json'), keyPath = path.join(plan.spec.sessionDirectory, 'authority.pem'); write(grantPath, approvalBytes.toString('utf8')); write(keyPath, authority);
  const proxy = ['create', '--name', plan.names.proxy, ...labelArgs(plan), '--network', plan.names.internal, '--ip', plan.proxyIPv4, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', plan.spec.rootless?'0:0':`${plan.spec.uid}:${plan.spec.gid}`, '--restart', 'no', '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--tmpfs', `/tmp:rw,nosuid,nodev,noexec,size=16m,uid=${plan.spec.rootless?0:plan.spec.uid},gid=${plan.spec.rootless?0:plan.spec.gid},mode=700`, '--sysctl', 'net.ipv4.ip_forward=0', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '--mount', `type=bind,source=${grantPath},target=/run/agi/grant.json,readonly`, '--mount', `type=bind,source=${keyPath},target=/run/agi/authority.pem,readonly`, plan.spec.proxyImageID, 'node', '/opt/agi/public-web-proxy.mjs', '--grant', '/run/agi/grant.json', '--authority', '/run/agi/authority.pem', '--expected-grant-hash', digest];
  try {
    const id = await command(docker, proxy, run, signal); need(H.test(id), 'PUBLIC_WEB_RESOURCE_ID_INVALID'); prepared.proxyContainerID = id; prepared.resources.push({kind: 'container', id, role: 'proxy'});
    const activeInventory = resourceInventory(prepared);
    await command(docker, ['network', 'connect', plan.names.egress, id], run, signal);
    checkContainer(await inspect(docker, 'container', id, run, signal), plan, 'proxy', {inventory: activeInventory});
    need(now() < grant.expiresAt, 'PUBLIC_WEB_GRANT_EXPIRED');
    await command(docker, ['start', id], run, signal);
    await command(docker, ['start', prepared.browserContainerID], run, signal);
    checkContainer(await inspect(docker, 'container', id, run, signal), plan, 'proxy', {running: true, inventory: activeInventory});
    checkContainer(await inspect(docker, 'container', prepared.browserContainerID, run, signal), plan, 'browser', {running: true, inventory: activeInventory});
    for (const item of [inventory.internal, inventory.egress]) { const network = await inspect(docker, 'network', item.id, run, signal); checkNetworkIdentity(network, plan, item); const allowed = item.role === 'internal' ? [id, prepared.browserContainerID] : [id]; need(Object.keys(network.Containers ?? {}).every(container => allowed.includes(container)), 'PUBLIC_WEB_NETWORK_CONTAINS_OTHER_WORK'); }
    prepared.status = 'STARTED_UNQUALIFIED'; prepared.grantHash = digest; prepared.expiresAt = grant.expiresAt;
    write(path.join(plan.spec.sessionDirectory, 'activated.json'), {schema: 'agi-public-web-activation/v1', grantHash: digest, browserContainerID: prepared.browserContainerID, proxyContainerID: id, expiresAt: grant.expiresAt, status: 'STARTED_UNQUALIFIED', actualNavigation: 'NOT TESTED', isolationOnPhysicalMac: 'NOT TESTED'});
    const recordCleanup = value => {
      const record = {schema: 'agi-public-web-cleanup/v1', sessionID: plan.spec.sessionID, at: new Date().toISOString(), status: value.status, code: value.code, rawLogsIncluded: false};
      try { const temporary = path.join(plan.spec.sessionDirectory, 'cleanup-' + crypto.randomUUID() + '.tmp'); write(temporary, record); fs.renameSync(temporary, path.join(plan.spec.sessionDirectory, 'cleanup.json')); }
      catch { console.error('PUBLIC_WEB_CLEANUP_REPORT_WRITE_FAILED'); }
      try { onCleanup(record); } catch { console.error('PUBLIC_WEB_CLEANUP_OBSERVER_FAILED'); }
    };
    let cleanupPromise;
    const finish = () => cleanupPromise ??= (async () => { try { const result = await cleanupPublicWebIsolation(prepared, {run}); recordCleanup(result); return result; } catch (error) { recordCleanup({status: 'BLOCKED', code: 'PUBLIC_WEB_SCOPED_CLEANUP_BLOCKED'}); throw error; } })();
    const timer = setTimeout(() => { finish().catch(() => console.error('PUBLIC_WEB_SCOPED_CLEANUP_BLOCKED')); }, Math.max(1, grant.expiresAt - now())); timer.unref();
    return {...prepared, close: async () => { clearTimeout(timer); return finish(); }};
  } catch (error) { try { await cleanupPublicWebIsolation(prepared, {run}); } catch { error.cleanupBlocked = true; } throw error; }
}
export async function cleanupPublicWebIsolation(prepared, {run = boundedCommand} = {}) {
  const plan = planPublicWebIsolation(prepared.plan.spec), failures = [];
  let inventory; try { inventory = resourceInventory(prepared); } catch { throw Error('PUBLIC_WEB_SCOPED_CLEANUP_BLOCKED'); }
  const resources = Object.values(inventory).sort((a, b) => (a.kind === 'container' ? 0 : 1) - (b.kind === 'container' ? 0 : 1));
  for (const resource of resources) {
    try {
      need(H.test(resource.id), 'PUBLIC_WEB_RESOURCE_ID_INVALID');
      const value = await inspect(prepared.docker, resource.kind, resource.id, run, undefined, true); if (!value) continue; owned(value, plan, resource.kind);
      if (resource.kind === 'container') {
        need([prepared.browserContainerID, prepared.proxyContainerID].includes(resource.id), 'PUBLIC_WEB_RESOURCE_OWNERSHIP_MISMATCH');
        await command(prepared.docker, ['container', 'rm', '--force', resource.id], run);
      } else {
        need(value.Id === resource.id && value.Name === plan.names[resource.role], 'PUBLIC_WEB_RESOURCE_OWNERSHIP_MISMATCH');
        need(Object.keys(value.Containers ?? {}).length === 0, 'PUBLIC_WEB_NETWORK_CONTAINS_OTHER_WORK');
        await command(prepared.docker, ['network', 'rm', resource.id], run);
      }
    } catch { failures.push({kind: resource.kind, id: resource.id, code: 'PUBLIC_WEB_SCOPED_CLEANUP_BLOCKED'}); }
  }
  need(failures.length === 0, 'PUBLIC_WEB_SCOPED_CLEANUP_BLOCKED');
  return {status: 'PASS', code: 'OWNED_PUBLIC_WEB_RESOURCES_REMOVED', unrelatedResourcesTouched: false};
}
export async function publicWebCDPCommand(prepared, {operatorPublicKey, expectedGrantHash, run = boundedCommand, signal, now = Date.now} = {}) {
  need(H.test(prepared.browserContainerID ?? '') && ['STARTED_UNQUALIFIED'].includes(prepared.status), 'PUBLIC_WEB_BROWSER_NOT_ACTIVE');
  need(Number.isSafeInteger(prepared.expiresAt) && now() < prepared.expiresAt, 'PUBLIC_WEB_GRANT_EXPIRED');
  need(typeof operatorPublicKey === 'string' && H.test(expectedGrantHash ?? ''), 'PUBLIC_WEB_PINNED_AUTHORITY_REQUIRED');
  const plan = planPublicWebIsolation(prepared.plan.spec), approval = JSON.parse(ownerFile(path.join(plan.spec.sessionDirectory, 'grant.json'), 32768));
  const grant = verifyPublicWebApproval(approval, operatorPublicKey, {expectedGrantHash, now: now()});
  need(grant.taskHash === plan.spec.taskHash && grant.runtimePolicyHash === plan.spec.runtimePolicyHash && grant.sessionID === plan.spec.sessionID && grant.browserContainerID === prepared.browserContainerID && grant.browserImageID === plan.spec.browserImageID && grant.proxyImageID === plan.spec.proxyImageID && grant.browserIPv4 === plan.browserIPv4 && grant.proxyIPv4 === plan.proxyIPv4, 'PUBLIC_WEB_APPROVAL_IDENTITY_MISMATCH');
  const inventory = resourceInventory(prepared);
  checkContainer(await inspect(prepared.docker, 'container', prepared.browserContainerID, run, signal), plan, 'browser', {running: true, inventory});
  need(H.test(prepared.proxyContainerID ?? ''), 'PUBLIC_WEB_PROXY_IDENTITY_REQUIRED');
  checkContainer(await inspect(prepared.docker, 'container', prepared.proxyContainerID, run, signal), plan, 'proxy', {running: true, inventory});
  for (const item of [inventory.internal, inventory.egress]) {
    const network = await inspect(prepared.docker, 'network', item.id, run, signal); checkNetworkIdentity(network, plan, item);
    const allowed = item.role === 'internal' ? [prepared.browserContainerID, prepared.proxyContainerID] : [prepared.proxyContainerID];
    need(Object.keys(network.Containers ?? {}).every(id => allowed.includes(id)), 'PUBLIC_WEB_NETWORK_CONTAINS_OTHER_WORK');
  }
  return {executable: prepared.docker, args: ['exec', '-i', prepared.browserContainerID, 'python3', '/usr/local/bin/agi-cdp-stdio.py'], scope: {sessionID: plan.spec.sessionID, browserContainerID: prepared.browserContainerID, grantHash: expectedGrantHash}, containerIdentity: 'VERIFIED_AT_CHECK', qualification: 'NOT TESTED'};
}
