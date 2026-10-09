"""Space Bunny Alpha sits ahead of the named OpenRouter model. No network."""
from __future__ import annotations

import unittest

from openrouter_chat import SPACE_BUNNY_MODEL, OpenRouterStatus, model_attempts
from redact_provider import PACKAGE_REDACT, VENDOR_REDACT, load_redact_secrets, redact_provider_text


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


class RedactOpenRouterErrorTest(unittest.TestCase):
    def test_http_body_loses_secret_shaped_text(self) -> None:
        secret = "sk-or-v1-secretvalue1234567890abcd"
        gemini = "AIzaSyOWNERGEMINIKEY1234567890"
        body = ("x" * 480) + f" bad {secret} Bearer {secret} {gemini}"
        error = OpenRouterStatus(401, body)
        text = str(error)
        self.assertNotIn(secret, text)
        self.assertNotIn(gemini, text)
        self.assertNotIn("sk-or-v1", text)
        self.assertIn("[redacted]", text)
        self.assertLessEqual(len(text), len("OpenRouter HTTP 401: ") + 500)

    def test_stream_error_text_is_redacted_before_it_is_returned(self) -> None:
        secret = "sk-testSECRET1234567890abcd"
        safe = redact_provider_text(f"OpenRouter stream error: {secret}")
        self.assertNotIn(secret, safe)
        self.assertIn("[redacted]", safe)

    def test_vendored_redact_matches_the_installed_package(self) -> None:
        if not PACKAGE_REDACT.is_file():
            self.skipTest("ai-buffer package is not installed")
        package = load_redact_secrets(PACKAGE_REDACT)
        vendor = load_redact_secrets(VENDOR_REDACT)
        sample = "Bearer sk-or-v1-secretvalue1234567890abcd AIzaSyOWNERGEMINIKEY1234567890"
        self.assertEqual(package(sample), vendor(sample))
        self.assertNotIn("sk-or-v1", package(sample))


if __name__ == "__main__":
    unittest.main()
