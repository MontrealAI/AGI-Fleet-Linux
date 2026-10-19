# SPDX-License-Identifier: MIT
"""TEST ONLY: real host Playwright actuator, without Docker/container isolation.

The sole page is Fleet's separately validated escaped fixed summary. This is
neither a production backend nor a fallback for the mandatory Docker gates.
"""
import argparse
import base64
import hashlib
import importlib.machinery
import json
from pathlib import Path
import sys

parser = argparse.ArgumentParser(description=__doc__)
for name in ("alpha-root", "handoff", "chromium", "home", "output", "records"):
    parser.add_argument("--" + name, required=True, type=Path)
parser.add_argument("--confirm-test-only-host-browser", action="store_true")
args = parser.parse_args()
if not args.confirm_test_only_host_browser:
    raise ValueError("TEST_ONLY_HOST_BROWSER_CONFIRMATION_REQUIRED")

# Compile committed Python sources, never a cached bytecode substitution.
class SourceOnly(importlib.machinery.SourceFileLoader):
    def get_code(self, fullname):
        return self.source_to_code(self.get_data(self.path), self.path)

sys.path_hooks.insert(0, importlib.machinery.FileFinder.path_hook(
    (SourceOnly, importlib.machinery.SOURCE_SUFFIXES),
    (importlib.machinery.ExtensionFileLoader, importlib.machinery.EXTENSION_SUFFIXES)))
sys.path_importer_cache.clear()
expected = json.loads(args.records.read_text())["alpha"]["files"]
actual = {p.relative_to(args.alpha_root).as_posix(): p for p in args.alpha_root.rglob("*") if p.is_file()}
if set(actual) != set(expected) or any(p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest() != expected[n]["sha256"] for n, p in actual.items()):
    raise ValueError("TEST_CAPTURE_CHANGED")
sys.path.insert(0, str(args.alpha_root))
from alpha_factory_v1.core.runtime.store import Journal
from alpha_factory_v1.core.runtime.successor.computer import commitment, run_session
from alpha_factory_v1.core.runtime.successor.computer_handoff import ComputerHandoff, write_computer_return
from playwright.sync_api import sync_playwright

handoff = ComputerHandoff.model_validate_json(args.handoff.read_bytes())
if handoff.task.allowed_urls or "<script" in handoff.task.html.lower() or "Content-Security-Policy" not in handoff.task.html:
    raise ValueError("FIXED_NETWORKLESS_SUMMARY_REQUIRED")
browser_hash = hashlib.sha256(args.chromium.read_bytes()).hexdigest()
network_requests = []
closed = []

class FixedSummaryAdvisor:
    # Preserve the existing return protocol's provider wire fields. The model
    # and endpoint explicitly identify a fixed local advisor, not a live model.
    identity = {"mode": "vision-json", "model": "TEST_ONLY_HOST_PLAYWRIGHT_NO_DOCKER_FIXED_ADVISOR", "endpoint": "TEST_ONLY_NO_NETWORK"}
    def __init__(self):
        self.turn = 0
    def next(self, task, observation):
        self.turn += 1
        if self.turn == 1:
            return {"actions": [{"type": "screenshot"}], "done": False, "summary": ""}
        if "Independent usefulness review pending" not in observation["text"]:
            raise ValueError("PENDING_REVIEW_LABEL_NOT_VISIBLE")
        return {"actions": [], "done": True, "summary": "Fixed summary displayed; independent usefulness remains pending."}

class TestOnlyHostBrowser:
    name = "TEST_ONLY_HOST_PLAYWRIGHT_NO_CONTAINER_ISOLATION"
    def __init__(self, image, task, checkpoint):
        self.checkpoint = checkpoint
        self.playwright = sync_playwright().start()
        try:
            self.browser = self.playwright.chromium.launch(executable_path=str(args.chromium), headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"])
            self.context = self.browser.new_context(viewport={"width": 1024, "height": 768},
                java_script_enabled=False, service_workers="block", accept_downloads=False)
            def refuse(route):
                network_requests.append(route.request.url)
                route.abort()
            self.context.route("**/*", refuse)
            self.page = self.context.new_page()
            self.page.set_content(task.html, wait_until="load", timeout=15_000)
        except BaseException:
            self.close()
            raise
    def observe(self):
        self.checkpoint()
        return {"png": base64.b64encode(self.page.screenshot()).decode(),
                "text": self.page.locator("body").inner_text(), "url": self.page.url}
    def act(self, action):
        if action != {"type": "screenshot"}:
            raise ValueError("TEST_ONLY_SCREENSHOT_ACTION_REQUIRED")
        return self.observe()
    def close(self):
        if hasattr(self, "browser"):
            self.browser.close()
            if self.browser.is_connected():
                raise ValueError("TEST_BROWSER_STILL_CONNECTED")
        self.playwright.stop()
        closed.append(True)

advisor = FixedSummaryAdvisor()
journal = Journal.initialize(args.home)
# This field is deliberately a headless binary hash, NOT a Docker image ID.
image = "sha256:" + browser_hash
permit = commitment(handoff.task, advisor, image, handoff.context())
result = run_session(journal, handoff.task, advisor, image, args.output, permit,
    factory=TestOnlyHostBrowser, execution_context=handoff.context())
returned = write_computer_return(handoff, journal, advisor, image, args.output)
if result["state"] != "review" or returned["receipt"]["cleanup"] != "VERIFIED" or not closed or network_requests:
    raise ValueError("TEST_ONLY_BROWSER_END_STATE_INVALID")
evidence = {"schema": "agi-fleet/ti-test-only-browser/v1", "executionClass": "TEST_ONLY_HOST_PLAYWRIGHT_NO_DOCKER",
    "containerIsolation": False, "productionQualified": False, "independentReview": False,
    "imageFieldMeaning": "headless-binary-sha256-not-docker-image", "headlessBinarySha256": browser_hash,
    "explicitPermit": permit, "browserDisconnected": True, "networkRequests": network_requests,
    "nativeState": result["state"], "authority": "none", "settlement": "not-connected"}
(args.output / "test-only-evidence.json").write_text(json.dumps(evidence, sort_keys=True) + "\n")
print(json.dumps(evidence, sort_keys=True))
