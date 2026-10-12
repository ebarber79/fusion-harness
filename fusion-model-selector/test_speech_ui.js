'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/index.html', 'utf8');
const source = fs.readFileSync('static/app.js', 'utf8');
const names = ['architect', 'builder', 'synthesis', 'analysis'];
function fixture({supported = true, voices = [{name:'Remote',lang:'en-US',voiceURI:'remote',localService:false,default:true},{name:'Local',lang:'en-GB',voiceURI:'local',localService:true}], absent = false, offline = null} = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], {textContent:'',value:'',disabled:false,children:[],handlers:{},attrs:{}, addEventListener(k,f){this.handlers[k]=f;},setAttribute(k,v){this.attrs[k]=v;},replaceChildren(...v){this.children=v;},appendChild(v){this.children.push(v);}}]));
  const speech = {voices,said:[],cancels:0,pauses:0,resumes:0,handlers:{},getVoices(){return this.voices;},speak(u){if(this.throwSpeak)throw Error('mock');this.said.push(u);},cancel(){this.cancels++;},pause(){this.pauses++;},resume(){this.resumes++;},addEventListener(k,f){this.handlers[k]=f;}};
  const events = {};
  const calls = [], audio = [], revoked = [];
  const extra = offline === null ? {} : {
    fetch: async (url, options) => { calls.push({url, options}); return {ok:true,json:async()=>({voices:offline}),blob:async()=>({type:'audio/wav'})}; },
    AbortController,
  };
  const audioWindow = offline === null ? {} : {
    Audio:function(url){this.url=url;this.pauses=0;this.plays=0;this.play=()=>{this.plays++;return Promise.resolve();};this.pause=()=>{this.pauses++;};this.removeAttribute=()=>{};this.load=()=>{};audio.push(this);},
    URL:{createObjectURL:()=>`blob:${audio.length}`,revokeObjectURL:url=>revoked.push(url)},
  };
  const ctx = vm.createContext({...extra,byId:id=> absent ? null : elements.get(id) || null,document:{createElement:()=>({value:'',textContent:''})},window:{...audioWindow,speechSynthesis:supported?speech:undefined,SpeechSynthesisUtterance:supported?function(text){this.text=text;}:undefined,addEventListener(k,f){events[k]=f;}}});
  const start=source.indexOf('// BEGIN OUTPUT SPEECH');
  assert.notEqual(start,-1,'isolated speech block exists');
  vm.runInContext(source.slice(start,source.indexOf('// END OUTPUT SPEECH')+'// END OUTPUT SPEECH'.length),ctx);
  return {ctx,calls,audio,revoked,speech,events,el:id=>elements.get(id),click:id=>elements.get(id).handlers.click(),change:id=>elements.get(id).handlers.change(),update:(id='one',outputs={architect:'Synthetic fixture output.'})=>{for(const n of names) elements.get(n+'-output').textContent=outputs[n]||'';ctx.job=id===null?null:{id};vm.runInContext('updateSpeech(job)',ctx);}};
}
const neural = [{id:'en_US-lessac-low',name:'Lessac — Piper neural',lang:'en-US',local:true,available:true},{id:'en_US-ryan-low',name:'Ryan — Piper neural',lang:'en-US',local:true,available:false}];
const flush = () => new Promise(resolve=>setImmediate(resolve));
test('Piper catalog augments browser choices, labels unavailable models, and works without Web Speech',async()=>{
  const f=fixture({offline:neural});await flush();f.update();
  assert.equal(f.calls[0]?.url,'/api/speech/voices','same-origin catalog loaded');
  assert.ok(f.el('speech-voice').children.some(v=>v.value==='local'),'browser voices retained');
  assert.match(f.el('speech-voice').children.find(v=>v.value==='piper:en_US-lessac-low')?.textContent||'',/neural.*offline/i);
  const missing=f.el('speech-voice').children.find(v=>v.value==='piper:en_US-ryan-low');assert.equal(missing?.disabled,true);assert.match(missing.textContent,/not installed/i);
  f.el('speech-voice').value='piper:en_US-lessac-low';f.change('speech-voice');f.speech.handlers.voiceschanged();assert.equal(f.el('speech-voice').value,'piper:en_US-lessac-low');
  const nativeFree=fixture({supported:false,offline:neural});await flush();nativeFree.update();
  assert.equal(nativeFree.el('architect-speak').disabled,false,'HTML audio does not require Web Speech');
});
test('ElevenLabs cloud voice is labelled, selected by default, and other voices stay optional',async()=>{
  const cloud={id:'elevenlabs-my-voice-brand',name:'My Voice – Brand — ElevenLabs cloud',lang:'en-US',local:false,cloud:true,available:true};
  const f=fixture({offline:[cloud,...neural]});await flush();f.update();
  const option=f.el('speech-voice').children.find(v=>v.value==='piper:elevenlabs-my-voice-brand');
  assert.match(option?.textContent||'',/cloud.*ElevenLabs.*credits/i);assert.equal(option.disabled,false);
  assert.equal(f.el('speech-voice').value,'piper:elevenlabs-my-voice-brand','own voice is the default');
  f.speech.handlers.voiceschanged();assert.equal(f.el('speech-voice').value,'piper:elevenlabs-my-voice-brand','default survives voice reloads');
  f.el('speech-voice').value='piper:en_US-lessac-low';f.change('speech-voice');f.speech.handlers.voiceschanged();
  assert.equal(f.el('speech-voice').value,'piper:en_US-lessac-low','explicit other choice is kept');
  const keyless=fixture({offline:[{...cloud,available:false},...neural]});await flush();keyless.update();
  assert.notEqual(keyless.el('speech-voice').value,'piper:elevenlabs-my-voice-brand','unavailable cloud voice falls back to local default');
  assert.ok(keyless.el('speech-voice').value,'a local voice is still chosen');
});
test('Piper uses bounded same-origin audio chunks with true playing, pause/resume, cleanup and complete reading',async()=>{
  const f=fixture({offline:neural,supported:false});await flush();
  const text='Synthetic local speech. '.repeat(30);f.update('one',{architect:text});f.el('speech-voice').value='piper:en_US-lessac-low';f.change('speech-voice');
  f.click('architect-speak');await flush();
  assert.equal(f.calls.filter(c=>c.url==='/api/speech').length,1,'local synthesis requested');
  assert.match(f.el('speech-status').textContent,/starting/i);assert.equal(f.audio.length,1);
  const first=f.audio[0];first.onplaying();assert.match(f.el('speech-status').textContent,/playing/i);
  const request=JSON.parse(f.calls[1].options.body);assert.equal(request.voice,'en_US-lessac-low');assert.ok(request.text.length<=220);assert.equal(request.rate,1);assert.equal(f.calls[1].options.credentials,'same-origin');
  f.click('speech-pause');assert.equal(first.pauses,1);assert.match(f.el('speech-status').textContent,/paused/i);
  f.update('one',{architect:text});assert.equal(first.pauses,1,'unchanged polling preserves playback');
  f.click('speech-pause');assert.equal(first.plays,2);assert.equal(f.audio.length,1,'resume retains exact audio position');
  let i=0;while(i<f.audio.length){const a=f.audio[i++];a.onplaying();a.onended();await flush();assert.ok(i<30);}
  assert.equal(f.calls.filter(c=>c.url==='/api/speech').map(c=>JSON.parse(c.options.body).text).join(''),text);
  assert.equal(f.revoked.length,f.audio.length);assert.match(f.el('speech-status').textContent,/finished/i);
});

test('Piper skips silent whitespace chunks instead of submitting invalid requests',async()=>{
  const f=fixture({offline:neural,supported:false});await flush();
  const text=' '.repeat(250)+'Synthetic local sample.'+'\n'.repeat(250);
  f.update('one',{architect:text});f.click('architect-speak');await flush();
  let i=0;while(i<f.audio.length){const a=f.audio[i++];a.onplaying();a.onended();await flush();assert.ok(i<20);}
  const requests=f.calls.filter(c=>c.url==='/api/speech').map(c=>JSON.parse(c.options.body).text);
  assert.ok(requests.length>0);assert.ok(requests.every(t=>t.trim()),'silent chunks never reach validating backend');
  assert.equal(requests.join('').trim(),'Synthetic local sample.');assert.match(f.el('speech-status').textContent,/finished/i);
});
test('actual read aloud disclosure explains Piper offline neural installation and local server audio',()=>{
  assert.match(html,/Piper[^<]*offline[^<]*neural/i);
  assert.match(html,/local Fusion server/i);
});
test('Piper pause/end race resumes following chunk without replay or null audio',async()=>{
  const f=fixture({offline:neural,supported:false});await flush();f.update('one',{architect:'x'.repeat(500)});f.click('architect-speak');await flush();
  const first=f.audio[0];first.onplaying();f.click('speech-pause');first.onended();await flush();
  assert.equal(f.audio.length,1,'no next chunk while paused');
  assert.doesNotThrow(()=>f.click('speech-pause'));await flush();assert.equal(f.audio.length,2);
  assert.equal(JSON.parse(f.calls[2].options.body).text.length,220);
  f.click('speech-stop');
});
test('Piper stop cancels pending request and rejects stale fetch/audio callbacks across render changes',async()=>{
  for(const action of ['stop','pagehide','output','voice','speed']) {
    const f=fixture({offline:neural,supported:false});await flush();f.update();
    let resolve;f.ctx.fetch=(url,options)=>{f.calls.push({url,options});return new Promise(r=>{resolve=r;});};
    f.click('architect-speak');const call=f.calls[1];assert.equal(call.options.signal.aborted,false);
    if(action==='stop')f.click('speech-stop');else if(action==='pagehide')f.events.pagehide();else if(action==='output')f.update('two');else if(action==='voice')f.change('speech-voice');else f.change('speech-speed');
    assert.equal(call.options.signal.aborted,true,action);const status=f.el('speech-status').textContent;
    resolve({ok:true,blob:async()=>({})});await flush();assert.equal(f.audio.length,0);assert.equal(f.el('speech-status').textContent,status);
  }
  const f=fixture({offline:neural,supported:false});await flush();f.update();f.click('architect-speak');await flush();
  const old=f.audio[0];old.onplaying();f.click('speech-stop');const status=f.el('speech-status').textContent;
  old.onplaying();old.onended();old.onerror();assert.equal(f.el('speech-status').textContent,status);assert.equal(f.revoked.length,1);
});
test('Piper HTTP/audio errors fail truthfully and allow retry without automatic cloud fallback',async()=>{
  for(const failure of ['http','play','audio']) {
    const f=fixture({offline:neural});await flush();f.update();f.el('speech-voice').value='piper:en_US-lessac-low';f.change('speech-voice');
    if(failure==='http')f.ctx.fetch=async()=>({ok:false});
    if(failure==='play')f.ctx.window.Audio=function(){this.play=()=>Promise.reject(Error('denied'));this.pause=()=>{};this.removeAttribute=()=>{};this.load=()=>{};};
    f.click('architect-speak');await flush();if(failure==='audio')f.audio[0].onerror();
    assert.match(f.el('speech-status').textContent,/offline.*failed/i);assert.equal(f.el('speech-stop').disabled,true);assert.equal(f.speech.said.length,0);
  }
});

test('actual HTML has four labelled non-submit read buttons and global accessible controls',()=>{
  for(const n of names) assert.match(html,new RegExp(`id="${n}-speak"[^>]*type="button"[^>]*aria-label="Read [^"]+ aloud"[^>]*aria-controls="${n}-output"[^>]*disabled`));
  for(const id of ['speech-voice','speech-speed','speech-pause','speech-stop','speech-status']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,id);
  assert.match(html,/<label for="speech-voice">/);assert.match(html,/<label for="speech-speed">/);
  assert.match(html,/id="speech-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/remote voices[^<]*send[^<]*text/i);
});
test('voices prefer local, label privacy, and late voices enable only nonempty output',()=>{
  const f=fixture();f.update();
  assert.equal(f.el('speech-voice').value,'local');
  assert.match(f.el('speech-voice').children.find(v=>v.value==='local').textContent,/local/i);
  assert.match(f.el('speech-voice').children.find(v=>v.value==='remote').textContent,/remote.*text/i);
  assert.equal(f.el('architect-speak').disabled,false);assert.equal(f.el('builder-speak').disabled,true);
  const late=fixture({voices:[]});late.update();assert.equal(late.el('architect-speak').disabled,true);
  assert.match(late.el('speech-status').textContent,/no.*voices.*browser.*system/i);
  late.speech.voices=f.speech.voices;late.speech.handlers.voiceschanged();
  assert.equal(late.el('architect-speak').disabled,false);
  assert.equal(late.el('speech-voice').value,'local');
  f.el('speech-voice').value='remote';f.change('speech-voice');f.speech.handlers.voiceschanged();assert.equal(f.el('speech-voice').value,'remote');
});
test('each stage starts on click with selected voice/speed, onstart truth, and lossless bounded chunks',()=>{
  for(const name of names){
    const f=fixture();const text='  Synthetic sentence.\n'.repeat(35)+'x'.repeat(450)+' 🧪 end';f.update('one',{[name]:text});
    f.el('speech-speed').value='1.5';f.click(name+'-speak');
    assert.equal(f.speech.said.length,1);assert.match(f.el('speech-status').textContent,/starting/i);assert.doesNotMatch(f.el('speech-status').textContent,/playing/i);
    assert.equal(f.speech.said[0].voice.voiceURI,'local');assert.equal(f.speech.said[0].rate,1.5);
    f.speech.said[0].onstart();assert.match(f.el('speech-status').textContent,/playing/i);
    let i=0;while(i<f.speech.said.length){assert.ok(f.speech.said[i].text.length<=220);f.speech.said[i++].onend();assert.ok(i<100);}
    assert.equal(f.speech.said.map(u=>u.text).join(''),text);assert.match(f.el('speech-status').textContent,/finished/i);
  }
});
test('pause/resume and stop cancel queued work and ignore stale callbacks after replacement',()=>{
  const f=fixture();f.update('one',{architect:'fixture '.repeat(100),builder:'Second fixture'});f.click('architect-speak');
  assert.equal(f.el('speech-stop').disabled,false);assert.equal(f.el('speech-pause').disabled,true);
  const old=f.speech.said[0];old.onstart();assert.equal(f.el('speech-pause').disabled,false);
  f.click('speech-pause');assert.equal(f.speech.pauses,1);assert.match(f.el('speech-status').textContent,/paused/i);assert.equal(f.el('speech-pause').textContent,'Resume');
  old.onend();assert.equal(f.speech.said.length,1,'no next chunk while paused');
  f.click('speech-pause');assert.equal(f.speech.resumes,1);assert.equal(f.speech.said.length,2);
  const stale=f.speech.said[1];const cancels=f.speech.cancels;f.click('builder-speak');assert.ok(f.speech.cancels>cancels);
  const count=f.speech.said.length;const status=f.el('speech-status').textContent;
  stale.onstart();stale.onend();assert.equal(f.speech.said.length,count);assert.equal(f.el('speech-status').textContent,status);
  f.click('speech-stop');assert.match(f.el('speech-status').textContent,/stopped/i);assert.equal(f.el('speech-stop').disabled,true);assert.equal(f.el('speech-pause').disabled,true);
  f.speech.said[count-1].onstart();f.speech.said[count-1].onend();assert.equal(f.speech.said.length,count);assert.match(f.el('speech-status').textContent,/stopped/i);
});
test('unsupported native pause immediately cancels audio but preserves a resumable session',()=>{
  const f=fixture();f.speech.paused=false;f.update();f.click('architect-speak');f.speech.said[0].onstart();
  const before=f.speech.cancels;f.click('speech-pause');
  assert.equal(f.speech.pauses,1);assert.equal(f.speech.cancels,before+1);
  assert.match(f.el('speech-status').textContent,/paused/i);assert.equal(f.el('speech-pause').textContent,'Resume');
  assert.equal(f.el('speech-pause').disabled,false);assert.equal(f.el('speech-stop').disabled,false);
  f.update();assert.match(f.el('speech-status').textContent,/paused/i);assert.equal(f.speech.said.length,1);
});
test('fallback resume replays only the interrupted bounded chunk and loses no following text',()=>{
  const f=fixture();f.speech.paused=false;const text='Synthetic sentence. '.repeat(45)+'x'.repeat(450)+' 🧪 end';
  f.update('one',{architect:text});f.click('architect-speak');const interrupted=f.speech.said[0];interrupted.onstart();
  f.click('speech-pause');f.click('speech-pause');
  assert.equal(f.speech.said.length,2);assert.equal(f.speech.said[1].text,interrupted.text);assert.ok(interrupted.text.length<=220);
  assert.match(f.el('speech-status').textContent,/starting/i);assert.equal(f.el('speech-pause').disabled,true);
  let i=1;while(i<f.speech.said.length){f.speech.said[i].onstart();f.speech.said[i++].onend();assert.ok(i<100);}
  assert.equal(f.speech.said.slice(1).map(u=>u.text).join(''),text);assert.match(f.el('speech-status').textContent,/finished/i);
});
test('fallback ignores cancelled start/end/error callbacks synchronously and after resume',()=>{
  const f=fixture();f.speech.paused=false;f.update('one',{architect:'fixture '.repeat(100)});f.click('architect-speak');
  const old=f.speech.said[0];old.onstart();
  const cancel=f.speech.cancel.bind(f.speech);
  f.speech.cancel=()=>{cancel();old.onstart();old.onend();old.onerror({error:'interrupted'});};
  f.click('speech-pause');assert.match(f.el('speech-status').textContent,/paused/i);assert.equal(f.el('speech-stop').disabled,false);
  old.onstart();old.onend();old.onerror({error:'cancelled'});
  assert.match(f.el('speech-status').textContent,/paused/i);assert.equal(f.speech.said.length,1);
  f.click('speech-pause');assert.equal(f.speech.said.length,2);const replay=f.speech.said[1];replay.onstart();
  old.onstart();old.onend();old.onerror({error:'late'});
  assert.equal(f.speech.said.length,2);assert.match(f.el('speech-status').textContent,/playing/i);
  replay.onend();assert.equal(f.speech.said.length,3,'exactly one following chunk');
});
test('fallback does not replay a chunk that completed while native pause was requested',()=>{
  const f=fixture();f.speech.paused=false;const text='x'.repeat(500);f.update('one',{architect:text});f.click('architect-speak');
  const completed=f.speech.said[0];completed.onstart();
  f.speech.pause=()=>{f.speech.pauses++;completed.onend();};
  const before=f.speech.cancels;f.click('speech-pause');assert.equal(f.speech.cancels,before+1);
  f.click('speech-pause');assert.equal(f.speech.said.length,2);
  let i=1;while(i<f.speech.said.length){f.speech.said[i++].onend();assert.ok(i<10);}
  assert.equal(f.speech.said.map(u=>u.text).join(''),text,'completed chunk must not be decremented/replayed');
});
test('eSpeak pause uses cancel/replay without native pause or resume that can wedge Linux speech',()=>{
  const f=fixture({voices:[{name:'English (America) espeak-ng',lang:'en-US',voiceURI:'espeak',localService:true}]});
  f.update();f.click('architect-speak');const u=f.speech.said[0];u.onstart();
  const before=f.speech.cancels;f.click('speech-pause');
  assert.equal(f.speech.pauses,0);assert.equal(f.speech.cancels,before+1);
  f.click('speech-pause');assert.equal(f.speech.resumes,0);assert.equal(f.speech.said.length,2);
  assert.equal(f.speech.said[1].text,u.text);f.speech.said[1].onstart();assert.match(f.el('speech-status').textContent,/playing/i);
});
test('successful native pause resumes the same utterance without cancellation or replay',()=>{
  const f=fixture();f.speech.paused=false;f.speech.pause=()=>{f.speech.pauses++;f.speech.paused=true;};
  f.update();f.click('architect-speak');const u=f.speech.said[0];u.onstart();const before=f.speech.cancels;
  f.click('speech-pause');assert.equal(f.speech.cancels,before);f.click('speech-pause');
  assert.equal(f.speech.resumes,1);assert.equal(f.speech.said.length,1);u.onend();assert.match(f.el('speech-status').textContent,/finished/i);
});
test('render integrates speech; unchanged polls keep playback, changed job/output and pagehide stop',()=>{
  assert.match(source,/if \(typeof updateSpeech === 'function'\) updateSpeech\(job\)/);
  for(const change of ['job','output','other output','reset','pagehide']) {
    const f=fixture();f.update();f.click('architect-speak');const u=f.speech.said[0];u.onstart();
    const before=f.speech.cancels;f.update();assert.equal(f.speech.cancels,before);assert.match(f.el('speech-status').textContent,/playing/i);assert.equal(f.el('speech-pause').disabled,false);
    if(change==='job')f.update('history');else if(change==='output')f.update('one',{architect:'Changed synthetic text'});else if(change==='other output')f.update('one',{architect:'Synthetic fixture output.',builder:'New synthetic output'});else if(change==='reset')f.update(null,{});else f.events.pagehide();
    assert.ok(f.speech.cancels>before,change);assert.match(f.el('speech-status').textContent,/stopped/i);
    const status=f.el('speech-status').textContent;u.onstart();u.onend();assert.equal(f.el('speech-status').textContent,status);assert.equal(f.speech.said.length,1);
  }
});
test('speak exceptions and utterance errors fail truthfully, allow retry, ignore stale errors',()=>{
  const f=fixture();f.update();f.speech.throwSpeak=true;
  assert.doesNotThrow(()=>f.click('architect-speak'));assert.match(f.el('speech-status').textContent,/unavailable|failed/i);assert.equal(f.el('speech-stop').disabled,true);
  f.speech.throwSpeak=false;f.click('architect-speak');const u=f.speech.said[0];u.onerror({error:'not-allowed'});
  assert.match(f.el('speech-status').textContent,/failed.*browser.*voice/i);assert.equal(f.el('speech-pause').disabled,true);
  f.click('architect-speak');const status=f.el('speech-status').textContent;u.onerror({error:'stale'});assert.equal(f.el('speech-status').textContent,status);
});
test('voice loss and voice/speed changes stop current audio without silently switching remote',()=>{
  const f=fixture();f.update();f.click('architect-speak');const before=f.speech.cancels;
  f.el('speech-voice').value='remote';f.change('speech-voice');assert.ok(f.speech.cancels>before);assert.match(f.el('speech-status').textContent,/stopped/i);
  f.click('architect-speak');assert.equal(f.speech.said[1].voice.voiceURI,'remote');
  f.el('speech-speed').value='2';f.change('speech-speed');assert.match(f.el('speech-status').textContent,/stopped/i);
  f.click('architect-speak');assert.equal(f.speech.said[2].rate,2);
  f.speech.voices=[];f.speech.handlers.voiceschanged();assert.equal(f.el('architect-speak').disabled,true);assert.equal(f.el('speech-stop').disabled,true);assert.match(f.el('speech-status').textContent,/no.*voices/i);
  const local=fixture();local.update();local.click('architect-speak');local.speech.voices=[local.speech.voices[0]];local.speech.handlers.voiceschanged();
  assert.equal(local.el('architect-speak').disabled,true);assert.equal(local.el('speech-voice').value,'');assert.match(local.el('speech-status').textContent,/unavailable.*choose/i);
});
test('default local voice matches browser language rather than first alphabetic voice',()=>{
  const f=fixture({voices:[{name:'Afrikaans',lang:'af',voiceURI:'af',localService:true},{name:'English',lang:'en-US',voiceURI:'en',localService:true}]});
  f.update();assert.equal(f.el('speech-voice').value,'en');
});
test('speech controls have wrapping responsive layout and compact stage buttons',()=>{
  const css=fs.readFileSync('static/style.css','utf8');
  assert.match(css,/\.speech-settings\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  assert.match(css,/\.speech-settings > div\s*\{[^}]*min-width:\s*0/);
  assert.match(css,/\.speak-output\s*\{[^}]*font-size:\s*12px/);
});
test('unsupported browsers and absent controls degrade safely',()=>{
  const f=fixture({supported:false}); f.update();
  assert.equal(f.el('architect-speak').disabled,true);assert.equal(f.el('speech-voice').disabled,true);
  assert.match(f.el('speech-status').textContent,/not supported.*browser/i);
  assert.doesNotThrow(()=>fixture({absent:true}).update());
});
test('read aloud speaks Markdown as prose: no symbols, code or full URLs, plain text unchanged',()=>{
  const f=fixture();const spoken=t=>f.ctx.speechText(t);
  assert.equal(spoken('## Design overview\nThe **builder** uses `fetch` and *caches* ~~old~~ results.'),'Design overview.\nThe builder uses fetch and caches old results.');
  assert.equal(spoken('- First item\n* Second item\n> Quoted note\n1. Numbered stays'),'First item.\nSecond item.\nQuoted note\n1. Numbered stays.');
  assert.equal(spoken('- Ends: \n  - Nested\n2) Asked?\n- **Bold** item  \n**B. Optimization**\n**Lead:** text'),'Ends:\nNested.\n2) Asked?\nBold item.\nB. Optimization.\nLead: text','list items and bold label lines end with a pause');
  assert.equal(spoken('Before\n```python\nprint("x")\n```\nAfter'),'Before\nPython code block omitted.\nAfter');
  assert.equal(spoken('Before\n```\nraw\n'),'Before\nCode block omitted.','unclosed fence omits the rest');
  assert.equal(spoken('| Voice | Bytes |\n|---|---:|\n| Lessac | 63 MB |'),'Voice, Bytes.\nLessac, 63 MB.');
  assert.equal(spoken('See [the docs](https://docs.example.com/a?b=1) or https://www.github.com/x/y.'),'See the docs or link to github.com.');
  assert.equal(spoken('Run architect → builder -> synthesis.\n---\nDone'),'Run architect to builder to synthesis.\n\nDone');
  assert.equal(spoken('[1] Title — https://example.org/page'),'[1] Title — link to example.org');
  for(const plain of ['  Synthetic sentence.\n'.repeat(3)+'x'.repeat(50)+' 🧪 end','snake_case_name and 2 * 3 * 4 stay','']) assert.equal(spoken(plain),plain);
  const e=fixture();e.update('one',{architect:'# Title\n**Bold** text.'});e.click('architect-speak');
  assert.equal(e.speech.said[0].text,'Title.\nBold text.','browser voices read cleaned text');
});
test('Piper prefetches the next chunk while one plays, requests each chunk once, and aborts prefetch on stop',async()=>{
  const f=fixture({offline:neural,supported:false});await flush();
  const text='Synthetic local speech. '.repeat(30);f.update('one',{architect:text});f.el('speech-voice').value='piper:en_US-lessac-low';f.change('speech-voice');
  f.click('architect-speak');await flush();
  const speechCalls=()=>f.calls.filter(c=>c.url==='/api/speech');
  assert.equal(speechCalls().length,1,'no prefetch before playback starts');
  f.audio[0].onplaying();await flush();
  assert.equal(speechCalls().length,2,'next chunk requested while first plays');
  f.audio[0].onplaying();await flush();assert.equal(speechCalls().length,2,'repeat playing events do not refetch');
  f.audio[0].onended();await flush();
  assert.equal(f.audio.length,2,'next chunk plays from the prefetched audio');assert.equal(speechCalls().length,2,'no duplicate request at chunk boundary');
  let i=1;while(i<f.audio.length){const a=f.audio[i++];a.onplaying();await flush();a.onended();await flush();assert.ok(i<30);}
  assert.equal(speechCalls().map(c=>JSON.parse(c.options.body).text).join(''),text);assert.match(f.el('speech-status').textContent,/finished/i);
  const s=fixture({offline:neural,supported:false});await flush();s.update('one',{architect:text});s.click('architect-speak');await flush();
  s.audio[0].onplaying();await flush();const prefetch=s.calls.filter(c=>c.url==='/api/speech')[1];
  assert.equal(prefetch.options.signal.aborted,false);s.click('speech-stop');assert.equal(prefetch.options.signal.aborted,true,'stop aborts prefetch');
  const bad=fixture({offline:neural,supported:false});await flush();bad.update('one',{architect:text});bad.click('architect-speak');await flush();
  bad.ctx.fetch=async(url,options)=>{bad.calls.push({url,options});return {ok:false};};
  bad.audio[0].onplaying();await flush();assert.match(bad.el('speech-status').textContent,/playing/i,'prefetch failure does not interrupt current chunk');
  bad.audio[0].onended();await flush();assert.match(bad.el('speech-status').textContent,/offline.*failed/i);assert.equal(bad.el('speech-stop').disabled,true);
});
