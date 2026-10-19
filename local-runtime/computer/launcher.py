# SPDX-License-Identifier: MIT
"""Fixed native Alpha bridge; only an installed zero-cost action fixture can execute."""
from __future__ import annotations

import base64
import hashlib
import importlib.machinery
import json
import os
from pathlib import Path
import signal
import sys


def fail(condition, code):
    if not condition:
        raise ValueError(code)


def install_source_only_imports(root):
    """Ignore timestamp-valid bytecode, including caches present before launch."""
    class SourceOnlyLoader(importlib.machinery.SourceFileLoader):
        def get_code(self, fullname):
            return self.source_to_code(self.get_data(self.path), self.path)
    sys.path_hooks.insert(0, importlib.machinery.FileFinder.path_hook(
        (SourceOnlyLoader, importlib.machinery.SOURCE_SUFFIXES),
        (importlib.machinery.ExtensionFileLoader, importlib.machinery.EXTENSION_SUFFIXES)))
    sys.path_importer_cache.clear()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(root))


def main():
    os.umask(0o077)
    fail(len(sys.argv) == 2 and sys.argv[1] in {"probe", "prepare", "run"}, "COMPUTER_MODE_INVALID")
    mode = sys.argv[1]
    raw = sys.stdin.buffer.read(2_000_001)
    fail(len(raw) <= 2_000_000, "COMPUTER_INPUT_LIMIT")
    request = json.loads(raw)
    profile = request["profile"]
    root = Path(profile["alphaRoot"])
    if mode != "probe":
        fail(profile["provider"]["mode"] == "scripted-zero-cost", "UNCOMMISSIONED_PROVIDER_COST")
    install_source_only_imports(root)
    from alpha_factory_v1.core.runtime.store import Journal
    from alpha_factory_v1.core.runtime.successor import computer
    from alpha_factory_v1.core.runtime.successor.computer_handoff import ComputerHandoff, write_computer_return
    from alpha_factory_v1.core.runtime.successor.protocol import safe_json_loads

    if mode == "probe":
        files = {}
        for module in list(sys.modules.values()):
            for name in ("__file__",):
                value = getattr(module, name, None)
                if not value:
                    continue
                path = Path(value).resolve()
                if path.is_file():
                    fail(path.stat().st_size <= 32_000_000, "COMPUTER_RUNTIME_FILE_LIMIT")
                    files[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        fail(len(files) <= 2048, "COMPUTER_RUNTIME_FILE_LIMIT")
        print(json.dumps({"files": files, "python": sys.version.split()[0]}, separators=(",", ":")))
        return

    fail(profile["provider"]["mode"] == "scripted-zero-cost", "UNCOMMISSIONED_PROVIDER_COST")
    handoff_raw = request["handoffRaw"]
    fail(hashlib.sha256(handoff_raw.encode("utf-8")).hexdigest() == profile["fixture"]["handoffSha256"], "COMPUTER_FIXTURE_BINDING")
    handoff = ComputerHandoff.model_validate(safe_json_loads(handoff_raw, max_bytes=1_000_000))
    task = handoff.task
    fail(task.input_rights in {"public", "synthetic"}, "COMPUTER_PUBLIC_NONPERSONAL_REQUIRED")
    fail(task.max_actions <= 30 and task.max_turns <= 10 and task.max_seconds <= 120, "COMPUTER_LIMITS_EXCEEDED")
    actions = [computer.validate_action(value) for value in profile["fixture"]["actions"]]
    fail(len(actions) <= task.max_actions and (len(actions) + 4) // 5 + 1 <= task.max_turns, "COMPUTER_FIXTURE_LIMITS")
    batches = [actions[index:index + 5] for index in range(0, len(actions), 5)]

    class ScriptedAdvice:
        identity = {
            "mode": "responses",
            "model": "SCRIPTED_ZERO_COST_REHEARSAL_" + profile["fixtureSha256"],
            "endpoint": "http://127.0.0.1/fixture-no-network",
        }

        def __init__(self):
            self.calls = 0

        def next(self, task, observation):
            png = base64.b64decode(observation["png"], validate=True)
            fail(png[:8] == b"\x89PNG\r\n\x1a\n", "COMPUTER_SCREENSHOT_REQUIRED")
            index = self.calls
            self.calls += 1
            done = index >= len(batches)
            return {"actions": [] if done else batches[index], "done": done,
                    "summary": "Scripted zero-cost browser rehearsal; useful work and acceptance require separate review." if done else ""}

    advisor = ScriptedAdvice()
    permit = computer.commitment(task, advisor, profile["image"], handoff.context())
    preparation = {
        "permit": permit, "handoffSha256": hashlib.sha256(handoff_raw.encode("utf-8")).hexdigest(),
        "executionContext": handoff.context(), "projectSha256": handoff.projectSha256,
        "nativeHandoffSha256": handoff.identity()["handoffSha256"],
        "provider": advisor.identity, "maxSeconds": task.max_seconds, "maxActions": task.max_actions,
        "maxTurns": task.max_turns, "providerRequests": 0, "scriptedAdvice": True,
    }
    if mode == "prepare":
        print(json.dumps(preparation, separators=(",", ":")))
        return
    fail(request["permit"] == permit, "COMPUTER_PERMIT_CHANGED")
    home = Path(request["home"])
    journal = Journal(home) if home.exists() else Journal.initialize(home)
    output = Path(request["output"])

    def interrupted(signum, frame):
        raise KeyboardInterrupt("Fleet STOP or cancellation")

    signal.signal(signal.SIGTERM, interrupted)
    try:
        computer.run_session(journal, task, advisor, profile["image"], output, permit, execution_context=handoff.context())
    finally:
        if (output / "receipt.json").is_file():
            write_computer_return(handoff, journal, advisor, profile["image"], output)
    print(json.dumps({"state": "review", "providerRequests": 0, "scriptedAdvice": True}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        code = str(error)
        sys.stderr.write(code if code and all(character in "ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789" for character in code) else "COMPUTER_FAILED_OR_UNCERTAIN")
        sys.exit(1)
