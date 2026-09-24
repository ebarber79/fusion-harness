#!/usr/bin/env node
/**
 * ICM end-to-end proof with ZERO API spend.
 *
 *   just icm-mock-e2e        (or: node tests/icm/mock-e2e.mjs)
 *
 * What it does:
 *   1. starts tests/icm/mock-model-server.mjs (a scripted OpenAI-compatible "model" that plays
 *      every Fusion Harness role) with MOCK_BUILDER_WRONG_FIRST=1 so the builder's first attempt
 *      fails the gate and a correction round actually happens;
 *   2. points pi at it through a THROWAWAY agent dir (PI_CODING_AGENT_DIR) — your ~/.pi is untouched;
 *   3. runs `/fusion` and `/auto-validate` headlessly in a scratch git repo (never in this repo);
 *   4. verifies each run dir with tests/icm/verify-run.ts (schema, hashes, cross-refs, gate claims);
 *   5. asserts, from the mock's request log, that the consumers RECEIVED the Phase 2 handoffs:
 *        - the FUSION prompt carried "# ICM STRUCTURED HANDOFFS" naming spec.json and build.json;
 *        - builder round 1 carried no diagnostics; the correction round carried
 *          "# STRUCTURED GATE DIAGNOSTICS" with at least one numbered FAIL item.
 *   6. (Phase 3) promotes the gate-PASS /auto-validate run with `/icm-promote` into a scratch
 *      context dir, confirms the index holds exactly one validated output, and confirms the
 *      /fusion run is REFUSED (no independent evidence).
 * Exit 0 iff everything holds. Needs `pi` and `uv` on PATH. Proves plumbing, not model quality.
 */

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..", "..");
const EXT = path.join(REPO, "extensions", "fusion-harness", "fusion-harness.ts");
const PORT = Number(process.env.MOCK_PORT ?? 18081);
const MODEL = "mock/scripted";

let failures = 0;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => {
	failures++;
	console.log(`FAIL: ${m}`);
};

// ── scratch world ──
const work = fs.mkdtempSync(path.join(os.tmpdir(), "icm-e2e-"));
const agentDir = path.join(work, "pi-agent");
const proj = path.join(work, "proj");
fs.mkdirSync(agentDir);
fs.mkdirSync(proj);
fs.writeFileSync(
	path.join(agentDir, "models.json"),
	JSON.stringify(
		{
			providers: {
				mock: {
					baseUrl: `http://127.0.0.1:${PORT}/v1`,
					api: "openai-completions",
					apiKey: "mock",
					models: [{ id: "scripted", name: "scripted mock", input: ["text"], contextWindow: 128000, maxTokens: 8192 }],
				},
			},
		},
		null,
		2,
	),
);
execFileSync("git", ["init", "-q", proj]);
execFileSync("git", ["-C", proj, "-c", "user.email=e2e@icm", "-c", "user.name=icm-e2e", "commit", "-q", "--allow-empty", "-m", "scratch"]);
const mockLog = path.join(work, "mock.log");

// ── mock model ──
const server = spawn(process.execPath, [path.join(HERE, "mock-model-server.mjs"), String(PORT)], {
	env: { ...process.env, MOCK_LOG: mockLog, MOCK_BUILDER_WRONG_FIRST: "1" },
	stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
	server.stdout.on("data", (d) => String(d).includes("listening") && resolve());
	server.on("exit", (c) => reject(new Error(`mock server exited early (${c}) — is port ${PORT} free?`)));
	setTimeout(() => reject(new Error("mock server did not start")), 5000);
}).catch((e) => {
	console.error(String(e));
	process.exit(2);
});

const listRuns = () => new Set(fs.readdirSync("/tmp").filter((f) => f.startsWith("fusion-harness-")));

/** Run one harness command headlessly; returns the run dir it created. */
function harness(command, timeoutMs, extraEnv = {}) {
	const before = listRuns();
	const args = [
		"-e", EXT,
		"--model", MODEL, "--architect", MODEL, "--builder", MODEL,
		"--architect-thinking", "off", "--builder-thinking", "off",
		"--child-timeout", "120",
		"-p", command,
	];
	let out = "";
	try {
		out = execFileSync("pi", args, { cwd: proj, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...extraEnv }, encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		fail(`pi exited non-zero for ${command}: ${String(e.stderr ?? e.message).slice(0, 400)}`);
	}
	fs.writeFileSync(path.join(work, `${command.split(" ")[0].slice(1)}.out`), out);
	const created = [...listRuns()].filter((d) => !before.has(d));
	if (command.startsWith("/icm-")) {
		if (created.length) fail(`${command} must not create a run dir, created ${created.join(", ")}`);
		return undefined;
	}
	if (created.length !== 1) {
		fail(`${command} should create exactly one /tmp/fusion-harness-* run dir, created ${created.length}`);
		return undefined;
	}
	return path.join("/tmp", created[0]);
}

function verify(runDir) {
	try {
		const out = execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(HERE, "verify-run.ts"), runDir], { encoding: "utf-8" });
		const lines = out.trim().split("\n");
		pass(`icm-verify ${runDir}: ${lines[lines.length - 1]} (${lines.filter((l) => l.startsWith("PASS")).length} checks)`);
	} catch (e) {
		fail(`icm-verify ${runDir}:\n${String(e.stdout ?? e.message)}`);
	}
}

try {
	console.log(`scratch: ${work}`);
	const fusionDir = harness("/fusion Should we write unit tests?", 240_000);
	if (fusionDir) verify(fusionDir);
	fs.rmSync(path.join(proj, "hello.txt"), { force: true });
	const avDir = harness("/auto-validate --max-validations 3 Create hello.txt in the project root containing exactly the text hello", 300_000);
	if (avDir) {
		verify(avDir);
		const files = fs.readdirSync(avDir);
		if (files.includes("validation-round-2.json") && files.includes("build-round-2.json")) pass("auto-validate needed a correction round (round-2 build + validation envelopes exist)");
		else fail(`auto-validate did not reach a correction round; files: ${files.join(", ")}`);
		const summary = JSON.parse(fs.readFileSync(path.join(avDir, "summary.json"), "utf-8"));
		if (summary.ok && summary.rounds === 2) pass("gate passed at round 2 after the structured correction");
		else fail(`expected gate PASS at round 2, got ${JSON.stringify({ ok: summary.ok, rounds: summary.rounds })}`);
		const b2 = JSON.parse(fs.readFileSync(path.join(avDir, "build-round-2.json"), "utf-8"));
		if (b2.decisions.some((d) => d.startsWith("consumed structured gate diagnostics from validation-round-1.json"))) pass("build-round-2 envelope records that it consumed validation-round-1.json");
		else fail(`build-round-2 decisions: ${JSON.stringify(b2.decisions)}`);
	}
	if (fusionDir) {
		const o = JSON.parse(fs.readFileSync(path.join(fusionDir, "output.json"), "utf-8"));
		if (o.decisions.some((d) => d.includes("fusion consumed ICM handoffs before the raw answers: spec.json, build.json"))) pass("fusion output envelope records the consumed handoffs");
		else fail(`fusion output decisions: ${JSON.stringify(o.decisions)}`);
	}

	// Phase 3: manual promotion into a scratch context dir (never ~/.fusion).
	const contextDir = path.join(work, "context");
	const ctxEnv = { FUSION_ICM_CONTEXT_DIR: contextDir };
	if (avDir) {
		harness(`/icm-promote ${avDir}`, 120_000, ctxEnv);
		const idxPath = path.join(contextDir, "index.json");
		if (!fs.existsSync(idxPath)) fail(`/icm-promote wrote no ${idxPath}`);
		else {
			const idx = JSON.parse(fs.readFileSync(idxPath, "utf-8"));
			const manifest = JSON.parse(fs.readFileSync(path.join(avDir, "icm-manifest.json"), "utf-8"));
			if (idx.entries.length === 1 && idx.entries[0].status === "validated" && idx.entries[0].run_id === manifest.run_id) pass(`/icm-promote indexed exactly one validated output for run ${manifest.run_id}`);
			else fail(`unexpected index after promotion: ${JSON.stringify(idx)}`);
			const dest = path.join(contextDir, idx.entries[0].path);
			const out = JSON.parse(fs.readFileSync(path.join(dest, "output.json"), "utf-8"));
			if (out.status === "validated" && fs.existsSync(path.join(dest, "promotion.json")) && fs.existsSync(path.join(dest, "artifacts", "gate-round-2.txt"))) pass(`promoted output is validated with promotion record and hashed artifacts at ${dest}`);
			else fail(`promoted tree incomplete at ${dest}`);
			if (JSON.parse(fs.readFileSync(path.join(avDir, "output.json"), "utf-8")).status === "draft") pass("the run's own output.json stays draft");
			else fail("promotion mutated the run dir");
			harness(`/icm-promote ${avDir}`, 120_000, ctxEnv);
			if (JSON.parse(fs.readFileSync(idxPath, "utf-8")).entries.length === 1) pass("a second /icm-promote of the same run is refused (index unchanged)");
			else fail("duplicate promotion was accepted");
		}
	}
	if (fusionDir) {
		harness(`/icm-promote ${fusionDir}`, 120_000, ctxEnv);
		const idxPath = path.join(contextDir, "index.json");
		const n = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf-8")).entries.length : 0;
		if (n === (avDir ? 1 : 0)) pass("/icm-promote refuses the /fusion run (no independent evidence) — index unchanged");
		else fail(`/fusion run was promoted; index has ${n} entries`);
	}

	// What the consumers actually received, per the mock's own log.
	const log = fs.existsSync(mockLog) ? fs.readFileSync(mockLog, "utf-8").trim().split("\n") : [];
	const fusionLine = log.find((l) => l.startsWith("FUSION "));
	if (fusionLine === "FUSION handoff=true files=spec.json,build.json") pass(`fuser prompt carried the ICM handoff block: ${fusionLine}`);
	else fail(`fuser prompt lacked the handoff: ${fusionLine ?? "(no FUSION request seen)"}`);
	const r1 = log.find((l) => l.startsWith("BUILDER round-1 "));
	if (r1?.includes("diagnostics=false")) pass(`builder round 1 carried no diagnostics (nothing to consume yet): ${r1}`);
	else fail(`builder round 1: ${r1 ?? "(not seen)"}`);
	const corr = log.find((l) => l.startsWith("BUILDER correction "));
	const items = Number(corr?.match(/failItems=(\d+)/)?.[1] ?? 0);
	if (corr?.includes("diagnostics=true") && items >= 1) pass(`builder correction prompt carried STRUCTURED GATE DIAGNOSTICS with ${items} numbered FAIL item(s): ${corr}`);
	else fail(`builder correction: ${corr ?? "(no correction request seen)"}`);
} finally {
	server.kill();
}

console.log(failures ? `\n${failures} check(s) failed — scratch kept at ${work}` : `\nall checks passed — scratch: ${work}`);
process.exit(failures ? 1 : 0);
