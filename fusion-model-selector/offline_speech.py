"""Bounded local Piper speech. Model downloads are never performed at runtime."""
from pathlib import Path
import io
import re
import subprocess
import tempfile
import threading
import wave

LOCK = threading.Lock()
MAX_WAV = 4_000_000


class SpeechBusy(Exception):
    pass


class SpeechUnavailable(Exception):
    pass


def synthesize(data):
    voice, text, rate = validate(data)
    if voice in CLOUD_VOICES:
        return cloud_synthesize(voice, text, rate)
    if not LOCK.acquire(blocking=False):
        raise SpeechBusy('Offline voice is busy. Try again shortly.')
    try:
        model = MODELS / (voice + '.onnx')
        if not PYTHON.is_file() or not model.is_file() or not Path(str(model) + '.json').is_file():
            raise SpeechUnavailable('Offline voice is not installed.')
        with tempfile.TemporaryDirectory(prefix='fusion-speech-') as temp:
            wav_path = Path(temp) / 'speech.wav'
            subprocess.run(
                [str(PYTHON), str(Path(__file__).with_name('piper_worker.py')),
                 str(model), str(rate), str(wav_path)],
                input=text.encode('utf-8'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                check=True, timeout=45,
                env={'PATH': '/usr/bin:/bin', 'HOME': str(HOME), 'OMP_NUM_THREADS': '1',
                     'OPENBLAS_NUM_THREADS': '1'}, cwd=temp,
            )
            if not 44 < wav_path.stat().st_size <= MAX_WAV:
                raise SpeechUnavailable('Offline synthesis failed.')
            result = wav_path.read_bytes()
            with wave.open(io.BytesIO(result), 'rb') as wav:
                if (wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getnframes() < 1
                        or len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2):
                    raise SpeechUnavailable('Offline synthesis failed.')
            return result
    except (OSError, subprocess.SubprocessError, wave.Error, EOFError):
        raise SpeechUnavailable('Offline synthesis failed or timed out.') from None
    finally:
        LOCK.release()


HOME = Path.home() / '.local/share/fusion-piper'
PYTHON = HOME / 'venv/bin/python'
MODELS = HOME / 'voices'
VOICES = {
    'en_US-lessac-low': ('Lessac — Piper neural', 'en-US'),
    'en_US-ryan-low': ('Ryan — Piper neural', 'en-US'),
    'en_GB-alan-low': ('Alan — Piper neural', 'en-GB'),
}


# Opt-in cloud voices: chosen explicitly in the UI, never a fallback. Text goes to ElevenLabs (billed credits).
# The account-specific voice ID lives in a local file, not in source: ~/.config/elevenlabs/voice_id.
ELEVENLABS_KEY = Path.home() / '.config/elevenlabs/key'
ELEVENLABS_VOICE_ID = Path.home() / '.config/elevenlabs/voice_id'
ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech/{}?output_format=pcm_22050'
CLOUD_VOICES = {
    'elevenlabs-my-voice-brand': ('My Voice – Brand — ElevenLabs cloud', 'en-US'),
}


def cloud_configured():
    try:
        return bool(ELEVENLABS_KEY.read_text().strip()) and re.fullmatch(r'[A-Za-z0-9]{8,64}', ELEVENLABS_VOICE_ID.read_text().strip()) is not None
    except OSError:
        return False
CLOUD_LOCK = threading.Lock()


def cloud_synthesize(voice, text, rate):
    import json
    import urllib.request
    if not CLOUD_LOCK.acquire(blocking=False):
        raise SpeechBusy('Cloud voice is busy. Try again shortly.')
    try:
        if not cloud_configured():
            raise SpeechUnavailable('ElevenLabs key or voice ID is not configured.')
        key, voice_id = ELEVENLABS_KEY.read_text().strip(), ELEVENLABS_VOICE_ID.read_text().strip()
        # Model isn't stored per voice; the voice's saved settings (stability 0.65 etc.) apply. ElevenLabs speed is 0.7–1.2.
        body = json.dumps({'text': text, 'model_id': 'eleven_multilingual_v2',
                           'voice_settings': {'speed': min(1.2, max(0.7, rate))}}).encode()
        request = urllib.request.Request(ELEVENLABS_URL.format(voice_id), data=body, method='POST',
                                         headers={'xi-api-key': key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=45) as response:
            pcm = response.read(MAX_WAV)
        if not pcm or len(pcm) % 2:
            raise SpeechUnavailable('Cloud synthesis failed.')
        out = io.BytesIO()
        with wave.open(out, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(22050); wav.writeframes(pcm)
        return out.getvalue()
    except (OSError, ValueError):
        raise SpeechUnavailable('Cloud synthesis failed or timed out.') from None
    finally:
        CLOUD_LOCK.release()


def validate(data):
    if not isinstance(data, dict) or set(data) != {'voice', 'text', 'rate'}:
        raise ValueError('Expected voice, text and rate only.')
    voice, text, rate = data['voice'], data['text'], data['rate']
    if not isinstance(voice, str) or voice not in VOICES and voice not in CLOUD_VOICES:
        raise ValueError('Unknown offline voice.')
    if (not isinstance(text, str) or not text.strip() or len(text) > 220
            or any(ord(c) < 32 and c not in '\n\r\t' or 0xD800 <= ord(c) <= 0xDFFF for c in text)):
        raise ValueError('Speech text must contain 1–220 valid characters.')
    if type(rate) not in (int, float) or not 0.5 <= rate <= 2:
        raise ValueError('Speech rate must be between 0.5 and 2.')
    return voice, text, rate


def catalog():
    return {'voices': [
        {'id': key, 'name': name, 'lang': lang, 'local': True,
         'available': PYTHON.is_file() and (MODELS / (key + '.onnx')).is_file()
                      and (MODELS / (key + '.onnx.json')).is_file()}
        for key, (name, lang) in VOICES.items()
    ] + [
        {'id': key, 'name': name, 'lang': lang, 'local': False, 'cloud': True, 'available': cloud_configured()}
        for key, (name, lang) in CLOUD_VOICES.items()
    ]}
