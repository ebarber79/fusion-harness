#!/usr/bin/env node
/**
 * ICM Phase 4 — the BENEFIT test. Costs real money (workhorse pair). Never run by CI.
 *
 *   node tests/icm/benefit-test.mjs <arm> [--architect m] [--builder m] [--thinking low]
 *     arm = "on"  → stage 2 retrieves the promoted stage-1 output (default harness behaviour)
 *     arm = "off" → stage 2 runs with --icm-retrieve off
 *
 * One arm = one fresh scratch git repo (fake origin), one fresh context dir, one throwaway
 * PI_CODING_AGENT_DIR (keys come from the environment — source .env first):
 *   stage 1  /auto-validate builds a small package whose gate enforces a non-obvious invariant
 *            (amounts are integer CENTS; floats refused) → commit → /icm-promote
 *   reset    the per-project role sessions are DELETED so stage 2 starts with fresh memory
 *            (the harness otherwise resumes them — the retrieval block would be redundant)
 *   stage 2  /auto-validate asks for a dependent change (CSV export in dollars) that is only
 *            right if the cents invariant is honoured; the request does NOT restate it.
 * Report (JSON to stdout + <scratch>/report.json): rounds, cost, gate verdicts, whether the brief
 * recorded a retrieval, whether the VALIDATOR / BUILDER sessions read anything under the context
 * dir or mentioned the ctx id, and whether stage 2's gate re-enforces the cents rule.
 * Two arms are two invocations; compare the two reports. n = 1 per arm — indicative, not proof.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..", "..");
const EXT = path.join(REPO, "extensions", "fusion-harness", "fusion-harness.ts");

const argv = process.argv.slice(2);
const arm = argv[0];
if (arm !== "on" && arm !== "off") {
	console.error("usage: node tests/icm/benefit-test.mjs on|off [--architect m] [--builder m] [--thinking low]");
	process.exit(2);
}
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const ARCHITECT = opt("architect", "anthropic/claude-sonnet-5");
const BUILDER = opt("builder", "openai/gpt-5.6-terra");
const THINKING = opt("thinking", "low");

const STAGE1 =
	"Create a Python package named ledger in the project root: ledger/__init__.py must define add_entry(entries: list, amount) -> None, which appends {'amount': amount} to entries but raises ValueError unless amount is an int — amounts are whole CENTS; floats, strings and bools are refused — and total(entries) -> int returning the sum of the amounts in cents. No third-party dependencies. Also write ledger/README.md describing the API in two sentences.";
const STAGE2 =
	"Add ledger/export.py with to_csv(entries: list) -> str that returns CSV text: a header line 'amount' followed by one line per entry showing that entry's amount formatted in dollars with exactly two decimal places. Keep the existing ledger package working and do not change its public API.";

// ── scratch world ──
const work = fs.mkdtempSync(path.join(os.tmpdir(), `icm-benefit-${arm}-`));
const agentDir = path.join(work, "pi-agent");
const proj = path.join(work, "proj");
const contextDir = path.join(work, "context");
fs.mkdirSync(agentDir);
fs.mkdirSync(proj);
const gitc = (...args) => execFileSync("git", ["-C", proj, "-c", "user.email=benefit@icm", "-c", "user.name=icm-benefit", ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
execFileSync("git", ["init", "-q", "-b", "main", proj]);
gitc("remote", "add", "origin", `https://example.invalid/icm/benefit-${arm}.git`);
gitc("commit", "-q", "--allow-empty", "-m", "scratch");

const listRuns = () => new Set(fs.readdirSync("/tmp").filter((f) => f.startsWith("fusion-harness-") && !f.startsWith("fusion-harness-sessions")));
const sessionsDirFor = (cwd) => path.join("/tmp", "fusion-harness-sessions", cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "root");

/** Run one harness command headlessly; returns the run dir it created (or undefined for /icm-*). */
function harness(command, extraArgs = [], timeoutMs = 1_800_000) {
	const before = listRuns();
	const args = ["-e", EXT, "--model", BUILDER, "--architect", ARCHITECT, "--builder", BUILDER, "--architect-thinking", THINKING, "--builder-thinking", THINKING, "--child-timeout", "900", ...extraArgs, "-p", command];
	let out = "";
	try {
		out = execFileSync("pi", args, { cwd: proj, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, FUSION_ICM_CONTEXT_DIR: contextDir }, encoding: "utf-8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		console.error(`pi exited non-zero for ${command.slice(0, 40)}…: ${String(e.stderr ?? e.message).slice(0, 600)}`);
	}
	fs.writeFileSync(path.join(work, `${command.split(" ")[0].slice(1)}-${Date.now()}.out`), out);
	const created = [...listRuns()].filter((d) => !before.has(d));
	return created.length === 1 ? path.join("/tmp", created[0]) : undefined;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

/** What a role's session shows: tool calls that touched the context dir, and mentions of the ctx id. */
function sessionEvidence(cwd, ctxId) {
	const root = sessionsDirFor(cwd);
	const out = { files: 0, readsUnderContextDir: [], mentionsCtxId: false, toolCalls: 0 };
	if (!fs.existsSync(root)) return out;
	for (const dp of fs.readdirSync(root)) {
		const d = path.join(root, dp);
		if (!fs.statSync(d).isDirectory()) continue;
		for (const f of fs.readdirSync(d)) {
			const txt = fs.readFileSync(path.join(d, f), "utf-8");
			out.files++;
			if (ctxId && txt.includes(ctxId)) out.mentionsCtxId = true; // NB: the prompt itself carries the id in the "on" arm
			for (const line of txt.split("\n")) {
				let o;
				try {
					o = JSON.parse(line);
				} catch {
					continue;
				}
				const m = o?.message && typeof o.message === "object" ? o.message : o;
				if (m?.role !== "assistant") continue;
				for (const c of m.content ?? []) {
					if (c?.type !== "toolCall") continue;
					out.toolCalls++;
					const a = JSON.stringify(c.arguments ?? {});
					if (a.includes(contextDir)) out.readsUnderContextDir.push(`${c.name}: ${a.slice(0, 160)}`);
				}
			}
		}
	}
	return out;
}

function stageReport(runDir) {
	if (!runDir) return { runDir: null };
	const s = readJson(path.join(runDir, "summary.json"));
	const brief = readJson(path.join(runDir, "brief.json"));
	const gate = fs.existsSync(path.join(runDir, "gate.py")) ? fs.readFileSync(path.join(runDir, "gate.py"), "utf-8") : "";
	const gateRuns = fs.readdirSync(runDir).filter((f) => /^gate-(baseline|round-\d+)\.txt$/.test(f)).sort().map((f) => `${f}: ${fs.readFileSync(path.join(runDir, f), "utf-8").split("\n")[0]}`);
	return {
		runDir,
		ok: s.ok,
		rounds: s.rounds,
		gateExitCode: s.gateExitCode,
		costUsd: s.totalCostUsd,
		agents: s.agents.map((a) => ({ role: a.role, model: a.model, tokensIn: a.tokensIn, tokensOut: a.tokensOut, costUsd: a.costUsd, toolCalls: a.toolCalls })),
		icmRetrievalLine: brief.decisions.find((d) => d.startsWith("icm retrieval:")) ?? null,
		gateRuns,
		gateMentionsCents: /cent/i.test(gate),
		gateChecksFloatRejected: /ValueError/.test(gate) && /float|1\.5|0\.1|\d+\.\d+/.test(gate),
		gateLines: gate.split("\n").length,
	};
}

const report = { arm, architect: ARCHITECT, builder: BUILDER, thinking: THINKING, scratch: work, contextDir };
try {
	console.error(`[${arm}] scratch ${work}`);
	console.error(`[${arm}] stage 1 …`);
	const s1 = harness(`/auto-validate --max-validations 3 --escalate-to-validator-count 3 ${STAGE1}`);
	report.stage1 = stageReport(s1);
	console.error(`[${arm}] stage 1: ok=${report.stage1.ok} rounds=${report.stage1.rounds} cost=$${report.stage1.costUsd}`);
	if (!s1 || !report.stage1.ok) throw new Error("stage 1 did not pass its gate — nothing to promote; stopping (no further spend)");

	gitc("add", "-A");
	gitc("commit", "-q", "-m", "stage 1: ledger package");
	harness(`/icm-promote ${s1}`, [], 120_000);
	const idx = readJson(path.join(contextDir, "index.json"));
	const ctxId = idx.entries[0]?.id ?? null;
	report.promoted = ctxId;
	if (!ctxId) throw new Error("promotion failed; stopping");

	// Fresh memory for stage 2: the harness would otherwise RESUME stage 1's role sessions.
	const sess = sessionsDirFor(proj);
	report.sessionsResetBeforeStage2 = fs.existsSync(sess);
	fs.rmSync(sess, { recursive: true, force: true });

	console.error(`[${arm}] stage 2 (${arm === "off" ? "--icm-retrieve off" : "retrieval on"}) …`);
	const s2 = harness(`/auto-validate --max-validations 3 --escalate-to-validator-count 3 ${STAGE2}`, arm === "off" ? ["--icm-retrieve", "off"] : []);
	report.stage2 = stageReport(s2);
	report.stage2.validatorSession = sessionEvidence(proj, ctxId);
	report.stage2.exportPy = fs.existsSync(path.join(proj, "ledger", "export.py")) ? fs.readFileSync(path.join(proj, "ledger", "export.py"), "utf-8").slice(0, 1500) : null;
	report.stage2.builderReport = s2 && fs.existsSync(path.join(s2, "builder-round-1.md")) ? fs.readFileSync(path.join(s2, "builder-round-1.md"), "utf-8").slice(0, 1200) : null;
	report.stage2.validatorReport = s2 && fs.existsSync(path.join(s2, "validator.md")) ? fs.readFileSync(path.join(s2, "validator.md"), "utf-8").slice(0, 1200) : null;
	console.error(`[${arm}] stage 2: ok=${report.stage2.ok} rounds=${report.stage2.rounds} cost=$${report.stage2.costUsd}`);
	report.totalCostUsd = (report.stage1.costUsd ?? 0) + (report.stage2.costUsd ?? 0);
} catch (e) {
	report.error = String(e.message ?? e);
	console.error(`[${arm}] ${report.error}`);
} finally {
	fs.writeFileSync(path.join(work, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
}
