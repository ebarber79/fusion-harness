# Fusion model selector (independent fork)


## Verified GitHub publication

Current version: https://github.com/ebarber79/fusion-harness/tree/release/fusion-model-selector/fusion-model-selector

See [publication record](docs/PUBLICATION_2026-10-06.md) and [CHANGELOG.md](CHANGELOG.md) for tests, exclusions and exact publication scope.

## Read aloud

Each of the four output panels now has a Read aloud button, with shared local-preferred Voice, Speed, Pause / Resume and Stop controls above Results. Speech makes no Fusion AI generation request. Raspberry Pi local eSpeak NG voices and Chromium Speech Dispatcher support are installed; fully quit/reopen Chromium, then hard refresh Fusion to activate them. Remote browser voices are labelled because they may transmit output text.

See [Read aloud guide and verification](docs/READ_ALOUD.md) and [real-page/audio smoke test](docs/READ_ALOUD_SMOKE_TEST.md). The application-menu shortcut Fusion Read Aloud opens a separate speech-enabled Chromium profile; eSpeak Pause stops immediately and Resume may repeat the interrupted chunk (up to 220 characters). Existing browser sessions were preserved.

### Offline Piper neural voice choices — installed and deployed

Piper choices Lessac (`en_US-lessac-low`), Ryan (`en_US-ryan-low`) and Alan (`en_GB-alan-low`) are integrated into the same Voice dropdown without removing browser voices. Piper needs only browser HTML audio, not Chromium Speech Dispatcher. Missing voices are disabled and labelled “not installed”; there is no automatic remote fallback. Choose an installed Piper voice and use any of the four Read aloud buttons. Pause/Resume retains the current WAV playback position; Stop cancels the browser request and releases the audio URL. Full output is read in bounded chunks, skipping silent whitespace chunks.

The backend adds `GET /api/speech/voices` and `POST /api/speech`, with existing Host/Origin protections, fixed voice IDs, 1–220-character requests, rates 0.5–2, serial CPU-only inference, a 45-second process timeout and temporary WAV cleanup. Speech sends text to the local Fusion server, not an AI/cloud speech provider. Runtime never downloads weights. Stopping a browser request cannot instantly kill an already-running backend chunk; it finishes or times out, and another request can report busy.

Current status (2026-10-10): Piper TTS 1.4.2 is in `~/.local/share/fusion-piper/venv` and all three voice models are installed in `~/.local/share/fusion-piper/voices` (Hugging Face `rhasspy/piper-voices` v1.0.0, SHA-256 checksums verified). Only `fusion-model-selector.service` was restarted, with no active run. On localhost:8766, `/api/speech/voices` reports all three voices available, and `/api/speech` returned valid, non-silent WAV audio for each. A full 220-character chunk takes about 6 seconds to synthesize on the Pi, so long readings pause briefly between chunks. Hard-refresh open Fusion tabs to load the voices. Playback through the browser and speaker has not been verified yet. No commit, push or paid calls were made.

Offline verification after the fixes: 117 Python tests discovered (0 failures, 7 skipped), 75 Node UI tests passed, and syntax checks passed. Six Piper Python tests cover catalog, validation, serial subprocess/timeout/cleanup, WAV integrity, worker CPU/telemetry options and isolated HTTP contracts; 23 speech UI tests cover Piper plus existing browser speech. See [Piper implementation and evidence](docs/PIPER_OFFLINE.md) for exact commands, endpoints, installation requirements and pending checks.

## Output copying and change documentation

Each output panel has a small Copy button beside its title. Click it to copy the full output text without highlighting. Empty outputs disable the button; successful copying shows “Copied!”. If browser clipboard permissions block copying, the UI reports the problem and manual selection remains available. Refresh the page (Ctrl+Shift+R if needed) to load updated controls.

See [CHANGELOG.md](CHANGELOG.md) for changes, verification evidence, limitations, and saved/deployed versus committed/pushed status. Documentation does not imply changes have been published to GitHub.

Open http://localhost:8766 on the Pi. This app lives at /home/siegepi10/fusion-model-selector. The original /home/siegepi10/fusion on port 8765 is independent and must not be restarted or modified when deploying this fork.

## Prompt-first interface

The request textarea is now the first form input, with goal/constraints/result guidance and a separate Model selection section below. Model routing, fallback, defaults, run submission, four output panels, and history behavior are unchanged. Refresh the browser to load the live-served HTML/CSS; no backend restart is required.

Verification: the new order contract was observed failing before implementation, then all 34 Node UI tests passed (`node --test test_*ui.js`). The live browser at localhost:8766 confirmed prompt-first order and no horizontal overflow at a measured 1280px viewport. Visual inspection found no overlapping request controls; selected model text remains truncated and is a subsequent cleanup item. Backend tests, paid generation, and real-phone access were not exercised for this markup/CSS-only pass. Changes are saved and live-served, not committed or pushed.

## Model-section readability

The model fields now have short role-first labels: Architect, Builder, and Synthesis & comparison. Their desktop input tops align. Wrapping next-run summaries beneath Architect and Builder display the full model ID and local/cloud provider; the default architect summary follows synthesis-input edits. Empty selections request an available model rather than implying a selection. Native dropdown text can still truncate long metadata, but the model ID is readable separately. Routing, catalog verification, saved preferences, and historical output identity are unchanged.

Verification: both new contracts failed before implementation; all 36 Node UI tests then passed. Live visual inspection verified aligned controls and full model summaries. Script-free same-origin frames measured widths 390/768/1280px with one/two/three model columns respectively and no horizontal overflow. These are layout checks, not real-phone tests. No generation, service restart, backend change, commit, or push occurred. HTML/CSS/JavaScript changes are saved and live-served; refresh your browser.

## Advanced settings and Run Fusion action

Architect fallback now lives in a closed native “Advanced settings · architect fallback” disclosure below the primary model grid. Opening it reveals the existing checkbox and its current routing/availability status together, without another nested disclosure. Closing it does not disable an enabled fallback or reset saved preferences; verified-availability defaults and one-attempt semantics remain unchanged. The visible safety summary and all cloud routing/billing disclosures remain intact.

The Run Fusion row has its own divider and concise guidance: “Review your request and models, then run architecture → build → synthesis → comparison.” This describes the four-stage workflow, not a readiness or price guarantee. Connection/run status stays beside the button; errors remain outside all collapsed settings. Prompt-first order, concise model labels, every existing control ID, defaults, JavaScript, backend routing, immutable output identity, and history are preserved. Results/history layout is unchanged.

Verification: each new contract was observed failing before its implementation, then `node --test test_*ui.js` passed all 38 tests (0 failed/skipped). Six related Python markup/disclosure contracts passed offline; the full backend suite and deferred mobile-access tests were not run. Live localhost:8766 rendering confirmed closed-by-default settings, native expansion/collapse, visible run status, aligned model inputs, and no console messages or JavaScript errors. Script-free frames using the real same-origin `/style.css` measured 390/768/1280px viewports with one/two/three model columns and no horizontal overflow, including expanded fallback plus long fixture status/error text. These are isolated layout checks, not real-phone tests or generation/readiness verification. No jobs submitted, history changes, credential inspection, service restart, commit, or push occurred. Changes are saved and live-served; refresh the browser. Desktop evidence: `/home/siegepi10/Desktop/Fusion_Advanced_Settings_Action_Row.md`.

## Compact results and full-width reading

Empty output panels now show compact, accessible guidance instead of tall blank preformatted boxes. Messages distinguish no run, a stage in progress, waiting for earlier stages, terminal errors/interruption, a completed stage returning no text, and stages missing from legacy saved runs. Actual status, errors, provider/model identity, and reported/unknown usage remain visible.

Each panel has a keyboard-accessible Full width button beside Copy. Available original text enables the control; it expands that panel across the results grid, then Grid width collapses it. Multiple panels can expand independently. Expansion survives same-run polling but resets when another run is displayed, on reset, or when that panel loses its content. On a phone the grid is already one column. This is a width change, not fullscreen or Markdown rendering: raw text, exact copying, focusable preformatted scrolling, and the existing 70vh height bound remain intact. Earlier preserved outputs remain readable even if a later stage fails.

Verification: eight new results contracts failed before production changes; the separately added click-wiring contract also failed before its implementation. Final explicit `node --test test_*ui.js`: 47 passed, 0 failed/skipped. Five related Python markup/disclosure tests passed offline. The existing CSS test helper needed a complete-selector boundary fix so `pre` would not accidentally match `.panel pre`; font/wrapping assertions were retained. Live localhost:8766 verification confirmed four nonempty original outputs, full-width expansion/collapse without changing raw text, working bounded overflow, and no console/JavaScript errors. Script-free same-origin frames loaded actual external `/style.css` at measured 390/768/1280px widths: idle/completed/expanded/collapsed states had no horizontal page overflow, one/two/two output columns, and one/two/three model columns. Long literal output/provider fixtures stayed contained.

These are saved and live-served frontend changes, not committed or pushed. Refresh your browser to load them; no service restart occurred. Full backend/provider suites, paid generation, real-phone access and screen-reader testing were not exercised. No jobs were submitted, credentials inspected, history modified, dependencies added, or TypeSafe installation files changed/integrated. Desktop report: `/home/siegepi10/Desktop/Fusion_Compact_Results_Full_Width_Reading.md`.

## Usage and history interface

Reference: FUSION-8766-USAGE-HISTORY-UI. The usage card presents a short reported-total/coverage summary. Partial coverage is explicitly “Known reported total” and “partial/incomplete”, never a full-run total or money estimate. A visible accounting limit distinguishes tokens from prices and unknown from zero. Native Counts & coverage details retains the original input/output/total coverage and failed-attempt information; all four stage counts remain accessible in their native Reported tokens disclosures. Idle/reset and legacy missing-usage states remain truthful.

History now separates browsing/navigation from viewed-run export/delete actions, with the existing view status immediately beneath the selector. Viewed run prompt is a closed native disclosure retaining its raw, focusable, bounded preformatted text. Export stays before the destructive delete action; confirmations, active-run protections, history races/preferences and immutable provider/model identity are unchanged. Privacy text remains visible. No history behavior or backend was changed.

Verification: four incremental usage/history contracts were observed RED before their corresponding implementation; a fifth test characterizes zero/invalid counts and repeated polling. The original 47 plus five new scoped Node tests passed (52/52; 0 failed/skipped). Five explicitly selected Python markup/disclosure tests passed offline; JavaScript syntax passed. The earlier wildcard checkpoint during concurrent Read aloud implementation discovered 58 tests, with 57 passing and one speech integration failure. A subsequent stabilization rerun of `node --test --test-reporter=spec test_*ui.js` now discovers 75 tests, all passing with no failures/skips, including browser-speech and Piper frontend contracts. JavaScript syntax and the five selected offline Python markup/disclosure tests also pass. No production code changes were needed for this stabilization check. This verifies offline UI contracts, not deployed Piper synthesis or audible playback. The fresh browser verification attempt returned an empty page and then timed out; an HTTP check returned 200, but a further served-asset probe was denied and was not retried. Earlier visual evidence below is historical, not fresh browser acceptance. See `/home/siegepi10/Desktop/Fusion_UI_Stabilization_Verification.md`. Actual localhost:8766 visual inspection showed readable usage/history hierarchy, no overlap or page overflow, working native disclosures and unchanged raw outputs; console messages/JavaScript errors were empty. Script-free same-origin frames loaded actual `/style.css` at measured 390/768/1280px widths, with no page overflow in closed-idle and expanded-long-usage/history fixtures. Model columns were one/two/three and output columns one/two/two. No real-phone or screen-reader check, generation, live export/delete, credential inspection, dependency installation, backend restart/change, commit or push was performed. These frontend changes are saved and live-served; reload the browser. Exact evidence and exclusions: `/home/siegepi10/Desktop/Fusion_Usage_History_Interface.md`.

## Workflow and controls

1. OpenAI architect receives the user request (gpt-5.5 by default), or a selected catalog-verified Claude architect does. An enabled verified Claude fallback receives the same request once if the OpenAI architect fails.
2. The selected installed Ollama local, Grok / xAI cloud, or Perplexity cloud builder receives the request and architecture.
3. OpenAI synthesis receives the request, architecture, and builder output.
4. OpenAI Reasoning / Divergence analysis runs AFTER synthesis, receiving the request and all three visible outputs using the same OpenAI model as synthesis. This adds API cost and sequential latency. It is a user-facing output comparison, not hidden chain of thought: concise agreements and divergences cite visible evidence; possible causes are labeled hypotheses (role instructions, context, model limits), never asserted internals. It explains synthesis resolutions and remaining uncertainties/tests, warns about unavailable/truncated evidence, and must not invent discrepancies.

The single Architect model dropdown offers the default ChatGPT / OpenAI entry (following the current synthesis/analysis model input), the authenticated available OpenAI text-generation suite supported by this app's Responses transport, and catalog-verified Claude models; it is the only architect selection field. Choose an explicit OpenAI model to keep architecture independent of synthesis/analysis. The separate OpenAI input is labeled for synthesis and analysis, not as another architect selector. Restored explicit OpenAI overrides remain supported even when the catalog is unavailable, with a restored/unverified label; no replacement model is silently selected. Claude is architect-only. The one-attempt fallback checkbox uses an automatically chosen verified Claude backup, whose name appears in its status: the first catalog model unless a prior saved backup remains verified. There is no second backup dropdown. Unavailable saved architect or backup choices are not silently replaced; unavailable backups and explicit Claude architects disable fallback. Fallback defaults on when a verified Claude model is available, can be disabled, and never applies to builder/synthesis/analysis or reverses from Claude to OpenAI. Saved next-run architect/fallback preferences take precedence over historical job settings on reload. Builder choices include installed local models, Grok text models, and Perplexity Sonar. The four panels form a 2x2 grid on wide screens and stack on narrow screens. Output panel labels use job metadata, not selections for the next run. Legacy three-stage history shows analysis as unavailable, not a fabricated comparison.

OpenAI, Anthropic, xAI and Perplexity may charge for API usage. Selecting Claude or enabling fallback authorizes transfer of the request to Anthropic; its architecture then goes to the selected builder and OpenAI synthesis/analysis. Fallback adds latency and API cost and cannot guarantee availability. A local builder's output still goes to OpenAI synthesis; this is not an offline/private-only workflow. Do not submit secrets. Models propose code and instructions, never execute them or edit files. This is orchestration, not training a new model.

One run at a time; later stages continue with an unavailable-stage note after a provider failure. Earlier outputs are preserved, including all three original outputs if analysis fails. Partial results are not a successful complete run. Closing a tab does not cancel it. The saved Phase 1 implementation persists accepted runs and stage results; restart recovery marks unfinished work interrupted without replaying provider calls. A storage failure stops later provider work, including fallback, and blocks new acceptance until repaired and restarted. Existing saved-run JSON files are retained unchanged and are not automatically imported. See the history section below for deployment status and privacy limits.

## Start and server-side keys

For a fresh checkout, use Linux with Python 3.11 or newer. The runtime uses only the Python standard library; Node.js is needed for UI tests, not to run the app. Install and run Ollama separately if local building is desired. Cloud providers require separate API credentials/billing. From the checkout directory run `python3 fusion.py`, then open http://localhost:8766/; the application is not hosted by GitHub Pages.

On the existing Pi deployment:

    cd /home/siegepi10/fusion-model-selector
    python3 fusion.py

Existing deployments use the user service fusion-model-selector.service. Check GET /api/job before any restart and do not restart while status is running. Never restart fusion.service for this fork.

OpenAI uses OPENAI_API_KEY first, then ~/.config/fusion/openai.key. Hidden key entry:

    python3 setup_key.py

Grok uses XAI_API_KEY first, then ~/.config/fusion/xai.key. Hidden key entry:

    python3 setup_xai_key.py

Never put keys in arguments, browser fields, chat, or model prompts. The helpers use atomic owner-only storage, refuse symlink credential paths, and fail closed if hidden input is unavailable. Saving a key does not prove authentication or available credits. File-based updates normally need only Refresh models; environment overrides take precedence. No agent dotenv files are imported. No credentials are exposed in browser output or logs.

## Builder models

Local options are sorted installed models from http://127.0.0.1:11434/api/tags, not downloads. qwen2.5-coder:0.5b is preferred if installed, otherwise the first installed model. Known embedding-only entries are omitted; unannotated models may still fail generation. Size labels describe disk size, not RAM requirements.

    ollama pull MODEL_NAME

Installing is an optional user action; the app never downloads models. Click Refresh afterward. Larger models require more storage/memory and can be slow on the Pi. Refresh preserves a valid selection; unavailable restored models require explicit reselection rather than silently switching. Run is disabled while loading, disconnected, missing a valid model, or already running.

Grok choices come from the authenticated https://api.x.ai/v1/models catalog. Only supported Grok text models are selectable; image, video, voice, audio, TTS, transcription and unsupported multi-agent IDs are excluded. Local builders remain usable if xAI fails; verified Grok choices remain usable if Ollama fails. Catalog verification proves membership, not generation entitlement, access to every model, or credits.

If xAI catalog access fails, these documentary fallbacks remain disabled and explicitly unverified/not ready: grok-code-fast-1, grok-4.3, grok-4.5, grok-4.6, grok-4.7, grok-4.20-reasoning, grok-4.20-non-reasoning. Source: https://docs.x.ai/developers/models. They are not installed models or evidence of account access.

## OpenAI architect catalog

Refresh models authenticates server-side GET https://api.openai.com/v1/models using the existing OPENAI_API_KEY / ~/.config/fusion/openai.key loader. No new credential source or browser credential field is added. Sorted, deduplicated OpenAI IDs are taken only from the returned catalog: no invented or documentary model list. GPT-4o, GPT-4.x (4.1 and later), GPT-5-and-later families, o-series reasoning models, and codex-mini-latest are eligible, including normal dated/mini/nano/pro/codex variants when returned. Because /models does not advertise endpoint capabilities, filtering is conservative: image/audio/realtime/TTS/transcription, embeddings/moderation, legacy Completions/chat-only models, o1-preview/o1-mini, search/deep-research models requiring special endpoints/tools, open-weight GPT-OSS, fine-tuned IDs and unknown families are omitted. This is the available suite supported by the existing plain-text Responses workflow, not every product in OpenAI's catalog. Catalog membership does not guarantee successful generation, sufficient credits or entitlement.

Catalog reads have a ten-second whole-request deadline, five-second maximum socket timeout, 1 MiB byte cap and 2,000-item cap, with no redirects or inherited proxies. Errors and credential-echo IDs are sanitized. A missing key, timeout, malformed/oversized response or empty catalog leaves the default existing OpenAI option and independent Claude catalog usable; it never disables them or fabricates additional OpenAI options. A previously selected OpenAI model is retained across Refresh/catalog outages as a restored, not catalog-verified override. Unavailable Claude still requires explicit reselection. Run and selectors are disabled during loading and restored afterward.

The default OpenAI entry follows the synthesis/analysis input; explicit openai:<model> affects only architecture. New saved job configs retain openai:default as a sentinel and resolve it only for stage routing, so job restoration retains the default's follow behavior. Jobs without architect_model still use openai_model; old explicit overrides remain explicit. Recognized unsupported/non-text architect IDs are rejected server-side. For legacy compatibility direct API/restored explicit OpenAI overrides are not catalog-gated; generation errors remain sanitized. Default and explicit OpenAI architecture both support the same optional one-shot verified Claude fallback; synthesis and analysis never use that fallback.

## API and security

GET /api/models returns local models/default plus combined builders/default_builder, providers (ollama, xai, perplexity, openai and anthropic), and an OpenAI/Claude architects/default_architect catalog. Claude IDs come only from the authenticated Anthropic catalog; unavailable Claude does not disable other providers. Local and architect-catalog status is available/unavailable; builder-cloud status is available/unverified. Verified cloud entries have status=catalog, verified=true, selectable=true; fallback entries are disabled. default_builder prefers local, then verified Grok, then verified Perplexity, otherwise null.

Catalogs use bounded timeouts, maximum 1 MiB response, fixed destinations, no inherited proxies, and no redirects. Anthropic pagination has a ten-second wall deadline, at most five pages and 500 items. Generation reads bounded chunks with a whole-request deadline (180 seconds for cloud, 300 for Ollama). Provider failures are independent and sanitized; the endpoint remains HTTP 200 even if all upstreams fail. Query parameters cannot change destinations. Unexpected internal failures return generic HTTP 503. model_catalog() and fetch_model_tags() retain local-only contracts.

POST /api/run:

    {"prompt": "Build something", "openai_model": "gpt-5.5",
     "ollama_model": "xai:grok-code-fast-1"}

The legacy ollama_model field selects the builder. Plain names/tags stay local; ollama:<model-id> is explicit local routing; xai:<supported-grok-id> routes to fixed https://api.x.ai/v1/chat/completions. Removed cloud-provider selections are rejected, not sent to Ollama. An optional architect_model accepts a plain OpenAI ID, openai:<model-id>, openai:default (resolves to openai_model), or catalog-verified anthropic:<claude-id>; omitting it uses openai_model. architect_fallback_enabled is a strict boolean; true requires architect_fallback_model=anthropic:<claude-id>. Before one fallback attempt the backend verifies current catalog membership. Direct API clients must explicitly enable fallback; the UI chooses its default based on verified availability. Synthesis always uses openai_model. No arbitrary endpoint or credential fields are accepted.

xAI payload uses system/user messages, stream=false, max_tokens=4000 and a 180-second timeout; content comes from choices[0].message.content. OpenAI uses the Responses API; Ollama uses the fixed loopback generate endpoint. Token-limit truncation is noted. Direct clients can request supported Grok IDs without catalog verification; authentication/generation failures remain sanitized.

POST returns HTTP 202 with an id. GET /api/job returns job=null or the latest job, including config, stage provider/model, status, output, errors, stage usage and aggregate usage. Host/origin restrictions apply. The app is loopback-only, not suitable for public hosting or untrusted local users. Credentials are redacted from successful provider output; catalog IDs echoing the active xAI key are removed. UI labels/errors/output use safe DOM text, never HTML interpolation.

## Reported token usage

Each panel has a closed native Reported tokens disclosure containing provider-reported input/output/total tokens after its nonstreaming stage completes. Whole-run usage sums known counts only, with complete-stage and input/output/total coverage. Unknown is not zero; missing or malformed counts remain null, while a reported zero is valid. Known failed-attempt counts, including the failed primary architect and a failed fallback, are included without double counting; unknown failures make coverage partial. Poll/reload restores counts without accumulating them. New runs clear old usage. No streaming estimates, dollar estimates or persistent cumulative history are added; provider dashboards remain authoritative for billing.

OpenAI uses Responses input_tokens/output_tokens/total_tokens; xAI uses chat prompt_tokens/completion_tokens/total_tokens; Ollama uses prompt_eval_count/eval_count and their sum when both are known. Cached-input and reasoning subsets are retained separately, never added again. Counts must be nonnegative JSON integers, not booleans. OpenAI/xAI totals are not invented from other fields. Plain-string injected providers remain supported with unknown usage.

Stage usage fields: input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens. Whole-run usage also includes known_stages, complete_stages, stage_count and complete. New runs have four stages (architect, builder, synthesis, analysis); analysis is included in totals and coverage. Complete coverage requires all main counts for all stages; optional subset counts do not affect it.

## Polished dark workspace

The frontend now uses compact expandable cloud disclosures with an always-visible safety summary, balanced model controls, an inline fallback checkbox, results before compact history, readable 15px raw-output surfaces, distinct stage badges and cohesive secondary/export/delete actions. All routing, copying and saved-history controls are preserved. Static assets are saved and live-served, verified after browser reload without restarting the service. Independent tests: 111 Python tests ran with 7 existing mobile skips, and 33 Node checks passed. Rendered isolated responsive checks at 390/768/1440px showed no horizontal overflow; no real-phone check was performed. No commit/push or paid generation was performed. Details: `docs/POLISHED_DARK_WORKSPACE.md`.

## Saved run history and Markdown export — Phase 1

Reference: FUSION-8766-HISTORY-EXPORT-PHASE1. Saved, offline-verified and deployed with user authorization on 2026-10-09; not committed/pushed. After restarting only fusion-model-selector.service, the live history endpoint returns HTTP 200 with an empty list and the browser shows the history controls.

- Production storage: `~/.local/share/fusion-model-selector/history.sqlite3`, private directory mode 0700 and files mode 0600. Direct injected/test Jobs use isolated in-memory storage. An exclusive stable owner lock prevents two processes recovering the same store.
- Accepted configuration is committed before the worker starts. Stage transitions/results are committed before proceeding. After restart, browse recovered runs through history; `/api/job` is still the current process's latest job and may be null.
- History retains up to 100 terminal runs plus active work; older terminal entries are automatically pruned. It is not a backup or automatic resume facility.
- Browse a saved run without replacing next-run model preferences or losing active-job tracking. Return to latest to follow the current run. Stale responses/errors cannot replace newer views.
- Export downloads a Markdown report containing prompt, configuration, status, stage outputs/errors, actual model/provider metadata and reported usage. Code fences safely contain untrusted content; exports do not verify model claims.
- Deletion requires UI confirmation; active-run deletion returns HTTP 409. Deleting the current completed run also clears its latest-job snapshot. Deletion and retention are logical removal, not forensic secure erasure.
- Storage and exports contain plaintext prompts/outputs, not encrypted data. Browser downloads have browser/OS-controlled permissions; keep exports private and outside Git. No provider requests are replayed by browsing, export, deletion or recovery.
- API: `GET /api/history`, `GET /api/history?id=<id>`, `GET /api/export?id=<id>` and `DELETE /api/history?id=<id>`. Existing exact Host/Origin protections apply.

Latest local verification: 111 Python tests ran (104 passed, 7 existing mobile tests skipped), 26 Node checks passed, JavaScript syntax and tracked diff whitespace checks passed. No SQLite ResourceWarnings remained. Mocked-provider tests establish persistence, recovery, owner exclusion, retention, deletion, Markdown download and storage-error stopping; live empty-history browser controls and the authorized service restart are verified. A real saved-run browser download and persistence of a production run across restart remain unverified; no paid generation was performed. Detailed report: `docs/HISTORY_EXPORT_PHASE1.md`.

## Offline tests and deployment limits

    cd /home/siegepi10/fusion-model-selector
    python3 -m unittest -v
    node test_models_ui.js
    node --check static/app.js
    node --check test_models_ui.js

Tests use synthetic credentials, temporary homes, ephemeral loopback servers and mocked upstream transports. The Node DOM harness covers installed selectors, cloud availability, OpenAI restoration, stage labels and usage lifecycle. Offline tests alone do not prove live provider access or real-browser rendering. See docs/RELEASE_READINESS.md for the latest automated, browser and live-provider smoke-test evidence. GitHub Actions repeats the offline checks without real provider credentials; it does not run paid generation.

## Perplexity Agent API Builder

Create/select a project and complete its project settings/billing prerequisite in the Perplexity API Console, then generate a key at https://console.perplexity.ai/project/keys. Perplexity consumer/Pro subscriptions and API billing are separate; model tokens and web search invocations have separate API charges.

    cd /home/siegepi10/fusion-model-selector
    python3 setup_perplexity_key.py

The hidden-input helper reuses setup_key.store_key's atomic 0600 file / 0700 directory storage. PERPLEXITY_API_KEY takes precedence over ~/.config/fusion/perplexity.key. Refresh reads the file dynamically; saving a key alone does not prove access. No keys were inspected during this implementation.

Official research: https://docs.perplexity.ai/llms.txt, https://docs.perplexity.ai/api-reference/models-get.md, https://docs.perplexity.ai/api-reference/agent-post.md, https://docs.perplexity.ai/docs/agent-api/models.md, https://docs.perplexity.ai/docs/agent-api/tools/web-search.md, and https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview.md. The migration docs recommend Agent API for new projects and say Sonar Chat Completions support ended September 27, 2026. Saved official reference snapshots and RED/GREEN evidence are under docs/perplexity/.

Authenticated catalog: GET https://api.perplexity.ai/v1/models with Authorization: Bearer <server-side-key>. Only documentary Perplexity's own perplexity/sonar model is selectable, and only if present in the catalog. Other provider models (including similarly prefixed third-party weights) are filtered out. This is a model, not a preset. No retired provider integration was added. Catalog failure/no key displays disabled, unverified fallback; Ollama and Grok remain independent.

Select ollama_model=perplexity:perplexity/sonar. Fixed POST https://api.perplexity.ai/v1/agent payload:

    {"model":"perplexity/sonar", "instructions":"<builder rules>",
     "input":"<request and architecture>",
     "tools":[{"type":"web_search", "max_results":5, "max_tokens":2000}],
     "max_steps":3, "max_output_tokens":4000, "store":false}

Important documentation discrepancy: the current official Agent API schema and define-the-run guide document max_steps, NOT max_tool_calls. This implementation uses the documented max_steps loop bound rather than inventing an unsupported field. A step may include multiple tool calls; this is not a verified strict per-invocation cap. The requested max_tool_calls cap cannot be claimed satisfied by current docs. No presets, model fallback, sandbox/code execution, MCP, URL-fetch tools, browser-selected endpoints, proxies or redirects are enabled. Timeout is 180 seconds; response limit 2 MB.

Only assistant message output_text is extracted, never reasoning or tool text. Sources from url_citation annotations and search_results are deduplicated and rendered as plain text, at most 10 URLs (2048 characters each) and 200-character titles; unsafe schemes, credentials, local/private address literals and active-key echoes are rejected/redacted. No source URLs are fetched locally. Both visible answer and sources go onward to OpenAI synthesis and analysis. Response model metadata is retained even if different from the requested model, while provider=perplexity identifies the billed API transport. Responses usage input/output/total is normalized; absent counts remain unknown and cached/reasoning subsets are not double-counted.

Verification: the authenticated live catalog now enables Perplexity Sonar, and a fresh browser-submitted four-stage run completed with OpenAI architecture, Perplexity building, OpenAI synthesis and OpenAI analysis. Every stage returned nonempty output and reported usage. This was a paid API smoke test, not just a catalog check. Detailed release evidence and limitations are recorded in docs/RELEASE_READINESS.md. Mobile/QR access remains deferred and its seven tests remain explicitly skipped; no real-phone test has been performed.

## Claude architect and one-shot fallback

Anthropic uses ANTHROPIC_API_KEY first, then ~/.config/fusion/anthropic.key. Enter a key only through the hidden terminal helper:

    cd /home/siegepi10/fusion-model-selector
    python3 setup_anthropic_key.py

A Claude consumer subscription is not API access or credit. Refresh models reads file credentials dynamically. The authenticated Models API populates the single architect dropdown and verifies the automatically selected backup shown in status; absent or unavailable catalog disables Claude fallback while preserving OpenAI. Generation uses Messages API with separate system/user content, max_tokens=4000, text-block extraction and explicit truncation notes. Cache-read/creation counts are included once in input usage; missing components remain unknown. Failed-attempt metadata retains sanitized errors, usage and actual model identity where reported. Output headings identify actual provider/model and whether fallback was used.

Current Claude implementation verification: 90 Python tests ran successfully (83 passed, 7 existing mobile tests skipped); all 8 Node UI checks passed, JavaScript syntax and git diff whitespace checks passed. Initial regressions were observed before fixes, including default-model routing, empty output, failed usage, reload preferences and whole-request deadlines. Saved Anthropic key presence and mode 0600 were checked without printing its content; this does not prove authentication. The completed pre-change run is preserved at /home/siegepi10/.local/share/fusion/backups/pre-claude-job.json. The selector service was subsequently restarted with authorization after checking the run was completed, and is active/enabled. The live browser shows the single named GPT/Claude architect dropdown with no backup dropdown; the deployed catalog correctly leaves Claude unavailable. A direct fixed-endpoint Anthropic catalog check returned HTTP 400, invalid_request_error, categorized as credential/authentication; raw errors and secrets were withheld. Replace the saved credential using the hidden helper with a valid API key from https://platform.claude.com/settings/keys, then Refresh models (no restart required for file updates). Paid Claude generation and live fallback remain unverified; no paid calls were made. Original port 8765 was untouched and remains active.

## Files

fusion.py: catalogs, fixed transports, validation, orchestration and usage.
static/: four-panel UI and local/Grok selector.
setup_key.py and setup_xai_key.py: hidden supported-provider entry.
test_fusion.py, test_models.py, test_xai.py, test_usage.py, test_architect.py: generic and supported-provider coverage.
test_provider_removal.py: removed integration regression checks.
test_analysis.py: fourth-stage routing, context, evidence instructions, failures, usage and markup contracts.
test_mobile.py: preserved pending separate mobile-access tests, explicitly skipped; no mobile feature is implemented here.
test_models_ui.js: dependency-free UI behavior harness.
docs/plans/implementation.md: inherited original implementation plan.
