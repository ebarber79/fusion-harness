"""OpenAI architect suite: synthetic credentials, offline catalog and generation."""
import io
import json
import time
import unittest
from unittest.mock import MagicMock, patch
import fusion

TEXT = ['gpt-4o', 'gpt-4o-mini-2024-07-18', 'gpt-4.1', 'gpt-4.5-preview', 'gpt-5.5', 'gpt-5-codex', 'o1', 'o3-mini', 'o4-mini', 'codex-mini-latest']
OTHER = ['text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3', 'gpt-image-1', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-4o-transcribe', 'gpt-4o-mini-tts', 'omni-moderation-latest', 'babbage-002', 'davinci-002', 'gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'o1-preview', 'o1-preview-2024-09-12', 'o1-mini', 'o1-mini-2024-09-12', 'o3-deep-research', 'gpt-4o-search-preview', 'gpt-5-search-api', 'chatgpt-4o-latest', 'gpt-oss-120b', 'ft:gpt-4o:secret', 'gpt-5/evil', 'gpt-5-synthetic-key', '<script>', 'unknown-new-model']

class OpenAICatalog(unittest.TestCase):
    def setUp(self):
        for name in ['load_key', 'load_anthropic_key', 'load_xai_key', 'load_perplexity_key']:
            mock = patch('fusion.' + name, side_effect=AssertionError('real credential access forbidden'))
            mock.start()
            self.addCleanup(mock.stop)

    def fetch(self, data):
        response = MagicMock()
        response.__enter__.return_value = response
        stream = io.BytesIO(data if isinstance(data, bytes) else json.dumps(data).encode())
        response.read1.side_effect = stream.read
        opener = MagicMock()
        opener.open.return_value = response
        with patch('fusion.load_key', return_value='synthetic-key'), patch('fusion.urllib.request.build_opener', return_value=opener) as build:
            result = fusion.fetch_openai_models()
        self.assertEqual(build.call_args.args[0].proxies, {})
        self.assertIsInstance(build.call_args.args[1], fusion.NoRedirect)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.openai.com/v1/models')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-key')
        self.assertLessEqual(opener.open.call_args.kwargs['timeout'], 5)
        self.assertEqual(opener.open.call_count, 1)
        return result

    def test_authenticated_bounded_filtered_catalog(self):
        result = self.fetch({'data': [{'id': name} for name in TEXT + OTHER + TEXT] + [None, {'id': 1}]})
        self.assertEqual(result, {'data': [{'id': name} for name in sorted(TEXT)]})
        for body in [b'invalid synthetic-key', {}, {'data': {}}, b' ' * (fusion.MAX_MODEL_RESPONSE + 1), {'data': [{}] * 2001}]:
            with self.subTest(body=str(body)[:30]), self.assertRaises(fusion.ProviderError) as caught:
                self.fetch(body)
            self.assertNotIn('synthetic-key', str(caught.exception))

    def test_failures_and_wall_deadline_sanitized(self):
        for error in [RuntimeError('synthetic-key upstream body'), fusion.ProviderError('redirect secret')]:
            with patch('fusion.load_key', return_value='synthetic-key'), patch('fusion.urllib.request.build_opener', side_effect=error), self.assertRaises(fusion.ProviderError) as caught:
                fusion.fetch_openai_models()
            self.assertNotIn('secret', str(caught.exception))
            self.assertNotIn('synthetic-key', str(caught.exception))
        with patch('fusion.load_key', return_value='synthetic-key'), patch('fusion.time.monotonic', side_effect=[0, 11]), self.assertRaises(fusion.ProviderError):
            self.fetch({'data': []})
        with self.assertRaises(fusion.ProviderError):
            fusion.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test')

    def catalog(self, openai):
        with patch('fusion.model_catalog', side_effect=RuntimeError), patch('fusion.fetch_xai_models', side_effect=RuntimeError), patch('fusion.fetch_perplexity_models', side_effect=RuntimeError), patch('fusion.fetch_anthropic_models', return_value={'data': [{'id':'claude-test'}]}), patch('fusion.fetch_openai_models', **openai, create=True):
            return fusion.builder_catalog()

    def test_catalog_independence_and_no_invented_ids(self):
        data = self.catalog({'return_value': {'data': [{'id':'o3'}, {'id':'gpt-4o'}, {'id':'whisper-1'}]}})
        self.assertEqual([m['value'] for m in data['architects']], ['openai:default', 'openai:gpt-4o', 'openai:o3', 'anthropic:claude-test'])
        self.assertTrue(all(m['selectable'] for m in data['architects']))
        self.assertEqual(data['providers']['openai']['status'], 'available')
        data = self.catalog({'side_effect': RuntimeError('credential-secret')})
        self.assertEqual([m['value'] for m in data['architects']], ['openai:default', 'anthropic:claude-test'])
        self.assertNotIn('credential-secret', str(data))
        self.assertEqual(data['providers']['openai']['status'], 'unavailable')

    def test_default_choice_preserved_for_restoration(self):
        config = fusion.validate_request({'prompt':'task', 'openai_model':'synth', 'architect_model':'openai:default'})
        self.assertEqual(config['architect_model'], 'openai:default')

    def test_routing_validation_legacy_and_explicit_fallback(self):
        for name in ['gpt-image-1', 'gpt-4o-audio-preview', 'text-embedding-3-small', 'o3-deep-research', 'gpt-4o-search-preview']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                fusion.validate_request({'prompt':'task', 'architect_model':'openai:' + name})
        for selected, expected in [('openai:o3', 'o3'), ('openai:default', 'synth'), (None, 'synth'), ('openai:custom', 'custom')]:
            calls = []
            def send(*args):
                calls.append(args)
                if len(calls) == 1:
                    raise fusion.ProviderError('secret')
                return 'visible output'
            request = {'prompt':'task', 'openai_model':'synth', 'architect_fallback_enabled':True, 'architect_fallback_model':'anthropic:claude-test'}
            if selected is not None: request['architect_model'] = selected
            with patch('fusion.fetch_anthropic_models', return_value={'data':[{'id':'claude-test'}]}):
                jobs = fusion.Jobs(send)
                jid = jobs.start(request)
                for _ in range(500):
                    job = jobs.snapshot(jid)
                    if job['status'] != 'running': break
                    time.sleep(.001)
            self.assertEqual([(c[0], c[1]) for c in calls], [('openai', expected), ('anthropic', 'claude-test'), ('ollama', fusion.DEFAULT_OLLAMA), ('openai','synth'), ('openai','synth')])
            self.assertEqual(calls[0][3], calls[1][3])
            self.assertTrue(job['stages'][0]['fallback_used'])
            self.assertEqual(job['stages'][0]['original_model'], expected)
            self.assertEqual(job['status'], 'completed')

if __name__ == '__main__': unittest.main()
