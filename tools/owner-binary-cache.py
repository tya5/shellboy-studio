"""Bind exact-owner cache bytes to the verified checkout and build key.

The receipt is not a signature. Trust comes from GitHub's cache ref isolation
and the workflow saving only from main or the controlled landing batch.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess


BUILD_ENV = (
    "ImageOS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC", "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER", "CC", "CXX", "AR", "CFLAGS", "CXXFLAGS",
    "LDFLAGS", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET",
)


def digest(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("cache entry must be a regular file")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


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


def receipt(binary, core, key):
    if binary.stat().st_size == 0:
        raise ValueError("empty owner binary")
    return {"core": core, "key": key, "sha256": digest(binary)}


def verify_receipt(path, binary, core, key):
    digest(path)  # Refuse symlinks before reading the receipt or executable.
    if json.loads(path.read_text(encoding="utf-8")) != receipt(binary, core, key):
        raise ValueError("owner cache receipt mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("key", "record", "verify"))
    parser.add_argument("--core", required=True)
    parser.add_argument("--toolchain")
    parser.add_argument("--runner")
    parser.add_argument("--key")
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    if args.action == "key":
        rustc = subprocess.check_output(["rustc", f"+{args.toolchain}", "-vV"], text=True, encoding="utf-8")
        settings = [digest(Path(__file__)), digest(Path(".github/workflows/exact-owner.yml"))]
        target, key = identity(args.core, rustc, args.runner, settings)
        print(f"target={target}\nkey={key}")
    elif args.action == "record":
        args.receipt.write_text(json.dumps(receipt(args.binary, args.core, args.key)), encoding="utf-8")
    else:
        verify_receipt(args.receipt, args.binary, args.core, args.key)
        print("Owner cache receipt and binary digest match the verified build key")


if __name__ == "__main__":
    main()
