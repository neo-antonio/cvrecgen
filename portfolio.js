/* ---------- Portfolio (Owned / Sold) — reads back from Cards via Code.gs doGet ---------- */
const portPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $portList = document.getElementById('portList');
const $portState = document.getElementById('portState');
const $portTotal = document.getElementById('portTotal');
const $portSummaryLabel = document.querySelector('.port-summary span');
const $portRefresh = document.getElementById('portRefresh');

let portTab = 'owned';
let portData = { owned: [], sold: [] };

const TAG_LABEL = { onhand: 'Onhand', shipping: 'Shipping', shipped: 'Shipped', sold: 'Sold' };

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
  const dateLine = portTab === 'owned' ? fmtCardDate(it.purchaseDate) : fmtCardDate(it.soldDate);
  const costLine = portTab === 'owned' ? it.purchaseCost : it.soldPrice;
  return `<div class="port-card">
      <div class="port-thumb">${img}</div>
      <div class="port-info">
        <b>${escHtml(it.name)}</b>
        <span>${dateLine}</span>
      </div>
      <div class="port-right">
        <span class="port-tag tag-${it.tag}">${TAG_LABEL[it.tag] || it.tag}</span>
        <div class="port-cost">${portPhp(costLine)}</div>
      </div>
    </div>`;
}

function renderTab() {
  const list = portTab === 'owned' ? portData.owned : portData.sold;
  $portSummaryLabel.textContent = portTab === 'owned' ? 'Onhand value' : 'Total sold';
  if (!list.length) {
    $portState.textContent = portTab === 'owned' ? 'No cards onhand.' : 'Nothing sold yet.';
    $portState.hidden = false; $portList.hidden = true;
    $portTotal.textContent = portPhp(0);
    return;
  }
  $portList.innerHTML = list.map(cardHtml).join('');
  const total = list.reduce((a, i) => a + (Number(portTab === 'owned' ? i.purchaseCost : i.soldPrice) || 0), 0);
  $portTotal.textContent = portPhp(total);
  $portState.hidden = true; $portList.hidden = false;
}

async function loadPortfolio() {
  if (!CONFIG.portfolio.endpoint) { $portState.textContent = "Portfolio sync isn't set up yet."; $portState.hidden = false; $portList.hidden = true; return; }
  $portState.textContent = 'Loading\u2026';
  $portState.hidden = false;
  $portList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=portfolio&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    portData = { owned: data.owned || [], sold: data.sold || [] };
    renderTab();
  } catch (err) {
    console.warn('Portfolio load failed', err);
    $portState.textContent = "Couldn't load your portfolio (offline, wrong secret, or Code.gs needs a new deployment).";
    $portState.hidden = false;
    $portList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-ptab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-ptab]').forEach(x => x.classList.toggle('active', x === t));
  portTab = t.dataset.ptab;
  renderTab();
});
$portRefresh.onclick = loadPortfolio;
loadPortfolio();
