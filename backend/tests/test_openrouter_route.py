"""Space Bunny Alpha sits ahead of the named OpenRouter model. No network."""
from __future__ import annotations

import unittest

from openrouter_chat import SPACE_BUNNY_MODEL, model_attempts


class ModelAttemptsTest(unittest.TestCase):
    def test_space_bunny_then_named_model(self) -> None:
        plan = model_attempts("openai/gpt-4o-mini")
        self.assertEqual(plan[0][0], SPACE_BUNNY_MODEL)
        self.assertEqual(plan[0][1], {"reasoning": {"effort": "medium"}})
        self.assertEqual(plan[1], ("openai/gpt-4o-mini", None))

    def test_space_bunny_alone_when_it_is_the_named_model(self) -> None:
        self.assertEqual(len(model_attempts(SPACE_BUNNY_MODEL)), 1)

    def test_blank_model_uses_the_default_second_route(self) -> None:
        self.assertEqual(model_attempts("  ")[1][0], "openai/gpt-4o-mini")


if __name__ == "__main__":
    unittest.main()
