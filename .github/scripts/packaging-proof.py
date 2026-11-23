"""Require completed three-OS Checks for the exact packaging checkout."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib

OS = ("ubuntu-22.04", "macos-15", "windows-latest")
CHECKS = {f"Checks on {os}" for os in OS}
OWNERS = {f"Required exact-pair owner acceptance ({os}) / owner" for os in OS}
CORE_STEP = "Verify the official manifest revision against the Studio lock before build"
SUITE_STEP = "Run explicit exact-pair integration suite (temporary data and local mock)"


def git_head(source):
    return subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()


def core_pin(source):
    manifest = tomllib.loads((source / "Cargo.toml").read_text(encoding="utf-8"))
    dep = manifest["dependencies"]["shellboy"]
    pin = dep["rev"]
    remote = "https://github.com/tya5/shellboy"
    lock = tomllib.loads((source / "Cargo.lock").read_text(encoding="utf-8"))
    packages = [p for p in lock["package"] if p["name"] == "shellboy"]
    if (not re.fullmatch(r"[0-9a-f]{40}", pin) or dep.get("git") != remote or len(packages) != 1
            or packages[0].get("source") != f"git+{remote}?rev={pin}#{pin}"):
        raise ValueError("Exact official Core manifest/lock pin mismatch")
    return pin


def successful(item):
    return item.get("status") == "completed" and item.get("conclusion") == "success"


def required_passed(items, names):
    for name in names:
        matches = [item for item in items if item.get("name") == name]
        if len(matches) != 1 or not successful(matches[0]):
            return False
    return True


def proof(api, repo, repository_id, sha, *, dispatch_only):
    events = {"workflow_dispatch"} if dispatch_only else {"workflow_dispatch", "push"}
    root = f"repos/{repo}/actions"
    for run in api(f"{root}/workflows/ci.yml/runs?head_sha={sha}&status=success&per_page=100", "workflow_runs"):
        if (run.get("head_sha") != sha or not successful(run) or run.get("event") not in events
                or (run.get("head_repository") or {}).get("id") != repository_id or run.get("run_attempt") != 1):
            continue
        run_id = run["id"]
        jobs = api(f"{root}/runs/{run_id}/attempts/1/jobs?per_page=100", "jobs")
        if not required_passed(jobs, CHECKS | OWNERS):
            continue
        # The same immutable Studio SHA determines the pin. The owner job verifies that
        # pin against its Core checkout and lock before running the integration suite.
        if all(required_passed(job.get("steps", []), {CORE_STEP, SUITE_STEP})
               for job in jobs if job["name"] in OWNERS):
            return run_id
    raise ValueError("No successful exact-SHA three-OS Checks and owner acceptance proof")


def api(url, key):
    pages = json.loads(subprocess.check_output(["gh", "api", "--paginate", "--slurp", url], text=True))
    return [item for page in pages for item in page[key]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("."))
    parser.add_argument("--candidate", action="store_true")
    args = parser.parse_args()
    if datetime.now(timezone.utc) < datetime(2026, 11, 8, 22, tzinfo=timezone.utc):
        raise ValueError("Packaging is not authorized before 2026-11-09 07:00 JST")
    sha = git_head(args.source)
    if args.candidate and not (sha == os.environ["SOURCE_SHA"] == os.environ["WORKFLOW_SHA"] == os.environ["GITHUB_SHA"]):
        raise ValueError("Candidate checkout differs from workflow/event SHA")
    if not args.candidate and os.environ["GITHUB_EVENT_NAME"] == "push" and sha != os.environ["GITHUB_SHA"]:
        raise ValueError("Release tag checkout differs from the tag push SHA")
    version = os.environ["CANDIDATE_VERSION" if args.candidate else "RELEASE_TAG"]
    pattern = r"[0-9]+\.[0-9]+\.[0-9]+"
    manifest = tomllib.loads((args.source / "Cargo.toml").read_text(encoding="utf-8"))
    if not re.fullmatch(pattern if args.candidate else "v" + pattern, version) or version != ("" if args.candidate else "v") + manifest["package"]["version"]:
        raise ValueError("Packaging version differs from exact source")
    pin = core_pin(args.source)
    repo = os.environ["GITHUB_REPOSITORY"]
    run_id = proof(api, repo, int(os.environ["REPOSITORY_ID"]), sha, dispatch_only=args.candidate)
    receipt = f"Reused Checks https://github.com/{repo}/actions/runs/{run_id} attempt 1; Studio {sha}; Core {pin}"
    print(receipt)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        print(receipt, file=summary)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        print(f"source_sha={sha}\ncore_pin={pin}", file=out)


if __name__ == "__main__":
    main()
