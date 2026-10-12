/* ---------- Shared network + cache helpers (loaded after config.js on every data page) ---------- */
// Apps Script cold-starts and occasionally drops a request. Reads are safe to repeat, so they retry
// quietly (2 more tries) before the page reports a failure. Anything that changes data is never retried.
const READ_ACTIONS = /[?&]action=(portfolio|finance|shipping|receipts|events|balance|onhandCards|receiptImpact|entities|entityNames|entityCards|creatives|organization)(&|$)/;

// Home fires ~8 reads at once and Apps Script answers each one slowly when they pile up (then timeouts + retries pile on more).
// So: at most MAX_PARALLEL reads run at a time, the rest wait their turn; an identical read already in flight is shared instead of
// sent twice; and a write clears the shared reads so nothing stale is handed back right after a change.
const MAX_PARALLEL = 4;
let inFlight = 0;
const waiting = [];
const getSlot = () => new Promise(res => { const go = () => { inFlight++; res(); }; if (inFlight < MAX_PARALLEL) go(); else waiting.push(go); });
const freeSlot = () => { inFlight--; const next = waiting.shift(); if (next) next(); };
const pendingReads = new Map();

function jsonpOnce(url, ms) {
  return new Promise((resolve, reject) => {
    const cbName = 'cvCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { delete window[cbName]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('Timed out')); } }, ms);
    window[cbName] = data => { if (!settled) { settled = true; cleanup(); resolve(data); } };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Script load failed')); } };
    document.body.appendChild(script);
  });
}

function jsonp(url, ms) {
  if (!READ_ACTIONS.test(url)) { pendingReads.clear(); return jsonpOnce(url, ms || 30000); }   // writes: never queued, never retried
  if (pendingReads.has(url)) return pendingReads.get(url);
  // 35 s per try: a try that is only slow keeps running on the server, so giving up early and re-asking just doubles the load
  const limit = ms || 35000;
  const attempt = n => getSlot()
    .then(() => jsonpOnce(url, limit).finally(freeSlot))
    .catch(err => n < 2 ? new Promise(r => setTimeout(r, 1500 * (n + 1))).then(() => attempt(n + 1)) : Promise.reject(err));
  const p = attempt(0), clear = () => pendingReads.delete(url);
  pendingReads.set(url, p); p.then(clear, clear);
  return p;
}

// Last good answer per screen, kept on this device. Pages draw it instantly on open, then refresh
// in the background, so a slow or failed request no longer leaves a blank "Loading…" screen.
// One-time repair: Home used to save a stripped-down copy of the receipts (ids only) under the same key the Receipts archive uses for its own list,
// so whichever page ran last broke the other. Home now has its own key ('homeReceipts'); this clears the mixed-up copy once.
try { if (!localStorage.getItem('cv:fix:receiptsKey')) { localStorage.removeItem('cv:receipts'); localStorage.setItem('cv:fix:receiptsKey', '1'); } } catch (_) {}

const cacheGet = key => { try { const v = JSON.parse(localStorage.getItem('cv:' + key)); return v && v.d ? v.d : null; } catch (_) { return null; } };
const cacheSet = (key, d) => { try { localStorage.setItem('cv:' + key, JSON.stringify({ t: Date.now(), d })); } catch (_) {} };
