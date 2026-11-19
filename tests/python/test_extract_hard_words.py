"""Tests for extract_hard_words.py."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from extract_hard_words import candidates, extract_hard_words


class TestCandidates(unittest.TestCase):
    def test_suffixes_are_stripped(self):
        self.assertEqual(candidates("fluctuates"), ["fluctuates", "fluctuat", "fluctuate"])
        self.assertIn("attribute", candidates("attributed"))
        self.assertIn("change", candidates("changed"))
        self.assertIn("read", candidates("reading"))


class TestExtractHardWords(unittest.TestCase):
    COMMON = {"the", "coral", "reef", "often", "show", "change", "an"}

    def test_extracts_words_not_in_common_list(self):
        body = "The coral reefs often show disequilibria."
        self.assertEqual(extract_hard_words(body, self.COMMON), ["disequilibria"])

    def test_inflected_common_words_are_excluded(self):
        body = "Changes changed changing."
        self.assertEqual(extract_hard_words(body, self.COMMON), [])


class TestMainMissingBody(unittest.TestCase):
    def test_missing_body_returns_error_exit(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"id": "passage_999"}, f)
            path = f.name
        proc = subprocess.run(
            [sys.executable, "scripts/extract_hard_words.py", path],
            capture_output=True, text=True,
            cwd=Path(__file__).resolve().parents[2],
        )
        self.assertEqual(proc.returncode, 1)
        self.assertIn("body", proc.stderr)


if __name__ == "__main__":
    unittest.main()
