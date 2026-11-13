"""Verify the published owner's tag/lock/checkout/package/binary identity.

The workflow fetches the tag from the fixed official remote; this verifier never
uses the network. Output is restricted to public identity fields, not paths.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import parse_qs, urlsplit

OFFICIAL = "https://github.com/tya5/shellboy"
TAG = "v0.13.0"
VERSION = "0.13.0"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(owner, *args):
    result = subprocess.run(["git", "-C", str(owner), *args], capture_output=True, text=True, encoding="utf-8")
    require(result.returncode == 0, "owner Git identity unavailable")
    return result.stdout.strip()


def verify(studio, owner, binary_version=None):
    dependency = tomllib.loads((studio / "Cargo.toml").read_text(encoding="utf-8"))["dependencies"]["shellboy"]
    require(dependency.get("git") == OFFICIAL and dependency.get("tag") == TAG,
            "Studio must pin the official release tag")
    lock = tomllib.loads((studio / "Cargo.lock").read_text(encoding="utf-8"))
    packages = [p for p in lock["package"] if p["name"] == "shellboy"]
    require(len(packages) == 1, "expected exactly one locked owner package")
    package = packages[0]
    source = urlsplit(package.get("source", ""))
    require(source.scheme == "git+https" and source.netloc == "github.com"
            and source.path == "/tya5/shellboy"
            and parse_qs(source.query) == {"tag": [TAG]}, "wrong locked owner source")
    require(re.fullmatch(r"[0-9a-f]{40}", source.fragment) is not None,
            "locked owner commit missing or malformed")
    require(package.get("version") == VERSION, "wrong locked owner package version")
    require(git(owner, "remote", "get-url", "origin") == OFFICIAL, "wrong owner remote")
    commit = git(owner, "rev-parse", "--verify", f"refs/tags/{TAG}^{{commit}}")
    require(commit == source.fragment, "peeled official tag differs from lock commit")
    require(git(owner, "rev-parse", "HEAD") == commit, "owner checkout differs from release commit")
    require(not git(owner, "status", "--porcelain"), "owner checkout is not clean")
    manifest = tomllib.loads((owner / "Cargo.toml").read_text(encoding="utf-8"))
    require(manifest.get("package", {}).get("name") == "shellboy", "wrong owner package")
    version = manifest["package"].get("version")
    if version == {"workspace": True}:
        version = manifest.get("workspace", {}).get("package", {}).get("version")
    require(version == VERSION, "wrong source package version")
    if binary_version is not None:
        require(binary_version.read_text(encoding="utf-8").strip() == f"shellboy {VERSION}", "wrong binary version")
    return {"official_repository": OFFICIAL, "tag": TAG, "peeled_commit": commit,
            "lock_commit": source.fragment, "package_version": VERSION,
            "binary_version": VERSION if binary_version is not None else "not yet checked"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--studio", type=Path, required=True)
    parser.add_argument("--owner", type=Path, required=True)
    parser.add_argument("--binary-version", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.studio, args.owner, args.binary_version), sort_keys=True))
    except (ValueError, KeyError, OSError, tomllib.TOMLDecodeError) as error:
        # Do not leak fixture paths, Git diagnostics, or supplied version text.
        print("Exact-owner verification failed:", str(error) if type(error) is ValueError else "missing or malformed identity input")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
