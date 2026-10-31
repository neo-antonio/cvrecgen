/* ---------- Creatives — Video (vlog tasks) and Posts (card edits grouped per receipt, or combined by hand) ---------- */
const $c = id => document.getElementById(id);
const escC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const phpC = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nPlC = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
const todayC = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function fmtDayC(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '';
}
/* task created stamp ('yyyy-MM-dd HH:mm', older tasks only have the date) and how long a task took */
const parseStamp = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? 0 : +m[5] } : null; };
function fmtStamp(v) {
  const s = parseStamp(v); if (!s) return '';
  const dt = new Date(s.y, s.mo - 1, s.d, s.h || 0, s.mi);
  return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + (s.h == null ? '' : ', ' + dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }));
}
function daysBetween(a, b) {
  const A = parseStamp(a), B = parseStamp(b); if (!A || !B) return null;
  return Math.max(0, Math.round((new Date(B.y, B.mo - 1, B.d) - new Date(A.y, A.mo - 1, A.d)) / 86400000));
}
function metaHtml(item, finished) {
  const lines = [];
  if (item.created) lines.push(`Created ${escC(fmtStamp(item.created))}`);
  const n = finished && item.created && item.doneDate ? daysBetween(item.created, item.doneDate) : null;
  if (n != null) lines.push(`<b class="cr-took">${n === 0 ? 'Task accomplished the same day' : 'Task accomplished in ' + nPlC(n, 'day')}</b>`);
  return lines.length ? `<p class="cr-meta">${lines.join('<br>')}</p>` : '';
}
/* escape first, then turn http(s) links into tappable anchors */
function linkify(s) {
  return escC(s).replace(/https?:\/\/(?:(?!&quot;|&lt;|&gt;)[^\s<])+/g, m => {
    const url = m.replace(/[.,:!?)\]]+$/, ''), tail = m.slice(url.length);
    return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
  });
}

const fmtClockC = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
/* what became of a card: "Sold PHP 1,200.00" / "Traded PHP 800.00" (blank while it is still on hand) */
const outcomeTag = c => c.outcome ? `<em class="cr-sold ${c.outcome}">${c.outcome === 'traded' ? 'Traded' : 'Sold'} ${phpC(c.soldPrice)}</em>` : '';
let tab = 'video', vFilter = 'todo', pFilter = 'toedit';
let data = { videos: [], posts: [] };
let crFirst = true;

const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
function toast(m) {
  const t = $c('crToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}
const findV = id => data.videos.find(v => v.id === id);
const findP = id => data.posts.find(p => p.id === id);

/* one-tap copy, with a fallback for browsers that block the clipboard API */
async function copyText(t) {
  if (!t || !String(t).trim()) return toast('No caption yet. Add one with the edit / details button.');
  try { await navigator.clipboard.writeText(t); return toast('Caption copied.'); } catch (_) {}
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Caption copied.'); } catch (_) { toast('Could not copy. Select the caption and copy it by hand.'); }
  ta.remove();
}

/* Every change is shown at once, then saved in the background; if the save fails we reload the real data. */
async function save(action, params) {
  try {
    const res = await jsonp(api(action, params), 45000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    cacheSet('creatives', data);
    return res;
  } catch (err) {
    toast('Could not save: ' + backendErr(err));
    loadData();
    return null;
  }
}

/* ---------- Video ---------- */
const ICON_C = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checks: '<path d="M2.5 12.5l4 4L14 8"/><path d="M10 15.5l1 1L21 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  addcards: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0112 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.5 7.6C4.4 9 3.1 10.9 2.5 12c1 1.8 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.8"/><path d="M9.9 10a3 3 0 004.1 4.1"/>',
  show: '<path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z"/><circle cx="12" cy="12" r="3"/>'
};
const iconC = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${escC(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_C[name]}</svg></button>`;

/* the cards linked to a video task (read-only on the list; edit them from the task's edit sheet) */
const miniCards = cards => (cards && cards.length) ? `<div class="cr-cards">${cards.map(c => {
  const img = c.photo ? `<img src="${escC(c.photo)}" alt="${escC(c.name)}" loading="lazy" class="cr-zoom" data-full="${escC(c.full || c.photo)}">` : '<div class="port-noimg">No photo</div>';
  return `<div class="cr-pc"><div class="port-thumb">${img}</div><div class="port-info"><b>${escC(c.name)}</b><span>${phpC(c.cost)}</span>${outcomeTag(c)}</div></div>`;
}).join('')}</div>` : '';

function videoHtml(v) {
  const st = v.status || 'todo', done = st !== 'todo';   // anything not to-do counts as done here; posting happens in Socials
  const sub = [v.auto ? 'From receipt' : '', v.time ? 'Post at ' + fmtClockC(v.time) : '', done && v.doneDate ? 'Done ' + fmtDayC(v.doneDate) : '', st === 'posted' ? 'Posted' : '', v.cards && v.cards.length ? nPlC(v.cards.length, 'card') : ''].filter(Boolean).join(' \u00b7 ');
  return `<div class="cr-card${done ? ' done' : ''}" data-id="${escC(v.id)}">
      <div class="cr-top">
        <input type="checkbox" class="cr-tick v-tick" ${done ? 'checked' : ''} aria-label="Mark ${done ? 'to do' : 'done'}">
        <div class="cr-main"><b>${escC(v.title)}</b>${sub ? `<span>${escC(sub)}</span>` : ''}</div>
        <label class="cr-date-wrap"><small>Planned post date &amp; time</small><span class="cr-dt"><input type="date" class="cr-date v-date" value="${escC(v.date)}" aria-label="Planned post date"><input type="time" class="cr-time v-time" value="${escC(v.time || '')}" aria-label="Planned post time"></span></label>
      </div>
      ${metaHtml(v, done)}
      ${miniCards(v.cards)}
      ${v.caption ? `<p class="cr-notes"><small>Caption</small>${escC(v.caption)}</p>` : ''}
      ${v.notes ? `<p class="cr-notes"><small>Notes</small>${linkify(v.notes)}</p>` : ''}
      <div class="cr-acts">
        ${iconC('copy', 'v-copy', 'Copy caption', v.id)}
        ${done ? (v.hidden ? iconC('show', 'v-hide', 'Unhide', v.id) : iconC('hide', 'v-hide', 'Hide', v.id)) : ''}
        ${iconC('pencil', 'v-edit', 'Edit', v.id)}${iconC('trash', 'danger v-del', 'Delete', v.id)}
      </div>
    </div>`;
}

function renderVideo() {
  const isDone = v => (v.status || 'todo') !== 'todo';
  const todo = data.videos.filter(v => !isDone(v)), done = data.videos.filter(v => isDone(v) && !v.hidden), hidden = data.videos.filter(v => isDone(v) && v.hidden);
  document.querySelector('#vFilters [data-f=todo]').textContent = `To do (${todo.length})`;
  document.querySelector('#vFilters [data-f=done]').textContent = `Done (${done.length})`;
  document.querySelector('#vFilters [data-f=hidden]').textContent = `Hidden (${hidden.length})`;
  const list = ({ todo, done, hidden })[vFilter].slice()
    .sort((a, b) => vFilter === 'todo' ? (a.date || '9999').localeCompare(b.date || '9999') : (b.date || '').localeCompare(a.date || ''));
  $c('vCount').textContent = list.length ? nPlC(list.length, 'task') : '';
  if (!list.length) {
    $c('vState').textContent = data.videos.length
      ? ({ todo: 'Nothing left to do. \ud83c\udf89', done: 'Nothing done yet.', hidden: 'No hidden tasks.' })[vFilter]
      : 'No video tasks yet. Tick \u201cVlog needed\u201d on a purchase or trade receipt, or tap + Add task.';
    $c('vState').hidden = false; $c('vList').hidden = true; return;
  }
  $c('vList').innerHTML = list.map(videoHtml).join('');
  $c('vState').hidden = true; $c('vList').hidden = false;
}

/* ---- video task sheet: add / edit, with the cards linked to it ---- */
let editVideoId = '', vCardList = [];
function renderVCards() {
  $c('vCardCount').textContent = vCardList.length ? `(${vCardList.length})` : '(none)';
  $c('vCards').innerHTML = vCardList.length ? vCardList.map((c, i) => {
    const img = c.photo ? `<img src="${escC(c.photo)}" alt="" loading="lazy">` : '<div class="port-noimg">No photo</div>';
    return `<div class="cr-pc v-cardrow"><div class="port-thumb">${img}</div>
      <div class="port-info"><b>${escC(c.name)}</b><span>${phpC(c.cost)}</span></div>
      ${iconC('pencil', 'vc-ren', 'Rename card', i)}${iconC('trash', 'danger vc-rm', 'Remove from this video', i)}</div>`;
  }).join('') : '<p class="stub-note" style="margin:0 0 8px;font-size:12px">No cards linked. Cards from the receipt are linked automatically.</p>';
}
function openVideo(id) {
  const v = id ? findV(id) : null;
  editVideoId = v ? v.id : '';
  $c('vHeading').textContent = v ? 'Edit video task' : 'Add video task';
  $c('vTitle').value = v ? v.title : ''; $c('vDate').value = v ? v.date : todayC(); $c('vTime').value = v ? (v.time || '') : ''; $c('vNotes').value = v ? v.notes : '';
  $c('vCaption').value = v ? (v.caption || '') : '';
  $c('vStatus').value = v && (v.status || 'todo') !== 'todo' ? 'done' : 'todo';
  vCardList = v ? (v.cards || []).map(c => Object.assign({}, c)) : [];
  renderVCards();
  $c('vSheet').hidden = false;
  if (!v) $c('vTitle').focus();
}
const closeVideo = () => { $c('vSheet').hidden = true; editVideoId = ''; };
$c('vAdd').onclick = () => openVideo('');
$c('vCancel').onclick = closeVideo;
$c('vCopy').onclick = () => copyText($c('vCaption').value);
$c('vSheet').addEventListener('click', e => { if (e.target.id === 'vSheet') closeVideo(); });
$c('vCards').addEventListener('click', async e => {
  const rm = e.target.closest('.vc-rm'), ren = e.target.closest('.vc-ren');
  if (rm) { vCardList.splice(+rm.dataset.id, 1); renderVCards(); return; }
  if (ren) {
    const c = vCardList[+ren.dataset.id]; if (!c) return;
    const nn = (prompt('Rename card', c.name) || '').trim().replace(/\s+/g, ' ');
    if (!nn || nn === c.name) return;
    const res = await save('renameCard', { cardId: c.id, name: nn });
    if (res) { c.name = nn; renderVCards(); toast('Card renamed.'); }
  }
});
$c('vSave').onclick = async () => {
  const title = $c('vTitle').value.trim().replace(/\s+/g, ' ');
  if (!title) return toast('Enter a title.');
  const date = $c('vDate').value || todayC(), notes = $c('vNotes').value.trim(), caption = $c('vCaption').value.trim();
  const existing = editVideoId ? findV(editVideoId) : null;
  const params = { id: existing ? existing.id : 'v_' + Math.random().toString(16).slice(2, 10), title, date, time: $c('vTime').value || '', notes, caption, cardIds: vCardList.map(c => c.id).join(',') };
  const was = existing ? ((existing.status || 'todo') !== 'todo' ? 'done' : 'todo') : 'todo';
  if (!existing || $c('vStatus').value !== was) params.status = $c('vStatus').value;   // an already posted task keeps its posted state unless changed
  const btn = $c('vSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const res = await save('saveCreative', params);
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closeVideo(); toast(existing ? 'Task updated.' : 'Task added.');
  await loadData();
};

/* ---- card picker for a video task (every card, any status) ---- */
let vcState = null;
function renderVC() {
  if (!vcState) return;
  const q = $c('vcSearch').value.trim().toLowerCase();
  $c('vcCount').textContent = vcState.sel.size ? `(${vcState.sel.size} selected)` : '';
  if (vcState.loading) { $c('vcCards').innerHTML = '<p class="stub-note" style="margin:6px 0">Loading cards\u2026</p>'; return; }
  const seen = new Set(), all = [];
  vcState.base.concat(vcState.all).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); all.push(c); } });
  vcState.known = all;
  const list = all.filter(c => !q || String(c.name || '').toLowerCase().includes(q)).slice(0, 150);
  $c('vcCards').innerHTML = list.length ? list.map(c => {
    const img = c.photo ? `<img src="${escC(c.photo)}" alt="" loading="lazy">` : '<div class="port-noimg">No photo</div>';
    const on = vcState.sel.has(c.id);
    return `<label class="m-row${on ? ' on' : ''}"><input type="checkbox" data-id="${escC(c.id)}" ${on ? 'checked' : ''}>
        <div class="port-thumb">${img}</div>
        <div class="port-info"><b>${escC(c.name)}</b><span>${escC([c.status && c.status !== 'onhand' ? c.status : 'On hand', c.date ? fmtDayC(c.date) : '', phpC(c.cost)].filter(Boolean).join(' \u00b7 '))}</span></div></label>`;
  }).join('') : '<p class="stub-note" style="margin:6px 0">No cards match.</p>';
}
async function openVC() {
  vcState = { sel: new Set(vCardList.map(c => c.id)), base: vCardList.slice(), all: [], known: [], loading: true };
  $c('vcSearch').value = ''; renderVC(); $c('vcSheet').hidden = false;
  try {
    const res = await jsonp(api('allCards'), 45000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    if (!vcState) return;
    vcState.all = res.cards || [];
  } catch (err) { toast('Could not load cards: ' + backendErr(err)); }
  if (!vcState) return;
  vcState.loading = false; renderVC();
}
const closeVC = () => { $c('vcSheet').hidden = true; vcState = null; };
$c('vAddCards').onclick = openVC;
$c('vcCancel').onclick = closeVC;
$c('vcSheet').addEventListener('click', e => { if (e.target.id === 'vcSheet') closeVC(); });
$c('vcSearch').addEventListener('input', renderVC);
$c('vcCards').addEventListener('change', e => {
  const cb = e.target.closest('input[data-id]'); if (!cb || !vcState) return;
  if (cb.checked) vcState.sel.add(cb.dataset.id); else vcState.sel.delete(cb.dataset.id);
  cb.closest('.m-row').classList.toggle('on', cb.checked);
  $c('vcCount').textContent = vcState.sel.size ? `(${vcState.sel.size} selected)` : '';
});
$c('vcDone').onclick = () => {
  if (!vcState) return;
  const known = new Map(vcState.known.map(c => [c.id, c]));
  const keep = vCardList.filter(c => vcState.sel.has(c.id));                       // already linked cards stay in their order
  const have = new Set(keep.map(c => c.id));
  vcState.sel.forEach(id => { if (!have.has(id) && known.get(id)) keep.push(Object.assign({}, known.get(id))); });
  vCardList = keep; renderVCards(); closeVC();
};

function setVStatus(v, status) {
  v.status = status; v.doneDate = status === 'todo' ? '' : todayC();
  const p = { id: v.id, status }; if (status === 'todo' && v.hidden) { v.hidden = false; p.hidden = ''; }
  renderVideo(); save('saveCreative', p);
}
$c('vList').addEventListener('change', e => {
  const card = e.target.closest('.cr-card'); if (!card) return;
  const v = findV(card.dataset.id); if (!v) return;
  if (e.target.classList.contains('v-tick')) {
    setVStatus(v, e.target.checked ? 'done' : 'todo');
  } else if (e.target.classList.contains('v-time')) {
    v.time = e.target.value || ''; renderVideo();
    save('saveCreative', { id: v.id, time: v.time }).then(res => { if (res) toast(v.time ? 'Time set to ' + fmtClockC(v.time) + '.' : 'Time cleared.'); });
  } else if (e.target.classList.contains('v-date')) {
    const nd = e.target.value, prev = v.date;
    if (!nd) { e.target.value = prev || ''; return toast('Pick a date to reschedule.'); }   // a cleared field would blank the date
    if (nd === prev) return;
    v.date = nd; renderVideo();   // re-sort so the task moves to its new spot
    save('saveCreative', { id: v.id, date: nd }).then(res => { if (res) toast('Rescheduled to ' + fmtDayC(nd) + '.'); });
  }
});
$c('vList').addEventListener('click', async e => {
  const zoom = e.target.closest('.cr-zoom');
  if (zoom) { $c('imgViewImg').src = zoom.dataset.full; $c('imgView').hidden = false; return; }
  const cardEl = e.target.closest('.cr-card'); if (!cardEl) return;
  const v = findV(cardEl.dataset.id); if (!v) return;
  if (e.target.closest('.v-copy')) return copyText(v.caption);
  if (e.target.closest('.v-edit')) return openVideo(v.id);
  if (e.target.closest('.v-hide')) {
    v.hidden = !v.hidden; renderVideo();
    const res = await save('saveCreative', { id: v.id, hidden: v.hidden ? '1' : '' }); if (res) toast(v.hidden ? 'Task hidden. Find it under Hidden.' : 'Task is back under Done.');
    return;
  }
  if (e.target.closest('.v-del')) {
    if (!confirm(`Delete "${v.title}"?`)) return;
    data.videos = data.videos.filter(x => x.id !== v.id); renderVideo();
    const res = await save('deleteCreative', { id: v.id }); if (res) toast('Task deleted.');
  }
});
document.querySelectorAll('#vFilters .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#vFilters .chip').forEach(x => x.classList.toggle('active', x === c));
  vFilter = c.dataset.f; renderVideo();
});

/* ---------- Posts ---------- */
function cardRowHtml(g, c) {
  const img = c.photo ? `<img src="${escC(c.photo)}" alt="${escC(c.name)}" loading="lazy" class="cr-zoom" data-full="${escC(c.full || c.photo)}">` : '<div class="port-noimg">No photo</div>';
  return `<div class="cr-pc${c.edited ? ' edited' : ''}" data-card="${escC(c.id)}">
      <div class="port-thumb">${img}</div>
      <div class="port-info"><b>${escC(c.name)}</b><span>${phpC(c.cost)}</span>${outcomeTag(c)}</div>
      ${c.edited ? iconC('undo', 'pc-btn', 'Back to to-edit', c.id) : iconC('check', 'ok pc-btn', 'Mark edited', c.id)}
    </div>`;
}
/* edited-photo previews: pasted image links, up to 30 per post task */
const MAX_PREV = 30;
const prevStrip = g => (g.previews && g.previews.length)
  ? `<div class="cr-prev">${g.previews.map(x => `<img src="${escC(x.t || x.u)}" alt="Edited photo preview" loading="lazy" class="cr-zoom" data-full="${escC(x.f || x.u)}">`).join('')}</div>` : '';
const prevThumb = u => { const m = /drive\.google\.com/.test(u) && String(u).match(/[-\w]{25,}/); return m ? 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w300' : u; };
let prevList = [];
function renderPrev() {
  $c('pPrevGrid').innerHTML = prevList.map((u, i) => `<div class="img-tile"><img src="${escC(prevThumb(u))}" alt="" loading="lazy"><button type="button" class="img-x" data-i="${i}" aria-label="Remove preview">&times;</button></div>`).join('');
  $c('pPrevCount').textContent = `${prevList.length}/${MAX_PREV}`;
  $c('pPrevAdd').hidden = prevList.length >= MAX_PREV;
}
function addPrev() {
  const v = $c('pPrevInput').value.trim(); if (!v) return;
  if (!safeUrl(v)) return toast('Links must start with http:// or https://');
  if (prevList.includes(v)) return toast('That link is already added.');
  if (prevList.length >= MAX_PREV) return toast(`Up to ${MAX_PREV} previews.`);
  prevList.push(v); $c('pPrevInput').value = ''; renderPrev();
}
$c('pPrevUse').onclick = addPrev;
$c('pPrevInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPrev(); } });
$c('pPrevGrid').addEventListener('click', e => {
  const x = e.target.closest('.img-x'); if (!x) return;
  prevList.splice(+x.dataset.i, 1); renderPrev();
});
function groupHtml(g) {
  const st = g.status, finished = st !== 'toedit';   // edited (every card done) or already posted from Socials
  const sub = [g.custom ? 'Combined task' : '', g.time ? 'Post at ' + fmtClockC(g.time) : '', (g.cards.length ? `${g.editedCount} of ${nPlC(g.cards.length, 'card')} edited` : 'No cards'), st === 'posted' ? 'Posted' : ''].filter(Boolean).join(' \u00b7 ');
  return `<div class="cr-card${finished ? ' done' : ''}" data-id="${escC(g.id)}">
      <div class="cr-top">
        <div class="cr-main"><b>${escC(g.label || 'Cards')}</b><span>${escC(sub)}</span></div>
        <label class="cr-date-wrap"><small>Planned post date &amp; time</small><span class="cr-dt"><input type="date" class="cr-date p-date" value="${escC(g.scheduled)}" aria-label="Planned post date"><input type="time" class="cr-time p-time" value="${escC(g.time || '')}" aria-label="Planned post time"></span></label>
      </div>
      ${metaHtml(g, finished)}
      <div class="cr-cards">${g.cards.map(c => cardRowHtml(g, c)).join('')}</div>
      ${prevStrip(g)}
      ${g.caption ? `<p class="cr-notes"><small>Caption</small>${escC(g.caption)}</p>` : ''}
      ${g.notes ? `<p class="cr-notes"><small>Notes</small>${linkify(g.notes)}</p>` : ''}
      <div class="cr-acts">
        ${iconC('copy', 'p-copy', 'Copy caption', g.id)}
        ${st === 'toedit' && g.cards.length ? iconC('checks', 'ok p-all', 'Mark all edited', g.id) : ''}
        ${iconC('addcards', 'p-merge', 'Add / merge cards', g.id)}
        ${iconC('pencil', 'p-edit', 'Edit', g.id)}
        ${finished ? (g.hidden ? iconC('show', 'p-hide', 'Unhide', g.id) : iconC('hide', 'p-hide', 'Hide', g.id)) : ''}
        ${g.custom ? iconC('trash', 'danger p-del', 'Delete task', g.id) : ''}
      </div>
    </div>`;
}
function renderPosts() {
  const toedit = data.posts.filter(g => g.status === 'toedit'), edited = data.posts.filter(g => g.status !== 'toedit' && !g.hidden), hidden = data.posts.filter(g => g.status !== 'toedit' && g.hidden);
  document.querySelector('#pFilters [data-f=toedit]').textContent = `To do (${toedit.length})`;
  document.querySelector('#pFilters [data-f=edited]').textContent = `Done (${edited.length})`;
  document.querySelector('#pFilters [data-f=hidden]').textContent = `Hidden (${hidden.length})`;
  const list = ({ toedit, edited, hidden })[pFilter].slice()
    .sort((a, b) => pFilter === 'toedit' ? (a.scheduled || '9999').localeCompare(b.scheduled || '9999') : (b.scheduled || '').localeCompare(a.scheduled || ''));
  $c('pCount').textContent = list.length ? nPlC(list.length, 'task') + ' \u00b7 ' + nPlC(list.reduce((a, g) => a + g.cards.length, 0), 'card') : '';
  if (!list.length) {
    $c('pState').textContent = data.posts.length
      ? ({ toedit: 'No cards waiting to be edited.', edited: 'Nothing done yet.', hidden: 'No hidden tasks.' })[pFilter]
      : 'No cards yet. Cards from purchase and trade receipts show up here, grouped per receipt. Tap + New post task to make your own.';
    $c('pState').hidden = false; $c('pList').hidden = true; return;
  }
  $c('pList').innerHTML = list.map(groupHtml).join('');
  $c('pState').hidden = true; $c('pList').hidden = false;
}
function refreshGroup(g) {
  g.editedCount = g.cards.filter(c => c.edited).length;
  const all = g.cards.length && g.editedCount === g.cards.length;
  g.status = all ? (g.status === 'posted' ? 'posted' : 'edited') : 'toedit';
  if (g.status === 'toedit') g.hidden = false;   // un-editing a card sends the task back to to-do (the server does the same)
}
$c('pList').addEventListener('change', e => {
  if (e.target.classList.contains('p-time')) {
    const g = findP(e.target.closest('.cr-card').dataset.id); if (!g) return;
    g.time = e.target.value || ''; renderPosts();
    save('saveCreative', { id: g.id, time: g.time }).then(res => { if (res) toast(g.time ? 'Time set to ' + fmtClockC(g.time) + '.' : 'Time cleared.'); });
    return;
  }
  if (!e.target.classList.contains('p-date')) return;
  const g = findP(e.target.closest('.cr-card').dataset.id); if (!g) return;
  const nd = e.target.value;
  if (!nd) { e.target.value = g.scheduled || ''; return toast('Pick a date to reschedule.'); }
  if (nd === g.scheduled) return;
  g.scheduled = nd; renderPosts();
  save('saveCreative', { id: g.id, date: nd }).then(res => { if (res) toast('Rescheduled to ' + fmtDayC(nd) + '.'); });
});
$c('pList').addEventListener('click', async e => {
  const zoom = e.target.closest('.cr-zoom');
  if (zoom) { $c('imgViewImg').src = zoom.dataset.full; $c('imgView').hidden = false; return; }
  const cardEl = e.target.closest('.cr-card'); if (!cardEl) return;
  const g = findP(cardEl.dataset.id); if (!g) return;
  const pc = e.target.closest('.pc-btn');
  if (pc) {
    const c = g.cards.find(x => x.id === pc.closest('.cr-pc').dataset.card); if (!c) return;
    c.edited = !c.edited; refreshGroup(g); renderPosts();
    save('setCreativeCards', { id: g.id, cardIds: c.id, edited: c.edited, complete: g.status !== 'toedit' ? '1' : '0' });
    return;
  }
  if (e.target.closest('.p-copy')) return copyText(g.caption);
  if (e.target.closest('.p-all')) {
    g.cards.forEach(c => c.edited = true); refreshGroup(g); renderPosts();
    save('completeCreatives', { ids: g.id, status: 'done' }); toast('All cards marked edited.');
    return;
  }
  if (e.target.closest('.p-hide')) {
    g.hidden = !g.hidden; renderPosts();
    const res = await save('saveCreative', { id: g.id, hidden: g.hidden ? '1' : '' }); if (res) toast(g.hidden ? 'Task hidden. Find it under Hidden.' : 'Task is back under Done.');
    return;
  }
  if (e.target.closest('.p-merge')) return openPicker(g.id);
  if (e.target.closest('.p-edit')) return openPost(g.id);
  if (e.target.closest('.p-del')) {
    if (!confirm(`Delete "${g.label}"?\n\nThe cards are not deleted. They go back to their own receipt groups.`)) return;
    data.posts = data.posts.filter(x => x.id !== g.id);
    const res = await save('deleteCreative', { id: g.id });
    if (res) { toast('Task deleted.'); await loadData(); }
  }
});
document.querySelectorAll('#pFilters .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#pFilters .chip').forEach(x => x.classList.toggle('active', x === c));
  pFilter = c.dataset.f; renderPosts();
});

/* ---------- post details sheet ---------- */
let editPostId = '';
function openPost(id) {
  const g = findP(id); if (!g) return;
  editPostId = id;
  $c('pHeading').textContent = 'Edit post';
  prevList = (g.previews || []).map(x => x.u); $c('pPrevInput').value = ''; renderPrev();
  $c('pTitle').value = g.label || '';
  $c('pDate').value = g.scheduled || ''; $c('pTime').value = g.time || ''; $c('pCaption').value = g.caption || ''; $c('pNotes').value = g.notes || '';
  $c('pSheet').hidden = false;
}
const closePost = () => { $c('pSheet').hidden = true; editPostId = ''; };
$c('pCancel').onclick = closePost;
$c('pSheet').addEventListener('click', e => { if (e.target.id === 'pSheet') closePost(); });
$c('pCopy').onclick = () => copyText($c('pCaption').value);
$c('pSave').onclick = async () => {
  const g = findP(editPostId); if (!g) return;
  g.scheduled = $c('pDate').value || g.scheduled; g.time = $c('pTime').value || ''; g.caption = $c('pCaption').value.trim(); g.notes = $c('pNotes').value.trim();
  const btn = $c('pSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const params = { id: g.id, date: g.scheduled, time: g.time, caption: g.caption, notes: g.notes };
  const newTitle = $c('pTitle').value.trim().replace(/\s+/g, ' ');
  if (newTitle && newTitle !== g.label) { g.label = newTitle; params.title = newTitle; params.renamed = '1'; }   // empty = keep the current title
  const oldPrev = (g.previews || []).map(x => x.u);
  if (JSON.stringify(oldPrev) !== JSON.stringify(prevList)) {
    params.previews = JSON.stringify(prevList);
    g.previews = prevList.map(u => ({ u, t: prevThumb(u), f: u }));
  }
  const res = await save('saveCreative', params);
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closePost(); renderPosts(); toast('Saved.');
};

/* ---------- new post task / add cards / merge tasks ---------- */
/* The card list is: the cards already in the task (ticked), cards of any task you tick to merge, then every
   on-hand card newest to oldest. A card appears once, so it can never be added to the same task twice. */
let mState = null;
function pickerCards() {
  const seen = new Set(), out = [];
  const add = (c, tag) => { if (c && !seen.has(c.id)) { seen.add(c.id); out.push(Object.assign({}, c, { tag })); } };
  mState.base.forEach(c => add(c, 'In this task'));
  data.posts.filter(p => mState.merge.has(p.id)).forEach(p => p.cards.forEach(c => add(c, 'From ' + (p.label || 'task'))));
  mState.onhand.forEach(c => add(c, 'On hand'));
  return out;
}
function renderPicker() {
  const q = $c('mSearch').value.trim().toLowerCase();
  const list = pickerCards().filter(c => !q || String(c.name || '').toLowerCase().includes(q));
  $c('mCount').textContent = mState.sel.size ? `(${mState.sel.size} selected)` : (mState.id ? '(none selected)' : '(optional)');
  if (mState.loading) { $c('mCards').innerHTML = '<p class="stub-note" style="margin:6px 0">Loading on-hand cards\u2026</p>'; return; }
  $c('mCards').innerHTML = list.length ? list.map(c => {
    const img = c.photo ? `<img src="${escC(c.photo)}" alt="" loading="lazy">` : '<div class="port-noimg">No photo</div>';
    const on = mState.sel.has(c.id);
    return `<label class="m-row${on ? ' on' : ''}"><input type="checkbox" data-id="${escC(c.id)}" ${on ? 'checked' : ''}>
        <div class="port-thumb">${img}</div>
        <div class="port-info"><b>${escC(c.name)}</b><span>${escC([c.tag, c.date ? fmtDayC(c.date) : '', phpC(c.cost)].filter(Boolean).join(' \u00b7 '))}</span></div></label>`;
  }).join('') : '<p class="stub-note" style="margin:6px 0">No cards match.</p>';
}
function syncPickerTitle() {
  if (mState.titleTouched) return;
  const names = [mState.baseTitle].concat(data.posts.filter(p => mState.merge.has(p.id)).map(p => p.label)).filter(Boolean);
  $c('mTitle').value = names.join(' + ').slice(0, 120);
}
async function openPicker(id) {
  const g = id ? findP(id) : null;
  mState = { id: id || '', sel: new Set(g ? g.cards.map(c => c.id) : []), merge: new Set(), base: g ? g.cards.slice() : [], onhand: [], loading: true,
    baseTitle: g ? (g.label || '') : '', titleTouched: false };
  $c('mHeading').textContent = g ? 'Add / merge cards' : 'New post task';
  $c('mDate').value = g ? (g.scheduled || todayC()) : todayC(); $c('mTime').value = g ? (g.time || '') : '';
  $c('mSearch').value = '';
  // only tasks that still hold on-hand cards can be merged: once every card is sold or traded the task drops out of the list
  const others = data.posts.filter(p => p.id !== mState.id && p.status !== 'posted' && p.cards.some(c => c.onhand !== false));
  $c('mMergeWrap').hidden = !others.length;
  $c('mMerge').innerHTML = others.map(p => `<label class="port-chk"><input type="checkbox" data-merge="${escC(p.id)}"><span>${escC(p.label || 'Cards')} \u00b7 ${nPlC(p.cards.length, 'card')}</span></label>`).join('');
  syncPickerTitle();
  renderPicker();
  $c('mSheet').hidden = false;
  try {
    const res = await jsonp(api('onhandCards'), 45000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    if (!mState) return;   // closed while loading
    mState.onhand = res.cards || [];
  } catch (err) { toast('Could not load on-hand cards: ' + backendErr(err)); }
  if (!mState) return;
  mState.loading = false; renderPicker();
}
const closePicker = () => { $c('mSheet').hidden = true; mState = null; };
$c('pAdd').onclick = () => openPicker('');
$c('mCancel').onclick = closePicker;
$c('mSheet').addEventListener('click', e => { if (e.target.id === 'mSheet') closePicker(); });
$c('mSearch').addEventListener('input', renderPicker);
$c('mTitle').addEventListener('input', () => { if (mState) mState.titleTouched = true; });
$c('mMerge').addEventListener('change', e => {
  const cb = e.target.closest('[data-merge]'); if (!cb || !mState) return;
  const p = findP(cb.dataset.merge); if (!p) return;
  const baseIds = new Set(mState.base.map(c => c.id));
  if (cb.checked) { mState.merge.add(p.id); p.cards.forEach(c => mState.sel.add(c.id)); }
  else { mState.merge.delete(p.id); p.cards.forEach(c => { if (!baseIds.has(c.id)) mState.sel.delete(c.id); }); }
  syncPickerTitle(); renderPicker();
});
$c('mCards').addEventListener('change', e => {
  const cb = e.target.closest('input[data-id]'); if (!cb || !mState) return;
  if (cb.checked) mState.sel.add(cb.dataset.id); else mState.sel.delete(cb.dataset.id);
  cb.closest('.m-row').classList.toggle('on', cb.checked);
  $c('mCount').textContent = mState.sel.size ? `(${mState.sel.size} selected)` : (mState.id ? '(none selected)' : '(optional)');
});
$c('mSave').onclick = async () => {
  if (!mState) return;
  const cardIds = [...mState.sel];
  // a brand-new task may have no cards at all; when editing or merging, at least one card must stay
  if (!cardIds.length && (mState.id || mState.merge.size)) return toast('Pick at least one card.');
  const first = pickerCards().find(c => c.id === cardIds[0]);
  const typed = $c('mTitle').value.trim().replace(/\s+/g, ' ');
  if (!cardIds.length && !typed) return toast('Give the task a title.');
  const title = typed || ('Post: ' + (first ? first.name : 'cards') + (cardIds.length > 1 ? ` +${cardIds.length - 1}` : ''));
  const btn = $c('mSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const res = await save('savePostGroup', { id: mState.id, title, date: $c('mDate').value || todayC(), time: $c('mTime').value || '', cardIds: cardIds.join(','), mergeIds: [...mState.merge].join(',') });
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  const merged = mState.merge.size;
  closePicker(); toast(merged ? 'Tasks merged.' : 'Saved.');
  await loadData();
};

/* ---------- tabs, image view, load ---------- */
document.querySelectorAll('.tab[data-ctab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-ctab]').forEach(x => x.classList.toggle('active', x === t));
  tab = t.dataset.ctab;
  $c('panelVideo').hidden = tab !== 'video'; $c('panelPost').hidden = tab !== 'post';
  renderAll();
});
$c('imgViewClose').onclick = () => $c('imgView').hidden = true;
$c('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') $c('imgView').hidden = true; });
$c('cRefresh').onclick = loadData;

function renderAll() { if (tab === 'video') renderVideo(); else renderPosts(); }
async function loadData() {
  if (!CONFIG.portfolio.endpoint) { $c('vState').textContent = "Sync isn't set up yet."; $c('vState').hidden = false; return; }
  const cached = crFirst ? cacheGet('creatives') : null; crFirst = false;
  if (cached) { data = cached; renderVideo(); renderPosts(); }
  else { $c('vState').textContent = 'Loading\u2026'; $c('vState').hidden = false; $c('vList').hidden = true; }
  try {
    const res = await jsonp(api('creatives'), 45000);
    if (!res.ok) throw new Error(res.error || 'Unknown error');
    data = { videos: res.videos || [], posts: res.posts || [] };
    cacheSet('creatives', data);
    renderVideo(); renderPosts();
  } catch (err) {
    console.warn('Creatives load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    const msg = "Couldn't load Creatives (offline, wrong secret, or Code.gs needs a new deployment).";
    $c('vState').textContent = msg; $c('vState').hidden = false; $c('vList').hidden = true;
    $c('pState').textContent = msg; $c('pState').hidden = false; $c('pList').hidden = true;
  }
}
loadData();
