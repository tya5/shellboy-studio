"""Owner-free checks for desktop archive names and bundle contents."""
import os
from pathlib import Path
import plistlib
import runpy
import tempfile
import unittest

package = runpy.run_path(str(Path(__file__).with_name("package-macos.py")))


class MacosPackage(unittest.TestCase):
    def test_names_and_bundle_metadata(self):
        studio, core = "a" * 40, "b" * 40
        for release in (False, True):
            with self.subTest(release=release), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                binaries = [root / "studio", root / "core"]
                for binary in binaries:
                    binary.write_text(f"fixture-{binary.name}")
                    binary.chmod(0o755)
                app = package["stage"](root, *binaries, "v0.3.0", studio, core, release)
                name = package["app_name"]("v0.3.0", studio, core, release)
                self.assertEqual(name, ("shellboy-studio-desktop-v0.3.0" if release else
                    f"shellboy-studio-desktop-candidate-{studio}-core-{core}") + "-aarch64-apple-darwin.zip")
                self.assertEqual(app.name, "Shellboy Studio.app")
                contents = app / "Contents"
                info = plistlib.loads((contents / "Info.plist").read_bytes())
                self.assertTrue(info["LSUIElement"])
                self.assertEqual(info["ShellboyCandidate"], not release)
                self.assertEqual(info["ShellboyCoreRevision"], core)
                for source, path in zip(binaries, ("MacOS/shellboy-studio", "Resources/bin/shellboy")):
                    target = contents / path
                    self.assertTrue(os.access(target, os.X_OK))
                    self.assertEqual(target.read_bytes(), source.read_bytes())


if __name__ == "__main__":
    unittest.main()
