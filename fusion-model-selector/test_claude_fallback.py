"""Offline fallback contracts; no credential or network access."""
import time
import unittest
from unittest.mock import patch, MagicMock
import fusion

MODEL = 'anthropic:claude-test-1'
CATALOG = {'data': [{'id': 'claude-test-1'}]}

class Fallback(unittest.TestCase):
    def run_job(self, request, fail_at=0, catalog=CATALOG, empty=False):
        calls=[]
        def provider(*args):
            calls.append(args)
            if len(calls)-1 in fail_at:
                if empty: return ''
                error=fusion.ProviderError('unsafe-secret')
                error.usage=fusion.normalize_usage({'input_tokens':2,'output_tokens':0,'total_tokens':2})
                raise error
            return fusion.ProviderText(args[0]+' design', {'input_tokens':1,'output_tokens':2,'total_tokens':3})
        with patch('fusion.fetch_anthropic_models', create=True, return_value=catalog):
            jobs=fusion.Jobs(provider)
            jid=jobs.start({'prompt':'task', **request})
            for _ in range(500):
                job=jobs.snapshot(jid)
                if job['status']!='running': break
                time.sleep(.001)
        self.assertNotEqual(job['status'],'running')
        return job,calls

    def test_once_only_failed_openai_architect(self):
        job,calls=self.run_job({'architect_fallback_enabled':True,'architect_fallback_model':MODEL}, fail_at={0})
        self.assertEqual([c[0] for c in calls],['openai','anthropic','ollama','openai','openai'])
        stage=job['stages'][0]
        self.assertEqual(stage['provider'],'anthropic')
        self.assertEqual(stage['model'],'claude-test-1')
        self.assertTrue(stage['fallback_used'])
        self.assertEqual(stage['original_provider'],'openai')
        self.assertNotIn('unsafe-secret',str(job))
        self.assertEqual(stage['primary_failure']['usage']['total_tokens'],2)
        self.assertEqual(job['usage']['total_tokens'],14)
        self.assertIn('anthropic design',calls[2][3])
        self.assertEqual(job['status'],'completed')

    def test_disabled_unavailable_success_and_other_stages_never_fallback(self):
        for request,catalog,fail_at in [
            ({'architect_fallback_enabled':False,'architect_fallback_model':MODEL},CATALOG,{0}),
            ({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},{'data':[]},{0}),
            ({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},CATALOG,set()),
            ({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},CATALOG,{1,2,3}),
            ({'architect_model':MODEL,'architect_fallback_enabled':True,'architect_fallback_model':MODEL},CATALOG,{0}),
        ]:
            with self.subTest(request=request,fail_at=fail_at):
                job,calls=self.run_job(request,fail_at=fail_at,catalog=catalog)
                self.assertEqual(len(calls),4)
                self.assertFalse(job['stages'][0].get('fallback_used',False))

    def test_failed_fallback_no_recursion(self):
        job,calls=self.run_job({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},fail_at={0,1})
        self.assertEqual(len(calls),5)
        self.assertEqual(job['status'],'partial_failure')
        self.assertTrue(job['stages'][0]['fallback_used'])
        self.assertEqual(job['stages'][0]['provider'],'anthropic')
        self.assertEqual(job['stages'][1]['status'],'completed')

    def test_empty_primary_falls_back(self):
        job,calls=self.run_job({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},fail_at={0},empty=True)
        self.assertTrue(job['stages'][0]['fallback_used'])
        self.assertEqual(len(calls),5)
        self.assertFalse(job['usage']['complete'])

    def test_narrow_validation(self):
        for fields in [{'architect_fallback_enabled':'true'}, {'architect_fallback_enabled':1}, {'architect_fallback_enabled':True}, {'architect_fallback_model':'openai:gpt'}, {'architect_fallback_model':'anthropic:../bad'}, {'openai_model':MODEL}, {'fallback_url':'https://evil'}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError): fusion.validate_request({'prompt':'task',**fields})
        config=fusion.validate_request({'prompt':'task','architect_fallback_enabled':False,'architect_fallback_model':MODEL})
        self.assertFalse(config['architect_fallback_enabled'])

    def test_failed_provider_response_retains_known_usage(self):
        send=MagicMock(return_value={'output':[], 'usage':{'input_tokens':2,'output_tokens':0,'total_tokens':2}})
        with patch('fusion.load_key',return_value='synthetic-key'), self.assertRaises(fusion.ProviderError) as caught:
            fusion.Provider(send)('openai','gpt-test','','')
        self.assertEqual(caught.exception.usage['total_tokens'],2)

    def test_empty_incomplete_openai_does_not_become_fake_architecture(self):
        send=MagicMock(return_value={'status':'incomplete', 'output':[{'type':'message','content':[{'type':'output_text','text':'   '}]}], 'usage':{'input_tokens':2,'output_tokens':0,'total_tokens':2}})
        with patch('fusion.load_key',return_value='synthetic-key'), self.assertRaises(fusion.ProviderError):
            fusion.Provider(send)('openai','gpt-test','','')

    def test_actual_openai_model_metadata(self):
        send=MagicMock(return_value={'model':'gpt-actual','output':[{'type':'message','content':[{'type':'output_text','text':'design'}]}]})
        with patch('fusion.load_key',return_value='synthetic-key'):
            output=fusion.Provider(send)('openai','gpt-alias','','')
        self.assertEqual(getattr(output,'model',None),'gpt-actual')
        self.assertEqual(getattr(output,'provider',None),'openai')

    def test_failed_fallback_usage_in_known_totals(self):
        job,calls=self.run_job({'architect_fallback_enabled':True,'architect_fallback_model':MODEL},fail_at={0,1})
        self.assertEqual(job['usage']['total_tokens'],13)
        self.assertFalse(job['usage']['complete'])

    def test_explicit_default_sentinel_resolves_openai_field(self):
        job,calls=self.run_job({'architect_model':'openai:default','openai_model':'gpt-custom'},fail_at=set())
        self.assertEqual(calls[0][1],'gpt-custom')
        self.assertEqual(job['stages'][0]['model'],'gpt-custom')

    def test_no_catalog_or_key_access_when_disabled(self):
        with patch('fusion.fetch_anthropic_models',side_effect=AssertionError('must not call')) as catalog:
            jobs=fusion.Jobs(lambda *args: (_ for _ in ()).throw(fusion.ProviderError('failed')))
            jid=jobs.start({'prompt':'task','architect_fallback_enabled':False})
            for _ in range(500):
                if jobs.snapshot(jid)['status']!='running': break
                time.sleep(.001)
        catalog.assert_not_called()

    def test_markup_contract(self):
        html=(fusion.ROOT/'static/index.html').read_text()
        for identifier in ['architect-model','architect-fallback-enabled','architect-fallback-status']:
            self.assertIn('id="'+identifier+'"',html)
        self.assertNotIn('architect-fallback-model', html)
        self.assertEqual(html.count('id="architect-model"'), 1)
        self.assertIn('ChatGPT / OpenAI — gpt-5.5', html)
        self.assertIn('OpenAI model (synthesis + analysis only)', html)
        self.assertIn('added latency',html)
        self.assertIn('Claude',html)

if __name__=='__main__': unittest.main()
