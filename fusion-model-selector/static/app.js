'use strict';
const byId = id => document.getElementById(id);
const form = byId('run-form');
const button = byId('run');
const modelSelect = byId('ollama-model');
const refreshButton = byId('refresh-models');
let submitting = false;
let timer;
let loaded = false;
let lastJob = null;
let connected = false;
let modelNames = new Set();
let modelsLoading = true;
let preferredModel = null;
const architectSelect = byId('architect-model');
let architectNames = new Set(['openai:default']);
let architectsLoading = true;
let preferredArchitect = 'openai:default';
const unsupportedOpenAI = name => /image|audio|realtime|transcrib|tts|whisper|embedding|moderation|deep-research|search|instruct|gpt-oss/i.test(name) ||
  /^(?:gpt-3\.5-|gpt-4-turbo|gpt-4-0125|gpt-4-1106|o1-preview-|o1-mini-|chatgpt-|babbage-|davinci-|text-|dall-e-)/.test(name) ||
  ['gpt-4', 'gpt-4-0314', 'gpt-4-0613', 'o1-preview', 'o1-mini'].includes(name);
const openAITextModel = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(name) &&
  !unsupportedOpenAI(name) && (/^(?:gpt-(?:4o|4\.[1-9][0-9]*|[5-9][0-9]*(?:\.[0-9]+)?)(?:-|$)|o[1-9][0-9]*(?:-|$))/.test(name) || name === 'codex-mini-latest');
function selectArchitect() {
  if (typeof preferredArchitect === 'string' && /^(?:openai:)?[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/.test(preferredArchitect) && !unsupportedOpenAI(preferredArchitect.replace(/^openai:/, '')) && !architectNames.has(preferredArchitect)) {
    const option = document.createElement('option');
    option.value = preferredArchitect;
    option.textContent = `ChatGPT / OpenAI — ${preferredArchitect.replace(/^openai:/, '')} (restored architect; not catalog verified)`;
    architectSelect.appendChild(option);
    architectNames.add(preferredArchitect);
  }
  architectSelect.value = architectNames.has(preferredArchitect) ? preferredArchitect : '';
  if (!architectSelect.value) byId('architect-models-status').textContent += ' Previous architect unavailable — choose an available architect.';
}
let selectedFallback = '';
const fallbackToggle = byId('architect-fallback-enabled');
let fallbackNames = new Set();
let preferredFallback = null;
let fallbackPreference = null;
// Saved next-run choices take precedence independently over historical job options.
const savedArchitectFields = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('fusion-architect-options'));
  if (saved && typeof saved.architect === 'string') { preferredArchitect = saved.architect; savedArchitectFields.add('architect'); }
  if (saved && typeof saved.model === 'string') { preferredFallback = saved.model; savedArchitectFields.add('model'); }
  if (saved && typeof saved.enabled === 'boolean') { fallbackPreference = saved.enabled; savedArchitectFields.add('enabled'); }
} catch (_) { /* Storage can be unavailable; job restoration still works. */ }
function saveArchitectOptions() {
  try { localStorage.setItem('fusion-architect-options', JSON.stringify({architect: preferredArchitect, model: preferredFallback, enabled: fallbackPreference})); } catch (_) {}
}
function selectFallback() {
  const wanted = preferredFallback === null ? fallbackNames.values().next().value : preferredFallback;
  selectedFallback = fallbackNames.has(wanted) ? wanted : '';
  if (preferredFallback === null && wanted) preferredFallback = wanted;
  const openaiSelected = architectNames.has(architectSelect.value) && !architectSelect.value.startsWith('anthropic:');
  fallbackToggle.checked = openaiSelected && (fallbackPreference === null ? true : fallbackPreference) && fallbackNames.has(selectedFallback);
  fallbackToggle.disabled = !fallbackNames.has(selectedFallback) || architectsLoading || !openaiSelected;
  byId('architect-fallback-status').textContent = 'If the OpenAI architect fails, the same prompt is sent to Claude once, with added latency and API cost. No other stage falls back. ' +
    (!fallbackNames.size ? 'Claude unavailable: configure an Anthropic API key and Refresh; fallback is disabled.' :
      !selectedFallback ? 'Previous backup unavailable — fallback is disabled; no model was silently substituted.' :
      architectSelect.value.startsWith('anthropic:') ? 'Explicit Claude architecture disables fallback and never falls back to OpenAI.' :
      `Automatic backup: ${selectedFallback.replace('anthropic:', '')}. Catalog verified; generation access and credits are not guaranteed.`);
}
fallbackToggle.addEventListener('change', () => { fallbackPreference = fallbackToggle.checked; saveArchitectOptions(); selectFallback(); updateRunButton(); });
function updateOpenAIArchitectEntry() {
  const option = Array.from(architectSelect.children).find(choice => choice.value === 'openai:default');
  if (option) option.textContent = `ChatGPT / OpenAI — ${byId('openai-model').value.trim() || '(enter synthesis/analysis model)'} (default: follows synthesis/analysis)`;
}
byId('openai-model').addEventListener('input', () => { updateOpenAIArchitectEntry(); updateRunButton(); });
function loadArchitects(data) {
  architectNames = new Set(['openai:default']);
  fallbackNames = new Set();
  architectSelect.replaceChildren();
  const option = document.createElement('option');
  option.value = 'openai:default';
  option.textContent = `ChatGPT / OpenAI — ${byId('openai-model').value.trim()} (default: follows synthesis/analysis)`;
  architectSelect.appendChild(option);
  for (const model of Array.isArray(data.architects) ? data.architects : []) {
    if (!model || model.verified !== true || model.selectable !== true ||
        !['openai', 'anthropic'].includes(model.provider) || typeof model.name !== 'string' ||
        model.value !== model.provider + ':' + model.name || architectNames.has(model.value)) continue;
    const openai = model.provider === 'openai';
    if (openai ? !openAITextModel(model.name) : !/^claude-[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(model.name) || /image|audio|embedding|video/i.test(model.name)) continue;
    architectNames.add(model.value);
    if (!openai) fallbackNames.add(model.value);
    const choice = document.createElement('option');
    choice.value = model.value;
    choice.textContent = `${openai ? 'ChatGPT / OpenAI' : 'Claude / Anthropic'} · cloud (API billing) — ${model.name} (catalog verified)`;
    architectSelect.appendChild(choice);
  }
  const openaiAvailable = Array.from(architectNames).some(value => value.startsWith('openai:') && value !== 'openai:default');
  byId('architect-models-status').textContent = 'Choose ChatGPT / OpenAI or Claude in this single architect dropdown. The default GPT entry follows the synthesis/analysis model; explicit models are independent. API billing applies; catalog membership does not guarantee generation access or credits.' +
    (openaiAvailable ? ' OpenAI text catalog available.' : ' OpenAI catalog unavailable or empty — default and restored OpenAI remain usable; configure a valid server-side key and Refresh.') +
    (fallbackNames.size ? ' Claude / Anthropic catalog available (architect only).' : ' Anthropic catalog unavailable — no Claude models verified.');
  selectArchitect();
  selectFallback();
}
architectSelect.addEventListener('change', () => { preferredArchitect = architectSelect.value; saveArchitectOptions(); selectFallback(); updateRunButton(); });

async function request(path, options = {}) {
  const response = await fetch(path, {cache: 'no-store', ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function validModel() {
  return !modelsLoading && modelNames.has(modelSelect.value);
}

function providerLabel(value) {
  if (typeof value === 'string' && value.startsWith('perplexity:')) return 'Perplexity · cloud (API + web search billing)';
  return typeof value === 'string' && value.startsWith('xai:') ? 'Grok / xAI · cloud (billing)' : 'Ollama · local';
}

function updateBuilderLabels() {
  byId('builder-selection').textContent = `Next builder: ${providerLabel(modelSelect.value)}`;
  const stage = lastJob && lastJob.stages.find(stage => stage.name === 'builder');
  const value = lastJob ? (stage && ['xai', 'perplexity'].includes(stage.provider) ? stage.provider + ':' : lastJob.config.ollama_model) : modelSelect.value;
  byId('builder-provider').textContent = providerLabel(value) + (stage && stage.model ? ' — ' + stage.model : '');
}

function updateRunButton() {
  updateBuilderLabels();
  byId('architect-selection').textContent = architectSelect.value.startsWith('anthropic:') ? 'Next architect: Claude / Anthropic · cloud (API billing)' : 'Next architect: OpenAI · cloud (billing)';
  for (const name of ['architect', 'synthesis', 'analysis']) {
    const stage = lastJob && lastJob.stages.find(s => s.name === name);
    byId(`${name}-provider`).textContent = stage ? (stage.provider === 'anthropic' ? 'Claude / Anthropic' : 'OpenAI') + ' · ' + (stage.model || lastJob.config.openai_model) +
      (stage.fallback_used === true ? ` · fallback used from OpenAI (${stage.original_model || 'unknown model'})` : '') : 'OpenAI';
  }
  button.disabled = submitting || !connected || !validModel() || architectsLoading || !architectNames.has(architectSelect.value) || Boolean(lastJob && lastJob.status === 'running');
}

function selectPreferred(defaultModel) {
  const wanted = preferredModel === null ? defaultModel : preferredModel;
  modelSelect.value = modelNames.has(wanted) ? wanted : '';
  if (preferredModel !== null && !modelNames.has(preferredModel) && modelNames.size) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Previous model unavailable — choose an available builder';
    modelSelect.appendChild(placeholder);
    modelSelect.value = '';
    byId('models-status').textContent += ' Previous builder model is unavailable. Choose an available builder model.';
  }
}

async function refreshModels() {
  if (modelNames.has(modelSelect.value)) preferredModel = modelSelect.value;
  modelsLoading = true;
  architectsLoading = true;
  fallbackToggle.disabled = true;
  architectSelect.disabled = true;
  byId('architect-models-status').textContent = 'Loading architect models…';
  modelSelect.disabled = true;
  refreshButton.disabled = true;
  byId('models-status').textContent = 'Loading installed models…';
  updateRunButton();
  try {
    const data = await request('/api/models');
    if (!Array.isArray(data.models)) throw new Error('Invalid catalog');
    loadArchitects(data);
    modelNames = new Set();
    modelSelect.replaceChildren();
    const combined = Array.isArray(data.builders);
    const builders = combined ? data.builders : data.models;
    const seen = new Set();
    // Stable grouping, with explicit provider labels; never render upstream markup.
    const ordered = combined ? ['ollama', 'xai', 'perplexity'].flatMap(provider => builders.filter(m => m && m.provider === provider)) : builders;
    for (const model of ordered) {
      if (!model || typeof model.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(model.name)) continue;
      const cloud = combined && ['xai', 'perplexity'].includes(model.provider);
      if (model.provider === 'perplexity' && model.name !== 'perplexity/sonar') continue;
      if (cloud && model.provider === 'xai' && (!/^grok-/.test(model.name) || /imagine|image|video|voice|tts|transcrib|audio|multi[-_]?agent/i.test(model.name) || /[:/]/.test(model.name))) continue;
      const value = cloud ? `${model.provider}:${model.name}` : model.name;
      if (combined && model.value !== value || seen.has(value)) continue;
      seen.add(value);
      const selectable = !combined || model.selectable === true && (!cloud || model.verified === true);
      if (selectable) modelNames.add(value);
      const option = document.createElement('option');
      option.value = value;
      option.disabled = !selectable;
      option.textContent = (combined ? `${providerLabel(value)} — ` : '') + model.name +
        (typeof model.size_label === 'string' ? ` (${model.size_label})` : '') +
        (!selectable ? ' (unverified — not ready)' : cloud ? ' (catalog verified; generation access not guaranteed)' : '');
      modelSelect.appendChild(option);
    }
    const notes = [];
    notes.push(data.models.length ? 'Installed Ollama models only. Refresh after installing a model.' : 'No installed completion models. Install a model in Ollama, then Refresh.');
    if (data.providers && data.providers.ollama && data.providers.ollama.status === 'unavailable') notes.push('Ollama model service unavailable.');
    if (data.providers && data.providers.xai) notes.push(data.providers.xai.status === 'available' ?
      'Grok cloud catalog available. xAI billing applies; generation access is not guaranteed.' :
      'Grok / xAI unverified — not ready. Configure a valid server-side xAI key and Refresh. Documented IDs do not prove access.');
    if (data.providers && data.providers.perplexity) notes.push(data.providers.perplexity.status === 'available' ?
      'Perplexity catalog available. Separate API and web search billing applies; generation access is not guaranteed.' :
      'Perplexity unverified — not ready. Configure a valid server-side Perplexity key and Refresh. Documented IDs do not prove access.');
    byId('models-status').textContent = notes.join(' ');
    const defaultModel = combined ? data.default_builder : data.default;
    selectPreferred(modelNames.has(defaultModel) ? defaultModel : modelNames.values().next().value);
  } catch (_) {
    modelNames = new Set();
    loadArchitects({});
    modelSelect.replaceChildren();
    byId('models-status').textContent = 'Ollama model service unavailable. Check Ollama, then Refresh.';
  } finally {
    modelsLoading = false;
    architectsLoading = false;
    architectSelect.disabled = false;
    selectFallback();
    modelSelect.disabled = !modelNames.size;
    refreshButton.disabled = false;
    updateRunButton();
  }
}

refreshButton.addEventListener('click', refreshModels);
modelSelect.addEventListener('change', () => {
  preferredModel = modelSelect.value;
  updateRunButton();
});

function displayCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unknown';
}

function tokenLine(usage) {
  return `Input ${displayCount(usage && usage.input_tokens)} · Output ${displayCount(usage && usage.output_tokens)} · Total ${displayCount(usage && usage.total_tokens)}`;
}

function renderUsage(job) {
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
    const stage = job && job.stages.find(stage => stage.name === name);
    const usage = stage && ['completed', 'error'].includes(stage.status) ? stage.usage : null;
    byId(`${name}-usage`).textContent = `Reported tokens: ${tokenLine(usage)}` +
      (stage && stage.primary_failure ? ` · Failed OpenAI attempt: ${tokenLine(stage.primary_failure.usage)}` : '');
  }
  const usage = job && job.usage;
  if (!usage) {
    byId('usage-summary').textContent = job ? 'Reported whole-run tokens: unknown — partial/incomplete coverage.' : 'No run — reported token counts appear after stages finish.';
    return;
  }
  const known = usage.known_stages || {};
  byId('usage-summary').textContent = `Reported whole-run tokens (known counts): ${tokenLine(usage)}. ` +
    `Coverage: ${displayCount(usage.complete_stages)}/${displayCount(usage.stage_count)} stages — ${usage.complete === true ? 'complete' : 'partial/incomplete'}. ` +
    `Known stages: input ${displayCount(known.input_tokens)}/${displayCount(usage.stage_count)}, output ${displayCount(known.output_tokens)}/${displayCount(usage.stage_count)}, total ${displayCount(known.total_tokens)}/${displayCount(usage.stage_count)}.` +
    (usage.failed_attempt_count ? ` Includes known failed-attempt counts (${usage.failed_attempt_count} attempt); failed-attempt coverage ${usage.failed_attempts_complete === true ? 'complete' : 'unknown/partial'}.` : '');
}

// BEGIN OUTPUT COPY
const copyStages = ['architect', 'builder', 'synthesis', 'analysis'];
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
  renderUsage(job);
  const running = Boolean(job && job.status === 'running');
  updateRunButton();
  byId('status').textContent = !job ? 'Ready' : running ? 'Working — stages run in sequence…' :
    job.status === 'partial_failure' ? 'Finished with stage errors. Available outputs are preserved.' : 'Complete';
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
    if (!job || !job.stages.some(stage => stage.name === name)) {
      byId(`${name}-status`).textContent = job ? 'Unavailable — not included in this saved run' : 'Pending';
      byId(`${name}-error`).textContent = '';
      byId(`${name}-output`).textContent = '';
    }
  }
  if (!job) { updateCopyButtons(); return; }
  if (!loaded) {
    byId('prompt').value = job.config.prompt;
    byId('openai-model').value = job.config.openai_model;
    updateOpenAIArchitectEntry();
    preferredModel = job.config.ollama_model;
    if (!savedArchitectFields.has('architect')) preferredArchitect = job.config.architect_model || 'openai:default';
    if (!savedArchitectFields.has('model') && typeof job.config.architect_fallback_model === 'string') preferredFallback = job.config.architect_fallback_model;
    if (!savedArchitectFields.has('enabled') && typeof job.config.architect_fallback_enabled === 'boolean') fallbackPreference = job.config.architect_fallback_enabled;
    if (!architectsLoading) selectArchitect();
    if (!architectsLoading) selectFallback();
    if (!modelsLoading) selectPreferred(null);
    updateRunButton();
  }
  const names = new Set(['architect', 'builder', 'synthesis', 'analysis']);
  for (const stage of job.stages) {
    if (!names.has(stage.name)) continue;
    byId(`${stage.name}-status`).textContent = stage.status;
    byId(`${stage.name}-error`).textContent = (stage.error || '') + (stage.primary_failure ? ' ' + stage.primary_failure.error : '');
    byId(`${stage.name}-output`).textContent = stage.output;
  }
  updateCopyButtons();
}

async function poll() {
  clearTimeout(timer);
  try {
    const data = await request('/api/job');
    lastJob = data.job;
    connected = true;
    render(lastJob);
    loaded = true;
    byId('error').textContent = '';
  } catch (_) {
    connected = false;
    button.disabled = true;
    byId('error').textContent = 'Cannot reach Fusion. Check that the server is running; reconnecting automatically. Existing outputs remain visible.';
    byId('status').textContent = 'Disconnected';
  } finally {
    timer = setTimeout(poll, 1200);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !connected || (lastJob && lastJob.status === 'running')) return;
  if (!validModel()) {
    byId('error').textContent = 'Choose an available, verified builder model before running.';
    return;
  }
  if (!byId('prompt').value.trim()) {
    byId('error').textContent = 'Enter a nonempty prompt.';
    return;
  }
  if (architectsLoading || !architectNames.has(architectSelect.value)) {
    byId('error').textContent = 'Choose an available, verified architect model before running.';
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
        ollama_model: modelSelect.value,
        architect_fallback_enabled: !architectSelect.value.startsWith('anthropic:') && fallbackToggle.checked === true && fallbackNames.has(selectedFallback),
        ...(fallbackNames.has(selectedFallback) ? {architect_fallback_model: selectedFallback} : {}),
        ...(architectSelect.value === 'openai:default' ? {} : {architect_model: architectSelect.value})})
    });
    lastJob = null;
    render(null);
    submitting = false;
    await poll();
  } catch (error) {
    byId('error').textContent = error.message;
  } finally {
    submitting = false;
    updateRunButton();
  }
});
button.disabled = true;
refreshModels();
poll();
