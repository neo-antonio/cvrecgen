/* ---------- Finance (To record / Recorded) — reads/writes the Finance sheet via Code.gs ---------- */
const finPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escFin = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $finList = document.getElementById('finList');
const $finState = document.getElementById('finState');
const $finTotal = document.getElementById('finTotal');
const $finRefresh = document.getElementById('finRefresh');

let finTab = 'torecord';
let finData = { toRecord: [], recorded: [] };

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'financeCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
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

function rowHtml(it, recordable) {
  return `<div class="port-card fin-row" data-id="${it.id}">
      <label class="fin-chk">${recordable ? '<input type="checkbox" class="fin-mark">' : '<span class="fin-done">&check;</span>'}</label>
      <div class="port-info">
        <b>${escFin(it.description)}</b>
        <span>${fmtDay(it.date)}${it.payMethod ? ' \u00b7 ' + escFin(it.payMethod) : ''}</span>
      </div>
      <div class="port-cost">${finPhp(it.amount)}</div>
    </div>`;
}

function renderTab() {
  const list = finTab === 'torecord' ? finData.toRecord : finData.recorded;
  if (!list.length) {
    $finState.textContent = finTab === 'torecord' ? 'Nothing waiting to be recorded.' : 'Nothing recorded yet.';
    $finState.hidden = false; $finList.hidden = true;
    $finTotal.textContent = finPhp(0);
    return;
  }
  $finList.innerHTML = list.map(it => rowHtml(it, finTab === 'torecord')).join('');
  $finTotal.textContent = finPhp(list.reduce((a, i) => a + (Number(i.amount) || 0), 0));
  $finState.hidden = true; $finList.hidden = false;
}

async function loadFinance() {
  if (!CONFIG.portfolio.endpoint) { $finState.textContent = "Sync isn't set up yet."; $finState.hidden = false; $finList.hidden = true; return; }
  $finState.textContent = 'Loading\u2026'; $finState.hidden = false; $finList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=finance&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    finData = { toRecord: data.toRecord || [], recorded: data.recorded || [] };
    renderTab();
  } catch (err) {
    console.warn('Finance load failed', err);
    $finState.textContent = "Couldn't load finance data (offline, wrong secret, or Code.gs needs a new deployment).";
    $finState.hidden = false; $finList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-ftab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-ftab]').forEach(x => x.classList.toggle('active', x === t));
  finTab = t.dataset.ftab;
  renderTab();
});
$finRefresh.onclick = loadFinance;

$finList.addEventListener('change', async e => {
  if (!e.target.classList.contains('fin-mark')) return;
  const row = e.target.closest('.fin-row');
  const id = row.dataset.id;
  e.target.disabled = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=record&financeId=' + encodeURIComponent(id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Request failed');
    await loadFinance();
  } catch (err) {
    console.warn('Record failed', err);
    e.target.disabled = false; e.target.checked = false;
    row.classList.add('fin-row-error');
    setTimeout(() => row.classList.remove('fin-row-error'), 1500);
  }
});

loadFinance();
