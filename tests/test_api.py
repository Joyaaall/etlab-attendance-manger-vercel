import unittest
from unittest.mock import patch
from requests import Response

from app import create_app
from config import Config


def response(text, url="https://asiet.etlab.app/student/profile", status=200):
    result = Response()
    result.status_code = status
    result._content = text.encode()
    result.url = url
    return result


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.auth = {"Authorization": "test-session"}

    def test_asiet_cookie_configuration(self):
        self.assertEqual(Config.COOKIE_KEY, "ASIETSESSIONID")
        self.assertEqual(Config.BASE_URL, "https://asiet.etlab.app")

    def test_bearer_token_is_sent_as_session_cookie(self):
        html = '<title>etlab | My Profile</title><table>'
        for label in ["Name", "Date of Birth", "Admission No", "University Reg No"]:
            html += f'<tr><th>{label}</th><td>Example</td></tr>'
        html += '</table>'
        with patch("requests.get", return_value=response(html)) as get:
            result = self.client.get("/api/profile", headers={"Authorization": "Bearer test-session"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(get.call_args.kwargs["cookies"], {"ASIETSESSIONID": "test-session"})

    def test_empty_token_is_rejected(self):
        result = self.client.get("/api/profile", headers={"Authorization": "Bearer "})
        self.assertEqual(result.status_code, 401)

    def test_asiet_timetable_preserves_days_and_parses_teachers(self):
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerows([
            ["College"], ["Day", "Period 1", "Period 2"],
            ["Monday\n28 Sep 2026", "CST501 - Networks<br/>[Theory ]<br/>Teacher", "Free Period"],
            ["Tuesday\n29 Sep 2026", "LAB", "LAB"],
        ])
        with patch("requests.get", return_value=response(output.getvalue())):
            result = self.client.get("/api/timetable", headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(set(result.json), {"monday", "tuesday"})
        self.assertEqual(result.json["monday"]["period-1"], {"name": "CST501 - Networks", "teacher": "Teacher"})

    def test_timetable_expired_session_returns_401(self):
        with patch("requests.get", return_value=response('<title>etlab | login</title>', url="https://asiet.etlab.app/user/login")):
            result = self.client.get("/api/timetable", headers=self.auth)
        self.assertEqual(result.status_code, 401)

    def test_asiet_monthly_attendance_uses_real_semester_and_handles_cells(self):
        html = '''<title>etlab | Attendance</title>
        <select name="semester"><option value="5" selected="selected">Vth Semester</option></select>
        <select name="month"><option value="9" selected="selected">Sep</option></select>
        <select name="year"><option value="2026" selected="selected">2026</option></select>
        <table id="itsthetable"><tbody><tr><th>1 st</th>
        <td class="present">PLT-2026 - PLACEMENT TRAINING<br>Topic</td>
        <td class="absent">CST501 - COMPUTER NETWORKS</td><td></td></tr></tbody></table>'''
        for route, kind in [("present", "present"), ("absent", "absent")]:
            with self.subTest(route=route), patch("requests.post", return_value=response(html)) as post:
                result = self.client.get(f"/api/{route}?semester=5&month=9&year=2026", headers=self.auth)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(post.call_args.kwargs["data"]["semester"], 5)
                hours = result.json["data"][f"{kind}_hours"]
                self.assertEqual(len(hours), 1)
                self.assertEqual(hours[0]["day"], 1)
                if kind == "present":
                    self.assertEqual(hours[0]["subject_code"], "PLT-2026")
                    self.assertEqual(hours[0]["subject_name"], "PLACEMENT TRAINING")

    def test_attendance_total_hours_and_percentage(self):
        html = '''<title>Attendance</title><table class="items"><tr>
        <th>Reg</th><th>Roll</th><th>Name</th><th>CST501</th><th>Total</th><th>Percentage</th>
        </tr><tr><td>REG</td><td>1</td><td>Example</td><td>8/10 (80%)</td>
        <td>8/10</td><td>80%</td></tr></table>'''
        with patch("requests.get", return_value=response(html)):
            result = self.client.get("/api/attendance?semester=5", headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["total_hours"], "10")
        self.assertEqual(result.json["total_percentage"], "80%")

    def test_attendance_preserves_subject_header_names_including_zero_hours(self):
        html = '''<title>Attendance</title><table class="items"><tr>
        <th>Reg</th><th>Roll</th><th>Name</th>
        <th><span title="SYNTHETIC LAB">LAB501</span></th>
        <th title="THEORY501(P) - SYNTHETIC PRACTICAL">THEORY501(P)</th>
        <th>Total</th><th>Percentage</th></tr><tr>
        <td>REG</td><td>1</td><td>Example</td><td>8/10 (80%)</td>
        <td>0/0 (0%)</td><td>8/10</td><td>80%</td></tr></table>'''
        with patch("requests.get", return_value=response(html)):
            result = self.client.get("/api/attendance?semester=5", headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['LAB501']['subject_name'], 'SYNTHETIC LAB')
        self.assertEqual(result.json['THEORY501(P)']['subject_name'], 'SYNTHETIC PRACTICAL')
        self.assertEqual(result.json['THEORY501(P)']['total_hours'], '0')

    def test_login_rejects_missing_json(self):
        result = self.client.post("/api/login")
        self.assertEqual(result.status_code, 400)
        self.assertTrue(result.is_json)

    def test_login_uses_fresh_session_and_hidden_fields(self):
        from unittest.mock import MagicMock
        import requests
        for _ in range(2):
            session = MagicMock()
            session.get.return_value = response(
                '<form><input name="LoginForm[username]"><input name="LoginForm[password]" type="password"><input type="hidden" name="YII_CSRF_TOKEN" value="test-csrf"></form>',
                url="https://asiet.etlab.app/user/login",
            )
            session.post.return_value = response('<title>etlab | Dashboard</title>', url="https://asiet.etlab.app/dashboard")
            session.cookies = requests.cookies.cookiejar_from_dict({"ASIETSESSIONID": "new-session"})
            with patch("requests.Session", return_value=session) as factory:
                result = self.client.post("/api/login", json={"username": "test-user", "password": "test-password"})
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.json["token"].startswith("am1."))
            self.assertEqual(result.json["portal_url"], "https://asiet.etlab.app")
            factory.assert_called_once_with()
            self.assertEqual(session.post.call_args.kwargs["data"]["YII_CSRF_TOKEN"], "test-csrf")

    def test_upstream_timeouts_are_json_504(self):
        from requests.exceptions import Timeout
        for method, path in [("get", "/api/profile"), ("get", "/api/attendance?semester=5"),
                             ("get", "/api/timetable"), ("post", "/api/present?semester=5&month=9&year=2026"),
                             ("post", "/api/absent?semester=5&month=9&year=2026"), ("get", "/api/logout")]:
            with self.subTest(path=path), patch(f"requests.{method}", side_effect=Timeout):
                result = self.client.get(path, headers=self.auth)
                self.assertEqual(result.status_code, 504)
                self.assertTrue(result.is_json)

    def test_profile_and_attendance_handle_unexpected_html(self):
        for path in ["/api/profile", "/api/attendance?semester=5"]:
            with self.subTest(path=path), patch("requests.get", return_value=response("<html>Maintenance</html>")):
                result = self.client.get(path, headers=self.auth)
                self.assertEqual(result.status_code, 502)
                self.assertTrue(result.is_json)

    def test_login_form_without_title_is_detected_on_all_data_routes(self):
        html = '<form><input name="LoginForm[username]"></form>'
        for method, path in [("get", "/api/profile"), ("get", "/api/attendance?semester=5"),
                             ("get", "/api/timetable"), ("post", "/api/present?semester=5&month=9&year=2026"),
                             ("post", "/api/absent?semester=5&month=9&year=2026")]:
            with self.subTest(path=path), patch(f"requests.{method}", return_value=response(html)) as upstream:
                result = self.client.get(path, headers=self.auth)
                self.assertEqual(result.status_code, 401)
                self.assertEqual(upstream.call_args.kwargs["timeout"], Config.REQUEST_TIMEOUT)

    def test_logout_checks_login_form_and_has_timeout(self):
        html = '<form><input name="LoginForm[username]"></form>'
        with patch("requests.get", return_value=response(html)) as get:
            result = self.client.get("/api/logout", headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(get.call_args.kwargs["timeout"], Config.REQUEST_TIMEOUT)

    def test_monthly_unexpected_html_is_json_502(self):
        for route in ["present", "absent"]:
            with self.subTest(route=route), patch("requests.post", return_value=response("<html>Maintenance</html>")):
                result = self.client.get(f"/api/{route}?semester=5&month=9&year=2026", headers=self.auth)
                self.assertEqual(result.status_code, 502)

    def test_absent_endpoint_has_swagger_documentation(self):
        from index import app
        spec = app.test_client().get("/apispec_1.json")
        self.assertEqual(spec.status_code, 200)
        self.assertIn("/api/absent", spec.json["paths"])
