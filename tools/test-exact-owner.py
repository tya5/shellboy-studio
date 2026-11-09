"""Isolated, network-free identity gate tests. No owner binary is executed."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("exact_owner", Path(__file__).with_name("exact-owner.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ExactOwner(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="studio-identity-fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = {**os.environ, "HOME": str(self.root), "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0"}
        for key in list(self.env):
            if key.startswith("GIT_") and key not in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT"):
                del self.env[key]
        self.owner = self.root / "owner"
        self.owner.mkdir()
        self.run_git("init")
        self.run_git("config", "user.name", "Synthetic fixture")
        self.run_git("config", "user.email", "fixture@example.invalid")
        self.run_git("remote", "add", "origin", gate.OFFICIAL)
        self.manifest = self.owner / "Cargo.toml"
        self.manifest.write_text('[package]\nname="shellboy"\nversion="0.11.0"\n', encoding="utf-8")
        self.run_git("add", "Cargo.toml")
        self.run_git("commit", "-m", "Synthetic source")
        self.run_git("tag", "-a", gate.TAG, "-m", "Synthetic annotated tag")
        self.commit = self.run_git("rev-parse", "HEAD")
        self.studio = self.root / "studio"
        self.studio.mkdir()
        (self.studio / "Cargo.toml").write_text('[dependencies]\nshellboy={git="'+gate.OFFICIAL+'", tag="'+gate.TAG+'"}\n', encoding="utf-8")
        self.lock = self.studio / "Cargo.lock"
        self.write_lock()
        self.version = self.root / "binary-version.txt"
        self.version.write_text("shellboy 0.11.0\n", encoding="utf-8")

    def run_git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.owner), *args], env=self.env,
                                       stderr=subprocess.DEVNULL, text=True, encoding="utf-8").strip()

    def write_lock(self, commit=None, version="0.11.0", repository=None, tag=None):
        self.lock.write_text('version=4\n[[package]]\nname="shellboy"\nversion="'+version+'"\nsource="git+'+(repository or gate.OFFICIAL)+'?tag='+(tag or gate.TAG)+'#'+(self.commit if commit is None else commit)+'"\n', encoding="utf-8")

    def check(self):
        return gate.verify(self.studio, self.owner, self.version)

    def test_annotated_tag_is_peeled_to_lock_commit(self):
        self.assertNotEqual(self.run_git("rev-parse", "refs/tags/"+gate.TAG), self.commit)
        evidence = self.check()
        self.assertEqual(evidence["lock_commit"], self.commit)
        self.assertEqual(evidence["peeled_commit"], self.commit)
        self.assertEqual(evidence["binary_version"], "0.11.0")
        self.assertNotIn(str(self.root), str(evidence))

    def test_lightweight_tag_also_resolves_commit(self):
        self.run_git("tag", "-d", gate.TAG)
        self.run_git("tag", gate.TAG)
        self.check()

    def test_same_version_different_commit_is_rejected(self):
        (self.owner / "fixture.txt").write_text("same version, distinct source\n", encoding="utf-8")
        self.run_git("add", "fixture.txt")
        self.run_git("commit", "-m", "Different source, unchanged version")
        self.write_lock(commit=self.run_git("rev-parse", "HEAD"))
        with self.assertRaisesRegex(ValueError, "tag differs"):
            self.check()

    def test_wrong_checkout_is_rejected_even_with_correct_lock(self):
        (self.owner / "fixture.txt").write_text("different checkout\n", encoding="utf-8")
        self.run_git("add", "fixture.txt")
        self.run_git("commit", "-m", "Wrong checkout")
        with self.assertRaisesRegex(ValueError, "checkout differs"):
            self.check()

    def test_missing_tag(self):
        self.run_git("tag", "-d", gate.TAG)
        with self.assertRaises(ValueError): self.check()

    def test_missing_lock(self):
        self.lock.unlink()
        with self.assertRaises(OSError): self.check()

    def test_missing_commit(self):
        self.write_lock(commit="")
        with self.assertRaisesRegex(ValueError, "commit missing"): self.check()

    def test_wrong_lock_commit(self):
        self.write_lock(commit="0"*40)
        with self.assertRaisesRegex(ValueError, "tag differs"): self.check()

    def test_wrong_lock_version(self):
        self.write_lock(version="0.10.0")
        with self.assertRaisesRegex(ValueError, "locked owner package version"): self.check()

    def test_wrong_lock_repository(self):
        self.write_lock(repository="https://example.invalid/not-core")
        with self.assertRaisesRegex(ValueError, "locked owner source"): self.check()

    def test_wrong_lock_tag(self):
        self.write_lock(tag="v0.10.0")
        with self.assertRaisesRegex(ValueError, "locked owner source"): self.check()

    def test_wrong_manifest_pin(self):
        path = self.studio / "Cargo.toml"
        path.write_text(path.read_text(encoding="utf-8").replace("v0.11.0", "v0.10.0"), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Studio must pin"): self.check()

    def test_wrong_remote(self):
        self.run_git("remote", "set-url", "origin", "https://example.invalid/not-core")
        with self.assertRaisesRegex(ValueError, "wrong owner remote"): self.check()

    def test_wrong_source_package_version(self):
        self.manifest.write_text(self.manifest.read_text(encoding="utf-8").replace("0.11.0", "0.10.0"), encoding="utf-8")
        self.run_git("add", "Cargo.toml")
        self.run_git("commit", "-m", "Wrong package version")
        self.commit = self.run_git("rev-parse", "HEAD")
        self.run_git("tag", "-f", gate.TAG)
        self.write_lock()
        with self.assertRaisesRegex(ValueError, "source package version"): self.check()

    def test_dirty_source(self):
        self.manifest.write_text(self.manifest.read_text(encoding="utf-8")+"# modified\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "not clean"): self.check()

    def test_missing_source_manifest(self):
        self.manifest.unlink()
        with self.assertRaises(ValueError): self.check()

    def test_missing_binary_version(self):
        self.version.unlink()
        with self.assertRaises(OSError): self.check()

    def test_wrong_binary_version(self):
        self.version.write_text("shellboy 0.10.0\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "wrong binary version"): self.check()

    def test_correct_version_with_extra_output_is_rejected(self):
        self.version.write_text("shellboy 0.11.0 extra\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "wrong binary version"): self.check()

    def test_missing_owner_package(self):
        self.lock.write_text("version=4\npackage=[]\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "exactly one"): self.check()

    def test_duplicate_owner_packages(self):
        self.lock.write_text(self.lock.read_text(encoding="utf-8")+"[[package]]"+self.lock.read_text(encoding="utf-8").split("[[package]]", 1)[1], encoding="utf-8")
        with self.assertRaises(ValueError): self.check()


class StrictReleaseText(unittest.TestCase):
    def test_invalid_utf8_in_document_is_rejected(self):
        spec = importlib.util.spec_from_file_location("release_check", Path(__file__).with_name("check-release.py"))
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory(prefix="studio-invalid-utf8-") as tmp:
            root = Path(tmp)
            (root / "README.md").write_bytes(b"invalid utf8: \xff\n")
            (root / "AGENTS.md").write_text("Synthetic instructions\n", encoding="utf-8")
            (root / "docs").mkdir()
            with self.assertRaises(UnicodeDecodeError):
                release.local_links(root)


if __name__ == "__main__":
    unittest.main()
