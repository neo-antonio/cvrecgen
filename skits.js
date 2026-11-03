/* ---------- Skits — video ideas to shoot ----------
   Backend: Code.gs skits / saveSkit / skitToVideo / deleteSkit.
   A plain list, laid out like the Topic Board: each skit shows its title, notes, status, who suggested it and when.
   Links in the notes (or the optional video link) turn into buttons. There are no thumbnails or embeds.
   To do -> "Move to video edit" creates a to-do video task in Creatives. When that video is posted (Socials > Planner > Publish) the skit moves to Done by itself. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = n => { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); };
  const pad = n => String(n).padStart(2, '0');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const me = () => String((window.CVAuth && CVAuth.user()) || '').trim().toLowerCase();
  const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
    + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
    + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const backendErr = err => err && err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : (err && err.message) || 'Something went wrong';
  let toastT;
  function toast(m) { const t = $('kToast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3400); }
  async function call(action, params, ms) {
    const res = await jsonp(api(action, params), ms || 45000);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Request failed');
    return res;
  }
  /* "2026-10-17 15:42" (saved by the server) -> "Oct 17, 2026 · 3:42 PM" */
  function stamp(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return String(s || '');
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + (m[4] == null ? '' : ' \u00b7 ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  }
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const isVideoSite = u => /^https?:\/\/([\w-]+\.)*(youtube\.com|youtu\.be|instagram\.com|instagr\.am|facebook\.com|fb\.watch|fb\.com|fb\.me|tiktok\.com)(\/|$|\?)/i.test(String(u || '').trim());

  /* ---------- links pasted into text (same buttons as the Topic Board) ---------- */
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const LINK_ICON = {
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 9.5l4 2.5-4 2.5z" fill="currentColor"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.6"/><path d="M4 18l5.5-5.5 4 4 2.5-2.5L20 18"/>',
  doc: '<path d="M6 2.8h8l4.2 4.2V21H6z"/><path d="M14 2.8V7h4.2M8.8 12h6.4M8.8 15.5h6.4"/>',
  sheet: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17"/>',
  slides: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5v4M8 20.5h8"/>',
  folder: '<path d="M3 6.5a2 2 0 012-2h4.2l2 2.3H19a2 2 0 012 2v8.7a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'
};
function classify(raw) {
  let u; try { u = new URL(raw); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^(www|m)\./, ''), p = u.pathname;
  const host = h.length > 28 ? h.slice(0, 27) + '\u2026' : h;
  if (h === 'docs.google.com') {
    if (/^\/spreadsheets/.test(p)) return { icon: 'sheet', label: 'Google Sheet' };
    if (/^\/presentation/.test(p)) return { icon: 'slides', label: 'Google Slides' };
    if (/^\/forms/.test(p)) return { icon: 'doc', label: 'Google Form' };
    return { icon: 'doc', label: 'Google Doc' };
  }
  if (h === 'drive.google.com' || h === 'drive.usercontent.google.com') {
    if (/\/folders\//.test(p)) return { icon: 'folder', label: 'Drive folder' };
    return { icon: 'doc', label: 'Drive file' };
  }
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|loom\.com|tiktok\.com|streamable\.com|twitch\.tv|dailymotion\.com)$/.test(h)
    || (/(^|\.)facebook\.com$|^fb\.watch$/.test(h) && /\/(watch|reel|videos?)\b/.test(p) || h === 'fb.watch')
    || (h === 'instagram.com' && /^\/(reel|tv)\//.test(p)) || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(p)) return { icon: 'video', label: 'Video' };
  if (/\.(jpe?g|png|gif|webp|avif|bmp|heic)$/i.test(p) || h === 'i.imgur.com') return { icon: 'image', label: 'Image' };
  if (/\.pdf$/i.test(p)) return { icon: 'doc', label: 'PDF' };
  return { icon: 'link', label: host };
}
// text with every link swapped for its button (all other text is escaped)
function rich(src) {
  const s = String(src == null ? '' : src); let out = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s))) {
    const trail = (m[0].match(/[.,;:!?)\]]+$/) || [''])[0], url = m[0].slice(0, m[0].length - trail.length), c = classify(url);
    out += esc(s.slice(last, m.index));
    out += c ? `<a class="tp-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(url)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LINK_ICON[c.icon]}</svg><span>${esc(c.label)}</span></a>` : esc(url);
    out += esc(trail); last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
// board notes stay plain text: each link is shortened to its address
const plain = s => String(s || '').replace(URL_RE, u => { const c = u.replace(/[.,;:!?)\]]+$/, ''); try { return new URL(c).hostname.replace(/^www\./, ''); } catch (_) { return c; } });

  /* ---------------- list ---------------- */
  let list = [], filter = 'todo', loaded = false;
  const find = id => list.find(k => k.id === id);
  const tagOf = k => k.status === 'done' ? (k.videoStatus === 'posted' ? 'Posted' : 'Done')
    : k.status === 'edit' ? 'In video edit' : k.link ? 'To do' : 'Idea';
  const byLine = k => (k.by ? `<i>${esc(cap(k.by))}</i> \u00b7 ` : '') + esc(stamp(k.createdAt));

  function cardHtml(k) {
    return `<button type="button" class="tp-note sk-note" data-id="${esc(k.id)}">
      <b>${esc(k.title)}</b>
      ${k.notes ? `<p class="tp-prev">${esc(plain(k.notes))}</p>` : ''}
      <span class="sk-tag">${esc(tagOf(k))}</span>
      <div class="tp-meta"><span>${byLine(k)}</span></div>
    </button>`;
  }
  function render() {
    const todo = list.filter(k => k.status !== 'done').sort((a, b) => (a.status === 'edit') - (b.status === 'edit'));
    const done = list.filter(k => k.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    document.querySelector('#kFilters [data-f=todo]').textContent = `To do (${todo.length})`;
    document.querySelector('#kFilters [data-f=done]').textContent = `Done (${done.length})`;
    const rows = filter === 'todo' ? todo : done;
    $('kCount').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'skit' : 'skits'}` : '';
    if (!rows.length) {
      $('kState').textContent = loaded ? (filter === 'todo' ? 'No skits yet. Tap Add skit to save your first idea.' : 'Nothing done yet. A skit lands here once its video is posted.') : 'Loading\u2026';
      $('kState').hidden = false; $('kList').hidden = true; return;
    }
    $('kState').hidden = true; $('kList').hidden = false;
    $('kList').innerHTML = rows.map(cardHtml).join('');
  }
  async function load(manual) {
    if (!CONFIG.portfolio.endpoint) { $('kState').textContent = "Sync isn't set up yet."; return; }
    const c = cacheGet('skits');
    if (c && Array.isArray(c.skits) && !loaded) { list = c.skits; loaded = true; render(); }
    try {
      const r = await call('skits');
      list = r.skits || []; loaded = true; cacheSet('skits', { skits: list }); render();
      if (manual) toast('Skits refreshed.');
    } catch (err) {
      if (!loaded) { $('kState').textContent = "Couldn't load skits (offline, wrong secret, or Code.gs needs a new deployment)."; $('kState').hidden = false; }
      else toast('Could not refresh \u2014 showing your last saved data.');
    }
  }
  $('kFilters').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    filter = b.dataset.f; $('kFilters').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b)); render();
  });
  $('kRefresh').onclick = () => load(true);

  /* ---------------- add / edit ---------------- */
  let editId = '';
  function openForm(k) {
    editId = k ? k.id : '';
    $('kHeading').textContent = k ? 'Edit skit' : 'Add skit';
    $('kLink').value = k ? k.link : ''; $('kTitle').value = k ? k.title : ''; $('kNotes').value = k ? k.notes : '';
    $('kDel').hidden = !k; $('kView').hidden = true; $('kSheet').hidden = false; $('kTitle').focus();
  }
  const closeForm = () => { $('kSheet').hidden = true; editId = ''; };
  $('kAdd').onclick = () => openForm(null);
  $('kCancel').onclick = closeForm;
  $('kSave').onclick = async () => {
    const link = $('kLink').value.trim(), title = $('kTitle').value.trim(), notes = $('kNotes').value.trim();
    if (!title && !link) return toast('Give the skit a title.');
    if (link && !isVideoSite(link)) return toast('The video link must be YouTube, Instagram, Facebook or TikTok. Other links can go in the notes.');
    const b = $('kSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try {
      const p = { title, link, notes };
      if (editId) p.id = editId; else p.by = me();   // who suggested it is set once, when it is added
      await call('saveSkit', p);
      closeForm(); toast('Skit saved.'); await load();
    } catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };

  /* ---------------- one skit ---------------- */
  let viewId = '';
  function openView(k) {
    viewId = k.id;
    $('kvTitle').textContent = k.title;
    $('kvSub').innerHTML = `${k.by ? 'Suggested by <b>' + esc(cap(k.by)) + '</b> \u00b7 ' : 'Added '}${esc(stamp(k.createdAt))}<br>${esc(tagOf(k))}${k.status === 'edit' ? ' \u00b7 it moves to Done when the video is posted' : ''}`;
    const parts = [];
    if (safeUrl(k.link)) parts.push(`<p class="tp-body">${rich(k.link)}</p>`);
    if (k.notes) parts.push(`<p class="tp-body">${rich(k.notes)}</p>`);
    $('kvBody').innerHTML = parts.join('') || '<p class="tp-none">No notes yet. Tap Edit to add some.</p>';
    $('kvMove').hidden = k.status !== 'todo';
    $('kvDone').hidden = k.status === 'done';
    $('kvReopen').hidden = k.status !== 'done';
    $('kView').hidden = false;
  }
  const closeView = () => { $('kView').hidden = true; viewId = ''; };
  $('kvClose').onclick = closeView;
  $('kvEdit').onclick = () => { const k = find(viewId); if (k) openForm(k); };

  async function moveToVideo(k, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await call('skitToVideo', { id: k.id, date: todayIso() });
      closeView(); toast(r.already ? 'Already in video edit.' : 'Moved to Creatives > Video. It shows as Done here once the video is posted.');
      await load();
    } catch (err) { toast('Could not move: ' + backendErr(err)); }
    if (btn) btn.disabled = false;
  }
  async function setStatus(k, status) {
    try { await call('saveSkit', { id: k.id, status }); closeView(); toast(status === 'done' ? 'Marked done.' : 'Back on the to-do list.'); await load(); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
  }
  async function remove(k) {
    if (!confirm(`Delete "${k.title}"?${k.status !== 'todo' ? '\n\nThe video task in Creatives is not deleted.' : ''}`)) return;
    try { await call('deleteSkit', { id: k.id }); closeView(); closeForm(); toast('Skit deleted.'); await load(); }
    catch (err) { toast('Could not delete: ' + backendErr(err)); }
  }
  $('kvMove').onclick = () => { const k = find(viewId); if (k) moveToVideo(k, $('kvMove')); };
  $('kvDone').onclick = () => { const k = find(viewId); if (k) setStatus(k, 'done'); };
  $('kvReopen').onclick = () => { const k = find(viewId); if (k) setStatus(k, 'todo'); };
  $('kvDel').onclick = () => { const k = find(viewId); if (k) remove(k); };
  $('kDel').onclick = () => { const k = find(editId); if (k) remove(k); };

  $('kList').addEventListener('click', e => { const n = e.target.closest('.sk-note'), k = n && find(n.dataset.id); if (k) openView(k); });
  ['kSheet', 'kView'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) { if (id === 'kView') closeView(); else closeForm(); } }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('kView').hidden) closeView(); if (!$('kSheet').hidden) closeForm(); } });

  load();
})();
