'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/index.html', 'utf8');
const css = fs.readFileSync('static/style.css', 'utf8');
const source = fs.readFileSync('static/app.js', 'utf8');
const stages = ['architect', 'builder', 'synthesis', 'analysis'];
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]+)\\}'));
  assert.ok(match, 'missing style contract: ' + selector);
  return match[1];
}
test('request is the first form input with guidance before model configuration', () => {
  const form = html.match(/<form id="run-form">([\s\S]*?)<\/form>/)[1];
  assert.match(form.match(/<(?:input|select|textarea)\b[^>]*>/)[0], /id="prompt"/);
  assert.ok(form.indexOf('id="prompt"') < form.indexOf('class="models"'));
  assert.match(form, /aria-describedby="prompt-hint"/);
  assert.match(form, /id="prompt-hint"/);
  assert.match(form, /<h3 class="model-section-title">Model selection<\/h3>/);
  assert.ok(form.indexOf('class="models"') < form.indexOf('id="run"'));
  assert.match(rule('.request-composer'), /margin-bottom:\s*24px/);
});
test('model controls use short role labels with aligned fields and wrapping summaries', () => {
  assert.match(html, /<label for="architect-model">Architect<\/label>/);
  assert.match(html, /<label for="ollama-model">Builder<\/label>/);
  assert.match(html, /<label class="synthesis-control">Synthesis &amp; comparison<input/);
  assert.match(rule('.models > div > label:first-child'), /min-height:\s*0/);
  assert.match(rule('.synthesis-control input'), /margin-top:\s*7px/);
  assert.match(rule('#architect-selection, #builder-selection'), /overflow-wrap:\s*anywhere/);
});
test('next-run summaries expose full selected IDs without changing historical identity', () => {
  const elements = new Map(['architect-selection', 'builder-selection', 'architect-provider', 'builder-provider', 'synthesis-provider', 'analysis-provider', 'openai-model'].map(id => [id, {textContent: '', value: 'gpt-5.5'}]));
  const modelSelect = {value: 'qwen2.5-coder:0.5b'};
  const architectSelect = {value: 'openai:default'};
  const ctx = vm.createContext({byId: id => elements.get(id), modelSelect, architectSelect, lastJob: null, button: {}, submitting: false, connected: true, validModel: () => true, architectsLoading: false, architectNames: new Set(['openai:default', 'anthropic:claude-long-model-name']), activeJob: null});
  vm.runInContext(source.slice(source.indexOf('function providerLabel(value)'), source.indexOf('function selectPreferred(defaultModel)')), ctx);
  vm.runInContext('updateRunButton()', ctx);
  assert.match(elements.get('architect-selection').textContent, /gpt-5\.5/);
  assert.match(elements.get('builder-selection').textContent, /qwen2\.5-coder:0\.5b/);
  elements.get('openai-model').value = 'gpt-5.5-pro';
  vm.runInContext('updateRunButton()', ctx);
  assert.match(elements.get('architect-selection').textContent, /gpt-5\.5-pro/);
  architectSelect.value = 'anthropic:claude-long-model-name';
  modelSelect.value = 'xai:grok-4.3';
  ctx.lastJob = {config: {openai_model: 'old-model', ollama_model: 'old-local'}, stages: [{name: 'builder', provider: 'ollama', model: 'old-local'}]};
  vm.runInContext('updateRunButton()', ctx);
  assert.match(elements.get('architect-selection').textContent, /claude-long-model-name/);
  assert.match(elements.get('builder-selection').textContent, /grok-4\.3/);
  assert.match(elements.get('builder-provider').textContent, /old-local/);
  assert.doesNotMatch(elements.get('builder-provider').textContent, /grok/);
  architectSelect.value = ''; modelSelect.value = '';
  vm.runInContext('updateRunButton()', ctx);
  assert.match(elements.get('architect-selection').textContent, /Choose an available architect/);
  assert.match(elements.get('builder-selection').textContent, /Choose an available builder/);
});
test('cloud disclosures collapse natively without hiding the brief safety summary', () => {
  const details = html.match(/<details class="disclosure-details">([\s\S]*?)<\/details>/);
  assert.ok(details, 'long cloud disclosure must be a native details element');
  assert.match(details[1], /<summary>Cloud routing &amp; billing details<\/summary>/);
  for (const phrase of ['Cloud data disclosure:', 'Grok documented IDs', 'Perplexity cloud Builder:', 'web search fees', 'Do not submit secrets.', 'outputs are not executed']) assert.ok(details[1].includes(phrase), phrase);
  const summary = html.match(/<p class="safety-summary">([\s\S]*?)<\/p>/);
  assert.ok(summary, 'always-visible safety summary');
  assert.ok(!details[0].includes(summary[0]), 'safety summary outside closed details');
  assert.match(summary[1], /cloud/i); assert.match(summary[1], /billing/i); assert.match(summary[1], /Do not submit secrets/);
});
test('all original controls, metadata, labels and raw output surfaces survive', () => {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const original = ['run-form', 'openai-model', 'architect-model', 'architect-selection', 'architect-models-status', 'architect-fallback-enabled', 'architect-fallback-status', 'ollama-model', 'builder-selection', 'refresh-models', 'models-status', 'prompt', 'run', 'status', 'error', 'history-select', 'history-refresh', 'history-latest', 'history-delete', 'history-export', 'history-status', 'history-prompt', 'usage-summary', ...stages.flatMap(name => ['provider', 'copy-status', 'copy', 'status', 'usage', 'error', 'output'].map(suffix => name + '-' + suffix))];
  for (const id of original) assert.equal(ids.filter(value => value === id).length, 1, id);
  for (const name of stages) assert.match(html, new RegExp('<pre id="' + name + '-output" tabindex="0"'));
  for (const id of ['architect-model', 'ollama-model', 'prompt', 'history-select']) assert.match(html, new RegExp('<label for="' + id + '">'));
  assert.match(html, /OpenAI model \(synthesis \+ analysis only\)/);
  assert.match(html, /not hidden chain of thought/);
  assert.doesNotMatch(source, /innerHTML|marked\(|markdown-it/);
  assert.match(source, /byId\(`\$\{stage.name\}-output`\)\.textContent = stage.output/);
});
test('results precede compact history and footer describes persistent local storage truthfully', () => {
  assert.ok(html.indexOf('aria-label="Model outputs"') < html.indexOf('aria-label="Private local history"'), 'results before history');
  assert.doesNotMatch(html, /latest run stays in server memory|No live estimates, prices, or persistent usage history/);
  assert.match(html, /Saved runs persist locally/);
  assert.match(rule('#history-prompt'), /max-height:\s*1[246]0px/);
  assert.match(rule('#history-prompt'), /min-height:\s*0/);
});
test('fallback settings collapse below the primary model grid without nested availability disclosure', () => {
  const form = html.match(/<form id="run-form">([\s\S]*?)<\/form>/)[1];
  const advanced = form.match(/<details class="advanced-settings">([\s\S]*?)<\/details>/);
  assert.ok(advanced, 'fallback needs a closed native advanced-settings section');
  assert.match(advanced[1], /<summary>Advanced settings · architect fallback<\/summary>/);
  assert.match(advanced[1], /<input id="architect-fallback-enabled" type="checkbox" disabled aria-describedby="architect-fallback-status">/);
  assert.match(advanced[1], /id="architect-fallback-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(advanced[1], /<details/);
  for (const phrase of ['same prompt to Claude once', 'added latency and API cost', 'No other stage falls back', 'Claude API billing is separate']) assert.ok(advanced[1].includes(phrase), phrase);
  assert.ok(form.indexOf('class="advanced-settings"') > form.indexOf('class="synthesis-control"'));
  assert.ok(form.indexOf('class="advanced-settings"') < form.indexOf('id="run"'));
  assert.doesNotMatch(form.slice(0, form.indexOf('class="advanced-settings"')), /id="architect-fallback/);
  assert.match(rule('.advanced-settings'), /margin-bottom:\s*18px/);
  assert.match(rule('.advanced-settings p'), /overflow-wrap:\s*anywhere/);
});
test('run action is separated with four-stage guidance and visible live status and errors', () => {
  const form = html.match(/<form id="run-form">([\s\S]*?)<\/form>/)[1];
  const row = form.match(/<div class="actions run-actions">([\s\S]*?)<\/div>/);
  assert.ok(row, 'run action needs its own separated row');
  assert.match(row[1], /<button id="run" type="submit" disabled aria-describedby="run-hint">Run Fusion<\/button>/);
  assert.match(row[1], /id="status" role="status" aria-live="polite"/);
  const hint = row[1].match(/<p id="run-hint" class="run-hint">([^<]+)<\/p>/);
  assert.ok(hint, 'visible, accessible four-stage instruction');
  assert.equal(hint[1], 'Review your request and models, then run architecture → build → synthesis → comparison.');
  assert.doesNotMatch(hint[1], /ready|free|cost|guarantee/i);
  assert.match(form.slice(form.indexOf(row[0]) + row[0].length), /<p id="error" role="alert"><\/p>/);
  assert.doesNotMatch(row[0], /<details|hidden/);
  assert.match(rule('.run-actions'), /border-top:\s*1px solid var\(--border\)/);
  assert.match(rule('.run-actions'), /padding-top:\s*18px/);
  assert.match(rule('.run-hint'), /flex:\s*1 1 100%/);
  assert.match(rule('#status'), /overflow-wrap:\s*anywhere/);
});
test('model layout balances three primary controls with compact status disclosures', () => {
  assert.match(rule('.models'), /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /<label class="fallback-toggle"><input id="architect-fallback-enabled"/);
  assert.match(rule('.fallback-toggle'), /display:\s*flex/);
  assert.match(rule('input[type="checkbox"]'), /width:\s*1[68]px/);
  for (const id of ['architect-models-status', 'models-status']) {
    assert.match(html, new RegExp('<details class="model-details">(?:(?!</details>)[\\s\\S])*id="' + id + '"'));
  }
});
test('responsive CSS contracts prevent intrinsic overflow at phone, tablet and desktop widths', () => {
  assert.match(rule('body'), /max-width:\s*1440px/);
  assert.match(rule('.models > *'), /min-width:\s*0/);
  assert.match(rule('input, select, textarea'), /width:\s*100%/);
  assert.match(rule('.actions'), /flex-wrap:\s*wrap/);
  assert.match(rule('.model-tools'), /flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /\.panels, \.models\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rule('pre'), /white-space:\s*pre-wrap/);
  assert.match(rule('pre'), /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /100vw|overflow-x:\s*hidden/);
});
test('readable output and unified secondary actions include keyboard and reduced-motion access', () => {
  assert.match(rule('pre'), /font:\s*15px\/1\.7/);
  assert.match(css, /button, #history-export\s*\{/);
  assert.match(rule('#history-delete'), /color:\s*var\(--danger\)/);
  assert.match(css, /#run\s*\{/);
  assert.match(css, /summary:focus-visible/); assert.match(css, /a:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
test('render maintains distinct stage classes through completed, error, interrupted and reset states', () => {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], {textContent: '', className: '', setAttribute(name, value) {this[name] = value;}}]));
  const ctx = vm.createContext({byId: id => elements.get(id), lastJob: null, loaded: true, viewId: null, renderUsage() {}, updateRunButton() {}, updateCopyButtons() {}});
  const render = source.slice(source.indexOf('function render(job) {'), source.indexOf('async function refreshHistory()'));
  vm.runInContext(render, ctx);
  for (const status of ['pending', 'running', 'completed', 'error', 'interrupted', 'storage_error']) {
    ctx.job = {id: 'offline', status: 'completed', config: {prompt: '<literal>'}, stages: stages.map(name => ({name, status, output: 'raw <script> text'}))};
    vm.runInContext('render(job)', ctx);
    for (const name of stages) {
      assert.equal(elements.get(name + '-status').textContent, status);
      assert.equal(elements.get(name + '-status').className, 'stage-status is-' + status);
      assert.equal(elements.get(name + '-output').textContent, 'raw <script> text');
    }
    assert.ok(css.includes('.stage-status.is-' + status), 'distinct CSS mapping: ' + status);
  }
  ctx.job.stages = []; vm.runInContext('render(job)', ctx);
  assert.equal(elements.get('architect-status').className, 'stage-status is-unavailable');
  vm.runInContext('render(null)', ctx);
  assert.equal(elements.get('architect-status').className, 'stage-status is-pending');
});
