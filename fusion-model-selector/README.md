# Fusion model selector (independent fork)

## Current publication record

See [October 6 publication snapshot](docs/PUBLICATION_2026-10-06.md) for this release, test results, exclusions, and historical-status clarification.


## Output copying and change documentation

Each output panel has a small Copy button beside its title. Click it to copy the full output text without highlighting. Empty outputs disable the button; successful copying shows “Copied!”. If browser clipboard permissions block copying, the UI reports the problem and manual selection remains available. Refresh the page (Ctrl+Shift+R if needed) to load updated controls.

See [CHANGELOG.md](CHANGELOG.md) for changes, verification evidence, limitations, and saved/deployed versus committed/pushed status. Documentation does not imply changes have been published to GitHub.

Open http://localhost:8766 on the Pi. This app lives at /home/siegepi10/fusion-model-selector. The original /home/siegepi10/fusion on port 8765 is independent and must not be restarted or modified when deploying this fork.

## Workflow and controls

1. OpenAI architect receives the user request (gpt-5.5 by default), or a selected catalog-verified Claude architect does. An enabled verified Claude fallback receives the same request once if the OpenAI architect fails.
2. The selected installed Ollama local, Grok / xAI cloud, or Perplexity cloud builder receives the request and architecture.
3. OpenAI synthesis receives the request, architecture, and builder output.
4. OpenAI Reasoning / Divergence analysis runs AFTER synthesis, receiving the request and all three visible outputs using the same OpenAI model as synthesis. This adds API cost and sequential latency. It is a user-facing output comparison, not hidden chain of thought: concise agreements and divergences cite visible evidence; possible causes are labeled hypotheses (role instructions, context, model limits), never asserted internals. It explains synthesis resolutions and remaining uncertainties/tests, warns about unavailable/truncated evidence, and must not invent discrepancies.

The single Architect model dropdown offers the default ChatGPT / OpenAI entry (following the current synthesis/analysis model input), the authenticated available OpenAI text-generation suite supported by this app's Responses transport, and catalog-verified Claude models; it is the only architect selection field. Choose an explicit OpenAI model to keep architecture independent of synthesis/analysis. The separate OpenAI input is labeled for synthesis and analysis, not as another architect selector. Restored explicit OpenAI overrides remain supported even when the catalog is unavailable, with a restored/unverified label; no replacement model is silently selected. Claude is architect-only. The one-attempt fallback checkbox uses an automatically chosen verified Claude backup, whose name appears in its status: the first catalog model unless a prior saved backup remains verified. There is no second backup dropdown. Unavailable saved architect or backup choices are not silently replaced; unavailable backups and explicit Claude architects disable fallback. Fallback defaults on when a verified Claude model is available, can be disabled, and never applies to builder/synthesis/analysis or reverses from Claude to OpenAI. Saved next-run architect/fallback preferences take precedence over historical job settings on reload. Builder choices include installed local models, Grok text models, and Perplexity Sonar. The four panels form a 2x2 grid on wide screens and stack on narrow screens. Output panel labels use job metadata, not selections for the next run. Legacy three-stage history shows analysis as unavailable, not a fabricated comparison.

OpenAI, Anthropic, xAI and Perplexity may charge for API usage. Selecting Claude or enabling fallback authorizes transfer of the request to Anthropic; its architecture then goes to the selected builder and OpenAI synthesis/analysis. Fallback adds latency and API cost and cannot guarantee availability. A local builder's output still goes to OpenAI synthesis; this is not an offline/private-only workflow. Do not submit secrets. Models propose code and instructions, never execute them or edit files. This is orchestration, not training a new model.

One run at a time; later stages continue with an unavailable-stage note after a failed stage. Earlier outputs are preserved, including all three original outputs if analysis fails. Partial results are not a successful complete run. Only the latest job is held in memory. Closing a tab does not cancel it; restarting clears outputs and usage. Existing saved-run JSON files are retained unchanged.

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

Each panel shows provider-reported input/output/total tokens after its nonstreaming stage completes. Whole-run usage sums known counts only, with complete-stage and input/output/total coverage. Unknown is not zero; missing or malformed counts remain null, while a reported zero is valid. Known failed-attempt counts, including the failed primary architect and a failed fallback, are included without double counting; unknown failures make coverage partial. Poll/reload restores counts without accumulating them. New runs clear old usage. No streaming estimates, dollar estimates or persistent cumulative history are added; provider dashboards remain authoritative for billing.

OpenAI uses Responses input_tokens/output_tokens/total_tokens; xAI uses chat prompt_tokens/completion_tokens/total_tokens; Ollama uses prompt_eval_count/eval_count and their sum when both are known. Cached-input and reasoning subsets are retained separately, never added again. Counts must be nonnegative JSON integers, not booleans. OpenAI/xAI totals are not invented from other fields. Plain-string injected providers remain supported with unknown usage.

Stage usage fields: input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens. Whole-run usage also includes known_stages, complete_stages, stage_count and complete. New runs have four stages (architect, builder, synthesis, analysis); analysis is included in totals and coverage. Complete coverage requires all main counts for all stages; optional subset counts do not affect it.

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
