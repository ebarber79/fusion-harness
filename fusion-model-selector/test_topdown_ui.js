'use strict';
// Top-down layout adopted from ~/fusion-prototype (user decision 2026-10-12): numbered steps, tagline,
// stage progress strip and Reset view. Live panel titles are kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('static/index.html', 'utf8');
const css = fs.readFileSync('static/style.css', 'utf8');

test('sections carry numbered top-down step headings in order', () => {
  const steps = ['1 / Define the request', '2 / Choose model roles', '3 / Review the evidence', '4 / Session history'];
  const at = steps.map(text => html.indexOf(`>${text}</`));
  assert.ok(at.every(i => i > 0), 'all four step headings present');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'steps appear top to bottom');
  for (const old of ['>Run configuration</h2>', '>Model selection</h3>', '>Results</h2>', '>Run history</h2>']) assert.ok(!html.includes(old), old);
});

test('header tagline matches the top-down prototype', () => {
  assert.match(html.match(/<header>[\s\S]*?<\/header>/)[0], /One request\. Independent perspectives\. A visible synthesis\./);
});

test('stage progress strip lists the four live stage titles before the panels', () => {
  const strip = html.match(/<ol id="stage-progress"[^>]*>([\s\S]*?)<\/ol>/);
  assert.ok(strip, 'progress strip present');
  assert.match(strip[0], /aria-label="Stage progress"/);
  for (const [name, label] of [['architect', '01 Architect'], ['builder', '02 Builder'], ['synthesis', '03 Synthesis'], ['analysis', '04 Reasoning / Divergence']])
    assert.match(strip[1], new RegExp(`<li id="progress-${name}" class="step is-pending">${label.replace('/', '\\/')}</li>`));
  assert.ok(html.indexOf('id="stage-progress"') < html.indexOf('<section class="panels"'));
  for (const state of ['running', 'completed', 'error']) assert.match(css, new RegExp(`\\.step\\.is-${state}\\b`));
});

test('Reset view replaces Active / latest on the existing control', () => {
  assert.match(html, /<button id="history-latest" type="button">Reset view<\/button>/);
  assert.ok(!html.includes('>Active / latest</button>'));
});
