/* ---------- Receipts archive — every generated receipt image, from the Receipts sheet ---------- */
const escRec = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $recList = document.getElementById('recList');
const $recState = document.getElementById('recState');
const TYPE_LABEL = { purchase: 'Purchase', sale: 'Sale' };

let recTab = 'all';
let receipts = [];

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'recCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
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

function fmtDay(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function rowHtml(r) {
  return `<div class="receipt-tile" data-url="${escRec(r.url)}">
      <div class="receipt-tile-img"><img src="${r.url}" alt="Receipt" loading="lazy"></div>
      <div class="receipt-tile-info"><b>${TYPE_LABEL[r.type] || r.type}</b><span>${fmtDay(r.date)}</span></div>
    </div>`;
}

function render() {
  const list = recTab === 'all' ? receipts : receipts.filter(r => r.type === recTab);
  if (!list.length) {
    $recState.textContent = 'No receipts archived yet.';
    $recState.hidden = false; $recList.hidden = true;
    return;
  }
  $recList.innerHTML = list.map(rowHtml).join('');
  $recState.hidden = true; $recList.hidden = false;
}

async function loadReceipts() {
  if (!CONFIG.portfolio.endpoint) { $recState.textContent = "Sync isn't set up yet."; $recState.hidden = false; return; }
  $recState.textContent = 'Loading\u2026'; $recState.hidden = false; $recList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=receipts&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    receipts = data.receipts || [];
    render();
  } catch (err) {
    console.warn('Receipts load failed', err);
    $recState.textContent = "Couldn't load receipts (offline, wrong secret, or Code.gs needs a new deployment).";
    $recState.hidden = false; $recList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-rtab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-rtab]').forEach(x => x.classList.toggle('active', x === t));
  recTab = t.dataset.rtab;
  render();
});

$recList.addEventListener('click', e => {
  const card = e.target.closest('.receipt-tile');
  if (!card || !card.dataset.url) return;
  document.getElementById('imgViewImg').src = card.dataset.url;
  document.getElementById('imgView').hidden = false;
});
document.getElementById('imgViewClose').onclick = () => document.getElementById('imgView').hidden = true;
document.getElementById('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') document.getElementById('imgView').hidden = true; });

loadReceipts();
