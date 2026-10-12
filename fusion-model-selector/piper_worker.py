"""One CPU-only Piper chunk per process; no downloads or persistent model cache."""
import json
from pathlib import Path
import sys
import wave


def run(model, rate, target):
    import onnxruntime
    from piper import PiperVoice, SynthesisConfig
    from piper.config import PiperConfig

    onnxruntime.disable_telemetry_events()
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    config = json.loads(Path(model + '.json').read_text())
    voice = PiperVoice(
        config=PiperConfig.from_dict(config),
        session=onnxruntime.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider']),
        use_tashkeel=False,
    )
    with wave.open(target, 'wb') as wav:
        # Piper peak-normalizes each clip to full scale; 0.8 keeps ~2 dB headroom against clipping.
        voice.synthesize_wav(sys.stdin.read(221), wav, syn_config=SynthesisConfig(length_scale=1 / rate, volume=0.8))


if __name__ == '__main__':
    run(sys.argv[1], float(sys.argv[2]), sys.argv[3])
