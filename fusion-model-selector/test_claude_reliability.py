"""Synthetic offline deadline and failed-model identity regressions."""
import unittest
from unittest.mock import MagicMock, patch
import fusion


class Reliability(unittest.TestCase):
    def test_failed_response_retains_actual_model(self):
        send = MagicMock(return_value={'model': 'gpt-actual', 'output': [], 'usage': {'input_tokens': 2, 'output_tokens': 0, 'total_tokens': 2}})
        with patch('fusion.load_key', return_value='synthetic-key'), self.assertRaises(fusion.ProviderError) as caught:
            fusion.Provider(send)('openai', 'gpt-alias', '', '')
        self.assertEqual(getattr(caught.exception, 'model', None), 'gpt-actual')
        self.assertEqual(caught.exception.provider, 'openai')

    def test_slow_response_exceeds_whole_request_deadline(self):
        response = MagicMock()
        response.read.return_value = b'{"ok":true}'
        response.read1.side_effect = [b'{', b'}', b'']
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch('fusion.urllib.request.build_opener', return_value=opener), patch('fusion.time.monotonic', side_effect=[0, 0, 2]), self.assertRaises(fusion.ProviderError):
            fusion.transport('https://api.openai.com/v1/responses', {}, {}, 1)

    def test_successful_chunked_response(self):
        response = MagicMock()
        response.read.return_value = b'{"ok":true}'
        response.read1.side_effect = [b'{"ok":', b'true}', b'']
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch('fusion.urllib.request.build_opener', return_value=opener):
            self.assertEqual(fusion.transport('https://api.openai.com/v1/responses', {}, {}, 1), {'ok': True})


if __name__ == '__main__':
    unittest.main()
