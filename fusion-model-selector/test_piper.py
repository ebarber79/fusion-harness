"""Offline neural speech tests; never invoke paid providers."""
import importlib.util
import unittest
from pathlib import Path


class PiperCatalog(unittest.TestCase):
    def test_fixed_installed_catalog(self):
        self.assertIsNotNone(importlib.util.find_spec('offline_speech'), 'offline speech module is missing')
        import offline_speech as speech
        self.assertEqual(set(speech.VOICES), {'en_US-lessac-low', 'en_US-ryan-low', 'en_GB-alan-low'})
        catalog = speech.catalog()
        self.assertEqual(len(catalog['voices']), 4)
        local = [v for v in catalog['voices'] if v['local']]
        self.assertEqual({v['id'] for v in local}, set(speech.VOICES))
        cloud = [v for v in catalog['voices'] if not v['local']]
        self.assertEqual([(v['id'], v['cloud']) for v in cloud], [('elevenlabs-my-voice-brand', True)])
        self.assertNotIn('/home/', str(catalog))


class CloudSpeech(unittest.TestCase):
    """ElevenLabs path with the network mocked; no paid call is made."""
    request = {'voice': 'elevenlabs-my-voice-brand', 'text': 'Sample.', 'rate': 1.5}

    def test_wraps_pcm_as_mono_wav_and_clamps_speed(self):
        import io, json, tempfile, wave
        from unittest.mock import patch, MagicMock
        import offline_speech as speech
        response = MagicMock(); response.__enter__.return_value.read.return_value = b'\x01\x00' * 500
        with tempfile.TemporaryDirectory() as temp:
            key = Path(temp) / 'key'; key.write_text('test-key\n')
            vid = Path(temp) / 'voice_id'; vid.write_text('TestVoice123\n')
            with patch.object(speech, 'ELEVENLABS_KEY', key), patch.object(speech, 'ELEVENLABS_VOICE_ID', vid), \
                    patch.object(speech, 'FFMPEG', Path(temp) / 'no-ffmpeg'), \
                    patch('urllib.request.urlopen', return_value=response) as opener, \
                    patch('offline_speech.subprocess.run') as runner:
                audio = speech.synthesize(self.request)
            runner.assert_not_called()
        sent = opener.call_args.args[0]
        self.assertIn('/text-to-speech/TestVoice123?', sent.full_url)
        self.assertEqual(sent.get_header('Xi-api-key'), 'test-key')
        self.assertEqual(json.loads(sent.data)['voice_settings']['speed'], 1.2)
        with wave.open(io.BytesIO(audio), 'rb') as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 24000, 500))
        self.assertFalse(speech.CLOUD_LOCK.locked())

    def test_louder_runs_bounded_loudnorm_and_falls_back_to_original(self):
        import subprocess, tempfile
        from unittest.mock import patch
        import offline_speech as speech
        pcm = b'\x10\x00' * 100
        with tempfile.TemporaryDirectory() as temp:
            fake = Path(temp) / 'ffmpeg'; fake.write_text('')
            with patch.object(speech, 'FFMPEG', fake), patch('offline_speech.subprocess.run',
                    return_value=subprocess.CompletedProcess([], 0, stdout=b'\x20\x00' * 100)) as runner:
                self.assertEqual(speech.louder(pcm), b'\x20\x00' * 100)
            args = runner.call_args.args[0]
            self.assertIn(speech.VOICE_CHAIN, args)
            self.assertIn('loudnorm=I=-16:TP=-1.5', speech.VOICE_CHAIN)
            self.assertEqual(args.count('24000'), 2)
            self.assertEqual(runner.call_args.kwargs['timeout'], 20)
            for failure in [subprocess.TimeoutExpired('ffmpeg', 20), subprocess.CalledProcessError(1, 'ffmpeg'), OSError()]:
                with patch.object(speech, 'FFMPEG', fake), patch('offline_speech.subprocess.run', side_effect=failure):
                    self.assertEqual(speech.louder(pcm), pcm)
            for bad in [b'', b'\x01']:
                with patch.object(speech, 'FFMPEG', fake), patch('offline_speech.subprocess.run',
                        return_value=subprocess.CompletedProcess([], 0, stdout=bad)):
                    self.assertEqual(speech.louder(pcm), pcm)
            with patch.object(speech, 'FFMPEG', Path(temp) / 'missing'), patch('offline_speech.subprocess.run') as runner:
                self.assertEqual(speech.louder(pcm), pcm); runner.assert_not_called()

    @unittest.skipUnless(Path('/usr/bin/ffmpeg').is_file(), 'ffmpeg not installed')
    def test_louder_really_raises_quiet_speech_level(self):
        import array, math
        import offline_speech as speech
        tone = array.array('h', (round(800 * math.sin(i / 7) * (1 + math.sin(i / 900))) for i in range(24000 * 2)))
        rms = lambda a: math.sqrt(sum(v * v for v in a) / len(a))
        out = array.array('h', speech.louder(tone.tobytes()))
        self.assertGreater(rms(out), rms(tone) * 1.5)
        self.assertLess(max(map(abs, out)), 32767)

    def test_missing_key_or_network_error_is_unavailable(self):
        import tempfile, urllib.error
        from unittest.mock import patch
        import offline_speech as speech
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(speech, 'ELEVENLABS_KEY', Path(temp) / 'missing'), patch('urllib.request.urlopen') as opener:
                with self.assertRaises(speech.SpeechUnavailable): speech.synthesize(self.request)
                opener.assert_not_called()
            key = Path(temp) / 'key'; key.write_text('test-key')
            vid = Path(temp) / 'voice_id'
            with patch.object(speech, 'ELEVENLABS_KEY', key), patch.object(speech, 'ELEVENLABS_VOICE_ID', vid), patch('urllib.request.urlopen') as opener:
                with self.assertRaises(speech.SpeechUnavailable): speech.synthesize(self.request)
                opener.assert_not_called()
                self.assertFalse(speech.catalog()['voices'][-1]['available'])
                for bad in ['../x', 'a b', '']:
                    vid.write_text(bad); self.assertFalse(speech.cloud_configured())
                vid.write_text('TestVoice123')
                self.assertTrue(speech.catalog()['voices'][-1]['available'])
                with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('down')):
                    with self.assertRaises(speech.SpeechUnavailable): speech.synthesize(self.request)
        self.assertFalse(speech.CLOUD_LOCK.locked())


class PiperSynthesis(unittest.TestCase):
    def test_validates_bounded_fixed_voice_requests(self):
        import offline_speech as speech
        self.assertTrue(hasattr(speech, 'validate'), 'bounded speech validation is missing')
        valid = {'voice': 'en_US-lessac-low', 'text': 'Synthetic sample.', 'rate': 1}
        self.assertEqual(speech.validate(valid), ('en_US-lessac-low', 'Synthetic sample.', 1))
        for changes in [{'voice': '../../evil'}, {'voice': ['bad']}, {'text': ''}, {'text': 'x'*221}, {'text': '\x00'}, {'text': '\ud800'}, {'rate': True}, {'rate': 0}, {'rate': float('nan')}, {'path': '/tmp/foo'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                speech.validate(dict(valid, **changes))
        for value in [None, [], 'text']:
            with self.assertRaises(ValueError):
                speech.validate(value)


class PiperExecution(unittest.TestCase):
    def test_rejects_truncated_wav_payload_and_releases_lock(self):
        import offline_speech as speech
        import tempfile, wave
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            models = Path(temp)
            for suffix in ['.onnx', '.onnx.json']:
                (models / ('en_US-lessac-low' + suffix)).write_bytes(b'fixture')
            def run(args, **kw):
                with wave.open(args[-1], 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
                    wav.writeframes(b'\x01\x00' * 1000)
                target = Path(args[-1]); target.write_bytes(target.read_bytes()[:-100])
            with patch.object(speech, 'MODELS', models), patch.object(speech, 'PYTHON', Path('/usr/bin/python3')), patch('offline_speech.subprocess.run', side_effect=run):
                with self.assertRaises(speech.SpeechUnavailable):
                    speech.synthesize({'voice':'en_US-lessac-low', 'text':'Sample.', 'rate':1})
            self.assertFalse(speech.LOCK.locked())

    def test_local_subprocess_wav_cleanup_timeout_and_exclusive_lock(self):
        import offline_speech as speech
        import tempfile, wave, subprocess
        from unittest.mock import patch
        self.assertTrue(hasattr(speech, 'synthesize'), 'local synthesis is missing')
        with tempfile.TemporaryDirectory() as temp:
            models = Path(temp)
            for suffix in ['.onnx', '.onnx.json']:
                (models / ('en_US-lessac-low' + suffix)).write_bytes(b'fixture')
            seen = []
            def run(args, **kw):
                seen.append((args, kw))
                with wave.open(args[-1], 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
                    wav.writeframes(b'\x01\x00' * 1000)
            request = {'voice': 'en_US-lessac-low', 'text': 'Sample; $(never execute)', 'rate': 1}
            with patch.object(speech, 'MODELS', models), patch.object(speech, 'PYTHON', Path('/usr/bin/python3')), patch('offline_speech.subprocess.run', side_effect=run):
                result = speech.synthesize(request)
                self.assertEqual(result[:4], b'RIFF')
                args, kw = seen[0]
                self.assertEqual(kw['input'], request['text'].encode())
                self.assertNotIn(request['text'], args)
                self.assertFalse(kw.get('shell', False))
                self.assertEqual(kw['timeout'], 45)
                self.assertNotIn('OPENAI_API_KEY', kw['env'])
                self.assertFalse(Path(args[-1]).exists(), 'WAV removed after response')
                speech.LOCK.acquire()
                try:
                    with self.assertRaises(speech.SpeechBusy): speech.synthesize(request)
                    self.assertEqual(len(seen), 1)
                finally: speech.LOCK.release()
            with patch.object(speech, 'MODELS', models), patch('offline_speech.subprocess.run', side_effect=subprocess.TimeoutExpired('piper', 45)):
                with self.assertRaises(speech.SpeechUnavailable): speech.synthesize(request)
            self.assertFalse(speech.LOCK.locked())
            with patch.object(speech, 'MODELS', models / 'missing'), patch('offline_speech.subprocess.run') as runner:
                with self.assertRaises(speech.SpeechUnavailable): speech.synthesize(request)
                runner.assert_not_called()


class PiperWorker(unittest.TestCase):
    def test_worker_limits_onnx_threads_and_writes_local_audio(self):
        import importlib.util, io, json, tempfile, types, wave
        from unittest.mock import Mock, patch
        self.assertIsNotNone(importlib.util.find_spec('piper_worker'), 'single-thread local worker is missing')
        import piper_worker
        options = types.SimpleNamespace()
        ort = types.SimpleNamespace(SessionOptions=lambda: options, InferenceSession=Mock(return_value='session'), disable_telemetry_events=Mock())
        def output(text, wav, **kw):
            self.assertEqual(text, 'Sample text')
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b'\x01\x00'*100)
        voice = Mock(); voice.synthesize_wav.side_effect = output
        piper = types.SimpleNamespace(PiperVoice=Mock(return_value=voice), SynthesisConfig=Mock())
        config = types.SimpleNamespace(PiperConfig=types.SimpleNamespace(from_dict=lambda value: value))
        with tempfile.TemporaryDirectory() as temp:
            model = Path(temp) / 'voice.onnx'; Path(str(model)+'.json').write_text('{}')
            target = Path(temp) / 'out.wav'
            with patch.dict('sys.modules', {'onnxruntime': ort, 'piper': piper, 'piper.config': config}), patch('sys.stdin', io.StringIO('Sample text')):
                piper_worker.run(str(model), 1, str(target))
            self.assertTrue(target.is_file())
        self.assertEqual(options.intra_op_num_threads, 1)
        self.assertEqual(options.inter_op_num_threads, 1)
        ort.disable_telemetry_events.assert_called_once()
        self.assertEqual(ort.InferenceSession.call_args.kwargs['providers'], ['CPUExecutionProvider'])
        # Piper peak-normalizes to full scale; volume below 1 leaves headroom against clipping.
        self.assertEqual(piper.SynthesisConfig.call_args.kwargs.get('volume'), 0.8)
        self.assertEqual(piper.SynthesisConfig.call_args.kwargs.get('length_scale'), 1)


class PiperHTTP(unittest.TestCase):
    def setUp(self):
        import fusion, threading
        class NoJobs:
            def close(self): pass
        self.server = fusion.make_server(0, NoJobs())
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.cleanup)
        self.port = self.server.server_address[1]

    def cleanup(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, path, data=None, headers=None):
        import http.client, json
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        h = {'Origin': f'http://127.0.0.1:{self.port}', 'Content-Type': 'application/json'}
        h.update(headers or {})
        try:
            connection.request('POST' if data is not None else 'GET', path, json.dumps(data) if data is not None else None, h)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally: connection.close()

    def test_catalog_and_synthesis_share_existing_host_origin_security(self):
        import json, offline_speech
        from unittest.mock import patch
        status, headers, body = self.request('/api/speech/voices')
        self.assertEqual(status, 200, 'offline catalog endpoint missing')
        self.assertEqual(len(json.loads(body)['voices']), 4)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.request('/api/speech/voices?path=evil')[0], 400)
        sample = {'voice':'en_US-lessac-low', 'text':'Synthetic sample', 'rate':1}
        with patch('offline_speech.synthesize', return_value=b'RIFFfixture') as synth:
            status, headers, body = self.request('/api/speech', sample)
            self.assertEqual(status, 200)
            self.assertEqual(body, b'RIFFfixture')
            self.assertEqual(headers['Content-Type'], 'audio/wav')
            self.assertIn("media-src 'self' blob:", headers['Content-Security-Policy'])
            for header in [{'Host':'evil.test'}, {'Origin':'https://evil.test'}, {'Sec-Fetch-Site':'cross-site'}]:
                self.assertEqual(self.request('/api/speech', sample, header)[0], 403)
            synth.assert_called_once_with(sample)
        self.assertEqual(self.request('/api/speech', dict(sample, path='/tmp/a'))[0], 400)
        self.assertEqual(self.request('/api/speech', sample, {'Content-Type':'text/plain'})[0], 415)
        self.assertEqual(self.request('/api/speech', dict(sample, text='a'*3000))[0], 413)
        for error, expected in [(offline_speech.SpeechBusy(), 409), (offline_speech.SpeechUnavailable(), 503)]:
            with patch('offline_speech.synthesize', side_effect=error):
                self.assertEqual(self.request('/api/speech', sample)[0], expected)


if __name__ == '__main__':
    unittest.main()
