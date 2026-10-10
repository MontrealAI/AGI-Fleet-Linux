#!/usr/bin/env python3
"""Apply the reviewed Mac overlay to a disposable release staging tree."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROLES = ('Agent', 'Node', 'Moderator', 'Employer', 'Evidence', 'Recovery')


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def apply(root, version):
    root = Path(root).resolve()
    require(root != HERE.parents[1] / 'fleet', 'Refusing to modify frozen fleet source; use a staging copy')
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version')
    canonical = root / 'shared/runtime'
    require(canonical.is_dir() and not canonical.is_symlink(), 'Staged shared runtime required')
    changes = {}

    def edit(relative, old, new):
        file = root / relative
        require(file.is_file() and not file.is_symlink(), 'Missing ordinary source: ' + relative)
        text = file.read_text()
        require(text.count(old) == 1, 'Source anchor differs (no changes should be published): ' + relative)
        changes[relative] = (file.read_bytes(), text.replace(old, new).encode())

    def add(relative, data):
        require(not (root / relative).exists(), 'Overlay already applied or unexpected destination: ' + relative)
        changes[relative] = (None, data)

    def chain(relative, old, new):
        if relative not in changes:
            edit(relative, old, new)
        else:
            before, content = changes[relative]
            text = content.decode()
            require(text.count(old) == 1, 'Source anchor differs: ' + relative)
            changes[relative] = (before, text.replace(old, new).encode())

    base = 'shared/runtime/'
    add(base + 'compute/mac-host.mjs', (HERE / 'mac-host.mjs').read_bytes())
    add(base + 'compute/desktop-cleanup.mjs', (HERE / 'desktop-cleanup.mjs').read_bytes())
    setup = base + 'compute/setup.mjs'
    edit(setup, "import {computeSourceIdentity}", "import {assertMacHost} from './mac-host.mjs';\nimport {computeSourceIdentity}")
    chain(setup, "  const home=dependencies.home??os.homedir()", "  if(process.platform==='darwin')assertMacHost();\n  const home=dependencies.home??os.homedir()")
    chain(setup, "{strictCleanup:platform==='linux'}", '{strictCleanup:true}')
    chain(setup, "import {captureStandardOAuthAuthority}", "import {preparePinnedControlUICache} from './setup-runtime-materialization.mjs';\nimport {captureStandardOAuthAuthority}")
    # Standard first-start retention runs after HTTP readiness in the pinned
    # Gateway. Prepare its exact generation while the private candidate is
    # stopped, before any authority capture or approval; validation stays pure.
    chain(setup, "if(standardInstall){c.standardOAuthAuthority=captureStandardOAuthAuthority(transaction.candidate,c);", "if(standardInstall){(dependencies.preparePinnedControlUICache??preparePinnedControlUICache)(transaction.candidate,runtime.artifact?.packageRoot);c.standardOAuthAuthority=captureStandardOAuthAuthority(transaction.candidate,c);")
    support = base + 'compute/setup-support.mjs'
    edit(support, "import fs from 'node:fs';", "import {confirmDesktopCleanup} from './desktop-cleanup.mjs';\nimport fs from 'node:fs';")
    chain(support, 'let result,inspect;', 'let result,inspect,report;')
    chain(support, "const report={schema:'agi-desktop-installer-check/v1'", "report={schema:'agi-desktop-installer-check/v1'")
    old = "}finally{const removed=run(docker,['rm','--force',name],true);if(strictCleanup){const after=run(docker,['ps','-aq','--filter','name=^/'+name+'$'],true);if(removed.status!==0||removed.error||removed.signal||after.status!==0||after.error||after.signal||String(after.stdout??'').trim()!=='')throw Error('COMPUTE_SANDBOX_CLEANUP_FAILED');}}"
    new = "}finally{if(strictCleanup){const cleanup=confirmDesktopCleanup(run,docker,name);if(report)report.cleanup=cleanup;}else run(docker,['rm','--force',name],true);}"
    chain(support, old, new)
    evidence = base + 'compute/desktop-evidence.mjs'
    edit(evidence, "out.passed=report.passed===true;", "out.passed=report.passed===true;\n  if(report.cleanup?.schema==='agi-desktop-cleanup/v1')out.cleanup={schema:'agi-desktop-cleanup/v1',removalConfirmed:report.cleanup.removalConfirmed===true,exactContainerAbsent:report.cleanup.exactContainerAbsent===true};")
    auth = base + 'compute/setup-auth.mjs'
    edit(auth, "import {ALL_OAUTH_ROLES}", "import {MAC_HOST_FAILURES} from './mac-host.mjs';\nimport {ALL_OAUTH_ROLES}")
    chain(auth, '...AUTH_FAILURES,...RUNTIME_FAILURES,', "...AUTH_FAILURES,...RUNTIME_FAILURES,...MAC_HOST_FAILURES,'COMPUTE_SANDBOX_CLEANUP_FAILED',")
    qualify = base + 'script-entries/qualify-mac.mjs.template'
    edit(qualify, "import fs from 'node:fs';", "import {assertMacHost} from '../compute/mac-host.mjs';\nimport fs from 'node:fs';")
    chain(qualify, "if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('REAL_APPLE_SILICON_MAC_REQUIRED');", 'report.host=assertMacHost();')
    chain(qualify, "desktopCheck(run,'docker',c.imageID)", "desktopCheck(run,'docker',c.imageID,{strictCleanup:true})")
    for name in ('setup-agent.mjs.template', 'setup-node.mjs.template'):
        entry = base + 'script-entries/' + name
        edit(entry, 'process.umask(0o077);', "assertMacHost();\nprocess.umask(0o077);")
        chain(entry, "import fs from", "import {assertMacHost} from '../compute/mac-host.mjs';\nimport fs from")
    for role in ('Moderator', 'Employer', 'Evidence', 'Recovery'):
        entry = 'packages/AGI_' + role + '/scripts/setup-openclaw.mjs'
        edit(entry, "import {setupCapable}", "import {assertMacHost} from '../compute/mac-host.mjs';\nimport {setupCapable}")
        chain(entry, 'process.umask(0o077);', 'assertMacHost();\nprocess.umask(0o077);')
    edit('scripts/setup-openclaw.mjs', 'const rl = createInterface(', "assertMacHost();\nconst rl = createInterface(")
    chain('scripts/setup-openclaw.mjs', 'import {selectOpenClawRuntime,', "import {assertMacHost} from '../packages/AGI_Agent/compute/mac-host.mjs';\nimport {selectOpenClawRuntime,")

    template = json.loads((HERE / 'macos-clean-install.template.json').read_text())
    template['release']['version'] = version
    for edition in ['', *('packages/AGI_' + role + '/' for role in ROLES)]:
        add(edition + 'scripts/check-mac-host.mjs', b"import {assertMacHost} from '../shared/runtime/compute/mac-host.mjs';\ntry {assertMacHost();} catch(error) {console.error(error.message);process.exitCode=1;}\n")
        for name in ('macos-clean-install.mjs', 'macos-clean-install.schema.json'):
            add(edition + 'qualification/' + name, (HERE / name).read_bytes())
        add(edition + 'qualification/macos-clean-install.template.json', (json.dumps(template, indent=2) + '\n').encode())
        runtime_tests = (HERE / 'runtime.test.mjs').read_text()
        for old, new in (('./mac-host.mjs', '../shared/runtime/compute/mac-host.mjs'),
                         ('./desktop-cleanup.mjs', '../shared/runtime/compute/desktop-cleanup.mjs'),
                         ('./macos-clean-install.mjs', '../qualification/macos-clean-install.mjs'),
                         ('./macos-clean-install.template.json', '../qualification/macos-clean-install.template.json')):
            require(runtime_tests.count(old) == 1, 'Runtime test import anchor differs: ' + old)
            runtime_tests = runtime_tests.replace(old, new)
        add(edition + 'tests/macos-runtime.test.mjs', runtime_tests.encode())

    edit('tests/linux-platform.test.mjs', 'import {linuxStandardGroups,', 'import {assertLinuxHost,linuxStandardGroups,')
    chain('tests/linux-platform.test.mjs', "test('Systemd itself accepts all twelve generated units without executing services',t=>{", "test('Native Linux verifies twelve units; Darwin explicitly refuses the Linux host adapter',t=>{if(process.platform==='darwin'){assert.throws(()=>assertLinuxHost(),/LINUX_PLATFORM_REQUIRED/);return;}")
    # Include every reviewed compute module in receipt binding. The source
    # collector already allowed 255 entries; the validator's old 128-entry
    # ceiling could not represent this complete Mac runtime.
    qualification = base + 'compute/public-web-qualification.mjs'
    edit(qualification, "export const PUBLIC_WEB_QUALIFICATION_SCOPE", "export const PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT = 255;\nexport const PUBLIC_WEB_QUALIFICATION_SCOPE")
    chain(qualification, 'Object.keys(value).length <= 128', 'Object.keys(value).length <= PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT')
    identity = base + 'compute/public-web-qualification-identity.mjs'
    edit(identity, "import {consumerRoot,", "import {PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT} from './public-web-qualification.mjs';\nimport {consumerRoot,")
    chain(identity, 'files.length<256', 'files.length<=PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT')
    for role in ('Agent', 'Node'):
        tests = f'packages/AGI_{role}/tests/'
        public_web = tests + 'public-web-qualification-import.test.mjs'
        edit(public_web, 'import {verifyPublicWebQualification}', 'import {PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT,verifyPublicWebQualification}')
        chain(public_web, 'Object.keys(before.sourceHashes).length<=128', 'Object.keys(before.sourceHashes).length<=PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT')
        clean = tests + 'setup-clean-install.test.mjs'
        edit(clean, "assert.throws(()=>assertCleanInstallAdmission({...options,platform:'linux'}),/STANDARD/)", "assert.throws(()=>assertCleanInstallAdmission({...options,platform:'linux'}),process.platform==='darwin'?/LINUX_PLATFORM_REQUIRED/:/STANDARD/)")
        alias = tests + 'fresh-oauth-continuation-fixture.mjs'
        edit(alias, "const root=fs.mkdtempSync('/tmp/agi-alias-case-'),real=", "const root=fs.realpathSync(fs.mkdtempSync('/tmp/agi-alias-case-')),real=")
        # These fixtures prove map compatibility and rejection, not physical
        # qualification. They retain the independent reviewer signature and
        # never publish their fabricated observations as operational evidence.
        bounds = tests + 'public-web-qualification.test.mjs'
        edit(bounds, 'import {verifyPublicWebQualification,', "import {publicWebQualificationSources} from '../compute/public-web-qualification-identity.mjs';\nimport {PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT, verifyPublicWebQualification,")
        anchor = "test('independently signed receipt qualifies only its exact narrow technical scope and remains frozen', async t => {"
        checks = """test('complete Mac source inventory fits signed receipts and any changed source still rejects', async t => {
  const sourceHashes=publicWebQualificationSources(),f=await qualificationFixture({sourceHashes});t.after(f.close);
  assert.ok(Object.keys(sourceHashes).length>128);
  assert.ok(Object.keys(sourceHashes).length<=PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT);
  assert.ok(sourceHashes['compute/mac-host.mjs']);assert.ok(sourceHashes['compute/desktop-cleanup.mjs']);
  assert.equal(verifyPublicWebQualification(f.receipt,f.options).status,'PASS');
  const changed={...sourceHashes,'compute/mac-host.mjs':'0'.repeat(64)};
  assert.throws(()=>verifyPublicWebQualification(f.receipt,{...f.options,sourceHashes:changed}),/PUBLIC_WEB_QUALIFICATION_SOURCE_CHANGED/);
});
test('signed source maps enforce the shared finite source limit', async t => {
  const f=await fixture(t),payload=structuredClone(f.payload);
  const sourceHashes=Object.fromEntries(Array.from({length:PUBLIC_WEB_QUALIFICATION_SOURCE_LIMIT},(_,i)=>['compute/fixture-'+i+'.mjs','f'.repeat(64)]));
  payload.observations.sourceHashes=sourceHashes;
  assert.equal(verifyPublicWebQualification(signed(payload,f.reviewerPrivateKey),{...f.options,sourceHashes}).status,'PASS');
  sourceHashes['compute/one-too-many.mjs']='e'.repeat(64);
  assert.throws(()=>verifyPublicWebQualification(signed(payload,f.reviewerPrivateKey),{...f.options,sourceHashes}),/PUBLIC_WEB_QUALIFICATION_SOURCE_CHANGED/);
});
"""
        chain(bounds, anchor, checks + anchor)

    # Synthetic setup adapters do not contain the pinned SDK. Their explicit
    # preparation seam records ordering; real SDK fixtures remove that seam.
    fixtures = [f'packages/AGI_{role}/tests/{name}'
                for role in ('Agent', 'Node')
                for name in ('setup-entry.test.mjs', 'fresh-oauth-fixture.mjs')]
    fixtures += [f'packages/AGI_{role}/tests/setup-standard-lifecycle-fixture.mjs' for role in ROLES]
    for fixture in fixtures:
        chain(fixture, 'const dependencies={deriveManagedGatewayAuthority:', "const dependencies={preparePinnedControlUICache:()=>events.push({command:'prepare pinned UI cache',candidate:true}),deriveManagedGatewayAuthority:")
    for role in ('Agent', 'Node'):
        entry_test = f'packages/AGI_{role}/tests/setup-entry.test.mjs'
        chain(entry_test, "const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies});\n const report=result.supportReport", "const question=f.rl.question;f.rl.question=async prompt=>{if(prompt.includes('Type APPROVE')){assert.equal(f.events.filter(e=>e.command==='prepare pinned UI cache').length,1);assert.equal(fs.existsSync(f.profileDir),false);assert.equal(f.active.size,0);}return question(prompt);};\n const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,dependencies:f.dependencies});\n const report=result.supportReport")
        lazy_test = f'packages/AGI_{role}/tests/setup-standard-lazy.test.mjs'
        chain(lazy_test, "import {captureStandardOAuthAuthority}", "import {validatePinnedControlUICache} from '../compute/setup-runtime-materialization.mjs';\nimport {captureStandardOAuthAuthority}")
        chain(lazy_test, "assert.equal(db.prepare('PRAGMA user_version').get().user_version,17);", "assert.ok(validatePinnedControlUICache(candidate,pinnedPackage).length>0,'actual Standard setup prepares the pinned cache before asking for approval');assert.equal(f.active.size,0);\n  assert.equal(db.prepare('PRAGMA user_version').get().user_version,17);")
    for role in ROLES:
        fixture = f'packages/AGI_{role}/tests/setup-standard-lifecycle-fixture.mjs'
        chain(fixture, 'Object.assign(f.runtime,{node,openclaw,versions:', "delete f.dependencies.preparePinnedControlUICache;\n Object.assign(f.runtime,{node,openclaw,artifact:{packageRoot:pinnedPackage},versions:")
        runtime_test = f'packages/AGI_{role}/tests/setup-runtime-materialization.test.mjs'
        chain(runtime_test, "const receipt=mode==='standard'?undefined:prepareCleanCandidateInitialization(f.args);", "if(mode==='standard')preparePinnedControlUICache(tx.candidate,packageRoot);\n const receipt=mode==='standard'?undefined:prepareCleanCandidateInitialization(f.args);")
        chain(runtime_test, "if(mode==='verified')validatePinnedControlUICache(f.profileDir,packageRoot);", 'validatePinnedControlUICache(f.profileDir,packageRoot);')
    add('tests/macos-control-ui-cache.test.mjs', (HERE / 'control-ui-cache.test.mjs').read_bytes())

    for edition in ['', *('packages/AGI_' + role + '/' for role in ROLES)]:
        guide_test = edition + 'tests/production-guide.test.mjs'
        anchor = "assert.match(html,/Existing installation: start here/);"
        mac_checks = """if(JSON.parse(read('release-manifest.json')).platformEdition==='macOS Apple silicon'){
 const release=JSON.parse(read('release-manifest.json')),guide=read('docs/macos-current/FRESH_INSTALL.md'),physical=read('docs/macos-current/PHYSICAL_QUALIFICATION.md');
 assert.equal(release.architecture,'arm64');assert.equal(release.productionArchitecture.default,'fresh-install');assert.equal(release.productionArchitecture.productionQualified,false);
 for(const page of ['FRESH_INSTALL','PHYSICAL_QUALIFICATION','TROUBLESHOOTING'])assert.ok(html.includes('docs/macos-current/'+page+'.html'));
 assert.match(html,/Native acceptance must be published for this exact ZIP/);assert.match(html,/separate signer and Standard compute accounts/);assert.match(html,/production qualification.*pending/);assert.match(html,/COMPUTE_STOP/);
 assert.doesNotMatch(html,/Existing installation: start here|agiagentv1|agiagentcomputev3|Update-Signer.command/);
 assert.match(guide,/two new.*Standard.*accounts/);assert.match(guide,/Install.command/);assert.match(guide,/4\\.93\\.0/);assert.match(guide,/private.*Node 24\\.21\\.0/);assert.match(guide,/8 GB operation is unqualified/);assert.match(guide,/Do not erase or reuse an incident account/);
 for(const role of ['Agent','Node','Moderator','Employer','Evidence','Recovery'])assert.ok(guide.includes(role));
 assert.match(physical,/NOT_RUN/);assert.match(physical,/72.hour/);assert.match(physical,/productionQualified: false/);return;
}"""
        edit(guide_test, anchor, mac_checks + anchor)
    old = "fs.writeFileSync(path.join(scripts,'node-runtime.sh'),controlled);fs.copyFileSync(path.join(root,app,'package.json'),path.join(stage,app,'package.json'));"
    new = "fs.writeFileSync(path.join(scripts,'node-runtime.sh'),controlled);for(const name of ['standard-node.sh','check-mac-host.mjs'])fs.copyFileSync(path.join(root,app,'scripts',name),path.join(scripts,name));fs.copyFileSync(path.join(root,app,'package.json'),path.join(stage,app,'package.json'));"
    edit('tests/launcher-runtime.test.mjs', old, new)

    for role in ('Agent', 'Node'):
        entry = f'packages/AGI_{role}/AGI {role}.app/Contents/MacOS/start'
        edit(entry, '. "$AGI_ROOT/scripts/node-runtime.sh"', '. "$AGI_ROOT/scripts/node-runtime.sh"\n. "$AGI_ROOT/scripts/standard-node.sh"')
        chain(entry, 'if ! agi_select_node_24; then', 'if ! agi_standard_node; then')
        old = f'First install Node.js 24.19.0 or later within 24.x using the official installer linked in Start Here. Then open AGI {role} again. No terminal commands or package installation are needed.'
        chain(entry, old, 'The private Node runtime could not be prepared. Check the internet connection and open Start Here for recovery. Existing profiles and wallets were preserved.')
        chain(entry, '  exit 0\nfi\n', '  exit 1\nfi\n"$AGI_RUNTIME_NODE" "$AGI_ROOT/scripts/check-mac-host.mjs"\n')
    signer_entries = [f'Launch-{role}{suffix}.command' for role in ('Employer', 'Moderator', 'Recovery') for suffix in ('', '-Seed-Wallet')]
    signer_entries += ['Launch-Evidence.command']
    signer_entries += [f'packages/AGI_{role}/Launch-AGI-{role}.command' for role in ('Moderator', 'Employer', 'Evidence', 'Recovery')]
    for entry in signer_entries:
        edit(entry, '. "./scripts/node-runtime.sh"', '. "./scripts/node-runtime.sh"\n. "./scripts/standard-node.sh"')
        chain(entry, 'agi_require_node_24\n', 'agi_standard_node\n"$AGI_RUNTIME_NODE" "./scripts/check-mac-host.mjs"\n')

    guide = 'https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/macos/docs/FRESH_INSTALL.md'
    for file in root.rglob('index.html'):
        relative = file.relative_to(root).as_posix()
        if 'node_modules' in file.parts or not ('app' in file.parts or 'web' in file.parts):
            continue
        text = file.read_text()
        if 'Linux fresh-install guide' not in text and 'Fresh Linux deployment' not in text:
            continue
        text = re.sub(r'https://github.com/MontrealAI/AGI-Fleet-Linux/blob/v[0-9.]+-qualification/docs/FRESH_INSTALL.md', guide, text)
        text = text.replace('Linux fresh-install guide', 'Mac fresh-install guide').replace('Fresh Linux deployment', 'Fresh Mac installation').replace('Linux installation guide', 'Mac installation guide').replace('Linux compute connection', 'Mac compute connection').replace('standard Linux account', 'Standard Mac account').replace('during Linux qualification', 'during Mac qualification').replace('Background operation on Linux', 'Background operation on Mac').replace('AGI Fleet · Linux', 'AGI Fleet · Mac')
        text = text.replace('Linux systemd user services and an available desktop keyring.', 'macOS LaunchAgents and the login Keychain in the dedicated Standard account.')
        text = text.replace('Configure-Public-Browser.sh', 'Configure-Public-Browser.command').replace('Install.sh --file PRIVATE_SETUP.json', 'Install.command --file PRIVATE_SETUP.json')
        text = text.replace('Fresh Ubuntu setup', 'Fresh Mac setup').replace('Have the administrator prepare new isolated accounts using the Linux guide.', 'Create separate Standard signer and compute accounts using the Mac guide.').replace('Export this private setup kit and transfer it using Transfer-Setup.sh.', 'Export this private setup kit and transfer only that file using the Mac guide; keep wallet material in the signer account.').replace('In the compute desktop session run Prepare-Compute.sh, then this role’s', 'In the compute account, start Docker Desktop, then open this role’s')
        text = text.replace('packages/AGI_ROLE/Launch.sh', 'packages/AGI_ROLE/Launch-Seed-Wallet.command').replace('open <b>Launch.sh</b>', 'open <b>Launch-Seed-Wallet.command</b>').replace('run <b>./Launch.sh</b> in Terminal', 'open <b>Launch-Seed-Wallet.command</b>')
        require('Fresh Ubuntu setup' not in text and 'Linux systemd' not in text and 'Transfer-Setup.sh' not in text and 'Prepare-Compute.sh' not in text, 'Unconverted Mac UI instructions: ' + relative)
        if text != file.read_text(): changes[relative] = (file.read_bytes(), text.encode())

    for relative, (_, content) in changes.items():
        file = root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
    script = root / 'scripts/sync-shared-runtime.py'
    for arguments in ([], ['--check']):
        subprocess.run([sys.executable, str(script), '--root', str(root), *arguments], check=True, stdout=subprocess.PIPE, text=True)
    generated = []
    canonical_changes = [name[len(base):] for name in changes if name.startswith(base)]
    for role in ROLES:
        for name in canonical_changes:
            generated.append('packages/AGI_' + role + '/shared/runtime/' + name)
        generated.extend('packages/AGI_' + role + '/' + name for name in ('compute/mac-host.mjs', 'compute/desktop-cleanup.mjs', 'scripts/qualify-mac.mjs'))
    generated.extend('packages/AGI_' + role + '/scripts/setup-openclaw.mjs' for role in ('Agent', 'Node'))
    generated.append('shared/runtime-inventory.json')
    paths = sorted(set(changes) | set(generated))
    return {'schema': 'agi-macos-runtime-overlay/v1', 'version': version, 'productionQualified': False, 'changedPaths': paths, 'files': [{'path': name, 'beforeSHA256': digest(changes[name][0]) if name in changes and changes[name][0] is not None else None, 'afterSHA256': digest((root / name).read_bytes())} for name in paths]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.root, args.version), indent=2))
