'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/index.html', 'utf8');
const css = fs.readFileSync('static/style.css', 'utf8');
const source = fs.readFileSync('static/app.js', 'utf8');
const names = ['architect', 'builder', 'synthesis', 'analysis'];
function usageFixture() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], {textContent: ''}]));
  const ctx = vm.createContext({byId: id => {assert.ok(elements.has(id), 'unknown real markup ID ' + id); return elements.get(id);}});
  const start = source.indexOf('function displayCount(value)');
  vm.runInContext(source.slice(start, source.indexOf('\n//', start)), ctx);
  return {el: id => elements.get(id), render: job => {ctx.job = job; vm.runInContext('renderUsage(job)', ctx);}};
}
test('usage overview labels partial known totals without hiding detailed coverage or failed attempts', () => {
  const f = usageFixture();
  const j = {stages: [{name: 'architect', status: 'error', usage: {input_tokens: 0}, primary_failure: {usage: {input_tokens: 7}}}], usage: {total_tokens: 123, complete: false, complete_stages: 1, stage_count: 4, known_stages: {input_tokens: 2, output_tokens: 1, total_tokens: 1}, failed_attempt_count: 1, failed_attempts_complete: false}};
  f.render(j);
  assert.equal(f.el('usage-overview').textContent, 'Known reported total: 123 tokens · 1/4 stages · partial/incomplete');
  assert.match(f.el('usage-summary').textContent, /input 2\/4.*output 1\/4.*total 1\/4/);
  assert.match(f.el('usage-summary').textContent, /failed-attempt coverage unknown\/partial/);
  assert.match(f.el('architect-usage').textContent, /Input 0.*Output unknown.*Failed OpenAI attempt: Input 7/);
});
test('usage overview resets to truthful idle and legacy unknown states', () => {
  const f = usageFixture();
  f.render({stages: [], usage: {total_tokens: 99, complete: true, complete_stages: 4, stage_count: 4}});
  f.render(null);
  assert.equal(f.el('usage-overview').textContent, 'No run — reported token counts appear after stages finish.');
  f.render({stages: []});
  assert.equal(f.el('usage-overview').textContent, 'Reported total: unknown · partial/incomplete coverage');
  assert.match(f.el('analysis-usage').textContent, /Total unknown/);
});
test('history puts view status before grouped actions and collapses the preserved prompt', () => {
  const history = html.match(/<section class="controls history"[\s\S]*?<\/section>/)[0];
  assert.ok(history.includes('class="history-browser"'), 'separate browsing controls');
  assert.ok(history.includes('class="actions history-navigation" aria-label="History navigation"'), 'navigation group');
  assert.ok(history.includes('class="actions history-file-actions" aria-label="Viewed run actions"'), 'file action group');
  assert.ok(history.indexOf('id="history-status"') < history.indexOf('id="history-refresh"'), 'view status precedes actions');
  assert.ok(history.indexOf('id="history-export"') < history.indexOf('id="history-delete"'), 'destructive action last');
  assert.ok(/<details class="history-prompt-details"><summary>Viewed run prompt<\/summary><pre id="history-prompt" tabindex="0" aria-label="Viewed run prompt"><\/pre><\/details>/.test(history), 'native closed prompt disclosure');
  assert.ok(/id="history-select" aria-describedby="history-status"/.test(history), 'selector linked to view status');
  assert.ok(/#history-status\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css), 'long history status wraps');
  assert.ok(/\.history-file-actions\s*\{[^}]*border-top:/.test(css), 'separate saved-run actions');
});
test('usage overview preserves valid zero, unknown invalid counts and stable repeated polling', () => {
  const f = usageFixture();
  const j = {stages: [], usage: {total_tokens: 0, complete: true, complete_stages: 3, stage_count: 3}};
  f.render(j); assert.equal(f.el('usage-overview').textContent, 'Reported total: 0 tokens · 3/3 stages · complete');
  f.render(j); assert.equal(f.el('usage-overview').textContent, 'Reported total: 0 tokens · 3/3 stages · complete');
  for (const invalid of [null, true, -1, '<img>', 1.5]) {
    j.usage = {...j.usage, total_tokens: invalid, complete: false}; f.render(j);
    assert.match(f.el('usage-overview').textContent, /^Known reported total: unknown tokens.*partial\/incomplete$/);
  }
});
test('usage is compact with native stage details and always-visible accounting limits', () => {
  for (const name of names) {
    assert.match(html, new RegExp(`<details class="stage-usage"><summary>Reported tokens</summary><p id="${name}-usage">`));
  }
  assert.match(html, /<section class="usage-card" aria-label="Reported token usage">/);
  assert.match(html, /id="usage-overview" role="status" aria-live="polite"/);
  assert.match(html, /<details class="usage-details"><summary>Counts &amp; coverage details<\/summary>\s*<p id="usage-summary"/);
  assert.match(html, /class="usage-limit">Tokens are not prices\. Unknown is not zero; partial counts are not a full-run total\./);
  assert.match(css, /\.stage-usage p\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.usage-card\s*\{[^}]*border:/);
});
