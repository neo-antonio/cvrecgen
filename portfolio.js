/* ---------- Portfolio list (reads back from the Sheet via Code.gs doGet) ---------- */
const portPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $portList = document.getElementById('portList');
const $portState = document.getElementById('portState');
const $portTotal = document.getElementById('portTotal');
const $portRefresh = document.getElementById('portRefresh');

// Apps Script GET responses aren't reliably CORS-readable via fetch(), so we
// load the data as JSONP instead — a <script> tag request isn't subject to CORS.
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'portfolioCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { delete window[cbName]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('Timed out')); } }, 15000);
    window[cbName] = data => { if (!settled) { settled = true; cleanup(); resolve(data); } };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Script load failed')); } };
    document.body.appendChild(script);
  });
}

function fmtCardDate(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cardHtml(it) {
  const img = it.photo
    ? `<img src="${it.photo}" alt="${escHtml(it.name)}" loading="lazy">`
    : `<div class="port-noimg">No photo</div>`;
  return `<div class="port-card">
      <div class="port-thumb">${img}</div>
      <div class="port-info">
        <b>${escHtml(it.name)}</b>
        <span>${fmtCardDate(it.date)}</span>
      </div>
      <div class="port-cost">${portPhp(it.cost)}</div>
    </div>`;
}

async function loadPortfolio() {
  if (!CONFIG.portfolio.endpoint) { $portState.textContent = "Portfolio sync isn't set up yet."; $portState.hidden = false; $portList.hidden = true; return; }
  $portState.textContent = 'Loading\u2026';
  $portState.hidden = false;
  $portList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    const items = data.items || [];
    if (!items.length) {
      $portState.textContent = 'No cards recorded yet.';
      $portTotal.textContent = portPhp(0);
      return;
    }
    $portList.innerHTML = items.map(cardHtml).join('');
    $portTotal.textContent = portPhp(items.reduce((a, i) => a + (Number(i.cost) || 0), 0));
    $portState.hidden = true;
    $portList.hidden = false;
  } catch (err) {
    console.warn('Portfolio load failed', err);
    $portState.textContent = "Couldn't load your portfolio (offline, wrong secret, or Code.gs needs a new deployment).";
    $portState.hidden = false;
    $portList.hidden = true;
  }
}

$portRefresh.onclick = loadPortfolio;
loadPortfolio();