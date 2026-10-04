"""Offline Perplexity contracts. Synthetic keys only, all cloud branches mocked."""
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock
import fusion

MODEL = 'perplexity/sonar'
def answer(text='answer'):
    return {'model': MODEL, 'output': [{'type': 'reasoning', 'content': [{'type': 'output_text', 'text': 'PRIVATE'}]}, {'type': 'message', 'role': 'user', 'content': [{'type': 'output_text', 'text': 'NOT ASSISTANT'}]}, {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': text, 'annotations': [{'type': 'url_citation', 'url': 'https://example.com/a', 'title': 'A'}]}]}, {'type': 'search_results', 'results': [{'id': 2, 'url': 'https://example.org/b', 'title': 'B'}]}], 'usage': {'input_tokens': 10, 'output_tokens': 2, 'total_tokens': 12, 'input_tokens_details': {'cached_tokens': 3}, 'output_tokens_details': {'reasoning_tokens': 1}}}

class Perplexity(unittest.TestCase):
    def test_credentials(self):
        self.assertTrue(callable(getattr(fusion, 'load_perplexity_key', None)))
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'HOME': d}, clear=True):
            p = Path(d)/'.config/fusion/perplexity.key'; p.parent.mkdir(parents=True); p.write_text('fake-file\n')
            self.assertEqual(fusion.load_perplexity_key(), 'fake-file')
            with patch.dict(os.environ, {'PERPLEXITY_API_KEY': 'fake-env'}): self.assertEqual(fusion.load_perplexity_key(), 'fake-env')
            for key in ['bad key', 'x'*4097]:
                with patch.dict(os.environ, {'PERPLEXITY_API_KEY': key}), self.assertRaises(fusion.ProviderError): fusion.load_perplexity_key()

    def test_payload_sources_usage_redaction(self):
        calls=[]
        with patch.dict(os.environ, {'PERPLEXITY_API_KEY': 'synthetic-key'}, clear=True):
            out = fusion.Provider(lambda *a: calls.append(a) or answer('answer synthetic-key'))('perplexity', MODEL, 'rules', 'request')
        self.assertIn('Sources', out); self.assertIn('https://example.com/a', out); self.assertIn('https://example.org/b', out)
        self.assertNotIn('PRIVATE', out); self.assertNotIn('NOT ASSISTANT', out); self.assertNotIn('synthetic-key', out)
        url, payload, headers, timeout = calls[0]
        self.assertEqual(url, 'https://api.perplexity.ai/v1/agent')
        self.assertEqual(payload['model'], MODEL); self.assertEqual(payload['instructions'], 'rules'); self.assertEqual(payload['input'], 'request')
        self.assertEqual(payload['tools'], [{'type': 'web_search', 'max_results': 5, 'max_tokens': 2000}])
        self.assertEqual(payload['max_steps'], 3); self.assertEqual(payload['max_output_tokens'], 4000); self.assertFalse(payload['store'])
        self.assertEqual(headers, {'Authorization': 'Bearer synthetic-key'})
        self.assertEqual(out.usage['total_tokens'], 12); self.assertEqual(out.usage['cached_input_tokens'], 3)
        self.assertEqual(out.model, MODEL); self.assertEqual(out.provider, 'perplexity')

    def test_malformed_and_source_security(self):
        self.assertTrue(callable(getattr(fusion, 'load_perplexity_key', None)))
        with patch('fusion.load_perplexity_key', return_value='synthetic-key'):
            for data in [None, {}, {'output': None}, {'output': [None]}, {'output': [{'type':'message','role':'assistant','content':[{'type':'output_text','text':None}]}]}]:
                with self.assertRaises(fusion.ProviderError): fusion.Provider(lambda *a: data)('perplexity', MODEL, '', '')
            data=answer(); data['output'].append({'type':'search_results','results':[{'url':u,'title':'synthetic-key\n<script>'} for u in ['javascript:alert(1)','http://localhost/a','http://127.0.0.1/a','https://user:pass@example.com/','https://example.com/synthetic-key']] + [{'url':f'https://example.com/{i}','title':'x'*1000} for i in range(30)]})
            out=fusion.Provider(lambda *a:data)('perplexity',MODEL,'','')
            self.assertNotIn('javascript:',out); self.assertNotIn('localhost',out); self.assertNotIn('127.0.0.1',out); self.assertNotIn('user:pass',out); self.assertNotIn('synthetic-key',out)
            self.assertLessEqual(len(out.sources),10)
            data=answer(); data.pop('usage'); out=fusion.Provider(lambda *a:data)('perplexity',MODEL,'',''); self.assertIsNone(out.usage['total_tokens'])

    def test_catalog_transport_and_bounds(self):
        self.assertTrue(callable(getattr(fusion, 'fetch_perplexity_models', None)))
        response=MagicMock(); response.__enter__.return_value=response; response.read.return_value=b'{"data":[{"id":"perplexity/sonar"},{"id":"anthropic/claude-test"}]}'
        opener=MagicMock(); opener.open.return_value=response
        with patch('fusion.load_perplexity_key',return_value='synthetic-key'), patch('fusion.urllib.request.build_opener',return_value=opener) as build:
            data=fusion.fetch_perplexity_models(); self.assertEqual(data['data'],[{'id':MODEL}])
            req=opener.open.call_args.args[0]; self.assertEqual(req.full_url,'https://api.perplexity.ai/v1/models'); self.assertEqual(req.get_header('Authorization'),'Bearer synthetic-key'); self.assertEqual(req.get_method(),'GET')
            self.assertEqual(build.call_args.args[0].proxies,{}); self.assertIsInstance(build.call_args.args[1],fusion.NoRedirect); response.read.assert_called_once_with(fusion.MAX_MODEL_RESPONSE+1)
            for body in [b'{}',b'null',b'x'*(fusion.MAX_MODEL_RESPONSE+1)]:
                response.read.return_value=body
                with self.assertRaises(fusion.ProviderError): fusion.fetch_perplexity_models()

    def test_independent_catalogs_and_filter(self):
        self.assertTrue(callable(getattr(fusion, 'fetch_perplexity_models', None)))
        for fails in [True,False]:
            with patch('fusion.model_catalog',return_value={'models':[{'name':'local'}],'default':'local'}), patch('fusion.fetch_xai_models',return_value={'data':[{'id':'grok-4.3'}]}), patch('fusion.fetch_perplexity_models',side_effect=RuntimeError('secret') if fails else None,return_value={'data':[{'id':MODEL},{'id':'anthropic/claude-test'},{'id':'perplexity/kimi-k3'}]}):
                data=fusion.builder_catalog()
            cloud=[m for m in data['builders'] if m['provider']=='perplexity']; self.assertEqual([m['name'] for m in cloud],[MODEL]); self.assertEqual(cloud[0]['selectable'],not fails); self.assertEqual(data['default_builder'],'local'); self.assertNotIn('secret',str(data))

    def test_routing_context_four_stage_metadata(self):
        self.assertEqual(fusion.builder_selection('perplexity:'+MODEL),('perplexity',MODEL))
        for m in ['sonar','anthropic/claude-test','perplexity/kimi-k3']:
            with self.assertRaises(ValueError): fusion.builder_selection('perplexity:'+m)
        calls=[]
        def provider(*args):
            calls.append(args)
            if args[0]=='perplexity':
                with patch('fusion.load_perplexity_key',return_value='fake'): return fusion.Provider(lambda *a: {**answer(), 'model':'openai/actual-returned'}) (*args)
            return fusion.ProviderText('ok',{'input_tokens':1,'output_tokens':1,'total_tokens':2})
        jobs=fusion.Jobs(provider); jid=jobs.start({'prompt':'task','ollama_model':'perplexity:'+MODEL})
        for _ in range(200):
            job=jobs.snapshot(jid)
            if job['status']!='running': break
            time.sleep(.005)
        self.assertEqual([c[0] for c in calls],['openai','perplexity','openai','openai'])
        for c in calls[2:]: self.assertIn('https://example.org/b',c[3])
        self.assertEqual(job['stages'][1]['model'],'openai/actual-returned'); self.assertEqual(job['stages'][1]['provider'],'perplexity'); self.assertEqual(job['usage']['total_tokens'],18); self.assertEqual(job['usage']['stage_count'],4)

    def test_disclosure_and_documentation(self):
        html = (fusion.ROOT/'static/index.html').read_text()
        readme = (fusion.ROOT/'README.md').read_text()
        self.assertIn('Perplexity', html)
        self.assertIn('answer and sources', html)
        self.assertIn('https://console.perplexity.ai/project/keys', readme)
        self.assertIn('max_steps', readme)

    def test_hidden_setup(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('setup_perplexity_key'))
        import setup_perplexity_key as setup
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'HOME':d},clear=True), patch.object(setup.getpass,'getpass',return_value='fake'), patch('builtins.print'):
            self.assertEqual(setup.main(),0); p=Path(d)/'.config/fusion/perplexity.key'; self.assertEqual(p.stat().st_mode&0o777,0o600); self.assertEqual(p.parent.stat().st_mode&0o777,0o700)

if __name__=='__main__': unittest.main()
