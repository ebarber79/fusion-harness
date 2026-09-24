/**
 * Gate-script helpers for /auto-validate — pure (no pi dependency) so `node --test` covers them.
 *
 * Two defects surfaced by the first real-model ICM check (ICM_IMPLEMENTATION_NOTES.md, "Hybrid
 * real-model check") live here:
 *
 *   1. The validator wrote the PEP 723 opener as `# ///script` (no space). The old check looked
 *      for the exact string `# /// script`, missed it, and PREPENDED a second header. PEP 723's
 *      block regex is greedy, so uv read the stray `///` as TOML and refused to start the gate.
 *      `ensureGateMetadata` now recognises near-miss openers/closers and normalises them.
 *
 *   2. A gate that cannot START (uv metadata/TOML error, a SyntaxError in gate.py itself, an
 *      unresolvable dependency) exited 2 with no PASS:/FAIL: lines, and the loop treated that as
 *      an ordinary red result — spending every correction round on a gate that never ran.
 *      `gateStartFailure` names such outputs so the harness can stop at baseline instead.
 */

export const GATE_META_HEADER = '# /// script\n# requires-python = ">=3.11"\n# dependencies = []\n# ///\n';

// PEP 723 opener/closer, tolerant of the spacing a model may get wrong: "# ///script", "#/// script", "#///".
const OPENER = /^[ \t]*#[ \t]*\/\/\/[ \t]*script[ \t]*$/m;
const CLOSER = /^[ \t]*#[ \t]*\/\/\/[ \t]*$/m;

/**
 * Guarantee exactly one well-formed PEP 723 metadata block: a present (possibly near-miss) block is
 * normalised in place; an absent one is prepended. Empty input → undefined.
 */
export function ensureGateMetadata(script: string): string | undefined {
	const s = script.trim();
	if (!s) return undefined;
	if (!OPENER.test(s)) return `${GATE_META_HEADER}${s}\n`;
	const openAt = s.search(OPENER);
	const head = s.slice(0, openAt);
	let rest = s.slice(openAt).replace(OPENER, "# /// script");
	// Normalise the FIRST closer after the opener (the block's own); anything later is left alone.
	const afterOpener = rest.indexOf("\n") + 1;
	const closeRel = rest.slice(afterOpener).search(CLOSER);
	if (closeRel !== -1) {
		const at = afterOpener + closeRel;
		rest = rest.slice(0, at) + rest.slice(at).replace(CLOSER, "# ///");
	}
	return `${head}${rest}\n`;
}

const CHECK_LINE = /^\W{0,3}(PASS|FAIL)\s*:/m;

/**
 * Why a gate run proves nothing about the build: the gate itself could not start. Returns undefined
 * when the gate ran (any PASS:/FAIL: line, or exit 0/1 with none of the signatures below).
 *
 * Deliberately narrow — a traceback is NOT enough on its own: a red baseline legitimately crashes
 * with an ImportError when the module under test does not exist yet. Only failures that are the
 * gate's own, independent of the working tree, qualify.
 */
export function gateStartFailure(g: { code: number; output: string }, gateFile = "gate.py"): string | undefined {
	const out = g.output;
	if (g.code === 0 || CHECK_LINE.test(out)) return undefined;
	if (/TOML parse error|Failed to parse inline script metadata|inline script metadata/i.test(out)) return "the gate's inline script metadata (PEP 723 header) is malformed — uv could not start it";
	if (/No solution found when resolving|Failed to (?:download|build|install)|error: .*(?:not found in the package registry|Because .* depends on)/i.test(out)) return "the gate's declared dependencies could not be resolved — uv could not start it";
	// A SyntaxError is the gate's own only when the LAST traceback frame before it is gate.py —
	// a frame in the builder's module means the gate started and the build is what is broken.
	const syn = out.match(/^\s*(?:SyntaxError|IndentationError|TabError):/m);
	if (syn?.index !== undefined) {
		const frames = [...out.slice(0, syn.index).matchAll(/File "([^"]+)", line \d+/g)].map((m) => m[1]);
		const last = frames.at(-1);
		if (last && (last === gateFile || last.endsWith(`/${gateFile}`))) return "the gate script itself has a syntax error — it never ran";
	}
	return undefined;
}
