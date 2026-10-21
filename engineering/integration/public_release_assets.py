"""Authenticate one reviewed input blob and content-pinned public release assets.

Run only on the explicit qualification push. This adds installed-package custody;
it never substitutes for the original release publishers or source qualification.
"""
from __future__ import annotations
import argparse
import base64
import os
from pathlib import Path
import re
import runpy
globals().update({key: value for key, value in runpy.run_path(
    str(Path(__file__).with_name("public_release_common.py"))).items() if not key.startswith("__")})

SCHEMA = "agi-fleet/final-public-package-inputs/v1"
ROLES = {
    "alpha": {"source", "wheel", "manifest", "checksums"},
    "fleet": {"packageX64", "packageArm64", "manifest", "checksums"},
    "jobs": {"source", "provenance", "sourceProfile", "checksums"},
    "manager": {"package", "manifest", "qualification", "checksums"},
}
CANONICAL_RELEASE_PRODUCERS = {
    "alpha": ("agent-release.yml", {"push", "workflow_dispatch"}),
    "fleet": ("transformation-release.yml", {"workflow_dispatch"}),
    "jobs": ("source-release-rc16.yml", {"push"}),
    # Manager publishes through its separately authorized package/API process.
    # This is its actual mandatory source qualification, not an invented publisher.
    "manager": ("current-state-release.yml", {"push", "workflow_dispatch"}),
}
REQUIRED_WORKFLOWS = {
    "alpha": {"agent-release.yml"},
    "fleet": {"local-skills.yml", "next-release.yml", "repository-checks.yml",
              "repository-review.yml", "transformational-project.yml", "transformation-release.yml"},
    "jobs": {"source-release-rc16.yml"},
    "manager": {"current-state-release.yml"},
}

def positive(value):
    return type(value) is int and 0 < value <= 9_007_199_254_740_991

def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected), "closed object keys differ")

def identity(value):
    keys(value, {"commit", "tree"})
    require(all(re.fullmatch("[a-f0-9]{40}", value[key] or "") for key in value), "exact Git identities")

def validate(value):
    keys(value, {"schema", "consumerSource", "repositories"})
    require(value["schema"] == SCHEMA, "input schema")
    identity(value["consumerSource"])
    keys(value["repositories"], REPOSITORIES)
    asset_groups = {}
    for role, repo in value["repositories"].items():
        keys(repo, {"repository", "releaseId", "tag", "reviewed", "released",
                    "sourceContinuity", "jobsSourceTransition", "requiredRuns", "assets"})
        require(repo["repository"] == REPOSITORIES[role], "fixed repository role")
        require(positive(repo["releaseId"]), "actual release ID")
        require(isinstance(repo["tag"], str) and re.fullmatch("[A-Za-z0-9][A-Za-z0-9._-]{0,99}", repo["tag"]),
                "exact bounded release tag")
        identity(repo["reviewed"]); identity(repo["released"])
        continuity = repo["sourceContinuity"]
        keys(continuity, {"kind", "reviewIds"})
        require(continuity["kind"] in {"same-commit", "same-tree", "jobs-reviewed-transition"}, "source continuity kind")
        require(isinstance(continuity["reviewIds"], list) and 0 < len(continuity["reviewIds"]) <= 20
                and len(set(continuity["reviewIds"])) == len(continuity["reviewIds"])
                and all(positive(item) for item in continuity["reviewIds"]),
                "genuine review comment IDs required")
        if continuity["kind"] == "same-commit":
            require(repo["reviewed"] == repo["released"], "same-commit continuity differs")
        elif continuity["kind"] == "same-tree":
            require(repo["reviewed"]["tree"] == repo["released"]["tree"], "same-tree continuity differs")
        else:
            require(role == "jobs", "only the existing Jobs source transition may differ in tree")
        transition = repo["jobsSourceTransition"]
        if role == "jobs" and continuity["kind"] == "jobs-reviewed-transition":
            keys(transition, {"assetRole", "sha256", "reviewedCommit", "releasedCommit"})
            require(transition["assetRole"] == "sourceProfile"
                    and re.fullmatch("[a-f0-9]{64}", transition["sha256"] or "")
                    and transition["reviewedCommit"] == repo["reviewed"]["commit"]
                    and transition["releasedCommit"] == repo["released"]["commit"], "Jobs transition identity")
        else:
            require(transition is None, "unexpected Jobs transition")
        keys(repo["assets"], ROLES[role])
        for asset_role, asset in repo["assets"].items():
            keys(asset, {"id", "name", "bytes", "sha256"})
            require(positive(asset["id"]), "actual asset ID")
            asset_groups.setdefault((repo["repository"], asset["id"]), []).append((role, asset_role, asset))
            require(isinstance(asset["name"], str)
                    and re.fullmatch("[A-Za-z0-9][A-Za-z0-9._-]{0,179}", asset["name"]), "bounded asset basename")
            require(type(asset["bytes"]) is int and 0 < asset["bytes"] < MAX_ASSET
                    and re.fullmatch("[a-f0-9]{64}", asset["sha256"] or ""), "asset byte identity")
        if role == "jobs":
            require(repo["assets"]["sourceProfile"]["name"] == "source-profile-rc16.json", "original Jobs profile asset name")
        if transition is not None:
            require(transition["sha256"] == repo["assets"]["sourceProfile"]["sha256"], "Jobs transition asset digest")
        runs = repo["requiredRuns"]
        require(isinstance(runs, list) and 0 < len(runs) <= 100, "finite required producer runs")
        selected = set()
        canonical_source_selected = False
        for run in runs:
            keys(run, {"id", "attempt", "path", "event", "ref", "sourceRole"})
            require(positive(run["id"]) and positive(run["attempt"]), "actual run and attempt")
            require(isinstance(run["path"], str)
                    and re.fullmatch(r"\.github/workflows/[a-z0-9-]+\.yml", run["path"]), "workflow path")
            require(run["event"] in {"push", "pull_request", "workflow_dispatch", "workflow_run"}
                    and run["sourceRole"] in {"reviewed", "released"}
                    and isinstance(run["ref"], str) and re.fullmatch(r"refs/heads/[A-Za-z0-9._/-]{1,180}", run["ref"]),
                    "explicit producer source/event/ref")
            workflow = run["path"].rsplit("/", 1)[1]
            selected.add(workflow)
            canonical_path, canonical_events = CANONICAL_RELEASE_PRODUCERS[role]
            if (workflow == canonical_path and run["sourceRole"] == "released"
                    and run["ref"] == "refs/heads/main" and run["event"] in canonical_events):
                canonical_source_selected = True
        require(REQUIRED_WORKFLOWS[role] <= selected, "required publisher/source workflow missing")
        require(canonical_source_selected, "actual released S2 canonical main producer missing")
    for group in asset_groups.values():
        if len(group) == 1:
            continue
        require(len(group) == 2 and all(item[0] == "fleet" for item in group)
                and {item[1] for item in group} == {"packageX64", "packageArm64"}
                and group[0][2] == group[1][2], "only identical Fleet architecture package roles may share an asset")
    require(value["repositories"]["fleet"]["released"] == value["consumerSource"],
            "consumer source must be the actual released Fleet source")
    return value

def current():
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("GITHUB_REPOSITORY") == REPOSITORIES["fleet"]
            and os.environ.get("GITHUB_EVENT_NAME") == "push"
            and os.environ.get("GITHUB_RUN_ATTEMPT") == "1", "one genuine hosted qualification push attempt")
    match = REF.fullmatch(os.environ.get("GITHUB_REF", ""))
    require(match is not None, "strict input-bound qualification branch")
    commit, run_id = os.environ.get("GITHUB_SHA", ""), os.environ.get("GITHUB_RUN_ID", "")
    require(re.fullmatch("[a-f0-9]{40}", commit) and re.fullmatch("[1-9][0-9]*", run_id), "actual execution identity")
    require(git(Path(__file__).resolve().parents[2], "rev-parse", "HEAD") == commit, "checked-out consumer identity")
    root = "/repos/" + REPOSITORIES["fleet"]
    observed = api(root + "/actions/runs/" + run_id)
    require(observed["id"] == int(run_id) and observed["run_attempt"] == 1
            and observed["head_sha"] == commit and observed["event"] == "push"
            and "refs/heads/" + observed["head_branch"] == os.environ["GITHUB_REF"]
            and observed["path"] == ".github/workflows/public-release-journey.yml", "authenticated consumer execution")
    prior = pages(root + "/actions/workflows/public-release-journey.yml/runs?head_sha=" + commit, "workflow_runs")
    require(all(item["id"] == int(run_id) for item in prior), "another all-events consumer run exists for final source")
    blob = api(root + "/git/blobs/" + match[1])
    require(blob["sha"] == match[1] and blob["encoding"] == "base64" and blob["size"] <= 65_536, "bounded input blob")
    raw = base64.b64decode(blob["content"], validate=False)
    verify_input_blob(raw, match[1], match[2], blob["size"])
    value = validate(strict_json(raw))
    require(value["consumerSource"]["commit"] == commit
            and git(Path(__file__).resolve().parents[2], "rev-parse", "HEAD^{tree}") == value["consumerSource"]["tree"],
            "input consumer commit/tree differs")
    return value, raw, {"repository": REPOSITORIES["fleet"], "commit": commit,
                        "workflowRun": run_id, "workflowAttempt": "1", "event": "push",
                        "ref": os.environ["GITHUB_REF"], "inputBlob": match[1], "inputSha256": match[2]}

def authenticate(value):
    result = {}
    for role, selected in value["repositories"].items():
        prefix = "/repos/" + selected["repository"]
        release = api(prefix + "/releases/" + str(selected["releaseId"]))
        require(release["id"] == selected["releaseId"] and release["tag_name"] == selected["tag"]
                and release["draft"] is False
                and release["published_at"] is not None, "published release identity")
        # Platform immutability is an observation, not the trust anchor. The
        # independently approved input pins every selected identity and digest;
        # current release metadata must never supply replacement expectations.
        tag = api(prefix + "/git/ref/tags/" + urllib.parse.quote(selected["tag"], safe=""))
        obj = tag["object"]
        for _ in range(4):
            if obj["type"] == "commit":
                break
            require(obj["type"] == "tag", "release tag object type")
            obj = api(prefix + "/git/tags/" + obj["sha"])["object"]
        require(obj["type"] == "commit" and obj["sha"] == selected["released"]["commit"], "peeled release tag commit")
        source = api(prefix + "/git/commits/" + obj["sha"])
        reviewed = api(prefix + "/git/commits/" + selected["reviewed"]["commit"])
        require(source["tree"]["sha"] == selected["released"]["tree"]
                and reviewed["tree"]["sha"] == selected["reviewed"]["tree"], "authenticated source trees")
        all_assets = pages(prefix + "/releases/" + str(release["id"]) + "/assets")
        indexed = {asset["id"]: asset for asset in all_assets}
        assets = {}
        for asset_role, expected in selected["assets"].items():
            actual = indexed.get(expected["id"])
            require(actual is not None and actual["state"] == "uploaded"
                    and actual["name"] == expected["name"] and actual["size"] == expected["bytes"]
                    and actual["digest"] == "sha256:" + expected["sha256"], "release asset metadata differs")
            assets[asset_role] = actual
        runs = []
        for expected in selected["requiredRuns"]:
            run = api(prefix + "/actions/runs/" + str(expected["id"]))
            attempt = api(prefix + "/actions/runs/" + str(expected["id"]) + "/attempts/" + str(expected["attempt"]))
            require(run["run_attempt"] == expected["attempt"] and run["status"] == "completed"
                    and run["conclusion"] == "success" and attempt["conclusion"] == "success"
                    and run["head_sha"] == selected[expected["sourceRole"]]["commit"]
                    and run["path"] == expected["path"] and run["event"] == expected["event"]
                    and "refs/heads/" + run["head_branch"] == expected["ref"], "required producer source/attempt/status")
            runs.append(run)
        comments = []
        for comment_id in selected["sourceContinuity"]["reviewIds"]:
            comment = api(prefix + "/issues/comments/" + str(comment_id))
            require(comment["id"] == comment_id and selected["reviewed"]["commit"] in comment["body"],
                    "source review comment identity/binding differs")
            comments.append({"id": comment["id"], "url": comment["html_url"], "user": comment["user"],
                             "createdAt": comment["created_at"], "updatedAt": comment["updated_at"],
                             "bodySha256": sha(comment["body"].encode("utf-8"))})
        result[role] = {"release": release, "tag": tag, "source": source, "reviewedSource": reviewed,
                        "assets": assets, "requiredRuns": runs, "sourceReviewComments": comments}
    return result

def run(mode, bundle):
    value, raw, producer = current()
    observations = authenticate(value)
    bundle = Path(bundle).absolute()
    if mode == "acquire":
        require(not bundle.exists(), "new acquisition directory")
        bundle.mkdir(mode=0o700)
        save(bundle / "input.json", raw)
        for role, selected in value["repositories"].items():
            folder = bundle / role
            folder.mkdir(mode=0o700)
            for asset_role, asset in selected["assets"].items():
                if (folder / asset["name"]).exists():
                    require(digest(folder / asset["name"]) == asset["sha256"], "duplicate role bytes differ")
                    continue
                download("https://api.github.com/repos/" + selected["repository"] + "/releases/assets/" + str(asset["id"]),
                         folder / asset["name"], asset["bytes"], asset["sha256"])
        save(bundle / "acquisition.json", encoded({"schema": "agi-fleet/public-package-acquisition/v1",
             "producer": producer, "sourceQualification": "REQUIRED_ORIGINAL_RELEASE_GATES_NOT_REPLACED",
             "observations": observations}))
    else:
        require((bundle / "input.json").read_bytes() == raw, "transported input blob changed")
        for role, selected in value["repositories"].items():
            require({p.name for p in (bundle / role).iterdir()} == {a["name"] for a in selected["assets"].values()},
                    "transported asset inventory differs")
            for asset in selected["assets"].values():
                file = bundle / role / asset["name"]
                require(file.stat().st_size == asset["bytes"] and digest(file) == asset["sha256"], "transported public bytes differ")
    return value, producer, observations

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["acquire", "verify"])
    parser.add_argument("--bundle", required=True, type=Path)
    args = parser.parse_args()
    value, producer, observations = run(args.mode, args.bundle)
    print(json.dumps({"input": producer["inputSha256"], "consumer": value["consumerSource"],
                      "contentPinnedReleasesAuthenticated": True,
                      "releaseImmutabilityObserved": {
                          role: observed["release"].get("immutable")
                          for role, observed in observations.items()},
                      "journeyExecuted": False}))
