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

const FIN_ICON = { doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>', trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>', pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>' };
const finIcon = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIN_ICON[name]}</svg></button>`;

function rowHtml(it, recordable) {
  const flowCls = it.flow === 'inflow' ? 'amt-in' : it.flow === 'none' ? 'amt-none' : 'amt-out';
  const sign = it.flow === 'inflow' ? '+' : it.flow === 'none' ? '' : '\u2212';
  const flowWord = it.flow === 'inflow' ? 'Inflow' : it.flow === 'none' ? 'No cash' : 'Outflow';
  const meta = [fmtDay(it.date), it.payMethod ? escFin(it.payMethod) : '', flowWord].filter(Boolean).join(' \u00b7 ');
  const acts = finIcon('pencil', 'fin-edit', 'Edit task', it.id)
    + (!recordable ? finIcon('undo', 'fin-unrecord', 'Undo', it.id) : '')
    + finIcon('trash', 'fin-delete danger', 'Delete task', it.id);
  const notes = it.notes ? `<span class="fin-notes">${escFin(it.notes)}</span>` : '';
  const imgs = it.images || [];
  const thumbs = imgs.length ? `<div class="fin-thumbs">${imgs.map((im, i) => `<button type="button" class="fin-thumb" data-id="${it.id}" data-i="${i}" aria-label="View image ${i + 1}"><img src="${escFin(im.thumb)}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
  return `<div class="fin-item fin-line" data-id="${it.id}">
      <label class="fin-chk">${recordable ? '<input type="checkbox" class="fin-mark">' : '<span class="fin-done">&check;</span>'}</label>
      <div class="port-info"><b>${escFin(it.description)}</b>${notes}<span>${meta}</span>${thumbs}</div>
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

  const editBtn = e.target.closest('.fin-edit');
  if (editBtn) { openEditor(editBtn.dataset.id); return; }

  const thumb = e.target.closest('.fin-thumb');
  if (thumb) { openImgView(thumb.dataset.id, +thumb.dataset.i); return; }

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

/* ---------- Task editor: add a standalone task, or edit any task (title, description, up to 5 images) ---------- */
const MAX_IMG = 5;
const $ts = id => document.getElementById(id);
const todayIso = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const newTaskId = () => 'f_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
const findTask = id => finData.toRecord.concat(finData.recorded).find(t => String(t.id) === String(id));
const room = () => MAX_IMG - ed.images.length;
// ed.images items: {kind:'keep',src:<stored url>} | {kind:'upload',src:<dataURL>} | {kind:'link',src:<url>} | {kind:'receipt',receiptId}; each also has .thumb for preview
let ed = { id: null, isNew: true, images: [] };

function openEditor(id) {
  const t = id ? findTask(id) : null;
  ed = { id: t ? t.id : newTaskId(), isNew: !t, images: t ? (t.images || []).map(im => ({ kind: 'keep', src: im.raw, thumb: im.thumb })) : [] };
  $ts('taskHeading').textContent = t ? 'Edit task' : 'Add task';
  $ts('taskHint').hidden = !t;
  $ts('taskNewOnly').hidden = !!t;
  $ts('taskTitle').value = t ? t.description : '';
  $ts('taskDesc').value = t ? (t.notes || '') : '';
  $ts('taskSave').textContent = t ? 'Save changes' : 'Add task';
  if (!t) {
    $ts('taskAmt').value = ''; $ts('taskPay').value = 'Cash';
    $ts('taskPayOther').value = ''; $ts('taskPayOther').hidden = true; $ts('taskDate').value = todayIso();
    document.querySelector('input[name=taskFlow][value=outflow]').checked = true;
    syncTaskFlow();
  }
  closeImgTools();
  renderImgs();
  $ts('taskSheet').hidden = false;
  if (!t) $ts('taskTitle').focus();
}
function closeEditor() { $ts('taskSheet').hidden = true; closeImgTools(); }
function closeImgTools() {
  $ts('imgLinkField').hidden = true; $ts('imgLinkInput').value = '';
  $ts('rsList').hidden = true; $ts('rsList').innerHTML = '';
}
function renderImgs() {
  $ts('imgGrid').innerHTML = ed.images.map((im, i) => `<div class="img-tile"><img src="${escFin(im.thumb)}" alt=""><button type="button" class="img-x" data-i="${i}" aria-label="Remove image">&times;</button></div>`).join('');
  $ts('imgCount').textContent = `${ed.images.length}/${MAX_IMG}`;
  $ts('imgAdd').hidden = room() <= 0;
  if (room() <= 0) closeImgTools();
}
$ts('finAdd').onclick = () => openEditor(null);
$ts('taskCancel').onclick = closeEditor;
$ts('taskSheet').addEventListener('click', e => { if (e.target.id === 'taskSheet') closeEditor(); });
$ts('imgGrid').addEventListener('click', e => {
  const x = e.target.closest('.img-x');
  if (!x) return;
  ed.images.splice(+x.dataset.i, 1);
  renderImgs();
});
function syncTaskFlow() {
  const none = document.querySelector('input[name=taskFlow]:checked').value === 'none';
  $ts('taskMoney').hidden = none; $ts('taskPayWrap').hidden = none;
}
document.querySelectorAll('input[name=taskFlow]').forEach(r => r.addEventListener('change', syncTaskFlow));
$ts('taskPay').addEventListener('change', () => { $ts('taskPayOther').hidden = $ts('taskPay').value !== 'Others'; });

/* adding images: upload (several at once), an existing archived receipt, or a pasted link */
function shrinkImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}
$ts('imgUpload').onclick = () => $ts('finFileUpload').click();
$ts('finFileUpload').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []); e.target.value = '';
  if (!files.length) return;
  const take = files.slice(0, Math.max(0, room()));
  if (files.length > take.length) toast(`Only ${MAX_IMG} images per task \u2014 extra files skipped.`);
  for (const f of take) {
    try { const src = await shrinkImage(f); ed.images.push({ kind: 'upload', src, thumb: src }); }
    catch (_) { toast('Could not read one of the images.'); }
  }
  renderImgs();
});
$ts('imgLink').onclick = () => { $ts('rsList').hidden = true; $ts('imgLinkField').hidden = false; $ts('imgLinkInput').focus(); };
$ts('imgLinkUse').onclick = () => {
  const url = $ts('imgLinkInput').value.trim();
  if (!/^https?:\/\//i.test(url)) return toast('Paste a full image address starting with http.');
  if (room() <= 0) return;
  ed.images.push({ kind: 'link', src: url, thumb: url });
  $ts('imgLinkInput').value = ''; $ts('imgLinkField').hidden = true;
  renderImgs();
};
$ts('imgExisting').onclick = async () => {
  const list = $ts('rsList');
  $ts('imgLinkField').hidden = true;
  list.hidden = false; list.innerHTML = '<p class="stub-note" style="margin:6px 0">Loading receipts\u2026</p>';
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?action=receipts&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error || 'Request failed');
    const rs = (data.receipts || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    list.innerHTML = rs.length ? rs.map(r => `<button type="button" class="rs-item" data-rid="${escFin(r.id)}" data-thumb="${escFin(r.url)}">
        <img src="${escFin(r.url)}" alt="" loading="lazy">
        <div><b>${escFin(r.description || 'Receipt')}</b><span>${fmtDay(r.date)}</span></div></button>`).join('')
      : '<p class="stub-note" style="margin:6px 0">No receipts archived yet.</p>';
  } catch (err) { list.innerHTML = `<p class="stub-note" style="margin:6px 0">Couldn't load receipts.</p>`; }
};
$ts('rsList').addEventListener('click', e => {
  const item = e.target.closest('.rs-item');
  if (!item || room() <= 0) return;
  if (ed.images.some(im => im.kind === 'receipt' && im.receiptId === item.dataset.rid)) return toast('That receipt is already added.');
  ed.images.push({ kind: 'receipt', receiptId: item.dataset.rid, thumb: item.dataset.thumb });
  closeImgTools();
  renderImgs();
});

/* viewing a task's images */
function openImgView(taskId, idx) {
  const t = findTask(taskId), imgs = (t && t.images) || [];
  if (!imgs.length) return;
  $ts('imgViewBody').innerHTML = imgs.map((im, i) => `<a href="${escFin(im.full)}" target="_blank" rel="noopener"><img src="${escFin(im.full)}" alt="Image ${i + 1}" loading="lazy"></a>`).join('');
  $ts('imgView').hidden = false;
  const el = $ts('imgViewBody').children[idx || 0];
  if (el) el.scrollIntoView({ block: 'start' });
}
$ts('imgViewClose').onclick = () => $ts('imgView').hidden = true;
$ts('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') $ts('imgView').hidden = true; });

/* saving: one POST for create and edit. The task ID is made in the browser and the backend upserts on it,
   so if the response can't be read (Apps Script CORS) the blind retry can never create a duplicate task. */
async function postFinance(body) {
  const payload = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) };
  let data = null;
  try { const res = await fetch(CONFIG.portfolio.endpoint, payload); try { data = await res.json(); } catch (_) {} } catch (_) {}
  if (data && data.ok === true) return true;
  if (data && data.ok === false) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
  await fetch(CONFIG.portfolio.endpoint, { ...payload, mode: 'no-cors' });   // unreadable response: send once more, blind
  return false;
}
$ts('taskSave').onclick = async () => {
  const title = $ts('taskTitle').value.trim(), notes = $ts('taskDesc').value.trim();
  if (!title) return toast('Add a title.');
  if (!CONFIG.portfolio.endpoint) return toast("Sync isn't set up yet.");
  const wasNew = ed.isNew;
  const body = {
    action: 'saveFinance', secret: CONFIG.portfolio.secret, financeId: ed.id, isNew: wasNew, title, notes,
    images: ed.images.map(im => im.kind === 'receipt' ? { kind: 'receipt', receiptId: im.receiptId } : { kind: im.kind, src: im.src })
  };
  if (wasNew) {
    const flow = document.querySelector('input[name=taskFlow]:checked').value;
    const amount = flow === 'none' ? 0 : parseFloat($ts('taskAmt').value);
    if (!isFinite(amount) || amount < 0) return toast('Enter a valid amount.');
    Object.assign(body, {
      flow, amount, date: $ts('taskDate').value || todayIso(),
      payMethod: flow === 'none' ? '' : $ts('taskPay').value === 'Others' ? ($ts('taskPayOther').value.trim() || 'Others') : $ts('taskPay').value
    });
  }
  const btn = $ts('taskSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const confirmed = await postFinance(body);
    closeEditor();
    if (confirmed) { toast(wasNew ? 'Task added.' : 'Task updated.'); await loadFinance(); }
    else { toast('Sent \u2014 refreshing in a moment\u2026'); await new Promise(r => setTimeout(r, 3000)); await loadFinance(); }
    if (wasNew) setFinTab('torecord');
  } catch (err) {
    toast('Could not save: ' + err.message);
  }
  btn.disabled = false; btn.textContent = wasNew ? 'Add task' : 'Save changes';
};

loadFinance();
