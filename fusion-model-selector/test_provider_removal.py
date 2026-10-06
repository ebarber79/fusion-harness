"""Supported role boundaries, including optional architect-only Claude; offline."""
import unittest
from unittest.mock import patch
import fusion

class SupportedProviders(unittest.TestCase):
    def setUp(self):
        mock = patch('fusion.fetch_openai_models', return_value={'data': [{'id': 'o3'}]})
        mock.start()
        self.addCleanup(mock.stop)

    def test_claude_architect_only(self):
        with patch('fusion.fetch_anthropic_models', create=True, return_value={'data':[{'id':'claude-test'}]}):
            self.assertEqual(fusion.validate_request({'prompt':'task', 'architect_model':'anthropic:claude-test'})['architect_model'], 'anthropic:claude-test')
        with self.assertRaises(ValueError):
            fusion.validate_request({'prompt':'task', 'ollama_model':'anthropic:claude-test'})

    def test_catalog_only_contains_supported_role_providers(self):
        with patch('fusion.fetch_anthropic_models', create=True, return_value={'data':[{'id':'claude-test'}]}), patch('fusion.fetch_perplexity_models', return_value={'data':[{'id':'perplexity/sonar'}]}), patch('fusion.model_catalog', return_value={'models':[{'name':'local:latest'}], 'default':'local:latest'}), patch('fusion.fetch_xai_models', return_value={'data':[{'id':'grok-4.3'}]}):
            data=fusion.builder_catalog()
        self.assertEqual(set(data['providers']), {'ollama','xai','perplexity','anthropic','openai'})
        self.assertEqual({m['provider'] for m in data['builders']}, {'ollama','xai','perplexity'})
        self.assertEqual({m['provider'] for m in data['architects']}, {'openai','anthropic'})

    def test_no_guessed_claude_fallback(self):
        self.assertFalse(hasattr(fusion, 'ANTHROPIC_DOCUMENTED_MODELS'))
        self.assertTrue((fusion.ROOT/'setup_anthropic_key.py').exists())

if __name__ == '__main__': unittest.main()
