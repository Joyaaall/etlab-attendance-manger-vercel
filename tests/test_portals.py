import unittest
from unittest.mock import MagicMock, patch

import requests

from app import create_app
from app.utils.portal import PortalError, normalize_portal_url
from tests.test_api import response


LOGIN_FORM = '''<title>etlab | Login</title><form>
<input name="LoginForm[username]">
<input name="LoginForm[password]" type="password">
<input type="hidden" name="YII_CSRF_TOKEN" value="fixture-csrf">
</form>'''
PROFILE = '''<title>etlab | My Profile</title><table>
<tr><th>Name</th><td>Fixture Student</td></tr>
<tr><th>Date of Birth</th><td>2000-01-01</td></tr>
<tr><th>Admission No</th><td>FIXTURE</td></tr>
<tr><th>University Reg No</th><td>TEST</td></tr>
</table>'''


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def test_normalizes_supported_etlab_addresses(self):
        for supplied, expected in [
            ("asiet.etlab.app", "https://asiet.etlab.app"),
            (" HTTPS://College.ETLAB.APP/ ", "https://college.etlab.app"),
            ("https://rit.etlab.in/user/login", "https://rit.etlab.in"),
        ]:
            with self.subTest(supplied=supplied):
                self.assertEqual(normalize_portal_url(supplied), expected)

    def test_rejects_unsafe_or_unrelated_portals(self):
        rejected = [
            "http://asiet.etlab.app", "https://localhost", "https://127.0.0.1",
            "https://user:pass@asiet.etlab.app", "https://asiet.etlab.app:8443",
            "https://asiet.etlab.app/#fragment", "https://evil.example",
            "https://etlab.app.evil.example",
        ]
        for supplied in rejected:
            with self.subTest(supplied=supplied), self.assertRaises(PortalError):
                normalize_portal_url(supplied)

    def test_portal_check_validates_login_form_and_returns_canonical_origin(self):
        with patch("requests.get", return_value=response(LOGIN_FORM, url="https://college.etlab.app/user/login")) as get:
            result = self.client.post("/api/portal/check", json={"portal_url": "college.etlab.app/user/login"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["portal_url"], "https://college.etlab.app")
        self.assertEqual(get.call_args.args[0], "https://college.etlab.app/user/login")
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_portal_check_rejects_unsupported_page(self):
        with patch("requests.get", return_value=response("<html>Not Etlab</html>", url="https://college.etlab.app/user/login")):
            result = self.client.post("/api/portal/check", json={"portal_url": "college.etlab.app"})
        self.assertEqual(result.status_code, 422)

    def test_login_returns_portal_bound_token_and_detects_session_cookie(self):
        session = MagicMock()
        session.get.return_value = response(LOGIN_FORM, url="https://college.etlab.app/user/login")
        session.post.return_value = response("<title>etlab | Dashboard</title>", url="https://college.etlab.app/dashboard")
        session.cookies = requests.cookies.cookiejar_from_dict({"YII_CSRF_TOKEN": "csrf", "COLLEGESESSIONID": "fixture-session"})
        with patch("requests.Session", return_value=session):
            result = self.client.post("/api/login", json={
                "portal_url": "college.etlab.app", "username": "fixture-user", "password": "fixture-password",
            })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["portal_url"], "https://college.etlab.app")
        self.assertTrue(result.json["token"].startswith("am1."))
        self.assertNotIn("fixture-session", result.json["token"])
        self.assertEqual(session.post.call_args.args[0], "https://college.etlab.app/user/login")

        with patch("requests.get", return_value=response(PROFILE, url="https://college.etlab.app/student/profile")) as get:
            profile = self.client.get("/api/profile", headers={"Authorization": f"Bearer {result.json['token']}"})
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(get.call_args.args[0], "https://college.etlab.app/student/profile")
        cookie_jar = get.call_args.kwargs["cookies"]
        self.assertEqual(cookie_jar.get("COLLEGESESSIONID", domain="college.etlab.app", path="/"), "fixture-session")

    def test_tampered_portal_token_is_rejected(self):
        result = self.client.get("/api/profile", headers={"Authorization": "Bearer am1.not-a-valid-token"})
        self.assertEqual(result.status_code, 401)


if __name__ == "__main__":
    unittest.main()
