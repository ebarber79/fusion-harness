"""Offline fourth-stage contracts; no provider network or credentials."""
import unittest
from pathlib import Path
import fusion
from test_usage import ReportedText, wait


class Analysis(unittest.TestCase):
    def run_job(self, builder='local', failed=None):
        calls = []
        outputs = ['design evidence', 'implementation evidence', 'final evidence', 'comparison evidence']
        def provider(*args):
            index = len(calls)
            calls.append(args)
            if index == failed:
                raise RuntimeError('private upstream details')
            return ReportedText(outputs[index], dict(input_tokens=2, output_tokens=3, total_tokens=5))
        jobs = fusion.Jobs(provider)
        job = wait(jobs, jobs.start(dict(prompt='original goal', openai_model='synth-model', architect_model='openai:architect-model', ollama_model=builder)))
        return calls, job

    def test_fixed_routing_order_context_and_four_stage_usage(self):
        for builder, provider in [('local', 'ollama'), ('xai:grok-code-fast-1', 'xai')]:
            with self.subTest(builder=builder):
                calls, job = self.run_job(builder)
                self.assertEqual([c[0] for c in calls], ['openai', provider, 'openai', 'openai'])
                self.assertEqual([c[1] for c in calls], ['architect-model', builder.replace('xai:', ''), 'synth-model', 'synth-model'])
                self.assertEqual([s['name'] for s in job['stages']], ['architect', 'builder', 'synthesis', 'analysis'])
                context = calls[3][3]
                labels = ['USER REQUEST:\noriginal goal', 'ARCHITECT OUTPUT', 'BUILDER OUTPUT', 'SYNTHESIS OUTPUT']
                self.assertEqual(sorted(context.index(label) for label in labels), [context.index(label) for label in labels])
                for output in ['design evidence', 'implementation evidence', 'final evidence']:
                    self.assertIn(output, context)
                self.assertNotIn('SYNTHESIS OUTPUT', calls[2][3])
                self.assertEqual(job['stages'][3]['provider'], 'openai')
                self.assertEqual(job['stages'][3]['model'], 'synth-model')
                self.assertEqual(job['usage']['total_tokens'], 20)
                self.assertEqual(job['usage']['stage_count'], 4)
                self.assertEqual(job['usage']['complete_stages'], 4)
                self.assertTrue(job['usage']['complete'])

    def test_analysis_instructions_are_evidence_based_not_hidden_reasoning(self):
        calls, _ = self.run_job()
        self.assertEqual(len(calls), 4)
        instructions = calls[3][2].lower()
        for term in ['user-facing output comparison', 'not hidden chain of thought', 'agreements', 'divergences', 'quote', 'hypotheses', 'role instructions', 'context', 'model limits', 'internals', 'synthesis', 'uncertainties', 'tests', 'unavailable', 'do not fabricate', 'untrusted']:
            self.assertIn(term, instructions)

    def test_analysis_failure_preserves_three_outputs_and_partial_usage(self):
        calls, job = self.run_job(failed=3)
        self.assertEqual(len(calls), 4)
        self.assertEqual(job['status'], 'partial_failure')
        self.assertEqual([s['output'] for s in job['stages'][:3]], ['design evidence', 'implementation evidence', 'final evidence'])
        self.assertEqual(job['stages'][3]['status'], 'error')
        self.assertEqual(job['usage']['total_tokens'], 15)
        self.assertEqual(job['usage']['stage_count'], 4)
        self.assertFalse(job['usage']['complete'])
        self.assertNotIn('private upstream', str(job))

    def test_missing_stage_is_truthfully_passed_to_analysis(self):
        for index, name in enumerate(['ARCHITECT', 'BUILDER', 'SYNTHESIS']):
            with self.subTest(stage=name):
                calls, job = self.run_job(failed=index)
                self.assertEqual(len(calls), 4)
                self.assertIn(name + ': unavailable (stage failed).', calls[3][3])
                self.assertNotIn(['design evidence', 'implementation evidence', 'final evidence'][index], calls[3][3])
                self.assertEqual(job['stages'][3]['status'], 'completed')

    def test_four_panel_markup_disclosure_and_layout(self):
        root = Path(__file__).parent
        html = (root / 'static/index.html').read_text()
        self.assertEqual(html.count('class="panel"'), 4)
        for suffix in ['provider', 'status', 'usage', 'error', 'output']:
            self.assertIn('id="analysis-' + suffix + '"', html)
        for term in ['Reasoning / Divergence', 'user-facing output comparison', 'not hidden chain of thought', 'all prior outputs', 'cost', 'latency']:
            self.assertIn(term, html)
        self.assertIn('repeat(2, minmax(0, 1fr))', (root / 'static/style.css').read_text())


if __name__ == '__main__':
    unittest.main()
