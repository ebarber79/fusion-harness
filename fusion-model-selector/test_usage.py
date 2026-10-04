import json
import threading
import time
import unittest
from unittest.mock import patch
import fusion


class ReportedText(str):
    def __new__(cls, text, usage=None):
        result = super().__new__(cls, text)
        result.usage = usage
        return result


def wait(jobs, jid):
    for _ in range(300):
        job = jobs.snapshot(jid)
        if job['status'] != 'running':
            return job
        time.sleep(.005)
    raise AssertionError('Job did not finish')


class ProviderUsage(unittest.TestCase):
    def response(self, provider, usage):
        payloads = {
            'openai': {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'answer'}]}], 'usage': usage},
            'xai': {'choices': [{'message': {'content': 'answer'}, 'finish_reason': 'stop'}], 'usage': usage},
            'ollama': {'response': 'answer', 'done': True, **usage},
        }
        calls = []
        def send(*args):
            calls.append(args)
            return payloads[provider]
        with patch('fusion.load_key', return_value='fake-openai'), patch('fusion.load_xai_key', return_value='fake-xai'):
            result = fusion.Provider(send)(provider, 'grok-code-fast-1' if provider == 'xai' else 'model', 'system', 'prompt')
        self.assertIsInstance(result, str)
        self.assertEqual(result, 'answer')
        self.assertEqual(calls[0][0], {'openai': 'https://api.openai.com/v1/responses', 'xai': 'https://api.x.ai/v1/chat/completions', 'ollama': 'http://127.0.0.1:11434/api/generate'}[provider])
        self.assertEqual(calls[0][1]['model'], 'grok-code-fast-1' if provider == 'xai' else 'model')
        return getattr(result, 'usage', None)

    def test_openai_reported_usage_with_subsets(self):
        self.assertEqual(self.response('openai', {'input_tokens': 120, 'output_tokens': 30, 'total_tokens': 150, 'input_tokens_details': {'cached_tokens': 80}, 'output_tokens_details': {'reasoning_tokens': 12}}),
                         {'input_tokens': 120, 'output_tokens': 30, 'total_tokens': 150, 'cached_input_tokens': 80, 'reasoning_tokens': 12})

    def test_xai_reported_usage_with_subsets(self):
        self.assertEqual(self.response('xai', {'prompt_tokens': 90, 'completion_tokens': 20, 'total_tokens': 110, 'prompt_tokens_details': {'cached_tokens': 40}, 'completion_tokens_details': {'reasoning_tokens': 5}}),
                         {'input_tokens': 90, 'output_tokens': 20, 'total_tokens': 110, 'cached_input_tokens': 40, 'reasoning_tokens': 5})

    def test_ollama_counts_sum(self):
        usage = self.response('ollama', {'prompt_eval_count': 23, 'eval_count': 7})
        self.assertEqual([usage[k] for k in ('input_tokens', 'output_tokens', 'total_tokens')], [23, 7, 30])

    def test_missing_malformed_and_zero_counts(self):
        for value in (None, True, False, -1, 1.5, '8', float('nan'), float('inf'), {}, []):
            with self.subTest(value=value):
                usage = self.response('openai', {'input_tokens': value, 'output_tokens': 0, 'input_tokens_details': 'bad'})
                self.assertIsNotNone(usage)
                self.assertIsNone(usage['input_tokens'])
                self.assertEqual(usage['output_tokens'], 0)
                self.assertIsNone(usage['total_tokens'])
                self.assertIsNone(usage['cached_input_tokens'])
        for provider in ('openai', 'xai', 'ollama'):
            usage = self.response(provider, {})
            self.assertTrue(all(value is None for value in usage.values()))
        usage = self.response('ollama', {'prompt_eval_count': 0, 'eval_count': 0})
        self.assertEqual(usage['total_tokens'], 0)
        usage = self.response('ollama', {'prompt_eval_count': 1, 'eval_count': True})
        self.assertIsNone(usage['total_tokens'])


class JobUsage(unittest.TestCase):
    def test_mixed_missing_error_usage_and_routing(self):
        calls = []
        def provider(*args):
            calls.append(args)
            if len(calls) == 1:
                return ReportedText('architecture', {'input_tokens': 10, 'output_tokens': 2, 'total_tokens': 12, 'cached_input_tokens': 8, 'reasoning_tokens': 1})
            if len(calls) == 2:
                raise RuntimeError('secret')
            return 'plain string'
        jobs = fusion.Jobs(provider)
        job = wait(jobs, jobs.start({'prompt': 'task', 'ollama_model': 'xai:grok-code-fast-1'}))
        self.assertEqual([c[0] for c in calls], ['openai', 'xai', 'openai', 'openai'])
        self.assertIn('usage', job)
        self.assertEqual(job['stages'][0].get('usage', {}).get('total_tokens'), 12)
        self.assertIsNone(job['stages'][1]['usage']['total_tokens'])
        self.assertIsNone(job['stages'][2]['usage']['total_tokens'])
        summary = job.get('usage', {})
        self.assertEqual(summary.get('total_tokens'), 12)
        self.assertEqual(summary['input_tokens'], 10)
        self.assertEqual(summary['output_tokens'], 2)
        self.assertEqual(summary['complete_stages'], 1)
        self.assertEqual(summary['stage_count'], 4)
        self.assertFalse(summary['complete'])
        self.assertEqual(summary['known_stages'], {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 1})
        self.assertEqual(jobs.snapshot(job['id'])['usage'], summary)
        json.dumps(job, allow_nan=False)

    def test_malformed_partial_and_zero_aggregate(self):
        usages = [dict(input_tokens=0, output_tokens=0, total_tokens=0), dict(input_tokens=True, output_tokens=3, total_tokens=float('inf')), dict(input_tokens=5, output_tokens=None, total_tokens='5'), {}]
        jobs = fusion.Jobs(lambda *args: ReportedText('answer', usages.pop(0)))
        job = wait(jobs, jobs.start({'prompt': 'task'}))
        self.assertEqual(job.get('usage', {}).get('input_tokens'), 5)
        self.assertEqual(job['usage']['output_tokens'], 3)
        self.assertEqual(job['usage']['total_tokens'], 0)
        self.assertEqual(job['usage']['known_stages'], {'input_tokens': 2, 'output_tokens': 2, 'total_tokens': 1})
        self.assertFalse(job['usage']['complete'])
        self.assertIsNone(job['stages'][1]['usage']['input_tokens'])
        json.dumps(job, allow_nan=False)

    def test_complete_usage_survives_output_truncation(self):
        jobs = fusion.Jobs(lambda *args: ReportedText('x' * (fusion.MAX_OUTPUT + 1), dict(input_tokens=0, output_tokens=2, total_tokens=2, cached_input_tokens=0, reasoning_tokens=1)))
        job = wait(jobs, jobs.start({'prompt': 'task'}))
        self.assertEqual(job.get('usage', {}).get('total_tokens'), 8)
        self.assertTrue(job['usage']['complete'])
        self.assertEqual(job['usage']['complete_stages'], 4)

    def test_unknown_not_zero_and_new_job_resets_after_completion(self):
        entered, release = threading.Event(), threading.Event()
        def provider(*args):
            entered.set()
            release.wait(2)
            return ReportedText('answer', dict(input_tokens=2, output_tokens=3, total_tokens=5))
        jobs = fusion.Jobs(provider)
        first = jobs.start({'prompt': 'one'})
        self.assertTrue(entered.wait(1))
        state = jobs.snapshot(first)
        self.assertIsNone(state.get('usage', {}).get('total_tokens'))
        self.assertIn('usage', state)
        self.assertEqual(state['usage']['complete_stages'], 0)
        release.set()
        self.assertEqual(wait(jobs, first)['usage']['total_tokens'], 20)
        entered.clear(); release.clear()
        second = jobs.start({'prompt': 'two'})
        self.assertTrue(entered.wait(1))
        self.assertIsNone(jobs.snapshot(second)['usage']['total_tokens'])
        self.assertEqual(jobs.snapshot(second)['usage']['known_stages']['total_tokens'], 0)
        release.set()
        wait(jobs, second)
        self.assertIsNone(jobs.snapshot(first))


if __name__ == '__main__':
    unittest.main()
