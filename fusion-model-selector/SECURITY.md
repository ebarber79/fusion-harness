# Security scope

Fusion is a trusted-user, loopback-only local application. It binds to 127.0.0.1:8766 and checks Host, Origin and cross-site request headers. These are browser boundary protections, not user authentication.

Do not expose it through a public reverse proxy, public tunnel, broad LAN listener, or shared/untrusted host. Local users/processes can access the app and cause billable provider requests. Private phone access and authentication are not implemented in this release.

## Credentials and data

Use setup_key.py, setup_xai_key.py and setup_perplexity_key.py from an interactive terminal. They store credentials outside the repository under ~/.config/fusion with directory mode 0700 and file mode 0600. Environment variables override those files. Never commit credentials, paste them into issues, or place them in prompts. Credential scanning reduces risk but does not prove the absence of every possible secret format.

Saved-run JSON files contain private prompts and model output. .gitignore excludes saved-run*.json, keys, dotenv files, logs, caches and virtual environments. Exclusion rules do not remove files that were previously committed; inspect staged files before publishing.

OpenAI receives the request and previous outputs for architecture, synthesis and comparison. Cloud builders receive the request and architecture. Perplexity answers and citations are passed onward to OpenAI. An Ollama builder does not make the whole workflow offline. API billing is separate from consumer subscriptions. Returned model text is untrusted, rendered as text, and never executed by the app.

The latest job lives in memory; server restart clears it. Do not restart during a running job. No guarantee of durable conversation history is made.

## Reporting

Do not include real keys or private conversation exports in bug reports. For security issues, contact the repository owner privately; a remote security-reporting channel must be configured when the GitHub repository is created.
