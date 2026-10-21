"""Failure-path privacy regression with a protocol double; no browser is executed."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest


class DashboardPrivacy(unittest.TestCase):
    def test_driver_never_emits_credential_bearing_traceback(self):
        secret='a'*64
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'playwright').mkdir();(root/'playwright/__init__.py').write_text('')
            marker=root/'private-double-reached'
            (root/'playwright/sync_api.py').write_text("def expect(*_args, **_kwargs):\n    raise AssertionError('unexpected expect call')\n\ndef sync_playwright():\n    from pathlib import Path\n    Path("+repr(str(marker))+").touch()\n    raise ValueError('fill value "+secret+"')\n")
            environment={**os.environ,'PYTHONPATH':str(root),'PYTHONDONTWRITEBYTECODE':'1'}
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('fleet-dashboard-export.py'))],input='{"url":"http://127.0.0.1:1234","token":"'+secret+'"}',text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment)
            self.assertTrue(marker.is_file());self.assertEqual(result.returncode,1);self.assertEqual(result.stderr,'DASHBOARD_DRIVER_FAILED\n');self.assertNotIn(secret,result.stdout+result.stderr);self.assertNotIn('Traceback',result.stderr)


if __name__=='__main__':unittest.main()
