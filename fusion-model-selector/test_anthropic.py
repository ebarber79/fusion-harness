"""Anthropic architect contracts: synthetic keys and offline transports only."""
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch
import fusion

MODEL = 'claude-test-1'
CATALOG = {'data': [{'id': MODEL}]}

class Anthropic(unittest.TestCase):
    def setUp(self):
        mock = patch('fusion.fetch_openai_models', side_effect=RuntimeError('offline'))
        mock.start()
        self.addCleanup(mock.stop)

    def test_key_precedence_and_validation(self):
        self.assertTrue(callable(getattr(fusion, 'load_anthropic_key', None)))
        with tempfile.TemporaryDirectory() as home, patch('fusion.Path.home', return_value=Path(home)), patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(fusion.ProviderError): fusion.load_anthropic_key()
            path = Path(home)/'.config/fusion/anthropic.key'
            from setup_key import store_key
            store_key('file-test-key', path)
            self.assertEqual(fusion.load_anthropic_key(), 'file-test-key')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'env-test-key'}):
                self.assertEqual(fusion.load_anthropic_key(), 'env-test-key')
            for bad in ['bad key', 'x'*4097, 'bad\x00key']:
                # NUL cannot be inserted into the OS environment; inject the loader lookup.
                with patch('fusion.os.environ.get', return_value=bad), self.assertRaises(fusion.ProviderError): fusion.load_anthropic_key()

    def test_setup_hidden_safe_storage(self):
        import setup_anthropic_key as setup
        with tempfile.TemporaryDirectory() as home, patch('setup_anthropic_key.Path.home', return_value=Path(home)), patch('setup_anthropic_key.getpass.getpass', return_value='synthetic-key'):
            self.assertEqual(setup.main(), 0)
            self.assertEqual((Path(home)/'.config/fusion/anthropic.key').stat().st_mode & 0o777, 0o600)
        with patch('setup_anthropic_key.getpass.getpass', side_effect=setup.getpass.GetPassWarning), patch('setup_anthropic_key.store_key') as store:
            self.assertEqual(setup.main(), 1)
            store.assert_not_called()

    def test_setup_rejects_control_characters_without_writing(self):
        import setup_anthropic_key as setup
        for control in ['\x00', '\x01', '\x1f', '\x7f']:
            with self.subTest(control=repr(control)), tempfile.TemporaryDirectory() as home, \
                    patch('setup_anthropic_key.Path.home', return_value=Path(home)), \
                    patch('setup_anthropic_key.getpass.getpass', return_value='synthetic'+control+'key'), \
                    patch('setup_anthropic_key.store_key') as store, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                self.assertEqual(setup.main(), 1)
                store.assert_not_called()
                self.assertFalse((Path(home)/'.config').exists())
                self.assertNotIn('synthetic', output.getvalue())
                self.assertIn('Key setup failed', output.getvalue())

    def fetch(self, pages):
        opener = MagicMock()
        responses = []
        for page in pages:
            response = MagicMock()
            response.__enter__.return_value = response
            body = page if isinstance(page, bytes) else json.dumps(page).encode()
            stream = io.BytesIO(body)
            response.read1.side_effect = stream.read
            responses.append(response)
        opener.open.side_effect = responses
        with patch('fusion.load_anthropic_key', return_value='synthetic-key', create=True), patch('fusion.urllib.request.build_opener', return_value=opener) as build:
            result = fusion.fetch_anthropic_models()
        self.assertEqual(build.call_args.args[0].proxies, {})
        self.assertIsInstance(build.call_args.args[1], fusion.NoRedirect)
        for call in opener.open.call_args_list:
            req = call.args[0]
            self.assertEqual(req.get_method(), 'GET')
            self.assertEqual(req.get_header('X-api-key'), 'synthetic-key')
            self.assertEqual(req.get_header('Anthropic-version'), '2023-06-01')
            self.assertLessEqual(call.kwargs['timeout'], 10)
        return result, opener

    def test_catalog_pagination_security(self):
        self.assertTrue(callable(getattr(fusion, 'fetch_anthropic_models', None)))
        result, opener = self.fetch([{'data':[{'id':MODEL}, {'id':'gpt-other'}, {'id':'claude-synthetic-key'}], 'has_more':True, 'last_id':MODEL}, {'data':[{'id':'claude-test-2'}, {'id':MODEL}], 'has_more':False}])
        self.assertEqual(result, {'data':[{'id':MODEL}, {'id':'claude-test-2'}]})
        self.assertEqual(opener.open.call_args_list[0].args[0].full_url, 'https://api.anthropic.com/v1/models')
        self.assertEqual(opener.open.call_args_list[1].args[0].full_url, 'https://api.anthropic.com/v1/models?after_id='+MODEL)
        bad_pages = [[b'bad secret'], [{'data':[], 'has_more':'yes'}], [{'data':[], 'has_more':True, 'last_id':'https://evil'}], [{'data':[{'id':MODEL}], 'has_more':True, 'last_id':MODEL}]*6, [{'data':[{'id':MODEL}]*501, 'has_more':False}], [b' '*(1024*1024+1)]]
        for pages in bad_pages:
            with self.subTest(pages=str(pages)[:60]), self.assertRaises(fusion.ProviderError) as caught: self.fetch(pages)
            self.assertNotIn('secret', str(caught.exception))
        with patch('fusion.load_anthropic_key', return_value='synthetic-key'), patch('fusion.time.monotonic', side_effect=[0, 11]), self.assertRaises(fusion.ProviderError): fusion.fetch_anthropic_models()

    def test_verified_only_architect_no_builder(self):
        with patch('fusion.fetch_anthropic_models', return_value=CATALOG, create=True):
            self.assertEqual(fusion.validate_request({'prompt':'task', 'architect_model':'anthropic:'+MODEL})['architect_model'], 'anthropic:'+MODEL)
            for value in ['anthropic:claude-guessed', 'anthropic:claude-image-1']:
                with self.assertRaises(ValueError): fusion.validate_request({'prompt':'task', 'architect_model':value})
        with self.assertRaises(ValueError): fusion.validate_request({'prompt':'task', 'ollama_model':'anthropic:'+MODEL})
        with patch('fusion.fetch_anthropic_models', side_effect=RuntimeError('secret'), create=True):
            with self.assertRaises(ValueError): fusion.validate_request({'prompt':'task', 'architect_model':'anthropic:'+MODEL})
            self.assertEqual(fusion.validate_request({'prompt':'task'})['openai_model'], fusion.DEFAULT_OPENAI)

    def test_messages_text_redaction_metadata_and_usage(self):
        send = MagicMock(return_value={'model':'claude-returned', 'content':[{'type':'thinking','thinking':'hidden'}, {'type':'text','text':'design synthetic-key'}, {'type':'tool_use','text':'tool'}], 'stop_reason':'max_tokens', 'usage':{'input_tokens':10, 'cache_read_input_tokens':3, 'cache_creation_input_tokens':2, 'output_tokens':4}})
        with patch('fusion.load_anthropic_key', return_value='synthetic-key', create=True):
            result = fusion.Provider(send)('anthropic', MODEL, 'system rules', 'user context')
        url, payload, headers, timeout = send.call_args.args
        self.assertEqual(url, 'https://api.anthropic.com/v1/messages')
        self.assertEqual(payload, {'model':MODEL, 'system':'system rules', 'messages':[{'role':'user','content':'user context'}], 'max_tokens':4000})
        self.assertEqual(headers, {'x-api-key':'synthetic-key', 'anthropic-version':'2023-06-01'})
        self.assertEqual(timeout, 180)
        self.assertIn('[REDACTED]', result)
        self.assertIn('token limit', result)
        self.assertNotIn('hidden', result)
        self.assertNotIn('tool', result)
        self.assertEqual(result.model, 'claude-returned')
        self.assertEqual(result.provider, 'anthropic')
        self.assertEqual(result.usage['input_tokens'], 15)
        self.assertEqual(result.usage['total_tokens'], 19)
        self.assertEqual(result.usage['cached_input_tokens'], 3)
        for data in [{'content':[{'type':'thinking','text':'hidden'}]}, {'content':None}]:
            send.return_value=data
            with patch('fusion.load_anthropic_key', return_value='synthetic-key'), self.assertRaises(fusion.ProviderError): fusion.Provider(send)('anthropic', MODEL, '', '')
        send.side_effect=RuntimeError('synthetic-key secret')
        with patch('fusion.load_anthropic_key', return_value='synthetic-key'), self.assertRaises(fusion.ProviderError) as caught: fusion.Provider(send)('anthropic', MODEL, '', '')
        self.assertNotIn('secret', str(caught.exception))

    def test_usage_unknown_not_zero(self):
        for bad in [None, True, -1, '2']:
            usage = fusion.provider_usage('anthropic', {'usage':{'input_tokens':10, 'cache_read_input_tokens':bad, 'cache_creation_input_tokens':0, 'output_tokens':4}})
            self.assertIsNone(usage['input_tokens'])
            self.assertIsNone(usage['total_tokens'])
            self.assertEqual(usage['output_tokens'], 4)
        usage = fusion.provider_usage('anthropic', {'usage':{'input_tokens':0, 'cache_read_input_tokens':0, 'cache_creation_input_tokens':0, 'output_tokens':0}})
        self.assertEqual(usage['total_tokens'], 0)

    def test_independent_catalog(self):
        with patch('fusion.fetch_anthropic_models', return_value=CATALOG, create=True), patch('fusion.model_catalog', side_effect=RuntimeError), patch('fusion.fetch_xai_models', side_effect=RuntimeError), patch('fusion.fetch_perplexity_models', side_effect=RuntimeError):
            data = fusion.builder_catalog()
        self.assertEqual([m['value'] for m in data['architects']], ['openai:default', 'anthropic:'+MODEL])
        self.assertFalse(any(m['provider']=='anthropic' for m in data['builders']))
        self.assertTrue(data['architects'][1]['verified'])

    def test_routing_context_and_history(self):
        calls=[]
        def send(*args):
            calls.append(args)
            return fusion.ProviderText(args[0]+' output', {'input_tokens':1, 'output_tokens':2, 'total_tokens':3})
        with patch('fusion.fetch_anthropic_models', return_value=CATALOG, create=True):
            jobs=fusion.Jobs(send)
            jid=jobs.start({'prompt':'task', 'architect_model':'anthropic:'+MODEL, 'openai_model':'synth', 'ollama_model':'local'})
        for _ in range(200):
            job=jobs.snapshot(jid)
            if job['status']!='running': break
            time.sleep(.001)
        self.assertEqual([(c[0],c[1]) for c in calls], [('anthropic',MODEL), ('ollama','local'), ('openai','synth'), ('openai','synth')])
        self.assertIn('anthropic output', calls[1][3])
        self.assertIn('anthropic output', calls[3][3])
        self.assertEqual(job['stages'][0]['provider'], 'anthropic')
        self.assertEqual(job['usage']['total_tokens'], 12)
        self.assertEqual(job['config']['architect_model'], 'anthropic:'+MODEL)

if __name__ == '__main__': unittest.main()
