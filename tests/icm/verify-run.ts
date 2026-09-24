/**
 * Verify the ICM envelopes of one real Fusion Harness run directory.
 *
 *   node tests/icm/verify-run.ts /tmp/fusion-harness-XXXXXX
 *   just icm-verify /tmp/fusion-harness-XXXXXX
 *
 * Checks, per AGENTS.md "test that every expected artifact is emitted for the selected workflow":
 *   1. icm-manifest.json exists and names the command
 *   2. every envelope file in the manifest exists, parses, and validates against ContextEnvelope v1
 *   3. every referenced artifact exists and its SHA-256 still matches
 *   4. every `envelope:` evidence reference and `supersedes` points at an id emitted in this run
 *   5. the expected kinds for the command are present (brief, spec, build, output; validation for /auto-validate)
 *   6. no *.rejected.json is present
 *   7. (Phase 2) every validation envelope whose gate output has PASS:/FAIL: lines carries them as
 *      gate-validated claims — the structured diagnostics a correction round consumes
 * Exit 0 iff everything holds. Prints one line per check.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MANIFEST_FILE, sha256File, validateEnvelope, type IcmManifest } from "../../extensions/fusion-harness/icm/envelope.ts";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: node tests/icm/verify-run.ts <run-dir>");
	process.exit(2);
}

let failures = 0;
const pass = (msg: string) => console.log(`PASS: ${msg}`);
const fail = (msg: string) => {
	failures++;
	console.log(`FAIL: ${msg}`);
};

const manifestPath = path.join(dir, MANIFEST_FILE);
if (!fs.existsSync(manifestPath)) {
	fail(`${MANIFEST_FILE} missing in ${dir}`);
	process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as IcmManifest;
pass(`${MANIFEST_FILE} present — command /${manifest.command}, ${manifest.envelopes.length} envelope(s)`);

const ids = new Set<string>();
const kinds = new Set<string>();
for (const e of manifest.envelopes) {
	const p = path.join(dir, e.file);
	if (!fs.existsSync(p)) {
		fail(`${e.file} listed in manifest but missing`);
		continue;
	}
	if (e.file.endsWith(".rejected.json")) {
		fail(`${e.file} — envelope was rejected: ${(e.errors ?? []).join("; ")}`);
		continue;
	}
	const env = JSON.parse(fs.readFileSync(p, "utf-8"));
	const v = validateEnvelope(env);
	if (!v.ok) {
		fail(`${e.file} does not validate: ${v.errors.join("; ")}`);
		continue;
	}
	if (env.id !== e.id) fail(`${e.file} id ${env.id} != manifest id ${e.id}`);
	if (env.scope.run_id !== manifest.run_id) fail(`${e.file} run_id mismatch`);
	if (env.status !== "draft") fail(`${e.file} status is ${env.status}; Phases 1–2 emit draft only (promotion is Phase 3)`);
	ids.add(env.id);
	kinds.add(env.kind);
	pass(`${e.file} — valid ${env.kind} from ${env.producer.role} (${env.producer.model})`);
	for (const a of env.artifacts as Array<{ path: string; sha256: string }>) {
		const ap = path.isAbsolute(a.path) ? a.path : path.join(dir, a.path);
		if (!fs.existsSync(ap)) {
			fail(`${e.file} → artifact ${a.path} missing`);
			continue;
		}
		const h = await sha256File(ap);
		if (h === a.sha256) pass(`${e.file} → ${a.path} sha256 matches`);
		else fail(`${e.file} → ${a.path} sha256 ${h.slice(0, 12)}… != recorded ${a.sha256.slice(0, 12)}…`);
	}
}

// Cross-references must resolve within the run.
for (const e of manifest.envelopes) {
	if (!e.ok) continue;
	const env = JSON.parse(fs.readFileSync(path.join(dir, e.file), "utf-8"));
	for (const c of env.claims as Array<{ evidence: string[] }>) {
		for (const ev of c.evidence) {
			if (ev.startsWith("envelope:")) {
				const ref = ev.slice("envelope:".length);
				if (ids.has(ref)) pass(`${e.file} evidence ${ev} resolves`);
				else fail(`${e.file} evidence ${ev} does not resolve to an envelope in this run`);
			} else if (ev.startsWith("artifact:")) {
				const ap = path.join(dir, ev.slice("artifact:".length));
				if (fs.existsSync(ap)) pass(`${e.file} evidence ${ev} exists`);
				else fail(`${e.file} evidence ${ev} missing`);
			}
		}
	}
	if (env.supersedes) {
		if (ids.has(env.supersedes)) pass(`${e.file} supersedes ${env.supersedes} (present)`);
		else fail(`${e.file} supersedes ${env.supersedes}, which is not in this run`);
	}
}

// Phase 2: a validation envelope must carry the gate's PASS:/FAIL: lines as claims.
for (const e of manifest.envelopes) {
	if (!e.ok || e.kind !== "validation") continue;
	const env = JSON.parse(fs.readFileSync(path.join(dir, e.file), "utf-8"));
	const gateOut = (env.artifacts as Array<{ path: string; type: string }>).find((a) => a.type === "gate-output");
	if (!gateOut) continue; // triage envelopes carry no gate output
	const text = fs.readFileSync(path.join(dir, gateOut.path), "utf-8");
	const lines = text.split(/\r?\n/).filter((l) => /^\W{0,3}(PASS|FAIL)\s*:/.test(l.trim()));
	const claims = (env.claims as Array<{ statement: string; validated_by: string | null }>).filter((c) => c.validated_by === "gate" && /^(PASS|FAIL): /.test(c.statement));
	if (lines.length === 0) pass(`${e.file} — gate output has no PASS:/FAIL: lines to structure`);
	else if (claims.length === Math.min(lines.length, 100)) pass(`${e.file} — ${claims.length} PASS/FAIL line(s) carried as gate-validated claims`);
	else fail(`${e.file} — gate output has ${lines.length} PASS/FAIL line(s) but the envelope carries ${claims.length} as claims`);
}

const expected: Record<string, string[]> = {
	opinion: ["brief", "spec", "build", "output"],
	fusion: ["brief", "spec", "build", "output"],
	"auto-validate": ["brief", "spec", "build", "validation", "output"],
};
for (const k of expected[manifest.command] ?? []) {
	if (kinds.has(k)) pass(`kind "${k}" emitted for /${manifest.command}`);
	else fail(`kind "${k}" expected for /${manifest.command} but not emitted`);
}

const rejected = fs.readdirSync(dir).filter((f) => f.endsWith(".rejected.json"));
if (rejected.length) fail(`rejected envelopes present: ${rejected.join(", ")}`);
else pass("no rejected envelopes");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
