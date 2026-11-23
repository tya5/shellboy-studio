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
# Core main b851fad2 includes the exact thread.list(thread_ids) contract.
VERSION = "0.13.1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(owner, *args):
    result = subprocess.run(["git", "-C", str(owner), *args], capture_output=True, text=True, encoding="utf-8")
    require(result.returncode == 0, "owner Git identity unavailable")
    return result.stdout.strip()


def verify(studio, owner, binary_version=None, *, version=VERSION):
    dependency = tomllib.loads((studio / "Cargo.toml").read_text(encoding="utf-8"))["dependencies"]["shellboy"]
    require(dependency.get("git") == OFFICIAL and isinstance(dependency.get("rev"), str),
            "Studio must pin an official manifest revision")
    manifest_rev = dependency["rev"]
    require(re.fullmatch(r"[0-9a-f]{40}", manifest_rev) is not None,
            "Studio manifest revision missing or malformed")
    lock = tomllib.loads((studio / "Cargo.lock").read_text(encoding="utf-8"))
    packages = [p for p in lock["package"] if p["name"] == "shellboy"]
    require(len(packages) == 1, "expected exactly one locked owner package")
    package = packages[0]
    source = urlsplit(package.get("source", ""))
    require(source.scheme == "git+https" and source.netloc == "github.com"
            and source.path == "/tya5/shellboy"
            and parse_qs(source.query) == {"rev": [manifest_rev]}, "wrong locked owner source")
    require(re.fullmatch(r"[0-9a-f]{40}", source.fragment) is not None,
            "locked owner commit missing or malformed")
    require(package.get("version") == version, "wrong locked owner package version")
    require(git(owner, "remote", "get-url", "origin") == OFFICIAL, "wrong owner remote")
    commit = git(owner, "rev-parse", "--verify", manifest_rev)
    require(commit == source.fragment == manifest_rev, "manifest revision differs from lock commit")
    require(git(owner, "rev-parse", "HEAD") == commit, "owner checkout differs from release commit")
    require(not git(owner, "status", "--porcelain"), "owner checkout is not clean")
    manifest = tomllib.loads((owner / "Cargo.toml").read_text(encoding="utf-8"))
    require(manifest.get("package", {}).get("name") == "shellboy", "wrong owner package")
    source_version = manifest["package"].get("version")
    if source_version == {"workspace": True}:
        source_version = manifest.get("workspace", {}).get("package", {}).get("version")
    require(source_version == version, "wrong source package version")
    if binary_version is not None:
        require(binary_version.read_text(encoding="utf-8").strip() == f"shellboy {version}", "wrong binary version")
    return {"official_repository": OFFICIAL, "manifest_revision": manifest_rev, "lock_commit": source.fragment, "owner_commit": commit,
            "package_version": version,
            "binary_version": version if binary_version is not None else "not yet checked"}


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
