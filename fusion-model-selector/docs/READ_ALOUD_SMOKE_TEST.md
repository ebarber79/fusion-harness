# Fusion Real Read-Aloud Smoke Test

## Cause of grey buttons

The original desktop Chromium process (PID 5329 at investigation) was launched without --enable-speech-dispatcher. Installed system voices and /etc/chromium.d/90-fusion-read-aloud cannot change an already running process. Its launch arguments confirmed the missing flag. Reloading a tab cannot activate it. No original user browser was closed.

## Working window and launcher

A separate graphical Chromium app window was launched at http://localhost:8766/ with local speech enabled and its own profile /home/siegepi10/.config/fusion-read-aloud-browser. On the actual live page, the local English (America) espeak-ng voice was selected; 14,805 local variants were enumerated. All four stored outputs were nonempty and all four Read aloud buttons were enabled. Pause and Stop intentionally remain disabled until playback starts.

Application-menu shortcut: Fusion Read Aloud.
Wrapper: /home/siegepi10/.local/bin/fusion-read-aloud
Desktop entry: /home/siegepi10/.local/share/applications/fusion-read-aloud.desktop

The separate profile avoids Chromium forwarding launch requests to the older process lacking speech support. It has separate browser preferences; Fusion's server-side saved history remains shared and unchanged. Fully exit/reopen ordinary Chromium to activate speech there instead.

## Real page smoke test

Native CDP mouse events clicked the actual live Fusion Read aloud buttons, not an isolated speech fixture, using the existing stored Architect, Builder, Synthesis and Reasoning / Divergence outputs. Each reached Playing and Stop cancelled playback. No synthetic text was injected into the app and no new AI job was submitted.

The initial real test exposed unsupported native Linux pause: the page said Paused while native speaking remained true. A cancel/replay fallback was added with RED-first tests. A second real check exposed that invoking native eSpeak pause/resume could wedge subsequent playback. The final eSpeak path avoids these native calls, cancels immediately, invalidates old callbacks, and resumes by replaying only the interrupted chunk (at most 220 characters). Other voices retain native pause when supported. No following output chunks are dropped.

Final real GUI/native states:

- Playing Architect: speaking true.
- Paused Architect: speaking false.
- Resumed Architect: Playing, speaking true.
- Stopped: speaking false.

Final desktop-output verification used a temporary owner-private WAV recording of the HDMI sink monitor, not microphone input. Format: 16 kHz, mono, 16-bit PCM. Excluding transition buffers, measured RMS sample amplitudes were baseline 0; playing 5476.16; paused 0; resumed 5668.44; stopped 0. Thus audio signal was generated, removed on pause, restored on resume, and removed on stop. Recordings were deleted automatically; neither audio nor answer text is included in this report. This proves digital output signal and silence transitions, not subjective listening quality or speaker connectivity.

A full Builder completion attempt was interrupted by a live stage change/stop in the visible window; it did not reach Finished and is not counted as a passed full-answer test. Final start/stop retesting after the fix independently verified Playing for all four stages. Lossless whole-output chunk sequencing is covered by automated tests; complete physical-speaker playback of an entire long answer was not established.

## Verification and deployment

- Original speech tests: 10 passed before fixes.
- First fallback RED: 15 tests, 11 pass, 4 expected fail; GREEN: 15 pass.
- eSpeak queue-wedge regression RED: 16 tests, 15 pass, 1 expected fail; final GREEN included in complete suite.
- Final Node suite: 68 passed, zero failures/skips.
- Final Python suite: 111 discovered, overall OK, 7 pre-existing skips.
- Wrapper sh -n and desktop-file-validate: passed; application menu database refreshed.

Changed static/app.js and test_speech_ui.js plus documentation/launcher. Saved and live-served, with no backend restart. Existing user browser and Fusion history/model routing were preserved. No paid generation. No commit or push. The working verification window was left available to the user; its temporary CDP listener is loopback-only and goes away when that dedicated browser exits. Subsequent launcher starts omit the debugging flag.
