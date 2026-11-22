"""Build-only macOS app packaging. Never tags, publishes, or runs the launcher."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import tomllib

TARGET = "aarch64-apple-darwin"


def app_name(version, studio, core, release):
    if release:
        if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version):
            raise ValueError("expected stable Studio version tag")
        return f"shellboy-studio-desktop-{version}-{TARGET}.zip"
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (studio, core)):
        raise ValueError("candidate requires full Studio and Core SHAs")
    return f"shellboy-studio-desktop-candidate-{studio}-core-{core}-{TARGET}.zip"


def stage(root, studio_bin, core_bin, version, studio, core, release):
    contents = root / "Shellboy Studio.app" / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    (contents / "Resources/bin").mkdir(parents=True)
    for source, target in [(studio_bin, contents / "MacOS/shellboy-studio"), (core_bin, contents / "Resources/bin/shellboy")]:
        if not source.is_file() or not os.access(source, os.X_OK):
            raise ValueError("bundle input must be executable")
        shutil.copy2(source, target)
    plist = {
        "CFBundleExecutable": "shellboy-studio", "CFBundleIdentifier": "io.github.tya5.shellboy-studio" + ("" if release else ".candidate"),
        "CFBundleName": "Shellboy Studio", "CFBundleDisplayName": "Shellboy Studio" if release else "Shellboy Studio (Candidate)",
        "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version.lstrip("v"),
        "CFBundleVersion": version.lstrip("v"), "LSUIElement": True, "LSMinimumSystemVersion": "14.0",
        "ShellboyStudioRevision": studio, "ShellboyCoreRevision": core, "ShellboyCandidate": not release,
    }
    (contents / "Info.plist").write_bytes(plistlib.dumps(plist))
    return contents.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("studio-bin", "core-bin", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    manifest = tomllib.loads(Path("Cargo.toml").read_text())
    version = manifest["package"]["version"]
    core = manifest["dependencies"]["shellboy"]["rev"]
    studio = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    version = "v" + version
    name = app_name(version, studio, core, args.release)
    args.out.mkdir(parents=True, exist_ok=True)
    archive = (args.out / name).resolve()
    with tempfile.TemporaryDirectory(prefix="studio-macos-app-") as tmp:
        root = Path(tmp)
        app = stage(root, args.studio_bin, args.core_bin, version, studio, core, args.release)
        subprocess.run(["ditto", "-c", "-k", "--keepParent", str(app), str(archive)], check=True)
        unpack = root / "unpack"
        subprocess.run(["ditto", "-x", "-k", str(archive), str(unpack)], check=True)
        assert [p.name for p in unpack.iterdir()] == [app.name]
        contents = unpack / app.name / "Contents"
        assert (contents / "Info.plist").read_bytes() == (app / "Contents/Info.plist").read_bytes()
        for source, target in [(args.studio_bin, contents / "MacOS/shellboy-studio"), (args.core_bin, contents / "Resources/bin/shellboy")]:
            assert target.is_file() and os.access(target, os.X_OK)
            assert target.read_bytes() == source.read_bytes()
            assert subprocess.check_output([target, "--version"]) == subprocess.check_output([source, "--version"])
    print(archive.name)


if __name__ == "__main__":
    main()
