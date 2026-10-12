# Fusion offline Piper neural speech

## Status: installed and deployed (2026-10-10); browser playback not yet verified

On 2026-10-10 all three voices were installed and only fusion-model-selector.service was restarted (no run was active; fusion.service on port 8765 and fusion-next.service were untouched; 9 saved runs remained). The original port-8766 process predated the speech backend, which is why /api/speech/voices previously returned 404.

- Source: https://huggingface.co/rhasspy/piper-voices, revision v1.0.0, files `en/<locale>/<name>/low/<voice>.onnx` and `.onnx.json`. Downloaded to a staging directory, then copied into /home/siegepi10/.local/share/fusion-piper/voices.
- Each .onnx SHA-256 matched Hugging Face's `x-linked-etag` header; each .onnx.json parsed as valid JSON.

| Voice | Bytes | SHA-256 |
|---|---|---|
| en_US-lessac-low | 63201294 | f7d01dde371555732c4c314111ac79672b1a5ce2fc19266ab42178fd8df7f375 |
| en_US-ryan-low | 63104526 | 8d21a085cc4c0010f1f3e91d5008c8691277ccfa744eb0d747becd33a3444baf |
| en_GB-alan-low | 63104526 | a1f60584620a2bed203de823d08f5abb336fb15f3d6f33f8c341e3e2cabf5dde |

Live checks on localhost:8766 after the restart:
- GET /api/speech/voices returned `available: true` for all three voices.
- POST /api/speech with a 35-character synthetic sentence returned HTTP 200 for each voice in about 4.1–4.2 s: mono 16-bit 16 kHz WAV, 2.0–2.6 s of non-silent audio (RMS 5000–7900).
- A 220-character chunk (Lessac) took 6.0 s to synthesize and produced 12.9 s of audio. Chunks are requested one after another, so expect a gap of up to about 6 s between chunks during long readings.
- `python3 -m unittest test_piper` (6 passed) and `node --test test_speech_ui.js` (23 passed).

Still not verified: actual playback through a browser and speaker, Pause/Resume/Stop in the real page, and review of each voice's MODEL_CARD/license. The section below records the earlier blocked state for history.

## Earlier status: implementation saved and offline-tested; installation/deployment blocked

The resumed work preserved the prior worker's offline_speech.py, piper_worker.py, test_piper.py, backend routes and frontend implementation. Nothing was committed or pushed, no paid generation was submitted, and neither Fusion service was restarted. PID 1176 was observed in the initial process inventory; it is not claimed as a newly deployed backend.

The installed runtime was found at /home/siegepi10/.local/share/fusion-piper/venv, including piper_tts-1.4.2.dist-info and the Piper library. The required voices directory was absent on discovery. A directory was created and model downloads attempted, but downloads failed with TLS EOF/connection timeouts. A later command including an asset download was denied. Active-job inspection commands and a later local probe were also denied. These denials were respected: no alternate active-job inspection, restart, or bypass of the denied download/probe was performed.

Therefore the requested fully installed/deployed offline voice feature is NOT complete. Actual neural WAV synthesis, physical speaker playback, and live port-8766 speech endpoints are NOT verified. Existing browser speech is preserved.

## Implemented behavior

- The same Voice dropdown offers Lessac (en_US-lessac-low), Ryan (en_US-ryan-low), and Alan (en_GB-alan-low), alongside existing browser voices.
- Piper entries are explicitly offline/local neural; missing installations are disabled. Explicit voice selections survive voiceschanged events and never silently fall back to remote speech.
- All four output buttons use the selected voice and speed; Piper uses HTML Audio without needing Web Speech or Speech Dispatcher.
- Complete text is divided into lossless chunks of at most 220 UTF-16 code units without splitting surrogate pairs. Silent whitespace-only Piper chunks are skipped to avoid invalid synthesis requests; spoken chunks are not trimmed.
- Pause/Resume retains the WAV position; Stop aborts fetch, stops audio, releases blob URLs, and invalidates late callbacks. Changed displayed run/output, changed voice/speed and pagehide stop playback. Unchanged polling does not interrupt it.
- The local server validates a fixed allowlist, text and rate; it starts only one CPU-only subprocess at a time, with one ONNX intra/inter-op thread, CPU arena disabled and telemetry disabled. Only an isolated minimal environment is forwarded, never provider credentials.
- Worker deadline: 45 seconds. Maximum WAV: 4,000,000 bytes. PCM must be mono 16-bit, nonempty and contain the full declared frame payload. Temporary files are removed after the response.
- Runtime does not download models. Browser cancellation does not immediately kill an already-running server-side chunk; it finishes or times out, during which another request may receive 409 busy.

## Endpoint contracts verified on an isolated test server

`python3 -m unittest test_piper -v` executed six tests, all passing. The HTTP test uses an ephemeral loopback port, an injected no-job object and a mocked synthesis transport; it does not read live history or run providers.

- GET /api/speech/voices -> 200 JSON catalog, no-store; query parameters -> 400.
- POST /api/speech -> 200 audio/wav with media-src 'self' blob: CSP when synthesis succeeds.
- Foreign Host, Origin or cross-site fetch metadata -> 403 before synthesis.
- Unknown fields/invalid text/voice/rate -> 400; non-JSON -> 415; body over 2048 bytes -> 413.
- Concurrent synthesis -> 409; missing/failed/timed-out runtime -> 503.

These are isolated endpoint checks, NOT evidence that the old live process serves these routes.

## TDD and test evidence

Evidence directory: /home/siegepi10/fusion-model-selector/docs/piper/

- resume-python.txt: baseline `python3 -m unittest discover`, 116 discovered, 0 failures, 7 skipped.
- resume-node.txt: baseline `node --test test_speech_ui.js`, 21 passed.
- red-whitespace-disclosure.txt: intended failures for silent Piper chunks and missing offline/local-server disclosure.
- green-whitespace-disclosure.txt: `node --test test_speech_ui.js`, 23 passed, 0 failed/skipped.
- red-truncated-wav.txt: intended `SpeechUnavailable not raised` failure for an incomplete WAV payload.
- green-python.txt: `python3 -m unittest test_piper -v`, six passed.
- full-python.txt: final `python3 -m unittest discover`, 117 discovered, 0 failures, 7 skipped. Credential-setup messages in output are from existing mocked test fixtures, not actual key setup performed by this work.
- full-node.txt: final `node --test test_*ui.js`, 75 passed, 0 failed/skipped.
- Syntax checks succeeded: `python3 -m compileall -q offline_speech.py piper_worker.py` and `node --check static/app.js`.
- download-headers.txt (kept locally, not published: it contains a signed CDN URL) recorded the public Hugging Face model metadata/redirect for Lessac, not a completed download.

The prior worker's already-existing behavior was characterized on resumption; new RED/GREEN evidence applies specifically to the resumed fixes, not retroactively to all prior implementation.

## Remaining installation and deployment acceptance criteria

These are pending, not actions performed after denial. Reauthorization is needed for the denied operations.

1. Install the exact allowlisted model and matching JSON for each voice under /home/siegepi10/.local/share/fusion-piper/voices. Obtain MODEL_CARD/license material from the same source and review it; no claim is made that every voice has the same license. Source folders are:
   - https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/low
   - https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/ryan/low
   - https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alan/low
2. Validate complete downloads before renaming staged .part files. Lessac metadata retrieved here reports size 63201294 bytes and SHA-256 f7d01dde371555732c4c314111ac79672b1a5ce2fc19266ab42178fd8df7f375. Obtain equivalent authoritative metadata for Ryan and Alan before validating them. Do not treat an LFS pointer or a partial file as a model.
3. Run serial local synthesize calls with synthetic text for every voice, inspect nonempty mono PCM WAV frames/sample rate/signal, and save synthetic WAV/evidence outside private conversation output. No paid model run is needed.
4. With permission, inspect /api/job and history for active work, preserve useful output in a private snapshot if necessary, and recheck immediately before restarting ONLY fusion-model-selector.service. Do not touch the original Fusion service on port 8765.
5. Verify the deployed GET /api/speech/voices and POST /api/speech at localhost:8766, including all three available flags and synthetic audio. Reload the real browser, confirm all choices, and exercise actual Read aloud/Pause/Resume/Stop and changed-output cancellation. Record browser console/audio evidence separately from automated mocks.
6. Update this status, README and Desktop report only after those checks succeed.

## Files involved

Preserved prior implementation: offline_speech.py, piper_worker.py, test_piper.py, fusion.py, static/app.js and test_speech_ui.js. Resumed edits: offline_speech.py, test_piper.py, static/app.js, static/index.html, test_speech_ui.js and README.md. New report/evidence: docs/PIPER_OFFLINE.md, docs/piper/* and /home/siegepi10/Desktop/Fusion_Offline_Piper_Report.md. Existing unrelated dirty changes remain untouched.
