/* ---------- Finance (To record / Recorded) — reads/writes the Finance sheet via Code.gs ---------- */
const finPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escFin = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $finList = document.getElementById('finList');
const $finState = document.getElementById('finState');
const $finIn = document.getElementById('finIn');
const $finOut = document.getElementById('finOut');
const $finNote = document.getElementById('finNote');
const $finSubmitBar = document.getElementById('finSubmitBar');
const $finRefresh = document.getElementById('finRefresh');

let finTab = 'torecord';
let finData = { toRecord: [], recorded: [] };
// Ticked-but-not-yet-submitted tasks. Ticking only changes this set (no request, no re-render);
// the Record selected button is what sends them.
let picked = new Set();

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

// '14:30' -> '2:30 PM' (blank in, blank out)
const fmtClock = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
// '2026-10-02 14:30' (the moment the balance was typed in) -> 'Oct 2, 2026 \u00b7 2:30 PM'
const fmtStamp = v => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/); return m ? [fmtDay(m[1]), fmtClock(m[2])].join(' \u00b7 ') : fmtDay(v); };
const finNum = n => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FIN_ICON = { doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>', trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>', pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>' };
const finIcon = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIN_ICON[name]}</svg></button>`;

/* ---------- Task display: tidy trade titles, card lists and per-card links ---------- */
const cardsText = (heading, names) => names.length ? `${heading} (${names.length})\n` + names.map(n => '\u2022 ' + n).join('\n') : '';
const splitNames = s => String(s || '').split(', ').map(x => x.trim()).filter(Boolean);
// Trades made before the layout change stored everything in one long title. Rebuild a short title + list from it.
function prettyTask(it) {
  let title = it.description || '', notes = it.notes || '', m;
  if (it.type === 'trade') {
    if ((m = title.match(/^(Trade with .+?) \(no cash\)(?: \u2014 (.*))?$/))) {
      title = m[1] + ' \u2014 no cash';
      notes = [cardsText('Cards', splitNames(m[2])), notes].filter(Boolean).join('\n');
    } else if ((m = title.match(/^Cash (paid|received) \u2014 trade with (.+?)(?: \((.*)\))?$/))) {
      title = 'Trade with ' + m[2] + ' \u2014 cash ' + m[1];
      notes = [cardsText('Cards', splitNames(m[3])), notes].filter(Boolean).join('\n');
    }
  }
  return { title, notes };
}
// "\u2022 name" lines become list items (a link when the card has a photo), headings become small labels, anything else stays text.
function notesHtml(text, cards) {
  const link = {};
  (cards || []).forEach(c => { if (c.link && !link[c.name]) link[c.name] = c.link; });
  let out = '', open = false;
  const close = () => { if (open) { out += '</ul>'; open = false; } };
  String(text || '').split('\n').forEach(line => {
    let m;
    if ((m = line.match(/^\u2022 (.+)$/))) {
      if (!open) { out += '<ul>'; open = true; }
      const u = link[m[1]];
      out += '<li>' + (u ? `<a href="${escFin(u)}" target="_blank" rel="noopener">${escFin(m[1])} \u2197</a>` : escFin(m[1])) + '</li>';
    } else if (/^(Gave|Received|Cards) \(\d+\)$/.test(line)) { close(); out += `<em>${escFin(line)}</em>`; }
    else if (line.trim()) { close(); out += `<div class="fin-plain">${escFin(line)}</div>`; }
  });
  close();
  return out ? `<div class="fin-cl">${out}</div>` : '';
}
function taskDetailHtml(it, pt) {
  const cards = it.cards || [];
  let text = pt.notes, one = '';
  if (it.type !== 'trade') {
    if (cards.length > 1) text = [text, cardsText('Cards', cards.map(c => c.name))].filter(Boolean).join('\n');
    else if (cards.length === 1 && cards[0].link) one = `<a class="fin-viewcard" href="${escFin(cards[0].link)}" target="_blank" rel="noopener">View card \u2197</a>`;
  }
  return notesHtml(text, cards) + one;
}

function rowHtml(it, recordable) {
  const flowCls = it.flow === 'inflow' ? 'amt-in' : it.flow === 'none' ? 'amt-none' : 'amt-out';
  const sign = it.flow === 'inflow' ? '+' : it.flow === 'none' ? '' : '\u2212';
  const flowWord = it.flow === 'inflow' ? 'Inflow' : it.flow === 'none' ? 'No cash' : 'Outflow';
  const meta = [fmtDay(it.date), fmtClock(it.time), it.payMethod ? escFin(it.payMethod) : '', flowWord].filter(Boolean).join(' \u00b7 ');
  const acts = finIcon('pencil', 'fin-edit', 'Edit task', it.id)
    + (!recordable ? finIcon('undo', 'fin-unrecord', 'Undo', it.id) : '')
    + finIcon('trash', 'fin-delete danger', 'Delete task', it.id);
  const pt = prettyTask(it);
  const detail = taskDetailHtml(it, pt);
  const imgs = it.images || [];
  const thumbs = imgs.length ? `<div class="fin-thumbs">${imgs.map((im, i) => `<button type="button" class="fin-thumb" data-id="${it.id}" data-i="${i}" aria-label="View image ${i + 1}"><img src="${escFin(im.thumb)}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
  const isPicked = recordable && picked.has(String(it.id));
  return `<div class="fin-item fin-line${isPicked ? ' fin-picked' : ''}" data-id="${it.id}">
      <label class="fin-chk">${recordable ? `<input type="checkbox" class="fin-mark"${isPicked ? ' checked' : ''}>` : '<span class="fin-done">&check;</span>'}</label>
      <div class="port-info"><b>${escFin(pt.title)}</b><span>${meta}</span>${detail}${thumbs}</div>
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
const RECEIPT_NAME = { purchase: 'Purchase receipt', sale: 'Sale receipt', trade: 'Trade receipt', transfer: 'Transfer receipt', shipping: 'Sale receipt' };
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
  const sub = standalone ? count : [kind, fmtDay(f.groupDate || f.date), f.groupDate ? fmtClock(f.groupTime) : '', count].filter(Boolean).join(' \u00b7 ');
  // money in / out of this receipt's tasks, so shipping and packaging paid by the buyer show in the total
  const inSum = g.items.filter(i => i.flow === 'inflow').reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const outSum = g.items.filter(i => i.flow === 'outflow').reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const totals = !standalone && n > 1 && (inSum || outSum)
    ? `<div class="fin-group-total">${inSum ? `<span class="amt-in">In +${finPhp(inSum)}</span>` : ''}${outSum ? `<span class="amt-out">Out \u2212${finPhp(outSum)}</span>` : ''}</div>` : '';
  const receiptBtn = !standalone && f.receipt ? `<button type="button" class="icon-btn fin-receipt" data-url="${escFin(f.receipt)}" title="View receipt" aria-label="View receipt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIN_ICON.doc}</svg></button>` : '';
  return `<section class="fin-group">
      <div class="fin-group-head">
        <div class="fin-group-title"><b>${escFin(title)}</b><span>${escFin(sub)}</span></div>
        ${totals}${receiptBtn}
      </div>
      ${g.items.map(it => rowHtml(it, recordable)).join('')}
    </section>`;
}

/* Money still waiting to be recorded, split by direction. Always computed from the To record list,
   whichever tab is open; tasks with no cash movement count for neither side. */
function renderPending() {
  const sum = flow => finData.toRecord.filter(i => i.flow === flow).reduce((a, i) => a + (Number(i.amount) || 0), 0);
  $finIn.textContent = '+' + finPhp(sum('inflow'));
  $finOut.textContent = '\u2212' + finPhp(sum('outflow'));
}

// the sticky "Record selected" bar: how many ticked, and what they add up to
function renderSubmitBar() {
  const sel = finData.toRecord.filter(t => picked.has(String(t.id)));
  const show = finTab === 'torecord' && sel.length > 0;
  $finSubmitBar.hidden = !show;
  if (!show) return;
  const inS = sel.filter(t => t.flow === 'inflow').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const outS = sel.filter(t => t.flow === 'outflow').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  document.getElementById('finSelCount').textContent = `${sel.length} selected`;
  document.getElementById('finSelSums').textContent = [inS ? 'In +' + finPhp(inS) : '', outS ? 'Out \u2212' + finPhp(outS) : ''].filter(Boolean).join(' \u00b7 ') || 'No cash movement';
}

function renderTab() {
  renderPending();
  $finNote.hidden = finTab !== 'torecord';
  const list = finTab === 'torecord' ? finData.toRecord : finData.recorded;
  if (!list.length) {
    $finState.textContent = finTab === 'torecord' ? 'Nothing waiting to be recorded.' : 'Nothing recorded yet.';
    $finState.hidden = false; $finList.hidden = true;
    renderSubmitBar();
    return;
  }
  $finList.innerHTML = groupItems(list).map(g => groupHtml(g, finTab === 'torecord')).join('');
  $finState.hidden = true; $finList.hidden = false;
  renderSubmitBar();
}

// ticks only survive for tasks that are still waiting to be recorded
function prunePicks() {
  const live = new Set(finData.toRecord.map(t => String(t.id)));
  picked = new Set([...picked].filter(id => live.has(id)));
}

let finFirst = true;
async function loadFinance() {
  if (!CONFIG.portfolio.endpoint) { $finState.textContent = "Sync isn't set up yet."; $finState.hidden = false; $finList.hidden = true; return; }
  const cached = finFirst ? cacheGet('finance') : null; finFirst = false;
  if (cached) { finData = cached; prunePicks(); renderTab(); renderBalance(); }
  else { $finState.textContent = 'Loading\u2026'; $finState.hidden = false; $finList.hidden = true; }
  try {
    const url = CONFIG.portfolio.endpoint + '?action=finance&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    finData = { toRecord: data.toRecord || [], recorded: data.recorded || [] };
    cacheSet('finance', finData);
    prunePicks();
    renderTab();
    renderBalance();
  } catch (err) {
    console.warn('Finance load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
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

// Ticking is local: no request and no re-render, so you can tick several tasks in a row.
$finList.addEventListener('change', e => {
  if (!e.target.classList.contains('fin-mark')) return;
  const row = e.target.closest('.fin-item');
  const id = String(row.dataset.id);
  if (e.target.checked) picked.add(id); else picked.delete(id);
  row.classList.toggle('fin-picked', e.target.checked);
  renderSubmitBar();
});

// Submit every ticked task. IDs go in small batches (one Apps Script call each); the list is reloaded once at the end.
document.getElementById('finSubmit').onclick = async () => {
  const ids = finData.toRecord.map(t => String(t.id)).filter(id => picked.has(id));
  if (!ids.length) return;
  const btn = document.getElementById('finSubmit');
  btn.disabled = true; btn.textContent = 'Recording\u2026';
  let done = 0, failure = null;
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    try {
      const url = CONFIG.portfolio.endpoint + '?action=record&financeId=' + encodeURIComponent(chunk.join(',')) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      chunk.forEach(id => picked.delete(id));
      done += chunk.length;
    } catch (err) { failure = err; break; }
  }
  await loadFinance();   // shows what actually landed; anything that did not stays ticked
  btn.disabled = false; btn.textContent = 'Record selected';
  if (failure) {
    console.warn('Record failed', failure);
    toast(`${done ? done + ' recorded, but the rest' : 'Could not record'}: ${failure.message}. Check the list, then try again.`);
  } else toast(`${done} task${done === 1 ? '' : 's'} recorded.`);
};

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
  const pt = t ? prettyTask(t) : null;
  $ts('taskTitle').value = pt ? pt.title : '';
  $ts('taskDesc').value = pt ? pt.notes : '';
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

/* ---------- Current balance: a typed starting point + everything that happened after it ---------- */
// "Update" saves a baseline (what each account really holds at that moment). The balance shown is that baseline
// plus every Finance task dated after it (ticked or not, inflow or outflow, by pay method) plus daily interest.
let balance = null;   // { cash, maribank, reserves, others, note, updatedAt, skip:[ids] }
const nowStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const r2 = x => Math.round(x * 100) / 100;
const BUCKETS = ['cash', 'maribank', 'reserves', 'others'];

// Defaults = Maribank Savings: 3.25% p.a. up to PHP 1,000,000, 3.75% above, 20% withholding tax, applied to Maribank and Cash reserves.
const DEFAULT_INTEREST = { lo: 3.25, hi: 3.75, threshold: 1000000, tax: 20, accounts: { cash: false, maribank: true, reserves: true, others: false } };
function normInterest(c) {
  const n = (v, d) => (v === '' || v == null || !isFinite(Number(v)) || Number(v) < 0) ? d : Number(v);
  c = c || {};
  const a = c.accounts || {};
  return { lo: n(c.lo, DEFAULT_INTEREST.lo), hi: n(c.hi, DEFAULT_INTEREST.hi), threshold: n(c.threshold, DEFAULT_INTEREST.threshold), tax: Math.min(100, n(c.tax, DEFAULT_INTEREST.tax)),
    accounts: Object.fromEntries(BUCKETS.map(k => [k, a[k] == null ? DEFAULT_INTEREST.accounts[k] : !!a[k]])) };
}
let interestCfg = normInterest(cacheGet('interest'));

// pay method text -> which balance it moves ("Specify" entries like GCash fall under Others)
function bucketOf(pay) {
  const p = String(pay || '').trim().toLowerCase();
  if (!p) return '';
  if (p === 'cash') return 'cash';
  if (p.includes('maribank')) return 'maribank';
  if (/^(cash )?reserves?$/.test(p)) return 'reserves';
  return 'others';
}
const nextDay = iso => { const [y, m, d] = iso.split('-').map(Number), n = new Date(y, m - 1, d + 1), p = k => String(k).padStart(2, '0'); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; };

function computeBalance() {
  const b = balance;
  if (!b) return null;
  const m = String(b.updatedAt || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/);
  const bDate = m ? m[1] : (String(b.updatedAt || '').slice(0, 10) || todayIso()), bTime = m ? m[2].padStart(5, '0') : '00:00';
  const skip = new Set((b.skip || []).map(String));
  // dated after the baseline? Same day: compare the time; with no time it counts unless it already existed when the baseline was saved
  const after = t => {
    const d = String(t.date || '').slice(0, 10);
    if (!d) return false;
    if (d !== bDate) return d > bDate;
    const tm = String(t.time || '').trim();
    return tm ? tm.padStart(5, '0') > bTime : !skip.has(String(t.id));
  };
  const daily = {}, base = { cash: +b.cash || 0, maribank: +b.maribank || 0, reserves: +b.reserves || 0, others: +b.others || 0 };
  let inSum = 0, outSum = 0, n = 0;
  finData.toRecord.concat(finData.recorded).forEach(t => {
    if (t.flow !== 'inflow' && t.flow !== 'outflow') return;
    const k = bucketOf(t.payMethod);
    if (!k || !after(t)) return;
    const amt = Number(t.amount) || 0, d = String(t.date).slice(0, 10);
    (daily[k] = daily[k] || {})[d] = ((daily[k] || {})[d] || 0) + (t.flow === 'inflow' ? amt : -amt);
    if (t.flow === 'inflow') inSum += amt; else outSum += amt;
    n++;
  });
  const cfg = interestCfg, today = todayIso(), out = { n, inSum, outSum, interest: 0, since: bDate };
  BUCKETS.forEach(k => {
    let cur = base[k];
    const days = daily[k] || {};
    let guard = 0;
    for (let d = bDate; d < today && guard < 4000; d = nextDay(d), guard++) {
      cur += days[d] || 0;                                   // that day's transactions
      if (cfg.accounts[k] && cur > 0) {                      // midnight credit on the day's ending balance
        const rate = (cur > cfg.threshold ? cfg.hi : cfg.lo) / 100;
        const gross = r2(cur * rate / 365);
        const net = r2(gross - r2(gross * cfg.tax / 100));
        cur += net; out.interest += net;
      }
    }
    Object.keys(days).forEach(d => { if (d >= today) cur += days[d]; });   // today (not credited yet) and anything dated later
    out[k] = r2(cur);
  });
  out.interest = r2(out.interest);
  return out;
}

// Portfolio value is not typed in: it is the same "Onhand value" the Portfolio tab shows
// (cards still in our hands, i.e. onhand + shipping, valued at purchase cost).
let portValue = null;
const portValueOf = d => {
  const cards = Array.isArray(d.cards) ? d.cards : (d.owned || []).concat(d.sold || []);
  return cards.filter(c => c.tag === 'onhand' || c.tag === 'shipping').reduce((a, c) => a + (Number(c.purchaseCost) || 0), 0);
};

let lastAuto = null;
function renderBalance() {
  const b = balance, c = lastAuto = computeBalance();
  const set = (id, v) => document.getElementById(id).textContent = v;
  set('balCash', c ? finNum(c.cash) : '\u2014');
  set('balMari', c ? finNum(c.maribank) : '\u2014');
  set('balPort', portValue != null ? finNum(portValue) : '\u2014');
  set('balRes', c ? finNum(c.reserves) : '\u2014');
  set('balOth', c ? finNum(c.others) : '\u2014');
  document.getElementById('balSub').hidden = !c;
  document.getElementById('balTotal').hidden = !c;
  if (c) {
    const liquid = c.cash + c.maribank;
    set('balSubVal', finPhp(liquid));
    set('balTotalVal', finPhp(liquid + c.reserves + (+portValue || 0) + c.others));
  }
  const auto = document.getElementById('balAuto');
  const bits = c ? [c.inSum ? `+${finPhp(c.inSum)} in` : '', c.outSum ? `\u2212${finPhp(c.outSum)} out` : '', c.interest ? `+${finPhp(c.interest)} interest (after ${interestCfg.tax}% tax)` : ''].filter(Boolean) : [];
  auto.hidden = !bits.length;
  if (bits.length) auto.textContent = `Since ${fmtDay(c.since)}: ` + bits.join(' \u00b7 ');
  document.getElementById('balNote').hidden = !(b && b.note);
  if (b && b.note) document.getElementById('balNote').textContent = b.note;
  set('balMeta', b ? 'Starting point set ' + fmtStamp(b.updatedAt) + ' \u00b7 updates automatically from tasks and interest \u00b7 Portfolio is pulled live' : 'Not set yet \u2014 tap Update to enter what each account holds. Tasks and interest are added on top from then on.');
}
let portFirstFin = true;
async function loadPortValue() {
  if (!CONFIG.portfolio.endpoint) return;
  const cached = portFirstFin ? cacheGet('portfolio') : null; portFirstFin = false;
  if (cached) { portValue = portValueOf(cached); renderBalance(); }
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?action=portfolio&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    portValue = portValueOf(data);
    cacheSet('portfolio', { cards: Array.isArray(data.cards) ? data.cards : (data.owned || []).concat(data.sold || []) });   // same shape portfolio.js saves
    renderBalance();
  } catch (err) { console.warn('Portfolio value load failed', err); }   // keeps whatever is already showing
}
let balFirst = true;
async function loadBalance() {
  if (!CONFIG.portfolio.endpoint) return;
  const cached = balFirst ? cacheGet('balance') : null; balFirst = false;
  if (cached) { balance = cached; renderBalance(); }
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?action=balance&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    balance = data.balance || null;
    if (balance) cacheSet('balance', balance);
    if (data.interest) { interestCfg = normInterest(data.interest); cacheSet('interest', interestCfg); }   // older Code.gs sends none: keep local/default
    renderBalance();
  } catch (err) { console.warn('Balance load failed', err); }   // keeps whatever is already showing
}

/* Update = overwrite the balance by hand. Fields start at the current auto values; saving makes them the new starting point. */
const closeBalSheet = () => document.getElementById('balSheet').hidden = true;
document.getElementById('balEdit').onclick = () => {
  const c = lastAuto || {}, b = balance || {};
  const v = k => c[k] != null ? c[k] : (b[k] != null ? b[k] : '');
  document.getElementById('balCashIn').value = v('cash');
  document.getElementById('balMariIn').value = v('maribank');
  document.getElementById('balResIn').value = v('reserves');
  document.getElementById('balOthIn').value = v('others');
  document.getElementById('balNoteIn').value = b.note || '';
  document.getElementById('balSheet').hidden = false;
  document.getElementById('balCashIn').focus();
};
document.getElementById('balCancel').onclick = closeBalSheet;
document.getElementById('balSheet').addEventListener('click', e => { if (e.target.id === 'balSheet') closeBalSheet(); });
document.getElementById('balSave').onclick = async () => {
  const val = id => { const v = document.getElementById(id).value.trim(); return v === '' ? 0 : Number(v); };
  const next = { cash: val('balCashIn'), maribank: val('balMariIn'), reserves: val('balResIn'), others: val('balOthIn'), note: document.getElementById('balNoteIn').value.trim(), updatedAt: nowStamp() };
  if (![next.cash, next.maribank, next.reserves, next.others].every(isFinite)) return toast('Enter valid amounts.');
  if (!CONFIG.portfolio.endpoint) return toast("Sync isn't set up yet.");
  // untimed tasks dated today already exist now, so the typed amounts include them: remember them so they are not added twice
  const today = todayIso();
  next.skip = finData.toRecord.concat(finData.recorded).filter(t => String(t.date || '').slice(0, 10) === today && !String(t.time || '').trim()).map(t => String(t.id));
  const btn = document.getElementById('balSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const url = CONFIG.portfolio.endpoint + '?action=saveBalance&cash=' + next.cash + '&maribank=' + next.maribank + '&reserves=' + next.reserves + '&others=' + next.others
      + '&note=' + encodeURIComponent(next.note) + '&at=' + encodeURIComponent(next.updatedAt) + '&skip=' + encodeURIComponent(next.skip.join(',')) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    balance = next; cacheSet('balance', balance); renderBalance();
    closeBalSheet(); toast('Balance saved.');
  } catch (err) { toast('Could not save balance: ' + err.message); }
  btn.disabled = false; btn.textContent = 'Save balance';
};

/* Interest settings: kept apart from the balance so changing a rate never resets the starting point. */
const $i = id => document.getElementById(id);
function fillInterest(c) {
  $i('intLo').value = c.lo; $i('intHi').value = c.hi; $i('intThr').value = c.threshold; $i('intTax').value = c.tax;
  $i('intCash').checked = c.accounts.cash; $i('intMari').checked = c.accounts.maribank; $i('intRes').checked = c.accounts.reserves; $i('intOth').checked = c.accounts.others;
}
$i('balInterest').onclick = () => { fillInterest(interestCfg); $i('intSheet').hidden = false; };
const closeInt = () => $i('intSheet').hidden = true;
$i('intCancel').onclick = closeInt;
$i('intSheet').addEventListener('click', e => { if (e.target.id === 'intSheet') closeInt(); });
$i('intReset').onclick = () => fillInterest(DEFAULT_INTEREST);
$i('intSave').onclick = async () => {
  const num = id => { const v = $i(id).value.trim(); return v === '' ? NaN : Number(v); };
  const next = { lo: num('intLo'), hi: num('intHi'), threshold: num('intThr'), tax: num('intTax'),
    accounts: { cash: $i('intCash').checked, maribank: $i('intMari').checked, reserves: $i('intRes').checked, others: $i('intOth').checked } };
  if (![next.lo, next.hi, next.threshold, next.tax].every(x => isFinite(x) && x >= 0) || next.tax > 100) return toast('Enter valid rates (tax 0\u2013100%).');
  interestCfg = normInterest(next); cacheSet('interest', interestCfg); renderBalance(); closeInt();
  if (!CONFIG.portfolio.endpoint) return;
  try {
    const data = await jsonp(CONFIG.portfolio.endpoint + '?action=saveInterest&json=' + encodeURIComponent(JSON.stringify(interestCfg)) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    toast('Interest settings saved.');
  } catch (err) { toast('Saved on this device only: ' + err.message); }
};

// Refresh reloads both the task list and the balance (your ticks are kept)
$finRefresh.onclick = () => { loadFinance(); loadBalance(); loadPortValue(); };

loadBalance();
loadPortValue();
loadFinance();
