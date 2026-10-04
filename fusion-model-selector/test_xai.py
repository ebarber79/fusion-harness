"""Offline xAI integration tests; only synthetic credentials and mocked transports."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch
import fusion

IDS = ['grok-code-fast-1', 'grok-4.3', 'grok-4.5', 'grok-4.6', 'grok-4.7',
       'grok-4.20-reasoning', 'grok-4.20-non-reasoning']

class XAI(unittest.TestCase):
    def setUp(self):
        self.pplx = patch('fusion.fetch_perplexity_models', side_effect=RuntimeError('offline'))
        self.pplx.start()
        self.addCleanup(self.pplx.stop)
    def test_key_sources_only_and_priority(self):
        self.assertTrue(callable(getattr(fusion, 'load_xai_key', None)), 'xAI key loader missing')
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'HOME': d}, clear=True):
            path = Path(d)/'.config/fusion/xai.key'
            path.parent.mkdir(parents=True)
            path.write_text('synthetic-file\n')
            self.assertEqual(fusion.load_xai_key(), 'synthetic-file')
            with patch.dict(os.environ, {'XAI_API_KEY': 'synthetic-env'}):
                self.assertEqual(fusion.load_xai_key(), 'synthetic-env')
            for key in ['bad key', 'x'*4097]:
                with patch.dict(os.environ, {'XAI_API_KEY': key}), self.assertRaises(fusion.ProviderError):
                    fusion.load_xai_key()
            path.unlink()
            hermes = Path(d)/'.hermes/.env'
            hermes.parent.mkdir()
            hermes.write_text('XAI_API_KEY=must-not-load\n')
            with self.assertRaises(fusion.ProviderError):
                fusion.load_xai_key()

    def test_chat_payload_and_active_key_redaction(self):
        calls = []
        def send(*args):
            calls.append(args)
            return {'choices': [{'message': {'content': 'echo synthetic-key'}, 'finish_reason': 'stop'}]}
        with patch.dict(os.environ, {'XAI_API_KEY': 'synthetic-key'}, clear=True):
            output = fusion.Provider(send)('xai', 'grok-code-fast-1', 'system', 'request')
        self.assertEqual(output, 'echo [REDACTED]')
        url, payload, headers, timeout = calls[0]
        self.assertEqual(url, 'https://api.x.ai/v1/chat/completions')
        self.assertEqual(payload, {'model': 'grok-code-fast-1', 'messages': [
            {'role': 'system', 'content': 'system'}, {'role': 'user', 'content': 'request'}],
            'stream': False, 'max_tokens': 4000})
        self.assertEqual(headers, {'Authorization': 'Bearer synthetic-key'})
        self.assertEqual(timeout, 180)

    def test_provider_error_and_malformed_output_sanitized(self):
        for result in [RuntimeError('synthetic-key upstream'), {}, {'choices': []},
                       {'choices': [{'message': {'content': None}}]}]:
            def send(*args):
                if isinstance(result, Exception):
                    raise result
                return result
            with patch.dict(os.environ, {'XAI_API_KEY': 'synthetic-key'}, clear=True):
                with self.assertRaises(fusion.ProviderError) as caught:
                    fusion.Provider(send)('xai', 'grok-4.3', 'system', 'request')
            self.assertNotIn('synthetic-key', str(caught.exception))

    def test_qualified_builder_routing_and_stage_metadata(self):
        for selected, provider, model in [('xai:grok-4.3', 'xai', 'grok-4.3'),
                                          ('qwen:latest', 'ollama', 'qwen:latest'),
                                          ('ollama:qwen:latest', 'ollama', 'qwen:latest')]:
            calls = []
            jobs = fusion.Jobs(lambda *args: calls.append(args) or 'ok')
            jid = jobs.start({'prompt': 'task', 'ollama_model': selected})
            for _ in range(200):
                job = jobs.snapshot(jid)
                if job['status'] != 'running':
                    break
                time.sleep(.005)
            self.assertEqual([c[0] for c in calls], ['openai', provider, 'openai', 'openai'])
            self.assertEqual(calls[1][1], model)
            self.assertEqual(job['config']['ollama_model'], selected)
            self.assertEqual(job['stages'][1]['provider'], provider)
            self.assertEqual(job['stages'][1]['model'], model)

    def test_reject_unsupported_xai_builder_ids(self):
        for model in ['xai:', 'xai:grok-imagine', 'xai:grok-voice', 'xai:grok-4.20-multi-agent', 'xai:not-grok']:
            with self.assertRaises(ValueError, msg=model):
                fusion.validate_request({'prompt': 'task', 'ollama_model': model})

    def test_secure_bounded_catalog_and_redaction(self):
        self.assertTrue(callable(getattr(fusion, 'fetch_xai_models', None)), 'xAI catalog missing')
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"data": []}'
        opener = MagicMock()
        opener.open.return_value = response
        with patch('fusion.load_xai_key', return_value='synthetic-key'), patch('fusion.urllib.request.build_opener', return_value=opener) as build:
            self.assertEqual(fusion.fetch_xai_models(), {'data': []})
            self.assertEqual(build.call_args.args[0].proxies, {})
            self.assertIsInstance(build.call_args.args[1], fusion.NoRedirect)
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.x.ai/v1/models')
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-key')
            self.assertEqual(opener.open.call_args.kwargs['timeout'], 5)
            response.read.assert_called_once_with(fusion.MAX_MODEL_RESPONSE + 1)
            for body in [b'x'*(fusion.MAX_MODEL_RESPONSE+1), b'synthetic-key', b'{}', b'{"data": null}']:
                response.read.return_value = body
                with self.assertRaises(fusion.ProviderError) as caught:
                    fusion.fetch_xai_models()
                self.assertNotIn('synthetic-key', str(caught.exception))
            for error in [TimeoutError('synthetic-key'), fusion.ProviderError('synthetic-key redirect')]:
                opener.open.side_effect = error
                with self.assertRaises(fusion.ProviderError) as caught:
                    fusion.fetch_xai_models()
                self.assertNotIn('synthetic-key', str(caught.exception))

    def test_combined_catalog_filters_text_and_preserves_local_contract(self):
        self.assertTrue(callable(getattr(fusion, 'builder_catalog', None)), 'Combined catalog missing')
        ids = IDS + ['grok-imagine', 'grok-image', 'grok-video', 'grok-voice', 'grok-tts',
                     'grok-transcribe', 'grok-4.20-multi-agent', '<script>', 'other']
        with patch('fusion.model_catalog', return_value={'models': [{'name': 'local', 'size': 1}], 'default': 'local'}), patch('fusion.fetch_xai_models', return_value={'data': [{'id': i} for i in ids] + [{'id': 'grok-4.3'}, None]}):
            data = fusion.builder_catalog()
        self.assertEqual(data['models'], [{'name': 'local', 'size': 1}])
        self.assertEqual(data['default'], 'local')
        cloud = [m for m in data['builders'] if m['provider'] == 'xai']
        self.assertEqual(sorted(m['name'] for m in cloud), sorted(IDS))
        self.assertTrue(all(m['verified'] and m['selectable'] and m['value'] == 'xai:'+m['name'] for m in cloud))
        self.assertEqual(data['providers']['xai']['status'], 'available')

    def test_independent_provider_failures_and_honest_fallback(self):
        self.assertTrue(callable(getattr(fusion, 'builder_catalog', None)), 'Combined catalog missing')
        for local_fails, cloud_fails in [(False, True), (True, False), (True, True)]:
            with patch('fusion.model_catalog', side_effect=RuntimeError('synthetic-key') if local_fails else None, return_value={'models': [{'name': 'local'}], 'default': 'local'}), patch('fusion.fetch_xai_models', side_effect=RuntimeError('synthetic-key') if cloud_fails else None, return_value={'data': [{'id': 'grok-4.3'}]}):
                data = fusion.builder_catalog()
            self.assertNotIn('synthetic-key', json.dumps(data))
            self.assertEqual(data['providers']['ollama']['status'], 'unavailable' if local_fails else 'available')
            self.assertEqual(data['providers']['xai']['status'], 'unverified' if cloud_fails else 'available')
            cloud = [m for m in data['builders'] if m['provider'] == 'xai']
            if cloud_fails:
                self.assertEqual([m['name'] for m in cloud], IDS)
                self.assertTrue(all(not m['verified'] and not m['selectable'] and m['status'] == 'unverified' for m in cloud))
                self.assertTrue(all(m['source'] == 'https://docs.x.ai/developers/models' for m in cloud))
            else:
                self.assertTrue(cloud[0]['selectable'])
            self.assertEqual(data['default'], None if local_fails else 'local')

    def test_hidden_setup_reuses_private_storage(self):
        self.assertIsNotNone(importlib.util.find_spec('setup_xai_key'), 'xAI setup script missing')
        import setup_xai_key
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'HOME': d}, clear=True), patch('setup_xai_key.getpass.getpass', return_value='synthetic-setup'), patch('builtins.print') as output:
            self.assertEqual(setup_xai_key.main(), 0)
            path = Path(d)/'.config/fusion/xai.key'
            self.assertEqual(path.read_text(), 'synthetic-setup\n')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            self.assertNotIn('synthetic-setup', str(output.call_args_list))
        with patch('setup_xai_key.getpass.getpass', side_effect=EOFError), patch('setup_xai_key.store_key') as store, patch('builtins.print'):
            self.assertEqual(setup_xai_key.main(), 1)
            store.assert_not_called()

if __name__ == '__main__':
    unittest.main()
