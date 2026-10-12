'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const markup = fs.readFileSync('static/index.html', 'utf8');
const source = fs.readFileSync('static/app.js', 'utf8');
const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
test('real history markup is unique, labelled and export is a download', () => {
  for (const id of ['history-select', 'history-refresh', 'history-latest', 'history-delete', 'history-export', 'history-status', 'history-prompt']) {
    assert.equal(ids.filter(value => value === id).length, 1, id);
  }
  assert.match(markup, /<label for="history-select">/);
  assert.match(markup, /<a[^>]*id="history-export"[^>]*download/);
  assert.match(markup, /private local history/i);
});

class Element {
  constructor() { this.children = []; this.handlers = {}; this.value = ''; this.disabled = false; this.textContent = ''; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  removeAttribute(name) { delete this[name]; }
  setAttribute(name, value) { this[name] = value; }
}
const response = data => ({ok: true, json: async () => data});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const run = (id, status = 'completed', output = id) => ({id, status, config: {prompt: 'prompt-' + id, openai_model: 'gpt-5.5', ollama_model: 'a'}, stages: [{name: 'architect', status: 'completed', output, provider: 'openai', model: 'actual-' + id}]});
function fixture() {
  const elements = new Map(ids.map(id => [id, new Element()]));
  elements.get('openai-model').value = 'gpt-5.5';
  let latest = run('latest'); let runs = [latest, run('old')];
  const queues = new Map(); const calls = []; let confirmed = false; let confirmations = 0; let timers = 0;
  const ctx = vm.createContext({document: {getElementById: id => { assert.ok(elements.has(id), 'unknown markup ID ' + id); return elements.get(id); }, createElement: () => new Element()},
    setTimeout: () => ++timers, clearTimeout() {}, confirm: () => {confirmations++; return confirmed;},
    fetch: async (path, options = {}) => {
      calls.push([path, options]);
      const queue = queues.get(path); if (queue?.length) return await queue.shift().promise;
      if (path === '/api/models') return response({models: [{name: 'a'}], default: 'a'});
      if (path === '/api/job') return response({job: latest});
      if (path === '/api/run') { latest = run('accepted', 'running'); return response({id: latest.id}); }
      if (path === '/api/history') return response({runs});
      if (path.startsWith('/api/history?id=')) {
        const id = decodeURIComponent(path.split('=')[1]);
        if (options.method === 'DELETE') { runs = runs.filter(run => run.id !== id); return response({deleted: id}); }
        return response({job: runs.find(run => run.id === id)});
      }
      throw new Error('unexpected fetch ' + path);
    }});
  vm.runInContext(source, ctx);
  return {ctx, el: id => elements.get(id), eval: code => vm.runInContext(code, ctx), calls,
    hold: path => {const value = deferred(); if (!queues.has(path)) queues.set(path, []); queues.get(path).push(value); return value;},
    setLatest: value => {latest = value;}, setRuns: value => {runs = value;}, confirm: value => {confirmed = value;}, confirmations: () => confirmations, timers: () => timers};
}

test('browse history safely without restoring next-run selections or replacing active job', async () => {
  const f = fixture(); await flush();
  f.el('prompt').value = 'next request';
  f.setRuns([run('old', 'interrupted', '<img onerror=evil()>')]);
  await f.eval('refreshHistory()');
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  assert.equal(f.el('architect-output').textContent, '<img onerror=evil()>');
  assert.match(f.el('architect-provider').textContent, /actual-old/);
  assert.equal(f.el('prompt').value, 'next request');
  assert.equal(f.eval('activeJob.id'), 'latest');
  assert.equal(f.el('history-prompt').textContent, 'prompt-old');
  assert.match(f.el('history-export').href, /id=old/);
  f.setLatest(run('active', 'running')); await f.eval('poll()');
  assert.equal(f.el('architect-output').textContent, '<img onerror=evil()>');
  assert.equal(f.el('run').disabled, true, 'browsing completed history cannot bypass active run');
  await f.el('history-latest').handlers.click();
  assert.equal(f.el('architect-output').textContent, 'active');
});

test('history selection ignores out-of-order results, including selecting the same ID again', async () => {
  const f = fixture(); await flush();
  const first = f.hold('/api/history?id=old');
  f.el('history-select').value = 'old'; const pending = f.el('history-select').handlers.change();
  f.el('history-select').value = ''; await f.el('history-select').handlers.change();
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  first.resolve(response({job: run('old', 'completed', 'obsolete')})); await pending;
  assert.equal(f.el('architect-output').textContent, 'old');
  assert.equal(f.eval('activeJob.id'), 'latest');
});

test('returning to latest invalidates pending historical results and errors', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush();
    const held = f.hold('/api/history?id=old');
    f.el('history-select').value = 'old'; const pending = f.el('history-select').handlers.change();
    await f.el('history-latest').handlers.click();
    if (fails) held.reject(new Error('late failure'));
    else held.resolve(response({job: run('old')}));
    await pending;
    assert.equal(f.eval('viewId'), null);
    assert.equal(f.el('architect-output').textContent, 'latest');
    assert.equal(f.el('history-status').textContent, 'Viewing active / latest run.');
    assert.match(f.el('history-export').href, /id=latest/);
  }
});

test('only the newest poll may update active state, connection errors or the poll timer', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush();
    f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
    const held = f.hold('/api/job'); const pending = f.eval('poll()');
    f.setLatest(run('active', 'running')); await f.eval('poll()');
    const timers = f.timers();
    if (fails) held.reject(new Error('obsolete disconnect'));
    else held.resolve(response({job: run('obsolete', 'completed')}));
    await pending;
    assert.equal(f.eval('activeJob.id'), 'active');
    assert.equal(f.eval('connected'), true);
    assert.equal(f.el('run').disabled, true);
    assert.equal(f.el('architect-output').textContent, 'old');
    assert.equal(f.el('error').textContent, '');
    assert.notEqual(f.el('status').textContent, 'Disconnected');
    assert.equal(f.timers(), timers, 'obsolete poll must not create another poll loop');
    await f.el('history-latest').handlers.click();
    assert.equal(f.el('architect-output').textContent, 'active');
  }
});

test('a stale successful poll cannot hide the newest disconnect', async () => {
  const f = fixture(); await flush();
  const old = f.hold('/api/job'); const first = f.eval('poll()');
  const current = f.hold('/api/job'); const second = f.eval('poll()');
  current.reject(new Error('current disconnect')); await second;
  old.resolve(response({job: run('obsolete')})); await first;
  assert.equal(f.eval('connected'), false);
  assert.equal(f.el('run').disabled, true);
  assert.match(f.el('error').textContent, /Cannot reach Fusion/);
  assert.equal(f.el('architect-output').textContent, 'latest');
});

test('history refresh ignores older list responses and errors', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush();
    const held = f.hold('/api/history'); const pending = f.eval('refreshHistory()');
    f.setRuns([run('fresh')]); await f.eval('refreshHistory()');
    if (fails) held.reject(new Error('obsolete history error'));
    else held.resolve(response({runs: [run('obsolete')]}));
    await pending;
    assert.deepEqual(f.el('history-select').children.map(option => option.value), ['', 'fresh']);
    assert.equal(f.el('history-status').textContent, 'Viewing active / latest run.');
  }
});

test('history refresh started before a view change cannot overwrite its status', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush();
    const held = f.hold('/api/history'); const pending = f.eval('refreshHistory()');
    const selection = f.hold('/api/history?id=old');
    f.el('history-select').value = 'old'; const selecting = f.el('history-select').handlers.change();
    selection.reject(new Error('selected run unavailable')); await selecting;
    const status = f.el('history-status').textContent;
    assert.match(status, /Saved run unavailable/);
    if (fails) held.reject(new Error('late history error'));
    else held.resolve(response({runs: [run('old')]}));
    await pending;
    assert.equal(f.el('history-status').textContent, status);
    assert.equal(f.el('history-select').value, 'old');
    assert.equal(f.el('architect-output').textContent, 'latest');
  }
});

test('an accepted run switches from history to latest and invalidates pending historical loads', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush();
    const held = f.hold('/api/history?id=old');
    f.el('history-select').value = 'old'; const selecting = f.el('history-select').handlers.change();
    f.el('prompt').value = 'new request';
    await f.el('run-form').handlers.submit({preventDefault() {}});
    if (fails) held.reject(new Error('obsolete saved run error'));
    else held.resolve(response({job: run('old')}));
    await selecting;
    assert.equal(f.eval('viewId'), null);
    assert.equal(f.el('history-select').value, '');
    assert.equal(f.eval('activeJob.id'), 'accepted');
    assert.equal(f.el('architect-output').textContent, 'accepted');
    assert.equal(f.el('history-status').textContent, 'Viewing active / latest run.');
    assert.equal(f.el('run').disabled, true);
    assert.equal(f.el('prompt').value, 'new request');
  }
});

test('deletion invalidates an in-flight reload of the deleted run', async () => {
  const f = fixture(); await flush(); f.confirm(true);
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  const held = f.hold('/api/history?id=old'); const selecting = f.el('history-select').handlers.change();
  await f.el('history-delete').handlers.click();
  held.resolve(response({job: run('old')})); await selecting;
  assert.equal(f.eval('viewId'), null);
  assert.equal(f.el('architect-output').textContent, 'latest');
  assert.equal(f.el('history-status').textContent, 'Viewing active / latest run.');
});

test('deletion finishing after navigation cannot replace the new view or its status', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await flush(); f.confirm(true);
    f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
    const held = f.hold('/api/history?id=old'); const deleting = f.el('history-delete').handlers.click();
    f.el('history-select').value = 'latest'; await f.el('history-select').handlers.change();
    if (fails) held.reject(new Error('obsolete deletion error'));
    else held.resolve(response({deleted: 'old'}));
    await deleting;
    assert.equal(f.eval('viewId'), 'latest');
    assert.equal(f.el('history-select').value, 'latest');
    assert.equal(f.el('architect-output').textContent, 'latest');
    assert.equal(f.el('history-status').textContent, 'Viewing saved run; next-run choices are unchanged.');
  }
});

test('an accepted run stays submission-locked until its active job poll settles', async () => {
  const f = fixture(); await flush();
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  f.el('prompt').value = 'new request';
  const held = f.hold('/api/job');
  const submitting = f.el('run-form').handlers.submit({preventDefault() {}});
  await flush();
  assert.equal(f.el('run').disabled, true);
  await f.el('run-form').handlers.submit({preventDefault() {}});
  assert.equal(f.calls.filter(([path]) => path === '/api/run').length, 1);
  held.resolve(response({job: run('accepted', 'running')})); await submitting;
  assert.equal(f.eval('activeJob.id'), 'accepted');
  assert.equal(f.el('run').disabled, true);
});

test('history deletion requires confirmation and active history cannot be deleted', async () => {
  const f = fixture(); await flush();
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  await f.el('history-delete').handlers.click();
  assert.equal(f.confirmations(), 1);
  assert.equal(f.calls.filter(([_, options]) => options.method === 'DELETE').length, 0);
  f.confirm(true); await f.el('history-delete').handlers.click();
  assert.equal(f.calls.filter(([_, options]) => options.method === 'DELETE').length, 1);
  assert.equal(f.eval('viewId'), null);
  f.setLatest(run('active', 'running')); await f.eval('poll()');
  assert.equal(f.el('history-delete').disabled, true);
});

test('progress strip mirrors each stage status, and Reset view collapses panels and returns to the active run', async () => {
  const f = fixture(); await flush();
  const job = {id: 'p', status: 'partial_failure', config: {prompt: 'x', openai_model: 'gpt-5.5', ollama_model: 'a'}, stages: [
    {name: 'architect', status: 'completed', output: 'arch'}, {name: 'builder', status: 'error', output: '', error: 'boom'},
    {name: 'synthesis', status: 'completed', output: 'syn'}, {name: 'analysis', status: 'running', output: ''}]};
  f.eval(`render(${JSON.stringify(job)})`);
  assert.equal(f.el('progress-architect').className, 'step is-completed');
  assert.equal(f.el('progress-builder').className, 'step is-error');
  assert.equal(f.el('progress-synthesis').className, 'step is-completed');
  assert.equal(f.el('progress-analysis').className, 'step is-running');
  assert.equal(f.el('progress-analysis')['aria-current'], 'step');
  f.eval('render(null)');
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) assert.equal(f.el(`progress-${name}`).className, 'step is-pending');
  await f.eval('refreshHistory()');
  f.el('history-select').value = 'old'; await f.el('history-select').handlers.change();
  f.el('architect-expand').handlers.click();
  assert.equal(f.el('architect-panel').className, 'panel is-expanded');
  await f.el('history-latest').handlers.click();
  assert.equal(f.el('history-select').value, '');
  assert.equal(f.el('architect-output').textContent, 'latest');
  assert.equal(f.el('architect-panel').className, 'panel');
  assert.equal(f.el('history-status').textContent, 'Viewing active / latest run.');
});
