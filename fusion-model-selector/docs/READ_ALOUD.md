# Fusion Read Aloud

## Installed and live-served

Target: http://localhost:8766/ — /home/siegepi10/fusion-model-selector.

Read aloud buttons are available beside each Architect, Builder, Synthesis (fused answer), and Reasoning / Divergence output. Global controls above the outputs provide Voice, Speed (0.75×–2×), Pause / Resume and Stop. Empty outputs cannot be spoken. Playback is never automatic.

## Real-page smoke test follow-up

The original running Chromium session lacked the speech flag. Use the new application-menu shortcut Fusion Read Aloud (wrapper /home/siegepi10/.local/bin/fusion-read-aloud) to open a separate speech-enabled window without interrupting your main browser. Real saved-output buttons, native playback and HDMI output signal have now been tested. eSpeak Pause uses immediate cancellation; Resume replays the interrupted chunk (up to 220 characters), avoiding unsupported Linux native pause/resume calls. See the Desktop Fusion_Read_Aloud_Smoke_Test.md report for measured results and the full-completion limitation. The latest final suites are 68 Node tests passed and 111 Python tests discovered with 7 existing skips. Changes remain saved/live-served, not committed or pushed.

## First use on this Raspberry Pi

1. Save any unsaved browser work, fully quit Chromium, then reopen it. Existing Chromium processes do not pick up new startup flags merely by reloading a page. No browser processes were closed for you.
2. Open http://localhost:8766/ and refresh with Ctrl+Shift+R to load current assets.
3. Under Results, choose an English voice labelled local and a speed. The default now prefers a local voice matching the browser language.
4. Click Read aloud beside the output you want. Use the shared Pause / Resume and Stop controls above the outputs.
5. Existing saved outputs can be read without running Fusion again.

## Local speech support installed

Installed Debian packages: speech-dispatcher, speech-dispatcher-espeak-ng, espeak-ng and dependencies. Speech Dispatcher user socket is enabled and was verified active. The espeak-ng output module is available.

Chromium on this system requires --enable-speech-dispatcher to expose these installed voices. Configuration is saved in /etc/chromium.d/90-fusion-read-aloud; source copy is docs/chromium-speech-flags.conf. The flag applies to Chromium launches, not just Fusion, and takes effect after a complete browser exit/relaunch. Existing browser sessions were deliberately preserved.

Local eSpeak voices are functional but synthetic/robotic compared with premium neural voices. The browser reported 14,805 local voice/language variants in the test session; this is not a count of separately installed neural models.

## Behavior, privacy and limits

- Read aloud makes no Fusion model/provider generation request and carries no additional Fusion AI API charge.
- Local voices synthesize on this machine. Remote voices, if offered by a different browser, may send output text to the browser speech provider; the selector labels this explicitly. Local voices are preferred.
- Output is spoken as raw text, including Markdown/code; displayed and copied output is unchanged.
- Long output is delivered in sequential chunks up to 220 UTF-16 characters, without text truncation or splitting surrogate pairs.
- Reading a different stage cancels the current one. Changing the displayed job/output, voice/speed, or leaving the page stops playback. Unchanged polling does not restart or interrupt it.
- Voice/speed choices last for the current page; they are not persisted across reloads.
- Unsupported browsers or missing voices show truthful guidance and disable read buttons. Playback errors are reported rather than treated as success.
- Reading does not cancel a Fusion job. Browser close still does not cancel backend generation.

## Verification

Incremental worker TDD checkpoints were reported for markup/support, voice discovery, chunked playback, pause/resume/cancellation, polling/view lifecycle, and errors/options. Each new slice was observed RED before GREEN. Responsive CSS was observed RED in the full Node suite before parent implementation. Parent also observed the language-default test fail (Afrikaans selected instead of English) and then implemented language-aware local selection.

Final independent commands in the project:

- node --test test_*.js: 62 passed, 0 failed, 0 skipped. Includes 10 speech tests and all pre-existing Node tests unchanged.
- python3 -m unittest discover -q: 111 discovered, 7 pre-existing mobile-feature skips, overall OK. Providers/storage use offline test fixtures. Setup messages emitted by mocked credential tests do not mean live credentials were changed.

Live-served HTML, JavaScript and CSS were fetched from port 8766. Live browser rendering showed the added four buttons and global controls. The original test/browser session started before speech enablement correctly showed no voices.

A separate fresh Chromium verification process with --enable-speech-dispatcher discovered local voices. Using actual served markup and the isolated real speech block with only synthetic sample text, native speech callbacks/status progressed Starting Architect read aloud → Playing Architect → Finished reading Architect. The voice was English (America) espeak-ng, local. This confirms native browser speech lifecycle, not subjective audible quality at the user's speakers.

Isolated responsive checks with actual served CSS inlined measured 390, 768 and 1280px viewports, no horizontal overflow, and all speech controls within the viewport. An initial test loaded stale linked CSS; actual current CSS was then inlined to verify geometry. These are emulated layout checks, not physical phone testing.

## Change/deployment status

Changed static/app.js, static/index.html, static/style.css. Added test_speech_ui.js, docs/READ_ALOUD.md, docs/chromium-speech-flags.conf, README documentation and this Desktop report.

Saved and live-served: yes; backend static assets are read on request. Backend restart: not needed and not performed. Paid AI generation: not performed. Model routing, saved history and neighboring apps at other ports were not modified. Existing uncommitted work was preserved. Committed: no. Pushed: no. User's existing Chromium session still requires full exit/relaunch for voice activation; no application/browsing session was forcibly closed.

## Troubleshooting

If the voice list is empty, fully quit/reopen Chromium (closing only the Fusion tab is insufficient), then hard refresh Fusion. Check that speech-dispatcher.socket is active using systemctl --user status speech-dispatcher.socket. If playback reports failure, try another local English voice and verify the desktop audio output/volume. The installed engine is local to the Pi; other devices need their own browser voices.
