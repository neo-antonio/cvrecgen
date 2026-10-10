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
  return lines.join('\n').slice(0, 3000);
}

const STOP = new Set('the an of and or to in on for is are was were be how many much what which who when where does did we our my me you your with at by from this that these those it its as about tell show list give all any have has had can could should would please'.split(' '));
const tokens = q => [...new Set((String(q).toLowerCase().match(/[a-z0-9.\-]{2,}/g) || []))].filter(t => !STOP.has(t));

function pickRecords(recs, q, budget = 4500) {
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

function buildMessages(question, history, recs, summary) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const sys = 'You are the Court Vision assistant inside the trackello app. Answer ONLY from the DATA below, which was read from the business\'s Google Sheet backend. '
    + 'You have read-only access: you cannot add, change or delete anything, and you must say so if asked to. '
    + 'If the data does not contain the answer, say you could not find it in the data. Never guess or invent names, dates or numbers. Currency is PHP. Be concise. '
    + 'Today is ' + today + '.\n\n'
    + 'SUMMARY (exact counts and totals; use these for "how many" and "total" questions):\n' + summary + '\n\n'
    + 'RECORDS (only the rows most relevant to this question, not the full list):\n' + pickRecords(recs, question).join('\n');
  return [{ role: 'system', content: sys }]
    .concat(history.slice(-4).map(m => ({ role: m.role, content: m.content.slice(0, 600) })))
    .concat([{ role: 'user', content: question }]);
}

/* ---- UI ---- */
(function () {
  if (typeof document === 'undefined' || !document.getElementById('cbGo')) return;
  const $ = id => document.getElementById(id);
  let wl = null, engine = null, loadedId = '', recs = [], summary = '', history = [], busy = false;

  const setState = t => { $('cbState').textContent = t; };
  const setBar = (p, show = true) => { $('cbBarWrap').hidden = !show; $('cbBar').style.width = Math.round((p || 0) * 100) + '%'; };
  const addMsg = (who, text) => { const d = document.createElement('div'); d.className = 'cb-msg ' + who; d.textContent = text; $('cbLog').appendChild(d); d.scrollIntoView({ block: 'end' }); return d; };

  /* ----- read-only data ----- */
  async function loadData() {
    if (!CONFIG.portfolio || !CONFIG.portfolio.endpoint) { $('cbData').textContent = "Sync isn't set up yet."; return; }
    $('cbData').textContent = 'Reading backend\u2026';
    const out = {};
    const results = await Promise.allSettled(READ_ONLY.map(a => jsonp(readUrl(a)).then(d => { if (d && d.ok) out[a] = d; else throw new Error(a); })));
    const failed = READ_ONLY.filter((a, i) => results[i].status !== 'fulfilled');
    recs = buildRecords(out); summary = buildSummary(recs);
    const t = new Date(), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    $('cbData').textContent = recs.length + ' records read at ' + hm + '.' + (failed.length ? ' Could not read: ' + failed.join(', ') + '.' : '') + ' The assistant can only read, never change, your data.';
  }

  /* ----- model ----- */
  async function modelId(size) {
    let f16 = false;
    try { const a = await navigator.gpu.requestAdapter(); f16 = !!a && a.features.has('shader-f16'); } catch (_) {}
    return 'Llama-3.2-' + size + '-Instruct-q4f' + (f16 ? '16' : '32') + '_1-MLC';
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

  async function startModel() {
    if (!navigator.gpu) return setState('This browser does not support WebGPU, which the local model needs. Try the latest Chrome or Edge.');
    $('cbGo').disabled = $('cbModel').disabled = true;
    try {
      if (!wl) wl = await import(WEBLLM_URL);
      const id = await modelId($('cbModel').value);
      if (!wl.prebuiltAppConfig.model_list.some(m => m.model_id === id)) throw new Error('Model ' + id + ' is not in this WebLLM build');
      if (engine && loadedId === id) return;
      if (engine) { enableChat(false); try { await engine.unload(); } catch (_) {} engine = null; }
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
      setBar(0); setState('Starting\u2026');
      // The model comes in many files. If the connection drops, files already saved are kept, so trying again carries on from there.
      let lastErr = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          engine = await wl.CreateMLCEngine(id, { initProgressCallback: r => { setBar(r.progress); setState((Math.round(r.progress * 100)) + '% \u00b7 ' + (r.text || '')); } });
          lastErr = null; break;
        } catch (err) {
          lastErr = err; engine = null;
          if (attempt === 4 || !/network|fetch|cache\.add|failed to/i.test(String(err && err.message || err))) break;
          setState('Connection hiccup, retrying (' + attempt + ' of 3). Parts already downloaded are kept\u2026');
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      if (lastErr) throw lastErr;
      loadedId = id; setBar(1, false); setState('Ready. Ask anything about your data.'); enableChat(true);
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
      const stream = await engine.chat.completions.create({ messages: buildMessages(q, history, recs, summary), stream: true, temperature: 0.2, max_tokens: 512 });
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
  import(WEBLLM_URL).then(m => { wl = m; refreshButton(); }).catch(() => setState('Could not load the WebLLM library (check your connection).'));
})();
