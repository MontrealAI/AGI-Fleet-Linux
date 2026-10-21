from pathlib import Path
import shutil, subprocess, unittest

class DiscoveryLabReceiver(unittest.TestCase):
    def test_explicit_receiver_contract(self):
        node=shutil.which('node')
        self.assertIsNotNone(node, 'Node is required for the Discovery Lab receiver tests')
        root=Path(__file__).resolve().parents[2]
        result=subprocess.run([node,'--test','--test-reporter=tap','discovery-lab/receiver.test.mjs'],cwd=root,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('# fail 0',result.stdout)
