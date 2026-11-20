"""Tests for extract_hard_words.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from extract_hard_words import extract_hard_words


class TestExtractHardWords(unittest.TestCase):
    COMMON = {"the", "coral", "reef", "often", "show", "change", "an"}

    def test_extracts_words_not_in_common_list(self):
        body = "The coral reefs often show disequilibria."
        self.assertEqual(extract_hard_words(body, self.COMMON), ["disequilibria"])

    def test_inflected_common_words_are_excluded(self):
        body = "Changes changed changing."
        self.assertEqual(extract_hard_words(body, self.COMMON), [])


if __name__ == "__main__":
    unittest.main()
