import json
import os
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup

from app import create_app


class SearchDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def test_home_has_canonical_metadata_and_public_content_without_javascript(self):
        response = self.client.get('/')
        soup = BeautifulSoup(response.data, 'html.parser')
        self.assertEqual(soup.title.string, 'Collegeil Pono | Etlab Attendance Manager')
        self.assertEqual(soup.find('link', rel='canonical')['href'], 'https://collegepono.vercel.app/')
        self.assertIn('index', soup.find('meta', attrs={'name': 'robots'})['content'])
        self.assertNotIn('X-Robots-Tag', response.headers)
        public = soup.find(id='public-info')
        self.assertFalse(public.has_attr('hidden'))
        self.assertIn('Etlab attendance manager', public.get_text())
        self.assertIn('not an official Etlab', public.get_text())
        data = json.loads(soup.find('script', type='application/ld+json').string)
        self.assertEqual([item['@type'] for item in data['@graph']], ['WebSite', 'SoftwareApplication'])
        self.assertEqual(data['@graph'][0]['url'], 'https://collegepono.vercel.app/')

    def test_robots_allows_home_and_assets_and_declares_sitemap(self):
        response = self.client.get('/robots.txt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/plain')
        robots = RobotFileParser()
        robots.parse(response.get_data(as_text=True).splitlines())
        self.assertTrue(robots.can_fetch('Googlebot', '/'))
        self.assertTrue(robots.can_fetch('Googlebot', '/static/dashboard.mjs'))
        self.assertFalse(robots.can_fetch('Googlebot', '/api/profile'))
        self.assertEqual(robots.site_maps(), ['https://collegepono.vercel.app/sitemap.xml'])

    def test_sitemap_lists_only_public_canonical_home(self):
        response = self.client.get('/sitemap.xml')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/xml')
        root = ET.fromstring(response.data)
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        self.assertEqual([loc.text for loc in root.findall('s:url/s:loc', ns)], ['https://collegepono.vercel.app/'])

    def test_verification_is_optional_and_escaped(self):
        with patch.dict(os.environ, {'GOOGLE_SITE_VERIFICATION': ''}):
            self.assertNotIn('google-site-verification', self.client.get('/').get_data(as_text=True))
        with patch.dict(os.environ, {'GOOGLE_SITE_VERIFICATION': 'test-verification-value'}):
            soup = BeautifulSoup(self.client.get('/').data, 'html.parser')
            self.assertEqual(soup.find('meta', attrs={'name': 'google-site-verification'})['content'], 'test-verification-value')
        with patch.dict(os.environ, {'GOOGLE_SITE_VERIFICATION': '\"><script>bad</script>'}):
            self.assertNotIn('<script>bad</script>', self.client.get('/').get_data(as_text=True))

    def test_api_responses_are_not_indexable(self):
        response = self.client.get('/api/profile')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers['X-Robots-Tag'], 'noindex, nofollow')


if __name__ == '__main__':
    unittest.main()
