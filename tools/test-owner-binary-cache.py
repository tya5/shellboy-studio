"""Owner-free tests for the exact binary cache key."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("owner_binary_cache", Path(__file__).with_name("owner-binary-cache.py"))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)

CORE = "a" * 40
RUST = "rustc 1.99.1\nhost: aarch64-apple-darwin\ncommit-hash: abc"


class OwnerBinaryCache(unittest.TestCase):
    def test_build_identity_changes_with_each_axis(self):
        with patch.dict(cache.os.environ, {}, clear=True):
            target, key = cache.identity(CORE, RUST, "macos-15", ["release locked"])
            self.assertEqual(target, "aarch64-apple-darwin")
            self.assertIn(CORE, key)
            for changed in [
                ("b" * 40, RUST, "macos-15", ["release locked"]),
                (CORE, RUST.replace("aarch64", "x86_64"), "macos-15", ["release locked"]),
                (CORE, RUST.replace("1.99.1", "1.99.2"), "macos-15", ["release locked"]),
                (CORE, RUST, "macos-16", ["release locked"]),
                (CORE, RUST, "macos-15", ["debug locked"]),
            ]:
                self.assertNotEqual(cache.identity(*changed)[1], key)
            with patch.dict(cache.os.environ, {"CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER": "another-linker"}):
                self.assertNotEqual(cache.identity(CORE, RUST, "macos-15", ["release locked"])[1], key)

if __name__ == "__main__":
    unittest.main()
