/**
 * Contract tests for ICM ContextEnvelope v1 (Phase 1).
 *
 * Run:  node --test tests/icm/            (Node ≥ 22.18 strips types natively)
 *   or: just icm-test
 *
 * No pi dependency: these exercise extensions/fusion-harness/icm/envelope.ts directly.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	captureGitScope,
	createIcmRun,
	excerpt,
	MANIFEST_FILE,
	newEnvelopeId,
	normalizeRemote,
	nowIso,
	redactSecrets,
	SCHEMA_PATH,
	sha256File,
	sha256Text,
	ulid,
	validateEnvelope,
} from "../../extensions/fusion-harness/icm/envelope.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..", "..");
const FIXTURES = path.join(HERE, "fixtures");
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8"));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "icm-test-"));

describe("schema file", () => {
	it("exists next to the module and is the v1 contract", () => {
		const schema = readJson(SCHEMA_PATH);
		assert.equal(schema.title, "ContextEnvelope v1");
		assert.equal(schema.properties.schema_version.const, "1.0");
		assert.deepEqual(schema.properties.kind.enum, ["brief", "spec", "build", "validation", "output"]);
	});
});

describe("fixtures", () => {
	const valid = fs.readdirSync(path.join(FIXTURES, "valid")).filter((f) => f.endsWith(".json"));
	const invalid = fs.readdirSync(path.join(FIXTURES, "invalid")).filter((f) => f.endsWith(".json"));
	assert.ok(valid.length >= 5, "expected at least one valid fixture per kind");
	assert.ok(invalid.length >= 8, "expected a spread of invalid fixtures");

	for (const f of valid) {
		it(`valid/${f} validates`, () => {
			const r = validateEnvelope(readJson(path.join(FIXTURES, "valid", f)));
			assert.deepEqual(r.errors, []);
			assert.equal(r.ok, true);
		});
	}

	// Each invalid fixture is the valid brief with ONE defect; the error must name it.
	const expectError: Record<string, string> = {
		"missing-required-summary.json": 'missing required "summary"',
		"wrong-schema-version.json": "envelope.schema_version",
		"bad-id.json": "envelope.id",
		"unknown-kind.json": "envelope.kind",
		"extra-top-level-field.json": 'unexpected property "trust_tier"',
		"bad-artifact-sha256.json": "envelope.artifacts[0].sha256",
		"bad-claim-status.json": "envelope.claims[0].status",
		"bad-evidence-prefix.json": "envelope.claims[0].evidence[0]",
		"bad-created-at.json": "envelope.producer.created_at",
		"bad-branch-type.json": "envelope.scope.branch",
		"bad-producer-role.json": "envelope.producer.role",
		"empty-summary.json": "envelope.summary",
	};
	for (const f of invalid) {
		it(`invalid/${f} is rejected with a clear error`, () => {
			const r = validateEnvelope(readJson(path.join(FIXTURES, "invalid", f)));
			assert.equal(r.ok, false);
			assert.ok(r.errors.length > 0);
			const want = expectError[f];
			assert.ok(want, `no expectation registered for ${f} — add it to expectError`);
			assert.ok(r.errors.some((e) => e.includes(want)), `expected an error mentioning ${JSON.stringify(want)}, got:\n${r.errors.join("\n")}`);
		});
	}

	it("every valid fixture's kind is covered", () => {
		const kinds = new Set(valid.map((f) => readJson(path.join(FIXTURES, "valid", f)).kind));
		assert.deepEqual([...kinds].sort(), ["brief", "build", "output", "spec", "validation"]);
	});
});

describe("validateEnvelope", () => {
	it("never throws on garbage", () => {
		for (const v of [null, 42, "x", [], {}, { schema_version: "1.0" }]) {
			const r = validateEnvelope(v);
			assert.equal(r.ok, false);
			assert.ok(r.errors.length > 0);
		}
	});
	it("rejects an unsupported schema version explicitly", () => {
		const e = readJson(path.join(FIXTURES, "valid", "brief.json"));
		e.schema_version = "0.9";
		const r = validateEnvelope(e);
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((m) => m.includes('must equal "1.0"')));
	});
});

describe("primitives", () => {
	it("ulid is 26 Crockford chars, time-ordered, unique", () => {
		const a = ulid(1_000_000);
		const b = ulid(2_000_000);
		assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
		assert.ok(a.slice(0, 10) < b.slice(0, 10), "time prefix orders");
		const ids = new Set(Array.from({ length: 2000 }, () => ulid()));
		assert.equal(ids.size, 2000);
		assert.match(newEnvelopeId(), /^ctx_[0-9A-HJKMNP-TV-Z]{26}$/);
	});
	it("nowIso matches the schema's timestamp pattern", () => {
		assert.match(nowIso(), /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/);
	});
	it("sha256 of text and file agree with the known vector", async () => {
		const vec = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
		assert.equal(sha256Text("abc"), vec);
		const d = tmpDir();
		const p = path.join(d, "abc.txt");
		fs.writeFileSync(p, "abc");
		assert.equal(await sha256File(p), vec);
	});
	it("normalizeRemote handles ssh, https, and .git", () => {
		assert.equal(normalizeRemote("git@github.com:disler/fusion-harness.git"), "github.com/disler/fusion-harness");
		assert.equal(normalizeRemote("https://github.com/disler/fusion-harness.git"), "github.com/disler/fusion-harness");
		assert.equal(normalizeRemote("https://user@gitlab.com/g/r/"), "gitlab.com/g/r");
		assert.equal(normalizeRemote("/srv/git/local.git"), "/srv/git/local");
	});
	it("captureGitScope reads this repo and nulls outside one", () => {
		const s = captureGitScope(REPO);
		assert.match(s.commit ?? "", /^[0-9a-f]{40}$/);
		assert.equal(typeof s.branch, "string");
		const d = tmpDir();
		assert.deepEqual(captureGitScope(d), { repository: null, branch: null, commit: null });
	});
	it("captureGitScope reports a detached HEAD as branch null", () => {
		const d = tmpDir();
		execFileSync("git", ["init", "-q", d]);
		execFileSync("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"]);
		execFileSync("git", ["-C", d, "checkout", "-q", "--detach"]);
		const s = captureGitScope(d);
		assert.equal(s.branch, null);
		assert.match(s.commit ?? "", /^[0-9a-f]{40}$/);
		assert.equal(s.repository, null); // no origin
	});
	it("redactSecrets scrubs common credential shapes and leaves prose alone", () => {
		const input = [
			"OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
			"anthropic sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
			"aws AKIAIOSFODNN7EXAMPLE",
			"gh ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
			"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload",
			"password: hunter2hunter2",
			"-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
			"the keyboard token of appreciation is fine",
		].join("\n");
		const out = redactSecrets(input);
		assert.ok(!out.includes("sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"));
		assert.ok(!out.includes("sk-ant-api03"));
		assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"));
		assert.ok(!out.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"));
		assert.ok(!out.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
		assert.ok(!out.includes("hunter2hunter2"));
		assert.ok(!out.includes("MIIE"));
		assert.ok(out.includes("OPENAI_API_KEY=[REDACTED]"));
		assert.ok(out.includes("the keyboard token of appreciation is fine"));
	});
	it("excerpt collapses whitespace, caps length, and points at the artifact", () => {
		assert.equal(excerpt("  a \n b  "), "a b");
		assert.equal(excerpt(""), "(empty)");
		const long = excerpt("x".repeat(600), 100);
		assert.ok(long.startsWith("x".repeat(100)));
		assert.ok(long.includes("500 more chars"));
	});
});

describe("createIcmRun.emit", () => {
	const brief = (runDir: string, extra: Record<string, unknown> = {}) => ({
		kind: "brief" as const,
		producer: { role: "user" as const, model: "human" },
		summary: "do the thing",
		requirements: ["do the thing"],
		artifacts: [{ path: "prompt.md", type: "prompt" as const }],
		...extra,
	});

	it("writes a schema-valid envelope with hashed artifact refs and a manifest", async () => {
		const runDir = tmpDir();
		fs.writeFileSync(path.join(runDir, "prompt.md"), "do the thing");
		const icm = createIcmRun({ runDir, cwd: REPO, command: "opinion" });
		const r = await icm.emit("brief", brief(runDir));
		assert.deepEqual(r.errors, []);
		assert.equal(r.ok, true);
		assert.equal(r.file, path.join(runDir, "brief.json"));
		const env = readJson(r.file);
		assert.equal(validateEnvelope(env).ok, true);
		assert.equal(env.id, r.id);
		assert.equal(env.status, "draft");
		assert.equal(env.scope.task_id, icm.scope.task_id);
		assert.match(env.scope.commit, /^[0-9a-f]{40}$/);
		assert.equal(env.artifacts[0].sha256, sha256Text("do the thing"));
		const manifest = readJson(path.join(runDir, MANIFEST_FILE));
		assert.equal(manifest.command, "opinion");
		assert.equal(manifest.envelopes.length, 1);
		assert.equal(manifest.envelopes[0].file, "brief.json");
		assert.equal(manifest.envelopes[0].ok, true);
	});

	it("a missing artifact becomes an open question, not a fake hash", async () => {
		const runDir = tmpDir();
		const icm = createIcmRun({ runDir, cwd: REPO, command: "opinion" });
		const r = await icm.emit("brief", brief(runDir));
		assert.equal(r.ok, true);
		const env = readJson(r.file);
		assert.deepEqual(env.artifacts, []);
		assert.ok(env.open_questions.some((q: string) => q.includes("artifact not found at emit time: prompt.md")));
	});

	it("redacts secrets in every text field before writing", async () => {
		const runDir = tmpDir();
		const icm = createIcmRun({ runDir, cwd: REPO, command: "fusion" });
		const r = await icm.emit("brief", brief(runDir, { summary: "use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz", requirements: ["token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"], claims: [{ statement: "AKIAIOSFODNN7EXAMPLE works", status: "proposed", source_role: "builder", evidence: [], validated_by: null }] }));
		const text = fs.readFileSync(r.file, "utf-8");
		assert.ok(!text.includes("sk-proj-abcdefghijklmnopqrstuvwxyz"));
		assert.ok(!text.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"));
		assert.ok(!text.includes("AKIAIOSFODNN7EXAMPLE"));
	});

	it("a malformed envelope fails clearly: .rejected.json, errors listed, no throw", async () => {
		const runDir = tmpDir();
		const icm = createIcmRun({ runDir, cwd: REPO, command: "fusion" });
		const r = await icm.emit("spec", brief(runDir, { kind: "opinion", summary: "" }) as never);
		assert.equal(r.ok, false);
		assert.equal(r.file, path.join(runDir, "spec.rejected.json"));
		assert.ok(!fs.existsSync(path.join(runDir, "spec.json")));
		const rejected = readJson(r.file);
		assert.ok(rejected.errors.some((e: string) => e.includes("envelope.kind")));
		assert.ok(rejected.errors.some((e: string) => e.includes("envelope.summary")));
		assert.equal(rejected.envelope.kind, "opinion");
		const manifest = readJson(path.join(runDir, MANIFEST_FILE));
		assert.equal(manifest.envelopes[0].ok, false);
		assert.ok(manifest.envelopes[0].errors.length >= 2);
	});

	it("survives an unwritable run dir without throwing", async () => {
		const icm = createIcmRun({ runDir: "/proc/definitely-not-writable", cwd: REPO, command: "opinion" });
		const r = await icm.emit("brief", brief("/nowhere"));
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => e.includes("emit error")));
	});

	it("emits the full brief → spec → build → validation → output chain for an auto-validate-shaped run", async () => {
		const runDir = tmpDir();
		for (const f of ["prompt.md", "validator.md", "gate.py", "gate-baseline.txt", "builder-round-1.md", "gate-round-1.txt"]) fs.writeFileSync(path.join(runDir, f), `${f} body`);
		const icm = createIcmRun({ runDir, cwd: REPO, command: "auto-validate" });
		const b = await icm.emit("brief", brief(runDir));
		const s = await icm.emit("spec", { kind: "spec", producer: { role: "validator", model: "anthropic/claude-sonnet-5" }, summary: "gate written", acceptance_criteria: ["gate.py exits 0"], artifacts: [{ path: "validator.md", type: "raw-report" }, { path: "gate.py", type: "gate-script" }, { path: "gate-baseline.txt", type: "gate-output" }], claims: [{ statement: "red baseline", status: "validated", source_role: "validator", evidence: ["artifact:gate-baseline.txt"], validated_by: "gate" }] });
		const bu = await icm.emit("build-round-1", { kind: "build", producer: { role: "builder", model: "openai/gpt-5.6-terra" }, summary: "built", artifacts: [{ path: "builder-round-1.md", type: "raw-report" }] });
		const v = await icm.emit("validation-round-1", { kind: "validation", producer: { role: "validator", model: "anthropic/claude-sonnet-5" }, summary: "PASS", claims: [{ statement: "gate passed", status: "validated", source_role: "validator", evidence: ["artifact:gate-round-1.txt", `envelope:${bu.id}`], validated_by: "gate" }], artifacts: [{ path: "gate.py", type: "gate-script" }, { path: "gate-round-1.txt", type: "gate-output" }] });
		const o = await icm.emit("output", { kind: "output", producer: { role: "harness", model: "harness/fusion-harness" }, summary: "PASS at 1/5", claims: [{ statement: "gate passed", status: "validated", source_role: "validator", evidence: [`envelope:${v.id}`], validated_by: "gate" }], supersedes: null });
		for (const r of [b, s, bu, v, o]) assert.deepEqual(r.errors, [], `envelope ${r.file} should be valid`);
		const files = fs.readdirSync(runDir).filter((f) => f.endsWith(".json")).sort();
		assert.deepEqual(files, ["brief.json", "build-round-1.json", MANIFEST_FILE, "output.json", "spec.json", "validation-round-1.json"]);
		const manifest = readJson(path.join(runDir, MANIFEST_FILE));
		assert.deepEqual(
			manifest.envelopes.map((e: { kind: string }) => e.kind),
			["brief", "spec", "build", "validation", "output"],
		);
		assert.ok(manifest.envelopes.every((e: { ok: boolean }) => e.ok));
		assert.ok(manifest.envelopes.every((e: { status: string }) => e.status === "draft"), "Phase 1: everything stays draft");
	});
});
