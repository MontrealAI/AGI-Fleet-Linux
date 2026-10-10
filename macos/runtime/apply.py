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
