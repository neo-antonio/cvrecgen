/* ---------- Creatives — Video (vlog tasks) and Posts (card edits grouped per receipt) ---------- */
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

/* ---------- pills ---------- */
function pills(plats, keys) {
  return `<div class="cr-pills">${keys.map(k => {
    const p = (plats || {})[k] || {};
    const lab = PLATS[k] + (p.on && p.date ? ' \u00b7 ' + fmtDayC(p.date) : '');
    const href = safeUrl(p.link);
    if (p.on) return href ? `<a class="cr-pill on" href="${escC(href)}" target="_blank" rel="noopener">${escC(lab)} \u2197</a>` : `<span class="cr-pill on">${escC(lab)}</span>`;
    return `<span class="cr-pill">${escC(PLATS[k])}</span>`;
  }).join('')}</div>`;
}

/* ---------- Video ---------- */
const ICON_C = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>'
};
const iconC = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${escC(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_C[name]}</svg></button>`;

function videoHtml(v) {
  const done = v.status === 'done';
  const sub = [v.auto ? 'From receipt' : '', done && v.doneDate ? 'Done ' + fmtDayC(v.doneDate) : ''].filter(Boolean).join(' \u00b7 ');
  return `<div class="cr-card${done ? ' done' : ''}" data-id="${escC(v.id)}">
      <div class="cr-top">
        <input type="checkbox" class="cr-tick v-tick" ${done ? 'checked' : ''} aria-label="Mark ${done ? 'to do' : 'done'}">
        <div class="cr-main"><b>${escC(v.title)}</b>${sub ? `<span>${escC(sub)}</span>` : ''}</div>
        <input type="date" class="cr-date v-date" value="${escC(v.date)}" aria-label="Scheduled date">
      </div>
      ${pills(v.platforms, VIDEO_PLATS)}
      ${v.notes ? `<p class="cr-notes">${escC(v.notes)}</p>` : ''}
      <div class="cr-acts">${iconC('pencil', 'v-edit', 'Edit', v.id)}${iconC('trash', 'danger v-del', 'Delete', v.id)}</div>
    </div>`;
}

function renderVideo() {
  const todo = data.videos.filter(v => v.status !== 'done'), done = data.videos.filter(v => v.status === 'done');
  document.querySelector('#vFilters [data-f=todo]').textContent = `To do (${todo.length})`;
  document.querySelector('#vFilters [data-f=done]').textContent = `Done (${done.length})`;
  const list = (vFilter === 'todo' ? todo : done).slice()
    .sort((a, b) => vFilter === 'todo' ? (a.date || '9999').localeCompare(b.date || '9999') : (b.date || '').localeCompare(a.date || ''));
  $c('vCount').textContent = list.length ? nPlC(list.length, 'task') : '';
  if (!list.length) {
    $c('vState').textContent = data.videos.length ? (vFilter === 'todo' ? 'Nothing left to do. \ud83c\udf89' : 'Nothing marked done yet.') : 'No video tasks yet. Tick \u201cVlog needed\u201d on a purchase or trade receipt, or tap + Add task.';
    $c('vState').hidden = false; $c('vList').hidden = true; return;
  }
  $c('vList').innerHTML = list.map(videoHtml).join('');
  $c('vState').hidden = true; $c('vList').hidden = false;
}

/* platform editor shared by the video and post sheets */
function platEditor(host, keys, plats) {
  host.innerHTML = keys.map(k => {
    const p = (plats || {})[k] || {};
    return `<div class="cr-plat" data-p="${k}">
        <label class="port-chk"><input type="checkbox" class="pl-on" ${p.on ? 'checked' : ''}><span>${PLATS[k]}</span></label>
        <div class="pl-fields" ${p.on ? '' : 'hidden'}>
          <input type="date" class="pl-date" value="${escC(p.date || '')}" aria-label="${PLATS[k]} upload date">
          <input type="url" class="pl-link" value="${escC(p.link || '')}" placeholder="${PLATS[k]} link" inputmode="url" autocomplete="off">
        </div>
      </div>`;
  }).join('');
  host.querySelectorAll('.pl-on').forEach(cb => cb.onchange = () => {
    const f = cb.closest('.cr-plat').querySelector('.pl-fields');
    f.hidden = !cb.checked;
    const d = f.querySelector('.pl-date'); if (cb.checked && !d.value) d.value = todayC();
  });
}
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
  platEditor($c('vPlats'), VIDEO_PLATS, v ? v.platforms : {});
  $c('vSheet').hidden = false;
  if (!v) $c('vTitle').focus();
}
const closeVideo = () => { $c('vSheet').hidden = true; editVideoId = ''; };
$c('vAdd').onclick = () => openVideo('');
$c('vCancel').onclick = closeVideo;
$c('vSheet').addEventListener('click', e => { if (e.target.id === 'vSheet') closeVideo(); });
$c('vSave').onclick = async () => {
  const title = $c('vTitle').value.trim().replace(/\s+/g, ' ');
  if (!title) return toast('Enter a title.');
  const date = $c('vDate').value || todayC(), notes = $c('vNotes').value.trim(), platforms = readPlats($c('vPlats'));
  const btn = $c('vSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const existing = editVideoId ? findV(editVideoId) : null;
  const id = existing ? existing.id : 'v_' + Math.random().toString(16).slice(2, 10);
  const res = await save('saveCreative', { id, title, date, notes, platforms: JSON.stringify(platforms) });
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closeVideo(); toast(existing ? 'Task updated.' : 'Task added.');
  await loadData();
};

$c('vList').addEventListener('change', e => {
  const card = e.target.closest('.cr-card'); if (!card) return;
  const v = findV(card.dataset.id); if (!v) return;
  if (e.target.classList.contains('v-tick')) {
    v.status = e.target.checked ? 'done' : 'todo'; v.doneDate = v.status === 'done' ? todayC() : '';
    renderVideo(); save('saveCreative', { id: v.id, status: v.status });
  } else if (e.target.classList.contains('v-date')) {
    v.date = e.target.value; save('saveCreative', { id: v.id, date: v.date }); toast('Rescheduled.');
  }
});
$c('vList').addEventListener('click', async e => {
  const ed = e.target.closest('.v-edit'); if (ed) return openVideo(ed.dataset.id);
  const del = e.target.closest('.v-del');
  if (del) {
    const v = findV(del.dataset.id); if (!v || !confirm(`Delete "${v.title}"?`)) return;
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
      <button type="button" class="ghost sm pc-btn">${c.edited ? '\u21ba Re-add' : '\u2713 Edited'}</button>
    </div>`;
}
function groupHtml(g) {
  const edited = g.status === 'edited';
  return `<div class="cr-card${edited ? ' done' : ''}" data-id="${escC(g.id)}">
      <div class="cr-top">
        <div class="cr-main"><b>${escC(g.label || 'Cards')}</b><span>${fmtDayC(g.date)} \u00b7 ${g.editedCount} of ${nPlC(g.cards.length, 'card')} edited</span></div>
        <input type="date" class="cr-date p-date" value="${escC(g.scheduled)}" aria-label="Scheduled date">
      </div>
      <div class="cr-cards">${g.cards.map(c => cardRowHtml(g, c)).join('')}</div>
      ${pills(g.platforms, POST_PLATS)}
      ${g.caption ? `<p class="cr-notes"><small>Caption</small>${escC(g.caption)}</p>` : ''}
      ${g.notes ? `<p class="cr-notes"><small>Notes</small>${escC(g.notes)}</p>` : ''}
      <div class="cr-acts">
        ${edited ? '' : '<button type="button" class="ghost sm p-all">Mark all edited</button>'}
        <button type="button" class="ghost sm p-edit">Details</button>
      </div>
    </div>`;
}
function renderPosts() {
  const toedit = data.posts.filter(g => g.status !== 'edited'), edited = data.posts.filter(g => g.status === 'edited');
  document.querySelector('#pFilters [data-f=toedit]').textContent = `To edit (${toedit.length})`;
  document.querySelector('#pFilters [data-f=edited]').textContent = `Edited (${edited.length})`;
  const list = (pFilter === 'toedit' ? toedit : edited).slice()
    .sort((a, b) => pFilter === 'toedit' ? (a.scheduled || '9999').localeCompare(b.scheduled || '9999') : (b.scheduled || '').localeCompare(a.scheduled || ''));
  $c('pCount').textContent = list.length ? nPlC(list.length, 'receipt') + ' \u00b7 ' + nPlC(list.reduce((a, g) => a + g.cards.length, 0), 'card') : '';
  if (!list.length) {
    $c('pState').textContent = data.posts.length ? (pFilter === 'toedit' ? 'No cards waiting to be edited.' : 'No fully edited groups yet.') : 'No cards yet. Cards from purchase and trade receipts show up here, grouped per receipt.';
    $c('pState').hidden = false; $c('pList').hidden = true; return;
  }
  $c('pList').innerHTML = list.map(groupHtml).join('');
  $c('pState').hidden = true; $c('pList').hidden = false;
}
function refreshGroup(g) {
  g.editedCount = g.cards.filter(c => c.edited).length;
  g.status = g.editedCount === g.cards.length ? 'edited' : 'toedit';
}
$c('pList').addEventListener('change', e => {
  if (!e.target.classList.contains('p-date')) return;
  const g = findP(e.target.closest('.cr-card').dataset.id); if (!g) return;
  g.scheduled = e.target.value;
  save('saveCreative', { id: g.id, title: g.label || '', date: g.scheduled }); toast('Rescheduled.');
});
$c('pList').addEventListener('click', e => {
  const zoom = e.target.closest('.cr-zoom');
  if (zoom) { $c('imgViewImg').src = zoom.dataset.full; $c('imgView').hidden = false; return; }
  const cardEl = e.target.closest('.cr-card'); if (!cardEl) return;
  const g = findP(cardEl.dataset.id); if (!g) return;
  const pc = e.target.closest('.pc-btn');
  if (pc) {
    const c = g.cards.find(x => x.id === pc.closest('.cr-pc').dataset.card); if (!c) return;
    c.edited = !c.edited; refreshGroup(g); renderPosts();
    save('setCreativeCards', { id: g.id, cardIds: c.id, edited: c.edited });
    return;
  }
  if (e.target.closest('.p-all')) {
    g.cards.forEach(c => c.edited = true); refreshGroup(g); renderPosts();
    save('completeCreatives', { ids: g.id, status: 'done' }); toast('All cards marked edited.');
    return;
  }
  if (e.target.closest('.p-edit')) openPost(g.id);
});
document.querySelectorAll('#pFilters .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#pFilters .chip').forEach(x => x.classList.toggle('active', x === c));
  pFilter = c.dataset.f; renderPosts();
});

let editPostId = '';
function openPost(id) {
  const g = findP(id); if (!g) return;
  editPostId = id;
  $c('pHeading').textContent = g.label || 'Post details';
  $c('pDate').value = g.scheduled || ''; $c('pCaption').value = g.caption || ''; $c('pNotes').value = g.notes || '';
  platEditor($c('pPlats'), POST_PLATS, g.platforms);
  $c('pSheet').hidden = false;
}
const closePost = () => { $c('pSheet').hidden = true; editPostId = ''; };
$c('pCancel').onclick = closePost;
$c('pSheet').addEventListener('click', e => { if (e.target.id === 'pSheet') closePost(); });
$c('pCopy').onclick = async () => {
  const t = $c('pCaption').value;
  if (!t) return toast('No caption to copy.');
  try { await navigator.clipboard.writeText(t); toast('Caption copied.'); } catch (_) { $c('pCaption').select(); toast('Select and copy the caption.'); }
};
$c('pSave').onclick = async () => {
  const g = findP(editPostId); if (!g) return;
  g.scheduled = $c('pDate').value || g.scheduled; g.caption = $c('pCaption').value.trim(); g.notes = $c('pNotes').value.trim(); g.platforms = readPlats($c('pPlats'));
  const btn = $c('pSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  const res = await save('saveCreative', { id: g.id, title: g.label || '', date: g.scheduled, caption: g.caption, notes: g.notes, platforms: JSON.stringify(g.platforms) });
  btn.disabled = false; btn.textContent = 'Save';
  if (!res) return;
  closePost(); renderPosts(); toast('Saved.');
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
