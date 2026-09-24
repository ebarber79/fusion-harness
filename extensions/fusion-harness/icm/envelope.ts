/**
 * ICM ContextEnvelope v1 — Phase 1 (observe-only) primitives for Fusion Harness.
 *
 * What lives here:
 *   - TypeScript types for the envelope (mirroring context-envelope.v1.schema.json)
 *   - a runtime validation boundary that checks a value against the JSON schema file
 *     (the schema file is the source of truth; types alone are never trusted)
 *   - safe primitives: ULID-style ids, UTC timestamps, SHA-256 hashing, git scope capture,
 *     secret redaction for envelope text fields
 *   - `createIcmRun`: an emitter that writes schema-valid envelopes into one run's
 *     existing artifacts dir and never throws into the calling workflow
 *
 * Invariants (AGENTS.md):
 *   - envelopes are evidence, not instructions; everything emitted here is `draft`
 *   - raw model text is only ever referenced (hashed artifact) or excerpted, never
 *     promoted to truth
 *   - nothing is written outside the per-run artifacts dir
 *   - no dependency on pi packages, so `node --test` can exercise this module directly
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ═══ Types (mirror of the schema — the schema wins on any disagreement) ═══

export const SCHEMA_VERSION = "1.0";
export const SCHEMA_FILE = "context-envelope.v1.schema.json";

export type EnvelopeKind = "brief" | "spec" | "build" | "validation" | "output";
export type EnvelopeStatus = "draft" | "validated" | "rejected" | "superseded";
export type ProducerRole = "user" | "harness" | "architect" | "builder" | "validator" | "fusion" | "triage";
export type ClaimStatus = "proposed" | "validated" | "rejected";
export type ValidatedBy = "gate" | "validator" | "user" | null;
export type ArtifactType = "prompt" | "raw-report" | "gate-script" | "gate-output" | "fused-report" | "triage-report" | "other";

export interface Scope {
	repository: string | null;
	branch: string | null;
	commit: string | null;
	task_id: string;
	run_id: string;
}

export interface Producer {
	role: ProducerRole;
	model: string;
	created_at: string;
}

export interface Claim {
	statement: string;
	status: ClaimStatus;
	source_role: ProducerRole;
	evidence: string[]; // "artifact:<path>" | "envelope:<ctx id>" | "commit:<sha>"
	validated_by: ValidatedBy;
}

export interface ArtifactRef {
	path: string; // relative to the run dir
	type: ArtifactType;
	sha256: string;
}

export interface ContextEnvelope {
	schema_version: typeof SCHEMA_VERSION;
	id: string;
	kind: EnvelopeKind;
	status: EnvelopeStatus;
	scope: Scope;
	producer: Producer;
	summary: string;
	requirements: string[];
	decisions: string[];
	risks: string[];
	acceptance_criteria: string[];
	claims: Claim[];
	artifacts: ArtifactRef[];
	open_questions: string[];
	supersedes: string | null;
}

// ═══ Schema loading + runtime validation ═══

const MODULE_DIR: string =
	typeof __dirname !== "undefined" && __dirname ? __dirname : path.dirname(new URL(import.meta.url).pathname);

export const SCHEMA_PATH = path.join(MODULE_DIR, SCHEMA_FILE);

let schemaCache: Record<string, unknown> | undefined;
/** The JSON schema, read once from disk. A missing/corrupt schema is a loud error. */
export function loadSchema(): Record<string, unknown> {
	if (!schemaCache) schemaCache = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as Record<string, unknown>;
	return schemaCache;
}

type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
const jsonTypeOf = (v: unknown): JsonType =>
	v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : (typeof v as JsonType);

/**
 * A deliberately small JSON-schema (draft-07 subset) checker: type, const, enum, pattern,
 * minLength, required, properties, additionalProperties:false, items. That is every keyword
 * the v1 schema uses; anything else in a schema is an error here, not silently ignored.
 */
function check(schema: Record<string, unknown>, value: unknown, at: string, errors: string[]): void {
	const known = new Set(["$schema", "$id", "title", "description", "type", "const", "enum", "pattern", "minLength", "required", "properties", "additionalProperties", "items"]);
	for (const k of Object.keys(schema)) if (!known.has(k)) errors.push(`${at}: schema keyword "${k}" is not supported by this validator`);

	const actual = jsonTypeOf(value);
	if (schema.type !== undefined) {
		const allowed = (Array.isArray(schema.type) ? schema.type : [schema.type]) as JsonType[];
		const ok = allowed.some((t) => (t === "integer" ? actual === "number" && Number.isInteger(value) : t === actual));
		if (!ok) {
			errors.push(`${at}: expected ${allowed.join("|")}, got ${actual}`);
			return; // further keyword checks assume the right type
		}
	}
	if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);

	if (actual === "string") {
		const s = value as string;
		if (typeof schema.minLength === "number" && s.length < schema.minLength) errors.push(`${at}: shorter than minLength ${schema.minLength}`);
		if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(s)) errors.push(`${at}: ${JSON.stringify(s)} does not match ${schema.pattern}`);
	}
	if (actual === "object") {
		const obj = value as Record<string, unknown>;
		const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
		for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errors.push(`${at}: missing required "${r}"`);
		for (const [k, v] of Object.entries(obj)) {
			if (k in props) check(props[k], v, `${at}.${k}`, errors);
			else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property "${k}"`);
		}
	}
	if (actual === "array" && schema.items && typeof schema.items === "object") {
		(value as unknown[]).forEach((item, i) => check(schema.items as Record<string, unknown>, item, `${at}[${i}]`, errors));
	}
}

export interface ValidationResult {
	ok: boolean;
	errors: string[];
}

/** The runtime boundary: is this value a schema-valid ContextEnvelope v1? Never throws. */
export function validateEnvelope(value: unknown): ValidationResult {
	const errors: string[] = [];
	try {
		check(loadSchema(), value, "envelope", errors);
	} catch (err) {
		errors.push(`validator error: ${String(err)}`);
	}
	return { ok: errors.length === 0, errors };
}

// ═══ Primitives ═══

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-style id: 10 chars of ms-timestamp + 16 chars of randomness, Crockford base32, 26 chars. */
export function ulid(now: number = Date.now()): string {
	let t = now;
	let time = "";
	for (let i = 0; i < 10; i++) {
		time = CROCKFORD[t % 32] + time;
		t = Math.floor(t / 32);
	}
	const rnd = randomBytes(16);
	let rand = "";
	for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i] % 32];
	return time + rand;
}

export const newEnvelopeId = (): string => `ctx_${ulid()}`;
export const newTaskId = (): string => `task_${ulid()}`;
export const newRunId = (): string => `run_${ulid()}`;

/** UTC ISO-8601 with milliseconds and a trailing Z — the only timestamp shape the schema accepts. */
export const nowIso = (): string => new Date().toISOString();

export const sha256Text = (text: string): string => createHash("sha256").update(text, "utf-8").digest("hex");

export async function sha256File(filePath: string): Promise<string> {
	const buf = await fs.promises.readFile(filePath);
	return createHash("sha256").update(buf).digest("hex");
}

/** `git <args>` in cwd, trimmed stdout, or undefined on any failure (not a repo, no git, timeout). */
function git(cwd: string, args: string[]): string | undefined {
	try {
		const out = execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
		const s = out.trim();
		return s || undefined;
	} catch {
		return undefined;
	}
}

/** "git@github.com:o/r.git" | "https://github.com/o/r.git" → "github.com/o/r". Non-URL remotes pass through. */
export function normalizeRemote(url: string): string {
	let s = url.trim();
	s = s.replace(/^[a-z+]+:\/\//i, ""); // scheme
	s = s.replace(/^[^@/]+@/, ""); // user@
	s = s.replace(/^([^/:]+):(?!\/)/, "$1/"); // scp-style host:path
	s = s.replace(/\.git$/, "").replace(/\/+$/, "");
	return s;
}

/** Repository/branch/commit for the envelope scope — each independently null when unavailable. */
export function captureGitScope(cwd: string): Pick<Scope, "repository" | "branch" | "commit"> {
	const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (inside !== "true") return { repository: null, branch: null, commit: null };
	const remote = git(cwd, ["remote", "get-url", "origin"]);
	const branchRaw = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const commit = git(cwd, ["rev-parse", "HEAD"]);
	return {
		repository: remote ? normalizeRemote(remote) : null,
		branch: branchRaw && branchRaw !== "HEAD" ? branchRaw : null,
		commit: commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null,
	};
}

/**
 * Best-effort secret scrubbing for the short text fields an envelope carries. Envelopes
 * summarize prompts and model output, either of which can quote a key; the raw artifacts
 * keep whatever they had (they stay in the temp run dir), but the structured record must
 * not carry credentials. This is a pattern guard, not a classifier.
 */
export function redactSecrets(text: string): string {
	return text
		.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
		.replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
		.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
		.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]")
		.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED]")
		.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/g, "$1 [REDACTED]")
		// Generic `key=` / `token:` / `password =` pairs — only when the VALUE looks like a credential
		// literal: a quoted string of 8+ chars, or a bare token of 12+ [A-Za-z0-9_+/=-] chars. Code
		// such as `key = e.split(":", 1)[0]` or `secret = os.environ["X"]` is NOT a secret (a real
		// gate.py was refused promotion for exactly that line).
		.replace(/\b([A-Za-z_]*(?:key|token|secret|password|passwd)[A-Za-z_]*\s*[=:]\s*)(?:(["'])[^"'\s]{8,}\2|[A-Za-z0-9_+/=-]{12,})(?![A-Za-z0-9_+/=-])/gi, "$1[REDACTED]");
}

/** One-line excerpt of arbitrary text for `summary`: whitespace collapsed, capped, redacted. */
export function excerpt(text: string, max = 500): string {
	const one = redactSecrets(text).replace(/\s+/g, " ").trim();
	if (!one) return "(empty)";
	return one.length <= max ? one : `${one.slice(0, max)}… [${one.length - max} more chars in the referenced artifact]`;
}

// ═══ Run emitter ═══

export interface ArtifactInput {
	path: string; // relative to the run dir
	type: ArtifactType;
}

/** What a call site supplies; the emitter fills id, scope, timestamps, hashes, and validates. */
export interface EnvelopeInput {
	kind: EnvelopeKind;
	status?: EnvelopeStatus; // Phase 1: always "draft" (the default)
	producer: { role: ProducerRole; model: string };
	summary: string;
	requirements?: string[];
	decisions?: string[];
	risks?: string[];
	acceptance_criteria?: string[];
	claims?: Claim[];
	artifacts?: ArtifactInput[];
	open_questions?: string[];
	supersedes?: string | null;
}

export interface EmitResult {
	ok: boolean;
	id: string;
	file: string; // absolute path of what was written (…/<name>.json or …/<name>.rejected.json)
	errors: string[];
}

export interface ManifestEntry {
	file: string; // basename
	id: string;
	kind: EnvelopeKind;
	status: EnvelopeStatus;
	producer_role: ProducerRole;
	ok: boolean;
	errors?: string[];
}

export interface IcmManifest {
	schema_version: typeof SCHEMA_VERSION;
	command: string;
	task_id: string;
	run_id: string;
	scope: Scope;
	envelopes: ManifestEntry[];
}

export const MANIFEST_FILE = "icm-manifest.json";

export interface IcmRun {
	readonly runDir: string;
	readonly scope: Scope;
	readonly manifest: IcmManifest;
	/** Validate + write `<runDir>/<name>.json`. On any failure writes `<name>.rejected.json` instead. Never throws. */
	emit(name: string, input: EnvelopeInput): Promise<EmitResult>;
}

export interface IcmRunOptions {
	runDir: string; // the existing per-run artifacts dir — the ONLY place this module writes
	cwd: string; // the project the harness is running in (git scope is captured here)
	command: string; // "opinion" | "fusion" | "auto-validate" — recorded in the manifest
	taskId?: string;
	runId?: string;
}

const redactAll = (xs: string[] | undefined): string[] => (xs ?? []).map((s) => redactSecrets(String(s)));

export function createIcmRun(opts: IcmRunOptions): IcmRun {
	const scope: Scope = { ...captureGitScope(opts.cwd), task_id: opts.taskId ?? newTaskId(), run_id: opts.runId ?? newRunId() };
	const manifest: IcmManifest = { schema_version: SCHEMA_VERSION, command: opts.command, task_id: scope.task_id, run_id: scope.run_id, scope, envelopes: [] };
	const manifestPath = path.join(opts.runDir, MANIFEST_FILE);

	const writeManifest = async () => {
		await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8").catch(() => {});
	};

	const emit = async (name: string, input: EnvelopeInput): Promise<EmitResult> => {
		const id = newEnvelopeId();
		const safeName = name.replace(/[^A-Za-z0-9._-]+/g, "-");
		const okFile = path.join(opts.runDir, `${safeName}.json`);
		const badFile = path.join(opts.runDir, `${safeName}.rejected.json`);
		let envelope: Record<string, unknown> | undefined;
		let errors: string[] = [];
		try {
			// Artifact references: hash what is on disk NOW. A missing file is recorded as an
			// open question rather than an invented hash.
			const artifacts: ArtifactRef[] = [];
			const missing: string[] = [];
			for (const a of input.artifacts ?? []) {
				const abs = path.isAbsolute(a.path) ? a.path : path.join(opts.runDir, a.path);
				try {
					artifacts.push({ path: a.path, type: a.type, sha256: await sha256File(abs) });
				} catch {
					missing.push(`artifact not found at emit time: ${a.path}`);
				}
			}
			envelope = {
				schema_version: SCHEMA_VERSION,
				id,
				kind: input.kind,
				status: input.status ?? "draft",
				scope,
				producer: { role: input.producer.role, model: input.producer.model, created_at: nowIso() },
				summary: redactSecrets(String(input.summary ?? "")),
				requirements: redactAll(input.requirements),
				decisions: redactAll(input.decisions),
				risks: redactAll(input.risks),
				acceptance_criteria: redactAll(input.acceptance_criteria),
				claims: (input.claims ?? []).map((c) => ({
					statement: redactSecrets(String(c.statement ?? "")),
					status: c.status,
					source_role: c.source_role,
					evidence: [...(c.evidence ?? [])],
					validated_by: c.validated_by ?? null,
				})),
				artifacts,
				open_questions: [...redactAll(input.open_questions), ...missing],
				supersedes: input.supersedes ?? null,
			};
			const v = validateEnvelope(envelope);
			errors = v.errors;
			if (v.ok) {
				await fs.promises.writeFile(okFile, `${JSON.stringify(envelope, null, 2)}\n`, "utf-8");
			}
		} catch (err) {
			errors = [...errors, `emit error: ${String(err)}`];
		}
		if (errors.length) {
			// A malformed envelope fails CLEARLY (its own file, its errors listed) without
			// touching the user-facing workflow. The rejected payload is kept for diagnosis.
			await fs.promises
				.writeFile(badFile, `${JSON.stringify({ errors, envelope: envelope ?? null }, null, 2)}\n`, "utf-8")
				.catch(() => {});
		}
		const ok = errors.length === 0;
		manifest.envelopes.push({
			file: path.basename(ok ? okFile : badFile),
			id,
			kind: input.kind,
			status: (input.status ?? "draft") as EnvelopeStatus,
			producer_role: input.producer.role,
			ok,
			...(ok ? {} : { errors }),
		});
		await writeManifest();
		return { ok, id, file: ok ? okFile : badFile, errors };
	};

	return { runDir: opts.runDir, scope, manifest, emit };
}
