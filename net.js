/* ---------- Shared network + cache helpers (loaded after config.js on every data page) ---------- */
// Apps Script cold-starts and occasionally drops a request. Reads are safe to repeat, so they retry
// quietly (2 more tries) before the page reports a failure. Anything that changes data is never retried.
const READ_ACTIONS = /[?&]action=(portfolio|finance|shipping|receipts|events|balance|onhandCards|receiptImpact|entities|entityNames)(&|$)/;

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
  const retriable = READ_ACTIONS.test(url);
  const limit = ms || (retriable ? 20000 : 30000);
  const attempt = n => jsonpOnce(url, limit).catch(err =>
    (retriable && n < 2) ? new Promise(r => setTimeout(r, 700 * (n + 1))).then(() => attempt(n + 1)) : Promise.reject(err));
  return attempt(0);
}

// Last good answer per screen, kept on this device. Pages draw it instantly on open, then refresh
// in the background, so a slow or failed request no longer leaves a blank "Loading…" screen.
const cacheGet = key => { try { const v = JSON.parse(localStorage.getItem('cv:' + key)); return v && v.d ? v.d : null; } catch (_) { return null; } };
const cacheSet = (key, d) => { try { localStorage.setItem('cv:' + key, JSON.stringify({ t: Date.now(), d })); } catch (_) {} };
