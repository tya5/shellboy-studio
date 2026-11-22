"""Verify the desktop bundle's official Core pin and, for release, its public tag."""
import argparse
import json
from pathlib import Path
import re
import runpy
import subprocess
import tomllib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", type=Path, required=True)
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--binary-version", type=Path)
    args = parser.parse_args()
    root = Path.cwd()
    verifier = runpy.run_path(str(root / "tools/exact-owner.py"))
    lock = tomllib.loads((root / "Cargo.lock").read_text())
    version, = [pkg["version"] for pkg in lock["package"] if pkg["name"] == "shellboy"]
    info = verifier["verify"](root, args.owner, args.binary_version, version=version)
    if args.release:
        tag = "v" + version
        if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
            raise SystemExit("The pinned Core does not name a stable published release")
        release = subprocess.run(["gh", "release", "view", tag, "--repo", "tya5/shellboy", "--json", "isDraft,isPrerelease,tagName"], capture_output=True, text=True)
        if release.returncode:
            raise SystemExit(f"Pinned Core {info['owner_commit']} does not have published Core release {tag}")
        data = json.loads(release.stdout)
        if data != {"isDraft": False, "isPrerelease": False, "tagName": tag}:
            raise SystemExit(f"Core {tag} is not a stable public release")
        subprocess.run(["git", "-C", str(args.owner), "fetch", "--depth", "1", "origin", f"refs/tags/{tag}:refs/tags/{tag}"], check=True)
        peeled = verifier["git"](args.owner, "rev-parse", f"refs/tags/{tag}^{{commit}}")
        if peeled != info["owner_commit"]:
            raise SystemExit(f"Core {tag} peels to {peeled}, not pinned Core {info['owner_commit']}")
    print(json.dumps(info, sort_keys=True))


if __name__ == "__main__":
    main()
