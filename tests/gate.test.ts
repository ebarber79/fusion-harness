/**
 * Contract tests for the gate helpers (extensions/fusion-harness/gate.ts).
 *
 * Run:  just test        (all suites)   ·   node --test tests/gate.test.ts
 *
 * Both defects here were observed in a real run (ICM_IMPLEMENTATION_NOTES.md, "Hybrid real-model
 * check", run /tmp/fusion-harness-xlbA9x): a `# ///script` opener got a second header prepended,
 * uv failed with "TOML parse error at line 3", and the loop spent both rounds on a gate that never ran.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureGateMetadata, GATE_META_HEADER, gateStartFailure } from "../extensions/fusion-harness/gate.ts";

const BODY = 'import sys\nprint("PASS: ok")\nsys.exit(0)\n';
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("ensureGateMetadata", () => {
	it("prepends the header when there is none, once", () => {
		const out = ensureGateMetadata(BODY)!;
		assert.ok(out.startsWith(GATE_META_HEADER));
		assert.equal(count(out, /^# \/\/\/ script$/gm), 1);
		assert.ok(out.endsWith(BODY));
	});
	it("leaves a well-formed header untouched (byte for byte, plus the trailing newline)", () => {
		const src = `${GATE_META_HEADER}${BODY}`;
		assert.equal(ensureGateMetadata(src), src);
	});
	it("normalises the near-miss opener the real validator wrote (# ///script) instead of doubling the header", () => {
		const src = `# ///script\n# requires-python = ">=3.11"\n# dependencies = []\n# ///\n\n${BODY}`;
		const out = ensureGateMetadata(src)!;
		assert.equal(count(out, /^# \/\/\/ script$/gm), 1, "exactly one opener");
		assert.equal(count(out, /^# \/\/\/$/gm), 1, "exactly one closer");
		assert.ok(!out.includes("# ///script"));
		assert.ok(out.startsWith(`# /// script\n# requires-python = ">=3.11"\n# dependencies = []\n# ///\n`));
	});
	it("normalises other spacings of opener and closer (#///script, #  ///  script, #///)", () => {
		for (const [open, close] of [
			["#///script", "#///"],
			["#  ///  script  ", "#  ///  "],
			["# ///script", "#///"],
		]) {
			const out = ensureGateMetadata(`${open}\n# dependencies = []\n${close}\n${BODY}`)!;
			assert.ok(out.startsWith("# /// script\n# dependencies = []\n# ///\n"), `${open} / ${close} → ${out.split("\n").slice(0, 3).join(" | ")}`);
		}
	});
	it("only touches the block's own closer, not a later `# ///` in the body", () => {
		const src = `# ///script\n# dependencies = []\n#///\nx = 1\n#   ///   \ny = 2\n`;
		const out = ensureGateMetadata(src)!;
		assert.ok(out.startsWith("# /// script\n# dependencies = []\n# ///\nx = 1\n#   ///   \ny = 2"));
	});
	it("keeps a leading shebang or comment before the block", () => {
		const out = ensureGateMetadata(`#!/usr/bin/env python3\n# ///script\n# dependencies = []\n# ///\n${BODY}`)!;
		assert.ok(out.startsWith("#!/usr/bin/env python3\n# /// script\n"));
	});
	it("returns undefined for an empty script", () => {
		assert.equal(ensureGateMetadata("   \n"), undefined);
	});
});

describe("gateStartFailure", () => {
	const UV_TOML = "exit 2\n\nerror: TOML parse error at line 3, column 4\n  |\n3 | ///\n  |    ^\ninvalid key\n";
	it("names uv's inline-metadata error (the doubled-header symptom)", () => {
		assert.match(gateStartFailure({ code: 2, output: UV_TOML })!, /PEP 723 header/);
	});
	it("names a SyntaxError in gate.py itself", () => {
		const out = 'Traceback (most recent call last):\n  File "/tmp/fusion-harness-abc/gate.py", line 7\n    if x == :\n            ^\nSyntaxError: invalid syntax\n';
		assert.match(gateStartFailure({ code: 1, output: out })!, /syntax error/);
	});
	it("names an unresolvable dependency", () => {
		const out = "  × No solution found when resolving script dependencies:\n  ╰─▶ Because nosuchpkg was not found in the package registry and you require nosuchpkg, we can conclude that your requirements are unsatisfiable.\n";
		assert.match(gateStartFailure({ code: 2, output: out })!, /dependencies could not be resolved/);
	});
	it("does NOT flag a legitimate red baseline: an ImportError for the module the builder has yet to write", () => {
		const out = 'Traceback (most recent call last):\n  File "/tmp/fusion-harness-abc/gate.py", line 9, in <module>\n    import widget\nModuleNotFoundError: No module named \'widget\'\n';
		assert.equal(gateStartFailure({ code: 1, output: out }), undefined);
	});
	it("does NOT flag a SyntaxError in the builder's module (the gate started; the build is broken)", () => {
		const out = 'Traceback (most recent call last):\n  File "/tmp/fusion-harness-abc/gate.py", line 9, in <module>\n    import widget\n  File "/proj/widget.py", line 3\n    def f(:\n          ^\nSyntaxError: invalid syntax\n';
		assert.equal(gateStartFailure({ code: 1, output: out }), undefined);
	});
	it("does NOT flag a gate that printed any PASS:/FAIL: line, whatever else it printed", () => {
		assert.equal(gateStartFailure({ code: 1, output: `FAIL: missing file\n${UV_TOML}` }), undefined);
		assert.equal(gateStartFailure({ code: 0, output: "PASS: ok\n" }), undefined);
	});
	it("does NOT flag a plain non-zero exit with unrelated output", () => {
		assert.equal(gateStartFailure({ code: 1, output: "AssertionError\n" }), undefined);
	});
});
