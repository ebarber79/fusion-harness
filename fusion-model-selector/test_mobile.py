"""Offline mobile-access contracts. Production implementation awaits verified RED.

All URLs below are synthetic test fixtures, not deployment addresses.
Run: python3 -m unittest test_mobile -v
"""
import contextlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import fusion


@unittest.skip('Pending separate mobile-access feature; outside fourth-panel scope.')
class Mobile(unittest.TestCase):
    @contextlib.contextmanager
    def running(self, config=None):
        with tempfile.TemporaryDirectory() as home, patch.dict('os.environ', {'HOME': home}):
            if config is not None:
                path = Path(home) / '.config/fusion/mobile-url'
                path.parent.mkdir(parents=True)
                path.write_text(config)
            server = fusion.make_server(0, fusion.Jobs(lambda *args: 'offline fixture'))
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                self.assertEqual(server.server_address[0], '127.0.0.1')
                yield server.server_address[1]
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def request(self, port, path='/api/mobile', headers=None, method='GET', body=None):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_unset_is_unavailable_without_qr(self):
        with self.running() as port:
            status, headers, body = self.request(port)
            self.assertEqual(status, 200)
            data = json.loads(body)
            self.assertEqual(data['status'], 'unavailable')
            self.assertIsNone(data.get('url'))
            self.assertIsNone(data.get('qr'))
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(self.request(port, '/api/mobile/qr.svg')[0], 404)

    def test_valid_hosts_normalize_root(self):
        for config, expected in [
            ('https://fixture.ts.net', 'https://fixture.ts.net/'),
            ('https://fixture.tail-fixture.ts.net/\n', 'https://fixture.tail-fixture.ts.net/'),
            ('https://FIXTURE.tail-fixture.ts.net/', 'https://fixture.tail-fixture.ts.net/'),
        ]:
            with self.subTest(config=config), self.running(config) as port:
                status, _, body = self.request(port)
                self.assertEqual(status, 200)
                data = json.loads(body)
                self.assertEqual(data['status'], 'ready')
                self.assertEqual(data['url'], expected)
                self.assertEqual(data['qr'], '/api/mobile/qr.svg')

    def test_invalid_config_fails_closed_without_echo_or_qr(self):
        invalid = [
            '', 'http://fixture.ts.net/', 'https://example.com/',
            'https://ts.net/', 'https://fixture.ts.net.evil.test/',
            'https://user:secret@fixture.ts.net/', 'https://fixture.ts.net:443/',
            'https://fixture.ts.net:8443/', 'https://fixture.ts.net/path',
            'https://fixture.ts.net/?secret=value', 'https://fixture.ts.net/?',
            'https://fixture.ts.net/#secret', 'https://fixture.ts.net/#',
            'https://fixture.ts.net./', 'https://-fixture.ts.net/',
            'https://fixture-.ts.net/', 'https://bad_host.ts.net/',
            'https://fixture..ts.net/', 'https://*.ts.net/',
            'https://fixture%2ets.net/', 'https://fixture.ts.net\\@evil.test/',
            'https://fixture.ts.net/\nhttps://evil.ts.net/',
            'https://fixt\ture.ts.net/', 'https://fixt\nure.ts.net/',
            'https://' + 'a' * 64 + '.ts.net/', 'https://fíxture.ts.net/',
        ]
        for config in invalid:
            with self.subTest(config=repr(config)), self.running(config) as port:
                status, _, body = self.request(port)
                self.assertEqual(status, 200)
                data = json.loads(body)
                self.assertEqual(data['status'], 'unavailable')
                self.assertIsNone(data.get('url'))
                self.assertIsNone(data.get('qr'))
                self.assertNotIn('secret', body.decode().lower())
                self.assertEqual(self.request(port, '/api/mobile/qr.svg')[0], 404)
                self.assertEqual(self.request(port, headers={'Host': 'fixture.ts.net'})[0], 403)

    def test_exact_mobile_host_and_matching_https_origin_allowed(self):
        with self.running('https://fixture.tail-fixture.ts.net/') as port:
            host = 'fixture.tail-fixture.ts.net'
            for headers in [{'Host': host}, {'Host': host, 'Origin': 'https://' + host}]:
                self.assertEqual(self.request(port, headers=headers)[0], 200)
            # POST exercises the same CSRF boundary without ever starting a paid job.
            headers = {'Host': host, 'Origin': 'https://' + host, 'Content-Type': 'application/json'}
            self.assertEqual(self.request(port, '/api/run', headers, 'POST', '{}')[0], 400)

    def test_other_hosts_origins_and_forwarded_spoofs_denied(self):
        with self.running('https://fixture.tail-fixture.ts.net/') as port:
            host = 'fixture.tail-fixture.ts.net'
            bad = [
                {'Host': 'other.tail-fixture.ts.net'},
                {'Host': host + ':443'}, {'Host': host + '.evil.test'},
                {'Host': host, 'Origin': 'http://' + host},
                {'Host': host, 'Origin': 'https://other.tail-fixture.ts.net'},
                {'Host': host, 'Origin': 'https://' + host + ':443'},
                {'Host': host, 'Origin': 'https://' + host + '/'},
                {'Host': host, 'Origin': 'null'},
                {'Host': host, 'Origin': f'http://localhost:{port}'},
                {'Host': f'localhost:{port}', 'Origin': 'https://' + host},
                {'Host': host, 'Origin': 'https://' + host, 'Sec-Fetch-Site': 'cross-site'},
                {'Host': 'evil.test', 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https'},
                {'Host': 'evil.test', 'Forwarded': 'host=' + host + ';proto=https'},
                {'Host': host, 'Origin': 'https://evil.test', 'X-Forwarded-Host': host},
            ]
            for headers in bad:
                with self.subTest(headers=headers):
                    self.assertEqual(self.request(port, headers=headers)[0], 403)
                    post = dict(headers, **{'Content-Type': 'application/json'})
                    self.assertEqual(self.request(port, '/api/run', post, 'POST', '{}')[0], 403)
            self.assertEqual(self.request(port, headers={'Host': f'localhost:{port}',
                'Origin': f'http://localhost:{port}'})[0], 200)

    def test_local_svg_has_no_credential_or_external_reference(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'synthetic-openai-secret',
                                      'XAI_API_KEY': 'synthetic-xai-secret'}):
            with self.running('https://fixture.tail-fixture.ts.net/') as port:
                status, headers, body = self.request(port, '/api/mobile/qr.svg')
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Type'].split(';')[0], 'image/svg+xml')
                self.assertEqual(headers['Cache-Control'], 'no-store')
                svg = ET.fromstring(body)
                self.assertEqual(svg.tag, '{http://www.w3.org/2000/svg}svg')
                self.assertTrue(any(node.tag.endswith(('path', 'rect')) for node in svg.iter()))
                for node in svg.iter():
                    self.assertFalse(node.tag.endswith(('script', 'image', 'foreignObject')))
                    self.assertFalse(any('href' in key for key in node.attrib))
                for forbidden in [b'synthetic-openai-secret', b'synthetic-xai-secret', b'AuthURL',
                                  b'login.tailscale.com', b'api.qrserver.com']:
                    self.assertNotIn(forbidden, body)
                self.assertEqual(self.request(port, '/api/mobile/qr.svg?url=https://evil.test')[0], 400)
                self.assertEqual(self.request(port, '/api/mobile?url=https://evil.test')[0], 400)


@unittest.skip('Pending separate mobile-access feature; outside fourth-panel scope.')
class MobileMarkup(unittest.TestCase):
    def test_accessible_pending_panel_in_header(self):
        html = (Path(__file__).parent / 'static/index.html').read_text()
        header = html.split('<header', 1)[1].split('</header>', 1)[0]
        self.assertIn('id="mobile-panel"', header)
        self.assertIn('id="mobile-status"', header)
        self.assertIn('aria-live="polite"', header)
        self.assertIn('Mobile access unavailable', header)
        self.assertIn('Tailscale', header)
        self.assertIn('Add to Home Screen', header)
        self.assertIn('id="mobile-qr"', header)
        self.assertIn('hidden', header)
        self.assertNotIn('src="https://', header)
        self.assertEqual(html.count('class="panel"'), 3)


if __name__ == '__main__':
    unittest.main()
