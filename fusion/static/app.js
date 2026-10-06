'use strict';
const byId = id => document.getElementById(id);
const form = byId('run-form');
const button = byId('run');
let submitting = false;
let timer;
let loaded = false;
let lastJob = null;

async function request(path, options = {}) {
  const response = await fetch(path, {cache: 'no-store', ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

// BEGIN OUTPUT COPY
const copyStages = ['architect', 'builder', 'synthesis'];
const copyTexts = new Map();
function updateCopyButtons() {
  for (const name of copyStages) {
    const text = byId(`${name}-output`).textContent;
    const control = byId(`${name}-copy`);
    control.disabled = !text;
    if (copyTexts.get(name) !== text) {
      control.textContent = 'Copy';
      byId(`${name}-copy-status`).textContent = '';
      copyTexts.set(name, text);
    }
  }
}
function legacyCopyOutput(text) {
  const active = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } finally {
    field.remove();
    if (active && active.focus) active.focus({preventScroll: true});
  }
}
for (const name of copyStages) {
  byId(`${name}-copy`).addEventListener('click', async () => {
    const text = byId(`${name}-output`).textContent;
    if (!text) return;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) { /* Try the local compatibility path if permission is denied. */ }
    if (!copied) {
      try { copied = legacyCopyOutput(text); } catch (_) { /* Show a truthful error below. */ }
    }
    // A new run may have replaced the output while clipboard permission was pending.
    if (byId(`${name}-output`).textContent !== text) return;
    byId(`${name}-copy`).textContent = copied ? 'Copied!' : 'Copy';
    byId(`${name}-copy-status`).textContent = copied ? 'Copied to clipboard.' : 'Copy unavailable — select the text and copy manually.';
  });
}
updateCopyButtons();
// END OUTPUT COPY

function render(job) {
  const running = Boolean(job && job.status === 'running');
  button.disabled = submitting || running;
  byId('status').textContent = !job ? 'Ready' : running ? 'Working — stages run in sequence…' :
    job.status === 'partial_failure' ? 'Finished with stage errors. Available outputs are preserved.' : 'Complete';
  for (const name of copyStages) {
    if (!job || !job.stages.some(stage => stage.name === name)) {
      byId(`${name}-output`).textContent = '';
    }
  }
  if (!job) { updateCopyButtons(); return; }
  if (!loaded) {
    byId('prompt').value = job.config.prompt;
    byId('openai-model').value = job.config.openai_model;
    byId('ollama-model').value = job.config.ollama_model;
  }
  const names = new Set(['architect', 'builder', 'synthesis']);
  for (const stage of job.stages) {
    if (!names.has(stage.name)) continue;
    byId(`${stage.name}-status`).textContent = stage.status;
    byId(`${stage.name}-error`).textContent = stage.error;
    byId(`${stage.name}-output`).textContent = stage.output;
  }
  updateCopyButtons();
}

async function poll() {
  clearTimeout(timer);
  try {
    const data = await request('/api/job');
    lastJob = data.job;
    render(lastJob);
    loaded = true;
    byId('error').textContent = '';
  } catch (_) {
    button.disabled = true;
    byId('error').textContent = 'Cannot reach Fusion. Check that the server is running; reconnecting automatically. Existing outputs remain visible.';
    byId('status').textContent = 'Disconnected';
  } finally {
    timer = setTimeout(poll, 1200);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  if (!byId('prompt').value.trim()) {
    byId('error').textContent = 'Enter a nonempty prompt.';
    return;
  }
  submitting = true;
  button.disabled = true;
  byId('error').textContent = '';
  try {
    await request('/api/run', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt: byId('prompt').value,
        openai_model: byId('openai-model').value.trim(),
        ollama_model: byId('ollama-model').value.trim()})
    });
    submitting = false;
    await poll();
  } catch (error) {
    byId('error').textContent = error.message;
  } finally {
    submitting = false;
    button.disabled = Boolean(lastJob && lastJob.status === 'running');
  }
});
button.disabled = true;
poll();
