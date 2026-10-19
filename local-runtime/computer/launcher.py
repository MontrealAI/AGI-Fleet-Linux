# SPDX-License-Identifier: MIT
"""Fixed native Alpha bridge; only an installed zero-cost action fixture can execute."""
from __future__ import annotations

import base64
import hashlib
import importlib.abc
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
from types import MappingProxyType


ALPHA_MODULE_BYTES = 8 * 1024 * 1024
ALPHA_GRAPH_BYTES = 32 * 1024 * 1024
ALPHA_MODULE_COUNT = 4096


def fail(condition, code):
    if not condition:
        raise ValueError(code)


def capture_alpha_sources(root, commit, tree=None):
    """Retain the same bounded source bytes whose exact Git objects are checked."""
    root = Path(root).absolute()
    fail(root.resolve(strict=True) == root, "SOURCE_FILE_OR_PARENT_LINK")
    fail(re.fullmatch(r"[a-f0-9]{40}", commit or "") is not None, "SOURCE_COMMIT_REQUIRED")
    environment = {"PATH": "/usr/bin:/bin", "GIT_CONFIG_GLOBAL": "/dev/null",
                   "GIT_CONFIG_SYSTEM": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_NO_REPLACE_OBJECTS": "1", "GIT_NO_LAZY_FETCH": "1",
                   "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}

    def git(*arguments):
        value = subprocess.check_output(["/usr/bin/git", "--no-replace-objects", "-c",
                                        "core.fsmonitor=false", "-C", str(root), *arguments],
                                       env=environment, timeout=15)
        fail(len(value) <= 4_000_000, "SOURCE_TREE_LIMIT")
        return value

    fail(git("rev-parse", "HEAD").decode().strip() == commit, "SOURCE_HEAD_CHANGED")
    if tree is not None:
        fail(git("rev-parse", "HEAD^{tree}").decode().strip() == tree, "SOURCE_TREE_CHANGED")
    tracked = {}
    for entry in git("ls-tree", "-r", "-z", commit, "--", "alpha_factory_v1").split(b"\0"):
        if not entry:
            continue
        header, relative = entry.split(b"\t", 1)
        mode, kind, identity = header.decode("ascii").split(" ")
        tracked[relative.decode("utf-8")] = (mode, kind, identity)
    modules, file_digests, namespaces, captured_paths = {}, {}, set(), set()
    total = 0
    package = root / "alpha_factory_v1"
    fail(package.is_dir() and not package.is_symlink(), "SOURCE_SCOPE_LINK_OR_MISSING")
    for current, directories, names in os.walk(package, followlinks=False):
        directory = Path(current)
        fail(directory.resolve(strict=True) == directory, "SOURCE_FILE_OR_PARENT_LINK")
        for name in list(directories):
            child = directory / name
            fail(not child.is_symlink(), "SOURCE_LINK")
            if name == "__pycache__":
                directories.remove(name)
        for name in names:
            path = directory / name
            fail(not path.is_symlink(), "SOURCE_LINK")
            if path.suffix not in {".py", ".pyw", ".pyc", ".so", ".pyd"}:
                continue
            relative = path.relative_to(root).as_posix()
            fail(relative in tracked, "SOURCE_UNTRACKED_IMPORTABLE")
            fail(path.suffix == ".py", "SOURCE_NATIVE_ALPHA_UNSUPPORTED")
            mode, kind, identity = tracked[relative]
            fail(kind == "blob" and mode in {"100644", "100755"}, "SOURCE_GIT_FILE_MODE")
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(descriptor)
                fail(stat.S_ISREG(before.st_mode) and before.st_size <= ALPHA_MODULE_BYTES,
                     "SOURCE_FILE_LIMIT")
                fail(bool(before.st_mode & 0o111) == (mode == "100755"), "SOURCE_GIT_FILE_MODE")
                chunks, remaining = [], before.st_size + 1
                while remaining:
                    chunk = os.read(descriptor, min(65536, remaining))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    remaining -= len(chunk)
                raw = b"".join(chunks)
                after = os.fstat(descriptor)
                fail(len(raw) == before.st_size and all(getattr(before, key) == getattr(after, key)
                     for key in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")),
                     "SOURCE_CHANGED_DURING_CAPTURE")
            finally:
                os.close(descriptor)
            fail(hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == identity,
                 "SOURCE_GIT_BYTES_CHANGED")
            total += len(raw)
            fail(total <= ALPHA_GRAPH_BYTES and len(modules) < ALPHA_MODULE_COUNT, "SOURCE_GRAPH_LIMIT")
            parts = list(path.relative_to(root).with_suffix("").parts)
            is_package = parts[-1] == "__init__"
            if is_package:
                parts.pop()
            module = ".".join(parts)
            fail(module not in modules, "SOURCE_AMBIGUOUS_MODULE")
            modules[module] = (raw, str(path), is_package)
            captured_paths.add(relative)
            file_digests[str(path)] = hashlib.sha256(raw).hexdigest()
            for count in range(1, len(parts)):
                namespaces.add(".".join(parts[:count]))
    fail(captured_paths == {name for name in tracked if Path(name).suffix == ".py"},
         "SOURCE_CAPTURE_INCOMPLETE")
    fail("alpha_factory_v1" in modules, "SOURCE_ALPHA_PACKAGE_REQUIRED")
    fail(git("rev-parse", "HEAD").decode().strip() == commit, "SOURCE_HEAD_CHANGED")
    frozen = MappingProxyType(modules)

    def bind_worker_sources(module):
        original = getattr(module, "_worker_source_snapshot", None)
        if not callable(original):
            return
        worker = frozen["alpha_factory_v1.core.runtime.successor.computer_worker"][0]
        reader = frozen["alpha_factory_v1.core.runtime.successor.computer_read"][0]

        def verified_worker_snapshot():
            identity, observed_reader, dependencies = original()
            fail(observed_reader == reader, "SOURCE_ALPHA_WORKER_CHANGED")
            expected = hashlib.sha256(module.canonical({
                "browser": hashlib.sha256(worker).hexdigest(),
                "reader": hashlib.sha256(reader).hexdigest(),
                "reader_bootstrap": hashlib.sha256(module.READ_BOOTSTRAP.encode()).hexdigest(),
                "reader_dependencies": hashlib.sha256(dependencies).hexdigest(),
            })).hexdigest()
            fail(identity == expected, "SOURCE_ALPHA_WORKER_CHANGED")
            return identity, observed_reader, dependencies

        # Preserve the native snapshot/frame implementation, then check the
        # executable child bytes it actually retained against this Git capture.
        module._worker_source_snapshot = verified_worker_snapshot

    class SnapshotLoader(importlib.abc.Loader):
        def create_module(self, spec):
            return None

        def exec_module(self, module):
            raw, filename, is_package = frozen[module.__name__]
            module.__file__ = filename
            module.__cached__ = None
            if is_package:
                module.__path__ = [str(Path(filename).parent)]
            exec(compile(raw, filename, "exec", dont_inherit=True), module.__dict__)
            if module.__name__ == "alpha_factory_v1.core.runtime.successor.computer":
                bind_worker_sources(module)

    class SnapshotFinder(importlib.abc.MetaPathFinder):
        files = MappingProxyType(file_digests)
        summary = MappingProxyType({"mode": "CAPTURED_ALPHA_GIT_SOURCE", "commit": commit,
                                   "moduleCount": len(modules), "sourceBytes": total,
                                   "sourceSha256": hashlib.sha256(json.dumps({
                                       str(Path(name).relative_to(root)): value for name, value in file_digests.items()
                                   }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()})

        def find_spec(self, fullname, path=None, target=None):
            if fullname != "alpha_factory_v1" and not fullname.startswith("alpha_factory_v1."):
                search = sys.path if path is None else path
                for entry in search:
                    fail(not Path(entry or os.curdir).resolve().is_relative_to(root),
                         "SOURCE_CHECKOUT_DEPENDENCY_SHADOW")
                selected = importlib.machinery.PathFinder.find_spec(fullname, path)
                origins = ([] if selected is None else
                           [selected.origin, *(selected.submodule_search_locations or [])])
                for origin in origins:
                    if origin and Path(origin).is_absolute():
                        fail(not Path(origin).resolve().is_relative_to(root), "SOURCE_CHECKOUT_DEPENDENCY_SHADOW")
                return selected
            if fullname in frozen:
                raw, filename, is_package = frozen[fullname]
                result = importlib.util.spec_from_loader(fullname, SnapshotLoader(), origin=filename,
                                                        is_package=is_package)
                result.has_location = True
                return result
            if fullname in namespaces:
                result = importlib.machinery.ModuleSpec(fullname, loader=None, is_package=True)
                result.submodule_search_locations = [str(root.joinpath(*fullname.split(".")))]
                return result
            raise ModuleNotFoundError("SOURCE_ALPHA_MODULE_NOT_CAPTURED: " + fullname, name=fullname)

    return SnapshotFinder()


def install_source_only_imports(root, snapshot=None):
    """Ignore timestamp-valid bytecode, including caches present before launch."""
    class SourceOnlyLoader(importlib.machinery.SourceFileLoader):
        def get_code(self, fullname):
            return self.source_to_code(self.get_data(self.path), self.path)
    sys.path_hooks.insert(0, importlib.machinery.FileFinder.path_hook(
        (SourceOnlyLoader, importlib.machinery.SOURCE_SUFFIXES),
        (importlib.machinery.ExtensionFileLoader, importlib.machinery.EXTENSION_SUFFIXES)))
    sys.path_importer_cache.clear()
    sys.dont_write_bytecode = True
    if snapshot is None:
        sys.path.insert(0, str(root))
    else:
        fail(not any(name == "alpha_factory_v1" or name.startswith("alpha_factory_v1.")
                     for name in sys.modules), "SOURCE_ALPHA_ALREADY_IMPORTED")
        fail(not any(getattr(finder, "alpha_source_snapshot", False) for finder in sys.meta_path),
             "SOURCE_ALPHA_CONTEXT_ACTIVE")
        # The checkout is served only by the snapshot finder, never PathFinder.
        sys.path[:] = [value for value in sys.path if not Path(value or os.curdir).resolve().is_relative_to(Path(root))]
        snapshot.alpha_source_snapshot = True
        sys.meta_path.insert(0, snapshot)


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
    source = profile["source"]
    snapshot = capture_alpha_sources(root, source["commit"], source["tree"])
    install_source_only_imports(root, snapshot)
    # -I -S suppresses user site, executable .pth files and sitecustomize. Add
    # only the explicitly installed physical interpreter/venv dependency root.
    import sysconfig
    prefix = Path(sys.executable).parent.parent
    if (prefix / "pyvenv.cfg").is_file():
        dependencies = prefix / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    else:
        dependencies = Path(sysconfig.get_path("purelib"))
    fail(dependencies.is_dir() and dependencies.resolve() == dependencies, "COMPUTER_DEPENDENCY_ROOT")
    sys.path.append(str(dependencies))
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
                original = Path(value).absolute()
                path = original.resolve()
                fail(path == original, "COMPUTER_RUNTIME_PATH")
                if path.is_file():
                    fail(path.stat().st_size <= 32_000_000, "COMPUTER_RUNTIME_FILE_LIMIT")
                    files[str(path)] = snapshot.files.get(str(path)) or hashlib.sha256(path.read_bytes()).hexdigest()
        fail(len(files) <= 2048, "COMPUTER_RUNTIME_FILE_LIMIT")
        print(json.dumps({"files": files, "python": sys.version.split()[0],
                          "nativeSourceCapture": dict(snapshot.summary)}, separators=(",", ":")))
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
        "nativeSourceCapture": dict(snapshot.summary),
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
