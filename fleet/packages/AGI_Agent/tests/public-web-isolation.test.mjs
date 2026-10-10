import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planPublicWebIsolation, preparePublicWebIsolation, activatePublicWebIsolation, cleanupPublicWebIsolation, publicWebCDPCommand, publicWebImageBuildPlan} from '../compute/public-web-isolation.mjs';
import {approvePublicWebGrant, grantDigest} from '../compute/public-web-policy.mjs';

const option = (args, key) => args[args.indexOf(key) + 1];
const options = (args, key) => args.flatMap((value, index) => value === key ? [args[index + 1]] : []);
const pairs = values => Object.fromEntries(values.map(x => { const at = x.indexOf('='); return [x.slice(0, at), x.slice(at + 1)]; }));
function dockerFixture() {
  const networks = new Map(), containers = new Map(), commands = []; let next = 1;
  const find = (map, name) => map.get(name) ?? [...map.values()].find(x => x.Name === name);
  const run = async (_docker, args) => {
    commands.push(args); const result = value => ({status: 0, code: 'OK', stdout: typeof value === 'string' ? value : JSON.stringify(value)});
    if (args[0] === 'info') return result('29.8.0');
    if (args[0] === 'context') return result(JSON.stringify('unix:///var/run/docker.sock'));
    if (args[0] === 'network' && args[1] === 'create') {
      const id = (next++).toString(16).padStart(64, '0'), name = args.at(-1);
      networks.set(id, {Id: id, Name: name, Driver: 'bridge', Internal: args.includes('--internal'), EnableIPv6: false, Labels: pairs(options(args, '--label')), Options: pairs(options(args, '--opt')), IPAM: {Config: args.includes('--subnet') ? [{Subnet: option(args, '--subnet')}] : []}, Containers: {}}); return result(id);
    }
    if (args[0] === 'create') {
      const id = (next++).toString(16).padStart(64, '0'), network = find(networks, option(args, '--network')), mounts = options(args, '--mount').map(value => { const p = pairs(value.split(',').filter(x => x.includes('='))); return {Type: p.type, Source: p.source, Destination: p.target, RW: !value.split(',').includes('readonly')}; });
      containers.set(id, {Id: id, Name: option(args, '--name'), Image: args.find(x => /^sha256:/.test(x)), State: {Running: false}, Config: {Labels: pairs(options(args, '--label')), User: option(args, '--user')}, HostConfig: {ReadonlyRootfs: args.includes('--read-only'), Privileged: false, CapDrop: options(args, '--cap-drop'), CapAdd: [], SecurityOpt: options(args, '--security-opt'), PortBindings: {}, RestartPolicy: {Name: option(args, '--restart')}, Sysctls: pairs(options(args, '--sysctl')), Dns: options(args, '--dns'), Binds: [], NetworkMode: network.Name}, Mounts: mounts, NetworkSettings: {Networks: {[network.Name]: {NetworkID: network.Id, IPAddress: '', IPAMConfig: {IPv4Address: option(args, '--ip')}}}}}); network.Containers[id] = {}; return result(id);
    }
    if (args[0] === 'network' && args[1] === 'connect') { const network = find(networks, args[2]), container = containers.get(args[3]); container.NetworkSettings.Networks[network.Name] = {NetworkID: network.Id, IPAddress: '', IPAMConfig: {IPv4Address: '172.31.0.2'}}; network.Containers[container.Id] = {}; return result(''); }
    if (args[1] === 'inspect') { const value = find(args[0] === 'network' ? networks : containers, args[2]); return value ? result([structuredClone(value)]) : {status: 1, code: 'FAILED', stdout: '', stderr: `Error: No such object: ${args[2]}\n`}; }
    if (args[0] === 'start') { const container = containers.get(args[1]); container.State.Running = true; for (const network of Object.values(container.NetworkSettings.Networks)) network.IPAddress = network.IPAMConfig.IPv4Address; return result(container.Id); }
    if (args[0] === 'container' && args[1] === 'rm') { const id = args.at(-1); containers.delete(id); for (const network of networks.values()) delete network.Containers[id]; return result(id); }
    if (args[0] === 'network' && args[1] === 'rm') { const id = args.at(-1); assert.equal(Object.keys(networks.get(id).Containers).length, 0); networks.delete(id); return result(id); }
    throw Error('UNEXPECTED_DOCKER_COMMAND');
  };
  return {run, networks, containers, commands};
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-public-web-isolation-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const spec = {taskHash: 'a'.repeat(64), runtimePolicyHash: 'b'.repeat(64), sessionID: crypto.randomUUID(), browserImageID: 'sha256:' + 'c'.repeat(64), proxyImageID: 'sha256:' + 'd'.repeat(64), subnet: '172.30.2.0/29', sessionDirectory: path.join(root, 'session'), uid: 504, gid: 20};
  const plan = planPublicWebIsolation(spec), docker = dockerFixture(); return {root, plan, docker};
}
function approval(f, prepared, changes = {}) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519'), now = Date.now();
  const payload = {schema: 'agi-public-web-grant/v1', taskHash: f.plan.spec.taskHash, runtimePolicyHash: f.plan.spec.runtimePolicyHash, sessionID: f.plan.spec.sessionID, browserContainerID: prepared.browserContainerID, browserImageID: f.plan.spec.browserImageID, proxyImageID: f.plan.spec.proxyImageID, browserIPv4: f.plan.browserIPv4, proxyIPv4: f.plan.proxyIPv4, issuedAt: now, expiresAt: now + 300000, hosts: [{hostname: 'example.com', ports: [80, 443]}], limits: {maxRequests: 64, maxConnections: 8, maxBytes: 33554432}, ...changes};
  const authority = publicKey.export({format: 'pem', type: 'spki'}), signed = approvePublicWebGrant(payload, privateKey.export({format: 'pem', type: 'pkcs8'}), {now});
  const keyFile = path.join(f.root, 'operator.pem'), grantFile = path.join(f.root, 'approval.json'); fs.writeFileSync(keyFile, authority, {mode: 0o600}); fs.writeFileSync(grantFile, JSON.stringify(signed), {mode: 0o600});
  return {approvalFile: grantFile, authorityFile: keyFile, operatorPublicKey: authority, expectedGrantHash: grantDigest(payload), now: () => now, qualificationAcknowledged: true, run: f.docker.run};
}

test('browser containment requires explicit commissioning, isolated internal networking and immutable images', async t => {
  const f = fixture(t); assert.equal(f.plan.activatedByDefault, false); assert.equal(f.plan.qualification, 'NOT TESTED');
  assert.throws(() => publicWebImageBuildPlan({computeDirectory: '/tmp/compute', browserBase: 'browser:latest', proxyBase: 'node:24'}), /BASE_DIGEST/);
  const builds = publicWebImageBuildPlan({computeDirectory: '/tmp/compute', browserBase: 'agi-browser@sha256:' + 'c'.repeat(64), proxyBase: 'node@sha256:' + 'd'.repeat(64)}); assert.equal(builds.commands.length, 2); assert.equal(builds.qualification, 'NOT TESTED');
  assert.throws(() => planPublicWebIsolation({...f.plan.spec, browserImageID: 'chromium:latest'}), /IMMUTABLE_IMAGE/);
  assert.throws(() => planPublicWebIsolation({...f.plan.spec, subnet: '8.8.8.0/29'}), /PRIVATE_SUBNET/);
  await assert.rejects(preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run}), /QUALIFICATION_APPROVAL/); assert.equal(f.docker.commands.length, 0);
  const prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true});
  assert.equal(prepared.status, 'PREPARED_NOT_STARTED'); assert.equal(f.docker.containers.get(prepared.browserContainerID).State.Running, false);
  const create = f.docker.commands.find(args => args[0] === 'create'); assert(!create.includes('--publish')); assert(!create.includes('--privileged')); assert.equal(option(create, '--dns'), '127.0.0.1'); assert(!create.includes('--mount'));
  assert(f.plan.prepare[0].includes('com.docker.network.bridge.gateway_mode_ipv4=isolated')); assert.equal(fs.statSync(path.join(f.plan.spec.sessionDirectory, 'browser.env')).mode & 0o777, 0o600);
  await assert.rejects(preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true}), /SESSION_EXISTS/);
  await cleanupPublicWebIsolation(prepared, {run: f.docker.run}); await cleanupPublicWebIsolation(prepared, {run: f.docker.run}); assert.equal(f.docker.containers.size, 0); assert.equal(f.docker.networks.size, 0);
});

test('activation binds signed task/session/container/images and gives only the proxy external networking', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true});
  const signed = approval(f, prepared), active = await activatePublicWebIsolation(prepared, signed);
  assert.equal(active.status, 'STARTED_UNQUALIFIED'); assert.equal(active.qualification, 'NOT TESTED');
  assert.deepEqual(Object.keys(f.docker.containers.get(active.browserContainerID).NetworkSettings.Networks), [f.plan.names.internal]);
  assert.equal(Object.keys(f.docker.containers.get(active.proxyContainerID).NetworkSettings.Networks).length, 2);
  const cdp = await publicWebCDPCommand(active, signed); assert.deepEqual(cdp.args.slice(0, 3), ['exec', '-i', active.browserContainerID]);
  await assert.rejects(publicWebCDPCommand({...active, browserContainerID: 'f'.repeat(64)}, signed), /APPROVAL_IDENTITY_MISMATCH/);
  await assert.rejects(publicWebCDPCommand(active, {...signed, now: () => active.expiresAt}), /GRANT_EXPIRED/);
  const proxyCreate = f.docker.commands.find(args => args[0] === 'create' && args.includes(f.plan.spec.proxyImageID)); assert(!proxyCreate.includes('--publish')); assert(proxyCreate.includes('net.ipv4.ip_forward=0'));
  const other = 'f'.repeat(64); f.docker.containers.set(other, {Id: other, unrelated: true});
  await active.close(); assert(f.docker.containers.has(other)); assert.equal(f.docker.containers.size, 1); assert.equal(f.docker.networks.size, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.plan.spec.sessionDirectory, 'cleanup.json'))).status, 'PASS');
  const g = fixture(t), before = await preparePublicWebIsolation(g.plan, {docker: '/usr/bin/docker', run: g.docker.run, qualificationAcknowledged: true}), observed = [];
  const retained = await activatePublicWebIsolation(before, {...approval(g, before), onCleanup: report => observed.push(report)});
  [...g.docker.networks.values()].find(n => n.Internal).Containers[other] = {};
  await assert.rejects(retained.close(), /SCOPED_CLEANUP_BLOCKED/); assert.equal(observed.at(-1).status, 'BLOCKED'); assert.equal(JSON.parse(fs.readFileSync(path.join(g.plan.spec.sessionDirectory, 'cleanup.json'))).status, 'BLOCKED');
});

test('foreign approvals, mutated network boundaries and foreign cleanup ownership never pass', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true});
  const foreign = approval(f, prepared, {browserContainerID: 'e'.repeat(64)});
  await assert.rejects(activatePublicWebIsolation(prepared, foreign), /APPROVAL_IDENTITY_MISMATCH/); assert(!f.docker.commands.some(args => args[0] === 'start'));
  fs.rmSync(foreign.approvalFile); fs.rmSync(foreign.authorityFile);
  const valid = approval(f, prepared), network = [...f.docker.networks.values()].find(x => x.Internal);
  network.Options['com.docker.network.bridge.gateway_mode_ipv4'] = 'nat';
  await assert.rejects(activatePublicWebIsolation(prepared, valid), /HOST_GATEWAY_EXPOSED/); assert(!f.docker.commands.some(args => args[0] === 'start'));
  network.Labels['ai.montreal.agi.public-web'] = crypto.randomUUID();
  await assert.rejects(cleanupPublicWebIsolation(prepared, {run: f.docker.run}), /SCOPED_CLEANUP_BLOCKED/); assert(f.docker.networks.has(network.Id));
});

test('omitted network records cannot bypass activation, CDP verification or scoped cleanup', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true}), signed = approval(f, prepared);
  const truncated = {...prepared, resources: prepared.resources.filter(x => x.kind !== 'network')};
  [...f.docker.networks.values()].find(x => x.Internal).Internal = false;
  await assert.rejects(activatePublicWebIsolation(truncated, signed), /RESOURCE_INVENTORY_INVALID/);
  assert(!f.docker.commands.some(args => args[0] === 'start'));
  await assert.rejects(cleanupPublicWebIsolation(truncated, {run: f.docker.run}), /SCOPED_CLEANUP_BLOCKED/);
  await cleanupPublicWebIsolation(prepared, {run: f.docker.run});

  const g = fixture(t), before = await preparePublicWebIsolation(g.plan, {docker: '/usr/bin/docker', run: g.docker.run, qualificationAcknowledged: true}), approved = approval(g, before), active = await activatePublicWebIsolation(before, approved);
  await assert.rejects(publicWebCDPCommand({...active, resources: active.resources.filter(x => x.kind !== 'network')}, approved), /RESOURCE_INVENTORY_INVALID/);
  await active.close();
});

test('network roles, running endpoint IDs and membership remain bound throughout the active session', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true}), signed = approval(f, prepared);
  const duplicate = {...prepared, resources: prepared.resources.map(item => item.role === 'egress' ? {...prepared.resources[0]} : item)};
  await assert.rejects(activatePublicWebIsolation(duplicate, signed), /RESOURCE_INVENTORY_INVALID/);
  const swapped = {...prepared, resources: prepared.resources.map(item => item.kind === 'network' ? {...item, role: item.role === 'internal' ? 'egress' : 'internal'} : item)};
  await assert.rejects(activatePublicWebIsolation(swapped, signed), /NETWORK_IDENTITY_CHANGED/);
  assert(!f.docker.commands.some(args => args[0] === 'start'));
  const active = await activatePublicWebIsolation(prepared, signed);
  await assert.rejects(activatePublicWebIsolation(active, signed), /SESSION_ALREADY_ACTIVATED/);
  const endpoint = f.docker.containers.get(active.browserContainerID).NetworkSettings.Networks[f.plan.names.internal], expected = endpoint.NetworkID;
  endpoint.NetworkID = 'e'.repeat(64);
  await assert.rejects(publicWebCDPCommand(active, signed), /NETWORK_IDENTITY_CHANGED/);
  endpoint.NetworkID = expected;
  const internal = f.docker.networks.get(expected); internal.Containers['f'.repeat(64)] = {};
  await assert.rejects(publicWebCDPCommand(active, signed), /NETWORK_CONTAINS_OTHER_WORK/);
  delete internal.Containers['f'.repeat(64)];
  assert.equal((await publicWebCDPCommand(active, signed)).scope.browserContainerID, active.browserContainerID);
  await active.close();
});

test('simultaneous expiry and caller cleanup share one owned-resource removal and one receipt', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true}), reports = [];
  const active = await activatePublicWebIsolation(prepared, {...approval(f, prepared), onCleanup: report => reports.push(report)});
  const results = await Promise.all([active.close(), active.close(), active.close()]);
  assert(results.every(result => result.status === 'PASS'));
  assert.equal(reports.length, 1);
  assert.equal(f.docker.commands.filter(args => args[0] === 'container' && args[1] === 'rm').length, 2);
  assert.equal(f.docker.commands.filter(args => args[0] === 'network' && args[1] === 'rm').length, 2);
  assert.equal(f.docker.containers.size, 0); assert.equal(f.docker.networks.size, 0);
});

test('failed activation removes only created session resources and never starts a changed browser network', async t => {
  const f = fixture(t), prepared = await preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: f.docker.run, qualificationAcknowledged: true}), signed = approval(f, prepared);
  const realRun = f.docker.run;
  signed.run = async (docker, args, options) => {
    const result = await realRun(docker, args, options);
    if (args[0] === 'network' && args[1] === 'connect') f.docker.containers.get(prepared.proxyContainerID).HostConfig.Privileged = true;
    return result;
  };
  await assert.rejects(activatePublicWebIsolation(prepared, signed), /CONTAINER_ISOLATION_CHANGED/);
  assert(!f.docker.commands.some(args => args[0] === 'start')); assert.equal(f.docker.containers.size, 0); assert.equal(f.docker.networks.size, 0);
});

test('a failed first browser inspection still cleans its owned container; remote Docker is refused before creation', async t => {
  const f = fixture(t); let interrupted = false;
  const broken = async (docker, args, options) => { if (!interrupted && args[0] === 'container' && args[1] === 'inspect') { interrupted = true; return {status: 1, code: 'FAILED', stdout: ''}; } return f.docker.run(docker, args, options); };
  await assert.rejects(preparePublicWebIsolation(f.plan, {docker: '/usr/bin/docker', run: broken, qualificationAcknowledged: true}), /INSPECT_FAILED/);
  assert.equal(f.docker.containers.size, 0); assert.equal(f.docker.networks.size, 0);
  const g = fixture(t), remote = async (docker, args, options) => args[0] === 'context' ? {status: 0, code: 'OK', stdout: JSON.stringify('ssh://remote.example.com')} : g.docker.run(docker, args, options);
  await assert.rejects(preparePublicWebIsolation(g.plan, {docker: '/usr/bin/docker', run: remote, qualificationAcknowledged: true}), /LOCAL_DOCKER_REQUIRED/); assert(!fs.existsSync(g.plan.spec.sessionDirectory));
  const h = fixture(t); let cancelled = false;
  const cancel = async (docker, args, options) => { if (!cancelled && args[0] === 'network' && args[1] === 'create' && !args.includes('--internal')) { cancelled = true; return {status: null, code: 'CANCELLED', stdout: ''}; } return h.docker.run(docker, args, options); };
  await assert.rejects(preparePublicWebIsolation(h.plan, {docker: '/usr/bin/docker', run: cancel, qualificationAcknowledged: true}), /PUBLIC_WEB_CANCELLED/); assert.equal(h.docker.networks.size, 0); assert.equal(h.docker.containers.size, 0);
});

test('Chromium wrapper refuses proxy/TLS bypass overrides and emits required direct-egress guards', t => {
  const f = fixture(t), source = fs.readFileSync(fileURLToPath(new URL('../compute/public-web-images/browser/chromium-proxy-wrapper.sh', import.meta.url)), 'utf8');
  const binary = path.join(f.root, 'chromium-test'), wrapper = path.join(f.root, 'wrapper.sh'), quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  fs.writeFileSync(binary, '\x23!/bin/sh\nprintf "%s\\n" "$@"\n', {mode: 0o700}); fs.writeFileSync(wrapper, source.replace('exec /usr/bin/chromium', 'exec ' + quote(binary)), {mode: 0o700});
  const options = {encoding: 'utf8', env: {PATH: '/usr/bin:/bin', AGI_PUBLIC_WEB_PROXY_IPV4: f.plan.proxyIPv4}};
  const ok = spawnSync('/bin/sh', [wrapper, '--headless=new', '--disable-features=OldFeature', 'about:blank'], options); assert.equal(ok.status, 0, ok.stderr);
  for (const flag of ['--proxy-bypass-list=<-loopback>', '--disable-quic', '--disable-http2', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-features=EncryptedClientHello,OldFeature']) assert(ok.stdout.includes(flag), flag);
  for (const flag of ['--proxy-server=direct://', '--no-proxy-server', '--no-proxy-server=true', '--enable-features=EncryptedClientHello', '--ignore-certificate-errors', '--no-sandbox', '--no-sandbox=true', '--disable-setuid-sandbox=true', '--enable-quic', '-proxy-server=http://unapproved.example.com:80', '-ignore-certificate-errors', '-no-sandbox', ' --no-sandbox', '--no-sandbox ', '--']) assert.notEqual(spawnSync('/bin/sh', [wrapper, flag], options).status, 0);
  assert.notEqual(spawnSync('/bin/sh', [wrapper], {...options, env: {PATH: '/usr/bin:/bin', AGI_PUBLIC_WEB_PROXY_IPV4: '127.0.0.1;touch BAD'}}).status, 0);
});
