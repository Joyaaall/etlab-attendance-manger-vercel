import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


class VercelPackagingTests(unittest.TestCase):
    def test_vercel_entrypoint_exports_flask_app(self):
        source = (ROOT / "index.py").read_text()
        self.assertIn("app = create_app()", source)

    def test_vercel_configuration_targets_entrypoint_and_allows_upstream_timeout(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        function = config["functions"]["index.py"]
        self.assertGreaterEqual(function["maxDuration"], 30)
        self.assertIn("public/**", function["excludeFiles"])
        self.assertNotIn("docs/**", function["excludeFiles"])

        ignored = {
            line.strip()
            for line in (ROOT / ".vercelignore").read_text().splitlines()
            if line.strip() and not line.startswith("#")
        }
        self.assertNotIn("docs", ignored)

    def test_static_assets_are_in_vercel_public_directory(self):
        self.assertTrue((ROOT / "public" / "static" / "dashboard.css").is_file())
        self.assertTrue((ROOT / "public" / "static" / "dashboard.mjs").is_file())
        self.assertTrue((ROOT / "public" / "static" / "fonts" / "dm-sans.ttf").is_file())

    def test_flask_does_not_serve_vercel_cdn_assets(self):
        from app import create_app

        application = create_app()
        self.assertIsNone(application.static_folder)

    def test_local_development_app_serves_static_assets(self):
        from app import create_app

        application = create_app(serve_static=True)
        response = application.test_client().get("/static/dashboard.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"--cobalt", response.data)
        analytics = application.test_client().get("/_vercel/insights/script.js")
        self.assertEqual(analytics.status_code, 204)

    def test_vercel_requires_a_stable_token_secret(self):
        from config import deployment_token_secret

        with patch.dict(os.environ, {"VERCEL": "1"}, clear=False):
            os.environ.pop("ETLAB_TOKEN_SECRET", None)
            with self.assertRaisesRegex(RuntimeError, "ETLAB_TOKEN_SECRET"):
                deployment_token_secret()


if __name__ == "__main__":
    unittest.main()
