import http.client
import json
from pathlib import Path
import subprocess
import threading
import unittest
from unittest.mock import MagicMock, patch
import fusion


class Catalog(unittest.TestCase):
    def test_catalog_contract(self):
        self.assertTrue(callable(getattr(fusion, 'model_catalog', None)), 'Installed model catalog is missing')
        payload = {'models': [
            {'name': 'z:latest', 'size': 1073741824},
            {'name': fusion.DEFAULT_OLLAMA}, {'name': 'z:latest'},
            {'name': 'embed', 'capabilities': ['embedding']},
            {'name': 'both', 'capabilities': ['embedding', 'completion']},
            {'name': 'unknown'}, {'name': '<script>'}, {'name': 'x'*129},
            {'name': 'bad\nname'}, {}, None]}
        with patch('fusion.fetch_model_tags', return_value=payload):
            data = fusion.model_catalog()
        self.assertEqual([m['name'] for m in data['models']], ['both', fusion.DEFAULT_OLLAMA, 'unknown', 'z:latest'])
        self.assertEqual(data['default'], fusion.DEFAULT_OLLAMA)
        self.assertEqual(data['models'][-1]['size_label'], '1.0 GiB')
        with patch('fusion.fetch_model_tags', return_value={'models': [{'name': 'z'}, {'name': 'a'}]}):
            self.assertEqual(fusion.model_catalog()['default'], 'a')
        with patch('fusion.fetch_model_tags', return_value={'models': []}):
            self.assertEqual(fusion.model_catalog(), {'models': [], 'default': None})

    def test_transport_security_bounds_errors(self):
        self.assertTrue(callable(getattr(fusion, 'fetch_model_tags', None)), 'Secure tags fetch is missing')
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"models": []}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch('fusion.urllib.request.build_opener', return_value=opener) as build:
            self.assertEqual(fusion.fetch_model_tags(), {'models': []})
        self.assertEqual(build.call_args.args[0].proxies, {})
        self.assertIsInstance(build.call_args.args[1], fusion.NoRedirect)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:11434/api/tags')
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 5)
        response.read.assert_called_once_with(fusion.MAX_MODEL_RESPONSE + 1)
        for body in [b'x'*(fusion.MAX_MODEL_RESPONSE+1), b'bad-secret', b'{}', b'{"models": null}', b'\xff']:
            response.read.return_value = body
            with patch('fusion.urllib.request.build_opener', return_value=opener):
                with self.assertRaises(fusion.ProviderError) as caught:
                    fusion.fetch_model_tags()
            self.assertNotIn('secret', str(caught.exception))
        for error in [TimeoutError('secret'), OSError('secret'), fusion.ProviderError('secret redirect')]:
            opener.open.side_effect = error
            with patch('fusion.urllib.request.build_opener', return_value=opener):
                with self.assertRaisesRegex(fusion.ProviderError, '^Ollama model service unavailable\\.$'):
                    fusion.fetch_model_tags()

    def test_fork_default_port(self):
        self.assertEqual(fusion.make_server.__defaults__[0], 8766)


class Endpoint(unittest.TestCase):
    def test_models_endpoint_and_boundary(self):
        server = fusion.make_server(0, fusion.Jobs(lambda *args: 'ok'))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        def get(path='/api/models', headers=None):
            conn = http.client.HTTPConnection(*server.server_address, timeout=2)
            conn.request('GET', path, headers=headers or {})
            response = conn.getresponse()
            result = response.status, dict(response.getheaders()), json.loads(response.read())
            conn.close()
            return result
        try:
            expected = {'models': [], 'default': None, 'builders': [], 'providers': {}, 'default_builder': None}
            with patch('fusion.model_catalog', return_value={'models': [], 'default': None}), patch('fusion.builder_catalog', return_value=expected) as catalog:
                status, headers, data = get()
                self.assertEqual(status, 200, 'Models endpoint is missing')
                self.assertEqual(data, expected)
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertEqual(get(headers={'Host': 'evil.test'})[0], 403)
                self.assertEqual(get(headers={'Origin': 'https://evil.test'})[0], 403)
                self.assertEqual(get('/api/models?url=https://evil.test')[0], 400)
                self.assertEqual(catalog.call_count, 1)
            with patch('fusion.builder_catalog', side_effect=RuntimeError('secret internal body')):
                status, _, data = get()
                self.assertEqual(status, 503)
                self.assertEqual(data, {'error': 'Builder model catalog unavailable.'})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class UI(unittest.TestCase):
    def test_dropdown_markup(self):
        root = Path(__file__).parent
        html = (root/'static/index.html').read_text()
        self.assertRegex(html, r'<select[^>]*id="ollama-model"')
        self.assertIn('id="refresh-models"', html)
        self.assertIn('id="models-status"', html)
        self.assertEqual(html.count('class="panel"'), 4)
        self.assertIn('Cloud data disclosure', html)
        self.assertIn('id="builder-provider"', html)
        self.assertIn('id="builder-selection"', html)
        self.assertIn('xAI', html)
        self.assertIn('not ready', html)
        self.assertIn('billing', html)
        self.assertIn('input, select, textarea', (root/'static/style.css').read_text())

    def test_browser_behavior(self):
        result = subprocess.run(['node', 'test_models_ui.js'], cwd=Path(__file__).parent, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
