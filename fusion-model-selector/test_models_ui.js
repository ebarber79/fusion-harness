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
async function main() {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
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
  assert.doesNotMatch(el('architect-models-status').textContent, /Claude|Anthropic/i, 'Only OpenAI architecture remains');
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
  console.log('UI behavior checks passed (providers, usage, four-stage analysis lifecycle, identity, history and reset)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
