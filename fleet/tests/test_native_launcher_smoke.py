import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('native_smoke', ROOT / 'scripts/smoke-native-launchers.py')
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)
NODE = pathlib.Path(shutil.which('node')).resolve()
HTML = b'<!doctype html><html><title>Exact packaged fixture</title></html>'


class OwnershipRegression(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='launcher-ownership-regression-')
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name)
        self.root = self.base / 'release'
        self.root.mkdir()
        (self.root / 'config').mkdir()
        (self.root / 'config/companion-releases.json').write_text(json.dumps({'role': 'agent'}))
        (self.root / 'src').mkdir()
        (self.root / 'app').mkdir()
        (self.root / 'app/index.html').write_bytes(HTML)
        self.output = self.base / 'evidence'
        self.output.mkdir()

    def launcher(self, script, module):
        path = self.root / 'Launch-AGI-Agent.command'
        path.write_text('#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\n' + script)
        path.chmod(0o755)
        (self.root / 'src/launch.mjs').write_text(module)
        return path

    def test_unrelated_server_with_exact_html_and_forged_private_record_is_rejected(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                self.wfile.write(HTML)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        module = "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';const h=os.homedir();fs.writeFileSync(path.join(h,'application.lock'),JSON.stringify({pid:process.pid}));fs.writeFileSync(path.join(h,'launch.json'),JSON.stringify({port:" + str(server.server_port) + "}));console.log('http://127.0.0.1:" + str(server.server_port) + "/');setInterval(()=>{},1000);"
        launcher = self.launcher('exec ' + str(NODE) + ' src/launch.mjs\n', module)
        result = SMOKE.run_case(launcher, self.root, self.output, NODE, 1.2, 1, 'agent')
        self.assertEqual(result['result'], 'FAIL', result)
        self.assertNotIn('http', result)

    def test_real_owned_server_cannot_mask_nonzero_launcher_exit(self):
        module = "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';const h=os.homedir();fs.writeFileSync(path.join(h,'application.lock'),JSON.stringify({pid:process.pid}));const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(fs.readFileSync(new URL('../app/index.html',import.meta.url)));});server.listen(0,'127.0.0.1',()=>{const port=server.address().port;fs.writeFileSync(path.join(h,'launch.json'),JSON.stringify({port}));console.log('http://127.0.0.1:'+port+'/');});"
        launcher = self.launcher(str(NODE) + ' src/launch.mjs &\nsleep 0.15\nexit 7\n', module)
        result = SMOKE.run_case(launcher, self.root, self.output, NODE, 3, 1, 'agent')
        self.assertEqual(result['result'], 'FAIL', result)
        self.assertEqual(result['exitCodeBeforeCleanup'], 7, result)
        self.assertIn('exited unexpectedly', result['error'])

    def test_same_case_owned_server_serving_wrong_html_is_rejected(self):
        module = "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';const h=os.homedir();fs.writeFileSync(path.join(h,'application.lock'),JSON.stringify({pid:process.pid}));const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>Wrong application</title>');});server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(path.join(h,'launch.json'),JSON.stringify({port:server.address().port}));});"
        launcher = self.launcher('exec ' + str(NODE) + ' src/launch.mjs\n', module)
        result = SMOKE.run_case(launcher, self.root, self.output, NODE, 1.2, 1, 'agent')
        self.assertEqual(result['result'], 'FAIL', result)
        self.assertNotIn('http', result)


class RealPackagedGUIRegression(unittest.TestCase):
    def test_all_actual_gui_shell_and_app_entries(self):
        launchers = [p for p in SMOKE.discover(ROOT) if '.app' in str(p) or p.name.startswith('Launch-') and not p.name.startswith('Launch-Native-Workforce.')]
        self.assertTrue(launchers)
        with tempfile.TemporaryDirectory(prefix='real-gui-regression-') as temporary:
            output = pathlib.Path(temporary)
            for index, launcher in enumerate(launchers, 1):
                with self.subTest(launcher=str(launcher.relative_to(ROOT))):
                    result = SMOKE.run_case(launcher, ROOT, output, NODE, 20, index, SMOKE.package_role(launcher, ROOT))
                    self.assertEqual(result['result'], 'PASS_LOOPBACK_HTTP', result)
                    self.assertTrue(result['http']['ownership']['isolatedHomeAndCaseNonceVerified'])
                    self.assertTrue(result['http']['exactPackagedHTMLVerified'])


class ReleaseClassificationRegression(unittest.TestCase):
    def test_actual_cleanup_launchers_only_inspect_an_isolated_home(self):
        with tempfile.TemporaryDirectory(prefix='cleanup-launcher-regression-') as temporary:
            output = pathlib.Path(temporary)
            for index, role in enumerate(['agent','node','moderator','employer','evidence','recovery'], 1):
                app = ROOT / 'packages' / ('AGI_' + role.title())
                with self.subTest(role=role):
                    result = SMOKE.run_case(app / 'Cleanup-Evidence.command', app, output, NODE, 10, index, role)
                    self.assertEqual(result['result'], 'PASS_MODULE_ENTRY', result)
                    self.assertEqual(result['probe'], 'real-module-read-only-report')

    def test_operator_dependency_packages_directory_is_not_fleet(self):
        with tempfile.TemporaryDirectory(prefix='standalone-role-classification-') as temporary:
            root = pathlib.Path(temporary)
            (root / 'config').mkdir()
            (root / 'config/companion-releases.json').write_text(json.dumps({'role': 'moderator'}))
            (root / 'packages/AGI_Node').mkdir(parents=True)
            (root / 'packages/AGI_Node/Install.command').write_text('#!/bin/sh\n')
            for name in ('Install.command', 'Qualify-Mac.command'):
                (root / name).write_text('#!/bin/sh\n')
            launchers, cases = SMOKE.build_cases(root)
            self.assertFalse(SMOKE.is_fleet(root))
            self.assertEqual(len(launchers), 2)
            self.assertEqual([(p.name, role, direct) for p, role, direct in cases], [('Install.command', 'moderator', False), ('Qualify-Mac.command', 'moderator', False)])
            self.assertEqual(SMOKE.gui_contract(root / 'Launch-AGI-Moderator.command', root, 'moderator')['entry'], root / 'ops/launch.mjs')

    def test_fleet_metadata_requires_all_six_packages(self):
        with tempfile.TemporaryDirectory(prefix='incomplete-fleet-classification-') as temporary:
            root = pathlib.Path(temporary)
            (root / 'config').mkdir()
            (root / 'config/companion-releases.json').write_text(json.dumps({'role': 'fleet'}))
            (root / 'packages/AGI_Node').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'requires all six'):
                SMOKE.build_cases(root)


if __name__ == '__main__':
    unittest.main(verbosity=2)
