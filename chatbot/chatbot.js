/* Court Vision assistant: Llama 3.2 running inside this browser (WebLLM + WebGPU).
   Read-only by design: the only backend calls this file can make are the GET actions listed in READ_ONLY.
   Nothing here writes, edits or deletes. */
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm';
const READ_ONLY = ['portfolio', 'shipping', 'finance', 'receipts', 'events', 'creatives', 'balance', 'entities', 'organization'];

const readUrl = a => {
  if (!READ_ONLY.includes(a)) throw new Error('Blocked: ' + a + ' is not a read-only action');
  return CONFIG.portfolio.endpoint + '?action=' + a + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
};

/* ---------- turning backend data into text the model can use ---------- */
const SKIP_KEYS = /photo|image|img|thumb|url|link|base64|^full$/i;
const MONEY = /cost|amount|price|total|fee|value|balance|profit|sold/i;
const CATEG = ['tag', 'status', 'type', 'flow', 'shipMethod', 'payMethod', 'method', 'kind', 'platform'];

function flat(v, depth = 0) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) {
    if (depth > 2) return '';
    const t = v.slice(0, 12).map(x => flat(x, depth + 1)).filter(Boolean).join('; ');
    return t ? '[' + t + ']' : '';
  }
  if (typeof v === 'object') {
    return Object.entries(v).filter(([k]) => !SKIP_KEYS.test(k)).map(([k, x]) => { const s = flat(x, depth + 1); return s ? k + '=' + s : ''; }).filter(Boolean).join(', ');
  }
  return String(v).slice(0, 160);
}

function buildRecords(data) {
  const recs = [];
  Object.keys(data).forEach(action => {
    const res = data[action];
    Object.keys(res).forEach(k => {
      if (k === 'ok') return;
      const v = res[k], set = action + '.' + k;
      const add = (item, text) => { text = String(text).slice(0, 600); if (text) recs.push({ set, item, text, low: text.toLowerCase() }); };
      if (Array.isArray(v)) v.forEach(item => add(item, flat(item)));
      else if (v && typeof v === 'object') add(v, flat(v));
      else if (v != null && v !== '') add(null, k + '=' + v);
    });
  });
  return recs;
}

// exact counts and totals, worked out here in code because small models are poor at arithmetic
function buildSummary(recs) {
  const by = {};
  recs.forEach(r => (by[r.set] = by[r.set] || []).push(r));
  const lines = [];
  Object.keys(by).forEach(set => {
    const items = by[set].map(r => r.item).filter(i => i && typeof i === 'object' && !Array.isArray(i));
    const sums = {}, cats = {};
    items.forEach(it => Object.keys(it).forEach(k => {
      const v = it[k];
      if (typeof v === 'number' && MONEY.test(k)) sums[k] = (sums[k] || 0) + v;
      else if (CATEG.includes(k) && v != null && v !== '' && typeof v !== 'object') { const c = cats[k] = cats[k] || {}; c[v] = (c[v] || 0) + 1; }
    }));
    let line = set + ': ' + by[set].length + ' records';
    Object.keys(sums).forEach(k => line += '; total ' + k + '=' + Math.round(sums[k] * 100) / 100);
    Object.keys(cats).forEach(k => line += '; ' + k + ': ' + Object.entries(cats[k]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, c]) => v + '=' + c).join(', '));
    lines.push(line);
  });
  return lines.join('\n').slice(0, 1500);
}

const STOP = new Set('the an of and or to in on for is are was were be how many much what which who when where does did we our my me you your with at by from this that these those it its as about tell show list give all any have has had can could should would please'.split(' '));
const tokens = q => [...new Set((String(q).toLowerCase().match(/[a-z0-9.\-]{2,}/g) || []))].filter(t => !STOP.has(t));

function pickRecords(recs, q, budget = 2400) {
  const toks = tokens(q);
  const scored = recs.map(r => ({ r, s: toks.reduce((a, t) => a + (r.low.includes(t) ? 1 : 0), 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
  let pool = scored;
  if (!pool.length) { const seen = {}; pool = recs.filter(r => (seen[r.set] = (seen[r.set] || 0) + 1) <= 2); }   // no keyword hit: show a couple of rows per list
  const out = []; let used = 0;
  for (const r of pool) {
    const line = '[' + r.set + '] ' + r.text;
    if (used + line.length > budget) { if (used > budget * .9) break; continue; }
    out.push(line); used += line.length + 1;
  }
  return out;
}

function buildMessages(question, history, recs, summary, budget) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sys = 'You are the Court Vision assistant inside the trackello app. Answer ONLY from the DATA below, which was read from the business\'s Google Sheet backend. '
    + 'You have read-only access: you cannot add, change or delete anything, and you must say so if asked to. '
    + 'If the data does not contain the answer, say you could not find it in the data. Never guess or invent names, dates or numbers. Currency is PHP. Be concise. '
    + 'Today is ' + today + '.\n\n'
    + 'SUMMARY (exact counts and totals; use these for "how many" and "total" questions):\n' + summary.slice(0, Math.max(600, budget)) + '\n\n'
    + 'RECORDS (only the rows most relevant to this question, not the full list):\n' + pickRecords(recs, question, budget).join('\n');
  return [{ role: 'system', content: sys }]
    .concat(history.slice(-2).map(m => ({ role: m.role, content: m.content.slice(0, 400) })))
    .concat([{ role: 'user', content: question }]);
}

/* ---- UI ---- */
(function boot() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('cbGo')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else console.warn('chatbot.js: #cbGo not found, chat UI not on this page');
    return;
  }
  const $ = id => document.getElementById(id);
  let wl = null, engine = null, loadedId = '', loadedKey = '1B', recs = [], summary = '', history = [], busy = false;

  const setState = t => { $('cbState').textContent = t; };
  const setBar = (p, show = true) => { $('cbBarWrap').hidden = !show; $('cbBar').style.width = Math.round((p || 0) * 100) + '%'; };
  const addMsg = (who, text) => { const d = document.createElement('div'); d.className = 'cb-msg ' + who; d.textContent = text; $('cbLog').appendChild(d); d.scrollIntoView({ block: 'end' }); return d; };

  /* ----- read-only data ----- */
  async function loadData() {
    if (typeof CONFIG === 'undefined' || typeof jsonp === 'undefined' || !CONFIG.portfolio || !CONFIG.portfolio.endpoint) { $('cbData').textContent = "Sync isn't set up yet."; return; }
    $('cbData').textContent = 'Reading backend\u2026';
    const out = {};
    const results = await Promise.allSettled(READ_ONLY.map(a => jsonp(readUrl(a)).then(d => { if (d && d.ok) out[a] = d; else throw new Error(a); })));
    const failed = READ_ONLY.filter((a, i) => results[i].status !== 'fulfilled');
    recs = buildRecords(out); summary = buildSummary(recs);
    const t = new Date(), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    $('cbData').textContent = recs.length + ' records read at ' + hm + '.' + (failed.length ? ' Could not read: ' + failed.join(', ') + '.' : '') + ' The assistant can only read, never change, your data.';
  }

  /* ----- model ----- */
  let f16Cache = null;
  async function hasF16() {
    if (f16Cache !== null) return f16Cache;
    for (let i = 0; i < 4; i++) {   // the adapter can come back empty for a moment, so ask a few times
      try { const a = await navigator.gpu.requestAdapter(); if (a) return (f16Cache = a.features.has('shader-f16')); } catch (_) {}
      await new Promise(r => setTimeout(r, 350));
    }
    return false;
  }
  /* Model list. k = value in the dropdown, base = WebLLM model id without the quantisation suffix,
     rb = how many characters of records to send (small context windows need less). */
  const MODELS = [
    { k: '1B',      base: 'Llama-3.2-1B-Instruct',        rb: 2400, label: 'Fast \u00b7 Llama 3.2 1B (about 0.9 GB)' },
    { k: '3B',      base: 'Llama-3.2-3B-Instruct',        rb: 2400, label: 'Better \u00b7 Llama 3.2 3B (about 2.3 GB)' },
    { k: 'qwen05',  base: 'Qwen2.5-0.5B-Instruct',        rb: 1800, label: 'Tiny \u00b7 Qwen 2.5 0.5B (about 0.4 GB, weak answers)' },
    { k: 'qwen15',  base: 'Qwen2.5-1.5B-Instruct',        rb: 2400, label: 'Small \u00b7 Qwen 2.5 1.5B (about 1.2 GB)' },
    { k: 'qwen3',   base: 'Qwen2.5-3B-Instruct',          rb: 2400, label: 'Good \u00b7 Qwen 2.5 3B (about 2.2 GB)' },
    { k: 'qwen7',   base: 'Qwen2.5-7B-Instruct',          rb: 2400, label: 'Strong \u00b7 Qwen 2.5 7B (about 4.5 GB, needs 6 GB+ VRAM)' },
    { k: 'smol',    base: 'SmolLM2-360M-Instruct',        rb: 1500, label: 'Smallest \u00b7 SmolLM2 360M (about 0.25 GB, weak answers)' },
    { k: 'smol17',  base: 'SmolLM2-1.7B-Instruct',        rb: 2000, label: 'Small \u00b7 SmolLM2 1.7B (about 1.2 GB)' },
    { k: 'gemma2b', base: 'gemma-2-2b-it',                rb: 2200, label: 'Compact \u00b7 Gemma 2 2B (about 1.6 GB)' },
    { k: 'phi',     base: 'Phi-3.5-mini-instruct',        rb: 2400, label: 'Reasoning \u00b7 Phi 3.5 mini 3.8B (about 2.2 GB)' },
    { k: 'mistral', base: 'Mistral-7B-Instruct-v0.3',     rb: 2400, label: 'Heavy \u00b7 Mistral 7B (about 4 GB, needs 6 GB+ VRAM)' },
    { k: 'gemma9b', base: 'gemma-2-9b-it',                rb: 2400, label: 'Heaviest \u00b7 Gemma 2 9B (about 5.5 GB, needs 8 GB+ VRAM)' },
    { k: 'tiny',    base: 'TinyLlama-1.1B-Chat-v1.0',     rb: 900,  label: 'Basic \u00b7 TinyLlama 1.1B (about 0.7 GB, 2K context)' },
    { k: 'stable',  base: 'stablelm-2-zephyr-1_6b',       rb: 2000, label: 'Compact \u00b7 StableLM 2 Zephyr 1.6B (about 1.0 GB)' },
  ];
  const modelOf = k => MODELS.find(m => m.k === k) || MODELS[0];
  async function modelId(k) { return modelOf(k).base + '-q4f' + (await hasF16() ? '16' : '32') + '_1-MLC'; }
  function fillModels() {
    const sel = $('cbModel'), keep = sel.value || '1B';
    sel.innerHTML = '';
    MODELS.forEach(m => { const o = document.createElement('option'); o.value = m.k; o.textContent = m.label; sel.appendChild(o); });
    sel.value = MODELS.some(m => m.k === keep) ? keep : '1B';
  }
  // hide models this WebLLM build does not know, so a dead option is never offered
  function pruneModels() {
    if (!wl) return;
    const have = new Set(wl.prebuiltAppConfig.model_list.map(m => m.model_id)), sel = $('cbModel');
    [...sel.options].forEach(o => { const m = modelOf(o.value); if (!have.has(m.base + '-q4f32_1-MLC') && !have.has(m.base + '-q4f16_1-MLC')) o.remove(); });
  }
  async function refreshButton() {
    if (!wl) return;
    try {
      const id = await modelId($('cbModel').value);
      const cached = await wl.hasModelInCache(id);
      $('cbGo').textContent = (engine && loadedId === id) ? 'Ready' : (cached ? 'Start (already downloaded)' : 'Download & start');
      if (!engine) setState(cached ? 'Model is already downloaded on this device.' : 'Not downloaded yet.');
    } catch (_) {}
  }
  function enableChat(on) { $('cbInput').disabled = !on; $('cbSend').disabled = !on; if (on) $('cbInput').focus(); }

  /* ----- gentle downloader -----
     WebLLM fetches every shard at once. Hugging Face answers with HTTP 429 (rate limit), and because that reply
     has no CORS header the browser reports it as a CORS error. Here the shards are saved one at a time with backoff
     into the same cache WebLLM reads from, so WebLLM then finds them already downloaded. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // urls = the same file on several hosts. Try each host in turn; only wait when every host refused.
  async function getWithBackoff(urls, label) {
    urls = [].concat(urls);
    let lastErr;
    for (let round = 0; round < 4; round++) {
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) return res;
          lastErr = new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
        } catch (e) { lastErr = e; }   // a 429 without CORS headers also lands here
      }
      setState((label || 'Downloading') + ': download servers are refusing requests, waiting before retry ' + (round + 1) + ' of 4\u2026');
      await sleep(10000 * (round + 1));
    }
    throw new Error('Every download source refused the request (' + (lastErr && lastErr.message || lastErr) + '). Your IP is probably rate limited by Hugging Face. Try another network (phone hotspot) or wait a few hours, then press the button again. Files already saved are kept.');
  }
  async function prefetchModel(id) {
    if (typeof caches === 'undefined') return;
    const rec = wl.prebuiltAppConfig.model_list.find(m => m.model_id === id);
    if (!rec) return;
    const origin = rec.model.replace(/\/+$/, '') + '/resolve/main/';        // WebLLM looks files up under this exact URL
    const hosts = [origin];
    const mine = (typeof CONFIG !== 'undefined' && CONFIG.modelMirror) ? String(CONFIG.modelMirror).replace(/\/+$/, '') + '/' + id + '/' : '';
    if (mine) hosts.unshift(mine);                                          // optional: your own copy of the files
    hosts.push(origin.replace('https://huggingface.co/', 'https://hf-mirror.com/'));
    const from = f => hosts.map(h => h + f);
    const cache = await caches.open('webllm/model');
    const manUrl = origin + 'ndarray-cache.json';
    let man;
    const hit = await cache.match(manUrl);
    if (hit) man = await hit.clone().json();
    else { const r = await getWithBackoff(from('ndarray-cache.json'), 'Reading model list'); await cache.put(manUrl, r.clone()); man = await r.json(); }
    // small files WebLLM also reads from Hugging Face: config + tokenizer (so a blocked IP can't stop them either)
    const extras = [['mlc-chat-config.json', 'webllm/config', true], ['tokenizer.json', 'webllm/model', true], ['tokenizer_config.json', 'webllm/model', false]];
    for (const [name, scope, must] of extras) {
      try {
        const c = await caches.open(scope), key = origin + name;
        if (!(await c.match(key))) { setState('Reading ' + name + '\u2026'); await c.put(key, await getWithBackoff(from(name), name)); }
      } catch (e) { if (must) throw e; }
    }
    const files = man.records || [];
    const total = files.reduce((a, f) => a + (f.nbytes || 0), 0) || 1;
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i], key = origin + f.dataPath;
      if (!(await cache.match(key))) {
        const r = await getWithBackoff(from(f.dataPath), 'Part ' + (i + 1) + ' of ' + files.length);
        await cache.put(key, r);
        await sleep(400);
      }
      done += f.nbytes || 0;
      setBar(done / total * 0.95); setState(Math.round(done / total * 95) + '% \u00b7 downloaded part ' + (i + 1) + ' of ' + files.length);
    }
  }

  async function startModel() {
    if (!navigator.gpu) return setState('This browser does not support WebGPU, which the local model needs. Try the latest Chrome or Edge.');
    $('cbGo').disabled = $('cbModel').disabled = true;
    try {
      if (!wl) wl = await import(WEBLLM_URL);
      const id = await modelId($('cbModel').value);
      if (!wl.prebuiltAppConfig.model_list.some(m => m.model_id === id)) throw new Error('Model ' + id + ' is not in this WebLLM build');
      if (engine && loadedId === id) return;
      if (engine) { enableChat(false); try { await engine.unload(); } catch (_) {} engine = null; await new Promise(r => setTimeout(r, 300)); }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) {}
      setBar(0); setState('Starting\u2026');
      // The model comes in many files. If the connection drops, files already saved are kept, so trying again carries on from there.
      let lastErr = null, useId = id;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          try { await prefetchModel(useId); } catch (pe) { pe.noRetry = true; throw pe; }
          engine = await wl.CreateMLCEngine(useId, { initProgressCallback: r => { setBar(r.progress); setState((Math.round(r.progress * 100)) + '% \u00b7 ' + (r.text || '')); } });
          lastErr = null; break;
        } catch (err) {
          lastErr = err; engine = null;
          if (/shader-f16|f16|ShaderModule|GPUPipelineError/i.test(String(err && err.message || err)) && useId.includes('q4f16')) { useId = useId.replace('q4f16', 'q4f32'); continue; }
          if (/no available adapters|unable to find a compatible gpu/i.test(String(err && err.message || err)) && attempt < 3) { await new Promise(r => setTimeout(r, 800)); continue; }
          if (err && err.noRetry) break;
          if (attempt === 3 || !/network|fetch|cache\.add|cache\.put|failed to/i.test(String(err && err.message || err))) break;
          setState('Connection hiccup, retrying (' + attempt + ' of 3). Parts already downloaded are kept\u2026');
          await new Promise(r => setTimeout(r, 10000 * attempt));
        }
      }
      if (lastErr) throw lastErr;
      loadedId = id; loadedKey = $('cbModel').value; setBar(1, false); console.log('Loaded model', useId); setState('Ready. Ask anything about your data.'); enableChat(true);
    } catch (err) {
      console.warn(err); engine = null; setBar(0, false);
      const msg = String(err && err.message || err);
      setState(/network|fetch|cache\.add/i.test(msg)
        ? 'The download was interrupted (' + msg + '). Check your connection, pause any VPN, firewall or ad blocker for this site, then press the button again. It continues where it stopped. The 1B model is a smaller download if the connection is weak.'
        : 'Could not start the model: ' + msg);
    } finally { $('cbModel').disabled = false; $('cbGo').disabled = false; refreshButton(); }
  }

  async function ask(q) {
    if (busy || !engine) return;
    busy = true; $('cbSend').hidden = true; $('cbStop').hidden = false; $('cbInput').disabled = true;
    addMsg('user', q); const bubble = addMsg('bot', '\u2026');
    try {
      if (!recs.length) await loadData();
      const run = budget => engine.chat.completions.create({ messages: buildMessages(q, history, recs, summary, budget), stream: true, temperature: 0.2, max_tokens: 400 });
      let stream;
      const rb = modelOf(loadedKey).rb;
      try { stream = await run(rb); }
      catch (e) { if (/context|exceed|token/i.test(String(e && e.message || e))) stream = await run(Math.round(rb * 0.4)); else throw e; }
      let txt = '';
      for await (const ch of stream) { const d = ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content; if (d) { txt += d; bubble.textContent = txt; bubble.scrollIntoView({ block: 'end' }); } }
      bubble.textContent = txt || '(no answer)';
      history.push({ role: 'user', content: q }, { role: 'assistant', content: txt }); history = history.slice(-4);
    } catch (err) {
      console.warn(err); bubble.textContent = 'Something went wrong: ' + (err && err.message || err);
    } finally { busy = false; $('cbSend').hidden = false; $('cbStop').hidden = true; $('cbInput').disabled = false; $('cbInput').focus(); }
  }

  /* ----- wiring ----- */
  $('cbGo').onclick = startModel;
  $('cbModel').onchange = refreshButton;
  $('cbRefresh').onclick = loadData;
  $('cbClear').onclick = () => { history = []; $('cbLog').innerHTML = ''; };
  $('cbStop').onclick = () => { try { engine.interruptGenerate(); } catch (_) {} };
  $('cbForm').onsubmit = e => { e.preventDefault(); const q = $('cbInput').value.trim(); if (!q) return; $('cbInput').value = ''; ask(q); };
  $('cbDelete').onclick = async () => {
    if (!confirm('Remove the downloaded model from this device? You will need to download it again to use the assistant.')) return;
    try {
      if (!wl) wl = await import(WEBLLM_URL);
      if (engine) { enableChat(false); try { await engine.unload(); } catch (_) {} engine = null; loadedId = ''; }
      await wl.deleteModelAllInfoInCache(await modelId($('cbModel').value));
      setState('Model removed from this device.');
    } catch (err) { setState('Could not remove it: ' + (err && err.message || err)); }
    refreshButton();
  };

  if (!navigator.gpu) setState('This browser does not support WebGPU, which the local model needs. Try the latest Chrome or Edge.');
  loadData();
  fillModels();
  import(WEBLLM_URL).then(m => { wl = m; pruneModels(); refreshButton(); }).catch(() => setState('Could not load the WebLLM library (check your connection).'));
})();
