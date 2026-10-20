"""Authenticate a distinct live-site-only qualification push at website source T."""
from __future__ import annotations
import argparse
import base64
import os
from pathlib import Path
import re
import runpy
globals().update({key: value for key, value in runpy.run_path(
    str(Path(__file__).with_name("public_release_assets.py"))).items() if not key.startswith("__")})
LIVE_REF = re.compile(r"refs/heads/qualification/ti-public-live-([a-f0-9]{40})-([a-f0-9]{64})")

def blob(identity, raw_sha):
    value = api("/repos/" + REPOSITORIES["fleet"] + "/git/blobs/" + identity)
    require(value["sha"] == identity and value["encoding"] == "base64" and value["size"] <= 65_536, "bounded live input blob")
    raw = base64.b64decode(value["content"], validate=False)
    verify_input_blob(raw, identity, raw_sha, value["size"])
    return raw

def relative_url(value):
    require(isinstance(value, str) and value.startswith("/") and not value.startswith("//")
            and "\\" not in value and "\r" not in value and "\n" not in value
            and len(value) <= 300 and ".." not in value.split("/"), "reviewed relative public URL")

def validate_live(value):
    keys(value, {"schema", "websiteSource", "releaseInput", "connectedJourney", "sites"})
    require(value["schema"] == "agi-fleet/final-public-live-inputs/v1", "live input schema")
    identity(value["websiteSource"])
    keys(value["releaseInput"], {"blob", "sha256"})
    require(re.fullmatch("[a-f0-9]{40}", value["releaseInput"]["blob"])
            and re.fullmatch("[a-f0-9]{64}", value["releaseInput"]["sha256"]), "actual release input object")
    keys(value["connectedJourney"], {"runId", "attempt"})
    require(positive(value["connectedJourney"]["runId"])
            and value["connectedJourney"]["attempt"] == 1, "genuine completed connected producer")
    keys(value["sites"], REPOSITORIES)
    for role, site in value["sites"].items():
        keys(site, {"baseUrl", "source", "version", "buildInfo", "pagesRun", "languages"})
        require(site["baseUrl"] == "https://montrealai.github.io/" + REPOSITORIES[role].split("/")[1] + "/",
                "exact four public HTTPS site roots")
        identity(site["source"])
        require(isinstance(site["version"], str) and re.fullmatch("[A-Za-z0-9._-]{1,80}", site["version"]), "observed expected version")
        keys(site["buildInfo"], {"path", "commitPointer", "versionPointer"})
        relative_url(site["buildInfo"]["path"])
        for field in ("commitPointer", "versionPointer"):
            require(re.fullmatch(r"(?:/[A-Za-z0-9_-]{1,64}){1,6}", site["buildInfo"][field]), "literal JSON identity pointer")
        run = site["pagesRun"]
        keys(run, {"id", "attempt", "path", "event", "ref"})
        require(positive(run["id"]) and positive(run["attempt"])
                and re.fullmatch(r"\.github/workflows/[a-z0-9-]+\.yml", run["path"])
                and run["event"] in {"push", "workflow_dispatch", "workflow_run"}
                and re.fullmatch(r"refs/heads/[A-Za-z0-9._/-]{1,180}", run["ref"]), "actual Pages workflow identity")
        keys(site["languages"], {"en", "fr"})
        for language, route in site["languages"].items():
            keys(route, {"path", "steps", "downloads"})
            relative_url(route["path"])
            require(isinstance(route["steps"], list) and 1 <= len(route["steps"]) <= 20, "bounded normal public flow")
            for step in route["steps"]:
                keys(step, {"action", "selector", "value"})
                require(step["action"] in {"assertVisible", "assertText", "click", "fill", "select"},
                        "closed public UI action")
                require(isinstance(step["selector"], str) and 0 < len(step["selector"]) <= 256
                        and "\n" not in step["selector"] and "\r" not in step["selector"], "literal bounded CSS selector")
                require(isinstance(step["value"], str) and len(step["value"]) <= 300, "public UI assertion/fixture value")
                if step["action"] == "fill":
                    require(step["value"] in {"synthetic-title", "synthetic-goal", "zero"}, "fixed public synthetic input only")
            require(isinstance(route["downloads"], list) and 1 <= len(route["downloads"]) <= 8, "visible public download links")
            for download in route["downloads"]:
                keys(download, {"selector", "assetRole"})
                require(isinstance(download["selector"], str) and 0 < len(download["selector"]) <= 256
                        and "\n" not in download["selector"] and "\r" not in download["selector"]
                        and download["assetRole"] in ROLES[role], "literal public package download selector")
    require(value["sites"]["fleet"]["source"] == value["websiteSource"], "Fleet Pages T differs from live workflow T")
    return value

def admit(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("GITHUB_REPOSITORY") == REPOSITORIES["fleet"]
            and os.environ.get("GITHUB_EVENT_NAME") == "push"
            and os.environ.get("GITHUB_RUN_ATTEMPT") == "1", "genuine separate live-only push")
    match = LIVE_REF.fullmatch(os.environ.get("GITHUB_REF", ""))
    require(match is not None, "strict live-only input-bound branch")
    raw = blob(match[1], match[2])
    value = validate_live(strict_json(raw))
    require(value["websiteSource"]["commit"] == os.environ.get("GITHUB_SHA")
            and git(Path(__file__).resolve().parents[2], "rev-parse", "HEAD") == value["websiteSource"]["commit"]
            and git(Path(__file__).resolve().parents[2], "rev-parse", "HEAD^{tree}") == value["websiteSource"]["tree"],
            "real live workflow source T")
    root = "/repos/" + REPOSITORIES["fleet"]
    run_id = os.environ["GITHUB_RUN_ID"]
    actual = api(root + "/actions/runs/" + run_id)
    require(actual["run_attempt"] == 1 and actual["head_sha"] == value["websiteSource"]["commit"]
            and actual["event"] == "push" and "refs/heads/" + actual["head_branch"] == os.environ["GITHUB_REF"]
            and actual["path"] == ".github/workflows/public-live-sites.yml", "authentic live-only execution")
    prior = pages(root + "/actions/workflows/public-live-sites.yml/runs?head_sha=" + value["websiteSource"]["commit"], "workflow_runs")
    require(all(item["id"] == int(run_id) for item in prior), "another all-events live-only run exists for T")
    package_raw = blob(value["releaseInput"]["blob"], value["releaseInput"]["sha256"])
    release_input = validate(strict_json(package_raw))
    git(Path(__file__).resolve().parents[2], "merge-base", "--is-ancestor", release_input["consumerSource"]["commit"], value["websiteSource"]["commit"])
    releases = authenticate(release_input)
    connected = api(root + "/actions/runs/" + str(value["connectedJourney"]["runId"]))
    expected_branch = "qualification/ti-public-packages-" + value["releaseInput"]["blob"] + "-" + value["releaseInput"]["sha256"]
    require(connected["status"] == "completed" and connected["conclusion"] == "success"
            and connected["run_attempt"] == value["connectedJourney"]["attempt"]
            and connected["path"] == ".github/workflows/public-release-journey.yml"
            and connected["event"] == "push" and connected["head_branch"] == expected_branch
            and connected["head_sha"] == release_input["consumerSource"]["commit"], "actual successful ONE connected producer required")
    observed = {}
    for role, site in value["sites"].items():
        repository = "/repos/" + REPOSITORIES[role]
        source = api(repository + "/git/commits/" + site["source"]["commit"])
        require(source["tree"]["sha"] == site["source"]["tree"], "actual website source tree")
        expected = site["pagesRun"]
        run = api(repository + "/actions/runs/" + str(expected["id"]))
        attempt = api(repository + "/actions/runs/" + str(expected["id"]) + "/attempts/" + str(expected["attempt"]))
        require(run["run_attempt"] == expected["attempt"] and run["status"] == "completed"
                and run["conclusion"] == "success" and attempt["conclusion"] == "success"
                and run["head_sha"] == site["source"]["commit"] and run["path"] == expected["path"]
                and run["event"] == expected["event"] and "refs/heads/" + run["head_branch"] == expected["ref"],
                "genuine current Pages source/attempt")
        deployments = pages(repository + "/deployments?sha=" + site["source"]["commit"] + "&environment=github-pages")
        deployed = []
        for deployment in deployments:
            if deployment.get("sha") != site["source"]["commit"] or deployment.get("environment") != "github-pages":
                continue
            statuses = pages(repository + "/deployments/" + str(deployment["id"]) + "/statuses")
            if not statuses:
                continue
            latest = max(statuses, key=lambda status: (status["created_at"], status["id"]))
            if (latest.get("state") == "success"
                    and str(latest.get("environment_url", "")).rstrip("/") == site["baseUrl"].rstrip("/")
                    and ("/actions/runs/" + str(expected["id"])) in str(latest.get("log_url", ""))):
                deployed.append({"deployment": deployment, "latestStatus": latest})
        require(deployed, "genuine successful Pages deployment for exact source/run/URL required")
        site["downloads"] = {asset_role: asset["browser_download_url"] for asset_role, asset in releases[role]["assets"].items()}
        observed[role] = {"source": source, "pagesRun": run, "deployments": deployed, "releasedSourceS2": release_input["repositories"][role]["released"]}
    output.mkdir(mode=0o700)
    save(output / "input.json", raw)
    save(output / "browser-input.json", encoded(value))
    save(output / "authentication.json", encoded({"schema": "agi-fleet/public-live-authentication/v1",
         "producer": {"repository": REPOSITORIES["fleet"], "commitT": value["websiteSource"]["commit"],
                      "workflowRun": run_id, "workflowAttempt": "1", "event": "push",
                      "ref": os.environ["GITHUB_REF"], "inputBlob": match[1], "inputSha256": match[2]},
         "releaseSourceS": release_input["consumerSource"], "connectedJourney": connected,
         "pages": observed, "nativeExecuted": False, "journeyRepeated": False}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    admit(args.output.absolute())
