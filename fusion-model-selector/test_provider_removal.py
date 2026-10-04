"""Regression contracts for the supported provider boundary; offline only."""
import unittest
from unittest.mock import patch
import fusion

class SupportedProviders(unittest.TestCase):
    def setUp(self):
        p = patch('fusion.fetch_perplexity_models', return_value={'data': [{'id': 'perplexity/sonar'}]})
        p.start()
        self.addCleanup(p.stop)
    def test_removed_provider_rejected_for_both_roles(self):
        for field in ('architect_model', 'ollama_model'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                fusion.validate_request({'prompt': 'task', field: 'anthropic:claude-sonnet-5-5'})

    def test_catalog_only_contains_supported_providers(self):
        # Trap the retired catalog too, so this regression cannot load real keys if it returns.
        with patch('fusion.fetch_anthropic_models', create=True, side_effect=RuntimeError('retired provider')), patch('fusion.model_catalog', return_value={'models': [{'name': 'local:latest'}], 'default': 'local:latest'}), patch('fusion.fetch_xai_models', return_value={'data': [{'id': 'grok-4.3'}]}):
            data = fusion.builder_catalog()
        self.assertEqual(set(data['providers']), {'ollama', 'xai', 'perplexity'})
        self.assertEqual({m['provider'] for m in data['builders']}, {'ollama', 'xai', 'perplexity'})
        self.assertEqual({m['provider'] for m in data['architects']}, {'openai'})

    def test_removed_runtime_is_absent(self):
        for name in ('load_anthropic_key', 'fetch_anthropic_models', 'is_claude_text_model', 'ANTHROPIC_DOCUMENTED_MODELS'):
            self.assertFalse(hasattr(fusion, name), name)

    def test_ui_and_setup_have_no_removed_integration(self):
        for asset in ('index.html', 'app.js'):
            text = (fusion.ROOT/'static'/asset).read_text().lower()
            self.assertNotIn('anthropic', text)
            self.assertNotIn('claude', text)
        self.assertFalse((fusion.ROOT/'setup_anthropic_key.py').exists())

if __name__ == '__main__': unittest.main()
