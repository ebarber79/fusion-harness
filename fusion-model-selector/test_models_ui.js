'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.handlers = {}; this._value = ''; this.disabled = false; this.textContent = ''; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
  replaceChildren(...children) { this.children = children; this._value = children[0]?.value || ''; }
  appendChild(child) { this.children.push(child); if (!this._value) this._value = child.value; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
}
const markup = fs.readFileSync('static/index.html', 'utf8');
const markupIds = new Set([...markup.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
function markupElement(elements, id) {
  assert.ok(markupIds.has(id), `Missing real markup element: ${id}`);
  if (!elements.has(id)) {
    const element = new Element();
    if (id === 'openai-model') element.value = 'gpt-5.5';
    elements.set(id, element);
  }
  return elements.get(id);
}
async function main() {
  const elements = new Map();
  const el = id => markupElement(elements, id);
  let models = {models: [{name: 'a'}, {name: 'b', size_label: '1.0 GiB'}], default: 'a'};
  let job = null;
  let failModels = false;
  let failJob = false;
  let runs = [];
  let resolveModels;
  let holdModels = false;
  const ctx = vm.createContext({document: {getElementById: el, createElement: () => new Element()},
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (path, options) => {
      if (path === '/api/models') {
        if (holdModels) await new Promise(resolve => { resolveModels = resolve; });
        return {ok: !failModels, status: failModels ? 503 : 200, json: async () => failModels ? {error: 'secret'} : models};
      }
      if (path === '/api/run') { runs.push(JSON.parse(options.body)); return {ok: true, json: async () => ({id: 'id'})}; }
      assert.equal(path, '/api/job');
      if (failJob) throw new Error('offline');
      return {ok: true, json: async () => ({job})};
    }});
  vm.runInContext(fs.readFileSync('static/app.js', 'utf8'), ctx);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  await flush();
  assert.match(el('architect-model').children[0].textContent, /ChatGPT \/ OpenAI — gpt-5\.5/);
  el('openai-model').value = 'gpt-next'; el('openai-model').handlers.input();
  assert.match(el('architect-model').children[0].textContent, /ChatGPT \/ OpenAI — gpt-next/);
  assert.match(el('architect-models-status').textContent, /OpenAI.*default/);
  assert.equal(el('architect-fallback-enabled').checked, false, 'Unverified Claude cannot enable fallback');
  assert.equal(el('ollama-model').children.length, 2, 'Installed models must populate dropdown');
  assert.equal(el('ollama-model').value, 'a');
  assert.equal(el('run').disabled, false);
  assert.equal(el('ollama-model').children[1].textContent, 'b (1.0 GiB)');
  el('ollama-model').value = 'b';
  holdModels = true;
  const refresh = el('refresh-models').handlers.click();
  await flush();
  assert.equal(el('run').disabled, true);
  assert.match(el('models-status').textContent, /Loading/);
  resolveModels(); holdModels = false;
  await refresh;
  assert.equal(el('ollama-model').value, 'b', 'Refresh preserves selection');
  job = {status: 'completed', config: {prompt: 'restored', openai_model: 'cloud', ollama_model: 'b'}, stages: []};
  vm.runInContext('loaded = false', ctx);
  await vm.runInContext('poll()', ctx);
  assert.equal(el('ollama-model').value, 'b');
  job.config.ollama_model = 'removed';
  vm.runInContext('loaded = false', ctx);
  await vm.runInContext('poll()', ctx);
  assert.equal(el('ollama-model').value, '', 'Unavailable restored models must not silently switch');
  assert.equal(el('run').disabled, true);
  await el('refresh-models').handlers.click();
  assert.equal(el('ollama-model').value, '', 'Refresh must not silently replace unavailable restored model');
  el('ollama-model').value = 'a';
  el('ollama-model').handlers.change();
  el('prompt').value = 'test';
  await el('run-form').handlers.submit({preventDefault() {}});
  assert.equal(runs.length, 1);
  assert.equal(runs[0].ollama_model, 'a');
  models = {models: [], default: null};
  await el('refresh-models').handlers.click();
  assert.match(el('models-status').textContent, /No installed/);
  assert.equal(el('run').disabled, true);
  await el('run-form').handlers.submit({preventDefault() {}});
  assert.equal(runs.length, 1, 'No-model submission must not call run');
  failModels = true;
  await el('refresh-models').handlers.click();
  assert.match(el('models-status').textContent, /unavailable/);
  assert.doesNotMatch(el('models-status').textContent, /secret/);
  assert.equal(el('run').disabled, true);
  await vm.runInContext('poll()', ctx);
  assert.equal(el('run').disabled, true, 'Polling must not reenable run without catalog');
  failModels = false;
  job = null;
  const cloud = {name: 'grok-4.3', value: 'xai:grok-4.3', provider: 'xai', verified: true, selectable: true, status: 'catalog'};
  models = {models: [{name: 'a'}], default: 'a', default_builder: 'a',
    builders: [{name: 'a', value: 'a', provider: 'ollama', selectable: true}, cloud],
    providers: {ollama: {status: 'available'}, xai: {status: 'available'}}};
  await vm.runInContext('poll()', ctx);
  await el('refresh-models').handlers.click();
  assert.match(el('ollama-model').children[0].textContent, /Ollama.*local/);
  assert.match(el('ollama-model').children[1].textContent, /Grok.*cloud/);
  el('ollama-model').value = 'xai:grok-4.3';
  el('ollama-model').handlers.change();
  assert.match(el('builder-provider').textContent, /Grok.*cloud/);
  await el('run-form').handlers.submit({preventDefault() {}});
  assert.equal(runs.at(-1).ollama_model, 'xai:grok-4.3');
  job = {status: 'completed', config: {prompt: 'task', openai_model: 'cloud', ollama_model: 'xai:grok-4.3'},
    stages: [{name: 'builder', provider: 'xai', status: 'error', error: 'Stage failed.', output: ''}]};
  await vm.runInContext('poll()', ctx);
  el('ollama-model').value = 'a';
  el('ollama-model').handlers.change();
  assert.match(el('builder-provider').textContent, /Grok.*cloud/, 'Existing job label must not change with next selection');
  assert.match(el('builder-selection').textContent, /Ollama.*local/);
  models.builders[1] = {...cloud, verified: false, selectable: false, status: 'unverified'};
  models.providers.xai = {status: 'unverified', error: 'secret upstream'};
  await el('refresh-models').handlers.click();
  assert.match(el('ollama-model').children[1].textContent, /unverified.*not ready/i);
  assert.equal(el('ollama-model').children[1].disabled, true);
  assert.match(el('models-status').textContent, /valid.*key/i);
  assert.doesNotMatch(el('models-status').textContent, /secret/);
  assert.equal(el('run').disabled, false, 'Unavailable xAI must not block local models');
  el('ollama-model').value = 'xai:grok-4.3';
  el('ollama-model').handlers.change();
  vm.runInContext("preferredModel = 'xai:grok-4.3'", ctx);
  await el('refresh-models').handlers.click();
  assert.match(el('models-status').textContent, /valid.*key/i, 'Unavailable restored cloud model must preserve key guidance');
  assert.equal(el('run').disabled, true, 'Unverified Grok cannot be submitted');
  models = {models: [], default: null, default_builder: cloud.value, builders: [cloud],
    providers: {ollama: {status: 'unavailable', error: 'secret'}, xai: {status: 'available'}}};
  el('ollama-model').value = cloud.value;
  vm.runInContext('preferredModel = null', ctx);
  await el('refresh-models').handlers.click();
  assert.equal(el('run').disabled, false, 'Available xAI works without Ollama');
  assert.match(el('models-status').textContent, /Ollama.*unavailable/);
  assert.doesNotMatch(el('models-status').textContent, /secret/);
  models = {models: [{name: 'a'}, {name: '<script>'}], default: 'a'};
  await el('refresh-models').handlers.click();
  assert.equal(el('ollama-model').children.some(child => child.value === '<script>'), false);
  job = {id: 'usage-job', status: 'completed', config: {prompt: 'task', openai_model: 'cloud', ollama_model: 'a'},
    stages: [
      {name: 'architect', status: 'completed', error: '', output: '<script>plain text</script>', usage: {input_tokens: 10, output_tokens: 2, total_tokens: 12}},
      {name: 'builder', status: 'completed', error: '', output: 'b', usage: {input_tokens: 0, output_tokens: null, total_tokens: null}},
      {name: 'synthesis', status: 'error', error: 'failed', output: '', usage: null}],
    usage: {input_tokens: 10, output_tokens: 2, total_tokens: 12, complete: false, complete_stages: 1, stage_count: 3,
      known_stages: {input_tokens: 2, output_tokens: 1, total_tokens: 1}}};
  await vm.runInContext('poll()', ctx);
  assert.match(el('architect-usage').textContent, /Input 10.*Output 2.*Total 12/);
  assert.match(el('builder-usage').textContent, /Input 0.*Output unknown.*Total unknown/);
  assert.match(el('synthesis-usage').textContent, /Input unknown.*Output unknown.*Total unknown/);
  assert.match(el('usage-summary').textContent, /whole-run.*Input 10.*Output 2.*Total 12/);
  assert.match(el('usage-summary').textContent, /1\/3 stages.*partial\/incomplete/);
  assert.match(el('usage-summary').textContent, /input 2\/3.*output 1\/3.*total 1\/3/);
  assert.equal(el('architect-output').textContent, '<script>plain text</script>');
  const pplx = {name: 'perplexity/sonar', value: 'perplexity:perplexity/sonar', provider: 'perplexity', verified: true, selectable: true};
  models = {models: [{name:'a'}], default:'a', default_builder:'a', builders:[{name:'a', value:'a', provider:'ollama', selectable:true}, cloud, pplx], providers:{perplexity:{status:'available'}}};
  await el('refresh-models').handlers.click();
  assert.equal(el('ollama-model').children.some(c => c.value === pplx.value), true, 'Perplexity catalog choice');
  job.config.ollama_model = pplx.value;
  job.stages[1].provider = 'perplexity'; job.stages[1].model = 'openai/actual-returned'; job.stages[1].output = 'Answer\nSources:\nhttps://example.com/a';
  vm.runInContext('loaded = false', ctx); await vm.runInContext('poll()', ctx);
  assert.equal(el('ollama-model').value, pplx.value);
  assert.match(el('builder-provider').textContent, /Perplexity.*openai\/actual-returned/);
  assert.match(el('builder-output').textContent, /Sources/);
  el('ollama-model').value='a'; el('ollama-model').handlers.change();
  assert.match(el('builder-provider').textContent, /Perplexity/, 'Saved actual identity survives next selection');
  models.builders[2] = {...pplx, verified:false, selectable:false}; models.providers.perplexity.status='unverified';
  await el('refresh-models').handlers.click();
  assert.equal(el('ollama-model').children.find(c=>c.value===pplx.value).disabled, true);
  assert.equal(el('run').disabled, false);
  const restored = el('usage-summary').textContent;
  await vm.runInContext('poll()', ctx);
  assert.equal(el('usage-summary').textContent, restored, 'Polling restores reported usage without accumulating it');
  job = {id: 'next', status: 'running', config: job.config, stages: [
    {name: 'architect', status: 'running', error: '', output: '', usage: null},
    {name: 'builder', status: 'pending', error: '', output: '', usage: null},
    {name: 'synthesis', status: 'pending', error: '', output: '', usage: null}],
    usage: {input_tokens: null, output_tokens: null, total_tokens: null, complete: false, complete_stages: 0, stage_count: 3,
      known_stages: {input_tokens: 0, output_tokens: 0, total_tokens: 0}}};
  await vm.runInContext('poll()', ctx);
  assert.match(el('usage-summary').textContent, /Input unknown.*Output unknown.*Total unknown/);
  assert.match(el('usage-summary').textContent, /0\/3 stages.*partial\/incomplete/);
  assert.doesNotMatch(el('architect-usage').textContent, /Input 10/);
  job.status = 'completed';
  for (const stage of job.stages) { stage.status = 'completed'; stage.usage = {input_tokens: 0, output_tokens: 0, total_tokens: 0}; }
  job.usage = {input_tokens: 0, output_tokens: 0, total_tokens: 0, complete: true, complete_stages: 3, stage_count: 3,
    known_stages: {input_tokens: 3, output_tokens: 3, total_tokens: 3}};
  await vm.runInContext('poll()', ctx);
  assert.match(el('usage-summary').textContent, /Input 0.*Output 0.*Total 0/);
  assert.match(el('usage-summary').textContent, /3\/3 stages.*complete/);
  job.stages[0].usage = {input_tokens: true, output_tokens: '<img>', total_tokens: -1};
  await vm.runInContext('poll()', ctx);
  assert.match(el('architect-usage').textContent, /Input unknown.*Output unknown.*Total unknown/);
  assert.doesNotMatch(el('architect-usage').textContent, /<img>/);
  el('ollama-model').value = 'a';
  el('ollama-model').handlers.change();
  failJob = true;
  await el('run-form').handlers.submit({preventDefault() {}});
  assert.match(el('usage-summary').textContent, /No run/, 'An accepted new job clears old counts even if its first poll fails');
  assert.match(el('architect-usage').textContent, /Input unknown.*Output unknown.*Total unknown/);
  failJob = false;
  job = null;
  await vm.runInContext('poll()', ctx);
  assert.match(el('usage-summary').textContent, /No run/);
  assert.doesNotMatch(el('architect-usage').textContent, /Input 0/);
  job = {status: 'completed', config: {prompt: 'task', openai_model: 'synth', ollama_model: 'a', architect_model: 'openai:custom'}, stages: [
    {name: 'architect', provider: 'openai', model: 'custom', status: 'completed', error: '', output: 'design'},
    {name: 'synthesis', provider: 'openai', model: 'synth', status: 'completed', error: '', output: 'final'}]};
  vm.runInContext('loaded = false', ctx);
  await vm.runInContext('poll()', ctx);
  assert.equal(el('architect-model').value, 'openai:custom', 'Explicit OpenAI architect is restored without changing synthesis');
  el('openai-model').value = 'synth-next'; el('openai-model').handlers.input();
  assert.equal(el('architect-model').value, 'openai:custom', 'Editing synthesis does not change explicit architect');
  assert.match(el('architect-model').children[0].textContent, /ChatGPT \/ OpenAI — synth-next/);
  el('architect-model').value = 'openai:default';
  el('architect-model').handlers.change();
  assert.match(el('architect-provider').textContent, /OpenAI.*custom/, 'Stage metadata remains independent of next selection');
  assert.match(el('synthesis-provider').textContent, /OpenAI.*synth/);
  job.stages.push({name: 'analysis', provider: 'openai', model: 'synth', status: 'completed', error: '', output: '<img>visible comparison</img>', usage: {input_tokens: 7, output_tokens: 3, total_tokens: 10}});
  await vm.runInContext('poll()', ctx);
  assert.equal(el('analysis-output').textContent, '<img>visible comparison</img>');
  assert.match(el('analysis-provider').textContent, /OpenAI.*synth/);
  assert.match(el('analysis-usage').textContent, /Input 7.*Output 3.*Total 10/);
  el('openai-model').value = 'next-model';
  el('architect-model').handlers.change();
  assert.match(el('analysis-provider').textContent, /OpenAI.*synth/, 'Analysis identity belongs to saved job');
  await vm.runInContext('poll()', ctx);
  assert.match(el('analysis-usage').textContent, /Total 10/, 'Repeated polls do not accumulate');
  job.stages[2].status = 'running'; job.stages[2].output = ''; job.stages[2].usage = null; job.status = 'running';
  await vm.runInContext('poll()', ctx);
  assert.equal(el('analysis-status').textContent, 'running');
  assert.match(el('analysis-usage').textContent, /Total unknown/);
  job.status = 'partial_failure'; job.stages[2].status = 'error'; job.stages[2].error = 'Stage failed.';
  await vm.runInContext('poll()', ctx);
  assert.equal(el('synthesis-output').textContent, 'final', 'Analysis failure keeps synthesis');
  job.status = 'completed'; job.stages[2].status = 'completed'; job.stages[2].output = 'old analysis';
  await vm.runInContext('poll()', ctx);
  failJob = true;
  await el('run-form').handlers.submit({preventDefault() {}});
  assert.equal(el('analysis-output').textContent, '', 'Accepted run clears old analysis even if polling fails');
  assert.match(el('analysis-usage').textContent, /Total unknown/);
  failJob = false;
  job = {status: 'completed', config: job.config, stages: [{name: 'synthesis', status: 'completed', error: '', output: 'legacy final'}]};
  await vm.runInContext('poll()', ctx);
  assert.equal(el('analysis-output').textContent, '', 'Legacy history must not retain another job analysis');
  assert.match(el('analysis-status').textContent, /unavailable/i);
  job = null;
  await vm.runInContext('poll()', ctx);
  assert.equal(el('analysis-output').textContent, '');
  const openai = {name:'o3', value:'openai:o3', provider:'openai', verified:true, selectable:true};
  models = {models:[{name:'a'}], default:'a', architects:[openai, {...openai}, {...openai, name:'gpt-image-1', value:'openai:gpt-image-1'}, {...openai, name:'gpt-5', value:'openai:gpt-5', verified:false}], providers:{openai:{status:'available'}}};
  vm.runInContext('preferredModel = null', ctx);
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-model').children.filter(c=>c.value==='openai:o3').length, 1, 'Verified OpenAI suite populates the single dropdown, deduplicated');
  assert.equal(el('architect-model').children.some(c=>c.value==='openai:gpt-image-1' || c.value==='openai:gpt-5'), false);
  el('architect-model').value='openai:o3'; el('architect-model').handlers.change();
  el('openai-model').value='synth-independent'; el('openai-model').handlers.input();
  holdModels=true;
  const architectRefresh=el('refresh-models').handlers.click(); await flush();
  assert.equal(el('architect-model').disabled, true);
  assert.match(el('architect-models-status').textContent, /Loading/);
  resolveModels(); holdModels=false; await architectRefresh;
  assert.equal(el('architect-model').value, 'openai:o3', 'Refresh preserves explicit architect independently of synthesis');
  await el('run-form').handlers.submit({preventDefault(){}});
  assert.equal(runs.at(-1).architect_model, 'openai:o3');
  assert.equal(runs.at(-1).openai_model, 'synth-independent');
  models.architects=[]; models.providers.openai={status:'unavailable', error:'secret'};
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-model').value, 'openai:o3', 'Catalog outage preserves restored OpenAI override');
  assert.match(el('architect-models-status').textContent, /OpenAI catalog unavailable/);
  assert.doesNotMatch(el('architect-models-status').textContent, /secret/);
  el('architect-model').value='openai:default'; el('architect-model').handlers.change();
  assert.equal(el('run').disabled, false, 'Catalog outage cannot disable default OpenAI');
  const claude = {name:'claude-test', value:'anthropic:claude-test', provider:'anthropic', verified:true, selectable:true};
  models = {models:[{name:'a'}], default:'a', architects:[claude], providers:{anthropic:{status:'available'}}};
  vm.runInContext("preferredModel = null", ctx);
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-fallback-enabled').checked, true, 'Verified Claude enables fallback by default');
  assert.match(el('architect-fallback-status').textContent, /Automatic backup: claude-test/);
  assert.match(el('architect-fallback-status').textContent, /prompt.*Claude.*latency.*cost/i);
  el('architect-fallback-enabled').checked = false; el('architect-fallback-enabled').handlers.change();
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-fallback-enabled').checked, false, 'Explicit disabled choice survives refresh');
  el('architect-fallback-enabled').checked = true; el('architect-fallback-enabled').handlers.change();
  await el('run-form').handlers.submit({preventDefault(){}});
  assert.equal(runs.at(-1).architect_fallback_enabled, true);
  assert.equal(runs.at(-1).architect_fallback_model, claude.value);
  job = {status:'completed', config:{prompt:'task',openai_model:'synth',ollama_model:'a',architect_fallback_enabled:true,architect_fallback_model:claude.value}, stages:[{name:'architect',provider:'anthropic',model:'claude-actual',fallback_used:true,original_provider:'openai',original_model:'synth',primary_failure:{error:'Primary request failed.',usage:{total_tokens:2}},status:'completed',output:'design',error:''}]};
  vm.runInContext('loaded = false', ctx); await vm.runInContext('poll()',ctx);
  assert.match(el('architect-provider').textContent, /Claude.*fallback.*OpenAI/i);
  assert.match(el('architect-usage').textContent, /failed.*Total 2/i);
  assert.equal(el('architect-fallback-enabled').checked,true,'Saved fallback enabled restores');
  assert.match(el('architect-fallback-status').textContent, /Automatic backup: claude-test/);
  assert.equal(el('architect-model').value,'openai:default','Fallback output does not change next architect');
  assert.equal(el('architect-model').children.some(c=>c.value===claude.value), true, 'Verified Claude architect is offered');
  assert.equal(el('ollama-model').children.some(c=>c.value===claude.value), false, 'Claude is never a builder');
  el('architect-model').value=claude.value; el('architect-model').handlers.change();
  assert.equal(el('architect-fallback-enabled').disabled, true);
  assert.equal(el('architect-fallback-enabled').checked, false);
  assert.match(el('architect-selection').textContent, /Claude.*billing/);
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-model').value, claude.value, 'Refresh preserves Claude');
  await el('run-form').handlers.submit({preventDefault(){}});
  assert.equal(runs.at(-1).architect_model, claude.value);
  assert.equal(runs.at(-1).architect_fallback_enabled, false, 'Explicit Claude never enables fallback');
  job={status:'completed', config:{prompt:'task',openai_model:'synth',ollama_model:'a',architect_model:claude.value}, stages:[{name:'architect', provider:'anthropic',model:'claude-actual',status:'completed',error:'',output:'design'},{name:'synthesis',provider:'openai',model:'synth',status:'completed',error:'',output:'answer'}]};
  vm.runInContext('loaded = false', ctx); await vm.runInContext('poll()', ctx);
  assert.equal(el('architect-model').value, claude.value, 'Saved Claude restores');
  assert.match(el('architect-provider').textContent, /Claude.*claude-actual/);
  models.architects=[]; models.providers.anthropic.status='unavailable';
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-model').value, '', 'Unavailable Claude needs explicit reselection');
  assert.equal(el('run').disabled, true);
  assert.match(el('architect-models-status').textContent, /choose.*architect/i);
  assert.match(el('architect-provider').textContent, /Claude.*claude-actual/, 'Saved identity survives catalog loss');
  el('architect-model').value='openai:default'; el('architect-model').handlers.change();
  assert.equal(el('run').disabled, false, 'OpenAI default works without Claude');
  assert.match(el('architect-provider').textContent, /Claude.*claude-actual/, 'Next selection cannot relabel saved output');
  models.architects = [claude, {name:'claude-unverified',value:'anthropic:claude-unverified',provider:'anthropic',verified:false,selectable:true}];
  vm.runInContext("preferredFallback = 'anthropic:claude-missing'; fallbackPreference = true", ctx);
  await el('refresh-models').handlers.click();
  assert.equal(el('architect-model').children.some(c => c.value === 'anthropic:claude-unverified'), false);
  assert.equal(el('architect-fallback-enabled').disabled, true, 'Missing previous backup does not silently switch');
  assert.equal(el('architect-fallback-enabled').checked, false);
  assert.match(el('architect-fallback-status').textContent, /Previous backup unavailable/);
  await el('run-form').handlers.submit({preventDefault(){}});
  assert.equal(runs.at(-1).architect_fallback_enabled, false);
  assert.equal(Object.hasOwn(runs.at(-1), 'architect_fallback_model'), false, 'Unavailable backup is never submitted');
  console.log('UI behavior checks passed (providers, Claude architect, usage, four-stage analysis lifecycle, identity, history and reset)');
}
const test = require('node:test');
test('existing UI behavior checks', main);

async function reloadOptions(saved) {
  const elements = new Map();
  const el = id => markupElement(elements, id);
  const historical = {architect: 'openai:historical', model: 'anthropic:claude-old', enabled: true};
  const job = {status: 'completed', config: {prompt: 'historical task', openai_model: 'synth', ollama_model: 'a',
    architect_model: historical.architect, architect_fallback_model: historical.model,
    architect_fallback_enabled: historical.enabled}, stages: [
    {name: 'architect', provider: 'openai', model: 'historical', status: 'completed', output: 'old design', error: ''}]};
  const models = {models: [{name: 'a'}], default: 'a', architects: ['claude-old', 'claude-next'].map(name =>
    ({name, value: 'anthropic:' + name, provider: 'anthropic', verified: true, selectable: true}))};
  const storage = saved === null ? null : JSON.stringify(saved);
  const ctx = vm.createContext({document: {getElementById: el, createElement: () => new Element()},
    localStorage: {getItem: () => storage, setItem: () => {}},
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async path => ({ok: true, json: async () => path === '/api/models' ? models : {job}})});
  vm.runInContext(fs.readFileSync('static/app.js', 'utf8'), ctx);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const expected = {...historical, ...saved};
  assert.equal(el('architect-model').value, expected.architect, 'Next architect preference wins independently');
  assert.ok(el('architect-fallback-status').textContent.includes('Automatic backup: ' + expected.model.replace('anthropic:', '')), 'Next fallback model preference wins independently');
  assert.equal(el('architect-fallback-enabled').checked, expected.enabled, 'Next fallback toggle preference wins independently');
  assert.match(el('architect-provider').textContent, /OpenAI.*historical/, 'Historical output identity is unchanged');
  assert.equal(el('architect-output').textContent, 'old design');
}
test('reload: saved architect overrides conflicting historical architect only', () => reloadOptions({architect: 'openai:next'}));
test('reload: saved fallback model overrides conflicting historical model only', () => reloadOptions({model: 'anthropic:claude-next'}));
test('reload: saved disabled fallback overrides historical enabled only', () => reloadOptions({enabled: false}));
test('reload: all saved next-run preferences override historical options', () => reloadOptions({architect: 'openai:next', model: 'anthropic:claude-next', enabled: false}));
test('reload: absent saved preferences restore legacy historical options', () => reloadOptions(null));
test('reload: empty saved preferences restore legacy historical options', () => reloadOptions({}));
test('markup has one architect dropdown, named GPT entry, and no backup selector', () => {
  assert.equal([...markup.matchAll(/<select\b[^>]*id="architect-model"/g)].length, 1);
  assert.ok(!markup.includes('architect-fallback-model'));
  assert.match(markup, /ChatGPT \/ OpenAI — gpt-5\.5/);
  assert.match(markup, /OpenAI model \(synthesis \+ analysis only\)/);
});
