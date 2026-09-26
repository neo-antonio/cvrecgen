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

function toast(m) {
  const t = document.getElementById('finToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

function fmtDay(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function rowHtml(it, recordable) {
  const receiptBtn = it.receipt ? `<button type="button" class="ghost sm fin-receipt" data-url="${escFin(it.receipt)}">Receipt</button>` : '';
  const revertBtn = !recordable ? `<button type="button" class="ghost sm fin-unrecord" data-id="${it.id}">Undo</button>` : '';
  return `<div class="fin-item" data-id="${it.id}">
      <div class="port-card fin-row">
        <label class="fin-chk">${recordable ? '<input type="checkbox" class="fin-mark">' : '<span class="fin-done">&check;</span>'}</label>
        <div class="port-info">
          <b>${escFin(it.description)}</b>
          <span>${fmtDay(it.date)}${it.payMethod ? ' \u00b7 ' + escFin(it.payMethod) : ''}</span>
        </div>
        <div class="port-cost">${finPhp(it.amount)}</div>
      </div>
      <div class="fin-item-acts">${receiptBtn}${revertBtn}<button type="button" class="ghost sm fin-delete" data-id="${it.id}">Delete</button></div>
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
  const row = e.target.closest('.fin-item');
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
    row.querySelector('.fin-row').classList.add('fin-row-error');
    setTimeout(() => row.querySelector('.fin-row').classList.remove('fin-row-error'), 1500);
  }
});

$finList.addEventListener('click', async e => {
  const receiptBtn = e.target.closest('.fin-receipt');
  if (receiptBtn) { window.open(receiptBtn.dataset.url, '_blank'); return; }

  const delBtn = e.target.closest('.fin-delete');
  if (delBtn) {
    if (!confirm('Delete this Finance entry permanently?')) return;
    delBtn.disabled = true; delBtn.textContent = 'Deleting\u2026';
    try {
      const url = CONFIG.portfolio.endpoint + '?action=deleteFinance&financeId=' + encodeURIComponent(delBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadFinance();
    } catch (err) {
      delBtn.disabled = false; delBtn.textContent = 'Delete';
      toast('Could not delete: ' + err.message);
    }
    return;
  }

  const undoBtn = e.target.closest('.fin-unrecord');
  if (undoBtn) {
    undoBtn.disabled = true; undoBtn.textContent = 'Undoing\u2026';
    try {
      const url = CONFIG.portfolio.endpoint + '?action=unrecord&financeId=' + encodeURIComponent(undoBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadFinance();
    } catch (err) {
      undoBtn.disabled = false; undoBtn.textContent = 'Undo';
      toast('Could not undo: ' + err.message);
    }
  }
});

loadFinance();
