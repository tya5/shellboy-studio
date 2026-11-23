"""Owner-free test fixtures for packaging evidence."""
from copy import deepcopy
from pathlib import Path
import runpy
import tempfile
import unittest

P = runpy.run_path(str(Path(__file__).with_name("packaging-proof.py")))
SHA = "a" * 40
PASS = {"status": "completed", "conclusion": "success"}
REPO = "tya5/shellboy-studio"


class ProofTests(unittest.TestCase):
    def setUp(self):
        self.run_record = dict(PASS, id=5, head_sha=SHA, event="workflow_dispatch", run_attempt=1, head_repository={"id": 2})
        self.jobs = [dict(PASS, name=name) for name in sorted(P["CHECKS"] | P["OWNERS"])]
        for job in self.jobs:
            if job["name"] in P["OWNERS"]:
                job["steps"] = [dict(PASS, name=P[key]) for key in ("CORE_STEP", "SUITE_STEP")]

    def proof(self, dispatch_only=True):
        def api(path, key):
            if key == "workflow_runs":
                self.assertIn(f"workflows/ci.yml/runs?head_sha={SHA}", path)
                return [self.run_record]
            self.assertIn("runs/5/attempts/1/jobs", path)
            return self.jobs
        return P["proof"](api, REPO, 2, SHA, dispatch_only=dispatch_only)

    def test_requires_eligible_run(self):
        self.assertEqual(self.proof(), 5)
        original = self.run_record.copy()
        for changes in ({"head_sha": "b" * 40}, {"status": "in_progress"}, {"conclusion": "failure"},
                        {"head_repository": {"id": 3}}, {"run_attempt": 2}, {"event": "pull_request"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.run_record = original | changes
                self.proof()
        self.run_record = original | {"event": "push"}
        self.assertEqual(self.proof(dispatch_only=False), 5)
        with self.assertRaises(ValueError):
            self.proof()

    def test_requires_every_job_and_core_witness_in_the_same_attempt(self):
        original = deepcopy(self.jobs)
        owner = next(job for job in self.jobs if "steps" in job)
        owner["steps"][0]["conclusion"] = "skipped"
        with self.assertRaises(ValueError):
            self.proof()
        for jobs in (original[1:], original + original[:1], [original[0] | {"status": "queued"}] + original[1:]):
            with self.subTest(jobs=len(jobs)), self.assertRaises(ValueError):
                self.jobs = jobs
                self.proof()

    def test_manifest_and_lock_must_pin_the_same_official_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            remote = "https://github.com/tya5/shellboy"
            (root / "Cargo.toml").write_text(f'[dependencies.shellboy]\ngit = "{remote}"\nrev = "{SHA}"\n')
            for locked in (SHA, "b" * 40):
                (root / "Cargo.lock").write_text(f'[[package]]\nname = "shellboy"\nsource = "git+{remote}?rev={SHA}#{locked}"\n')
                if locked == SHA:
                    self.assertEqual(P["core_pin"](root), SHA)
                else:
                    with self.assertRaises(ValueError):
                        P["core_pin"](root)


if __name__ == "__main__":
    unittest.main()
