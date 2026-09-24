/**
 * ICM Phase 3 — validation-backed promotion to durable context.
 *
 * The central rule (FUSION_ICM_PLAN.md §4): only context that is attributable, scoped, and
 * VALIDATED becomes durable shared context. This module is the only code that writes outside a
 * run's /tmp dir, and it writes to exactly one place: the context dir (see `defaultContextDir`).
 *
 * Provisional Phase 0 decisions (AGENTS.md lists these as human-decision stops; the user said
 * "proceed", so the smallest reversible choices were taken and are documented here and in
 * ICM_IMPLEMENTATION_NOTES.md — every one is a flag/env/function argument away from changing):
 *   - LOCATION: a USER-LEVEL CACHE, `~/.fusion/context` (env FUSION_ICM_CONTEXT_DIR or the
 *     --icm-context-dir flag override). Never the repository, never shared infrastructure.
 *   - APPROVAL: promotion is ALWAYS a manual human act — the user runs `/icm-promote <run-dir>`.
 *     Nothing promotes automatically, for any scope.
 *   - ELIGIBILITY: only an `/auto-validate` output whose gate PASSED, proven by an evidence chain
 *     that resolves inside the run (output → validation envelope → gate-output artifact whose
 *     first line is `exit 0`), with every envelope re-validated and every artifact re-hashed.
 *     `/fusion` and `/opinion` outputs are never promotable: no independent evidence.
 *   - SECRETS: rejected, not redacted — if anything to be copied still matches a secret pattern,
 *     the promotion is refused.
 *   - RETENTION/DELETION: nothing is deleted by this code. `retract` marks an entry `rejected`;
 *     `supersedes` marks the older entry `superseded`. Files stay for audit; the user owns deletion.
 *
 * What lands in the context dir per promotion:
 *   <contextDir>/<repo-slug>/<task_id>/output.json        the promoted envelope, status "validated"
 *   <contextDir>/<repo-slug>/<task_id>/lineage/*.json     the run's other envelopes, verbatim (still draft)
 *   <contextDir>/<repo-slug>/<task_id>/artifacts/*        the hashed artifacts the chain cites
 *   <contextDir>/<repo-slug>/<task_id>/promotion.json     who/when/from-where, hashes, supersedes, retraction
 *   <contextDir>/index.json                               ONLY promoted outputs — lineage drafts are never indexed
 * Retrieval (Phase 4) must read the index and filter status === "validated".
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ArtifactRef, type ContextEnvelope, type IcmManifest, MANIFEST_FILE, nowIso, redactSecrets, sha256File, validateEnvelope } from "./envelope.ts";
import { readEnvelope } from "./handoff.ts";

export const CONTEXT_DIR_ENV = "FUSION_ICM_CONTEXT_DIR";
export const INDEX_FILE = "index.json";
export const PROMOTION_FILE = "promotion.json";

/** The durable context dir: $FUSION_ICM_CONTEXT_DIR, else ~/.fusion/context. Never inside a repo by default. */
export function defaultContextDir(): string {
	const env = process.env[CONTEXT_DIR_ENV]?.trim();
	return env || path.join(os.homedir(), ".fusion", "context");
}

export interface IndexEntry {
	id: string;
	kind: "output";
	status: "validated" | "superseded" | "rejected";
	command: string;
	task_id: string;
	run_id: string;
	repository: string | null;
	branch: string | null;
	commit: string | null;
	summary: string;
	promoted_at: string;
	approved_by: string;
	path: string; // dir relative to contextDir
	supersedes: string | null;
}

export interface ContextIndex {
	schema_version: "1.0";
	entries: IndexEntry[];
}

export interface PromotionRecord {
	id: string;
	task_id: string;
	run_id: string;
	source_run_dir: string;
	promoted_at: string;
	approved_by: string;
	note: string | null;
	supersedes: string | null;
	artifacts: ArtifactRef[];
	lineage: string[]; // envelope files copied verbatim
	evidence_chain: string[]; // output id → validation id → gate-output artifact
	retracted: { at: string; reason: string } | null;
	superseded_by: string | null;
}

export interface Assessment {
	eligible: boolean;
	reasons: string[]; // why NOT eligible (empty when eligible)
	runDir: string;
	manifest?: IcmManifest;
	output?: { file: string; envelope: ContextEnvelope };
	validation?: { file: string; envelope: ContextEnvelope };
	gateOutput?: ArtifactRef;
	artifacts: ArtifactRef[]; // everything the chain cites, deduped, hashes verified
	lineage: string[]; // the other envelope files in the run
}

const readJson = async (p: string): Promise<unknown> => JSON.parse(await fs.promises.readFile(p, "utf-8"));

/**
 * Decide whether a run's output may be promoted. Pure read; never writes. Every reason is
 * reported, not just the first, so the user sees the whole picture.
 */
export async function assessRun(runDir: string): Promise<Assessment> {
	const reasons: string[] = [];
	const a: Assessment = { eligible: false, reasons, runDir, artifacts: [], lineage: [] };
	let manifest: IcmManifest;
	try {
		manifest = (await readJson(path.join(runDir, MANIFEST_FILE))) as IcmManifest;
	} catch (err) {
		reasons.push(`no readable ${MANIFEST_FILE} in ${runDir}: ${String(err)}`);
		return a;
	}
	a.manifest = manifest;
	if (manifest.command !== "auto-validate") {
		reasons.push(`/${manifest.command} outputs carry no independent evidence (a fusion agent must not certify its own output); only /auto-validate runs are promotable`);
	}
	const rejected = manifest.envelopes.filter((e) => !e.ok);
	if (rejected.length) reasons.push(`run has rejected envelope(s): ${rejected.map((e) => e.file).join(", ")}`);

	const outEntry = manifest.envelopes.find((e) => e.kind === "output" && e.ok);
	if (!outEntry) {
		reasons.push("run has no valid output envelope");
		return a;
	}
	const expect = { run_id: manifest.run_id };
	const out = await readEnvelope(path.join(runDir, outEntry.file), { runDir, expect });
	if (!out.ok || !out.envelope) {
		reasons.push(`${outEntry.file} failed verification: ${out.errors.join("; ")}`);
		return a;
	}
	a.output = { file: out.file, envelope: out.envelope };
	if (out.envelope.status !== "draft") reasons.push(`${outEntry.file} is already ${out.envelope.status}; only a draft run output can be promoted`);

	// The evidence chain: a gate-validated claim on the output → a validation envelope in this run.
	const gateClaims = out.envelope.claims.filter((c) => c.status === "validated" && c.validated_by === "gate");
	if (!gateClaims.length) reasons.push("output has no claim validated by the gate (the gate did not pass, or the run halted/stopped)");
	const valId = gateClaims.flatMap((c) => c.evidence).find((e) => e.startsWith("envelope:"))?.slice("envelope:".length);
	const valEntry = valId ? manifest.envelopes.find((e) => e.id === valId && e.ok) : undefined;
	if (gateClaims.length && !valEntry) reasons.push("the output's gate claim cites no validation envelope from this run");
	if (valEntry) {
		if (valEntry.kind !== "validation") reasons.push(`the output's gate claim cites ${valEntry.file}, which is a ${valEntry.kind}, not a validation`);
		const val = await readEnvelope(path.join(runDir, valEntry.file), { runDir, expect });
		if (!val.ok || !val.envelope) reasons.push(`${valEntry.file} failed verification: ${val.errors.join("; ")}`);
		else {
			a.validation = { file: val.file, envelope: val.envelope };
			const passed = val.envelope.claims.some((c) => c.status === "validated" && c.validated_by === "gate" && c.statement === "The acceptance gate passed.");
			if (!passed) reasons.push(`${valEntry.file} does not record a passed gate`);
			const gateOut = val.envelope.artifacts.find((x) => x.type === "gate-output");
			if (!gateOut) reasons.push(`${valEntry.file} references no gate-output artifact`);
			else {
				a.gateOutput = gateOut;
				try {
					const first = (await fs.promises.readFile(path.join(runDir, gateOut.path), "utf-8")).split(/\r?\n/)[0].trim();
					if (first !== "exit 0") reasons.push(`gate output ${gateOut.path} records "${first}", not "exit 0"`);
				} catch {
					reasons.push(`gate output ${gateOut.path} is unreadable`);
				}
			}
		}
	}

	// Artifacts to carry: everything the output and the validation cite (hashes already verified by readEnvelope).
	const seen = new Map<string, ArtifactRef>();
	for (const ref of [...(a.output?.envelope.artifacts ?? []), ...(a.validation?.envelope.artifacts ?? [])]) {
		if (path.isAbsolute(ref.path) || ref.path.split(/[\\/]/).includes("..")) {
			reasons.push(`artifact path ${ref.path} is not a plain run-relative path; refusing to copy it`);
			continue;
		}
		seen.set(ref.path, ref);
	}
	a.artifacts = [...seen.values()];

	// Secrets: rejected, never silently persisted. Envelope text was redacted at emit time;
	// artifacts were not (they lived only in /tmp) — check them now.
	for (const ref of a.artifacts) {
		try {
			const text = await fs.promises.readFile(path.join(runDir, ref.path), "utf-8");
			if (redactSecrets(text) !== text) reasons.push(`artifact ${ref.path} contains what looks like a secret; promotion refused (redact at the source and re-run)`);
		} catch {
			reasons.push(`artifact ${ref.path} is unreadable`);
		}
	}
	for (const env of [a.output, a.validation]) {
		if (!env) continue;
		const text = await fs.promises.readFile(env.file, "utf-8");
		if (redactSecrets(text) !== text) reasons.push(`${path.basename(env.file)} contains what looks like a secret; promotion refused`);
	}

	a.lineage = manifest.envelopes.filter((e) => e.ok && e.file !== outEntry.file).map((e) => e.file);
	a.eligible = reasons.length === 0;
	return a;
}

// ═══ Index ═══

export async function loadIndex(contextDir: string): Promise<ContextIndex> {
	try {
		const idx = (await readJson(path.join(contextDir, INDEX_FILE))) as ContextIndex;
		if (idx?.schema_version !== "1.0" || !Array.isArray(idx.entries)) throw new Error("unexpected index shape");
		return idx;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { schema_version: "1.0", entries: [] };
		throw new Error(`${path.join(contextDir, INDEX_FILE)} is unreadable: ${String(err)}`);
	}
}

async function saveIndex(contextDir: string, idx: ContextIndex): Promise<void> {
	await fs.promises.mkdir(contextDir, { recursive: true });
	await fs.promises.writeFile(path.join(contextDir, INDEX_FILE), `${JSON.stringify(idx, null, 2)}\n`, "utf-8");
}

export const repoSlug = (repository: string | null): string => (repository ? repository.replace(/[^A-Za-z0-9._-]+/g, "_") : "no-repository");

// ═══ Promote ═══

export interface PromoteOptions {
	contextDir: string;
	approvedBy?: string; // "user" — the human who ran /icm-promote
	note?: string;
	supersedes?: string; // a previously promoted output id this one replaces
}

export type PromoteResult = { ok: true; id: string; dest: string; entry: IndexEntry; assessment: Assessment } | { ok: false; reasons: string[]; assessment?: Assessment };

/** Promote one run's output. Assesses first; writes nothing unless everything holds. */
export async function promoteRun(runDir: string, opts: PromoteOptions): Promise<PromoteResult> {
	const assessment = await assessRun(runDir);
	if (!assessment.eligible || !assessment.output || !assessment.manifest) return { ok: false, reasons: assessment.reasons, assessment };
	const { manifest, output } = assessment;
	const contextDir = path.resolve(opts.contextDir);
	const idx = await loadIndex(contextDir);

	const dup = idx.entries.find((e) => e.run_id === manifest.run_id || e.id === output.envelope.id);
	if (dup) return { ok: false, reasons: [`already promoted as ${dup.id} (${dup.status}) at ${path.join(contextDir, dup.path)}`], assessment };
	let old: IndexEntry | undefined;
	if (opts.supersedes) {
		old = idx.entries.find((e) => e.id === opts.supersedes);
		if (!old) return { ok: false, reasons: [`--supersedes ${opts.supersedes}: no such promoted output in ${contextDir}`], assessment };
		if (old.status !== "validated") return { ok: false, reasons: [`--supersedes ${opts.supersedes}: that entry is ${old.status}, not validated`], assessment };
	}

	const rel = path.join(repoSlug(manifest.scope.repository), manifest.task_id);
	const dest = path.join(contextDir, rel);
	if (fs.existsSync(dest)) return { ok: false, reasons: [`${dest} already exists; refusing to overwrite`], assessment };

	// Build the promoted envelope: same id (identity), lifecycle → validated, explicit supersedes.
	const promoted: ContextEnvelope = { ...output.envelope, status: "validated", supersedes: old?.id ?? output.envelope.supersedes };
	const v = validateEnvelope(promoted);
	if (!v.ok) return { ok: false, reasons: v.errors.map((e) => `promoted envelope invalid: ${e}`), assessment };

	// Stage everything in memory / verify before the first write.
	const copies: Array<{ from: string; to: string; sha256: string }> = [];
	for (const ref of assessment.artifacts) {
		const from = path.join(runDir, ref.path);
		if ((await sha256File(from)) !== ref.sha256) return { ok: false, reasons: [`artifact ${ref.path} changed during promotion`], assessment };
		copies.push({ from, to: path.join(dest, "artifacts", ref.path), sha256: ref.sha256 });
	}
	const lineage: Array<{ from: string; to: string }> = assessment.lineage.map((f) => ({ from: path.join(runDir, f), to: path.join(dest, "lineage", f) }));

	const promotedAt = nowIso();
	const record: PromotionRecord = {
		id: promoted.id,
		task_id: manifest.task_id,
		run_id: manifest.run_id,
		source_run_dir: runDir,
		promoted_at: promotedAt,
		approved_by: opts.approvedBy ?? "user",
		note: opts.note?.trim() || null,
		supersedes: old?.id ?? null,
		artifacts: assessment.artifacts,
		lineage: assessment.lineage,
		evidence_chain: [`envelope:${promoted.id}`, ...(assessment.validation ? [`envelope:${assessment.validation.envelope.id}`] : []), ...(assessment.gateOutput ? [`artifact:${assessment.gateOutput.path}`] : [])],
		retracted: null,
		superseded_by: null,
	};

	// Write.
	await fs.promises.mkdir(path.join(dest, "artifacts"), { recursive: true });
	await fs.promises.mkdir(path.join(dest, "lineage"), { recursive: true });
	for (const c of copies) {
		await fs.promises.mkdir(path.dirname(c.to), { recursive: true });
		await fs.promises.copyFile(c.from, c.to);
		if ((await sha256File(c.to)) !== c.sha256) throw new Error(`copy of ${c.from} does not hash to the recorded value`);
	}
	for (const l of lineage) await fs.promises.copyFile(l.from, l.to);
	await fs.promises.writeFile(path.join(dest, "output.json"), `${JSON.stringify(promoted, null, 2)}\n`, "utf-8");
	await fs.promises.writeFile(path.join(dest, PROMOTION_FILE), `${JSON.stringify(record, null, 2)}\n`, "utf-8");

	if (old) {
		old.status = "superseded";
		await patchStored(contextDir, old, { status: "superseded" }, { superseded_by: promoted.id });
	}
	const entry: IndexEntry = {
		id: promoted.id,
		kind: "output",
		status: "validated",
		command: manifest.command,
		task_id: manifest.task_id,
		run_id: manifest.run_id,
		repository: manifest.scope.repository,
		branch: manifest.scope.branch,
		commit: manifest.scope.commit,
		summary: promoted.summary,
		promoted_at: promotedAt,
		approved_by: record.approved_by,
		path: rel,
		supersedes: record.supersedes,
	};
	idx.entries.push(entry);
	await saveIndex(contextDir, idx);
	return { ok: true, id: promoted.id, dest, entry, assessment };
}

/** Update a stored promotion's envelope status and promotion record in place (never deletes). */
async function patchStored(contextDir: string, entry: IndexEntry, envPatch: Partial<ContextEnvelope>, recPatch: Partial<PromotionRecord>): Promise<void> {
	const dir = path.join(contextDir, entry.path);
	const envPath = path.join(dir, "output.json");
	const recPath = path.join(dir, PROMOTION_FILE);
	const env = { ...((await readJson(envPath)) as ContextEnvelope), ...envPatch };
	const rec = { ...((await readJson(recPath)) as PromotionRecord), ...recPatch };
	await fs.promises.writeFile(envPath, `${JSON.stringify(env, null, 2)}\n`, "utf-8");
	await fs.promises.writeFile(recPath, `${JSON.stringify(rec, null, 2)}\n`, "utf-8");
}

// ═══ Browse / retract ═══

export async function listContext(contextDir: string, filter: { status?: IndexEntry["status"]; repository?: string | null } = {}): Promise<IndexEntry[]> {
	const idx = await loadIndex(path.resolve(contextDir));
	return idx.entries.filter((e) => (filter.status ? e.status === filter.status : true) && (filter.repository !== undefined ? e.repository === filter.repository : true));
}

export async function showContext(contextDir: string, id: string): Promise<{ entry: IndexEntry; envelope: ContextEnvelope; record: PromotionRecord } | undefined> {
	const root = path.resolve(contextDir);
	const entry = (await loadIndex(root)).entries.find((e) => e.id === id);
	if (!entry) return undefined;
	const dir = path.join(root, entry.path);
	return { entry, envelope: (await readJson(path.join(dir, "output.json"))) as ContextEnvelope, record: (await readJson(path.join(dir, PROMOTION_FILE))) as PromotionRecord };
}

/** Mark a promoted output rejected (with a reason). Files stay; only status changes. */
export async function retractContext(contextDir: string, id: string, reason: string): Promise<{ ok: true; entry: IndexEntry } | { ok: false; reasons: string[] }> {
	const root = path.resolve(contextDir);
	const idx = await loadIndex(root);
	const entry = idx.entries.find((e) => e.id === id);
	if (!entry) return { ok: false, reasons: [`no promoted output ${id} in ${root}`] };
	if (entry.status === "rejected") return { ok: false, reasons: [`${id} is already rejected`] };
	if (!reason.trim()) return { ok: false, reasons: ["a retraction needs a reason"] };
	entry.status = "rejected";
	await patchStored(root, entry, { status: "rejected" }, { retracted: { at: nowIso(), reason: reason.trim() } });
	await saveIndex(root, idx);
	return { ok: true, entry };
}
