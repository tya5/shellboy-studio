"""Owner-free release preparation checks; no dispatch, network or real binaries."""
import ast
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import tomllib
from urllib.parse import unquote, urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def local_links(root):
    checked = 0
    for path in [root / "README.md", root / "AGENTS.md", *sorted((root / "docs").rglob("*.md"))]:
        text = re.sub(r"<!--.*?-->|```.*?```", "", path.read_text(encoding="utf-8"), flags=re.S)
        for link in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text):
            url = urlsplit(link.strip("<>"))
            if url.scheme or url.netloc:
                continue
            target = path.parent / unquote(url.path) if url.path else path
            assert target.exists(), f"Missing local link in {path.relative_to(root)}"
            # File targets are checked, including images; heading fragments are checked below.
            if url.fragment and target.suffix == ".md":
                headings = re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", target.read_text(encoding="utf-8"), re.M)
                slugs = {re.sub(r"[^\w\- ]", "", h.lower().replace("`", "")).replace(" ", "-") for h in headings}
                assert unquote(url.fragment) in slugs, f"Missing heading link in {path.relative_to(root)}"
            checked += 1
    return checked


def main():
    manifest = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
    target = next(t for t in manifest["test"] if t["name"] == "real_owner")
    assert target["required-features"] == ["real-owner-tests"]
    assert "real-owner-tests" not in manifest["features"]["default"]
    tests = (ROOT / "tests/real_owner.rs").read_text(encoding="utf-8")
    assert "SKIPPED" not in tests
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    release = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    owner = (ROOT / ".github/workflows/exact-owner.yml").read_text(encoding="utf-8")
    assert "uses: ./.github/workflows/exact-owner.yml" in ci
    assert "needs: exact-owner" in release and "needs: build" in release
    assert "--features real-owner-tests --test real_owner" in owner
    assert "SHELLBOY_BIN:" in owner and "refs/tags/v0.13.0^{commit}" in owner
    assert "tools/exact-owner.py" in owner and "--binary-version" in owner
    assert "inputs.real_owner" not in ci
    for workflow in (ci, release, owner):
        for code in re.findall(r"python3? - <<'([A-Z]+)'\n(.*?)\n\s*\1(?:\n|$)", workflow, re.S):
            ast.parse(textwrap.dedent(code[1]))
    subprocess.run([sys.executable, str(ROOT / "tools/test-exact-owner.py")], check=True)
    print(f"Source local links checked: {local_links(ROOT)}")
    block = release.split("      - name: Package\n", 1)[1].split("      - name:", 1)[0]
    code = textwrap.dedent(block.split("python - <<'PY'\n", 1)[1].rsplit("\n          PY", 1)[0])
    # Run only packaging Python with synthetic non-executable data. Never run a binary.
    for target, executable, archive in [
        ("x86_64-pc-windows-msvc", "shellboy-studio.exe", "zip"),
        ("aarch64-apple-darwin", "shellboy-studio", "tar.gz"),
        ("x86_64-unknown-linux-gnu", "shellboy-studio", "tar.gz"),
    ]:
        with tempfile.TemporaryDirectory(prefix="studio-package-fixture-") as tmp:
            root = Path(tmp)
            for name in ("LICENSE", "README.md", "AGENTS.md"):
                shutil.copy2(ROOT / name, root / name)
            shutil.copytree(ROOT / "docs", root / "docs")
            binary = root / "target" / target / "release" / executable
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"synthetic non-executable fixture\n")
            old_cwd, old_env = Path.cwd(), os.environ.copy()
            try:
                os.chdir(root)
                os.environ.update(RELEASE_TAG="v" + manifest["package"]["version"], RELEASE_TARGET=target,
                                  RELEASE_EXECUTABLE=executable, RELEASE_ARCHIVE=archive)
                exec(compile(code, "release packaging fixture", "exec"), {})
            finally:
                os.chdir(old_cwd)
                os.environ.clear()
                os.environ.update(old_env)
            artifact, = (root / "dist").iterdir()
            unpack = root / "unpack"
            if archive == "zip":
                with zipfile.ZipFile(artifact) as file:
                    file.extractall(unpack)
            else:
                with tarfile.open(artifact) as file:
                    file.extractall(unpack, filter="data")
            stage, = unpack.iterdir()
            assert (stage / executable).read_bytes() == binary.read_bytes()
            assert (stage / "LICENSE").is_file()
            print(f"Synthetic archive {target}: {local_links(stage)} local links checked")
    print("PASS: preparation only; no real owner, OS binary, hosted CI or release verified")


if __name__ == "__main__":
    main()
