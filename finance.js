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

const FIN_ICON = { doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>', trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>' };
const finIcon = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIN_ICON[name]}</svg></button>`;

function rowHtml(it, recordable) {
  const standalone = it.type === 'manual';
  const flowCls = it.flow === 'inflow' ? 'amt-in' : it.flow === 'none' ? 'amt-none' : 'amt-out';
  const sign = it.flow === 'inflow' ? '+' : it.flow === 'none' ? '' : '\u2212';
  const flowWord = it.flow === 'inflow' ? 'Inflow' : it.flow === 'none' ? 'No cash' : 'Outflow';
  const meta = [fmtDay(it.date), it.payMethod ? escFin(it.payMethod) : '', flowWord].filter(Boolean).join(' \u00b7 ');
  const acts = (standalone ? finIcon('doc', 'fin-rcpt' + (it.receipt ? ' has' : ''), it.receipt ? 'Receipt' : 'Attach receipt', it.id) : '')
    + (!recordable ? finIcon('undo', 'fin-unrecord', 'Undo', it.id) : '')
    + finIcon('trash', 'fin-delete danger', 'Delete task', it.id);
  return `<div class="fin-item fin-line" data-id="${it.id}">
      <label class="fin-chk">${recordable ? '<input type="checkbox" class="fin-mark">' : '<span class="fin-done">&check;</span>'}</label>
      <div class="port-info"><b>${escFin(it.description)}</b><span>${meta}</span></div>
      <div class="fin-right">
        <div class="fin-amt ${flowCls}">${sign}${finPhp(it.amount)}</div>
        <div class="fin-line-acts">${acts}</div>
      </div>
    </div>`;
}

/* Tasks are grouped by the receipt they came from (matched on the receipt URL each Finance row
   already stores). Standalone tasks, even ones with a receipt attached, stay together in
   "Standalone tasks". groupKey/groupLabel come from the newer Code.gs; against an older one we
   fall back to the raw URL. */
const RECEIPT_NAME = { purchase: 'Purchase receipt', sale: 'Sale receipt', trade: 'Trade receipt', shipping: 'Sale receipt' };
function groupItems(list) {
  const groups = [], byKey = {};
  list.forEach(it => {
    const key = it.type === 'manual' ? 'none' : (it.groupKey || (it.receipt ? 'url:' + it.receipt : 'none'));
    if (!byKey[key]) { byKey[key] = { key, items: [], first: it }; groups.push(byKey[key]); }
    byKey[key].items.push(it);
  });
  return groups;
}
function groupHtml(g, recordable) {
  const f = g.first, standalone = g.key === 'none';
  const kind = RECEIPT_NAME[f.groupType] || RECEIPT_NAME[f.type] || 'Receipt';
  const title = standalone ? 'Standalone tasks' : (f.groupLabel || kind);
  const n = g.items.length;
  const count = `${n} task${n > 1 ? 's' : ''}`;
  const sub = standalone ? count : [kind, fmtDay(f.groupDate || f.date), count].filter(Boolean).join(' \u00b7 ');
  const receiptBtn = !standalone && f.receipt ? `<button type="button" class="icon-btn fin-receipt" data-url="${escFin(f.receipt)}" title="View receipt" aria-label="View receipt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIN_ICON.doc}</svg></button>` : '';
  return `<section class="fin-group">
      <div class="fin-group-head">
        <div class="fin-group-title"><b>${escFin(title)}</b><span>${escFin(sub)}</span></div>
        ${receiptBtn}
      </div>
      ${g.items.map(it => rowHtml(it, recordable)).join('')}
    </section>`;
}

function renderTab() {
  const list = finTab === 'torecord' ? finData.toRecord : finData.recorded;
  if (!list.length) {
    $finState.textContent = finTab === 'torecord' ? 'Nothing waiting to be recorded.' : 'Nothing recorded yet.';
    $finState.hidden = false; $finList.hidden = true;
    $finTotal.textContent = finPhp(0);
    return;
  }
  $finList.innerHTML = groupItems(list).map(g => groupHtml(g, finTab === 'torecord')).join('');
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

function setFinTab(name) {
  document.querySelectorAll('.tab[data-ftab]').forEach(x => x.classList.toggle('active', x.dataset.ftab === name));
  finTab = name;
  renderTab();
}
document.querySelectorAll('.tab[data-ftab]').forEach(t => t.onclick = () => setFinTab(t.dataset.ftab));
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
    row.classList.add('fin-row-error');
    setTimeout(() => row.classList.remove('fin-row-error'), 1500);
  }
});

$finList.addEventListener('click', async e => {
  const receiptBtn = e.target.closest('.fin-receipt');
  if (receiptBtn) { window.open(receiptBtn.dataset.url, '_blank'); return; }

  const taskRcpt = e.target.closest('.fin-rcpt');
  if (taskRcpt) { openRcptSheet(taskRcpt.dataset.id); return; }

  const delBtn = e.target.closest('.fin-delete');
  if (delBtn) {
    if (!confirm('Delete this Finance entry permanently?')) return;
    delBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=deleteFinance&financeId=' + encodeURIComponent(delBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadFinance();
    } catch (err) {
      delBtn.disabled = false;
      toast('Could not delete: ' + err.message);
    }
    return;
  }

  const undoBtn = e.target.closest('.fin-unrecord');
  if (undoBtn) {
    undoBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=unrecord&financeId=' + encodeURIComponent(undoBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadFinance();
    } catch (err) {
      undoBtn.disabled = false;
      toast('Could not undo: ' + err.message);
    }
  }
});

/* ---------- Standalone task (touches no card or receipt) ---------- */
const $ts = id => document.getElementById(id);
const todayIso = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function openTaskSheet() {
  $ts('taskDesc').value = ''; $ts('taskAmt').value = ''; $ts('taskPay').value = 'Cash';
  $ts('taskPayOther').value = ''; $ts('taskPayOther').hidden = true; $ts('taskDate').value = todayIso();
  document.querySelector('input[name=taskFlow][value=outflow]').checked = true;
  syncTaskFlow();
  $ts('taskSheet').hidden = false;
  $ts('taskDesc').focus();
}
function closeTaskSheet() { $ts('taskSheet').hidden = true; }
$ts('finAdd').onclick = openTaskSheet;
$ts('taskCancel').onclick = closeTaskSheet;
$ts('taskSheet').addEventListener('click', e => { if (e.target.id === 'taskSheet') closeTaskSheet(); });
function syncTaskFlow() {
  const none = document.querySelector('input[name=taskFlow]:checked').value === 'none';
  $ts('taskMoney').hidden = none; $ts('taskPayWrap').hidden = none;
}
document.querySelectorAll('input[name=taskFlow]').forEach(r => r.addEventListener('change', syncTaskFlow));
$ts('taskPay').addEventListener('change', () => { $ts('taskPayOther').hidden = $ts('taskPay').value !== 'Others'; });
$ts('taskSave').onclick = async () => {
  const description = $ts('taskDesc').value.trim();
  const flow = document.querySelector('input[name=taskFlow]:checked').value;
  const amount = flow === 'none' ? 0 : parseFloat($ts('taskAmt').value);
  if (!description) return toast('Add a description.');
  if (!isFinite(amount) || amount < 0) return toast('Enter a valid amount.');
  if (!CONFIG.portfolio.endpoint) return toast("Sync isn't set up yet.");
  const payMethod = flow === 'none' ? '' : $ts('taskPay').value === 'Others' ? ($ts('taskPayOther').value.trim() || 'Others') : $ts('taskPay').value;
  const btn = $ts('taskSave'); btn.disabled = true; btn.textContent = 'Adding\u2026';
  try {
    const url = CONFIG.portfolio.endpoint + '?action=addFinance&description=' + encodeURIComponent(description) +
      '&amount=' + encodeURIComponent(amount) + '&flow=' + flow + '&payMethod=' + encodeURIComponent(payMethod) +
      '&date=' + encodeURIComponent($ts('taskDate').value || todayIso()) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    closeTaskSheet();
    toast('Task added.');
    await loadFinance();
    setFinTab('torecord');
  } catch (err) {
    toast('Could not add task: ' + err.message);
  }
  btn.disabled = false; btn.textContent = 'Add task';
};

/* ---------- Receipt for a standalone task: upload, paste a link, or link an existing receipt ---------- */
let rcptTaskId = null;
const findTask = id => finData.toRecord.concat(finData.recorded).find(t => String(t.id) === String(id));
const backendMsg = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
function openRcptSheet(id) {
  rcptTaskId = id;
  const t = findTask(id);
  $ts('rsView').hidden = !(t && t.receipt);
  $ts('rsRemove').hidden = !(t && t.receipt);
  $ts('rsLinkField').hidden = true; $ts('rsLinkInput').value = '';
  $ts('rsList').hidden = true; $ts('rsList').innerHTML = '';
  $ts('rcptSheet').hidden = false;
}
function closeRcptSheet() { $ts('rcptSheet').hidden = true; rcptTaskId = null; }
async function taskReceiptCall(query, okMsg) {
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?' + query + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error || 'Request failed');
    toast(okMsg);
    await loadFinance();
  } catch (err) { toast('Could not update receipt: ' + backendMsg(err)); }
}
$ts('rsCancel').onclick = closeRcptSheet;
$ts('rcptSheet').addEventListener('click', e => { if (e.target.id === 'rcptSheet') closeRcptSheet(); });
$ts('rsView').onclick = () => { const t = findTask(rcptTaskId); if (t && t.receipt) window.open(t.receipt, '_blank'); };
$ts('rsCamera').onclick = () => $ts('finFileCamera').click();
$ts('rsUpload').onclick = () => $ts('finFileUpload').click();
$ts('rsLink').onclick = () => { $ts('rsLinkField').hidden = false; $ts('rsLinkInput').focus(); };
$ts('rsLinkUse').onclick = () => {
  const url = $ts('rsLinkInput').value.trim(), id = rcptTaskId;
  if (!id) return;
  if (!/^https?:\/\//i.test(url)) return toast('Paste a full image address starting with http.');
  closeRcptSheet();
  taskReceiptCall('action=linkFinanceReceipt&financeId=' + encodeURIComponent(id) + '&url=' + encodeURIComponent(url), 'Receipt attached.');
};
$ts('rsRemove').onclick = () => {
  const id = rcptTaskId;
  if (!id) return;
  closeRcptSheet();
  taskReceiptCall('action=unlinkFinanceReceipt&financeId=' + encodeURIComponent(id), 'Receipt removed.');
};
$ts('rsExisting').onclick = async () => {
  const list = $ts('rsList');
  list.hidden = false; list.innerHTML = '<p class="stub-note" style="margin:6px 0">Loading receipts\u2026</p>';
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?action=receipts&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error || 'Request failed');
    const rs = data.receipts || [];
    list.innerHTML = rs.length ? rs.map(r => `<button type="button" class="rs-item" data-rid="${escFin(r.id)}">
        <img src="${escFin(r.url)}" alt="" loading="lazy">
        <div><b>${escFin(r.description || 'Receipt')}</b><span>${fmtDay(r.date)}</span></div></button>`).join('')
      : '<p class="stub-note" style="margin:6px 0">No receipts archived yet.</p>';
  } catch (err) { list.innerHTML = `<p class="stub-note" style="margin:6px 0">Couldn't load receipts.</p>`; }
};
$ts('rsList').addEventListener('click', e => {
  const item = e.target.closest('.rs-item');
  if (!item || !rcptTaskId) return;
  const id = rcptTaskId;
  closeRcptSheet();
  taskReceiptCall('action=linkFinanceReceipt&financeId=' + encodeURIComponent(id) + '&receiptId=' + encodeURIComponent(item.dataset.rid), 'Receipt linked.');
});
function handleFinFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !rcptTaskId) return;
    const id = rcptTaskId, reader = new FileReader();
    reader.onload = () => sendTaskReceipt(id, { kind, src: reader.result });
    reader.readAsDataURL(f);
    closeRcptSheet();
  });
}
handleFinFile($ts('finFileCamera'), 'camera');
handleFinFile($ts('finFileUpload'), 'upload');
async function sendTaskReceipt(financeId, photo) {
  toast('Uploading receipt\u2026');
  const payload = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'financeReceipt', secret: CONFIG.portfolio.secret, financeId, photo })
  };
  try {
    const res = await fetch(CONFIG.portfolio.endpoint, payload);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`);
    toast('Receipt attached.');
    await loadFinance();
  } catch (err) {
    console.warn('Receipt upload: readable response blocked (likely CORS), retrying blind.', err);
    try {
      await fetch(CONFIG.portfolio.endpoint, { ...payload, mode: 'no-cors' });
      toast('Receipt sent \u2014 refresh in a moment to confirm it landed.');
    } catch (err2) { toast('Receipt upload failed (offline?).'); }
  }
}

loadFinance();
