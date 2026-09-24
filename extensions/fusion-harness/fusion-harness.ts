/**
 * fusion-harness — FUSE frontier models instead of racing them. AND, not OR.
 *
 * Three slash commands, one clarity-first two-column experience:
 *
 *   /fusion <prompt> [:: <fusion-prompt>]
 *       ARCHITECT and BUILDER both answer <prompt> in parallel (independent
 *       read-only sessions), streaming live in two side-by-side columns. A
 *       third FUSION agent (the architect model, fresh session) then merges
 *       the two per <fusion-prompt> — default: critical merge with a
 *       Consensus & Divergence section citing [ARCHITECT]/[BUILDER].
 *
 *   /auto-validate <prompt>
 *       BUILDER executes <prompt> (it may write files — the working agent).
 *       VALIDATOR (the architect model) then WRITES a uv single-file Python
 *       gate script that proves the result; we run it and render builder
 *       report | gate script side by side under a PASS/FAIL verdict.
 *
 *   /opinion <prompt>
 *       Both models answer independently; one two-column panel compares them
 *       (model · latency · tokens · cost · answer). No fusion.
 *
 *   /system-prompt
 *       Zero-cost introspection: the system prompt each role runs with,
 *       ARCHITECT | BUILDER side by side — the --<role>-system-prompt override
 *       (file contents win over inline text), or pi's actual default prompt.
 *
 * DX contract (the #1 priority):
 *   - The experience mirrors a vanilla pi session — tool-call lines, streaming
 *     text, footer stats — but split into TWO COLUMNS we fully control:
 *     ARCHITECT-family on the left, BUILDER on the right, everywhere.
 *   - While children run, a live widget streams each agent's flow (tool calls
 *     + response text) in its own column with per-role colors + telemetry
 *     (glyph · role · model · state · elapsed · tokens · cost).
 *   - The footer is replaced with the same aligned two-column view: one cell per
 *     model — `◆ ROLE | model (med) | [██--------] pct%` — thinking + context bar.
 *   - Child output is buffered per agent — never interleaved. Final panels
 *     render the two answers side by side as real markdown columns.
 *   - Failures are attributed to the specific role+model with the real error.
 *
 * Plumbing: every agent is a spawned `pi --mode json -p` subprocess with a
 * fully-qualified `provider/id` model and a throwaway --session-dir under a
 * per-run /tmp/fusion-harness-* artifacts dir. Nothing is written to the repo.
 *
 * Flags:
 *   --architect <provider/id>   plans / fuses / validates  (default anthropic/claude-fable-5)
 *   --builder   <provider/id>   builds                     (default openai/gpt-5.6-sol)
 *
 * Launch:  pi -e extensions/fusion-harness/fusion-harness.ts
 *
 * File map (top to bottom):
 *   1. Defaults            — models, tool matrices, timeouts, size caps
 *   2. Roles               — the four roles + their colors and glyphs
 *   3. Types               — AgentRun (live child state), AgentStat, FhDetails (panel payloads)
 *   4. Small helpers       — formatting, truncation, run bookkeeping
 *   5. Two-column layout   — TwoCol / FullWidth, the core rendering primitives
 *   6. Child runner        — runChild (pi subprocess + JSON event stream), runProc (the gate)
 *   7. Prompts             — file-backed templates ({{VAR}} interpolation) + builders
 *   8. Extension           — flags, sessions, footer, renderer, and the commands:
 *                            /fh-reset · /thinking · /system-prompt · /fusion ·
 *                            /auto-validate · /opinion
 */

import { spawn } from "node:child_process"; // child pi agents + the uv gate
import { randomUUID } from "node:crypto"; // persistent per-role session ids
import * as fs from "node:fs"; // prompt files, artifacts, session manifests
import * as os from "node:os"; // tmpdir fallback when /tmp is missing
import * as path from "node:path"; // every artifact/session path
import { type ExtensionAPI, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { ensureGateMetadata, gateStartFailure } from "./gate.ts"; // gate header normalisation + "the gate could not start" classification (pure, tested)
import { createIcmRun, excerpt, type ArtifactType, type ContextEnvelope, type EnvelopeInput, type IcmRun } from "./icm/envelope.ts"; // ICM Phase 1 — observe-only envelopes
import { DIAG_CLAIMS_MAX, diagnosticsToClaims, parseGateDiagnostics, readEnvelope, renderDiagnostics, renderHandoff } from "./icm/handoff.ts"; // ICM Phase 2 — structured, verified handoffs
import { assessRun, defaultContextDir, listContext, promoteRun, retractContext, showContext } from "./icm/promote.ts"; // ICM Phase 3 — manual, validation-backed promotion
import { clampLimit, describeRetrieval, gitIsAncestor, renderRetrieved, type RetrievalResult, type RetrievalRole, retrieveContext } from "./icm/retrieve.ts"; // ICM Phase 4 — deterministic retrieval + role projection of VALIDATED context

// ═══ 1. Defaults ═════════════════════════════════════════════════════════════

const DEFAULT_ARCHITECT = "anthropic/claude-fable-5"; // plans, fuses, validates
const DEFAULT_BUILDER = "openai/gpt-5.6-sol"; // builds (and hosts — see the launch recipes)

const READONLY_TOOLS = "read,grep,find,ls"; // parallel agents share a cwd — concurrent writers would collide
const OPINION_TOOLS = "read,grep,find,ls,bash"; // everything except write/edit
const FULL_TOOLS = "read,grep,find,ls,bash,edit,write"; // sequential agents (builder, fuser) act freely
// The VALIDATOR reads the project read-only but must WRITE its gate straight to disk:
// piping a gate through a fenced code block truncates it at the first embedded ``` (a
// gate that greps for markdown fences contains one), so the script is written, not pasted.
// `write` is scoped to the run's gate path by the VALIDATOR's system prompt — it still
// never touches the project, and it gets no `edit`/`bash` to mutate one with. The TRIAGE
// turn holds the same toolset while the run's single gate repair is unused (a GATE DEFECT
// diagnosis may rewrite the gate at that one path), then drops to READONLY_TOOLS.
const VALIDATOR_TOOLS = "read,grep,find,ls,write";

const CHILD_TIMEOUT_S_DEFAULT = 28_800; // 8h — every spawned child; real work runs for hours (--child-timeout overrides)
const BUILD_TIMEOUT_MS_FLOOR = 28_800_000; // /auto-validate builder floor — never below 8h even with a small --child-timeout
const GATE_TIMEOUT_MS = 120_000; // `uv run` of the validation gate
const KILL_GRACE_MS = 5_000; // SIGTERM → SIGKILL escalation window
const WIDGET_TICK_MS = 1_000; // live-widget refresh cadence

const WIDGET_FLOW_LINES = 8; // live streaming lines shown per column
const MIN_TWO_COL_WIDTH = 100; // below this, columns stack
const ANSWER_MAX_BYTES = 100_000; // cap any rendered agent answer
const HANDOFF_MAX = 60_000; // chars of one agent's answer injected into another's prompt
const DETAIL_SNIPPET_MAX = 4_000; // chars of script/output kept in message details

const CUSTOM_TYPE = "fusion-harness"; // customType tag on every panel/widget/status this extension emits

// ═══ 2. Roles ════════════════════════════════════════════════════════════════

type Role = "ARCHITECT" | "BUILDER" | "FUSION" | "VALIDATOR";

/** One consistent color per role, everywhere (columns, footer, panels, errors). */
const ROLE_COLOR: Record<Role, "accent" | "warning" | "success" | "mdLink"> = {
	ARCHITECT: "accent",
	BUILDER: "warning",
	FUSION: "success",
	VALIDATOR: "mdLink",
};

/** One consistent glyph per role, paired with the color above. */
const ROLE_GLYPH: Record<Role, string> = {
	ARCHITECT: "◆",
	BUILDER: "▲",
	FUSION: "⧉",
	VALIDATOR: "✓",
};

// ═══ 3. Types ════════════════════════════════════════════════════════════════

/** Lifecycle of one spawned child agent, from queued to settled. */
type ChildStatus = "pending" | "working" | "done" | "failed" | "timeout" | "aborted";

/** One entry in an agent's transcript flow: a tool call, a finished text block, or a reasoning block. */
type FlowItem = { type: "tool"; label: string } | { type: "text"; text: string } | { type: "thinking"; text: string };

/** Live + final view of one child agent. Mutated in place as JSON events stream in. */
interface AgentRun {
	role: Role;
	model: string;
	status: ChildStatus;
	startedAt?: number;
	endedAt?: number;
	ms: number;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
	toolCalls: number;
	ctxTokens: number; // context used by the last request (for the footer bar)
	thinking?: string;
	flow: FlowItem[]; // the agent's transcript flow: tool lines + finished text blocks
	flowMark: number; // flow index at the current spawn — the widget only shows flow from HERE (no stale rounds)
	sessionRef?: string; // the child's own session id (from its "session" event) — lets later rounds resume it
	streamText: string; // text of the in-flight assistant message
	streamThinking: string; // reasoning of the in-flight assistant message (rendered live — proof of life)
	text: string;
	exitCode: number;
	stopReason?: string;
	errorMessage?: string;
	stderr: string;
}

/** Serializable per-agent stats for message details / artifacts. */
interface AgentStat {
	role: Role;
	model: string;
	status: ChildStatus;
	ms: number;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
	toolCalls: number;
	chars: number;
	error?: string;
}

/** The renderer's discriminated payload — one shape per panel `kind`, carried on every custom message. */
interface FhDetails {
	kind: "prompt" | "banner" | "duo" | "fused" | "opinion" | "gate" | "validation" | "triage" | "error" | "system-prompt" | "boot" | "icm";
	command?: "fusion" | "auto-validate" | "opinion" | "system-prompt" | "icm-promote" | "icm-context"; // absent on "boot" — it belongs to no command
	ok: boolean;
	round?: number; // auto-validate: which build→validate round this panel reports
	maxRounds?: number; // auto-validate: the --max-validations cap
	escalateAt?: number; // auto-validate: the --escalate-to-validator-count threshold
	prompt?: string;
	fusionPrompt?: string;
	roles?: Array<{ role: Role; model: string }>;
	agent?: AgentStat; // fused: the fuser · validation: the validator
	sources?: AgentStat[]; // the two columns' stats (left, right)
	answers?: Array<{ role: Role; model: string; text: string }>; // column bodies (left, right)
	script?: string; // validation gate (truncated for details)
	gateOutput?: string;
	gateExitCode?: number;
	scriptPath?: string;
	artifactsDir?: string;
	icm?: Array<{ file: string; kind: string; status: string; role: string; ok: boolean }>; // ICM: this run's envelope roster so far (Phase 2 renders it; nothing decides on it)
	icmConsumed?: string[]; // ICM: envelope files a role consumed as a verified structured handoff in this step
	icmPromotable?: boolean; // ICM (Phase 3): this run's output is eligible for MANUAL promotion — /icm-promote <artifactsDir>
	icmRetrieved?: string; // ICM (Phase 4): one line on what durable context this run retrieved into its prompts, or why nothing
	totalMs?: number;
	totalCostUsd?: number;
	error?: string;
}

// ═══ 4. Small helpers ════════════════════════════════════════════════════════

/** Locate the running pi binary so we can re-invoke it as a child. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1]; // the entry script pi itself was launched with
	const isBunVirtual = script?.startsWith("/$bunfs/root/"); // bun-compiled binaries mount a virtual fs
	// Best case: re-run the exact same entry script with the same runtime.
	if (script && !isBunVirtual && fs.existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	// A compiled pi binary (execPath IS pi): invoke it directly.
	if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
	// Last resort: whatever `pi` resolves to on PATH.
	return { command: "pi", args };
}

/** Truncate by character count, with an explicit elision marker (prompt handoffs). */
function truncateChars(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}\n… [truncated — ${s.length - max} chars elided]`;
}

/** Truncate by UTF-8 byte count (panel bodies — pi caps message size in bytes). */
function truncateBytes(s: string, max: number): string {
	const buf = Buffer.from(s, "utf-8");
	if (buf.length <= max) return s;
	return `${buf.subarray(0, max).toString("utf-8")}\n\n… [truncated — ${buf.length - max} bytes elided]`;
}

/** 12345 → "12.3s" */
function fmtSecs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** 12345 → "12.3k" (token counts) */
function fmtK(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

/** Display-width model name: provider stripped, ellipsized past 24 chars (labels only — never paths). */
function shortModel(m: string): string {
	const seg = m.split("/").pop() ?? m;
	return seg.length > 24 ? `${seg.slice(0, 23)}…` : seg;
}

/**
 * Filename-safe model tag: provider stripped, anything but [A-Za-z0-9._-] collapsed to `-`.
 * NOT shortModel(): that truncates long ids with a `…`, and these tags land in real paths.
 */
function modelTag(m: string): string {
	return (m.split("/").pop() ?? m).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "model";
}

/** A fresh AgentRun in its zero state — mutated in place by runChild as events stream. */
function newRun(role: Role, model: string): AgentRun {
	return {
		role,
		model,
		status: "pending",
		ms: 0,
		tokensIn: 0,
		tokensOut: 0,
		costUsd: 0,
		toolCalls: 0,
		ctxTokens: 0,
		streamThinking: "",
		flow: [],
		flowMark: 0,
		streamText: "",
		text: "",
		exitCode: 0,
		stderr: "",
	};
}

/** Success = clean exit ∧ clean stop reason ∧ nonempty answer. */
function runOk(r: AgentRun): boolean {
	return r.exitCode === 0 && r.stopReason !== "error" && r.stopReason !== "aborted" && r.text.trim().length > 0;
}

/** The most specific failure description available, in priority order. */
function runError(r: AgentRun): string {
	return (
		(r.status === "aborted" ? "stopped by user (escape)" : "") ||
		r.errorMessage ||
		(r.status === "timeout" || r.exitCode === 124 ? "timed out" : "") ||
		r.stderr.trim().slice(-300) ||
		(r.text.trim() ? "" : "no output") ||
		`exit ${r.exitCode}`
	);
}

/** Freeze a live AgentRun into the serializable stat used by panels and summary.json. */
function toStat(r: AgentRun): AgentStat {
	return {
		role: r.role,
		model: r.model,
		status: r.status,
		ms: r.ms,
		tokensIn: r.tokensIn,
		tokensOut: r.tokensOut,
		costUsd: r.costUsd,
		toolCalls: r.toolCalls,
		chars: r.text.length,
		error: runOk(r) ? undefined : runError(r),
	};
}

/** Compact one-line stats: `12.3s · in 1.2k out 0.4k · 3 tools · $0.0123` */
function statLine(s: AgentStat): string {
	const parts = [fmtSecs(s.ms)];
	if (s.tokensIn || s.tokensOut) parts.push(`in ${fmtK(s.tokensIn)} out ${fmtK(s.tokensOut)}`);
	if (s.toolCalls) parts.push(`${s.toolCalls} tools`);
	if (s.costUsd) parts.push(`$${s.costUsd.toFixed(4)}`);
	return parts.join(" · ");
}

/**
 * A tool call's argument, condensed for one flow line.
 *
 * The cap here is a MEMORY bound, not a layout one — it must stay far wider than any
 * column so a wide terminal shows a wide line. Fitting is the renderer's job: TwoCol
 * (`truncateToWidth` per column) and `FullWidth` (`fitLines`) clamp to the real width at
 * render, which is what actually keeps pi from throwing on an over-wide line. Capping at
 * capture instead trimmed every view to the narrowest one it might ever be drawn in.
 */
const TOOL_ARG_MAX = 200;
function briefArg(args: any): string {
	if (!args || typeof args !== "object") return "";
	const v =
		args.path ?? args.file_path ?? args.filePath ?? args.pattern ?? args.command ?? Object.values(args).find((x) => typeof x === "string");
	if (typeof v !== "string" || !v) return "";
	const s = v.includes("/") && !v.includes(" ") ? v.split("/").slice(-2).join("/") : v;
	return s.replace(/\s+/g, " ").slice(0, TOOL_ARG_MAX);
}

/** One glyph per child status, used in state lines and stat rows. */
const STATUS_GLYPH: Record<ChildStatus, string> = {
	pending: "○",
	working: "◐",
	done: "✓",
	failed: "✗",
	timeout: "✗",
	aborted: "⊘",
};

/** Footer-width abbreviations for pi's thinking levels (pi: ModelThinkingLevel). */
const THINKING_SHORT: Record<string, string> = {
	off: "none",
	minimal: "min",
	low: "low",
	medium: "med",
	high: "hi",
	xhigh: "xhi",
	max: "max",
};
/** ` (med)` — the parenthesized short thinking level appended to a model label. */
const thinkingTag = (level?: string): string => (level ? ` (${THINKING_SHORT[level] ?? level})` : "");

// ═══ 5. Two-column layout ════════════════════════════════════════════════════

/** Hard clamp: pi throws on any rendered line wider than the terminal, so every line we emit must fit. */
function fitLines(lines: string[], width: number): string[] {
	const w = Math.max(1, width);
	return lines.map((l) => (visibleWidth(l) > w ? truncateToWidth(l, w) : l));
}

/**
 * The core layout primitive: two columns we completely control, rendered at
 * whatever width the TUI gives us. Below MIN_TWO_COL_WIDTH the columns stack
 * (left block, then right block) so narrow terminals stay readable.
 */
class TwoCol {
	constructor(
		private build: (colW: number, stacked: boolean) => { left: string[]; right: string[] },
		private gutter: string = "  ",
	) {}
	render(width: number): string[] {
		// Narrow terminal: stack left block over right block instead of squeezing columns.
		if (width < MIN_TWO_COL_WIDTH) {
			const { left, right } = this.build(Math.max(20, width), true);
			return fitLines([...left, "", ...right], width);
		}
		const gw = visibleWidth(this.gutter);
		const colW = Math.floor((width - gw) / 2); // equal halves of what's left after the gutter
		const { left, right } = this.build(colW, false);
		const out: string[] = [];
		const n = Math.max(left.length, right.length);
		// Zip the two columns row by row: clamp left, pad it to the column edge, gutter, clamp right.
		for (let i = 0; i < n; i++) {
			const l = truncateToWidth(left[i] ?? "", colW);
			const pad = " ".repeat(Math.max(0, colW - visibleWidth(l)));
			out.push(l + pad + this.gutter + truncateToWidth(right[i] ?? "", colW));
		}
		return fitLines(out, width);
	}
	invalidate() {} // pi-tui Component contract — nothing cached to invalidate
}

/**
 * A full-width row (the FUSION merge stage), rendered at the width the TUI actually gives
 * us — the same clamp discipline as TwoCol, one column instead of two. It exists so the
 * span row can't be pinned to a guessed width: hardcoding one trims a 200-col terminal to
 * the guess, and guessing high would emit lines wider than a narrow terminal (which pi
 * throws on). Ask for the width, then fit to it.
 */
class FullWidth {
	constructor(private build: (w: number) => string[]) {}
	render(width: number): string[] {
		const inner = Math.max(20, width - 2); // leave room for the 1-col pad on each side
		return fitLines(
			this.build(inner).map((l) => ` ${l}`),
			width,
		);
	}
	invalidate() {} // pi-tui Component contract — nothing cached to invalidate
}

/** Wrap possibly-styled text to a column width, defensively. */
function wrapCol(text: string, colW: number): string[] {
	try {
		return wrapTextWithAnsi(text, Math.max(10, colW));
	} catch {
		return text.split("\n");
	}
}

/** Render markdown to styled lines at a column width (the "same output as pi" body). */
function mdLines(text: string, colW: number): string[] {
	try {
		return new Markdown(text || "(no output)", 0, 0, getMarkdownTheme()).render(Math.max(10, colW));
	} catch {
		return wrapCol(text, colW);
	}
}

// ═══ 6. Child runner ═════════════════════════════════════════════════════════

/**
 * Spawn one `pi --mode json -p` child agent and stream its JSON events into `run`.
 * Final answer = last assistant text part. The child writes its session into a
 * throwaway --session-dir under the run's /tmp artifacts dir.
 */
function runChild(opts: {
	run: AgentRun; // mutated live
	prompt: string;
	systemPrompt?: string;
	tools: string | "none";
	thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	sessionDir: string;
	sessionId?: string; // stable per-role session — the agent keeps its context across commands
	fork?: string; // fork this session FILE (copy-on-write) — the child inherits the host's full context
	resume?: string; // resume this session id inside sessionDir (later auto-validate rounds re-enter the fork)
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal; // escape key — kill this child and settle it as "aborted"
}): Promise<AgentRun> {
	const run = opts.run;
	run.thinking = opts.thinking;
	// Clean-room spawn: children never load skills, extensions (recursion guard), or
	// context files — their entire contract comes from the harness's prompt files.
	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--session-dir",
		opts.sessionDir,
		"--no-skills",
		"--no-extensions",
		"--no-context-files",
		"--thinking",
		opts.thinking,
		"--model",
		run.model,
	];
	// Session identity, in precedence order: fork the host > resume an earlier fork > pinned per-role id.
	if (opts.fork) args.push("--fork", opts.fork);
	else if (opts.resume) args.push("--session", opts.resume);
	else if (opts.sessionId) args.push("--session-id", opts.sessionId);
	if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
	if (opts.tools === "none") args.push("--no-tools");
	else args.push("--tools", opts.tools);
	args.push(opts.prompt);

	return new Promise<AgentRun>((resolve) => {
		const started = Date.now();
		let buffer = "";
		let timedOut = false;
		let aborted = false;
		// Already stopped before this stage began (e.g. escape during the previous agent):
		// settle without spawning, so an abort never starts new model work.
		if (opts.signal?.aborted) {
			run.status = "aborted";
			run.startedAt = started;
			run.endedAt = started;
			run.ms = 0;
			run.exitCode = 130;
			resolve(run);
			return;
		}
		run.status = "working";
		run.startedAt = started;
		run.flowMark = run.flow.length;

		// One line of the child's JSON event stream → the relevant AgentRun mutation.
		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return; // non-JSON noise on stdout — ignore
			}
			if (event.type === "session" && typeof event.id === "string") {
				run.sessionRef = event.id; // remember the child's session so later rounds can resume it
			} else if (event.type === "message_end" && event.message?.role === "assistant") {
				const msg = event.message;
				for (const part of msg.content ?? []) {
					// A turn's reasoning arrives as `thinking` parts (pi-ai ThinkingContent) — a
					// different shape from `text`, which is why it was invisible before.
					if (part.type === "thinking" && part.thinking?.trim()) {
						run.flow.push({ type: "thinking", text: part.thinking });
					}
					if (part.type === "text" && part.text?.trim()) {
						run.text = part.text;
						run.flow.push({ type: "text", text: part.text });
					}
				}
				run.streamText = "";
				run.streamThinking = "";
				if (msg.stopReason) run.stopReason = msg.stopReason;
				if (msg.errorMessage) run.errorMessage = msg.errorMessage;
				if (msg.usage) {
					// Prompt tokens = input + cacheRead + cacheWrite (pi's own definition, see
					// core/cache-stats.ts). cacheWrite is NOT optional accounting: on a cold
					// cache the WHOLE prompt is billed as a write and `input` is only the few
					// uncached tokens — dropping it renders a real 10k-token prompt as "in 3".
					run.tokensIn += (msg.usage.input || 0) + (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0);
					run.tokensOut += msg.usage.output || 0;
					if (msg.usage.cost?.total) run.costUsd += msg.usage.cost.total;
					// Matches pi's calculateContextTokens: `totalTokens || input+output+read+write`
					// (|| not ??, so a provider reporting 0 falls through to the sum).
					const ctxTokens =
						msg.usage.totalTokens || (msg.usage.input || 0) + (msg.usage.cacheRead || 0) + (msg.usage.cacheWrite || 0) + (msg.usage.output || 0);
					// Children emit an opening message_end whose usage fields are all null; this is
					// an assignment, not a sum, so counting one would clobber a real reading with 0.
					if (ctxTokens > 0) run.ctxTokens = ctxTokens;
				}
			} else if (event.type === "tool_execution_start") {
				run.toolCalls++;
				const name: string = event.toolName ?? "?";
				const arg = briefArg(event.args);
				run.flow.push({ type: "tool", label: arg ? `${name} ${arg}` : name });
			} else if (event.type === "message_update" && event.message?.role === "assistant") {
				let t = "";
				let think = "";
				for (const part of event.message.content ?? []) {
					if (part.type === "text" && part.text) t += part.text;
					else if (part.type === "thinking" && part.thinking) think += part.thinking;
				}
				if (t) run.streamText = t;
				// Streaming the reasoning is what makes a long opening turn look ALIVE: an agent
				// at xhigh on a big session can think for minutes before its first token of text,
				// and rendering nothing made it read as hung.
				if (think) run.streamThinking = think;
			}
		};

		const settle = () => {
			run.endedAt = Date.now();
			run.ms = run.endedAt - started;
			// abort wins over runOk: a killed child may still have emitted usable text, but the
			// user asked it to stop — reporting "done" would silently accept a partial answer.
			run.status = aborted ? "aborted" : runOk(run) ? "done" : timedOut ? "timeout" : "failed";
			run.streamText = "";
		};

		const invocation = piInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd: opts.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			// Children still make their real model API calls — this only skips startup chores.
			env: { ...process.env, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" },
		});

		// Line-buffer stdout: events arrive one JSON object per line, possibly split across chunks.
		proc.stdout?.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // keep the trailing partial line for the next chunk
			for (const line of lines) processLine(line);
		});
		proc.stderr?.on("data", (data: Buffer) => {
			run.stderr += data.toString();
		});
		// SIGTERM, then SIGKILL after the grace period — same escalation as the timeout path.
		const killChild = () => {
			try {
				proc.kill("SIGTERM");
			} catch {
				/* already gone */
			}
			setTimeout(() => {
				if (!proc.killed) {
					try {
						proc.kill("SIGKILL");
					} catch {
						/* already gone */
					}
				}
			}, KILL_GRACE_MS);
		};
		const onAbort = () => {
			aborted = true;
			killChild();
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		const cleanup = () => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
		};

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer); // flush a final unterminated line
			run.exitCode = aborted ? 130 : timedOut ? 124 : (code ?? 0);
			cleanup();
			settle();
			resolve(run);
		});
		proc.on("error", (err) => {
			run.stderr += `\nspawn error: ${String(err)}`;
			run.exitCode = 1;
			cleanup();
			settle();
			resolve(run);
		});

		// Wall-clock timeout: same SIGTERM → SIGKILL escalation as the abort path.
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			setTimeout(() => {
				if (!proc.killed) {
					try {
						proc.kill("SIGKILL");
					} catch {
						/* ignore */
					}
				}
			}, KILL_GRACE_MS);
		}, opts.timeoutMs);
	});
}

/** Run a plain subprocess (the validation gate) and capture combined output. */
function runProc(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ code: number; output: string; aborted?: boolean }> {
	return new Promise((resolve) => {
		let output = "";
		let timedOut = false;
		let aborted = false;
		// A gate can burn the full 120s timeout; escape must cut it short like any child.
		if (signal?.aborted) {
			resolve({ code: 130, output: "[stopped by user before the gate ran]", aborted: true });
			return;
		}
		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		} catch (err) {
			resolve({ code: 127, output: `failed to spawn ${command}: ${String(err)}` });
			return;
		}
		const onAbort = () => {
			aborted = true;
			try {
				proc.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		proc.stdout?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		proc.on("close", (code) => {
			cleanup();
			if (aborted) {
				resolve({ code: 130, output: `${output}\n[stopped by user]`, aborted: true });
				return;
			}
			resolve({ code: timedOut ? 124 : (code ?? 0), output: timedOut ? `${output}\n[gate timed out]` : output });
		});
		proc.on("error", (err) => {
			cleanup();
			resolve({ code: 127, output: `${output}\nspawn error: ${String(err)}` });
		});
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				proc.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}, timeoutMs);
	});
}

// ═══ 7. Prompts ══════════════════════════════════════════════════════════════
// Every default prompt lives in its own file next to this extension —
// SYSTEM_PROMPT_*.md and USER_PROMPT_*.md — with {{VARIABLE}} interpolation.
// Edit those files to tune the harness without touching code.

// Directory holding this extension file (and therefore its prompt files) —
// __dirname under CJS transpilation, import.meta.url under ESM.
const EXT_DIR: string =
	typeof __dirname !== "undefined" && __dirname
		? __dirname
		: path.dirname(new URL(import.meta.url).pathname);

const promptCache = new Map<string, string>(); // each template file is read once per process
/** Load a prompt template from disk (cached). A missing file is a loud load-time error. */
function promptTemplate(file: string): string {
	let tpl = promptCache.get(file);
	if (tpl === undefined) {
		try {
			tpl = fs.readFileSync(path.join(EXT_DIR, file), "utf-8").trim();
		} catch (err) {
			throw new Error(`fusion-harness: missing prompt file ${file} (expected next to the extension): ${String(err)}`);
		}
		promptCache.set(file, tpl);
	}
	return tpl;
}

/** Interpolate a template: every {{KEY}} is replaced from vars (missing keys → empty). */
function fill(file: string, vars: Record<string, string>): string {
	return promptTemplate(file).replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

/** Phase 4: a rendered retrieval block as a template slot — empty block ⇒ empty slot ⇒ the prompt is content-identical to its Phase 3 shape. */
const contextSlot = (block?: string): string => (block?.trim() ? `\n${block.trim()}\n` : "");

/** The /fusion parallel-worker prompt — each worker knows its own role AND its counterpart. */
function workerPrompt(role: Role, model: string, otherRole: Role, otherModel: string, prompt: string, icmContext = ""): string {
	return fill("USER_PROMPT_FUSION_WORKER.md", { ROLE: role, MODEL: model, OTHER_ROLE: otherRole, OTHER_MODEL: otherModel, PROMPT: prompt, ICM_CONTEXT: contextSlot(icmContext) });
}

/** The built-in critical-merge instruction, used when /fusion gets no explicit fusion prompt. */
const defaultFusionPrompt = (): string => promptTemplate("USER_PROMPT_FUSION_DEFAULT_INSTRUCTION.md");

/**
 * /fusion argument parsing — two forms:
 *   Quoted:    /fusion "prompt to both agents" "fusion instruction"
 *   Separator: /fusion prompt to both agents :: fusion instruction
 * A lone prompt (either form) uses the default critical-merge instruction.
 */
function parseFusionArgs(input: string): { prompt: string; fusion?: string } {
	// Quoted form: first quoted string is the prompt, the (optionally quoted) rest is the instruction.
	const quoted = input.match(/^\s*(["'])([\s\S]*?)\1\s*([\s\S]*)$/);
	if (quoted?.[2]?.trim()) {
		let rest = quoted[3].trim();
		const restQuoted = rest.match(/^(["'])([\s\S]*?)\1\s*$/);
		if (restQuoted) rest = restQuoted[2].trim();
		return { prompt: quoted[2].trim(), fusion: rest || undefined };
	}
	// Separator form: split on the first " :: ".
	const sep = input.indexOf(" :: ");
	if (sep !== -1) return { prompt: input.slice(0, sep).trim(), fusion: input.slice(sep + 4).trim() || undefined };
	// Lone prompt — caller substitutes the default fusion instruction.
	return { prompt: input.trim() };
}

/** The FUSION merge envelope: both answers, both file paths, and the output contract. */
function fuserPrompt(
	fusionInstruction: string,
	prompt: string,
	a: { role: Role; model: string; text: string },
	b: { role: Role; model: string; text: string },
	fuserModel: string,
	fuserThinking: string,
	artifactsDir: string,
	icmHandoff = "", // Phase 2: the verified spec+build envelopes, rendered — empty means the Phase 1 prompt
): string {
	return fill("USER_PROMPT_FUSION_MERGE.md", {
		FUSION_INSTRUCTION: fusionInstruction,
		ICM_HANDOFF: icmHandoff,
		MODEL: shortModel(fuserModel),
		THINKING: fuserThinking,
		PROMPT: prompt,
		A_ROLE: a.role,
		A_MODEL: a.model,
		A_TEXT: truncateChars(a.text, HANDOFF_MAX),
		B_ROLE: b.role,
		B_MODEL: b.model,
		B_TEXT: truncateChars(b.text, HANDOFF_MAX),
		// Filename-safe tags for BOTH source models: a fused artifact is the product of the
		// pair, so it's named after the pair — not after whichever model happened to merge.
		A_TAG: modelTag(a.model),
		B_TAG: modelTag(b.model),
		// Grounding: the fuser has full tools but no idea where this run's material lives —
		// without these paths it resorts to scanning the filesystem for files the workers
		// mentioned. The <role>.md files are saved BEFORE the fuser spawns and are complete
		// even when the inline texts above were truncated at HANDOFF_MAX.
		ARTIFACTS_DIR: artifactsDir,
		A_PATH: path.join(artifactsDir, `${a.role.toLowerCase()}.md`),
		B_PATH: path.join(artifactsDir, `${b.role.toLowerCase()}.md`),
		HANDOFF_MAX: String(HANDOFF_MAX),
	});
}

/** Round 1 of /auto-validate: the user's request plus the full (immutable) gate script (+ Phase 4: retrieved prior context, projected for the builder). */
function builderPrompt(prompt: string, gateScript: string, icmContext = ""): string {
	return fill("USER_PROMPT_BUILDER.md", { PROMPT: prompt, GATE_SCRIPT: gateScript, ICM_CONTEXT: contextSlot(icmContext) });
}

/** Rounds 2+: the verbatim gate failure, plus optional triage brief and repaired-gate update. */
function correctionPrompt(
	round: number,
	maxRounds: number,
	gateExitCode: number,
	gateOutput: string,
	triageBrief?: string,
	repairedGate?: string,
	icmDiagnostics?: string, // Phase 2: the gate's FAIL lines as structured claims from the validation envelope
): string {
	const remaining = maxRounds - round;
	return fill("USER_PROMPT_CORRECTION.md", {
		ROUND: String(round),
		ICM_DIAGNOSTICS_BLOCK: icmDiagnostics?.trim() ? `\n${icmDiagnostics.trim()}\n` : "",
		MAX_ROUNDS: String(maxRounds),
		REMAINING: `${remaining} attempt${remaining === 1 ? "" : "s"} remain`,
		GATE_EXIT_CODE: String(gateExitCode),
		GATE_OUTPUT: truncateChars(gateOutput.trim() || "(no output)", 8_000),
		TRIAGE_BLOCK: triageBrief
			? `\n# VALIDATOR'S TRIAGE (advisory diagnosis from the agent that designed the gate — follow it, but the gate output above remains the source of truth)\n${truncateChars(triageBrief.trim(), 8_000)}\n`
			: "",
		// A repaired gate makes the builder's round-1 copy STALE — hand it the script that
		// now actually judges its work, or it reasons against checks that no longer exist.
		GATE_UPDATE_BLOCK: repairedGate
			? `\n# GATE REPAIRED — the VALIDATOR fixed a defect in the acceptance gate. The copy from your first prompt is STALE; THIS is the gate that now judges your work (still immutable to you):\n\`\`\`python\n${truncateChars(repairedGate.trim(), 20_000)}\n\`\`\`\n`
			: "",
	});
}

// Escalation triage: after N failures the VALIDATOR stops being a silent gate and
// diagnoses WHY the builder is stuck — with read-only eyes on the actual state, plus a
// one-shot mandate to rewrite the gate at GATE_PATH if the gate itself is the defect.
const triageSystem = (gatePath: string): string => fill("SYSTEM_PROMPT_TRIAGE.md", { GATE_PATH: gatePath });

/** The triage request: what was asked, how many failures, the recent gate history. */
function triagePrompt(
	request: string,
	failures: number,
	maxRounds: number,
	builderReport: string,
	gateOutputs: Array<{ round: number; code: number; output: string }>,
	artifactsDir: string,
): string {
	const history = gateOutputs
		.slice(-2)
		.map((g) => `## Gate run — round ${g.round} (exit ${g.code})\n\`\`\`\n${truncateChars(g.output.trim() || "(no output)", 6_000)}\n\`\`\``)
		.join("\n\n");
	return fill("USER_PROMPT_TRIAGE.md", {
		FAILURES: String(failures),
		FAILURES_PLURAL: failures === 1 ? "" : "s",
		MAX_ROUNDS: String(maxRounds),
		REQUEST: request,
		HISTORY_SUFFIX: gateOutputs.length > 1 ? "S (note what changed — or didn't — between rounds)" : "",
		GATE_HISTORY: history,
		BUILDER_REPORT: truncateChars(builderReport, 12_000),
		// TRIAGE is read-only but sighted: the run dir holds every full builder report and
		// gate output, so it can read past the truncated excerpts above.
		ARTIFACTS_DIR: artifactsDir,
	});
}

// The VALIDATOR designs the gate BEFORE the builder does any work (red → green):
// its script is the definition of done, and its FAIL lines become the builder's
// correction instructions — so clarity and integrity are hard requirements.
// GATE_PATH is the harness-dictated absolute path the validator must WRITE its gate to —
// the transport is a file, never a code fence (see extractGateScript).
const validatorSystem = (gatePath: string): string => fill("SYSTEM_PROMPT_VALIDATOR.md", { GATE_PATH: gatePath });

/** The gate-design request: the user's prompt, the project cwd, and the dictated gate path. */
function validatorPrompt(prompt: string, cwd: string, gatePath: string, icmContext = ""): string {
	// The gate always lives at <artifacts>/gate.py, so the run dir is its dirname.
	return fill("USER_PROMPT_VALIDATOR.md", { PROMPT: prompt, CWD: cwd, GATE_PATH: gatePath, ARTIFACTS_DIR: path.dirname(gatePath), ICM_CONTEXT: contextSlot(icmContext) });
}

/** The /opinion prompt — answer directly and decisively, tools allowed, no hedging. */
function opinionPrompt(prompt: string): string {
	return fill("USER_PROMPT_OPINION.md", { PROMPT: prompt });
}

/** A gate is a PEP 723 uv script; inject the metadata block when the author omitted it. */
/**
 * LEGACY FALLBACK ONLY — the validator now writes gate.py to disk itself.
 *
 * Pulling the gate out of a fenced block is lossy by construction: the closing fence is
 * whatever ``` comes first, so any gate whose own source contains a literal triple-backtick
 * (e.g. asserting raw markdown fences are absent from rendered HTML) is silently truncated
 * mid-token. That produced a real 43.6KB gate cut to 33.3KB at `and "```" not in text`,
 * failing every round with a SyntaxError while the build under test was fine. Kept only for
 * validators that ignore the write instruction and paste the script anyway.
 */
function extractGateScript(text: string): string | undefined {
	const fence = text.match(/```(?:python|py|uv)?\s*\n([\s\S]*?)```/);
	const script = fence ? fence[1] : text.trim().startsWith("# /// script") ? text.trim() : undefined;
	if (!script?.trim()) return undefined;
	return ensureGateMetadata(script);
}

// ═══ 8. Extension ════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
	// ── 8.1 Flags ──────────────────────────────────────────────
	pi.registerFlag("architect", {
		type: "string",
		description: `ARCHITECT model (provider/id) — plans, fuses, validates. Default ${DEFAULT_ARCHITECT}.`,
	});
	pi.registerFlag("builder", {
		type: "string",
		description: `BUILDER model (provider/id) — builds. Default ${DEFAULT_BUILDER}.`,
	});
	pi.registerFlag("max-validations", {
		type: "string",
		description: "Max gate validations (build attempts) for /auto-validate before development halts. Default 5. Also overridable inline: /auto-validate --max-validations 3 <prompt>.",
	});
	pi.registerFlag("escalate-to-validator-count", {
		type: "string",
		description:
			"On the Nth gate failure, escalate: the VALIDATOR inspects the builder's work and writes a directed triage brief that accompanies the raw gate output. Default 3. Inline-overridable per command.",
	});
	pi.registerFlag("architect-system-prompt", {
		type: "string",
		description:
			"Override the system prompt for ARCHITECT-family worker/fusion agents (inline text, or a path to a file). VALIDATOR/TRIAGE keep their SYSTEM_PROMPT_*.md contracts — edit those files to tune them.",
	});
	pi.registerFlag("builder-system-prompt", {
		type: "string",
		description: "Override the system prompt for all BUILDER agents (inline text, or a path to a file).",
	});
	pi.registerFlag("architect-thinking", {
		type: "string",
		description: "Thinking level for EVERY architect-family execution (worker/fusion/validator/triage): off|minimal|low|medium|high|xhigh|max. Default medium.",
	});
	pi.registerFlag("builder-thinking", {
		type: "string",
		description: "Thinking level for EVERY builder execution: off|minimal|low|medium|high|xhigh|max. Default medium.",
	});
	pi.registerFlag("icm-context-dir", {
		type: "string",
		description: "ICM durable context dir for /icm-promote and /icm-context (a USER-LEVEL cache, never the repo). Default $FUSION_ICM_CONTEXT_DIR or ~/.fusion/context.",
	});
	pi.registerFlag("icm-retrieve", {
		type: "string",
		description: "ICM (Phase 4): read promoted, VALIDATED context back into the ARCHITECT/BUILDER/VALIDATOR prompts as a labelled evidence block — on|off. Default on; an empty context dir leaves every prompt unchanged.",
	});
	pi.registerFlag("icm-retrieve-max", {
		type: "string",
		description: "ICM (Phase 4): how many of the most recent validated entries to retrieve per run (1-20). Default 5.",
	});
	pi.registerFlag("child-timeout", {
		type: "string",
		description:
			"Timeout in SECONDS for every spawned child agent (/opinion + /fusion workers, the FUSION merge, /auto-validate builder rounds and validator). Default 28800 (8h), clamp 10-86400 (24h); the /auto-validate builder never drops below the 8h floor. Real work runs for hours — don't starve it.",
	});

	// ── 8.2 Flag readers ───────────────────────────────────────

	/** A string flag's trimmed value, or "" when unset. */
	const flagStr = (name: string): string => {
		const v = pi.getFlag(name);
		return typeof v === "string" ? v.trim() : "";
	};
	const architectModel = () => flagStr("architect") || DEFAULT_ARCHITECT; // resolved per call — flags are static, but cheap to re-read
	const builderModel = () => flagStr("builder") || DEFAULT_BUILDER;

	/** --<role>-system-prompt: inline text, or a file path (file contents win if it exists). */
	const roleSystemPrompt = (role: "architect" | "builder"): string | undefined => {
		const v = flagStr(`${role}-system-prompt`);
		if (!v) return undefined;
		try {
			if (fs.existsSync(v) && fs.statSync(v).isFile()) return fs.readFileSync(v, "utf-8");
		} catch {
			/* treat as inline text */
		}
		return v;
	};

	/**
	 * pi's own buildSystemPrompt(), for /system-prompt: when a role has no override, the
	 * prompt its children actually run with is pi's DEFAULT — which the package builds at
	 * spawn time and does not re-export from its main entry. Import it straight from the
	 * running pi installation's dist (a file URL bypasses the "exports" map); a bun-compiled
	 * binary has no real dist on disk, so this resolves undefined and the caller falls back.
	 */
	let buildSystemPromptLoad: Promise<((o: Record<string, unknown>) => string) | undefined> | undefined;
	const loadBuildSystemPrompt = (): Promise<((o: Record<string, unknown>) => string) | undefined> => {
		buildSystemPromptLoad ??= (async () => {
			try {
				const script = process.argv[1];
				if (!script || script.startsWith("/$bunfs/")) return undefined;
				const real = await fs.promises.realpath(script);
				const mod = await import(new URL(`file://${path.join(path.dirname(real), "core", "system-prompt.js")}`).href);
				return typeof mod.buildSystemPrompt === "function" ? mod.buildSystemPrompt : undefined;
			} catch {
				return undefined;
			}
		})();
		return buildSystemPromptLoad;
	};

	/** --child-timeout: seconds before ANY spawned child agent is killed. Default 28800 (8h), clamp 10-86400 (24h). */
	const childTimeoutMs = (): number => {
		const v = Number.parseInt(flagStr("child-timeout"), 10);
		const s = Number.isFinite(v) && v > 0 ? Math.max(10, Math.min(v, 86_400)) : CHILD_TIMEOUT_S_DEFAULT;
		return s * 1000;
	};
	/** The /auto-validate builder does real work — never below the 8h floor, even with a small --child-timeout. */
	const buildTimeoutMs = (): number => Math.max(childTimeoutMs(), BUILD_TIMEOUT_MS_FLOOR);

	/** --<role>-thinking: one thinking level for EVERY execution of that model. Default medium. */
	type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	const THINKING_LEVELS: Thinking[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	/**
	 * Accept BOTH the canonical level and the short form the footer prints (`high` and `hi`,
	 * `medium` and `med`, `off` and `none`, …). The footer only ever shows the short form, so
	 * refusing it would mean rejecting the exact word the UI just displayed.
	 */
	const THINKING_ALIAS: Record<string, Thinking> = {};
	for (const level of THINKING_LEVELS) {
		THINKING_ALIAS[level] = level;
		const short = THINKING_SHORT[level];
		if (short) THINKING_ALIAS[short] = level;
	}
	const resolveThinking = (raw: string): Thinking | undefined => THINKING_ALIAS[raw.trim().toLowerCase()];
	/** Human help: `off|none, minimal|min, low, medium|med, high|hi, xhigh|xhi, max`. */
	const THINKING_HELP = THINKING_LEVELS.map((l) => (THINKING_SHORT[l] && THINKING_SHORT[l] !== l ? `${l}|${THINKING_SHORT[l]}` : l)).join(", ");

	/** /thinking overrides the boot flag for the rest of the session (per role, in memory). */
	const thinkingOverride: Partial<Record<"architect" | "builder", Thinking>> = {};
	const roleThinking = (role: "architect" | "builder"): Thinking => {
		const override = thinkingOverride[role];
		if (override) return override;
		// The boot flags take the same aliases, so `--architect-thinking hi` works too.
		return resolveThinking(flagStr(`${role}-thinking`)) ?? "medium";
	};

	// ── 8.3 Shared live state (widget + footer read this) ──────
	// Left cell = ARCHITECT-family (ARCHITECT/FUSION/VALIDATOR), right cell = BUILDER.
	let liveRuns: AgentRun[] = []; // whatever the current command is running (empty when idle)
	const sideOf = (r: AgentRun): "left" | "right" => (r.role === "BUILDER" ? "right" : "left");
	// Last finished run per side — keeps the footer's context bar alive between commands.
	const sideLast: { left?: AgentRun; right?: AgentRun } = {};
	const absorbTotals = (runs: AgentRun[]) => {
		for (const r of runs) {
			// FUSION is a FRESH throwaway session by design and runs LAST in /fusion — letting
			// it become sideLast would pin the left cell to a session that no longer exists and
			// overwrite the persistent ARCHITECT brain's real context with the merge's ~2%.
			// ARCHITECT/VALIDATOR/TRIAGE all share the one persistent architect session, so
			// only they may speak for the left cell.
			if (r.role === "FUSION") continue;
			if (r.ctxTokens || r.status !== "pending") sideLast[sideOf(r)] = r;
		}
	};

	// ── 8.4 Persistent per-role sessions ───────────────────────
	// The SAME session id is reused for a role across EVERY execution in this project —
	// including across pi restarts — via a manifest at
	// /tmp/fusion-harness-sessions/<project>/manifest.json. ARCHITECT and BUILDER keep
	// their context until /fh-reset. (FUSION stays fresh — the merge must judge the two
	// answers without prior contamination.)
	const projectSlug = (cwd: string): string =>
		cwd
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(-60) || "root";
	const sessionsRootFor = (cwd: string): string => path.join(ARTIFACT_ROOT, "fusion-harness-sessions", projectSlug(cwd));
	// Keyed per role AND model: a transcript built under one model must never be replayed
	// as another model's own history. Observed live: a sonnet-5-built architect session
	// (full of "You are the ARCHITECT agent (anthropic/claude-sonnet-5)" turns) replayed
	// into claude-fable-5 tripped Anthropic's usage-policy classifier — every request
	// BLOCKED at the API, even "/opinion hello" — while the identical prompt on a fresh
	// fable session passed. Swapping --architect/--builder now simply mints a separate
	// brain for that model; switching back resumes the old one.
	const roleSessions: Record<string, { id: string; dir: string }> = {};
	const roleModel = (side: "architect" | "builder"): string => (side === "architect" ? architectModel() : builderModel());
	const roleKey = (side: "architect" | "builder"): string => `${side}:${modelTag(roleModel(side))}`;
	const roleSession = (side: "architect" | "builder", cwd: string): { id: string; dir: string } => {
		const key = roleKey(side);
		const cached = roleSessions[key];
		if (cached) return cached;
		const root = sessionsRootFor(cwd);
		fs.mkdirSync(root, { recursive: true });
		const manifestPath = path.join(root, "manifest.json");
		let manifest: Record<string, string> = {};
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		} catch {
			/* first run for this project */
		}
		// Pre-model-keying manifests held bare "architect"/"builder" ids — ignored on
		// purpose: those sessions carry another model's identity, the exact poison this
		// keying exists to prevent. They start fresh once and never come back.
		if (!manifest[key]) {
			manifest[key] = randomUUID();
			try {
				fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
			} catch {
				/* non-fatal — ids just won't survive a restart */
			}
		}
		const dir = path.join(root, side);
		fs.mkdirSync(dir, { recursive: true });
		roleSessions[key] = { id: manifest[key], dir };
		return roleSessions[key];
	};
	/** Session id for summaries — cache-only, never mints a session. */
	const cachedRoleId = (side: "architect" | "builder"): string | undefined => roleSessions[roleKey(side)]?.id;

	/** Wipe this project's persistent role sessions (disk + in-memory, all models) — shared by /fh-reset and /new. */
	const resetRoleSessions = async (cwd: string): Promise<string> => {
		const root = sessionsRootFor(cwd);
		await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
		for (const key of Object.keys(roleSessions)) delete roleSessions[key];
		sideLast.left = undefined;
		sideLast.right = undefined;
		return root;
	};

	// ── /new resets the role brains too ─────────────────────────
	// Pi's built-in /new gives the HOST a fresh session, but the ARCHITECT (and the
	// headless-fallback BUILDER) children resume their persistent per-project sessions —
	// without this hook they'd drag the old context straight into the "new" conversation.
	// So a /new also does the /fh-reset work. `reason` distinguishes the user's /new from
	// startup/reload/resume/fork, where persisting across restarts is the whole design.
	pi.on("session_start", async (ev: any, ctx: any) => {
		if (ev?.reason !== "new") return;
		// Silent by design (user preference): a fresh session resetting the role brains is
		// the expected behavior, not news. /fh-reset keeps its notify — it's an explicit ask.
		await resetRoleSessions(ctx.cwd);
	});

	/**
	 * The BUILDER is the HOST's agent: launch recipes set the host --model to the builder
	 * model, so raw (non-slash) input IS the builder, natively. Builder children therefore
	 * FORK the host session — inheriting every raw chat turn and every panel — instead of
	 * keeping a separate brain.
	 *
	 * The builder must ALWAYS land in a brain that persists across commands. Pi only
	 * flushes the host session file on the host's first ASSISTANT message (session-manager
	 * `_persist`) — appended panels don't trigger it — so a session driven purely by slash
	 * commands has a session PATH but no file to fork. In that window the only way to give
	 * the builder a memory is the manifest-pinned persistent session; handing it a fresh
	 * throwaway instead makes it amnesiac on every command (a visible ~1k cold-start prompt
	 * each time, while the ARCHITECT accumulates in its own persistent session).
	 */
	const builderSpawn = (ctx: any, artifactsDir: string): { fork?: string; sessionDir: string; sessionId?: string } => {
		let hostFile: string | undefined;
		try {
			hostFile = ctx.sessionManager.getSessionFile?.();
		} catch {
			/* treat as sessionless */
		}
		// Host session on disk → fork it: that IS the shared brain (raw chat + every panel).
		if (hostFile) {
			let flushed = false;
			try {
				flushed = fs.existsSync(hostFile) && fs.statSync(hostFile).size > 0;
			} catch {
				/* not flushed yet */
			}
			if (flushed) return { fork: hostFile, sessionDir: path.join(artifactsDir, "builder") };
		}
		// No host file yet (slash-commands-only session) or no host session at all
		// (--no-session / headless): fall back to the persistent builder session so the
		// builder still remembers across commands. Once the host does flush, builder
		// children move to forking it — a promotion to the intended shared brain, whose
		// transcript already carries the panels from these earlier commands; only the
		// child's own verbose turns (throwaway by design) are left behind.
		const s = roleSession("builder", ctx.cwd);
		return { sessionDir: s.dir, sessionId: s.id };
	};

	/** `◆ ARCHITECT · model` — the role-colored label that opens every column and cell. */
	const roleLabelStr = (theme: any, role: Role, model: string, bold = true, sep = " · ") => {
		const label = `${ROLE_GLYPH[role]} ${role}`;
		return (
			theme.fg(ROLE_COLOR[role], bold ? theme.bold(label) : label) + theme.fg("dim", sep) + theme.fg(ROLE_COLOR[role], shortModel(model))
		);
	};

	/**
	 * One footer cell: `◆ ARCHITECT | model (med) | [██--------] 12%`.
	 * EVERY content segment carries the role's own color — glyph, role, model, thinking
	 * level and context bar alike — so a cell reads as one ARCHITECT-blue / BUILDER-orange
	 * line and the role stays identifiable from any part of it. Only the `|` separators are
	 * theme-colored (`dim`), which some themes render as a bright hue rather than a muted
	 * one — so keep separators the ONLY non-role segment, or the cell loses its identity.
	 */
	const cellStr = (theme: any, role: Role, model: string, thinking: string | undefined, barStr: string): string => {
		const sep = theme.fg("dim", " | ");
		return (
			roleLabelStr(theme, role, model, false, " | ") + theme.fg(ROLE_COLOR[role], thinkingTag(thinking)) + sep + theme.fg(ROLE_COLOR[role], barStr)
		);
	};

	/** One agent's live column: label, state line, then its flow tail (tools + streaming text). */
	const liveColumn = (theme: any, r: AgentRun | undefined, colW: number): string[] => {
		if (!r) return [];
		const now = Date.now();
		const elapsed = r.startedAt ? (r.endedAt ?? now) - r.startedAt : 0;
		const state =
			r.status === "pending" ? "waiting" : r.status === "working" ? `working ${Math.floor(elapsed / 1000)}s` : `${r.status} ${fmtSecs(elapsed)}`;
		const stateColor = r.status === "done" ? "success" : r.status === "working" ? ROLE_COLOR[r.role] : r.status === "pending" ? "dim" : "error";
		const bits = [`${STATUS_GLYPH[r.status]} ${state}`];
		if (r.tokensIn || r.tokensOut) bits.push(`in ${fmtK(r.tokensIn)} out ${fmtK(r.tokensOut)}`);
		if (r.costUsd) bits.push(`$${r.costUsd.toFixed(4)}`);
		const lines: string[] = [roleLabelStr(theme, r.role, r.model), theme.fg(stateColor, bits.join(" · "))];

		// DONE agents collapse to their summary line — the full output lives in the
		// transcript panel; re-streaming it here would duplicate what's already shown.
		if (r.status === "done") return lines;
		if (r.status === "failed" || r.status === "timeout") {
			lines.push(theme.fg("error", `✗ ${runError(r)}`));
			return lines;
		}

		// WORKING agents stream only the CURRENT spawn's flow (from flowMark) — never
		// stale text from earlier rounds — plus the in-flight message text.
		// Three visually distinct flows, same right-facing-triangle family:
		//   ▸ solid + toolTitle    → tool calls (what it DID)
		//   ▹ hollow + thinkingText italic → reasoning (what it's THINKING) — pi's own thinking
		//     color/italic, so it tracks the theme instead of a hardcoded purple
		//   plain muted/text       → its answer
		const thinkLines = (text: string): string[] =>
			wrapCol(text, colW).map((l, i) => theme.italic(theme.fg("thinkingText", i === 0 ? `▹ ${l}` : `  ${l}`)));
		const flowLines: string[] = [];
		for (const item of r.flow.slice(r.flowMark).slice(-6)) {
			if (item.type === "tool") flowLines.push(theme.fg("toolTitle", `▸ ${item.label}`));
			else if (item.type === "thinking") flowLines.push(...thinkLines(item.text));
			else for (const l of wrapCol(item.text, colW)) flowLines.push(theme.fg("muted", l));
		}
		// Reasoning stays on screen for the WHOLE turn, above the answer it produced — the same
		// order the model emits them. (Hiding it as soon as text starts made it near-invisible:
		// a turn can stream its whole reasoning between two 1s widget ticks.)
		if (r.streamThinking) flowLines.push(...thinkLines(r.streamThinking));
		if (r.streamText) for (const l of wrapCol(r.streamText, colW)) flowLines.push(theme.fg("text", l));
		lines.push(...flowLines.slice(-WIDGET_FLOW_LINES));
		return lines;
	};

	// ── 8.5 The FOOTER: one aligned cell per model, replacing pi's default entirely ──
	// Per model: `◆ ROLE | model (med) | [██--------] 12%` — thinking level + context bar.
	// No run state (the live widget already shows who's working), no middle divider.
	pi.on("session_start", async (_ev: any, ctx: any) => {
		if (ctx.mode !== "tui") return;
		const contextWindow = (model: string): number => {
			try {
				const slash = model.indexOf("/");
				const found = ctx.modelRegistry.find(model.slice(0, slash), model.slice(slash + 1));
				if (found?.contextWindow) return found.contextWindow;
			} catch {
				/* fall through */
			}
			return 1_000_000;
		};
		const bar = (used: number, window: number): string => {
			const pct = Math.max(0, Math.min(1, window > 0 ? used / window : 0));
			const filled = Math.round(pct * 10);
			return `[${"█".repeat(filled)}${"-".repeat(10 - filled)}] ${Math.round(pct * 100)}%`;
		};
		try {
			ctx.ui.setFooter((_tui: any, theme: any) => ({
				invalidate() {},
				render(width: number): string[] {
					const cell = (side: "left" | "right"): string => {
						const live = liveRuns.filter((r) => sideOf(r) === side);
						const active = live.find((r) => r.status === "working") ?? live[live.length - 1] ?? sideLast[side];
						const role: Role = side === "left" ? (active?.role ?? "ARCHITECT") : "BUILDER";
						// The BUILDER cell is the HOST when no child is running — raw input IS the
						// builder (recipes launch the host on the builder model), so show the host's
						// live model + context usage rather than a stale child snapshot.
						if (side === "right" && !live.length) {
							const hostModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : builderModel();
							const usage = ctx.getContextUsage?.();
							// The host only HAS usage once it has answered a turn itself. A session
							// driven purely by slash commands never does, leaving the cell at 0% while
							// builder children forked that session and did real work — so fall back to
							// the last builder child's context, which is the host's plus its own turns.
							// MAX, not "host first": both readings are partial views of one brain. The host
							// only reports usage for turns IT answered, so a slash-command-only session
							// reports ~0 even after a child forked it and burned 68k — and the child's own
							// reading is discarded with its fork, so it can't be the sole source either.
							// Taking the larger keeps the bar from collapsing to 0% right after real work.
							const used = Math.max(usage?.tokens ?? 0, sideLast.right?.ctxTokens ?? 0);
							const window = usage?.contextWindow ?? contextWindow(hostModel);
							// --builder-thinking, i.e. the level every builder CHILD runs at. The host's
							// own live level would be truer for this cell, but ExtensionContext exposes
							// no getThinkingLevel (it's command-context only) and emits no
							// thinking_level_changed event, so it isn't reachable from a footer.
							return cellStr(theme, "BUILDER", hostModel, roleThinking("builder"), bar(used, window));
						}
						const model = active?.model ?? (side === "left" ? architectModel() : builderModel());
						const thinking = active?.thinking ?? roleThinking(side === "left" ? "architect" : "builder");
						// ctxTokens only exists once a child reports its FIRST message_end. An agent that
						// is still on its opening turn (a big persistent session at xhigh can think for
						// minutes before emitting anything) would otherwise read 0% — looking dead, not
						// busy. Hold the side's last known reading until the new one lands.
						const ctxTokens = active?.ctxTokens || sideLast[side]?.ctxTokens || 0;
						return cellStr(theme, role, model, thinking, bar(ctxTokens, contextWindow(model)));
					};
					const twoCol = new TwoCol(() => ({ left: [cell("left")], right: [cell("right")] }), "   ");
					return twoCol.render(width);
				},
			}));
		} catch {
			/* footer is progressive enhancement — never break the session over it */
		}
	});

	// ── 8.6 The transcript renderer — final results, two-column ──
	// Results render FULL-HEIGHT (like normal pi assistant messages) so they land in the
	// terminal scrollback and scroll naturally — no hidden lines behind an expand toggle.
	pi.registerMessageRenderer<FhDetails>(CUSTOM_TYPE, (message, _opts, theme) => {
		const d = (message.details ?? {}) as FhDetails;
		const content =
			typeof message.content === "string" ? message.content : message.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");

		// The echoed prompt: styled exactly like a normal pi user message.
		if (d.kind === "prompt") {
			const box = new Box(1, 1, (t: string) => theme.bg("userMessageBg", t));
			box.addChild(new Text(theme.fg("userMessageText", content), 1, 0));
			return box;
		}

		const inner = new Container();
		const add = (c: any) => inner.addChild(c);
		const blank = () => add(new Text("", 0, 0));

		/** One finished agent as a column: label + stats + full markdown body. */
		const finalColumn = (s: AgentStat | undefined, body: string, colW: number): string[] => {
			if (!s) return [];
			const lines: string[] = [
				roleLabelStr(theme, s.role, s.model),
				theme.fg(s.error ? "error" : "dim", `${STATUS_GLYPH[s.status]} ${statLine(s)}`),
				"",
			];
			if (s.error) lines.push(theme.fg("error", theme.bold(`✗ FAILED — ${s.error}`)));
			lines.push(...mdLines(body, colW));
			return lines;
		};

		const duoBody = () => {
			const [ls, rs] = [d.sources?.[0], d.sources?.[1]];
			const [la, ra] = [d.answers?.[0], d.answers?.[1]];
			add(
				new TwoCol(
					(colW) => ({ left: finalColumn(ls, la?.text ?? "", colW), right: finalColumn(rs, ra?.text ?? "", colW) }),
					theme.fg("dim", " │ "),
				),
			);
		};

		const md = (body: string) => {
			add(new Markdown(body || "(no output)", 1, 0, getMarkdownTheme()));
		};

		switch (d.kind) {
			case "boot": {
				// The boot banner: raw text, sized up the only way a terminal sizes text up —
				// fullwidth glyphs (2 cells per letter), bold, centered, floating bare (no
				// background box, no rules). Falls back to ASCII if even that can't fit.
				add(
					new FullWidth((w) => {
						const center = (l: string) => " ".repeat(Math.max(0, Math.floor((w - visibleWidth(l)) / 2))) + l;
						const big = "FUSION HARNESS".replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, "　");
						const title = visibleWidth(big) <= w ? big : "FUSION HARNESS";
						// The fusion mark: ARCHITECT circle + BUILDER circle, in their role colors.
						const mark =
							theme.fg(ROLE_COLOR.ARCHITECT, "●") + theme.fg("customMessageLabel", "  +  ") + theme.fg(ROLE_COLOR.BUILDER, "●");
						// One blank line between every element — equal vertical rhythm.
						return [
							"",
							theme.fg("customMessageLabel", theme.bold(center(title))),
							"",
							theme.fg("customMessageLabel", center("Combine Your Compute")),
							"",
							center(mark),
							"",
						];
					}),
				);
				break;
			}
			case "banner": {
				add(new Text(theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /${d.command}`)), 1, 0));
				for (const r of d.roles ?? []) add(new Text(`  ${roleLabelStr(theme, r.role, r.model)}`, 1, 0));
				if (d.prompt) add(new Text(theme.fg("muted", `  prompt: ${d.prompt.replace(/\s+/g, " ").slice(0, 100)}`), 1, 0));
				if (d.fusionPrompt) add(new Text(theme.fg("muted", `  fusion: ${d.fusionPrompt.replace(/\s+/g, " ").slice(0, 100)}`), 1, 0));
				if (d.maxRounds)
					add(
						new Text(
							theme.fg("muted", `  max validations: ${d.maxRounds}${d.escalateAt ? ` · validator triage from failure ${d.escalateAt}` : ""}`),
							1,
							0,
						),
					);
				break;
			}
			case "duo":
			case "opinion": {
				const title = d.kind === "opinion" ? "◆ OPINION — side by side" : `FUSION HARNESS · /${d.command} — both agents`;
				add(new Text(theme.fg("customMessageLabel", theme.bold(title)), 1, 0));
				blank();
				duoBody();
				break;
			}
			case "icm": {
				add(new Text(theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /${d.command} — `)) + (d.ok ? theme.fg("success", theme.bold("ICM ✓")) : theme.fg("error", theme.bold("ICM ✗"))), 1, 0));
				blank();
				md(content);
				break;
			}
			case "system-prompt": {
				// Same two-column discipline as every other panel: ARCHITECT-family left, BUILDER
				// right. No stats row — nothing ran; these are the prompts the NEXT spawns get.
				add(new Text(theme.fg("customMessageLabel", theme.bold("FUSION HARNESS · /system-prompt — what each role runs with")), 1, 0));
				blank();
				const spCol = (a: { role: Role; model: string; text: string } | undefined, colW: number): string[] =>
					a ? [roleLabelStr(theme, a.role, a.model), "", ...mdLines(a.text, colW)] : [];
				add(new TwoCol((colW) => ({ left: spCol(d.answers?.[0], colW), right: spCol(d.answers?.[1], colW) }), theme.fg("dim", " │ ")));
				break;
			}
			case "fused": {
				const src = d.sources ?? [];
				const srcLabel = src.map((s) => theme.fg(ROLE_COLOR[s.role], `${s.role}(${shortModel(s.model)})`)).join(theme.fg("dim", " ⊕ "));
				add(
					new Text(
						theme.fg("success", theme.bold(`⧉ FUSED`)) +
							theme.fg("dim", " ← ") +
							srcLabel +
							(d.agent ? theme.fg("dim", `   ${STATUS_GLYPH[d.agent.status]} ${statLine(d.agent)}`) : ""),
						1,
						0,
					),
				);
				if (d.agent) add(new Text(theme.fg("dim", `  fused by ${d.agent.role} model ${d.agent.model} (fresh session)`), 1, 0));
				blank();
				md(content);
				break;
			}
			case "gate": {
				add(
					new Text(
						theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /auto-validate — `)) +
							theme.fg("mdLink", theme.bold(d.round ? `GATE REPAIRED ⚒ (after round ${d.round})` : "GATE DESIGNED ⛨")) +
							(d.agent ? theme.fg("dim", `   ${roleLabelStr(theme, d.agent.role, d.agent.model, false)}${theme.fg("dim", ` · ${statLine(d.agent)}`)}`) : ""),
						1,
						0,
					),
				);
				if (d.scriptPath) add(new Text(theme.fg("dim", `  gate: ${d.scriptPath} · runs after every build round · max ${d.maxRounds ?? "?"} validations`), 1, 0));
				blank();
				md(content);
				break;
			}
			case "triage": {
				add(
					new Text(
						theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /auto-validate — `)) +
							theme.fg("warning", theme.bold(`⚡ VALIDATOR TRIAGE`)) +
							theme.fg("dim", ` · escalated after ${d.round ?? "?"} failed validation${(d.round ?? 0) === 1 ? "" : "s"} (threshold ${d.escalateAt ?? "?"})`) +
							(d.agent ? theme.fg("dim", `   ${statLine(d.agent)}`) : ""),
						1,
						0,
					),
				);
				if (d.agent) add(new Text(`  ${roleLabelStr(theme, d.agent.role, d.agent.model)}` + theme.fg("dim", " · read-only diagnosis — brief travels with the next correction"), 1, 0));
				blank();
				md(content);
				break;
			}
			case "validation": {
				const verdict = d.ok
					? theme.fg("success", theme.bold("GATE PASS ✓"))
					: theme.fg("error", theme.bold(`GATE FAIL ✗ (exit ${d.gateExitCode ?? "?"})`));
				const roundTag = d.round ? theme.fg("dim", ` · validation ${d.round}/${d.maxRounds ?? "?"}`) : "";
				add(
					new Text(theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /auto-validate — `)) + verdict + roundTag, 1, 0),
				);
				if (d.scriptPath) add(new Text(theme.fg("dim", `  gate: ${d.scriptPath}`), 1, 0));
				blank();
				duoBody();
				break;
			}
			default: {
				// "error" and anything else: attributed failure, loud and specific.
				add(new Text(theme.fg("error", theme.bold(`✗ FUSION HARNESS · /${d.command ?? "?"} FAILED`)), 1, 0));
				if (d.agent?.error) add(new Text(theme.fg("error", `  ${d.agent.role} · ${d.agent.model} — ${d.agent.error}`), 1, 0));
				for (const s of d.sources ?? []) {
					if (s.error) add(new Text(theme.fg("error", `  ${s.role} · ${s.model} — ${s.error}`), 1, 0));
				}
				if (content.trim()) {
					blank();
					md(content);
				}
				break;
			}
		}

		if (d.kind !== "banner" && (d.totalMs || d.artifactsDir)) {
			blank();
			const bits = [
				d.totalMs ? `run ${fmtSecs(d.totalMs)}` : "",
				d.totalCostUsd ? `~$${d.totalCostUsd.toFixed(4)}` : "",
				d.artifactsDir ? `artifacts: ${d.artifactsDir}` : "",
			].filter(Boolean);
			add(new Text(theme.fg("dim", `  ${bits.join(" · ")}`), 1, 0));
		}
		if (d.kind !== "banner" && d.icm?.length) {
			// ICM roster: one cell per envelope (✓ valid / ✗ rejected), the lifecycle status, the manifest.
			const cells = d.icm.map((e) => `${e.ok ? theme.fg("success", "✓") : theme.fg("error", "✗")} ${e.file.replace(/\.json$/, "").replace(/\.rejected$/, " (REJECTED)")}`);
			const statuses = [...new Set(d.icm.map((e) => e.status))].join("/");
			add(new Text(theme.fg("dim", `  icm: ${cells.join(theme.fg("dim", " · "))}  — ${statuses} · icm-manifest.json`), 1, 0));
			if (d.icmConsumed?.length) add(new Text(theme.fg("dim", `  icm handoff consumed: ${d.icmConsumed.join(", ")} (schema + run scope + artifact hashes verified)`), 1, 0));
			if (d.icmPromotable && d.artifactsDir) add(new Text(theme.fg("dim", "  icm promotable (manual, gate-backed): ") + theme.fg("mdLink", `/icm-promote ${d.artifactsDir}`), 1, 0));
			if (d.icmRetrieved) add(new Text(theme.fg("dim", `  ${d.icmRetrieved}`), 1, 0));
		}

		// The boot banner floats bare on the terminal background — every other panel gets
		// the custom-message background block.
		if (d.kind === "boot") return inner;
		const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
		box.addChild(inner);
		return box;
	});

	// ── 8.7 Shared command machinery ───────────────────────────

	const panel = (details: FhDetails, content: string) => {
		// ICM (Phase 2): a panel that belongs to a run carries that run's envelope roster, read
		// from the in-memory manifest — so a rejected envelope is shown, never hidden.
		if (details.artifactsDir && !details.icm) {
			const entries = icmRuns.get(details.artifactsDir)?.manifest.envelopes;
			if (entries?.length) details.icm = entries.map((e) => ({ file: e.file, kind: e.kind, status: e.status, role: e.producer_role, ok: e.ok }));
		}
		// ICM (Phase 4): the first result panel of a run says what durable context its prompts carried.
		if (details.artifactsDir && !details.icmRetrieved && (details.kind === "duo" || details.kind === "gate")) details.icmRetrieved = icmRetrievals.get(details.artifactsDir);
		pi.sendMessage<FhDetails>({
			customType: CUSTOM_TYPE,
			content: truncateBytes(content, ANSWER_MAX_BYTES),
			display: true,
			details,
		});
	};

	/**
	 * The panel for an escape-stopped run. Renders as an `error` panel (no renderer change)
	 * but says plainly that the user stopped it — an aborted child is !runOk, so without
	 * this a stop would surface as "the agents failed", blaming the models for the user.
	 */
	const stoppedPanel = async (command: string, runs: AgentRun[], artifactsDir: string, startedAt: number, what: string) => {
		panel(
			{
				kind: "error",
				command,
				ok: false,
				sources: runs.map(toStat),
				artifactsDir,
				totalMs: Date.now() - startedAt,
				totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
			},
			`⊘ STOPPED — escape pressed. ${what}\nEverything produced up to this point is in ${artifactsDir}.`,
		);
		await icmRuns.get(artifactsDir)?.emit("output", {
			kind: "output",
			producer: { role: "harness", model: HARNESS_MODEL },
			summary: `STOPPED — escape pressed. ${what}`,
			risks: ["stopped by the user before the workflow completed"],
		});
	};

	/**
	 * Live two-column widget while children run: left agent | right agent, each
	 * streaming its own flow (tool lines + response text), plus an optional
	 * full-width span row (the FUSION merge stage). Re-set every tick.
	 */
	const startWidget = (
		ctx: any,
		command: string,
		cols: [AgentRun, AgentRun],
		span: AgentRun | undefined,
		startedAt: number,
	) => {
		liveRuns = span ? [...cols, span] : [...cols];
		const render = () => {
			try {
				ctx.ui.setWidget(
					CUSTOM_TYPE,
					(_tui: any, theme: any) => {
						const c = new Container();
						const all = span ? [...cols, span] : [...cols];
						const cost = all.reduce((s, r) => s + r.costUsd, 0);
						c.addChild(
							new Text(
								theme.fg("customMessageLabel", theme.bold(`FUSION HARNESS · /${command}`)) +
									theme.fg("dim", ` · ${fmtSecs(Date.now() - startedAt)} · ~$${cost.toFixed(4)}`),
								1,
								0,
							),
						);
						c.addChild(new TwoCol((colW) => ({ left: liveColumn(theme, cols[0], colW), right: liveColumn(theme, cols[1], colW) }), theme.fg("dim", " │ ")));
						if (span && span.status !== "pending") {
							c.addChild(new Text("", 0, 0));
							// Real width, not a guess — the FUSION row spans the whole terminal.
							c.addChild(new FullWidth((w) => liveColumn(theme, span, w)));
						}
						return c;
					},
					{ placement: "aboveEditor" },
				);
			} catch {
				/* widget is best-effort; no-op outside the TUI */
			}
		};
		render();
		const ticker = setInterval(render, WIDGET_TICK_MS);
		return () => {
			clearInterval(ticker);
			const all = span ? [...cols, span] : [...cols];
			absorbTotals(all);
			liveRuns = [];
			try {
				ctx.ui.setWidget(CUSTOM_TYPE, undefined);
			} catch {
				/* ignore */
			}
		};
	};

	/**
	 * ESCAPE = stop. Pi's own escape only aborts ITS agent loop; a slash command's children
	 * are our subprocesses, so nothing cancels them unless we listen ourselves. While
	 * children run we tap raw terminal input and abort the run's controller on Escape.
	 *
	 * A bare "\x1b" IS the Escape key; "\x1b[A"/"\x1bO…" are arrow/function-key SEQUENCES
	 * that merely start with the same byte — matching a prefix would swallow those keys.
	 * Only Escape is consumed; every other key (incl. ctrl-c, which pi handles) passes through.
	 * Returns an unsubscribe — always call it, or the tap outlives the command.
	 */
	const onEscape = (ctx: any, stop: () => void): (() => void) => {
		try {
			return (
				ctx.ui.onTerminalInput?.((data: string) => {
					if (data === "\x1b") {
						stop();
						return { consume: true };
					}
					return undefined;
				}) ?? (() => {})
			);
		} catch {
			return () => {}; // headless / no TUI — nothing to tap
		}
	};

	/** One abort controller per command run + the Escape tap that trips it. */
	const startStoppable = (ctx: any, command: string): { signal: AbortSignal; stopped: () => boolean; release: () => void } => {
		const ctl = new AbortController();
		const release = onEscape(ctx, () => {
			if (ctl.signal.aborted) return;
			ctl.abort();
			try {
				ctx.ui.setStatus(CUSTOM_TYPE, `${command}: stopping…`);
				ctx.ui.notify(`fusion-harness: stopping /${command} — escape pressed`, "warning");
			} catch {
				/* best effort */
			}
		});
		return { signal: ctl.signal, stopped: () => ctl.signal.aborted, release };
	};

	// Per-run artifacts land under /tmp/fusion-harness-* (the spec'd, inspectable location —
	// note os.tmpdir() on macOS is /var/folders/…, so we pin /tmp explicitly).
	const ARTIFACT_ROOT = fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
	const mkArtifacts = async (): Promise<string> => fs.promises.mkdtemp(path.join(ARTIFACT_ROOT, "fusion-harness-"));
	const save = (dir: string, name: string, body: string) =>
		fs.promises.writeFile(path.join(dir, name), body, "utf-8").catch(() => {});
	const totals = (runs: AgentRun[], startedAt: number) => ({
		totalMs: Date.now() - startedAt,
		totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
	});

	// ── 8.7b ICM envelopes (Phase 1 — emit) ─────────────────────
	// Every run writes schema-valid ContextEnvelope v1 JSON next to its raw artifacts:
	//   brief → spec → build → validation → output   (+ icm-manifest.json)
	// They excerpt and HASH the raw reports; they never replace them. Nothing here touches
	// tool grants, session isolation, or the gate verdict. A malformed envelope lands as
	// <name>.rejected.json with its errors — the command carries on.
	// Everything is `draft`: promotion/retrieval is later-phase scope (FUSION_ICM_PLAN.md).
	const HARNESS_MODEL = "harness/fusion-harness"; // producer.model for orchestrator-derived envelopes
	const PROMPT_MAX = 4_000; // chars of the user's prompt carried verbatim in the brief
	const ROLE_TO_PRODUCER: Record<Role, "architect" | "builder" | "fusion" | "validator"> = {
		ARCHITECT: "architect",
		BUILDER: "builder",
		FUSION: "fusion",
		VALIDATOR: "validator",
	};
	const icmRuns = new Map<string, IcmRun>(); // artifactsDir → its ICM run (shared helpers look theirs up here)
	const icmStart = (command: "opinion" | "fusion" | "auto-validate", artifactsDir: string, cwd: string): IcmRun | undefined => {
		try {
			const run = createIcmRun({ runDir: artifactsDir, cwd, command });
			icmRuns.set(artifactsDir, run);
			return run;
		} catch {
			return undefined; // observe-only: ICM being unavailable must never block a command
		}
	};
	/** The brief: what was asked, with which roles/models — written before any agent runs. */
	const icmBrief = (icm: IcmRun | undefined, prompt: string, roles: Array<{ role: Role; model: string; thinking: string }>, extra: Partial<EnvelopeInput> = {}) =>
		icm?.emit("brief", {
			kind: "brief",
			producer: { role: "user", model: "human" },
			summary: excerpt(prompt),
			requirements: [truncateChars(prompt, PROMPT_MAX)],
			decisions: [`command: /${icm.manifest.command}`, ...roles.map((r) => `${r.role.toLowerCase()}: ${r.model} (${r.thinking})`), ...(extra.decisions ?? [])],
			acceptance_criteria: extra.acceptance_criteria ?? [],
			risks: extra.risks ?? [],
			artifacts: [{ path: "prompt.md", type: "prompt" }],
		});
	/** One role's raw answer as a draft envelope: an excerpt plus the hashed report. A failed run is a risk, not a claim. */
	const icmRole = (
		icm: IcmRun | undefined,
		name: string,
		kind: "spec" | "build" | "output",
		r: AgentRun,
		report: string,
		type: ArtifactType = "raw-report",
		extra: Partial<EnvelopeInput> = {},
	) =>
		icm?.emit(name, {
			kind,
			producer: { role: ROLE_TO_PRODUCER[r.role], model: r.model },
			summary: runOk(r) ? excerpt(r.text) : `FAILED: ${runError(r)}`,
			decisions: extra.decisions ?? [],
			risks: runOk(r) ? (extra.risks ?? []) : [`${r.role} (${r.model}) failed: ${runError(r)}`, ...(extra.risks ?? [])],
			acceptance_criteria: extra.acceptance_criteria ?? [],
			claims: runOk(r)
				? [
						{ statement: `${r.role} produced a response for this request.`, status: "proposed", source_role: ROLE_TO_PRODUCER[r.role], evidence: [`artifact:${report}`], validated_by: null },
						...(extra.claims ?? []),
					]
				: [],
			artifacts: [{ path: report, type }, ...(extra.artifacts ?? [])],
			open_questions: extra.open_questions ?? [],
			supersedes: extra.supersedes ?? null,
		});
	/** The run's closing envelope — orchestrator-derived unless a producer is given. */
	const icmOutput = (icm: IcmRun | undefined, summary: string, extra: Partial<EnvelopeInput> = {}) =>
		icm?.emit("output", { ...extra, kind: "output", producer: extra.producer ?? { role: "harness", model: HARNESS_MODEL }, summary });

	// ── 8.7c ICM handoffs (Phase 2 — consume, VERIFIED, still draft) ──
	// Two boundaries now READ envelopes: FUSION gets the spec+build envelopes before the raw
	// answers, and a BUILDER correction round gets the gate's PASS/FAIL lines as claims from
	// the round's validation envelope. Every read goes through readEnvelope — schema
	// re-validated, run scope matched, artifact hashes re-checked. A read that fails is dropped
	// and recorded as a risk on the consumer's envelope; the prompt then has exactly its Phase 1
	// shape. Envelopes stay evidence (the blocks say so); promotion remains Phase 3.
	type Consumed = { envelope: ContextEnvelope; file: string } | { errors: string[]; file: string };
	const icmConsume = async (icm: IcmRun | undefined, file: string | undefined): Promise<Consumed | undefined> => {
		if (!icm || !file) return undefined;
		const r = await readEnvelope(file, { runDir: icm.runDir, expect: { run_id: icm.scope.run_id, repository: icm.scope.repository, commit: icm.scope.commit } });
		return r.ok && r.envelope ? { envelope: r.envelope, file } : { errors: r.errors, file };
	};
	/** Parse a gate run into claims (+ a truncation note) for a validation envelope. */
	const gateClaims = (output: string, code: number, gateOutputArtifact: string, buildId: string | undefined) => {
		const diag = parseGateDiagnostics(output, code);
		const { claims, dropped } = diagnosticsToClaims(diag, gateOutputArtifact, buildId);
		return {
			claims,
			decision: `${diag.fail.length} FAIL / ${diag.pass.length} PASS line(s) parsed into claims${diag.otherLines ? ` (+${diag.otherLines} other line(s) left in the raw output)` : ""}`,
			open_questions: dropped ? [`diagnostics truncated: ${dropped} PASS/FAIL line(s) beyond the first ${DIAG_CLAIMS_MAX} are only in the raw gate output`] : [],
		};
	};

	// ── 8.7d ICM retrieval (Phase 4 — VALIDATED durable context, re-verified, labelled, projected) ──
	// Before any role runs, the command reads the context index (icm/retrieve.ts): only
	// `validated` entries for this repository and branch, newest first, capped; each re-validated
	// and re-hashed on disk; each labelled with how its commit relates to this checkout. The
	// result is rendered per role as an evidence block (never an instruction channel) into the
	// ARCHITECT/BUILDER worker prompts (/fusion), and the VALIDATOR and round-1 BUILDER prompts
	// (/auto-validate). The brief envelope records exactly what was retrieved, what was withheld
	// and why; the panel footer shows the same line. Off switch: --icm-retrieve off. An empty or
	// missing context dir leaves every prompt byte-identical to its Phase 3 shape.
	const icmContextDir = (): string => flagStr("icm-context-dir") || defaultContextDir();
	const icmRetrievals = new Map<string, string>(); // artifactsDir → one-line account (panel footer + brief)
	const icmRetrieve = async (icm: IcmRun | undefined, cwd: string): Promise<RetrievalResult | undefined> => {
		if (!icm) return undefined;
		if (flagStr("icm-retrieve").toLowerCase() === "off") {
			icmRetrievals.set(icm.runDir, "icm retrieval: off (--icm-retrieve off)");
			return undefined;
		}
		try {
			const max = Number(flagStr("icm-retrieve-max"));
			const r = await retrieveContext({ contextDir: icmContextDir(), scope: icm.scope, limit: clampLimit(max || undefined), isAncestor: (c) => gitIsAncestor(cwd, c) });
			icmRetrievals.set(icm.runDir, describeRetrieval(r));
			return r;
		} catch (err) {
			icmRetrievals.set(icm.runDir, `icm retrieval: failed — ${String(err)} (prompts carry no prior context)`);
			return undefined;
		}
	};
	/** The role's projection of a retrieval, or "" — the slot then vanishes from the prompt. */
	const icmProject = (r: RetrievalResult | undefined, role: RetrievalRole): string => (r ? renderRetrieved(r, role) : "");
	/** What the brief envelope records about retrieval: the one-line account as a decision, every withheld entry as a risk. */
	const icmRetrievalRecord = (icm: IcmRun | undefined, r: RetrievalResult | undefined): { decisions: string[]; risks: string[] } => ({
		decisions: icm && icmRetrievals.has(icm.runDir) ? [icmRetrievals.get(icm.runDir) as string] : [],
		risks: r?.skipped.map((s) => `context ${s.id} withheld at retrieval: ${s.reason}`) ?? [],
	});

	// ── 8.8 Boot banner — big centered "FUSION HARNESS" when the harness starts ──
	// TUI + fresh startup only: no banner noise in headless JSON streams, and no repeat
	// banner on /new, /resume, forks, or extension reloads.
	pi.on("session_start", async (ev: any, ctx: any) => {
		if (ctx.mode !== "tui" || ev?.reason !== "startup") return;
		panel({ kind: "boot", ok: true }, "FUSION HARNESS");
	});

	// ── 8.9 /fh-reset — wipe the persistent role sessions for this project ──
	// (/new triggers the same reset via the session_start hook above, on top of pi's own fresh session.)
	pi.registerCommand("fh-reset", {
		description: "Reset the persistent ARCHITECT/BUILDER sessions for this project — both agents start with fresh memories on the next command",
		handler: async (_args, ctx) => {
			const root = await resetRoleSessions(ctx.cwd);
			ctx.ui.notify(`fusion-harness: role sessions reset (${root}) — fresh memories on the next command`, "info");
		},
	});

	// ── 8.10 /thinking <architect> [builder] — retune thinking mid-session ──
	// Overrides --architect-thinking/--builder-thinking without a restart. Applies to the
	// NEXT command: children are spawned per command and read roleThinking() at spawn time.
	pi.registerCommand("thinking", {
		description: `Set thinking levels: /thinking <architect> [builder] (${THINKING_HELP}). Builder is optional — omit it to leave it unchanged. No args shows the current levels.`,
		handler: async (args, ctx) => {
			const current = () => `ARCHITECT ${roleThinking("architect")} · BUILDER ${roleThinking("builder")}`;
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (!parts.length) {
				ctx.ui.notify(`fusion-harness: thinking — ${current()}  (levels: ${THINKING_HELP})`, "info");
				return;
			}
			if (parts.length > 2) {
				ctx.ui.notify(`fusion-harness: /thinking takes at most 2 levels — <architect> [builder]. Got ${parts.length}.`, "error");
				return;
			}
			const bad = parts.filter((p) => !resolveThinking(p));
			if (bad.length) {
				ctx.ui.notify(`fusion-harness: invalid thinking level: ${bad.join(", ")}. Valid: ${THINKING_HELP}`, "error");
				return;
			}
			// Both forms normalize to the canonical level before it reaches a child's --thinking.
			thinkingOverride.architect = resolveThinking(parts[0]);
			if (parts[1]) thinkingOverride.builder = resolveThinking(parts[1]);
			ctx.ui.notify(`fusion-harness: thinking → ${current()}${parts[1] ? "" : " (builder unchanged)"} — applies to the next command`, "info");
		},
	});

	// ── 8.11 /system-prompt — the system prompt each role runs with, two columns ──
	// Zero-cost introspection: no children spawn, nothing hits a model API. Each column is
	// just the prompt text: the --<role>-system-prompt override when set, otherwise pi's
	// actual default — rebuilt exactly as a spawned child gets it (the host's base prompt
	// options minus what the spawn flags strip: no skills, no context files, no custom or
	// appended prompt, FULL_TOOLS allowlist).
	pi.registerCommand("system-prompt", {
		description: "Show the system prompt each role runs with — ARCHITECT | BUILDER side by side (the --<role>-system-prompt override, or pi's default)",
		handler: async (_args, ctx) => {
			const childDefaultPrompt = async (): Promise<string> => {
				const build = await loadBuildSystemPrompt();
				const hostOpts = ctx.getSystemPromptOptions?.();
				if (build && hostOpts) {
					return build({
						...hostOpts,
						customPrompt: undefined,
						appendSystemPrompt: undefined,
						contextFiles: [],
						skills: [],
						selectedTools: FULL_TOOLS.split(","),
						cwd: ctx.cwd,
					});
				}
				// Last resort: the host's effective prompt — still pi's real prompt, just not
				// stripped down to the child's spawn flags.
				return ctx.getSystemPrompt?.() ?? "(pi default — could not be resolved from this pi installation)";
			};
			const aOverride = roleSystemPrompt("architect");
			const bOverride = roleSystemPrompt("builder");
			const dflt = aOverride && bOverride ? "" : await childDefaultPrompt();
			const answers: NonNullable<FhDetails["answers"]> = [
				{ role: "ARCHITECT", model: architectModel(), text: (aOverride ?? dflt).trim() },
				{ role: "BUILDER", model: builderModel(), text: (bOverride ?? dflt).trim() },
			];
			panel(
				{ kind: "system-prompt", command: "system-prompt", ok: true, answers },
				[`## ARCHITECT · ${answers[0].model}`, answers[0].text, ``, `## BUILDER · ${answers[1].model}`, answers[1].text].join("\n"),
			);
		},
	});

	// ── 8.12 /fusion <prompt> [:: <fusion-prompt>] ─────────────
	pi.registerCommand("fusion", {
		description: 'ARCHITECT + BUILDER answer in parallel (two live columns), then a fusion agent merges them — /fusion "prompt" "fusion-prompt" (or `prompt :: fusion-prompt`)',
		handler: async (raw, ctx) => {
			const input = (raw ?? "").trim();
			if (!input) {
				ctx.ui.notify('Usage: /fusion "<prompt>" "<fusion-prompt>"  (or: /fusion <prompt> :: <fusion-prompt>)', "warning");
				return;
			}
			const parsed = parseFusionArgs(input);
			const prompt = parsed.prompt;
			const fusionInstruction = parsed.fusion || defaultFusionPrompt();

			const aModel = architectModel();
			const bModel = builderModel();
			const startedAt = Date.now();
			const artifactsDir = await mkArtifacts();
			await save(artifactsDir, "prompt.md", `${prompt}\n\nFUSION INSTRUCTION:\n${fusionInstruction}`);

			// Echo what was asked as a normal user-style message — the transcript stays readable.
			panel({ kind: "prompt", command: "fusion", ok: true }, `/fusion ${input}`);
			panel(
				{
					kind: "banner",
					command: "fusion",
					ok: true,
					prompt,
					fusionPrompt: fusionInstruction,
					roles: [
						{ role: "ARCHITECT", model: aModel },
						{ role: "BUILDER", model: bModel },
						{ role: "FUSION", model: aModel },
					],
					artifactsDir,
				},
				"",
			);

			const architect = newRun("ARCHITECT", aModel);
			const builder = newRun("BUILDER", bModel);
			const fuser = newRun("FUSION", aModel);
			const stopper = startStoppable(ctx, "fusion");
			const stopWidget = startWidget(ctx, "fusion", [architect, builder], fuser, startedAt);
			ctx.ui.setStatus(CUSTOM_TYPE, "fusion: agents running…");
			const icm = icmStart("fusion", artifactsDir, ctx.cwd);
			const retrieved = await icmRetrieve(icm, ctx.cwd); // Phase 4: before any role runs, so the brief can record it
			const retrievalRecord = icmRetrievalRecord(icm, retrieved);
			await icmBrief(
				icm,
				prompt,
				[
					{ role: "ARCHITECT", model: aModel, thinking: roleThinking("architect") },
					{ role: "BUILDER", model: bModel, thinking: roleThinking("builder") },
					{ role: "FUSION", model: aModel, thinking: roleThinking("architect") },
				],
				{ decisions: [`fusion instruction: ${excerpt(fusionInstruction, 300)}`, ...retrievalRecord.decisions], risks: retrievalRecord.risks },
			);

			try {
				// ── Stage 1: ARCHITECT + BUILDER answer in parallel (full tools each) ──
				await Promise.all([
					runChild({
						run: architect,
						prompt: workerPrompt("ARCHITECT", aModel, "BUILDER", bModel, prompt, icmProject(retrieved, "architect")),
						systemPrompt: roleSystemPrompt("architect"),
						tools: FULL_TOOLS,
						thinking: roleThinking("architect"),
						sessionDir: roleSession("architect", ctx.cwd).dir,
						sessionId: roleSession("architect", ctx.cwd).id,
						cwd: ctx.cwd,
						timeoutMs: childTimeoutMs(),
						signal: stopper.signal,
					}),
					runChild({
						run: builder,
						prompt: workerPrompt("BUILDER", bModel, "ARCHITECT", aModel, prompt, icmProject(retrieved, "builder")),
						systemPrompt: roleSystemPrompt("builder"),
						tools: FULL_TOOLS,
						thinking: roleThinking("builder"),
						...builderSpawn(ctx, artifactsDir),
						cwd: ctx.cwd,
						timeoutMs: childTimeoutMs(),
						signal: stopper.signal,
					}),
				]);

				if (stopper.stopped()) {
					await stoppedPanel("fusion", [architect, builder], artifactsDir, startedAt, "The two agents were killed; no fusion ran.");
					return;
				}

				for (const r of [architect, builder]) {
					await save(artifactsDir, `${r.role.toLowerCase()}.md`, runOk(r) ? r.text : `FAILED: ${runError(r)}`);
				}

				const specEnv = await icmRole(icm, "spec", "spec", architect, "architect.md");
				const buildEnv = await icmRole(icm, "build", "build", builder, "builder.md");

				// Both answers, side by side, buffered — never interleaved.
				const duoContent = [
					`## ARCHITECT · ${aModel}`,
					runOk(architect) ? architect.text : `FAILED: ${runError(architect)}`,
					``,
					`## BUILDER · ${bModel}`,
					runOk(builder) ? builder.text : `FAILED: ${runError(builder)}`,
				].join("\n");
				panel(
					{
						kind: "duo",
						command: "fusion",
						ok: runOk(architect) && runOk(builder),
						sources: [toStat(architect), toStat(builder)],
						answers: [
							{ role: "ARCHITECT", model: aModel, text: runOk(architect) ? architect.text : "" },
							{ role: "BUILDER", model: bModel, text: runOk(builder) ? builder.text : "" },
						],
						artifactsDir,
					},
					duoContent,
				);

				if (!runOk(architect) || !runOk(builder)) {
					fuser.status = "failed";
					fuser.errorMessage = "skipped — needs both inputs";
					const t = totals([architect, builder], startedAt);
					panel(
						{ kind: "error", command: "fusion", ok: false, sources: [toStat(architect), toStat(builder)], artifactsDir, ...t },
						"Fusion skipped: both agents must succeed to fuse. The failure above is attributed to the specific role + model.",
					);
					await icmOutput(icm, "Fusion skipped: both agents must succeed to fuse.", {
						risks: [architect, builder].filter((r) => !runOk(r)).map((r) => `${r.role} (${r.model}) failed: ${runError(r)}`),
					});
					return;
				}

				// ── Stage 2: the FUSION agent (architect model, fresh session) merges both ──
				// Phase 2: the fuser consumes the ARCHITECT spec and BUILDER build envelopes — each
				// re-validated and hash-checked against the raw report it references — BEFORE the raw
				// answers. A handoff that fails verification is dropped (and reported), never used.
				const handoffs: Array<{ envelope: ContextEnvelope; file: string; label?: string }> = [];
				const handoffErrors: string[] = [];
				for (const [env, label] of [
					[specEnv, "ARCHITECT"],
					[buildEnv, "BUILDER"],
				] as const) {
					const c = await icmConsume(icm, env?.ok ? env.file : undefined);
					if (!c) handoffErrors.push(`${label}: no valid envelope to hand off (fusion used the raw answer only)`);
					else if ("envelope" in c) handoffs.push({ envelope: c.envelope, file: c.file, label });
					else handoffErrors.push(`${label}: ${path.basename(c.file)} NOT consumed — ${c.errors.join("; ")}`);
				}
				const consumedFiles = handoffs.map((h) => path.basename(h.file));
				ctx.ui.setStatus(CUSTOM_TYPE, "fusion: fusing…");
				await runChild({
					run: fuser,
					prompt: fuserPrompt(
						fusionInstruction,
						prompt,
						{ role: "ARCHITECT", model: aModel, text: architect.text },
						{ role: "BUILDER", model: bModel, text: builder.text },
						aModel,
						roleThinking("architect"),
						artifactsDir,
						renderHandoff(handoffs, artifactsDir),
					),
					systemPrompt: roleSystemPrompt("architect"),
					tools: FULL_TOOLS,
					thinking: roleThinking("architect"),
					sessionDir: path.join(artifactsDir, "fusion"),
					cwd: ctx.cwd,
					timeoutMs: childTimeoutMs(),
					signal: stopper.signal,
				});
				await save(artifactsDir, "fused.md", runOk(fuser) ? fuser.text : `FAILED: ${runError(fuser)}`);
				await icmRole(icm, "output", "output", fuser, "fused.md", "fused-report", {
					decisions: [
						`fusion instruction: ${excerpt(fusionInstruction, 300)}`,
						consumedFiles.length ? `fusion consumed ICM handoffs before the raw answers: ${consumedFiles.join(", ")} (verified)` : "fusion ran on the raw answers only — no ICM handoff was consumable",
					],
					risks: handoffErrors,
					claims: runOk(fuser)
						? [
								{
									statement: "The fused answer merges [ARCHITECT] and [BUILDER] per the fusion instruction, with attribution.",
									status: "proposed",
									source_role: "fusion",
									evidence: ["artifact:fused.md", ...(specEnv?.ok ? [`envelope:${specEnv.id}`] : []), ...(buildEnv?.ok ? [`envelope:${buildEnv.id}`] : [])],
									validated_by: null,
								},
							]
						: [],
					artifacts: [
						{ path: "architect.md", type: "raw-report" },
						{ path: "builder.md", type: "raw-report" },
					],
					open_questions: ["Consensus/divergence lives in the raw fused report; Phase 2 does not parse it into structured fields."],
				});

				const t = totals([architect, builder, fuser], startedAt);
				if (runOk(fuser)) {
					panel(
						{
							kind: "fused",
							command: "fusion",
							ok: true,
							agent: toStat(fuser),
							sources: [toStat(architect), toStat(builder)],
							artifactsDir,
							icmConsumed: consumedFiles,
							...t,
						},
						fuser.text,
					);
				} else {
					panel(
						{
							kind: "error",
							command: "fusion",
							ok: false,
							agent: toStat(fuser),
							sources: [toStat(architect), toStat(builder)],
							artifactsDir,
							...t,
						},
						"The two side-by-side answers above are still valid — only the fusion step failed.",
					);
				}
				await save(
					artifactsDir,
					"summary.json",
					JSON.stringify(
						{ command: "fusion", ok: runOk(fuser), agents: [toStat(architect), toStat(builder), toStat(fuser)], sessions: { architect: cachedRoleId("architect"), builder: cachedRoleId("builder") }, ...t },
						null,
						2,
					),
				);
			} finally {
				stopper.release(); // never leave the escape tap installed past the command
				stopWidget();
				icmRuns.delete(artifactsDir);
				icmRetrievals.delete(artifactsDir);
				ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			}
		},
	});

	// ── 8.13 /auto-validate [--max-validations N] <prompt> ─────
	// Gate-first validation loop (red → green):
	//   1. VALIDATOR designs the acceptance gate (uv script) BEFORE any work happens.
	//   2. Baseline gate run — expected FAIL (integrity check on the gate itself).
	//   3. BUILDER builds against the visible, immutable gate.
	//   4. Gate runs. FAIL → its output feeds back into the builder's persistent
	//      session as correction instructions. PASS → done.
	//   5. After --max-validations failed validations, development HALTS loudly.
	const MAX_VALIDATIONS_DEFAULT = 5;
	const ESCALATE_DEFAULT = 3;
	const clampCount = (n: number, fallback: number): number => (Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : fallback);
	const clampValidations = (n: number): number => clampCount(n, MAX_VALIDATIONS_DEFAULT);
	/**
	 * A gate result that means "the gate itself could not run" — never the builder's fault.
	 * Includes a gate that could not START (malformed PEP 723 header, unresolvable dependency,
	 * SyntaxError in gate.py itself): such a run says nothing about the build, so the loop must
	 * not spend correction rounds on it (gate.ts).
	 */
	const gateHarnessError = (g: { code: number; output: string }): string | undefined => {
		if (g.code === 124 || g.output.includes("[gate timed out]")) return "the gate timed out (gates must finish in <60s)";
		if (g.code === 127 || /failed to spawn|spawn error/.test(g.output)) return "the gate could not be executed — is `uv` installed and on PATH?";
		return gateStartFailure(g);
	};

	pi.registerCommand("auto-validate", {
		description:
			"Auto-validation loop: VALIDATOR designs a uv acceptance gate FIRST, BUILDER builds, the gate runs, failures feed back to the builder — until pass or --max-validations (default 5)",
		handler: async (raw, ctx) => {
			let input = (raw ?? "").trim();
			// Inline overrides of the startup flags: /auto-validate --max-validations 3 --escalate-to-validator-count 2 <prompt>
			let maxV = clampValidations(Number.parseInt(flagStr("max-validations"), 10));
			let escalateAt = clampCount(Number.parseInt(flagStr("escalate-to-validator-count"), 10), ESCALATE_DEFAULT);
			input = input
				.replace(/--max-validations[=\s]+(\d+)\s*/g, (_m, n) => {
					maxV = clampValidations(Number.parseInt(n, 10));
					return "";
				})
				.replace(/--escalate-to-validator-count[=\s]+(\d+)\s*/g, (_m, n) => {
					escalateAt = clampCount(Number.parseInt(n, 10), ESCALATE_DEFAULT);
					return "";
				})
				.trim();
			if (!input) {
				ctx.ui.notify("Usage: /auto-validate [--max-validations N] [--escalate-to-validator-count N] <prompt>", "warning");
				return;
			}
			const prompt = input;
			const aModel = architectModel();
			const bModel = builderModel();
			const startedAt = Date.now();
			const artifactsDir = await mkArtifacts();
			await save(artifactsDir, "prompt.md", prompt);

			panel({ kind: "prompt", command: "auto-validate", ok: true }, `/auto-validate ${(raw ?? "").trim()}`);
			panel(
				{
					kind: "banner",
					command: "auto-validate",
					ok: true,
					prompt,
					maxRounds: maxV,
					escalateAt,
					roles: [
						{ role: "VALIDATOR", model: aModel },
						{ role: "BUILDER", model: bModel },
					],
					artifactsDir,
				},
				"",
			);

			const validator = newRun("VALIDATOR", aModel);
			const builder = newRun("BUILDER", bModel);
			const GATE_CRITERION = "The VALIDATOR-authored gate.py exits 0 against the working tree.";
			const icm = icmStart("auto-validate", artifactsDir, ctx.cwd);
			const retrieved = await icmRetrieve(icm, ctx.cwd); // Phase 4: before any role runs, so the brief can record it
			const retrievalRecord = icmRetrievalRecord(icm, retrieved);
			await icmBrief(
				icm,
				prompt,
				[
					{ role: "VALIDATOR", model: aModel, thinking: roleThinking("architect") },
					{ role: "BUILDER", model: bModel, thinking: roleThinking("builder") },
				],
				{ decisions: [`max validations: ${maxV}`, `validator triage from failure ${escalateAt}`, ...retrievalRecord.decisions], acceptance_criteria: [GATE_CRITERION], risks: retrievalRecord.risks },
			);
			let specId: string | undefined; // the gate's spec envelope — a repaired gate supersedes it
			let lastBuildId: string | undefined; // the round's build envelope — cited by its validation
			let lastValidationId: string | undefined; // each gate run supersedes the previous round's verdict
			let lastValidationFile: string | undefined; // …and its file is what the next correction round consumes (Phase 2)
			// Columns match the footer: VALIDATOR (architect-family) left, BUILDER right.
			// One builder AgentRun is reused across correction rounds — same persistent
			// session, cumulative tokens/cost, one accumulating flow column.
			const stopper = startStoppable(ctx, "auto-validate");
			const stopWidget = startWidget(ctx, "auto-validate", [validator, builder], undefined, startedAt);
			const fail = async (agentStat: AgentStat, body: string, extra: Partial<FhDetails> = {}, icmExtra: Partial<EnvelopeInput> = {}) => {
				const t = totals([validator, builder], startedAt);
				panel({ kind: "error", command: "auto-validate", ok: false, agent: agentStat, artifactsDir, maxRounds: maxV, ...t, ...extra }, body);
				await icmOutput(icm, `FAILED: ${excerpt(body, 300)}`, {
					acceptance_criteria: [GATE_CRITERION],
					risks: [`${agentStat.role} (${agentStat.model}): ${agentStat.error ?? "failed"}`],
					...icmExtra,
				});
			};

			try {
				// ── 1. VALIDATOR designs the gate (before any build) ──
				// The gate's transport is the FILESYSTEM: the harness dictates an absolute path and
				// the validator writes gate.py there with its own write tool. Nothing is parsed out
				// of the reply, so a gate whose own source contains ``` survives intact.
				const scriptPath = path.join(artifactsDir, "gate.py");
				ctx.ui.setStatus(CUSTOM_TYPE, "auto-validate: validator designing the gate…");
				await runChild({
					run: validator,
					prompt: validatorPrompt(prompt, ctx.cwd, scriptPath, icmProject(retrieved, "validator")),
					systemPrompt: validatorSystem(scriptPath),
					tools: VALIDATOR_TOOLS,
					thinking: roleThinking("architect"),
					sessionDir: roleSession("architect", ctx.cwd).dir,
					sessionId: roleSession("architect", ctx.cwd).id,
					cwd: ctx.cwd,
					timeoutMs: childTimeoutMs(),
					signal: stopper.signal,
				});
				await save(artifactsDir, "validator.md", runOk(validator) ? validator.text : `FAILED: ${runError(validator)}`);
				// Prefer the file the validator wrote. Fence extraction is the legacy fallback,
				// used only when it pasted the gate inline instead (lossy — see extractGateScript).
				let script: string | undefined;
				let gateVia = "written to disk by the validator";
				if (runOk(validator)) {
					try {
						script = ensureGateMetadata(await fs.promises.readFile(scriptPath, "utf-8"));
					} catch {
						/* validator didn't write the file — fall back to the fence */
					}
					if (!script) {
						script = extractGateScript(validator.text);
						if (script) gateVia = "recovered from a code fence (legacy — truncates at an embedded ```)";
					}
				}
				if (stopper.stopped()) {
					await stoppedPanel("auto-validate", [validator, builder], artifactsDir, startedAt, "The validator was killed while designing the gate; nothing was built.");
					return;
				}
				if (!script) {
					const stat = toStat(validator);
					if (!stat.error) stat.error = `did not write a uv gate script to ${scriptPath}`;
					await icm?.emit("spec", {
						kind: "spec",
						producer: { role: "validator", model: aModel },
						summary: `FAILED: ${stat.error}`,
						acceptance_criteria: [GATE_CRITERION],
						risks: [stat.error],
						artifacts: [{ path: "validator.md", type: "raw-report" }],
					});
					await fail(
						stat,
						`✗ VALIDATOR (${aModel}) failed to design the acceptance gate — nothing was built.\nExpected the gate at ${scriptPath}; no file was written and no fenced script was found in its reply.\n\n${validator.text || ""}`,
					);
					return;
				}
				// Only rewrite when the content differs (fence fallback, or injected metadata), so a
				// gate the validator wrote itself executes byte-for-byte as authored.
				let onDisk: string | undefined;
				try {
					onDisk = await fs.promises.readFile(scriptPath, "utf-8");
				} catch {
					/* not written yet */
				}
				if (onDisk !== script) await save(artifactsDir, "gate.py", script);
				validator.flow.push({ type: "tool", label: `gate.py — ${gateVia} (${script.length} bytes)` });

				// ── 2. Baseline gate run — must FAIL before the build (red) ──
				ctx.ui.setStatus(CUSTOM_TYPE, "auto-validate: baseline gate run (expected FAIL)…");
				const baseline = await runProc("uv", ["run", scriptPath], ctx.cwd, GATE_TIMEOUT_MS, stopper.signal);
				await save(artifactsDir, "gate-baseline.txt", `exit ${baseline.code}\n\n${baseline.output}`);
				validator.flow.push({ type: "tool", label: `uv run gate.py (baseline) → exit ${baseline.code}` });
				if (stopper.stopped()) {
					await stoppedPanel("auto-validate", [validator, builder], artifactsDir, startedAt, "Stopped at the baseline gate run; nothing was built.");
					return;
				}
				const baselineHarnessErr = gateHarnessError(baseline);
				if (baselineHarnessErr) {
					const stat = toStat(validator);
					stat.error = `gate execution error: ${baselineHarnessErr}`;
					await fail(stat, `✗ GATE ERROR — ${baselineHarnessErr}\n\nNothing was built. Gate output:\n\`\`\`\n${truncateChars(baseline.output.trim(), DETAIL_SNIPPET_MAX)}\n\`\`\``);
					return;
				}
				const baselineNote =
					baseline.code === 0
						? `### ⚠ BASELINE WARNING\nThe gate already PASSES before any work was done — either the request is already satisfied or the gate is too weak. Proceeding to build anyway; treat a first-round pass with suspicion.`
						: `### Baseline run — RED ✓ (exit ${baseline.code}, expected)\nThe gate correctly fails against the current state — the loop is live.\n\`\`\`\n${truncateChars(baseline.output.trim() || "(no output)", DETAIL_SNIPPET_MAX)}\n\`\`\``;
				panel(
					{
						kind: "gate",
						command: "auto-validate",
						ok: true,
						agent: toStat(validator),
						maxRounds: maxV,
						script: truncateChars(script, DETAIL_SNIPPET_MAX),
						gateExitCode: baseline.code,
						scriptPath,
						artifactsDir,
					},
					[`### Acceptance gate (designed by VALIDATOR before the build; immutable)`, "```python", script.trim(), "```", baselineNote].join("\n"),
				);
				{
					const specEnv = await icm?.emit("spec", {
						kind: "spec",
						producer: { role: "validator", model: aModel },
						summary: excerpt(validator.text),
						acceptance_criteria: [GATE_CRITERION],
						decisions: [`gate ${gateVia}`, `baseline exit ${baseline.code}`],
						risks: baseline.code === 0 ? ["The gate already passes at baseline: the gate is weak or the request is already satisfied."] : [],
						claims: [
							{
								statement: "The gate fails against the pre-build state (red baseline).",
								status: baseline.code !== 0 ? "validated" : "rejected",
								source_role: "validator",
								evidence: ["artifact:gate-baseline.txt", "artifact:gate.py"],
								validated_by: "gate",
							},
						],
						artifacts: [
							{ path: "validator.md", type: "raw-report" },
							{ path: "gate.py", type: "gate-script" },
							{ path: "gate-baseline.txt", type: "gate-output" },
						],
					});
					if (specEnv?.ok) specId = specEnv.id;
				}

				// ── 3. Build → validate loop ──
				// Round 1 forks the host session (the builder IS the host's agent lineage);
				// later rounds resume that same fork so the loop keeps its working memory.
				let lastGate: { code: number; output: string } | undefined;
				const gateHistory: Array<{ round: number; code: number; output: string }> = [];
				let pendingTriage: string | undefined;
				let pendingGateUpdate: string | undefined; // repaired gate → next correction prompt (round-1 copy is stale)
				let gateRepairUsed = false; // ONE repair per run — the grader never gets to keep moving goalposts
				const firstSpawn = builderSpawn(ctx, artifactsDir);
				for (let round = 1; round <= maxV; round++) {
					const triageBrief = pendingTriage;
					pendingTriage = undefined;
					const gateUpdate = pendingGateUpdate;
					pendingGateUpdate = undefined;
					const spawn =
						round === 1
							? firstSpawn
							: builder.sessionRef
								? { sessionDir: firstSpawn.sessionDir, resume: builder.sessionRef }
								: firstSpawn;
					// Phase 2: a correction round consumes the previous gate run's validation envelope —
					// its PASS/FAIL claims become the structured diagnostics block, placed before the raw
					// gate output (which stays the source of truth). Verified first; dropped if not.
					let icmDiagnostics: string | undefined;
					let consumedValidation: string | undefined;
					let consumeError: string | undefined;
					if (round > 1) {
						const c = await icmConsume(icm, lastValidationFile);
						if (c && "envelope" in c) {
							icmDiagnostics = renderDiagnostics(c.envelope, { file: c.file });
							consumedValidation = path.basename(c.file);
						} else if (c) consumeError = `${path.basename(c.file)} NOT consumed — ${c.errors.join("; ")}`;
						else consumeError = "no valid validation envelope to consume (builder got the raw gate output only)";
					}
					ctx.ui.setStatus(CUSTOM_TYPE, `auto-validate: builder — round ${round}/${maxV}…`);
					await runChild({
						run: builder,
						prompt: round === 1 ? builderPrompt(prompt, script, icmProject(retrieved, "builder")) : correctionPrompt(round, maxV, lastGate!.code, lastGate!.output, triageBrief, gateUpdate, icmDiagnostics),
						systemPrompt: roleSystemPrompt("builder"),
						tools: FULL_TOOLS,
						thinking: roleThinking("builder"),
						...spawn,
						cwd: ctx.cwd,
						timeoutMs: buildTimeoutMs(),
						signal: stopper.signal,
					});
					await save(artifactsDir, `builder-round-${round}.md`, runOk(builder) ? builder.text : `FAILED: ${runError(builder)}`);
					{
						const buildEnv = await icmRole(icm, `build-round-${round}`, "build", builder, `builder-round-${round}.md`, "raw-report", {
							decisions: [`round ${round} of ${maxV}`, ...(consumedValidation ? [`consumed structured gate diagnostics from ${consumedValidation} (verified)`] : [])],
							risks: consumeError ? [consumeError] : [],
						});
						lastBuildId = buildEnv?.ok ? buildEnv.id : undefined;
					}
					// Check the stop BEFORE blaming the builder: an escape-killed child is !runOk,
					// and reporting "BUILDER failed" for a user-initiated stop is a lie.
					if (stopper.stopped()) {
						await stoppedPanel("auto-validate", [validator, builder], artifactsDir, startedAt, `Stopped during build round ${round}/${maxV}; the gate was not re-run.`);
						return;
					}
					if (!runOk(builder)) {
						await fail(
							toStat(builder),
							`✗ BUILDER (${bModel}) failed during round ${round}/${maxV} — the loop cannot continue.\n\n${builder.text || ""}`,
							{ round, sources: [toStat(validator)] },
						);
						return;
					}

					ctx.ui.setStatus(CUSTOM_TYPE, `auto-validate: gate — validation ${round}/${maxV}…`);
					lastGate = await runProc("uv", ["run", scriptPath], ctx.cwd, GATE_TIMEOUT_MS, stopper.signal);
					await save(artifactsDir, `gate-round-${round}.txt`, `exit ${lastGate.code}\n\n${lastGate.output}`);
					validator.flow.push({ type: "tool", label: `uv run gate.py (round ${round}) → exit ${lastGate.code}` });
					if (stopper.stopped()) {
						await stoppedPanel("auto-validate", [validator, builder], artifactsDir, startedAt, `Stopped at the gate run for round ${round}/${maxV}.`);
						return;
					}
					const harnessErr = gateHarnessError(lastGate);
					if (harnessErr) {
						const stat = toStat(validator);
						stat.error = `gate execution error: ${harnessErr}`;
						await fail(stat, `✗ GATE ERROR during validation ${round}/${maxV} — ${harnessErr}\n\nGate output:\n\`\`\`\n${truncateChars(lastGate.output.trim(), DETAIL_SNIPPET_MAX)}\n\`\`\``, { round });
						return;
					}

					const ok = lastGate.code === 0;
					{
						const diag = gateClaims(lastGate.output, lastGate.code, `gate-round-${round}.txt`, lastBuildId);
						const valEnv = await icm?.emit(`validation-round-${round}`, {
							kind: "validation",
							producer: { role: "validator", model: aModel },
							summary: `Gate run ${round}/${maxV}: ${ok ? "PASS" : "FAIL"} (exit ${lastGate.code}). ${excerpt(lastGate.output, 300)}`,
							acceptance_criteria: [GATE_CRITERION],
							decisions: [`exit ${lastGate.code}`, diag.decision],
							risks: ok && baseline.code === 0 ? ["The gate also passed at baseline — verify the result yourself."] : [],
							claims: [
								{
									statement: "The acceptance gate passed.",
									status: ok ? "validated" : "rejected",
									source_role: "validator",
									evidence: [`artifact:gate-round-${round}.txt`, "artifact:gate.py", ...(lastBuildId ? [`envelope:${lastBuildId}`] : [])],
									validated_by: "gate",
								},
								...diag.claims, // one claim per PASS:/FAIL: line — the builder's structured diagnostics
							],
							open_questions: diag.open_questions,
							artifacts: [
								{ path: "gate.py", type: "gate-script" },
								{ path: `gate-round-${round}.txt`, type: "gate-output" },
							],
							supersedes: lastValidationId ?? null,
						});
						if (valEnv?.ok) {
							lastValidationId = valEnv.id;
							lastValidationFile = valEnv.file;
						}
					}
					const t = totals([validator, builder], startedAt);
					const gateBody = [
						`### Gate run — ${ok ? "PASS (exit 0)" : `FAIL (exit ${lastGate.code})`}`,
						"```",
						truncateChars(lastGate.output.trim() || "(no output)", DETAIL_SNIPPET_MAX * 2),
						"```",
						ok && baseline.code === 0 ? `⚠ Note: the gate also passed at baseline — verify the result yourself.` : "",
					].join("\n");
					const builderBody = `### Builder report — round ${round}\n${builder.text}`;
					panel(
						{
							kind: "validation",
							command: "auto-validate",
							ok,
							round,
							maxRounds: maxV,
							agent: toStat(validator),
							sources: [toStat(validator), toStat(builder)],
							answers: [
								{ role: "VALIDATOR", model: aModel, text: gateBody },
								{ role: "BUILDER", model: bModel, text: builderBody },
							],
							gateOutput: truncateChars(lastGate.output, DETAIL_SNIPPET_MAX),
							gateExitCode: lastGate.code,
							scriptPath,
							artifactsDir,
							icmConsumed: consumedValidation ? [consumedValidation] : undefined,
							icmPromotable: ok,
							...t,
						},
						`${builderBody}\n\n${gateBody}`,
					);
					if (ok) {
						await icmOutput(icm, `Gate PASS at validation ${round}/${maxV}.`, {
							acceptance_criteria: [GATE_CRITERION],
							decisions: ["Phase 3: this envelope stays draft in the run dir; promotion is a manual, gate-backed act — /icm-promote <run-dir>."],
							risks: baseline.code === 0 ? ["The gate also passed at baseline — verify the result yourself."] : [],
							claims: [
								{
									statement: "The acceptance gate passed.",
									status: "validated",
									source_role: "validator",
									evidence: [...(lastValidationId ? [`envelope:${lastValidationId}`] : []), `artifact:gate-round-${round}.txt`],
									validated_by: "gate",
								},
							],
							artifacts: [
								{ path: `gate-round-${round}.txt`, type: "gate-output" },
								{ path: `builder-round-${round}.md`, type: "raw-report" },
							],
						});
						await save(
							artifactsDir,
							"summary.json",
							JSON.stringify(
								{ command: "auto-validate", ok: true, rounds: round, maxValidations: maxV, escalateAt, gateExitCode: 0, agents: [toStat(validator), toStat(builder)], sessions: { architect: cachedRoleId("architect"), builder: cachedRoleId("builder") }, ...t },
								null,
								2,
							),
						);
						return;
					}

					// ── Escalation: on the Nth failure, the VALIDATOR diagnoses why the builder is stuck ──
					gateHistory.push({ round, code: lastGate.code, output: lastGate.output });
					if (round >= escalateAt && round < maxV) {
						ctx.ui.setStatus(CUSTOM_TYPE, `auto-validate: ⚡ validator triage (failure ${round}/${maxV})…`);
						// Snapshot the gate as it sits on disk BEFORE triage — the repair detector
						// compares content, not the brief's wording.
						let gateBefore = script;
						try {
							gateBefore = await fs.promises.readFile(scriptPath, "utf-8");
						} catch {
							/* keep the in-memory copy */
						}
						await runChild({
							run: validator,
							prompt: triagePrompt(prompt, round, maxV, builder.text, gateHistory, artifactsDir),
							systemPrompt: triageSystem(scriptPath),
							// Repair power is enforced by TOOLS, not trust: while the run's single
							// repair is unused, triage holds the validator's write (one dictated
							// path); once spent, it drops back to strictly read-only eyes.
							tools: gateRepairUsed ? READONLY_TOOLS : VALIDATOR_TOOLS,
							thinking: roleThinking("architect"),
							sessionDir: roleSession("architect", ctx.cwd).dir,
							sessionId: roleSession("architect", ctx.cwd).id,
							cwd: ctx.cwd,
							timeoutMs: childTimeoutMs(),
							signal: stopper.signal,
						});
						await save(artifactsDir, `triage-round-${round}.md`, runOk(validator) ? validator.text : `FAILED: ${runError(validator)}`);
						await icm?.emit(`triage-round-${round}`, {
							kind: "validation",
							producer: { role: "triage", model: aModel },
							summary: runOk(validator) ? excerpt(validator.text) : `FAILED: ${runError(validator)}`,
							acceptance_criteria: [GATE_CRITERION],
							decisions: [`escalated after ${round} failed validation(s)`],
							risks: runOk(validator) ? [] : [`triage failed: ${runError(validator)}`],
							claims: runOk(validator)
								? [
										{
											statement: "TRIAGE diagnosed why the builder keeps failing the gate (advisory — the gate output stays the source of truth).",
											status: "proposed",
											source_role: "triage",
											evidence: [`artifact:triage-round-${round}.md`],
											validated_by: null,
										},
									]
								: [],
							artifacts: [{ path: `triage-round-${round}.md`, type: "triage-report" }],
						});
						if (runOk(validator)) {
							pendingTriage = validator.text;
							panel(
								{
									kind: "triage",
									command: "auto-validate",
									ok: true,
									round,
									maxRounds: maxV,
									escalateAt,
									agent: toStat(validator),
									artifactsDir,
								},
								validator.text,
							);

							// ── Gate repair: triage rewrote a defective gate (once per run) ──
							if (!gateRepairUsed) {
								let gateAfter: string | undefined;
								try {
									gateAfter = await fs.promises.readFile(scriptPath, "utf-8");
								} catch {
									/* unreadable — treat as unchanged */
								}
								if (gateAfter?.trim() && gateAfter !== gateBefore) {
									gateRepairUsed = true;
									await save(artifactsDir, `gate.py.r${round}`, gateBefore); // the defective gate, preserved for audit
									script = ensureGateMetadata(gateAfter) ?? gateAfter;
									if (script !== gateAfter) await save(artifactsDir, "gate.py", script);
									pendingGateUpdate = script;
									validator.flow.push({ type: "tool", label: `gate.py REPAIRED (defect) — old gate saved as gate.py.r${round}` });
									{
										const repairEnv = await icm?.emit(`spec-repair-round-${round}`, {
											kind: "spec",
											producer: { role: "triage", model: aModel },
											summary: `GATE DEFECT — the VALIDATOR repaired its own gate after round ${round}; the old gate is preserved as gate.py.r${round}.`,
											acceptance_criteria: [GATE_CRITERION],
											decisions: ["one gate repair per run"],
											artifacts: [
												{ path: "gate.py", type: "gate-script" },
												{ path: `gate.py.r${round}`, type: "gate-script" },
												{ path: `triage-round-${round}.md`, type: "triage-report" },
											],
											supersedes: specId ?? null,
										});
										if (repairEnv?.ok) specId = repairEnv.id;
									}

									// The repaired gate re-runs IMMEDIATELY, on the house: a gate defect
									// was never the builder's failure, so it costs no correction round.
									ctx.ui.setStatus(CUSTOM_TYPE, "auto-validate: gate repaired — free re-run…");
									const rerun = await runProc("uv", ["run", scriptPath], ctx.cwd, GATE_TIMEOUT_MS, stopper.signal);
									await save(artifactsDir, `gate-repair-round-${round}.txt`, `exit ${rerun.code}\n\n${rerun.output}`);
									validator.flow.push({ type: "tool", label: `uv run gate.py (post-repair) → exit ${rerun.code}` });
									{
										const diag = gateClaims(rerun.output, rerun.code, `gate-repair-round-${round}.txt`, lastBuildId);
										const valEnv = await icm?.emit(`validation-repair-round-${round}`, {
											kind: "validation",
											producer: { role: "validator", model: aModel },
											summary: `Post-repair gate run: ${rerun.code === 0 ? "PASS" : "FAIL"} (exit ${rerun.code}). ${excerpt(rerun.output, 300)}`,
											acceptance_criteria: [GATE_CRITERION],
											decisions: [`exit ${rerun.code}`, "no builder round consumed", diag.decision],
											claims: [
												{
													statement: "The acceptance gate passed.",
													status: rerun.code === 0 ? "validated" : "rejected",
													source_role: "validator",
													evidence: [`artifact:gate-repair-round-${round}.txt`, "artifact:gate.py", ...(lastBuildId ? [`envelope:${lastBuildId}`] : [])],
													validated_by: "gate",
												},
												...diag.claims,
											],
											open_questions: diag.open_questions,
											artifacts: [
												{ path: "gate.py", type: "gate-script" },
												{ path: `gate-repair-round-${round}.txt`, type: "gate-output" },
											],
											supersedes: lastValidationId ?? null,
										});
										if (valEnv?.ok) {
							lastValidationId = valEnv.id;
							lastValidationFile = valEnv.file;
						}
									}
									if (stopper.stopped()) {
										await stoppedPanel("auto-validate", [validator, builder], artifactsDir, startedAt, `Stopped at the post-repair gate run (round ${round}/${maxV}).`);
										return;
									}
									const rerunHarnessErr = gateHarnessError(rerun);
									if (rerunHarnessErr) {
										const stat = toStat(validator);
										stat.error = `gate execution error: ${rerunHarnessErr}`;
										await fail(stat, `✗ GATE ERROR on the post-repair run — ${rerunHarnessErr}\n\nGate output:\n\`\`\`\n${truncateChars(rerun.output.trim(), DETAIL_SNIPPET_MAX)}\n\`\`\``, { round });
										return;
									}
									panel(
										{
											kind: "gate",
											command: "auto-validate",
											ok: rerun.code === 0,
											round,
											maxRounds: maxV,
											agent: toStat(validator),
											script: truncateChars(script, DETAIL_SNIPPET_MAX),
											gateExitCode: rerun.code,
											scriptPath,
											artifactsDir,
										},
										[
											`### ⚒ Gate REPAIRED by VALIDATOR — defect fixed after round ${round} (old gate: gate.py.r${round} · one repair per run)`,
											"```python",
											script.trim(),
											"```",
											rerun.code === 0
												? `### Post-repair run — GREEN ✓ (exit 0, no builder round consumed)\n\`\`\`\n${truncateChars(rerun.output.trim() || "(no output)", DETAIL_SNIPPET_MAX)}\n\`\`\``
												: `### Post-repair run — still RED (exit ${rerun.code}) — these are now the REAL failures\n\`\`\`\n${truncateChars(rerun.output.trim() || "(no output)", DETAIL_SNIPPET_MAX)}\n\`\`\``,
										].join("\n"),
									);
									if (rerun.code === 0) {
										// The build was right all along — the gate was the bug. End green.
										await icmOutput(icm, `Gate PASS after gate repair (validation ${round}/${maxV}, no builder round consumed).`, {
											acceptance_criteria: [GATE_CRITERION],
											decisions: ["Phase 3: this envelope stays draft in the run dir; promotion is a manual, gate-backed act — /icm-promote <run-dir>.", "gate repaired once by the VALIDATOR"],
											claims: [
												{
													statement: "The acceptance gate passed.",
													status: "validated",
													source_role: "validator",
													evidence: [...(lastValidationId ? [`envelope:${lastValidationId}`] : []), `artifact:gate-repair-round-${round}.txt`],
													validated_by: "gate",
												},
											],
											artifacts: [
												{ path: `gate-repair-round-${round}.txt`, type: "gate-output" },
												{ path: `builder-round-${round}.md`, type: "raw-report" },
											],
										});
										const t = totals([validator, builder], startedAt);
										const gateBody = `### Gate run — PASS (exit 0, post-repair)\n\`\`\`\n${truncateChars(rerun.output.trim() || "(no output)", DETAIL_SNIPPET_MAX * 2)}\n\`\`\``;
										const builderBody = `### Builder report — round ${round}\n${builder.text}`;
										panel(
											{
												kind: "validation",
												command: "auto-validate",
												ok: true,
												round,
												maxRounds: maxV,
												agent: toStat(validator),
												sources: [toStat(validator), toStat(builder)],
												answers: [
													{ role: "VALIDATOR", model: aModel, text: gateBody },
													{ role: "BUILDER", model: bModel, text: builderBody },
												],
												gateOutput: truncateChars(rerun.output, DETAIL_SNIPPET_MAX),
												gateExitCode: 0,
												scriptPath,
												artifactsDir,
												icmPromotable: true,
												...t,
											},
											`${builderBody}\n\n${gateBody}`,
										);
										await save(
											artifactsDir,
											"summary.json",
											JSON.stringify(
												{ command: "auto-validate", ok: true, rounds: round, gateRepaired: true, maxValidations: maxV, escalateAt, gateExitCode: 0, agents: [toStat(validator), toStat(builder)], sessions: { architect: cachedRoleId("architect"), builder: cachedRoleId("builder") }, ...t },
												null,
												2,
											),
										);
										return;
									}
									// Still red on a now-sound gate: those failures are real — hand them
									// to the next correction round.
									lastGate = rerun;
									gateHistory.push({ round, code: rerun.code, output: rerun.output });
								}
							}
						} else {
							// Triage is an enhancement — a failed triage never blocks the loop.
							validator.flow.push({ type: "tool", label: `triage failed (${runError(validator)}) — continuing with raw gate output` });
						}
					}
				}

				// ── 4. Max validations exhausted — halt loudly ──
				const stat = toStat(builder);
				stat.error = `gate still failing after ${maxV}/${maxV} validations`;
				await fail(
					stat,
					[
						`## ✗ HALTED — development stopped after ${maxV}/${maxV} validations`,
						`The acceptance gate is still failing. No further corrections will be attempted.`,
						``,
						`### Last gate output (exit ${lastGate?.code ?? "?"})`,
						"```",
						truncateChars(lastGate?.output.trim() || "(no output)", DETAIL_SNIPPET_MAX),
						"```",
						``,
						`Raise the cap with \`--max-validations N\` (startup flag or inline) or inspect the artifacts: ${artifactsDir}`,
					].join("\n"),
					{ round: maxV },
					{
						decisions: [`halted after ${maxV}/${maxV} validations`],
						claims: [
							{
								statement: "The acceptance gate passed.",
								status: "rejected",
								source_role: "validator",
								evidence: [...(lastValidationId ? [`envelope:${lastValidationId}`] : []), `artifact:gate-round-${maxV}.txt`],
								validated_by: "gate",
							},
						],
					},
				);
				await save(
					artifactsDir,
					"summary.json",
					JSON.stringify(
						{ command: "auto-validate", ok: false, halted: true, rounds: maxV, maxValidations: maxV, escalateAt, gateExitCode: lastGate?.code, agents: [toStat(validator), toStat(builder)], sessions: { architect: cachedRoleId("architect"), builder: cachedRoleId("builder") }, ...totals([validator, builder], startedAt) },
						null,
						2,
					),
				);
			} finally {
				stopper.release(); // never leave the escape tap installed past the command
				stopWidget();
				icmRuns.delete(artifactsDir);
				icmRetrievals.delete(artifactsDir);
				ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			}
		},
	});

	// ── 8.14 /opinion <prompt> ─────────────────────────────────
	pi.registerCommand("opinion", {
		description: "Both models answer independently — side-by-side two-column panel (model · latency · tokens · cost). No fusion.",
		handler: async (raw, ctx) => {
			const prompt = (raw ?? "").trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /opinion <prompt>", "warning");
				return;
			}
			const aModel = architectModel();
			const bModel = builderModel();
			const startedAt = Date.now();
			const artifactsDir = await mkArtifacts();
			await save(artifactsDir, "prompt.md", prompt);

			panel({ kind: "prompt", command: "opinion", ok: true }, `/opinion ${prompt}`);
			const architect = newRun("ARCHITECT", aModel);
			const builder = newRun("BUILDER", bModel);
			const stopper = startStoppable(ctx, "opinion");
			const stopWidget = startWidget(ctx, "opinion", [architect, builder], undefined, startedAt);
			ctx.ui.setStatus(CUSTOM_TYPE, "opinion: both models answering…");
			const icm = icmStart("opinion", artifactsDir, ctx.cwd);
			await icmBrief(
				icm,
				prompt,
				[
					{ role: "ARCHITECT", model: aModel, thinking: roleThinking("architect") },
					{ role: "BUILDER", model: bModel, thinking: roleThinking("builder") },
				],
				{ decisions: ["no merge — /opinion is an A/B read"] },
			);

			try {
				// Both agents answer the same prompt in parallel — read/bash tools only (an A/B read, not a build).
				await Promise.all([
					runChild({
						run: architect,
						prompt: opinionPrompt(prompt),
						systemPrompt: roleSystemPrompt("architect"),
						tools: OPINION_TOOLS,
						thinking: roleThinking("architect"),
						sessionDir: roleSession("architect", ctx.cwd).dir,
						sessionId: roleSession("architect", ctx.cwd).id,
						cwd: ctx.cwd,
						timeoutMs: childTimeoutMs(),
						signal: stopper.signal,
					}),
					runChild({
						run: builder,
						prompt: opinionPrompt(prompt),
						systemPrompt: roleSystemPrompt("builder"),
						tools: OPINION_TOOLS,
						thinking: roleThinking("builder"),
						...builderSpawn(ctx, artifactsDir),
						cwd: ctx.cwd,
						timeoutMs: childTimeoutMs(),
						signal: stopper.signal,
					}),
				]);

				if (stopper.stopped()) {
					await stoppedPanel("opinion", [architect, builder], artifactsDir, startedAt, "Both agents were killed; no comparison was rendered.");
					return;
				}

				for (const r of [architect, builder]) {
					await save(artifactsDir, `${r.role.toLowerCase()}.md`, runOk(r) ? r.text : `FAILED: ${runError(r)}`);
				}

				await icmRole(icm, "spec", "spec", architect, "architect.md");
				await icmRole(icm, "build", "build", builder, "builder.md");

				const ok = runOk(architect) && runOk(builder);
				const t = totals([architect, builder], startedAt);
				const fallback = [
					`# OPINION — ${prompt.replace(/\s+/g, " ").slice(0, 80)}`,
					``,
					`## ARCHITECT · ${aModel}`,
					runOk(architect) ? architect.text : `FAILED: ${runError(architect)}`,
					``,
					`## BUILDER · ${bModel}`,
					runOk(builder) ? builder.text : `FAILED: ${runError(builder)}`,
				].join("\n");
				panel(
					{
						kind: "opinion",
						command: "opinion",
						ok,
						prompt,
						sources: [toStat(architect), toStat(builder)],
						answers: [
							{ role: "ARCHITECT", model: aModel, text: runOk(architect) ? architect.text : "" },
							{ role: "BUILDER", model: bModel, text: runOk(builder) ? builder.text : "" },
						],
						artifactsDir,
						...t,
					},
					fallback,
				);
				await icmOutput(icm, ok ? "Two independent answers rendered side by side — no fusion, no promotion." : "The A/B read is incomplete: at least one agent failed.", {
					decisions: ["/opinion does not merge; both answers stay attributed to their role and model"],
					risks: [architect, builder].filter((r) => !runOk(r)).map((r) => `${r.role} (${r.model}) failed: ${runError(r)}`),
					artifacts: [
						{ path: "architect.md", type: "raw-report" },
						{ path: "builder.md", type: "raw-report" },
					],
				});
				await save(
					artifactsDir,
					"summary.json",
					JSON.stringify(
						{ command: "opinion", ok, agents: [toStat(architect), toStat(builder)], sessions: { architect: cachedRoleId("architect"), builder: cachedRoleId("builder") }, ...t },
						null,
						2,
					),
				);
			} finally {
				stopper.release(); // never leave the escape tap installed past the command
				stopWidget();
				icmRuns.delete(artifactsDir);
				icmRetrievals.delete(artifactsDir);
				ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			}
		},
	});

	// ── 8.15 ICM Phase 3 — /icm-promote and /icm-context (manual, validation-backed promotion) ──
	// Promotion is the ONLY path from a run's /tmp envelopes to durable context, and it is always a
	// human act: the user names the run dir. Eligibility is decided by evidence (icm/promote.ts):
	// an /auto-validate output whose gate PASSED, with the chain output → validation → gate output
	// re-verified, and no secrets in anything copied. The store is a user-level cache — never the
	// repo — at --icm-context-dir / $FUSION_ICM_CONTEXT_DIR / ~/.fusion/context. Nothing here is
	// read back into any prompt yet (retrieval is Phase 4).
	const icmPanel = (command: "icm-promote" | "icm-context", ok: boolean, body: string) => panel({ kind: "icm", command, ok }, body);
	const promotionLine = (e: { id: string; status: string; repository: string | null; branch: string | null; commit: string | null; promoted_at: string; summary: string; supersedes: string | null }) =>
		`- \`${e.id}\` **${e.status}** · ${e.repository ?? "no repository"}${e.branch ? `@${e.branch}` : ""}${e.commit ? ` (${e.commit.slice(0, 10)})` : ""} · ${e.promoted_at}${e.supersedes ? ` · supersedes ${e.supersedes}` : ""}\n  ${e.summary.replace(/\s+/g, " ").slice(0, 160)}`;

	pi.registerCommand("icm-promote", {
		description: "ICM: promote one run's gate-validated output to durable context (manual) — /icm-promote <run-dir> [--supersedes ctx_…] [--note text]; /icm-promote --assess <run-dir> only reports eligibility",
		handler: async (raw, ctx) => {
			let input = (raw ?? "").trim();
			let supersedes: string | undefined;
			let note: string | undefined;
			let assessOnly = false;
			input = input
				.replace(/--supersedes[=\s]+(ctx_[0-9A-HJKMNP-TV-Z]{26})\s*/g, (_m, id) => ((supersedes = id), ""))
				.replace(/--note[=\s]+("[^"]*"|'[^']*'|\S+)\s*/g, (_m, n) => ((note = n.replace(/^["']|["']$/g, "")), ""))
				.replace(/--assess\s*/g, () => ((assessOnly = true), ""))
				.trim();
			if (!input) {
				ctx.ui.notify("Usage: /icm-promote [--assess] <run-dir> [--supersedes ctx_…] [--note text]", "warning");
				return;
			}
			const runDir = path.resolve(ctx.cwd, input);
			const contextDir = icmContextDir();
			panel({ kind: "prompt", command: "icm-promote", ok: true }, `/icm-promote ${(raw ?? "").trim()}`);
			if (assessOnly) {
				const a = await assessRun(runDir);
				icmPanel(
					"icm-promote",
					a.eligible,
					a.eligible
						? `**Eligible.** ${runDir} → output \`${a.output?.envelope.id}\` (gate PASS via \`${a.validation?.envelope.id}\`, ${a.gateOutput?.path}). ${a.artifacts.length} artifact(s), ${a.lineage.length} lineage envelope(s).\n\nPromote with \`/icm-promote ${runDir}\` → ${contextDir}`
						: `**Not eligible.**\n${a.reasons.map((r) => `- ${r}`).join("\n")}`,
				);
				return;
			}
			const r = await promoteRun(runDir, { contextDir, approvedBy: "user", note, supersedes });
			if (r.ok) {
				icmPanel(
					"icm-promote",
					true,
					[
						`**Promoted** \`${r.id}\` → ${r.dest}`,
						`- status: **validated** (approved by user, ${r.entry.promoted_at})${r.entry.supersedes ? ` · supersedes \`${r.entry.supersedes}\` (now superseded)` : ""}`,
						`- evidence: output → \`${r.assessment.validation?.envelope.id}\` → ${r.assessment.gateOutput?.path} (exit 0); ${r.assessment.artifacts.length} artifact(s) copied, hashes re-checked`,
						`- lineage kept as draft: ${r.assessment.lineage.join(", ")}`,
						`- index: ${path.join(contextDir, "index.json")} · browse with \`/icm-context list\``,
					].join("\n"),
				);
			} else {
				icmPanel("icm-promote", false, `**Not promoted** — ${runDir}\n${r.reasons.map((x) => `- ${x}`).join("\n")}\n\nNothing was written to ${contextDir}.`);
			}
		},
	});

	pi.registerCommand("icm-context", {
		description: "ICM: browse durable context — /icm-context list [validated|superseded|rejected] · show <ctx_id> · retract <ctx_id> <reason>. Nothing is deleted, ever.",
		handler: async (raw, ctx) => {
			const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "list";
			const contextDir = icmContextDir();
			panel({ kind: "prompt", command: "icm-context", ok: true }, `/icm-context ${(raw ?? "").trim()}`);
			try {
				if (sub === "list") {
					const status = parts[1] as "validated" | "superseded" | "rejected" | undefined;
					if (status && !["validated", "superseded", "rejected"].includes(status)) throw new Error(`unknown status filter ${status}`);
					const entries = await listContext(contextDir, { status });
					icmPanel("icm-context", true, entries.length ? `**${entries.length} promoted output(s)${status ? ` (${status})` : ""}** in ${contextDir}\n${entries.map(promotionLine).join("\n")}` : `No promoted context${status ? ` with status ${status}` : ""} in ${contextDir}. Promote a gate-PASS run with \`/icm-promote <run-dir>\`.`);
				} else if (sub === "show" && parts[1]) {
					const s = await showContext(contextDir, parts[1]);
					if (!s) icmPanel("icm-context", false, `No promoted output ${parts[1]} in ${contextDir}.`);
					else icmPanel("icm-context", s.entry.status === "validated", `${promotionLine(s.entry)}\n\n**Envelope** (${path.join(contextDir, s.entry.path, "output.json")})\n\`\`\`json\n${truncateChars(JSON.stringify(s.envelope, null, 2), DETAIL_SNIPPET_MAX * 2)}\n\`\`\`\n**Promotion record**\n\`\`\`json\n${truncateChars(JSON.stringify(s.record, null, 2), DETAIL_SNIPPET_MAX)}\n\`\`\``);
				} else if (sub === "retract" && parts[1]) {
					const r = await retractContext(contextDir, parts[1], parts.slice(2).join(" "));
					icmPanel("icm-context", r.ok, r.ok ? `**Retracted** \`${parts[1]}\` → status rejected (files kept at ${path.join(contextDir, r.entry.path)}).` : `**Not retracted**\n${r.reasons.map((x) => `- ${x}`).join("\n")}`);
				} else {
					ctx.ui.notify("Usage: /icm-context list [validated|superseded|rejected] | show <ctx_id> | retract <ctx_id> <reason>", "warning");
				}
			} catch (err) {
				icmPanel("icm-context", false, `**ICM context error** — ${String(err)}`);
			}
		},
	});
}
