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
const PLATS = { fb: 'Facebook', ig: 'Instagram', yt: 'YouTube', tt: 'TikTok' };
const VIDEO_PLATS = ['fb', 'ig', 'yt', 'tt'], POST_PLATS = ['fb', 'ig'];

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

/* ---------- pills: links only show once the task is posted ---------- */
function pills(plats, keys, showLinks) {
  return `<div class="cr-pills">${keys.map(k => {
    const p = (plats || {})[k] || {};
    const lab = PLATS[k] + (p.on && p.date ? ' \u00b7 ' + fmtDayC(p.date) : '');
    const href = showLinks ? safeUrl(p.link) : '';
    if (p.on) return href ? `<a class="cr-pill on" href="${escC(href)}" target="_blank" rel="noopener">${escC(lab)} \u2197</a>` : `<span class="cr-pill on">${escC(lab)}</span>`;
    return `<span class="cr-pill">${escC(PLATS[k])}</span>`;
  }).join('')}</div>`;
}

/* ---------- Video ---------- */
const ICON_C = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checks: '<path d="M2.5 12.5l4 4L14 8"/><path d="M10 15.5l1 1L21 7"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-6.5 18-4-8-8-4z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  addcards: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>'
};
const iconC = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${escC(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_C[name]}</svg></button>`;

function videoHtml(v) {
  const st = v.status || 'todo', done = st !== 'todo';
  const sub = [v.auto ? 'From receipt' : '', st === 'done' && v.doneDate ? 'Done ' + fmtDayC(v.doneDate) : '', st === 'posted' && v.doneDate ? 'Done ' + fmtDayC(v.doneDate) : ''].filter(Boolean).join(' \u00b7 ');
  return `<div class="cr-card${done ? ' done' : ''}" data-id="${escC(v.id)}">
      <div class="cr-top">
        <input type="checkbox" class="cr-tick v-tick" ${done ? 'checked' : ''} aria-label="Mark ${done ? 'to do' : 'done'}">
        <div class="cr-main"><b>${escC(v.title)}</b>${sub ? `<span>${escC(sub)}</span>` : ''}</div>
        <label class="cr-date-wrap"><small>Planned post date</small><input type="date" class="cr-date v-date" value="${escC(v.date)}" aria-label="Planned post date"></label>
      </div>
      ${metaHtml(v, done)}
      ${pills(v.platforms, VIDEO_PLATS, st === 'posted')}
      ${v.caption ? `<p class="cr-notes"><small>Caption</small>${escC(v.caption)}</p>` : ''}
      ${v.notes ? `<p class="cr-notes"><small>Notes</small>${linkify(v.notes)}</p>` : ''}
      <div class="cr-acts">
        ${iconC('copy', 'v-copy', 'Copy caption', v.id)}
        ${st === 'done' ? iconC('send', 'ok v-post', 'Mark posted', v.id) : ''}
        ${st === 'posted' ? iconC('undo', 'v-unpost', 'Back to done', v.id) : ''}
        ${iconC('pencil', 'v-edit', 'Edit', v.id)}${iconC('trash', 'danger v-del', 'Delete', v.id)}
      </div>
    </div>`;
}

function renderVideo() {
  const by = s => data.videos.filter(v => (v.status || 'todo') === s);
  const todo = by('todo'), done = by('done'), posted = by('posted');
  document.querySelector('#vFilters [data-f=todo]').textContent = `To do (${todo.length})`;
  document.querySelector('#vFilters [data-f=done]').textContent = `Done (${done.length})`;
  document.querySelector('#vFilters [data-f=posted]').textContent = `Posted (${posted.length})`;
  const list = ({ todo, done, posted })[vFilter].slice()
    .sort((a, b) => vFilter === 'todo' ? (a.date || '9999').localeCompare(b.date || '9999') : (b.date || '').localeCompare(a.date || ''));
  $c('vCount').textContent = list.length ? nPlC(list.length, 'task') : '';
  if (!list.length) {
    $c('vState').textContent = data.videos.length
      ? ({ todo: 'Nothing left to do. \ud83c\udf89', done: 'Nothing done and waiting to be posted.', posted: 'Nothing posted yet.' })[vFilter]
      : 'No video tasks yet. Tick \u201cVlog needed\u201d on a purchase or trade receipt, or tap + Add task.';
    $c('vState').hidden = false; $c('vList').hidden = true; return;
  }
  $c('vList').innerHTML = list.map(videoHtml).join('');
  $c('vState').hidden = true; $c('vList').hidden = false;
}

/* platform editor shared by the video and post sheets; the link box only exists for posted tasks */
function platEditor(host, keys, plats, showLinks) {
  host.innerHTML = keys.map(k => {
    const p = (plats || {})[k] || {};
    return `<div class="cr-plat" data-p="${k}">
        <label class="port-chk"><input type="checkbox" class="pl-on" ${p.on ? 'checked' : ''}><span>${PLATS[k]}</span></label>
        <div class="pl-fields" ${p.on ? '' : 'hidden'}>
          <input type="date" class="pl-date" value="${escC(p.date || '')}" aria-label="${PLATS[k]} upload date">
          <input type="url" class="pl-link" value="${escC(p.link || '')}" placeholder="${PLATS[k]} link" inputmode="url" autocomplete="off" ${showLinks ? '' : 'hidden'}>
        </div>
      </div>`;
  }).join('');
  host.querySelectorAll('.pl-on').forEach(cb => cb.onchange = () => {
    const f = cb.closest('.cr-plat').querySelector('.pl-fields');
    f.hidden = !cb.checked;
    const d = f.querySelector('.pl-date'); if (cb.checked && !d.value) d.value = todayC();
  });
}
const setLinksVisible = (host, on) => host.querySelectorAll('.pl-link').forEach(i => i.hidden = !on);
function readPlats(host) {
  const out = {};
  host.querySelectorAll('.cr-plat').forEach(r => {
    const on = r.querySelector('.pl-on').checked;
    out[r.dataset.p] = { on, date: on ? r.querySelector('.pl-date').value : '', link: r.querySelector('.pl-link').value.trim() };
  });
  return out;
}

let editVideoId = '';
function openVideo(id) {
  const v = id ? findV(id) : null;
  editVideoId = v ? v.id : '';
  $c('vHeading').textContent = v ? 'Edit video task' : 'Add video task';
  $c('vTitle').value = v ? v.title : ''; $c('vDate').value = v ? v.date : todayC(); $c('vNotes').value = v ? v.notes : '';
  $c('vCaption').value = v ? (v.caption || '') : '';
  $c('vStatus').value = v ? (v.status || 'todo') : 'todo';
  platEditor($c('vPlats'), VIDEO_PLATS, v ? v.platforms : {}, $c('vStatus').value === 'posted');
  $c('vSheet').hidden = false;
  if (!v) $c('vTitle').focus();
}
const closeVideo = () => { $c('vSheet').hidden = true; editVideoId = ''; };
$c('vStatus').onchange = () => setLinksVisible($c('vPlats'), $c('vStatus').value === 'posted');
$c('vAdd').onclick = () => openVideo('');
$c('vCancel').onclick = closeVideo;
$c('vCopy').onclick = () => copyText($c('vCaption').value);
$c('vSheet').addEventListener('click', e => { if (e.target.id === 'vSheet') closeVideo(); });
$c('vSave').onclick = async () => {
  const title = $c('vTitle').value.trim().replace(/\s+/g, ' ');
  if (!title) return toast('Enter a title.');
  const date = $c('vDate').value || todayC(), notes = $c('vNotes').value.trim(), caption = $c('vCaption').value.trim();
  const status = $c('vStatus').value, platforms = readPlats($c('vPlats'));
  const btn = $c('vSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const existing = editVideoId ? findV(editVideoId) : null;
  const id = existing ? existing.id : 'v_' + Math.random().toString(16).slice(2, 10);
  const res = await save('saveCreative', { id, title, date, notes, caption, status, platforms: JSON.stringify(platforms) });
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closeVideo(); toast(existing ? 'Task updated.' : 'Task added.');
  await loadData();
};

function setVStatus(v, status) {
  v.status = status; v.doneDate = status === 'todo' ? '' : todayC();
  renderVideo(); save('saveCreative', { id: v.id, status });
}
$c('vList').addEventListener('change', e => {
  const card = e.target.closest('.cr-card'); if (!card) return;
  const v = findV(card.dataset.id); if (!v) return;
  if (e.target.classList.contains('v-tick')) {
    setVStatus(v, e.target.checked ? 'done' : 'todo');
  } else if (e.target.classList.contains('v-date')) {
    v.date = e.target.value; save('saveCreative', { id: v.id, date: v.date }); toast('Rescheduled.');
  }
});
$c('vList').addEventListener('click', async e => {
  const cardEl = e.target.closest('.cr-card'); if (!cardEl) return;
  const v = findV(cardEl.dataset.id); if (!v) return;
  if (e.target.closest('.v-copy')) return copyText(v.caption);
  if (e.target.closest('.v-post')) { setVStatus(v, 'posted'); return openLinks('video', v); }
  if (e.target.closest('.v-unpost')) return setVStatus(v, 'done');
  if (e.target.closest('.v-edit')) return openVideo(v.id);
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
      <div class="port-info"><b>${escC(c.name)}</b><span>${phpC(c.cost)}</span></div>
      ${c.edited ? iconC('undo', 'pc-btn', 'Back to to-edit', c.id) : iconC('check', 'ok pc-btn', 'Mark edited', c.id)}
    </div>`;
}
function groupHtml(g) {
  const st = g.status, finished = st !== 'toedit';
  const sub = [g.custom ? 'Combined task' : '', `${g.editedCount} of ${nPlC(g.cards.length, 'card')} edited`].filter(Boolean).join(' \u00b7 ');
  return `<div class="cr-card${finished ? ' done' : ''}" data-id="${escC(g.id)}">
      <div class="cr-top">
        <div class="cr-main"><b>${escC(g.label || 'Cards')}</b><span>${escC(sub)}</span></div>
        <label class="cr-date-wrap"><small>Planned post date</small><input type="date" class="cr-date p-date" value="${escC(g.scheduled)}" aria-label="Planned post date"></label>
      </div>
      ${metaHtml(g, finished)}
      <div class="cr-cards">${g.cards.map(c => cardRowHtml(g, c)).join('')}</div>
      ${pills(g.platforms, POST_PLATS, st === 'posted')}
      ${g.caption ? `<p class="cr-notes"><small>Caption</small>${escC(g.caption)}</p>` : ''}
      ${g.notes ? `<p class="cr-notes"><small>Notes</small>${linkify(g.notes)}</p>` : ''}
      <div class="cr-acts">
        ${iconC('copy', 'p-copy', 'Copy caption', g.id)}
        ${st === 'toedit' ? iconC('checks', 'ok p-all', 'Mark all edited', g.id) : ''}
        ${st === 'edited' ? iconC('send', 'ok p-post', 'Mark posted', g.id) : ''}
        ${st === 'posted' ? iconC('undo', 'p-unpost', 'Back to done', g.id) : ''}
        ${iconC('addcards', 'p-merge', 'Add / merge cards', g.id)}
        ${iconC('doc', 'p-edit', 'Details', g.id)}
        ${g.custom ? iconC('trash', 'danger p-del', 'Delete task', g.id) : ''}
      </div>
    </div>`;
}
function renderPosts() {
  const by = s => data.posts.filter(g => g.status === s);
  const toedit = by('toedit'), edited = by('edited'), posted = by('posted');
  document.querySelector('#pFilters [data-f=toedit]').textContent = `To do (${toedit.length})`;
  document.querySelector('#pFilters [data-f=edited]').textContent = `Done (${edited.length})`;
  document.querySelector('#pFilters [data-f=posted]').textContent = `Posted (${posted.length})`;
  const list = ({ toedit, edited, posted })[pFilter].slice()
    .sort((a, b) => pFilter === 'toedit' ? (a.scheduled || '9999').localeCompare(b.scheduled || '9999') : (b.scheduled || '').localeCompare(a.scheduled || ''));
  $c('pCount').textContent = list.length ? nPlC(list.length, 'task') + ' \u00b7 ' + nPlC(list.reduce((a, g) => a + g.cards.length, 0), 'card') : '';
  if (!list.length) {
    $c('pState').textContent = data.posts.length
      ? ({ toedit: 'No cards waiting to be edited.', edited: 'Nothing edited and waiting to be posted.', posted: 'Nothing posted yet.' })[pFilter]
      : 'No cards yet. Cards from purchase and trade receipts show up here, grouped per receipt. Tap + New post task to make your own.';
    $c('pState').hidden = false; $c('pList').hidden = true; return;
  }
  $c('pList').innerHTML = list.map(groupHtml).join('');
  $c('pState').hidden = true; $c('pList').hidden = false;
}
function refreshGroup(g) {
  g.editedCount = g.cards.filter(c => c.edited).length;
  g.status = g.cards.length && g.editedCount === g.cards.length ? 'edited' : 'toedit';   // any change to the cards un-posts the task (the server does the same)
}
$c('pList').addEventListener('change', e => {
  if (!e.target.classList.contains('p-date')) return;
  const g = findP(e.target.closest('.cr-card').dataset.id); if (!g) return;
  g.scheduled = e.target.value;
  save('saveCreative', { id: g.id, date: g.scheduled }); toast('Rescheduled.');
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
  if (e.target.closest('.p-post')) {
    g.status = 'posted'; renderPosts();
    save('saveCreative', { id: g.id, status: 'posted' });
    return openLinks('post', g);
  }
  if (e.target.closest('.p-unpost')) {
    g.status = 'edited'; renderPosts();
    save('saveCreative', { id: g.id, status: 'todo' });
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
  const posted = g.status === 'posted';
  $c('pHeading').textContent = 'Post details';
  $c('pTitle').value = g.label || '';
  $c('pDate').value = g.scheduled || ''; $c('pCaption').value = g.caption || ''; $c('pNotes').value = g.notes || '';
  $c('pPosted').checked = posted;
  platEditor($c('pPlats'), POST_PLATS, g.platforms, posted);
  $c('pSheet').hidden = false;
}
const closePost = () => { $c('pSheet').hidden = true; editPostId = ''; };
$c('pPosted').onchange = () => setLinksVisible($c('pPlats'), $c('pPosted').checked);
$c('pCancel').onclick = closePost;
$c('pSheet').addEventListener('click', e => { if (e.target.id === 'pSheet') closePost(); });
$c('pCopy').onclick = () => copyText($c('pCaption').value);
$c('pSave').onclick = async () => {
  const g = findP(editPostId); if (!g) return;
  const posted = $c('pPosted').checked;
  g.scheduled = $c('pDate').value || g.scheduled; g.caption = $c('pCaption').value.trim(); g.notes = $c('pNotes').value.trim(); g.platforms = readPlats($c('pPlats'));
  const btn = $c('pSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  // a posted task has every card edited
  if (posted && g.cards.some(c => !c.edited)) {
    g.cards.forEach(c => c.edited = true); g.editedCount = g.cards.length;
    await save('setCreativeCards', { id: g.id, cardIds: g.cards.map(c => c.id).join(','), edited: true, complete: '1' });
  }
  g.status = posted ? 'posted' : (g.cards.length && g.cards.every(c => c.edited) ? 'edited' : 'toedit');
  const params = { id: g.id, date: g.scheduled, caption: g.caption, notes: g.notes, platforms: JSON.stringify(g.platforms), status: posted ? 'posted' : 'todo' };
  const newTitle = $c('pTitle').value.trim().replace(/\s+/g, ' ');
  if (newTitle && newTitle !== g.label) { g.label = newTitle; params.title = newTitle; params.renamed = '1'; }   // empty = keep the current title
  const res = await save('saveCreative', params);
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closePost(); renderPosts(); toast('Saved.');
};

/* ---------- links popup: appears when a video or post is marked posted; dismissible ---------- */
let linkCtx = null;
function openLinks(kind, item) {
  const keys = kind === 'video' ? VIDEO_PLATS : POST_PLATS;
  linkCtx = { kind, item, keys };
  $c('lFields').innerHTML = keys.map(k => {
    const p = (item.platforms || {})[k] || {};
    return `<div class="field"><label for="lk_${k}">${PLATS[k]}</label><input type="url" id="lk_${k}" data-p="${k}" value="${escC(p.link || '')}" placeholder="${PLATS[k]} link" inputmode="url" autocomplete="off"></div>`;
  }).join('');
  $c('lSheet').hidden = false;
  const first = $c('lFields').querySelector('input'); if (first) first.focus();
}
const closeLinks = () => { $c('lSheet').hidden = true; linkCtx = null; };
$c('lSkip').onclick = closeLinks;
$c('lSheet').addEventListener('click', e => { if (e.target.id === 'lSheet') closeLinks(); });
$c('lSave').onclick = async () => {
  if (!linkCtx) return;
  const { kind, item } = linkCtx;
  const plats = JSON.parse(JSON.stringify(item.platforms || {}));
  let n = 0;
  for (const inp of $c('lFields').querySelectorAll('input')) {
    const v = inp.value.trim(); if (!v) continue;
    if (!safeUrl(v)) return toast('Links must start with http:// or https://');
    const k = inp.dataset.p, cur = plats[k] || {};
    plats[k] = { on: true, date: cur.date || todayC(), link: v }; n++;
  }
  if (!n) return closeLinks();
  item.platforms = plats;
  closeLinks(); if (kind === 'video') renderVideo(); else renderPosts();
  const res = await save('saveCreative', { id: item.id, platforms: JSON.stringify(plats) });
  if (res) toast('Links saved.');
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
  $c('mCount').textContent = `(${mState.sel.size} selected)`;
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
  $c('mDate').value = g ? (g.scheduled || todayC()) : todayC();
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
  $c('mCount').textContent = `(${mState.sel.size} selected)`;
});
$c('mSave').onclick = async () => {
  if (!mState) return;
  const cardIds = [...mState.sel];
  if (!cardIds.length) return toast('Pick at least one card.');
  const first = pickerCards().find(c => c.id === cardIds[0]);
  const title = $c('mTitle').value.trim().replace(/\s+/g, ' ') || ('Post: ' + (first ? first.name : 'cards') + (cardIds.length > 1 ? ` +${cardIds.length - 1}` : ''));
  const btn = $c('mSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const res = await save('savePostGroup', { id: mState.id, title, date: $c('mDate').value || todayC(), cardIds: cardIds.join(','), mergeIds: [...mState.merge].join(',') });
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
