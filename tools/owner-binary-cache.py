"""Print the exact-owner target and build cache key."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


BUILD_ENV = (
    "ImageOS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC", "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER", "CC", "CXX", "AR", "CFLAGS", "CXXFLAGS",
    "LDFLAGS", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET",
)


def fingerprint(rustc, runner, settings):
    return hashlib.sha256(json.dumps({
        "rustc": rustc, "runner": runner, "settings": settings,
        "env": {name: value for name, value in sorted(os.environ.items())
                if name in BUILD_ENV or name.startswith(("CARGO_PROFILE_", "CARGO_BUILD_", "CARGO_TARGET_", "CC_", "CFLAGS_", "CXX_", "CXXFLAGS_", "AR_"))
                and name != "CARGO_TARGET_DIR"},
    }, sort_keys=True).encode()).hexdigest()


def identity(core, rustc, runner, settings):
    target = next(line.removeprefix("host: ") for line in rustc.splitlines() if line.startswith("host: "))
    if not re.fullmatch(r"[0-9a-f]{40}", core) or not re.fullmatch(r"[a-z0-9_-]+", target):
        raise ValueError("invalid Core revision or Rust target")
    return target, f"exact-owner-v1-{core}-{target}-{fingerprint(rustc, runner, settings)}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", required=True)
    parser.add_argument("--toolchain", required=True)
    parser.add_argument("--runner", required=True)
    args = parser.parse_args()
    rustc = subprocess.check_output(["rustc", f"+{args.toolchain}", "-vV"], text=True, encoding="utf-8")
    settings = [hashlib.sha256(path.read_bytes()).hexdigest() for path in
                (Path(__file__), Path(".github/workflows/exact-owner.yml"))]
    target, key = identity(args.core, rustc, args.runner, settings)
    print(f"target={target}\nkey={key}")


if __name__ == "__main__":
    main()
