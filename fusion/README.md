# Fusion

## Current publication record

See [October 6 publication snapshot](docs/PUBLICATION_2026-10-06.md) for this release, test results, exclusions, and historical-status clarification.


## Verified GitHub publication

Current version: https://github.com/ebarber79/fusion-harness/tree/release/fusion-current/fusion

See [publication record](docs/PUBLICATION_2026-10-06.md) and [CHANGELOG.md](CHANGELOG.md) for tests, exclusions and exact publication scope.

## Output copying and change documentation

Each output panel has a small Copy button beside its title. Click it to copy the full output text without highlighting. Empty outputs disable the button; successful copying shows “Copied!”. If browser clipboard permissions block copying, the UI reports the problem and manual selection remains available. Refresh the page (Ctrl+Shift+R if needed) to load updated controls.

See [CHANGELOG.md](CHANGELOG.md) for changes, verification evidence, limitations, and saved/deployed versus committed/pushed status. Documentation does not imply changes have been published to GitHub.

Local three-panel multi-model workflow, not a newly trained model.

## Start

    cd /home/siegepi10/fusion
    python3 setup_key.py
    python3 fusion.py

Open http://localhost:8765 on this machine. Key entry is hidden; stored in ~/.config/fusion/openai.key with mode 0600. OPENAI_API_KEY takes precedence if set. Never paste credentials into the prompt. API billing is separate from ChatGPT/Codex subscriptions.

Install Ollama, start its service, then download the builder:

    ollama pull qwen2.5-coder:0.5b

The default OpenAI model is gpt-5.5; a live API generation with the configured key has succeeded. The builder defaults to qwen2.5-coder:0.5b, a small starting point for validating the pipeline on this 4 GB machine. It is not equivalent to a large reasoning model. You can choose other installed/available models in the browser.

## Workflow and privacy

1. OpenAI architect proposes an approach.
2. Ollama builder receives the prompt and architecture, proposing an implementation locally.
3. OpenAI synthesizes both outputs and flags disagreements.

The initial prompt and local builder output are sent to OpenAI. All three answers remain visible. Outputs are proposals: models cannot run commands or edit files. One run at a time; only the latest run is held in server memory. Restarting clears it. There is no persistent conversation history. Long inputs may exceed the small local model context. This prototype is loopback-only, not intended for public hosting or untrusted local users.

Each stage has a timeout and independent failure status. A fused output from a partial run is not a successful complete fusion. A live browser-driven run has completed all three stages using gpt-5.5 and qwen2.5-coder:0.5b, with all three outputs displayed. This establishes connectivity and orchestration, not correctness on arbitrary tasks.

## Automatic startup

Both services are enabled as user systemd units, and user lingering is enabled:

    systemctl --user status fusion.service ollama.service

Open http://localhost:8765 on this machine; no terminal server command is needed. Fusion and Ollama listen only on loopback. The builder is intentionally small for this machine; choose a larger installed model if resources allow.

The installed Ollama release is v0.35.1. Its installer archive was checked against the official release SHA-256 and tested with zstd before installation. Corrupted previous artifacts were preserved in Downloads/ollama-verified and /usr/local/bin/ollama.corrupt-backup. The replacement builder model was checked against its content digest and produced a sensible Python response.

## Tests

    cd /home/siegepi10/fusion
    python3 -m unittest -v

Tests exercise orchestration with fake providers, validation, credential storage/redaction, bounded responses, HTTP security and static UI contracts. They do not prove real-provider availability.

## Files

- fusion.py: standard-library backend and orchestration
- static/: three-panel browser interface
- setup_key.py: hidden credential entry
- test_fusion.py: automated checks
- docs/plans/implementation.md: implementation plan

No third-party Python packages required. Stop a foreground server with Ctrl+C.
