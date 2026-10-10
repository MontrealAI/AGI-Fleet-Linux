"""Narrow Mac preview additions; the original Darwin provider stays intact."""
from pathlib import Path
import json
import shutil

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def apply(root):
    root = Path(root).resolve()
    if root.is_relative_to(REPO):
        raise ValueError('Preview output must be outside the repository')
    engine = root / 'workforce'
    if (engine / 'operator.mjs').exists():
        raise ValueError('Preview already applied')
    originals = {name: (engine / name).read_bytes() for name in ('platform.mjs', 'gateway.mjs', 'native.mjs', 'authority.mjs', 'envelope.mjs', 'project.mjs')}

    def edit(name, old, new):
        file = engine / name
        source = file.read_text()
        if source.count(old) != 1:
            raise ValueError('Preview anchor changed: ' + name)
        file.write_text(source.replace(old, new))

    for name in ('operator.mjs', 'task-host.mjs', 'launch.mjs'):
        shutil.copyfile(HERE / name, engine / name)
    # Keep the host guard inside sourceDigest's scope: grants must change if
    # platform/translation checks change, just as they do for native actions.
    shutil.copyfile(root / 'shared/runtime/compute/mac-host.mjs', engine / 'mac-host.mjs')
    shutil.copyfile(REPO / 'workstation/engine/job-draft.mjs', engine / 'job-draft.mjs')
    shutil.copyfile(HERE / 'QUICKSTART.md', engine / 'QUICKSTART.md')
    edit('runner.mjs', 'import fs from "node:fs";', 'import {assertMacTaskHost} from "./task-host.mjs";\nimport fs from "node:fs";')
    edit('runner.mjs', '  if (b.mode === "production") {', '  need(b.mode === "pilot", "MAC_PREVIEW_PILOT_ONLY");\n  if (b.mode === "production") {')
    edit('runner.mjs', '  validatePacket(packet);\n  need(', '  validatePacket(packet);\n  need(packet.specification.profile === "computer-work/v3", "MAC_PREVIEW_V3_REQUIRED");\n  need(!fs.lstatSync(path.join(c.dataDir,"STOP"),{throwIfNoEntry:false}), "OPERATOR_STOP");\n  if(!allowTestPlatform)assertMacTaskHost();\n  need(')
    edit('runner.mjs', '    abort.throwIfAborted();\n    checkAuthority(', '    abort.throwIfAborted();\n    need(!fs.lstatSync(path.join(c.dataDir,"STOP"),{throwIfNoEntry:false}), "OPERATOR_STOP");\n    checkAuthority(')
    edit('cli.mjs', 'import fs from "node:fs";', 'import {stopWorkspace,resumeWorkspace,workspaceStatus} from "./operator.mjs";\nimport {descriptor,draftJob} from "./job-draft.mjs";\nimport {assertMacTaskHost} from "./task-host.mjs";\nimport fs from "node:fs";')
    edit('cli.mjs', 'async function init(a) {', 'async function init(a) {\n  // Preparation creates no execution authority or provider connection.')
    edit('cli.mjs', '    model: "openai/gpt-6-astra",', '    model: a.model ?? "openai/gpt-6-astra",')
    edit('cli.mjs', '    appBundlePath: "/Applications/OpenClaw.app",', '    appBundlePath: path.resolve(a.app ?? "/Applications/OpenClaw.app"),')
    edit('cli.mjs', 'async function packet(c, a) {', '''async function packet(c, a) {
  need((a.mode??"pilot")==="pilot","MAC_PREVIEW_PILOT_ONLY");
  const signingKey=readSecret(path.resolve(a["signing-key"]));
  need(crypto.createPublicKey(signingKey).export({format:"pem",type:"spki"})===c.operatorPublicKey,"AUTHORITY_SIGNER");''')
    edit('cli.mjs', '  const delivery = a.delivery ? validateDelivery(spec, json(a.delivery)) : null,', '  need(spec.profile === "computer-work/v3", "MAC_PREVIEW_V3_REQUIRED");\n  const delivery = a.delivery ? validateDelivery(spec, json(a.delivery)) : null,')
    edit('cli.mjs', '  if (command === "menu") {', '  if (command === "legacy-menu") {')
    edit('cli.mjs', '  if (command === "export-result") {', '''  if(command==="menu"){const {launch}=await import('./launch.mjs');return launch();}
  if(command==="preflight"){
    output(a.out,{schema:'agi-macos-workstation-preflight/v1',host:assertMacTaskHost(),qualified:false,productionExecution:'DISABLED',next:'Pair the real signed OpenClaw Mac app and inspect it with doctor. This preflight performs no model or desktop action.'});return;
  }
  if(["status","stop","resume"].includes(command)){
    need(a.config,"CONFIG_PATH");const raw=JSON.parse(readSecret(path.resolve(a.config),1048576));
    output(a.out,command==='status'?workspaceStatus(raw):command==='stop'?stopWorkspace(raw):resumeWorkspace(raw,a.acknowledge));return;
  }
  if (command === "export-result") {''')
    edit('cli.mjs', '  if (command === "bind") {', '  if (command === "bind") {\n    assertMacTaskHost();')
    edit('cli.mjs', '    c.provider = a.provider;', '    c.provider = a.provider;\n    need(path.isAbsolute(a["authority-file"]??""),"AUTHORITY_PATH");\n    c.revocationFile = a["authority-file"];')
    edit('cli.mjs', '''    output(a.out, {
      sourceSha256: sourceDigest(),
      runtime: nativeRuntime(c),
      runtimeSha256: core.digest(nativeRuntime(c)),
    });''', '    output(a.out, {...descriptor(c),sourceSha256:sourceDigest()});')
    edit('cli.mjs', '  if (command === "doctor") return doctor(c, { save: a.out });', '''  if(command==='draft-job'){
    need(a.out&&a['reviewer-descriptor'],'DRAFT_ARGUMENTS');
    const options={chainId:Number(a['chain-id']),manager:a.manager};
    for(const name of ['title','prompt','output','authority'])if(a[name]!==undefined)options[name]=a[name];
    if(a['data-policy']!==undefined)options.dataPolicy=a['data-policy'];
    const spec=draftJob(c,json(a['reviewer-descriptor']),options);output(a.out,spec);
    output(null,{draft:a.out,profile:spec.profile,grantCreated:false,executed:false,next:'Review exact goal, files, criteria, authority, recipients and budgets before separately signing a pilot packet.'});return;
  }
  if (command === "doctor") {assertMacTaskHost();return doctor(c, { save: a.out });}''')
    edit('cli.mjs', '''    const result = await runNative(c, decodePacket(a), {
      resumeKey: readSecret(path.resolve(a["recipient-key"])),
    });
    output(null, result);''', '''    const abort=new AbortController(),stop=()=>abort.abort(Error('WORKFORCE_OPERATOR_STOP'));
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    try {output(null,await runNative(c,decodePacket(a),{signal:abort.signal,resumeKey:readSecret(path.resolve(a['recipient-key']))}));}
    finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);}''')
    edit('cli.mjs', '    while (!stopped) {', '    while (!stopped && !fs.lstatSync(path.join(c.dataDir,"STOP"),{throwIfNoEntry:false})) {')
    edit('cli.mjs', '        if (stopped) break;\n        const file =', '        if (stopped || fs.lstatSync(path.join(c.dataDir,"STOP"),{throwIfNoEntry:false})) break;\n        const file =')
    edit('cli.mjs', 'const usage = `', '''const usage = `Mac source preview — native guided work; production disabled
  node workforce/launch.mjs                 Open the guided menu
  npm run workforce -- preflight           Inspect this Standard Mac account
  npm run workforce -- status --config CONFIG
  npm run workforce -- stop --config CONFIG
  npm run workforce -- resume --config CONFIG --acknowledge true
  npm run workforce -- draft-job --config CONFIG --reviewer-descriptor DESCRIPTOR --chain-id CHAIN --manager ADDRESS --authority whole-account --out JOB
  init accepts --model MODEL and --app /Applications/OpenClaw.app.
  bind additionally requires --authority-file ABSOLUTE_SIGNED_RECORD.
  Only computer-work/v3 pilot packets execute; production grants are rejected.
  Read workforce/QUICKSTART.md. No release qualification is inherited.

Inherited advanced commands (production options are disabled in this preview):
''')
    # Every bundled native-engine copy receives the same Mac preview additions.
    for directory in sorted((root / 'packages').glob('*/workforce')):
        shutil.copytree(engine, directory, dirs_exist_ok=True)
    for edition in [root, *(root / 'packages').glob('AGI_*')]:
        launcher = edition / 'Launch-Native-Workforce.command'
        if launcher.exists():
            source = launcher.read_text()
            old = 'agi_require_node_24\n'
            if source.count(old) != 1:
                raise ValueError('Native launcher anchor differs')
            source = source.replace(old, '. "./scripts/standard-node.sh"\nagi_standard_node\n"$AGI_RUNTIME_NODE" "./scripts/check-mac-host.mjs"\n')
            launcher.write_text(source);launcher.chmod(0o755)
    for name, expected in originals.items():
        if (engine / name).read_bytes() != expected:
            raise ValueError('Original Mac provider changed: ' + name)
    # All platform-neutral Studio code is reused; only its platform-specific help
    # strings/links are adapted after the shared overlay has been copied.
    for role in ('Agent','Node'):
        app = root / 'packages' / ('AGI_' + role)
        file=app/'src/control/messages.mjs';text=file.read_text().replace('This Linux edition','This Mac preview').replace('standard Linux user','Standard Mac user').replace('keyring access','Keychain access').replace('actual Linux host','actual Mac host');file.write_text(text)
        file=app/'app/index.html';text=file.read_text().replace('/docs/Linux-Guide.html','https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/macos/preview/STUDIO.md')
        body = '<body class="genesis-' + role.lower() + '">'
        if text.count(body) != 1:
            raise ValueError('Studio preview notice anchor differs')
        text=text.replace(body,body+'\n<aside role="note" style="padding:14px 20px;background:#fff3d6;color:#493813;font:600 16px/1.5 system-ui">Mac source preview · outside the 1.20.0 ZIP. Use isolated test profiles. No release qualification is inherited. <a href="https://github.com/MontrealAI/AGI-Fleet-Linux/blob/main/macos/preview/STUDIO.md" style="color:inherit;text-decoration:underline">Studio preview setup</a></aside>')
        file.write_text(text)
    return {'platformEngine':'original-darwin-arm64','productionExecution':'DISABLED','preservedModules':sorted(originals),'studioSource':'workstation/studio-overlay','composerSource':'workstation/engine/job-draft.mjs'}
