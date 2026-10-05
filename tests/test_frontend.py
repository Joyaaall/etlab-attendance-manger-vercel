import unittest
from unittest.mock import patch

from requests import Response

from app import create_app


def upstream(html, url="https://asiet.etlab.app/ktuacademics/student/attendance", status=200):
    result = Response()
    result.status_code = status
    result.url = url
    result._content = html.encode()
    return result


class FrontendTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def test_home_serves_login_app_without_remote_assets(self):
        result = self.client.get("/")
        self.assertEqual(result.status_code, 200)
        html = result.get_data(as_text=True)
        self.assertIn('id="portal-form"', html)
        self.assertIn('id="portal-url"', html)
        self.assertIn('id="login-form"', html)
        self.assertIn('id="credentials-step"', html)
        self.assertIn('autocomplete="current-password"', html)
        self.assertIn('href="/static/dashboard.css"', html)
        self.assertIn('src="/static/dashboard.mjs"', html)
        self.assertNotIn('https://fonts.googleapis.com', html)
        self.assertIn("no-store", result.headers["Cache-Control"])
        self.assertIn("frame-ancestors 'none'", result.headers["Content-Security-Policy"])

    def test_dashboard_branding_and_removed_interface_elements(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('<title>Attendance Manager — Etlab</title>', html)
        self.assertEqual(html.count('aria-label="Attendance Manager home"'), 2)
        self.assertNotIn('rollcall', html.lower())
        self.assertNotIn('ETLAB × ASIET', html)
        self.assertNotIn('Built for the ASIET week.', html)
        self.assertNotIn('/apidocs/', html)
        self.assertNotIn('Use this private instance over Tailscale or HTTPS.', html)
        self.assertNotIn('id="formula-button"', html)
        self.assertNotIn('id="formula-note"', html)
        self.assertIn('can I Get a<br>social <em>LIFE!!</em>', html)
        self.assertNotIn('Show up.<br>Make room<br>for <em>life.</em>', html)
        for removed_copy in [
            'Less guesswork. Better plans.',
            'Your attendance, without the guesswork.',
            'Know where you stand before you plan a day off.',
            'A little clarity. A little breathing room.',
            '01 / ATTENDANCE &amp; TIME',
        ]:
            self.assertNotIn(removed_copy, html)

    def test_onboarding_and_creator_support_are_available_without_tracking(self):
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn('id="onboarding-dialog"', html)
        self.assertIn('id="onboarding-skip"', html)
        self.assertIn('id="onboarding-next"', html)
        self.assertIn('id="onboarding-back"', html)
        self.assertEqual(html.count('href="https://buymeacoffee.com/joyalaliyas"'), 2)
        self.assertEqual(html.count('rel="noopener noreferrer"'), 2)
        self.assertNotIn('onboarding-complete', html)

    def test_semester_discovery_returns_current_and_available_options(self):
        html = '''<title>etlab | Attendance</title><select name="semester">
        <option value="1">Ist Semester</option><option value="5" selected>Vth Semester</option>
        <option value="10">Xth Semester</option></select>'''
        with patch("requests.get", return_value=upstream(html)) as get:
            result = self.client.get("/api/semesters", headers={"Authorization": "Bearer test-session"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json, {"current": 5, "semesters": [{"value": 1, "label": "Ist Semester"}, {"value": 5, "label": "Vth Semester"}]})
        self.assertEqual(get.call_args.kwargs["cookies"], {"ASIETSESSIONID": "test-session"})
        self.assertEqual(get.call_args.kwargs["timeout"], 20)
        self.assertIn("no-store", result.headers["Cache-Control"])

    def test_semester_discovery_requires_authentication(self):
        self.assertEqual(self.client.get("/api/semesters").status_code, 401)

    def test_semester_discovery_detects_expired_session(self):
        with patch("requests.get", return_value=upstream('<input name="LoginForm[username]">')):
            result = self.client.get("/api/semesters", headers={"Authorization": "test-session"})
        self.assertEqual(result.status_code, 401)

    def test_semester_discovery_reports_unexpected_structure(self):
        with patch("requests.get", return_value=upstream("<html>Maintenance</html>")):
            result = self.client.get("/api/semesters", headers={"Authorization": "test-session"})
        self.assertEqual(result.status_code, 502)
