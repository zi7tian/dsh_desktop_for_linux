"""Check source reproducibility and reject accidental edits without discarding them."""

import hashlib
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts/desktop.py"
SPEC = importlib.util.spec_from_file_location("desktop", MODULE)
desktop = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(desktop)


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dsh-source-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.patch = self.root / "desktop.patch"
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        desktop.git(self.source, "config", "user.name", "Fixture")
        desktop.git(self.source, "config", "user.email", "fixture@example.invalid")
        desktop.git(self.source, "config", "commit.gpgsign", "false")
        (self.source / "runtime.txt").write_text("upstream\n")
        desktop.git(self.source, "add", "runtime.txt")
        desktop.git(self.source, "commit", "-qm", "fixture")
        base = desktop.git(self.source, "rev-parse", "HEAD")
        (self.source / "runtime.txt").write_text("desktop\n")
        self.patch.write_bytes(subprocess.check_output([
            "git", "-C", str(self.source), "diff", "--binary", "--full-index"
        ]))
        desktop.git(self.source, "add", "runtime.txt")
        self.lock = {
            "commit": base,
            "patch_sha256": desktop.sha256(self.patch),
            "patched_tree": desktop.git(self.source, "write-tree"),
        }
        desktop.git(self.source, "reset", "--hard", "HEAD")

    def test_patch_reconstructs_expected_tree_and_can_run_twice(self):
        desktop.prepare_checkout(self.source, self.patch, self.lock)
        desktop.prepare_checkout(self.source, self.patch, self.lock)
        self.assertEqual((self.source / "runtime.txt").read_text(), "desktop\n")
        self.assertEqual(desktop.git(self.source, "write-tree"), self.lock["patched_tree"])

    def test_unstaged_local_edit_is_preserved(self):
        (self.source / "runtime.txt").write_text("user work\n")
        with self.assertRaisesRegex(RuntimeError, "local edits"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)
        self.assertEqual((self.source / "runtime.txt").read_text(), "user work\n")

    def test_staged_local_edit_is_preserved(self):
        (self.source / "runtime.txt").write_text("staged work\n")
        desktop.git(self.source, "add", "runtime.txt")
        with self.assertRaisesRegex(RuntimeError, "tree differs"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)
        self.assertEqual((self.source / "runtime.txt").read_text(), "staged work\n")

    def test_untracked_file_is_preserved(self):
        (self.source / "notes.txt").write_text("keep me\n")
        with self.assertRaisesRegex(RuntimeError, "local edits"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)
        self.assertEqual((self.source / "notes.txt").read_text(), "keep me\n")

    def test_changed_patch_is_rejected_before_application(self):
        self.patch.write_bytes(self.patch.read_bytes() + b"\n")
        with self.assertRaisesRegex(RuntimeError, "checksum differs"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)
        self.assertEqual((self.source / "runtime.txt").read_text(), "upstream\n")

    def test_wrong_commit_is_rejected(self):
        self.lock["commit"] = "0" * 40
        with self.assertRaisesRegex(RuntimeError, "pinned upstream commit"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)

    def test_wrong_result_tree_is_rejected(self):
        self.lock["patched_tree"] = "0" * 40
        with self.assertRaisesRegex(RuntimeError, "tree differs"):
            desktop.prepare_checkout(self.source, self.patch, self.lock)


class InstallerTests(unittest.TestCase):
    def test_only_the_three_expected_formats_are_collected(self):
        with tempfile.TemporaryDirectory(prefix="dsh-artifacts-test-") as directory:
            root = Path(directory)
            contents = {
                "deepseek-harness-1.0.0-linux-amd64.deb": b"!<arch>\nfixture",
                "deepseek-harness-1.0.0-linux-x86_64.rpm": b"\xed\xab\xee\xdbfixture",
                "deepseek-harness-1.0.0-linux-x86_64.pkg.tar.zst": b"\x28\xb5\x2f\xfdfixture",
            }
            for name, data in contents.items():
                (root / name).write_bytes(data)
            (root / "old.AppImage").write_bytes(b"old output")
            self.assertEqual(desktop.installers(root, "1.0.0"), {
                name: hashlib.sha256(data).hexdigest() for name, data in contents.items()
            })
            (root / next(iter(contents))).write_bytes(b"download failed")
            with self.assertRaisesRegex(RuntimeError, "Unexpected installer format"):
                desktop.installers(root, "1.0.0")


if __name__ == "__main__":
    unittest.main()
