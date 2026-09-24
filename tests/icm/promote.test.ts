/**
 * Contract tests for ICM Phase 3 — validation-backed promotion.
 *
 * Run:  just icm-test
 *
 * Proven here (FUSION_ICM_PLAN.md §12 Phase 3 exit criterion: "no draft model handoff is
 * retrievable as accepted project context"):
 *   - only a gate-PASS /auto-validate output with a resolving evidence chain is eligible;
 *   - /fusion outputs, failed gates, tampered artifacts, secrets, rejected envelopes → refused;
 *   - a promotion copies artifacts and lineage verbatim (hash-checked), marks ONLY the output validated
 *     and ENRICHES it with the run's proven facts (gate PASS claims, acceptance criteria, the builder's
 *     proposed account, risks), indexes ONLY the output, and refuses duplicates/overwrites;
 *   - supersedes and retract change status, never delete;
 *   - the context dir honours the env override (tests never touch ~/.fusion).
 * No pi dependency.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { sha256Text } from "../../extensions/fusion-harness/icm/envelope.ts";
import { assessRun, CONTEXT_DIR_ENV, defaultContextDir, listContext, loadIndex, promoteRun, retractContext, showContext } from "../../extensions/fusion-harness/icm/promote.ts";
import { autoValidateRun, fusionRun, readJson, tmpDir, w } from "./helpers.ts";

describe("defaultContextDir", () => {
	it("honours the env override and otherwise lives under the home dir, outside any repo", () => {
		const prev = process.env[CONTEXT_DIR_ENV];
		process.env[CONTEXT_DIR_ENV] = "/tmp/icm-ctx-override";
		assert.equal(defaultContextDir(), "/tmp/icm-ctx-override");
		delete process.env[CONTEXT_DIR_ENV];
		assert.equal(defaultContextDir(), path.join(os.homedir(), ".fusion", "context"));
		if (prev !== undefined) process.env[CONTEXT_DIR_ENV] = prev;
	});
});

describe("assessRun", () => {
	it("accepts a gate-PASS /auto-validate run with a resolving evidence chain", async () => {
		const { runDir, outputId, validationId } = await autoValidateRun();
		const a = await assessRun(runDir);
		assert.deepEqual(a.reasons, []);
		assert.equal(a.eligible, true);
		assert.equal(a.output?.envelope.id, outputId);
		assert.equal(a.validation?.envelope.id, validationId);
		assert.equal(a.gateOutput?.path, "gate-round-1.txt");
		assert.deepEqual(a.artifacts.map((x) => x.path).sort(), ["builder-round-1.md", "gate-round-1.txt", "gate.py"]);
		assert.deepEqual(a.lineage, ["brief.json", "spec.json", "build-round-1.json", "validation-round-1.json"]);
	});
	it("refuses a /fusion run: no independent evidence", async () => {
		const a = await assessRun(await fusionRun());
		assert.equal(a.eligible, false);
		assert.ok(a.reasons.some((r) => r.includes("no independent evidence")));
	});
	it("refuses a failed gate", async () => {
		const { runDir } = await autoValidateRun({ gatePass: false });
		const a = await assessRun(runDir);
		assert.equal(a.eligible, false);
		assert.ok(a.reasons.some((r) => r.includes("no claim validated by the gate")));
	});
	it("refuses when a cited artifact was tampered with after the run", async () => {
		const { runDir } = await autoValidateRun();
		fs.appendFileSync(path.join(runDir, "gate-round-1.txt"), "\n# edited");
		const a = await assessRun(runDir);
		assert.equal(a.eligible, false);
		assert.ok(a.reasons.some((r) => r.includes("gate-round-1.txt changed since the envelope was written")));
	});
	it("refuses when the gate output does not record exit 0", async () => {
		const { runDir, icm } = await autoValidateRun();
		// Rewrite the artifact AND re-emit so hashes match but the verdict line is wrong.
		w(runDir, "gate-round-1.txt", "exit 3\n\nPASS: looks fine");
		const b = readJson(path.join(runDir, "build-round-1.json"));
		const v = await icm.emit("validation-round-2", { kind: "validation", producer: { role: "validator", model: "m" }, summary: "x", claims: [{ statement: "The acceptance gate passed.", status: "validated", source_role: "validator", evidence: ["artifact:gate-round-1.txt", `envelope:${b.id}`], validated_by: "gate" }], artifacts: [{ path: "gate-round-1.txt", type: "gate-output" }] });
		fs.unlinkSync(path.join(runDir, "output.json"));
		await icm.emit("output-2", { kind: "output", producer: { role: "harness", model: "h" }, summary: "PASS", claims: [{ statement: "The acceptance gate passed.", status: "validated", source_role: "validator", evidence: [`envelope:${v.id}`], validated_by: "gate" }], artifacts: [{ path: "gate-round-1.txt", type: "gate-output" }] });
		// The manifest now lists two outputs; the first file is gone → its entry still says ok, so assess picks it and fails verification.
		const a = await assessRun(runDir);
		assert.equal(a.eligible, false);
	});
	it("refuses secrets in a cited artifact — rejected, not redacted", async () => {
		const { runDir } = await autoValidateRun({ builderReport: "set OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123 and done" });
		const a = await assessRun(runDir);
		assert.equal(a.eligible, false);
		assert.ok(a.reasons.some((r) => r.includes("builder-round-1.md contains what looks like a secret")));
	});
	it("refuses a run that has a rejected envelope", async () => {
		const { runDir, icm } = await autoValidateRun();
		await icm.emit("triage-round-1", { kind: "validation", producer: { role: "triage", model: "m" }, summary: "" } as never); // invalid → .rejected.json
		const a = await assessRun(runDir);
		assert.ok(a.reasons.some((r) => r.includes("rejected envelope(s): triage-round-1.rejected.json")));
	});
	it("reports a missing manifest instead of throwing", async () => {
		const a = await assessRun(tmpDir());
		assert.equal(a.eligible, false);
		assert.ok(a.reasons[0].includes("icm-manifest.json"));
	});
});

describe("promoteRun", () => {
	it("copies the output (validated), lineage (draft), and hash-checked artifacts; indexes only the output", async () => {
		const { runDir, icm, outputId } = await autoValidateRun();
		const contextDir = tmpDir("icm-ctx-");
		const r = await promoteRun(runDir, { contextDir, note: "first" });
		assert.equal(r.ok, true, JSON.stringify(r));
		if (!r.ok) return;
		assert.equal(r.id, outputId);
		assert.equal(r.dest, path.join(contextDir, r.entry.path));
		assert.equal(path.basename(r.dest), icm.scope.task_id);
		assert.match(path.basename(path.dirname(r.dest)), /^[A-Za-z0-9._-]+$/, "repo slug is filesystem-safe");
		const out = readJson(path.join(r.dest, "output.json"));
		assert.equal(out.status, "validated");
		assert.equal(out.id, outputId);
		assert.equal(out.supersedes, null);
		for (const f of ["brief.json", "spec.json", "build-round-1.json", "validation-round-1.json"]) assert.equal(readJson(path.join(r.dest, "lineage", f)).status, "draft");
		assert.equal(fs.readFileSync(path.join(r.dest, "artifacts", "gate-round-1.txt"), "utf-8"), "exit 0\n\nPASS: hello.txt contains hello");
		const rec = readJson(path.join(r.dest, "promotion.json"));
		assert.equal(rec.approved_by, "user");
		assert.equal(rec.note, "first");
		assert.equal(rec.source_run_dir, runDir);
		assert.deepEqual(rec.evidence_chain.map((e: string) => e.split(":")[0]), ["envelope", "envelope", "artifact"]);
		assert.equal(rec.artifacts.find((x: { path: string }) => x.path === "gate-round-1.txt").sha256, sha256Text("exit 0\n\nPASS: hello.txt contains hello"));
		// Enrichment: the promoted output carries the run's PROVEN facts, attributed; the original stays bare.
		const passClaims = out.claims.filter((c: { statement: string; status: string; validated_by: string }) => c.statement.startsWith("PASS:") && c.status === "validated" && c.validated_by === "gate");
		assert.equal(passClaims.length, 1, "the final validation's gate PASS line is folded in");
		assert.equal(passClaims[0].statement, "PASS: hello.txt contains hello");
		const account = out.claims.find((c: { source_role: string; status: string }) => c.source_role === "builder" && c.status === "proposed");
		assert.ok(account, "the builder's account is carried as a PROPOSED claim");
		assert.equal(account.statement, "Builder's account: built");
		assert.ok(account.evidence.includes("artifact:builder-round-1.md"));
		assert.ok(out.acceptance_criteria.includes("gate.py exits 0"), "the spec's acceptance criteria are folded in");
		assert.ok(out.decisions.some((d: string) => d.startsWith("enriched at promotion from: spec.json, build-round-1.json, validation-round-1.json")));
		assert.deepEqual(rec.enriched_from, ["spec.json", "build-round-1.json", "validation-round-1.json"]);
		const original = readJson(path.join(runDir, "output.json"));
		assert.equal(original.claims.length, 1, "the run's own output.json is not enriched");
		assert.ok(!original.acceptance_criteria.includes("gate.py exits 0"));
		const idx = await loadIndex(contextDir);
		assert.equal(idx.entries.length, 1);
		assert.equal(idx.entries[0].status, "validated");
		assert.equal(idx.entries[0].kind, "output");
		// The exit criterion: nothing draft is retrievable as accepted context.
		assert.deepEqual(await listContext(contextDir, { status: "validated" }), idx.entries);
		const shown = await showContext(contextDir, outputId);
		assert.equal(shown?.envelope.status, "validated");
		// The run's own copy is untouched.
		assert.equal(readJson(path.join(runDir, "output.json")).status, "draft");
	});
	it("refuses a duplicate promotion and never overwrites", async () => {
		const { runDir } = await autoValidateRun();
		const contextDir = tmpDir("icm-ctx-");
		assert.equal((await promoteRun(runDir, { contextDir })).ok, true);
		const again = await promoteRun(runDir, { contextDir });
		assert.equal(again.ok, false);
		if (!again.ok) assert.ok(again.reasons[0].startsWith("already promoted as "));
		assert.equal((await loadIndex(contextDir)).entries.length, 1);
	});
	it("refuses an ineligible run and writes nothing", async () => {
		const contextDir = tmpDir("icm-ctx-");
		const r = await promoteRun(await fusionRun(), { contextDir });
		assert.equal(r.ok, false);
		assert.equal(fs.existsSync(path.join(contextDir, "index.json")), false);
	});
	it("supersedes marks the older promotion superseded (never deletes) and links the new one", async () => {
		const contextDir = tmpDir("icm-ctx-");
		const a = await autoValidateRun();
		const b = await autoValidateRun();
		const ra = await promoteRun(a.runDir, { contextDir });
		assert.equal(ra.ok, true);
		const bad = await promoteRun(b.runDir, { contextDir, supersedes: "ctx_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
		assert.equal(bad.ok, false);
		const rb = await promoteRun(b.runDir, { contextDir, supersedes: a.outputId });
		assert.equal(rb.ok, true, JSON.stringify(rb));
		if (!ra.ok || !rb.ok) return;
		assert.equal(readJson(path.join(rb.dest, "output.json")).supersedes, a.outputId);
		assert.equal(readJson(path.join(ra.dest, "output.json")).status, "superseded");
		assert.equal(readJson(path.join(ra.dest, "promotion.json")).superseded_by, b.outputId);
		const validated = await listContext(contextDir, { status: "validated" });
		assert.deepEqual(validated.map((e) => e.id), [b.outputId]);
		assert.equal((await listContext(contextDir)).length, 2);
		// Superseding a non-validated entry is refused.
		const c = await autoValidateRun();
		const rc = await promoteRun(c.runDir, { contextDir, supersedes: a.outputId });
		assert.equal(rc.ok, false);
	});
	it("retract marks an entry rejected with a reason; files remain", async () => {
		const contextDir = tmpDir("icm-ctx-");
		const { runDir, outputId } = await autoValidateRun();
		const r = await promoteRun(runDir, { contextDir });
		assert.equal(r.ok, true);
		assert.equal((await retractContext(contextDir, outputId, "   ")).ok, false);
		const ret = await retractContext(contextDir, outputId, "gate was too weak");
		assert.equal(ret.ok, true);
		assert.deepEqual(await listContext(contextDir, { status: "validated" }), []);
		if (!r.ok) return;
		assert.equal(readJson(path.join(r.dest, "output.json")).status, "rejected");
		assert.equal(readJson(path.join(r.dest, "promotion.json")).retracted.reason, "gate was too weak");
		assert.ok(fs.existsSync(path.join(r.dest, "artifacts", "gate-round-1.txt")));
		assert.equal((await retractContext(contextDir, outputId, "again")).ok, false);
		assert.equal((await retractContext(contextDir, "ctx_01ARZ3NDEKTSV4RRFFQ69G5FAV", "x")).ok, false);
	});
});
