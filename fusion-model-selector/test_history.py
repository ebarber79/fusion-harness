import json
from pathlib import Path
import tempfile
import unittest
import fusion


class StoreTests(unittest.TestCase):
    def test_private_durable_snapshot(self):
        self.assertTrue(hasattr(fusion, 'HistoryStore'), 'Durable history store is missing')
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'history'
            store = fusion.HistoryStore(path)
            run = {'id': 'one', 'status': 'completed', 'config': {'prompt': '<script>'}, 'stages': []}
            store.save(run)
            self.assertEqual(store.get('one'), run)
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
            for file in path.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            store.close()
            store = fusion.HistoryStore(path)
            self.assertEqual(store.get('one'), run)
            store.close()

    def test_retention_and_atomic_active_delete(self):
        store = fusion.HistoryStore(retention=2)
        for jid in ('old', 'new', 'newest'):
            store.save({'id': jid, 'status': 'completed', 'config': {}, 'stages': []})
        store.save({'id': 'active', 'status': 'running', 'config': {}, 'stages': []})
        self.assertEqual({run['id'] for run in store.list()}, {'new', 'newest', 'active'})
        with self.assertRaises(fusion.BusyError):
            store.delete('active')
        self.assertEqual(store.get('active')['status'], 'running')
        self.assertTrue(store.delete('new'))
        self.assertFalse(store.delete('missing'))
        self.assertIsNone(store.get('new'))
        store.close()

    def test_owner_exclusion_recovery_and_stable_lock(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'private'
            store = fusion.HistoryStore(path)
            store.save({'id': 'active', 'status': 'running', 'config': {}, 'stages': [{'status': 'running', 'output': 'preserved'}]})
            with self.assertRaises(fusion.StorageError):
                fusion.HistoryStore(path)
            self.assertEqual(store.get('active')['status'], 'running')
            import subprocess, sys
            child = subprocess.run([sys.executable, '-c', 'import fusion,sys; fusion.HistoryStore(sys.argv[1])', str(path)], capture_output=True)
            self.assertNotEqual(child.returncode, 0)
            inode = (path / 'owner.lock').stat().st_ino
            store.close()
            recovered = fusion.HistoryStore(path)
            self.assertEqual(recovered.get('active')['status'], 'interrupted')
            self.assertEqual(recovered.get('active')['stages'][0]['output'], 'preserved')
            self.assertEqual(recovered.get('active')['stages'][0]['status'], 'interrupted')
            self.assertEqual((path / 'owner.lock').stat().st_ino, inode)
            recovered.close()

    def test_refuses_unsafe_paths_without_changing_target(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            target = root / 'target'; target.mkdir(mode=0o700)
            link = root / 'link'; link.symlink_to(target)
            with self.assertRaises(fusion.StorageError):
                fusion.HistoryStore(link)
            self.assertEqual(list(target.iterdir()), [])
            unsafe = root / 'unsafe'; unsafe.mkdir(mode=0o755)
            with self.assertRaises(fusion.StorageError):
                fusion.HistoryStore(unsafe)
            for name in ['owner.lock', 'history.sqlite3']:
                with self.subTest(name=name):
                    path = root / name.replace('.', '_'); path.mkdir(mode=0o700)
                    victim = root / ('victim-' + name); victim.write_text('untouched')
                    (path / name).symlink_to(victim)
                    with self.assertRaises(fusion.StorageError):
                        fusion.HistoryStore(path)
                    self.assertEqual(victim.read_text(), 'untouched')


class PipelineTests(unittest.TestCase):
    def test_history_failure_during_provider_stops_next_paid_stage(self):
        calls = []
        def provider(*args):
            calls.append(args)
            jobs.storage_failed = True  # another request discovered failed storage
            return 'answer'
        jobs = fusion.Jobs(provider)
        self.addCleanup(jobs.close)
        jobs.start({'prompt': 'x'})
        jobs.worker.join(2)
        self.assertEqual(len(calls), 1)
        self.assertEqual(jobs.snapshot()['status'], 'storage_error')

    def test_storage_failure_blocks_architect_fallback(self):
        from unittest.mock import patch
        calls = []
        def provider(*args):
            calls.append(args)
            jobs.storage_failed = True
            raise fusion.ProviderError('synthetic failure')
        jobs = fusion.Jobs(provider)
        self.addCleanup(jobs.close)
        with patch('fusion.fetch_anthropic_models', return_value={'data': [{'id': 'claude-test-1'}]}):
            jobs.start({'prompt': 'x', 'architect_fallback_enabled': True,
                        'architect_fallback_model': 'anthropic:claude-test-1'})
            jobs.worker.join(2)
        self.assertEqual(len(calls), 1)
        self.assertEqual(jobs.snapshot()['status'], 'storage_error')

    def test_closed_jobs_reject_new_work(self):
        jobs = fusion.Jobs(lambda *args: 'answer')
        jobs.close()
        with self.assertRaises(fusion.StorageError):
            jobs.start({'prompt': 'x'})
        self.assertIsNone(jobs.snapshot())

    def test_acceptance_committed_before_worker_can_call_provider(self):
        observations = []
        jobs = fusion.Jobs(lambda *args: observations.append(jobs.store.list()) or 'answer')
        self.assertTrue(hasattr(jobs, 'store'), 'Jobs needs isolated injectable storage')
        jid = jobs.start({'prompt': ' accepted '})
        jobs.worker.join(2)
        self.assertEqual(len(observations), 4)
        self.assertEqual(observations[0][0]['config']['prompt'], 'accepted')
        self.assertEqual(observations[0][0]['id'], jid)
        self.assertEqual(jobs.store.get(jid)['status'], 'completed')
        jobs.close()

    def test_each_transition_and_output_is_committed_before_next_provider(self):
        seen = []
        jobs = fusion.Jobs(lambda *args: seen.append(jobs.store.list()[0]) or 'output-' + str(len(seen)))
        jid = jobs.start({'prompt': 'x'})
        jobs.worker.join(2)
        for index, run in enumerate(seen):
            self.assertEqual(run['stages'][index]['status'], 'running')
            for previous in range(index):
                self.assertEqual(run['stages'][previous]['status'], 'completed')
                self.assertEqual(run['stages'][previous]['output'], 'output-' + str(previous + 1))
        jobs.close()

    def test_acceptance_failure_has_no_job_and_no_provider_calls(self):
        calls = []
        jobs = fusion.Jobs(lambda *args: calls.append(args) or 'x')
        jobs.store.save = lambda run: (_ for _ in ()).throw(fusion.StorageError('secret disk details'))
        with self.assertRaises(fusion.StorageError):
            jobs.start({'prompt': 'x'})
        self.assertIsNone(jobs.snapshot())
        self.assertEqual(calls, [])
        with self.assertRaises(fusion.StorageError):
            jobs.start({'prompt': 'retry'})
        jobs.close()

    def test_midrun_storage_failure_stops_calls_and_latches_closed(self):
        calls = []
        jobs = fusion.Jobs(lambda *args: calls.append(args) or 'first')
        save = jobs.store.save
        def failing_save(run):
            if run['stages'][0]['status'] == 'completed':
                raise fusion.StorageError('disk secret')
            save(run)
        jobs.store.save = failing_save
        jid = jobs.start({'prompt': 'x'})
        jobs.worker.join(2)
        self.assertEqual(len(calls), 1)
        with self.assertRaises(fusion.StorageError):
            jobs.start({'prompt': 'again'})
        self.assertEqual(jobs.snapshot()['status'], 'storage_error')
        self.assertEqual(jobs.store.get(jid)['stages'][0]['status'], 'running')
        jobs.close()


class StartupTests(unittest.TestCase):
    def test_occupied_listener_does_not_construct_or_recover_store(self):
        import socket
        from unittest.mock import Mock
        sock = socket.socket(); sock.bind(('127.0.0.1', 0)); sock.listen()
        factory = Mock()
        try:
            with self.assertRaises(OSError):
                fusion.make_server(sock.getsockname()[1], store_factory=factory)
            factory.assert_not_called()
        finally:
            sock.close()

    def test_factory_failure_releases_reserved_listener(self):
        import socket
        from unittest.mock import patch
        sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
        def fail():
            raise fusion.StorageError('startup failed')
        with self.assertRaises(fusion.StorageError):
            fusion.make_server(port, store_factory=fail)
        with socket.socket() as retry:
            retry.bind(('127.0.0.1', port))

    def test_recovered_runs_are_history_not_replayed_active_job(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'history'
            store = fusion.HistoryStore(path)
            store.save({'id': 'old', 'status': 'running', 'config': {}, 'stages': []})
            store.close()
            server = fusion.make_server(0, store_factory=lambda: fusion.HistoryStore(path))
            self.assertIsNone(server.jobs.snapshot())
            self.assertEqual(server.jobs.store.get('old')['status'], 'interrupted')
            server.server_close()
            reopened = fusion.HistoryStore(path)
            reopened.close()


class HistoryHTTPTests(unittest.TestCase):
    def setUp(self):
        import threading
        self.jobs = fusion.Jobs(lambda *args: fusion.ProviderText('full <script> ``` output', {'input_tokens': 2, 'output_tokens': 3, 'total_tokens': 5}))
        self.server = fusion.make_server(0, self.jobs)
        self.thread = threading.Thread(target=self.server.serve_forever); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, path, method='GET', body=None):
        import http.client
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=3)
        conn.request(method, path, body, {'Content-Type': 'application/json'})
        response = conn.getresponse(); result = response.status, dict(response.getheaders()), response.read()
        conn.close(); return result

    def test_browse_export_and_delete_preserve_latest_contract(self):
        jid = self.jobs.start({'prompt': 'PROMPT ``` <img>'})
        self.jobs.worker.join(2)
        self.assertEqual(self.request('/api/history')[0], 200)
        history = json.loads(self.request('/api/history')[2])['runs']
        self.assertEqual(history[0]['id'], jid)
        self.assertNotIn('stages', history[0], 'List must not transfer all full outputs')
        self.assertEqual(json.loads(self.request('/api/history?id=' + jid)[2])['job'], self.jobs.store.get(jid))
        status, headers, body = self.request('/api/export?id=' + jid)
        self.assertEqual(status, 200)
        self.assertIn('attachment;', headers['Content-Disposition'])
        self.assertIn('text/markdown', headers['Content-Type'])
        text = body.decode()
        for value in ['PROMPT ``` <img>', 'full <script> ``` output', 'architect', 'builder', 'synthesis', 'analysis', 'gpt-5.5', 'qwen2.5-coder:0.5b', 'input_tokens', 'completed', jid]:
            self.assertIn(value, text)
        self.assertIn('````text', text, 'Output fence must not be terminated by user/model backticks')
        self.assertEqual(self.request('/api/history?id=' + jid, 'DELETE')[0], 200)
        self.assertEqual(self.request('/api/history?id=' + jid)[0], 404)
        self.assertIsNone(self.jobs.snapshot())

    def test_active_delete_bad_queries_boundary_and_storage_error(self):
        import threading
        release = threading.Event()
        self.jobs.provider = lambda *args: release.wait(2) and 'output'
        jid = self.jobs.start({'prompt': 'x'})
        try:
            self.assertEqual(self.request('/api/history?id=' + jid, 'DELETE')[0], 409)
            for path in ['/api/history?id=x&id=y', '/api/history?other=x', '/api/export', '/api/export?id=../bad']:
                self.assertEqual(self.request(path)[0], 400)
        finally:
            release.set(); self.jobs.worker.join(2)
        self.jobs.store.close()
        self.assertEqual(self.request('/api/run', 'POST', json.dumps({'prompt': 'fail closed'}))[0], 503)
        status, _, body = self.request('/api/history')
        self.assertEqual(status, 503)
        self.assertNotIn('sqlite', body.decode())


if __name__ == '__main__':
    unittest.main()
