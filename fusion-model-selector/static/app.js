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
let activeJob = null;
let viewId = null;
let viewRevision = 0;
let pollRevision = 0;
let historyRevision = 0;
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
  byId('builder-selection').textContent = modelSelect.value ? `Next builder: ${providerLabel(modelSelect.value)} — ${modelSelect.value.replace(/^(?:xai|perplexity):/, '')}` : 'Choose an available builder.';
  const stage = lastJob && lastJob.stages.find(stage => stage.name === 'builder');
  const value = lastJob ? (stage && ['xai', 'perplexity'].includes(stage.provider) ? stage.provider + ':' : lastJob.config.ollama_model) : modelSelect.value;
  byId('builder-provider').textContent = providerLabel(value) + (stage && stage.model ? ' — ' + stage.model : '');
}

function updateRunButton() {
  updateBuilderLabels();
  const architectModel = architectSelect.value === 'openai:default' ? byId('openai-model').value.trim() || '(enter synthesis/analysis model)' : architectSelect.value.replace(/^(?:openai|anthropic):/, '');
  const architectProvider = architectSelect.value.startsWith('anthropic:') ? 'Claude / Anthropic · cloud (API billing)' : 'OpenAI · cloud (billing)';
  byId('architect-selection').textContent = architectSelect.value ? `Next architect: ${architectProvider} — ${architectModel}` : 'Choose an available architect.';
  for (const name of ['architect', 'synthesis', 'analysis']) {
    const stage = lastJob && lastJob.stages.find(s => s.name === name);
    byId(`${name}-provider`).textContent = stage ? (stage.provider === 'anthropic' ? 'Claude / Anthropic' : 'OpenAI') + ' · ' + (stage.model || lastJob.config.openai_model) +
      (stage.fallback_used === true ? ` · fallback used from OpenAI (${stage.original_model || 'unknown model'})` : '') : 'OpenAI';
  }
  button.disabled = submitting || !connected || !validModel() || architectsLoading || !architectNames.has(architectSelect.value) || Boolean(activeJob && ['running', 'storage_error'].includes(activeJob.status));
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
  byId('usage-overview').textContent = usage ?
    `${usage.complete === true ? 'Reported total' : 'Known reported total'}: ${displayCount(usage.total_tokens)} tokens · ${displayCount(usage.complete_stages)}/${displayCount(usage.stage_count)} stages · ${usage.complete === true ? 'complete' : 'partial/incomplete'}` :
    job ? 'Reported total: unknown · partial/incomplete coverage' : 'No run — reported token counts appear after stages finish.';
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

// BEGIN OUTPUT SPEECH
// Optional controls keep legacy DOM fixtures and older cached markup working.
const speechStages = ['architect', 'builder', 'synthesis', 'analysis'];
const speechVoice = byId('speech-voice');
const speechSpeed = byId('speech-speed');
const speechPause = byId('speech-pause');
const speechStop = byId('speech-stop');
const speechStatus = byId('speech-status');
const speechControls = Boolean(speechVoice && speechSpeed && speechPause && speechStop && speechStatus);
const speechEngine = typeof window !== 'undefined' && window.speechSynthesis;
const speechSupported = Boolean(speechEngine && typeof window.SpeechSynthesisUtterance === 'function');
let speechVoices = [];
let piperVoices = [];
const piperSupported = typeof window !== 'undefined' && typeof window.Audio === 'function' && window.URL && typeof fetch === 'function';
let speechJob = null;
let speechChoice = '';
let speechSession = null;
let speechGeneration = 0;
let speechDisplayedId = null;
let speechDisplayedOutputs = [];
function stopSpeech(message = 'Read aloud stopped.') {
  speechGeneration++;
  const previous = speechSession;
  speechSession = null;
  if (previous) {
    if (previous.controller) previous.controller.abort();
    if (previous.next) previous.next.controller.abort();
    releasePiperAudio(previous);
  }
  if (speechSupported) speechEngine.cancel();
  if (!speechControls) return;
  speechPause.disabled = true;
  speechPause.textContent = 'Pause';
  speechStop.disabled = true;
  speechStatus.textContent = message;
}
function pauseSpeech() {
  const session = speechSession;
  if (!session || speechPause.disabled) return;
  session.paused = !session.paused;
  speechPause.textContent = session.paused ? 'Resume' : 'Pause';
  if (session.voice.piper) {
    if (session.paused) {
      session.audio.pause();
      speechStatus.textContent = `Paused ${session.label}.`;
    } else {
      speechStatus.textContent = `Starting ${session.label} read aloud…`;
      if (session.audio) session.audio.play().catch(() => { if (speechSession === session) stopSpeech('Offline audio playback failed. Press Read aloud to retry.'); });
      else speakNextChunk();
    }
    return;
  }
  if (session.paused) {
    // eSpeak/Speech Dispatcher can wedge its queue if native pause/resume is used.
    const cancelOnly = /espeak/i.test(session.voice.name || '');
    if (!cancelOnly) speechEngine.pause();
    if (cancelOnly || speechEngine.paused === false) {
      session.cancelledForPause = true;
      // Some Linux speech backends cannot pause. Replay only the interrupted chunk.
      if (!session.waiting) session.index--;
      session.utterance = null; // Invalidate callbacks before cancel can emit events.
      session.waiting = true;
      speechEngine.cancel();
    }
    speechStatus.textContent = `Paused ${session.label}.`;
  } else {
    if (!session.cancelledForPause) speechEngine.resume();
    session.cancelledForPause = false;
    speechStatus.textContent = session.waiting ? `Starting ${session.label} read aloud…` : `Playing ${session.label}.`;
    if (session.waiting) speakNextChunk();
  }
}
// Speak Markdown as prose. Every rule matches only Markdown syntax, so plain text passes through unchanged.
function speechText(text) {
  const lines = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+#-]*)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      const language = marker[2] && marker[2].charAt(0).toUpperCase() + marker[2].slice(1);
      lines.push(language ? `${language} code block omitted.` : 'Code block omitted.');
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { lines.push(''); continue; }
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('-')) continue;
    let spoken = line;
    // Piper reads straight through line breaks, so list items and bold label lines get a closing pause.
    const pause = /^\s*([-*+]|\d+[.)])\s+\S/.test(line) || /^\s*(\*\*|__)[^*_]+\1\s*$/.test(line);
    const heading = spoken.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (heading) spoken = /[.!?:]$/.test(heading[1]) ? heading[1] : heading[1] + '.';
    else if (/^\s*\|.*\|\s*$/.test(spoken)) {
      const cells = spoken.trim().slice(1, -1).split('|').map(cell => cell.trim()).filter(Boolean);
      spoken = cells.length ? cells.join(', ') + '.' : '';
    } else spoken = spoken.replace(/^\s*>\s?/, '').replace(/^\s*[-*+]\s+/, '');
    spoken = spoken
      .replace(/!\[([^\]]*)\]\([^)\s]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/|#)[^)\s]*\)/g, '$1')
      .replace(/https?:\/\/(?:www\.)?([A-Za-z0-9.-]+)[^\s)\]]*?(?=[.,;:!?]?(?:\s|$|[)\]]))/g, 'link to $1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__/g, (_, a, b) => a || b)
      .replace(/~~(?=\S)(.+?)~~/g, '$1')
      .replace(/(^|[\s(])[*_](?=[^\s*_])([^*_\n]*?[^\s*_])[*_](?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/\s+(?:→|->|⟶)\s+/g, ' to ');
    if (pause) spoken = spoken.trimEnd().replace(/([^.!?:;,])$/, '$1.');
    lines.push(spoken);
  }
  return lines.join('\n');
}
function speechChunks(text) {
  const chunks = [];
  while (text.length) {
    let end = Math.min(220, text.length);
    if (end < text.length) {
      const boundary = text.slice(0, end).match(/[.!?]\s+|\n|\s+/g);
      if (boundary) {
        const last = boundary[boundary.length - 1];
        const split = text.slice(0, end).lastIndexOf(last) + last.length;
        if (split >= 80) end = split;
      }
      // Never split a UTF-16 surrogate pair at a hard boundary.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  return chunks;
}
function speakStage(name) {
  const control = byId(`${name}-speak`);
  if (!speechControls || !control || control.disabled) return;
  const voice = speechVoices.find(v => v.voiceURI === speechVoice.value);
  if (!voice || voice.available === false || (!voice.piper && !speechSupported)) return;
  const label = name === 'analysis' ? 'Reasoning / Divergence' : name.charAt(0).toUpperCase() + name.slice(1);
  stopSpeech();
  speechSession = {chunks: speechChunks(speechText(byId(`${name}-output`).textContent)), index: 0, voice, rate: Number(speechSpeed.value), label, generation: speechGeneration, paused: false, waiting: false};
  speechStop.disabled = false;
  speakNextChunk();
}
function speakNextChunk() {
  const session = speechSession;
  if (!session || session.paused) return;
  session.waiting = false;
  // Piper rejects whitespace-only requests: skip silent chunks without trimming spoken text.
  if (session.voice.piper) {
    while (session.index < session.chunks.length && !session.chunks[session.index].trim()) session.index++;
  }
  if (session.index === session.chunks.length) {
    stopSpeech(`Finished reading ${session.label}.`);
    return;
  }
  if (session.voice.piper) {
    speakPiperChunk(session);
    return;
  }
  const utterance = new window.SpeechSynthesisUtterance(session.chunks[session.index++]);
  utterance.voice = session.voice;
  utterance.lang = session.voice.lang;
  utterance.rate = session.rate;
  speechPause.disabled = true;
  speechStatus.textContent = `Starting ${session.label} read aloud…`;
  const current = () => speechSession === session && speechGeneration === session.generation && session.utterance === utterance;
  utterance.onstart = () => {
    if (!current()) return;
    speechPause.disabled = false;
    speechStatus.textContent = session.paused ? `Paused ${session.label}.` : `Playing ${session.label}.`;
  };
  utterance.onend = () => {
    if (!current()) return;
    session.utterance = null;
    session.waiting = true;
    if (!session.paused) speakNextChunk();
  };
  // Keep a strong reference until the next chunk or cancellation.
  session.utterance = utterance;
  utterance.onerror = () => {
    if (current()) stopSpeech('Read aloud failed. Check browser speech permissions or choose another voice, then try again.');
  };
  try { speechEngine.speak(utterance); }
  catch (_) { if (current()) stopSpeech('Read aloud failed. Check browser speech permissions or choose another voice, then try again.'); }
}
function releasePiperAudio(session) {
  const audio = session.audio;
  session.audio = null;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (session.audioURL) window.URL.revokeObjectURL(session.audioURL);
  session.audioURL = null;
}
function requestPiperChunk(session, index) {
  const controller = new AbortController();
  const promise = fetch('/api/speech', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
    signal: controller.signal,
    body: JSON.stringify({voice: session.voice.piper, text: session.chunks[index], rate: session.rate}),
  }).then(response => {
    if (!response.ok) throw new Error('Offline synthesis unavailable');
    return response.blob();
  });
  promise.catch(() => {}); // A failed prefetch is reported only when its chunk is reached.
  return {index, controller, promise};
}
function prefetchPiperChunk(session) {
  // Synthesize the next spoken chunk while this one plays, hiding most of the per-chunk delay.
  let index = session.index;
  while (index < session.chunks.length && !session.chunks[index].trim()) index++;
  if (session.next || index === session.chunks.length) return;
  session.next = requestPiperChunk(session, index);
}
async function speakPiperChunk(session) {
  const current = () => speechSession === session && speechGeneration === session.generation;
  speechPause.disabled = true;
  speechStatus.textContent = `Starting ${session.label} ${session.voice.cloud ? 'cloud (ElevenLabs)' : 'offline'} read aloud…`;
  const index = session.index++;
  const request = session.next && session.next.index === index ? session.next : requestPiperChunk(session, index);
  if (session.next && session.next !== request) session.next.controller.abort();
  session.next = null;
  session.controller = request.controller;
  try {
    const blob = await request.promise;
    if (!current()) return;
    session.audioURL = window.URL.createObjectURL(blob);
    const audio = session.audio = new window.Audio(session.audioURL);
    audio.onplaying = () => {
      if (!current() || session.audio !== audio || session.paused) return;
      speechPause.disabled = false;
      speechStatus.textContent = `Playing ${session.label} — ${session.voice.cloud ? 'ElevenLabs cloud voice' : 'offline neural voice'}.`;
      prefetchPiperChunk(session);
    };
    audio.onended = () => {
      if (!current() || session.audio !== audio) return;
      releasePiperAudio(session);
      speakNextChunk();
    };
    audio.onerror = () => { if (current() && session.audio === audio) stopSpeech('Offline audio playback failed. Choose another voice or retry.'); };
    await audio.play();
  } catch (_) {
    if (current()) stopSpeech(session.voice.cloud ? 'Cloud read aloud failed or is busy. Check the ElevenLabs key, credits and network, then retry.' : 'Offline read aloud failed or is busy. Check the local voice installation and browser audio permission, then retry.');
  }
}
function updateSpeech(job) {
  if (!speechControls) return;
  const id = job && job.id;
  const outputs = speechStages.map(name => { const output = byId(`${name}-output`); return output ? output.textContent : ''; });
  const changed = id !== speechDisplayedId || outputs.some((text, i) => text !== speechDisplayedOutputs[i]);
  if (speechSession && changed) stopSpeech('Read aloud stopped — displayed run or output changed.');
  speechDisplayedId = id;
  speechDisplayedOutputs = outputs;
  speechJob = job;
  const ready = speechVoices.some(v => v.available !== false);
  const selected = speechVoices.some(v => v.voiceURI === speechVoice.value && v.available !== false);
  speechVoice.disabled = !ready;
  speechSpeed.disabled = !ready;
  if (!speechSession) {
    speechPause.disabled = true;
    speechStop.disabled = true;
  }
  for (const name of speechStages) {
    const control = byId(`${name}-speak`);
    const output = byId(`${name}-output`);
    if (control) control.disabled = !ready || !selected || !output || !output.textContent.trim();
  }
  if ((!speechSupported && !ready) || !ready || !speechStatus.textContent || /Checking|No speech voices|not supported/.test(speechStatus.textContent)) {
    speechStatus.textContent = !speechSupported && !ready ? 'Read aloud is not supported in this browser. Try a browser with speech synthesis support or installed offline Piper voices; you can still copy output.' :
      !ready ? 'No speech voices available. Enable or install browser/system speech voices, then reload or wait for voices to load. You can still copy output.' : 'Ready — choose a stage’s Read aloud button.';
  }
}
function loadSpeechVoices() {
  if (!speechControls) return;
  const previous = speechVoice.value;
  speechVoices = [...(speechSupported ? speechEngine.getVoices() : []), ...piperVoices];
  if (speechSession && !speechVoices.some(v => v.voiceURI === speechSession.voice.voiceURI)) stopSpeech('Read aloud stopped — selected voice unavailable. Choose another voice.');
  speechVoice.replaceChildren();
  for (const voice of speechVoices) {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang}) — ${voice.cloud ? 'cloud — sends text to ElevenLabs, uses credits' + (voice.available ? '' : ' — key not configured') : voice.piper ? 'offline local neural' + (voice.available ? '' : ' — not installed') : voice.localService === true ? 'local' : 'remote — may send text to speech provider'}`;
    option.disabled = voice.available === false;
    speechVoice.appendChild(option);
  }
  const wanted = speechChoice || previous;
  const language = ((window.navigator && window.navigator.language) || 'en-US').toLowerCase();
  const available = speechVoices.filter(v => v.available !== false);
  const localVoices = available.filter(v => v.localService === true);
  // The user's own ElevenLabs voice is the default until another voice is chosen; others stay optional.
  const preferred = !speechChoice && available.find(v => v.cloud);
  const choice = preferred || (wanted ? available.find(v => v.voiceURI === wanted) : localVoices.find(v => v.lang.toLowerCase() === language) || localVoices.find(v => v.lang.toLowerCase().split('-')[0] === language.split('-')[0]) || localVoices.find(v => v.default) || localVoices[0] || available.find(v => v.default) || available[0]);
  speechVoice.value = choice ? choice.voiceURI : '';
  if (wanted && !choice && speechVoices.length) {
    const missing = document.createElement('option');
    missing.value = '';
    missing.textContent = 'Previous voice unavailable — choose a voice';
    speechVoice.appendChild(missing);
    speechVoice.value = '';
    speechStatus.textContent = 'Selected voice unavailable — choose a voice. No remote voice was silently substituted.';
  }
  updateSpeech(speechJob);
}
async function loadPiperVoices() {
  try {
    const response = await fetch('/api/speech/voices', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok) return;
    const data = await response.json();
    if (!data || !Array.isArray(data.voices)) return;
    // Backend voice IDs are fixed; the ElevenLabs entry is cloud-only and never auto-selected (localService false).
    piperVoices = data.voices.filter(v => v && ['en_US-lessac-low', 'en_US-ryan-low', 'en_GB-alan-low', 'elevenlabs-my-voice-brand'].includes(v.id)).map(v => ({
      voiceURI: `piper:${v.id}`, name: v.name, lang: v.lang, localService: v.cloud !== true, cloud: v.cloud === true, piper: v.id, available: v.available === true,
    }));
    loadSpeechVoices();
  } catch (_) { /* Optional backend: browser voices stay usable. */ }
}
if (speechControls) {
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', () => { if (speechSession) stopSpeech(); });
  speechPause.addEventListener('click', pauseSpeech);
  speechStop.addEventListener('click', () => stopSpeech());
  for (const name of speechStages) {
    const control = byId(`${name}-speak`);
    if (control) control.addEventListener('click', () => speakStage(name));
  }
  speechSpeed.value = '1';
  speechVoice.addEventListener('change', () => {
    if (speechSession) stopSpeech('Read aloud stopped — voice changed. Press Read aloud to restart.');
    speechChoice = speechVoice.value;
    updateSpeech(speechJob);
  });
  speechSpeed.addEventListener('change', () => { if (speechSession) stopSpeech('Read aloud stopped — speed changed. Press Read aloud to restart.'); });
  if (speechSupported) {
    speechEngine.addEventListener('voiceschanged', loadSpeechVoices);
    loadSpeechVoices();
  }
  if (piperSupported) loadPiperVoices();
}
updateSpeech(null);
// END OUTPUT SPEECH

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

for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
  byId(`${name}-expand`).addEventListener('click', () => toggleReading(name));
}

function render(job) {
  lastJob = job;
  byId('history-prompt').textContent = job ? job.config.prompt : '';
  byId('history-delete').disabled = !job || job.status === 'running' || job.status === 'storage_error';
  byId('history-export').href = job && job.id ? '/api/export?id=' + encodeURIComponent(job.id) : '';
  renderUsage(job);
  const running = Boolean(job && job.status === 'running');
  updateRunButton();
  byId('status').textContent = !job ? 'Ready' : running ? 'Working — stages run in sequence…' :
    job.status === 'partial_failure' ? 'Finished with stage errors. Available outputs are preserved.' :
    job.status === 'interrupted' ? 'Interrupted — preserved outputs; never automatically replayed.' :
    job.status === 'storage_error' ? 'Storage error — further provider calls stopped. Repair storage and restart.' : 'Complete';
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
    if (!job || !job.stages.some(stage => stage.name === name)) {
      byId(`${name}-status`).textContent = job ? 'Unavailable — not included in this saved run' : 'Pending';
      byId(`${name}-status`).className = `stage-status is-${job ? 'unavailable' : 'pending'}`;
      byId(`${name}-error`).textContent = '';
      byId(`${name}-output`).textContent = '';
    }
  }
  updateProgress(job);
  if (!job) { updateCopyButtons(); updateReading(job); if (typeof updateSpeech === 'function') updateSpeech(job); return; }
  if (!loaded && viewId === null) {
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
    byId(`${stage.name}-status`).className = `stage-status is-${stage.status}`;
    byId(`${stage.name}-error`).textContent = (stage.error || '') + (stage.primary_failure ? ' ' + stage.primary_failure.error : '');
    byId(`${stage.name}-output`).textContent = stage.output;
  }
  updateCopyButtons();
  updateReading(job);
  if (typeof updateSpeech === 'function') updateSpeech(job);
}

// Top-down progress strip: one chip per stage, same status vocabulary as the per-panel status.
function updateProgress(job) {
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
    const stage = job && job.stages.find(stage => stage.name === name);
    const step = byId(`progress-${name}`);
    const status = !job ? 'pending' : stage ? stage.status : 'unavailable';
    step.className = `step is-${status}`;
    step.setAttribute('aria-current', status === 'running' ? 'step' : 'false');
  }
}

let readingJobId = null;
function updateReading(job) {
  const changed = readingJobId !== (job && job.id);
  readingJobId = job && job.id;
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) {
    const stage = job && job.stages.find(stage => stage.name === name);
    const output = byId(`${name}-output`);
    const empty = byId(`${name}-empty`);
    const control = byId(`${name}-expand`);
    const hasOutput = Boolean(output.textContent);
    output.hidden = !hasOutput;
    empty.hidden = hasOutput;
    empty.textContent = !job ? 'Run Fusion to see this stage’s output here.' : !stage ? 'This stage was not included in this saved run.' :
      stage.status === 'running' ? 'Stage in progress — output appears when it finishes.' :
      stage.status === 'pending' && job.status === 'running' ? 'Waiting for earlier stages — output appears when this stage finishes.' :
      ['error', 'interrupted', 'storage_error'].includes(stage.status) ? `No output available — stage ${stage.status.replace('_', ' ')}. See the status and any error above.` :
      stage.status === 'pending' ? 'No output available — this stage did not finish.' : 'No output was returned for this stage.';
    control.disabled = !hasOutput;
    if (changed || !hasOutput) setReading(name, false);
  }
}
function setReading(name, expanded) {
  const control = byId(`${name}-expand`);
  const label = name === 'analysis' ? 'Reasoning / Divergence' : name.charAt(0).toUpperCase() + name.slice(1);
  byId(`${name}-panel`).className = expanded ? 'panel is-expanded' : 'panel';
  control.setAttribute('aria-expanded', String(expanded));
  control.setAttribute('aria-label', expanded ? `Collapse ${label} output to grid width` : `Expand ${label} output to full width`);
  control.textContent = expanded ? 'Grid width' : 'Full width';
}
function toggleReading(name) {
  if (byId(`${name}-expand`).disabled) return;
  setReading(name, byId(`${name}-panel`).className !== 'panel is-expanded');
}

async function refreshHistory() {
  const revision = ++historyRevision;
  const selectedRevision = viewRevision;
  try {
    const data = await request('/api/history');
    if (revision !== historyRevision) return;
    const select = byId('history-select');
    const latest = document.createElement('option');
    latest.value = ''; latest.textContent = 'Active / latest run';
    select.replaceChildren(latest);
    for (const run of Array.isArray(data.runs) ? data.runs : []) {
      const option = document.createElement('option');
      option.value = run.id;
      option.textContent = `${run.status} · ${run.created_at || run.id} · ${run.config.prompt.slice(0, 100)}`;
      select.appendChild(option);
    }
    select.value = viewId || '';
    if (selectedRevision === viewRevision) {
      byId('history-status').textContent = viewId ? 'Viewing saved run; next-run choices are unchanged.' : 'Viewing active / latest run.';
    }
  } catch (_) {
    if (revision !== historyRevision || selectedRevision !== viewRevision) return;
    byId('history-status').textContent = 'History unavailable. Existing outputs remain visible.';
  }
}
async function selectHistory() {
  const revision = ++viewRevision;
  viewId = byId('history-select').value || null;
  if (viewId === null) {
    render(activeJob);
    byId('history-status').textContent = 'Viewing active / latest run.';
    return;
  }
  const id = viewId;
  try {
    const data = await request('/api/history?id=' + encodeURIComponent(id));
    if (revision !== viewRevision) return;
    render(data.job);
    byId('history-status').textContent = 'Viewing saved run; next-run choices are unchanged.';
  } catch (_) {
    if (revision !== viewRevision) return;
    byId('history-status').textContent = 'Saved run unavailable. Refresh history; existing outputs remain visible.';
  }
}
byId('history-select').addEventListener('change', selectHistory);
byId('history-refresh').addEventListener('click', refreshHistory);
// Reset view: leave any saved run, collapse full-width panels, and return to the active or latest run.
byId('history-latest').addEventListener('click', async () => {
  byId('history-select').value = '';
  for (const name of ['architect', 'builder', 'synthesis', 'analysis']) setReading(name, false);
  await selectHistory();
});
byId('history-delete').addEventListener('click', async () => {
  if (!lastJob || ['running', 'storage_error'].includes(lastJob.status)) return;
  const id = lastJob.id;
  if (!confirm('Delete this saved run and all its outputs? This cannot be undone.')) return;
  const revision = viewRevision;
  try {
    await request('/api/history?id=' + encodeURIComponent(id), {method: 'DELETE'});
    if (activeJob && activeJob.id === id) activeJob = null;
    // Do not pull the user away from a different run selected during deletion.
    if (revision === viewRevision || viewId === id) {
      byId('history-select').value = ''; selectHistory();
    }
    await refreshHistory();
  } catch (_) {
    if (revision === viewRevision) byId('history-status').textContent = 'Deletion failed. Active runs cannot be deleted.';
  }
});

async function poll() {
  const revision = ++pollRevision;
  clearTimeout(timer);
  try {
    const data = await request('/api/job');
    if (revision !== pollRevision) return;
    activeJob = data.job;
    connected = true;
    if (viewId === null) render(activeJob);
    else updateRunButton();
    loaded = true;
    byId('error').textContent = '';
    await refreshHistory();
  } catch (_) {
    if (revision !== pollRevision) return;
    connected = false;
    button.disabled = true;
    byId('error').textContent = 'Cannot reach Fusion. Check that the server is running; reconnecting automatically. Existing outputs remain visible.';
    byId('status').textContent = 'Disconnected';
  } finally {
    if (revision === pollRevision) timer = setTimeout(poll, 1200);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !connected || (activeJob && ['running', 'storage_error'].includes(activeJob.status))) return;
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
    // A newly accepted run owns the view, not an in-flight saved-run load.
    ++viewRevision;
    viewId = null;
    byId('history-select').value = '';
    byId('history-status').textContent = 'Viewing active / latest run.';
    render(null);
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
