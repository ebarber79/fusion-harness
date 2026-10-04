"""Offline architect selection contracts."""
import time
import unittest
from unittest.mock import patch
import fusion

class Architect(unittest.TestCase):
    def test_validation(self):
        for value in ['gpt-custom', 'openai:gpt-custom']:
            self.assertEqual(fusion.validate_request({'prompt': 'task', 'architect_model': value})['architect_model'], value)
        for value in ['', None, 'xai:grok-4.3', 'ollama:local', 'anthropic:claude-image-1', 'openai:', 'openai:a:b']:
            with self.assertRaises(ValueError):
                fusion.validate_request({'prompt': 'task', 'architect_model': value})

    def test_routing_metadata_context_usage_and_synthesis_independence(self):
        for selection, provider, model in [('openai:other', 'openai', 'other'), ('other', 'openai', 'other'), (None, 'openai', 'synth')]:
            calls = []
            def send(*args):
                calls.append(args)
                return fusion.ProviderText(args[0]+' output', {'input_tokens': 2, 'output_tokens': 3, 'total_tokens': 5})
            request = {'prompt': 'task', 'openai_model': 'synth', 'ollama_model': 'local'}
            if selection is not None: request['architect_model'] = selection
            jobs = fusion.Jobs(send)
            jid = jobs.start(request)
            for _ in range(200):
                job = jobs.snapshot(jid)
                if job['status'] != 'running': break
                time.sleep(.001)
            self.assertEqual([(c[0], c[1]) for c in calls], [(provider, model), ('ollama', 'local'), ('openai', 'synth'), ('openai', 'synth')])
            self.assertEqual([(s['provider'], s['model']) for s in job['stages']], [(provider, model), ('ollama', 'local'), ('openai', 'synth'), ('openai', 'synth')])
            self.assertIn('ARCHITECT OUTPUT', calls[1][3])
            self.assertIn(provider+' output', calls[1][3])
            self.assertIn('BUILDER OUTPUT', calls[2][3])
            self.assertEqual(job['stages'][0]['usage']['total_tokens'], 5)
            self.assertEqual(job['usage']['total_tokens'], 20)

    def test_additive_catalog_disabled_fallback(self):
        with patch('fusion.fetch_perplexity_models', side_effect=RuntimeError('offline')), patch('fusion.model_catalog', return_value={'models': [], 'default': None}), patch('fusion.fetch_xai_models', side_effect=RuntimeError):
            data = fusion.builder_catalog()
        self.assertEqual(data['default_architect'], 'openai:default')
        self.assertEqual(data['architects'][0]['value'], 'openai:default')
        self.assertTrue(data['architects'][0]['selectable'])
        self.assertEqual(len(data['architects']), 1)

    def test_markup_stage_mapping(self):
        html = (fusion.ROOT/'static/index.html').read_text()
        for identifier in ['architect-model', 'architect-provider', 'synthesis-provider', 'architect-models-status']:
            self.assertIn('id="'+identifier+'"', html)
        self.assertIn('OpenAI model (synthesis + analysis + default OpenAI architect)', html)
        self.assertIn('Builder model · Ollama local / Grok cloud', html)
        self.assertIn('sent to OpenAI for architecture', html)

if __name__ == '__main__': unittest.main()
