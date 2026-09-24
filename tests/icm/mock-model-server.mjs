#!/usr/bin/env node
/**
 * A scripted, deterministic OpenAI-compatible "model" for exercising the harness end to end
 * WITHOUT any API spend: it plays every Fusion Harness role by recognising the harness's own
 * prompt files in the request and replying with the tool calls / text a well-behaved model would.
 *
 *   node tests/icm/mock-model-server.mjs [port]          # default 18081
 *
 * Wire it to pi via a models.json entry (see ICM_IMPLEMENTATION_NOTES.md):
 *   { "providers": { "mock": { "baseUrl": "http://127.0.0.1:18081/v1", "api": "openai-completions",
 *       "apiKey": "mock", "models": [{ "id": "scripted", ... }] } } }
 *
 * Script:
 *   VALIDATOR (SYSTEM_PROMPT_VALIDATOR)  → `write` the gate to the dictated GATE_PATH, then confirm
 *   BUILDER   (USER_PROMPT_BUILDER)      → `write` hello.txt = "hello", then report
 *   CORRECTION (USER_PROMPT_CORRECTION)  → same as BUILDER
 *   TRIAGE    (SYSTEM_PROMPT_TRIAGE)     → a short diagnosis (no tools)
 *   FUSION merge / workers / opinion     → a one-line text answer
 * A request whose last message is a tool result gets the follow-up text for that role.
 *
 * This is a test double for PLUMBING (artifacts, envelopes, gate loop). It proves nothing about
 * model quality, and it is not loaded by the harness — only by the test/verification flow.
 */

import fs from "node:fs";
import http from "node:http";

const PORT = Number(process.argv[2] ?? 18081);
// MOCK_LOG=<file>: append one line per request — which role was recognised and which ICM Phase 2
// blocks the prompt carried. This is how an end-to-end run PROVES a consumer received the handoff.
// MOCK_BUILDER_WRONG_FIRST=1: the builder's FIRST attempt writes the wrong content so the gate
// fails once and a correction round (which consumes the validation envelope) actually happens.
const LOG = process.env.MOCK_LOG;
const log = (line) => LOG && fs.appendFileSync(LOG, `${line}\n`);
let builderAttempts = 0;

const GATE = `# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
import pathlib, sys
p = pathlib.Path("hello.txt")
if p.exists() and p.read_text().strip() == "hello":
    print("PASS: hello.txt contains exactly 'hello'")
    sys.exit(0)
found = repr(p.read_text()) if p.exists() else "missing"
print(f"FAIL: expected hello.txt containing 'hello', found {found}, at {p.resolve()} — create hello.txt in the project root with exactly the text hello")
sys.exit(1)
`;

const text = (m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((c) => c.text ?? "").join("") : "");

/** Decide what to say from the transcript alone. Returns {text} or {tool:{name,args}, text?}. */
function script(messages) {
	const system = messages.filter((m) => m.role === "system").map(text).join("\n");
	const users = messages.filter((m) => m.role === "user").map(text);
	const lastUser = users[users.length - 1] ?? "";
	const last = messages[messages.length - 1];
	const afterTool = last?.role === "tool";

	const icm = {
		handoff: lastUser.includes("# ICM STRUCTURED HANDOFFS"),
		handoffFiles: [...lastUser.matchAll(/Envelope file: (\S+)/g)].map((m) => m[1].split("/").pop()),
		diagnostics: lastUser.includes("# STRUCTURED GATE DIAGNOSTICS"),
		failItems: (lastUser.match(/^\d+\. /gm) ?? []).length,
	};

	if (system.includes("You are the VALIDATOR acting as TRIAGE DIAGNOSTICIAN")) {
		return { text: "1. **Diagnosis** — the builder has not written hello.txt with the exact text.\n2. **Do exactly this** — write hello.txt containing `hello`.\n3. **Do NOT** — add extra content." };
	}
	if (system.includes("You are the VALIDATOR in an auto-validation loop")) {
		const m = lastUser.match(/^\s*(\/\S*gate\.py)\s*$/m) ?? system.match(/^\s*(\/\S*gate\.py)\s*$/m);
		const gatePath = m?.[1] ?? "/tmp/gate.py";
		if (afterTool) return { text: `${gatePath}\nChecks that hello.txt exists in the project root with exactly the text 'hello'.` };
		return { tool: { name: "write", args: { path: gatePath, content: GATE } } };
	}
	if (lastUser.includes("You are the BUILDER agent in an auto-validation loop") || lastUser.startsWith("GATE FAILED")) {
		const correction = lastUser.startsWith("GATE FAILED");
		if (!afterTool) {
			builderAttempts++;
			log(`BUILDER ${correction ? "correction" : "round-1"} attempt=${builderAttempts} diagnostics=${icm.diagnostics} failItems=${icm.failItems}`);
		}
		const wrong = process.env.MOCK_BUILDER_WRONG_FIRST && builderAttempts === 1 && !correction;
		const content = wrong ? "hi" : "hello";
		if (afterTool) return { text: `Created hello.txt (relative to the project root) containing exactly \`${content}\`. Commands run: none.` };
		return { tool: { name: "write", args: { path: "hello.txt", content } } };
	}
	if (lastUser.includes("You are the FUSION agent")) {
		log(`FUSION handoff=${icm.handoff} files=${icm.handoffFiles.join(",")}`);
		return { text: "**Fused answer** — Unit tests catch regressions early [ARCHITECT] and document intended behaviour [BUILDER].\n\n**Consensus & divergence** — both agreed tests reduce risk; [ARCHITECT] stressed regressions, [BUILDER] stressed documentation; nothing discarded." };
	}
	if (afterTool) return { text: "Done." };
	return { text: "pong — scripted mock answer." };
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

const server = http.createServer((req, res) => {
	if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
		res.writeHead(404).end();
		return;
	}
	let body = "";
	req.on("data", (d) => (body += d));
	req.on("end", () => {
		let payload;
		try {
			payload = JSON.parse(body);
		} catch {
			res.writeHead(400).end("bad json");
			return;
		}
		const out = script(payload.messages ?? []);
		const id = `chatcmpl-mock-${Date.now()}`;
		const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: payload.model ?? "scripted" };
		res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
		sse(res, { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
		if (out.tool) {
			sse(res, {
				...base,
				choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: out.tool.name, arguments: JSON.stringify(out.tool.args) } }] }, finish_reason: null }],
			});
			sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
		} else {
			sse(res, { ...base, choices: [{ index: 0, delta: { content: out.text }, finish_reason: null }] });
			sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
		}
		sse(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
		res.write("data: [DONE]\n\n");
		res.end();
	});
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock model server listening on http://127.0.0.1:${PORT}/v1`));
