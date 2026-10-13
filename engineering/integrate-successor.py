#!/usr/bin/env python3
"""Materialize reviewed SUCCESSOR modules in every existing edition."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[1]

def replace_once(text, old, new):
    if new in text:
        return text
    assert text.count(old) == 1, old
    return text.replace(old, new)

for role in ('AGI_Agent', 'AGI_Node'):
    app = ROOT / 'fleet/packages' / role
    role_id = 'agent' if role == 'AGI_Agent' else 'node'
    p = app / 'src/control/companion.mjs'
    p.write_text(replace_once(p.read_text(), 'stopped:h.stopped===true,publicWeb}', 'stopped:h.stopped===true,publicWeb,runtime:h.runtime??null}'))
    p = app / 'src/control/server.mjs'
    s = p.read_text().replace('successor().', 'successor.')
    if 'import {SuccessorController}' not in s:
        s = "import {SuccessorController} from '../../successor/controller.mjs';\nimport {studioSpec,validateHandoff} from '../studio.mjs';\nimport {validateBundle,computerVerdict} from '../artifacts.mjs';\n" + s
    eager = f"  const successor = new SuccessorController(controller, '{role_id}', {{studioSpec,validateHandoff,validateBundle,computerVerdict}});"
    lazy = f"""  let successorAdapter;
  const successor = () => {{
    ensure(typeof controller.home === 'string' && path.isAbsolute(controller.home), 'FLEET_HOME_REQUIRED');
    return successorAdapter ??= new SuccessorController(controller, '{role_id}', {{studioSpec,validateHandoff,validateBundle,computerVerdict}});
  }};"""
    if eager in s:
        s = s.replace(eager, lazy)
    elif lazy not in s:
        s = replace_once(s, '  const sessions = new Map(),', lazy + '\n  const sessions = new Map(),')
    s = replace_once(s, '"/studio.js": ["studio.js", "text/javascript; charset=utf-8"],', '"/studio.js": ["studio.js", "text/javascript; charset=utf-8"],\n          "/successor.js": ["successor.js", "text/javascript; charset=utf-8"],')
    s = replace_once(s, 'else if (url.pathname === "/api/studio")', 'else if (url.pathname === "/api/successor") json(successor.status());\n        else if (url.pathname === "/api/successor/runtime") json(await successor.health());\n        else if (url.pathname === "/api/studio")')
    s = s.replace('url.pathname === "/api/studio/start" ? 128 * 1024 * 1024', '["/api/studio/start","/api/successor/prepare"].includes(url.pathname) ? 128 * 1024 * 1024')
    s = replace_once(s, '      const actions = {', '''      const actions = {
        "/api/successor/prepare": ["Inspecting the SUCCESSOR work", () => successor.prepare(input,session.csrf)],
        "/api/successor/execute": ["Authorizing the exact SUCCESSOR work", () => successor.execute(input,session.csrf)],
        "/api/successor/revoke": ["Revoking pending SUCCESSOR choices", () => successor.revoke()],
        "/api/successor/stop": ["Stopping SUCCESSOR work", () => successor.stop()],
        "/api/successor/result": ["Checking SUCCESSOR results", () => successor.result(input.key,input.review??null)],''')
    s = replace_once(s, '      const actions = {', '      if (url.pathname === "/api/successor/revoke") { json(successor.revoke()); return; }\n      const actions = {')
    s = s.replace('"/api/studio/cancel"].includes(url.pathname)', '"/api/studio/cancel","/api/successor/stop"].includes(url.pathname)')
    s = s.replace('"/api/successor/stop","/api/successor/revoke"', '"/api/successor/stop"')
    if 'import {parseStrict}' not in s:
        s = "import {parseStrict} from '../../successor/vendor/manager/site/assets/successor/safe.mjs';\n" + s
    s = s.replace('return JSON.parse(Buffer.concat(parts).toString("utf8"));', 'const raw = Buffer.concat(parts).toString("utf8");\n      return req.url.startsWith("/api/successor/") ? parseStrict(raw,limit) : JSON.parse(raw);')
    for method in ('status', 'health', 'prepare', 'execute', 'revoke', 'stop', 'result'):
        s = s.replace('successor.' + method + '(', 'successor().' + method + '(')
    p.write_text(s)
    p = app / 'app/index.html'
    p.write_text(replace_once(p.read_text(), '<script src="/studio.js"></script>', '<script src="/studio.js"></script>\n    <script src="/successor.js"></script>'))
    shutil.copyfile(ROOT / 'successor/installed-ui.js', app / 'app/successor.js')

p = ROOT / 'fleet/shared/runtime/compute/runtime.mjs'
s = p.read_text().replace('&&spec.coordination.parentSpecSha256===null', '')
if '// A parent commitment' not in s:
    s = s.replace(' ensure(spec.coordination.dependencies.length===0', ' // A parent commitment is inert provenance, never delegation or dependency admission.\n ensure(spec.coordination.dependencies.length===0')
p.write_text(s)

for role in ('AGI_Agent', 'AGI_Node'):
    source = ROOT / 'fleet/packages' / role
    for directory in (ROOT / 'fleet/packages').glob('*/packages/' + role):
        for sub in ('src', 'app'):
            for file in (source / sub).rglob('*'):
                destination = directory / file.relative_to(source)
                if file.is_file() and destination.is_file() and file.name != 'launch.mjs':
                    shutil.copyfile(file, destination)

targets = [*(ROOT / 'fleet/packages').glob('AGI_*'), *(ROOT / 'fleet/packages').glob('*/packages/AGI_*')]
for app in targets:
    shutil.copytree(ROOT / 'fleet/successor', app / 'successor', dirs_exist_ok=True)
print('Materialized SUCCESSOR in', 1 + len(targets), 'Fleet and role source trees.')
