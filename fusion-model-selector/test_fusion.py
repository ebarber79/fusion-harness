import copy
import http.client
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


class Availability(unittest.TestCase):
    def test_implementation_exists(self):
        self.assertIsNotNone(importlib.util.find_spec('fusion'), 'Fusion implementation is missing')


if importlib.util.find_spec('fusion'):
    import fusion

    class Core(unittest.TestCase):
        def wait(self, jobs, jid):
            for _ in range(300):
                result = jobs.snapshot(jid)
                if result['status'] != 'running':
                    return result
                time.sleep(.01)
            self.fail('job timed out')

        def test_sequence_and_context(self):
            calls = []
            def provider(*args):
                calls.append(args)
                return ['ARCH', 'BUILD', 'FINAL', 'ANALYSIS'][len(calls)-1]
            jobs = fusion.Jobs(provider)
            result = self.wait(jobs, jobs.start({'prompt': 'TASK'}))
            self.assertEqual([c[0] for c in calls], ['openai', 'ollama', 'openai', 'openai'])
            self.assertIn('ARCH', calls[1][3])
            self.assertIn('ARCH', calls[2][3])
            self.assertIn('BUILD', calls[2][3])
            self.assertEqual([s['output'] for s in result['stages']], ['ARCH', 'BUILD', 'FINAL', 'ANALYSIS'])
            self.assertEqual(result['status'], 'completed')
            result['stages'][0]['output'] = 'changed'
            self.assertEqual(jobs.snapshot(result['id'])['stages'][0]['output'], 'ARCH')

        def test_each_failure_preserves_other_outputs_and_hides_exception(self):
            for failed in range(4):
                calls = []
                def provider(*args):
                    calls.append(args)
                    if len(calls)-1 == failed:
                        raise RuntimeError('secret-key-should-never-appear')
                    return 'output-' + str(len(calls))
                jobs = fusion.Jobs(provider)
                result = self.wait(jobs, jobs.start({'prompt': 'TASK'}))
                self.assertEqual(len(calls), 4)
                self.assertEqual(result['status'], 'partial_failure')
                self.assertEqual(result['stages'][failed]['status'], 'error')
                self.assertNotIn('secret-key', json.dumps(result))
                self.assertEqual(sum(s['status'] == 'completed' for s in result['stages']), 3)
                if failed < 3:
                    self.assertIn('unavailable', calls[failed+1][3])

        def test_validation(self):
            valid = fusion.validate_request({'prompt': ' hello '})
            self.assertEqual(valid['openai_model'], 'gpt-5.5')
            self.assertEqual(valid['ollama_model'], 'qwen2.5-coder:0.5b')
            for payload in [None, [], {}, {'prompt': ''}, {'prompt': 5}, {'prompt': 'x'*12001},
                            {'prompt': 'x', 'endpoint': 'http://evil'},
                            {'prompt': 'x', 'openai_model': 'x\ny'},
                            {'prompt': 'x', 'ollama_model': 'x'*129}]:
                with self.subTest(payload=str(payload)[:80]), self.assertRaises(ValueError):
                    fusion.validate_request(payload)

        def test_single_run_bounded_state(self):
            entered, release = threading.Event(), threading.Event()
            def provider(*args):
                entered.set()
                release.wait(2)
                return 'x'
            jobs = fusion.Jobs(provider)
            first = jobs.start({'prompt': 'one'})
            self.assertTrue(entered.wait(1))
            with self.assertRaises(fusion.BusyError):
                jobs.start({'prompt': 'two'})
            release.set()
            self.wait(jobs, first)
            second = jobs.start({'prompt': 'two'})
            self.wait(jobs, second)
            self.assertIsNone(jobs.snapshot(first))
            self.assertEqual(jobs.snapshot()['id'], second)

        def test_oversized_output_is_bounded(self):
            jobs = fusion.Jobs(lambda *args: 'x'*200001)
            result = self.wait(jobs, jobs.start({'prompt': 'x'}))
            self.assertLessEqual(len(json.dumps(result)), 610000)

    class HTTP(unittest.TestCase):
        @classmethod
        def setUpClass(cls):
            cls.server = fusion.make_server(0, fusion.Jobs(lambda *args: 'ok'))
            cls.port = cls.server.server_address[1]
            cls.thread = threading.Thread(target=cls.server.serve_forever)
            cls.thread.start()

        @classmethod
        def tearDownClass(cls):
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join()

        def request(self, method='GET', path='/api/job', body=None, headers=None):
            c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
            c.request(method, path, body=body, headers=headers or {})
            r = c.getresponse()
            result = r.status, dict(r.getheaders()), r.read()
            c.close()
            return result

        def test_hosts_origins_content_type(self):
            for headers in [{'Host': 'evil.test'}, {'Origin': 'https://evil.test'},
                            {'Host': f'localhost:{self.port}', 'Origin': f'http://127.0.0.1:{self.port}'}]:
                self.assertEqual(self.request(headers=headers)[0], 403)
            self.assertEqual(self.request('POST', '/api/run', '{}', {'Content-Type': 'text/plain'})[0], 415)
            self.assertEqual(self.request('POST', '/api/run', '{', {'Content-Type': 'application/json'})[0], 400)
            self.assertEqual(self.request('POST', '/api/run', '{}', {'Content-Type': 'application/json', 'Content-Length': '999999'})[0], 413)
            self.assertEqual(self.request('POST', '/api/run', '{}', {'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked'})[0], 400)

        def test_api_and_routes(self):
            status, headers, body = self.request('POST', '/api/run', json.dumps({'prompt': 'hello'}), {'Content-Type': 'application/json'})
            self.assertEqual(status, 202)
            jid = json.loads(body)['id']
            self.assertEqual(self.request(path='/api/job?id='+jid)[0], 200)
            self.assertEqual(self.request(path='/api/job?id=missing')[0], 404)
            self.assertEqual(self.request(path='/../setup_key.py')[0], 404)
            self.assertEqual(self.request(path='/')[0], 200)
            self.assertIn("default-src 'self'", headers['Content-Security-Policy'])
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(self.request('OPTIONS')[0], 405)

    class Providers(unittest.TestCase):
        def test_fixed_payloads(self):
            calls = []
            def transport(url, payload, headers, timeout):
                calls.append((url, payload, headers, timeout))
                if 'openai.com' in url:
                    return {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'cloud'}]}]}
                return {'response': 'local', 'done': True}
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'fake-key'}):
                p = fusion.Provider(transport)
                self.assertEqual(p('openai', 'gpt-5.5', 'system', 'prompt'), 'cloud')
                self.assertEqual(p('ollama', 'qwen2.5-coder:1.5b', 'system', 'prompt'), 'local')
            self.assertEqual(calls[0][0], 'https://api.openai.com/v1/responses')
            self.assertEqual(calls[0][2]['Authorization'], 'Bearer fake-key')
            self.assertFalse(calls[0][1]['store'])
            self.assertEqual(calls[1][0], 'http://127.0.0.1:11434/api/generate')
            self.assertEqual(calls[1][1]['options'], {'num_ctx': 4096, 'num_predict': 1500})

        def test_key_file_fallback_and_environment_priority(self):
            with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'HOME': d}, clear=True):
                path = Path(d)/'.config/fusion/openai.key'
                path.parent.mkdir(parents=True)
                path.write_text('file-key\n')
                self.assertEqual(fusion.load_key(), 'file-key')
                with patch.dict(os.environ, {'OPENAI_API_KEY': 'environment-key'}):
                    self.assertEqual(fusion.load_key(), 'environment-key')
                path.unlink()
                with self.assertRaises(fusion.ProviderError):
                    fusion.load_key()

        def test_provider_errors_do_not_expose_key(self):
            def failing(*args):
                raise RuntimeError('Authorization: Bearer fake-secret')
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'fake-secret'}):
                with self.assertRaises(fusion.ProviderError) as caught:
                    fusion.Provider(failing)('openai', 'test', 'instructions', 'prompt')
            self.assertNotIn('fake-secret', str(caught.exception))

        def test_provider_text_redacts_active_key(self):
            def send(*args):
                return {'output': [{'type': 'message', 'content': [
                    {'type': 'output_text', 'text': 'echo fake-secret'}]}]}
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'fake-secret'}):
                output = fusion.Provider(send)('openai', 'test', 'instructions', 'prompt')
            self.assertNotIn('fake-secret', output)
            self.assertIn('[REDACTED]', output)

        def test_transport_response_bound_and_proxy_disabling(self):
            from unittest.mock import MagicMock
            response = MagicMock()
            response.__enter__.return_value = response
            response.read1.side_effect = [b'x' * min(65536, fusion.MAX_RESPONSE + 1 - offset) for offset in range(0, fusion.MAX_RESPONSE + 1, 65536)]
            opener = MagicMock()
            opener.open.return_value = response
            with patch('fusion.urllib.request.build_opener', return_value=opener) as build:
                with self.assertRaises(fusion.ProviderError):
                    fusion.transport('http://127.0.0.1:11434/api/generate', {}, {}, 1)
            self.assertEqual(build.call_args.args[0].proxies, {})
            self.assertEqual(sum(call.args[0] for call in response.read1.call_args_list), fusion.MAX_RESPONSE + 1)
            self.assertTrue(all(0 < call.args[0] <= 65536 for call in response.read1.call_args_list))

        def test_redirects_rejected(self):
            with self.assertRaises(fusion.ProviderError):
                fusion.NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://evil.test')

    class KeySetup(unittest.TestCase):
        def test_private_key_file(self):
            import setup_key
            with tempfile.TemporaryDirectory() as d:
                path = Path(d)/'fusion/openai.key'
                setup_key.store_key('dummy-test-key', path)
                self.assertEqual(path.read_text(), 'dummy-test-key\n')
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
                setup_key.store_key('replacement', path)
                self.assertEqual(path.read_text(), 'replacement\n')
                with self.assertRaises(ValueError):
                    setup_key.store_key('bad\nkey', path)

    class UI(unittest.TestCase):
        def test_static_contract(self):
            root = Path(__file__).parent/'static'
            html = (root/'index.html').read_text()
            js = (root/'app.js').read_text()
            css = (root/'style.css').read_text()
            self.assertIn('OpenAI', html)
            self.assertIn('cloud', html.lower())
            self.assertEqual(html.count('class="panel"'), 4)
            self.assertIn('textContent', js)
            self.assertNotIn('innerHTML', js)
            self.assertIn('/api/job', js)
            self.assertIn('repeat(2', css)


if __name__ == '__main__':
    unittest.main()
