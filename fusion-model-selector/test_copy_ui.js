'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const names = ['architect', 'builder', 'synthesis', 'analysis'];
const html = fs.readFileSync('static/index.html', 'utf8');
function setup(clipboard, legacyOK = true) {
  const elements = new Map();
  for (const name of names) {
    elements.set(`${name}-output`, {textContent: ''});
    elements.set(`${name}-copy`, {textContent: 'Copy', disabled: true, addEventListener(event, fn) {this[event] = fn;}});
    elements.set(`${name}-copy-status`, {textContent: ''});
  }
  const copied = [];
  const document = {getElementById: id => elements.get(id), activeElement: {focus() {}},
    createElement: () => ({style: {}, value: '', setAttribute() {}, select() {}, remove() {}}),
    body: {appendChild(el) {copied.push(el.value);}}, execCommand: () => legacyOK};
  const ctx = vm.createContext({document, navigator: {clipboard}, byId: id => elements.get(id)});
  const source = fs.readFileSync('static/app.js', 'utf8');
  const block = source.match(/\/\/ BEGIN OUTPUT COPY([\s\S]*?)\/\/ END OUTPUT COPY/);
  assert.ok(block, 'Output copy implementation exists');
  vm.runInContext(block[1], ctx);
  return {elements, copied, update: () => vm.runInContext('updateCopyButtons()', ctx)};
}
test('all four panels have accessible small copy controls', () => {
  for (const name of names) {
    assert.match(html, new RegExp(`<button[^>]*id="${name}-copy"[^>]*type="button"[^>]*aria-label="Copy [^"]+ output"[^>]*disabled`));
    assert.match(html, new RegExp(`id="${name}-copy-status"[^>]*role="status"`));
  }
});
test('copy controls sit alongside each panel title', () => {
  for (const name of names) {
    assert.match(html, new RegExp(`<div class="panel-heading"><h2>[\\s\\S]*?id="${name}-provider"[\\s\\S]*?</h2><div class="output-tools">[\\s\\S]*?id="${name}-copy"[\\s\\S]*?</button></div></div>`));
  }
});
test('copy exact current output for every stage, with empty/reset lifecycle', async () => {
  const writes = [];
  const s = setup({writeText: async text => writes.push(text)});
  for (const name of names) {
    const button = s.elements.get(`${name}-copy`);
    const output = s.elements.get(`${name}-output`);
    s.update(); assert.equal(button.disabled, true);
    await button.click(); assert.equal(writes.length, names.indexOf(name));
    output.textContent = `  ${name}\n<literal> π\n`;
    s.update(); assert.equal(button.disabled, false);
    await button.click(); assert.equal(writes.at(-1), output.textContent);
    assert.equal(button.textContent, 'Copied!');
    s.update(); assert.equal(button.textContent, 'Copied!', 'Polling preserves confirmation');
    output.textContent = ''; s.update();
    assert.equal(button.disabled, true); assert.equal(button.textContent, 'Copy');
    assert.equal(s.elements.get(`${name}-copy-status`).textContent, '');
  }
});
test('legacy clipboard fallback works without modern API', async () => {
  const s = setup(undefined);
  s.elements.get('builder-output').textContent = 'fallback text'; s.update();
  await s.elements.get('builder-copy').click();
  assert.deepEqual(s.copied, ['fallback text']);
  assert.equal(s.elements.get('builder-copy').textContent, 'Copied!');
});
test('rejected clipboard falls back and failure offers manual copy without claiming success', async () => {
  const s = setup({writeText: async () => {throw new Error('denied');}}, false);
  s.elements.get('analysis-output').textContent = 'keep this'; s.update();
  await s.elements.get('analysis-copy').click();
  assert.equal(s.elements.get('analysis-copy').textContent, 'Copy');
  assert.match(s.elements.get('analysis-copy-status').textContent, /select.*manually/i);
  assert.equal(s.elements.get('analysis-output').textContent, 'keep this');
});
