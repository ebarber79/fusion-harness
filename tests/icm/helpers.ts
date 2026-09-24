/**
 * Shared fixtures for the ICM contract tests (Phases 3–4). No pi dependency.
 *
 * `autoValidateRun` writes an /auto-validate-shaped run dir exactly as the harness does — raw
 * files plus brief → spec → build → validation → output envelopes — with `gatePass` controlling
 * the verdict. `scratchRepo` gives a throwaway git repository with an `origin` so a run captures
 * a real repository/branch/commit scope (retrieval keys on it). Nothing here touches ~/.fusion.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createIcmRun } from "../../extensions/fusion-harness/icm/envelope.ts";

export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const REPO = path.resolve(HERE, "..", "..");
export const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8"));
export const tmpDir = (tag = "icm-test-") => fs.mkdtempSync(path.join(os.tmpdir(), tag));
export const w = (dir: string, name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

export const git = (cwd: string, ...args: string[]): string =>
	execFileSync("git", ["-c", "user.email=icm@test", "-c", "user.name=icm-test", ...args], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A throwaway git repo with one commit and a fake origin (nothing is ever fetched or pushed). */
export function scratchRepo(origin = "https://example.invalid/icm/scratch.git"): string {
	const dir = tmpDir("icm-repo-");
	git(dir, "init", "-q", "-b", "main");
	git(dir, "remote", "add", "origin", origin);
	w(dir, "README.md", "scratch\n");
	git(dir, "add", "README.md");
	git(dir, "commit", "-q", "-m", "init");
	return dir;
}

/** Add one commit to a scratch repo; returns the new HEAD sha. */
export function commitFile(dir: string, name: string, body: string, message = `add ${name}`): string {
	w(dir, name, body);
	git(dir, "add", name);
	git(dir, "commit", "-q", "-m", message);
	return git(dir, "rev-parse", "HEAD");
}

export interface RunOptions {
	gatePass?: boolean;
	builderReport?: string;
	cwd?: string; // where the run's git scope is captured from (default: this repo)
	request?: string; // the human's prompt, carried by the brief
}

/** An /auto-validate-shaped run, as the harness writes it. `gatePass` controls the verdict. */
export async function autoValidateRun(opts: RunOptions = {}) {
	const gatePass = opts.gatePass ?? true;
	const request = opts.request ?? "Create hello.txt containing hello";
	const runDir = tmpDir("icm-run-");
	w(runDir, "prompt.md", request);
	w(runDir, "validator.md", "wrote the gate");
	w(runDir, "gate.py", "print('PASS: ok')");
	w(runDir, "gate-baseline.txt", "exit 1\n\nFAIL: hello.txt missing");
	w(runDir, "builder-round-1.md", opts.builderReport ?? "Created hello.txt");
	w(runDir, "gate-round-1.txt", gatePass ? "exit 0\n\nPASS: hello.txt contains hello" : "exit 1\n\nFAIL: hello.txt contains hi");
	const icm = createIcmRun({ runDir, cwd: opts.cwd ?? REPO, command: "auto-validate" });
	await icm.emit("brief", { kind: "brief", producer: { role: "user", model: "human" }, summary: request.slice(0, 120), requirements: [request], artifacts: [{ path: "prompt.md", type: "prompt" }] });
	await icm.emit("spec", { kind: "spec", producer: { role: "validator", model: "mock/scripted" }, summary: "gate written", acceptance_criteria: ["gate.py exits 0"], artifacts: [{ path: "validator.md", type: "raw-report" }, { path: "gate.py", type: "gate-script" }, { path: "gate-baseline.txt", type: "gate-output" }] });
	const b = await icm.emit("build-round-1", { kind: "build", producer: { role: "builder", model: "mock/scripted" }, summary: "built", artifacts: [{ path: "builder-round-1.md", type: "raw-report" }] });
	const v = await icm.emit("validation-round-1", {
		kind: "validation",
		producer: { role: "validator", model: "mock/scripted" },
		summary: gatePass ? "PASS" : "FAIL",
		claims: [
			{ statement: "The acceptance gate passed.", status: gatePass ? "validated" : "rejected", source_role: "validator", evidence: ["artifact:gate-round-1.txt", "artifact:gate.py", `envelope:${b.id}`], validated_by: "gate" },
			{ statement: gatePass ? "PASS: hello.txt contains hello" : "FAIL: hello.txt contains hi", status: gatePass ? "validated" : "rejected", source_role: "validator", evidence: ["artifact:gate-round-1.txt", `envelope:${b.id}`], validated_by: "gate" },
		],
		artifacts: [{ path: "gate.py", type: "gate-script" }, { path: "gate-round-1.txt", type: "gate-output" }],
	});
	const o = await icm.emit("output", {
		kind: "output",
		producer: { role: "harness", model: "harness/fusion-harness" },
		summary: gatePass ? "Gate PASS at validation 1/5." : "FAILED: halted",
		acceptance_criteria: ["The VALIDATOR-authored gate.py exits 0 against the working tree."],
		decisions: ["Phase 3: this envelope stays draft in the run dir; promotion is a manual, gate-backed act — /icm-promote <run-dir>."],
		claims: [{ statement: "The acceptance gate passed.", status: gatePass ? "validated" : "rejected", source_role: "validator", evidence: [`envelope:${v.id}`, "artifact:gate-round-1.txt"], validated_by: "gate" }],
		artifacts: [{ path: "gate-round-1.txt", type: "gate-output" }, { path: "builder-round-1.md", type: "raw-report" }],
	});
	for (const r of [b, v, o]) assert.deepEqual(r.errors, []);
	return { runDir, icm, outputId: o.id, validationId: v.id, scope: icm.scope };
}

/** A /fusion-shaped run: no independent evidence, never promotable. */
export async function fusionRun() {
	const runDir = tmpDir("icm-run-");
	w(runDir, "prompt.md", "q");
	w(runDir, "architect.md", "a");
	w(runDir, "builder.md", "b");
	w(runDir, "fused.md", "fused");
	const icm = createIcmRun({ runDir, cwd: REPO, command: "fusion" });
	await icm.emit("brief", { kind: "brief", producer: { role: "user", model: "human" }, summary: "q", artifacts: [{ path: "prompt.md", type: "prompt" }] });
	await icm.emit("output", { kind: "output", producer: { role: "fusion", model: "m" }, summary: "fused", claims: [{ statement: "merged", status: "proposed", source_role: "fusion", evidence: ["artifact:fused.md"], validated_by: null }], artifacts: [{ path: "fused.md", type: "fused-report" }] });
	return runDir;
}
