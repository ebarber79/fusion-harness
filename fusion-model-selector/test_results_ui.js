'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/index.html', 'utf8');
const css = fs.readFileSync('static/style.css', 'utf8');
const source = fs.readFileSync('static/app.js', 'utf8');
const names = ['architect', 'builder', 'synthesis', 'analysis'];
function fixture() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], {textContent: '', className: '', hidden: false, disabled: false, attrs: {}, handlers: {}, addEventListener(k, fn) {this.handlers[k]=fn;}, setAttribute(k,v) {this.attrs[k]=v;}}]));
  const ctx = vm.createContext({byId: id => {assert.ok(elements.has(id), id); return elements.get(id);}, loaded: true, viewId: null, lastJob: null, renderUsage() {}, updateRunButton() {}, updateCopyButtons() {}});
  vm.runInContext(source.slice(source.indexOf('function render(job) {'), source.indexOf('async function refreshHistory()')), ctx);
  vm.runInContext(source.slice(source.indexOf('// END OUTPUT COPY') + '// END OUTPUT COPY'.length, source.indexOf('function render(job) {')), ctx);
  return {el: id => elements.get(id), render: job => {ctx.job=job; vm.runInContext('render(job)', ctx);}, toggle: name => elements.get(name+'-expand').handlers.click()};
}
const job = (id='one', status='completed', output='  raw <script> π\n') => ({id, status, config:{prompt:'fixture'}, stages:names.map(name=>({name,status,output}))});
test('reading controls wire native click handlers without submitting the form', () => {
  assert.match(source, /byId\(`\$\{name\}-expand`\)\.addEventListener\('click', \(\) => toggleReading\(name\)\)/);
});
test('all panels start compact with accessible guidance and disabled full-width controls', () => {
  for (const name of names) {
    assert.match(html, new RegExp(`<article class="panel" id="${name}-panel">`));
    assert.match(html, new RegExp(`id="${name}-expand"[^>]*type="button"[^>]*aria-label="Expand [^"]+ output to full width"[^>]*aria-controls="${name}-panel"[^>]*aria-expanded="false"[^>]*disabled`));
    assert.match(html, new RegExp(`id="${name}-empty"[^>]*role="status"[^>]*aria-live="polite">Run Fusion`));
    assert.match(html, new RegExp(`<pre id="${name}-output" tabindex="0" hidden>`));
  }
  assert.match(css, /\.panel pre:empty\s*\{\s*display:\s*none/);
  assert.match(css, /\.panel\.is-expanded\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.panel pre\s*\{\s*min-height:\s*0/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none/);
});
test('idle reset and in-flight states never imply completed output', () => {
  const f=fixture(); f.render(null);
  for(const name of names) {assert.equal(f.el(name+'-output').hidden,true); assert.match(f.el(name+'-empty').textContent,/Run Fusion/); assert.equal(f.el(name+'-expand').disabled,true);}
  f.render(job('one','running',''));
  assert.match(f.el('architect-empty').textContent,/in progress.*finish/i);
  const pending=job('one','running',''); pending.stages[1].status='pending'; f.render(pending);
  assert.match(f.el('builder-empty').textContent,/Waiting.*earlier stages/i);
  f.render(null); assert.match(f.el('builder-empty').textContent,/Run Fusion/);
});
for(const status of ['error','interrupted','storage_error','completed']) test(status+' empty outputs show truthful guidance',()=>{
  const f=fixture(); const j=job('one',status,''); j.stages[0].error='<literal error>'; f.render(j);
  assert.equal(f.el('architect-output').hidden,true);
  assert.match(f.el('architect-empty').textContent,status==='completed'?/No output.*returned/i:/No output.*stage.*(error|interrupted|storage error)/i);
  assert.equal(f.el('architect-error').textContent,'<literal error>');
  assert.equal(f.el('architect-expand').disabled,true);
});
test('completed raw output expands independently, persists on polling, collapses on new view/reset',()=>{
  const f=fixture(); f.render(job());
  for(const name of names) {
    assert.equal(f.el(name+'-output').textContent,'  raw <script> π\n'); assert.equal(f.el(name+'-output').hidden,false); assert.equal(f.el(name+'-empty').hidden,true);
    assert.equal(f.el(name+'-expand').disabled,false); f.toggle(name);
    assert.equal(f.el(name+'-panel').className,'panel is-expanded'); assert.equal(f.el(name+'-expand').attrs['aria-expanded'],'true');
    assert.match(f.el(name+'-expand').attrs['aria-label'],/^Collapse/);
  }
  f.render(job()); assert.equal(f.el('builder-panel').className,'panel is-expanded');
  f.toggle('builder'); assert.equal(f.el('builder-panel').className,'panel');
  f.render(job('history')); for(const name of names) assert.equal(f.el(name+'-expand').attrs['aria-expanded'],'false');
  f.toggle('architect'); f.render(null); assert.equal(f.el('architect-panel').className,'panel');
  f.toggle('architect'); assert.equal(f.el('architect-panel').className,'panel');
});
test('legacy history keeps missing stages compact and preserved failed outputs readable',()=>{
  const f=fixture(); const j=job(); j.stages.pop(); j.stages[0].status='error'; f.render(j);
  assert.match(f.el('analysis-empty').textContent,/not included.*saved run/i); assert.equal(f.el('analysis-expand').disabled,true);
  assert.equal(f.el('architect-output').hidden,false); f.toggle('architect'); assert.equal(f.el('architect-panel').className,'panel is-expanded');
  j.stages[0].output=''; f.render(j); assert.equal(f.el('architect-panel').className,'panel');
});
