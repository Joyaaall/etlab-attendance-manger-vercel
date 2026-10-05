import unittest
from unittest.mock import patch

from app import create_app
from tests.test_api import response


# Synthetic portal fixtures, not account records.
CURRENT = '''<title>Attendance</title>
<select name="semester"><option value="5" selected>V</option></select>
<select name="month"><option value="9">Sep</option><option value="10" selected>Oct</option></select>
<select name="year"><option value="2026" selected>2026</option></select>
<table id="itsthetable"><tbody><tr><th>1 st</th>
<td class="present">ELEC522 - SYNTHETIC ELECTIVE<br>Topic not part of name</td>
<td class="absent">LAB507 - SYNTHETIC NETWORKS LAB</td>
<td>UNRELATED - No attendance class</td></tr></tbody></table>'''
PREVIOUS = '''<title>Attendance</title>
<select name="semester"><option value="5" selected>V</option></select>
<table id="itsthetable"><tbody><tr><th>1 st</th>
<td class="present">LAB508 - SYNTHETIC SYSTEMS LAB<br>Teacher</td>
<td class="present">ELEC522 - OLD LABEL</td>
<td class="present">PLT-TEST - SYNTHETIC TRAINING</td></tr></tbody></table>'''


class SubjectNameTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()
        self.auth = {"Authorization": "Bearer fixture-session"}

    def test_subject_names_require_auth_and_valid_semester(self):
        self.assertEqual(self.client.get('/api/subject-names?semester=5').status_code, 401)
        for value in ['', 'nine', '0', '9']:
            with self.subTest(value=value):
                self.assertEqual(self.client.get(f'/api/subject-names?semester={value}', headers=self.auth).status_code, 400)

    def test_names_use_present_absent_and_previous_month_without_topics(self):
        with patch('requests.get', return_value=response(CURRENT)) as get, patch('requests.post', return_value=response(PREVIOUS)) as post:
            result = self.client.get('/api/subject-names?semester=5', headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['subject_names'], {
            'ELEC522': 'SYNTHETIC ELECTIVE', 'LAB507': 'SYNTHETIC NETWORKS LAB',
            'LAB508': 'SYNTHETIC SYSTEMS LAB', 'PLT-TEST': 'SYNTHETIC TRAINING',
        })
        self.assertEqual(get.call_args.kwargs['cookies'], {'ASIETSESSIONID': 'fixture-session'})
        self.assertEqual(post.call_args.kwargs['data'], {'semester': 5, 'month': 9, 'year': 2026})
        self.assertIn('timeout', post.call_args.kwargs)

    def test_other_semester_names_are_not_reused(self):
        with patch('requests.get', return_value=response(CURRENT)), patch('requests.post', return_value=response(CURRENT)):
            result = self.client.get('/api/subject-names?semester=4', headers=self.auth)
        self.assertEqual(result.status_code, 502)

    def test_expired_and_malformed_pages_return_json_errors(self):
        for html, expected in [('<input name="LoginForm[username]">', 401), ('<html>Maintenance</html>', 502)]:
            with self.subTest(expected=expected), patch('requests.get', return_value=response(html)):
                result = self.client.get('/api/subject-names?semester=5', headers=self.auth)
                self.assertEqual(result.status_code, expected)
                self.assertTrue(result.is_json)

    def test_previous_month_failure_does_not_discard_current_names(self):
        from requests.exceptions import Timeout
        with patch('requests.get', return_value=response(CURRENT)), patch('requests.post', side_effect=Timeout):
            result = self.client.get('/api/subject-names?semester=5', headers=self.auth)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['subject_names']['LAB507'], 'SYNTHETIC NETWORKS LAB')
