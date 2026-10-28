/* ---------- Topic Board — meeting topics, comments and conclusions, from the Topics sheet (Code.gs: topics, saveTopic, addTopicComment, resolveTopic, reopenTopic, deleteTopic) ----------
   Every note, comment and conclusion records the logged-in person (CVAuth, shell.js); the date and time are stamped by the server. */
(function () {
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = n => { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); };
const isAdmin = () => !!(window.CVAuth && CVAuth.isAdmin());
const realMe = () => (window.CVAuth && CVAuth.user()) || '';   // who is actually logged in
/* The admin (neo) can post, comment, resolve, edit and delete as any teammate without logging in as them: pick the name in "Post as".
   Everything is recorded under that person's name; Code.gs only accepts this when the real login (sent as `actor`) is the admin. */
let actAs = '';
const me = () => (isAdmin() && actAs) || realMe();

let tab = 'open', query = '', topics = [], openId = null, editId = null;

/* "2026-10-17 15:42" (saved by the server) -> "Oct 17, 2026 · 3:42 PM" */
function stamp(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return String(s || '');
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) + ' \u00b7 ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
// each person gets the same note colour every time
const colour = name => 'tp-c' + (String(name || '').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) % 5);
/* ---------- links pasted into text ----------
   Every http(s) link in a topic, comment or conclusion becomes a button that opens it in a new tab. The icon shows what it is:
   video, image, Google Doc / Sheet / Slides, Drive file or folder, PDF, or a plain link when it can't be told. Nothing extra is stored. */
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
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const mine = t => isAdmin() || String(t.by).toLowerCase() === me();

function toast(m) {
  const t = $('tpToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000);
}

async function call(action, params) {
  if (params && params.by) params = Object.assign({ actor: realMe() }, params);   // the server checks that only the admin posts as someone else
  const url = CONFIG.portfolio.endpoint + '?action=' + action + Object.keys(params || {}).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('') + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const d = await jsonp(url);
  if (!d.ok) throw new Error(d.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (d.error || 'Request failed'));
  return d;
}
// a topic the server just returned replaces the local copy, so the board updates without a reload
function put(t) {
  const i = topics.findIndex(x => x.id === t.id);
  if (i >= 0) topics[i] = t; else topics.unshift(t);
  cacheSet('topics', topics);
  render(); if (openId === t.id) renderDetail();
}

/* ---------- board ---------- */
function noteHtml(t) {
  const n = t.comments.length;
  return `<button type="button" class="tp-note ${colour(t.by)}" data-id="${esc(t.id)}">
      <b>${esc(t.title)}</b>
      ${t.body ? `<p class="tp-prev">${esc(plain(t.body))}</p>` : ''}
      ${t.status === 'resolved' ? `<div class="tp-done"><small>Conclusion</small>${esc(plain(t.conclusion))}</div>` : ''}
      <div class="tp-meta"><span><i>${esc(cap(t.by))}</i> \u00b7 ${esc(stamp(t.at))}</span>${n ? `<span>${plural(n, 'comment')}</span>` : ''}</div>
    </button>`;
}
function matches(t) {
  if (!query) return true;
  return [t.title, t.body, t.conclusion, t.by].concat(t.comments.map(c => c.text)).some(s => String(s || '').toLowerCase().includes(query));
}
function render() {
  const open = topics.filter(t => t.status === 'open'), done = topics.filter(t => t.status === 'resolved');
  document.querySelector('[data-ttab=open]').textContent = 'Open' + (open.length ? ' (' + open.length + ')' : '');
  document.querySelector('[data-ttab=resolved]').textContent = 'Resolved' + (done.length ? ' (' + done.length + ')' : '');
  $('tpLabel').textContent = tab === 'open' ? 'Topics to discuss' : 'Resolved topics';
  const list = (tab === 'open' ? open : done).filter(matches);
  $('tpTotal').textContent = list.length;
  if (!list.length) {
    $('tpState').textContent = query ? 'No topics match your search.' : tab === 'open' ? 'Nothing on the board. Tap "+ New topic" to add something to discuss.' : 'No resolved topics yet.';
    $('tpState').hidden = false; $('tpBoard').hidden = true;
    return;
  }
  // open topics: oldest first so the longest-waiting ones are on top; resolved: most recently concluded first
  const sorted = list.slice().sort(tab === 'open' ? (a, b) => String(a.at).localeCompare(String(b.at)) : (a, b) => String(b.concludedAt).localeCompare(String(a.concludedAt)));
  $('tpBoard').innerHTML = sorted.map(noteHtml).join('');
  $('tpState').hidden = true; $('tpBoard').hidden = false;
}

/* ---------- detail ---------- */
function renderDetail() {
  const t = topics.find(x => x.id === openId);
  if (!t) { $('tpView').hidden = true; openId = null; return; }
  const keepComment = ($('tpCmText') || {}).value || '', keepConcl = ($('tpConcl') || {}).value || '', resolveOpen = !!$('tpResolveBox') && !$('tpResolveBox').hidden;
  const comments = t.comments.length
    ? t.comments.map(c => `<div class="tp-cm ${colour(c.by)}"><div class="tp-cm-h"><b>${esc(cap(c.by))}</b><small>${esc(stamp(c.at))}</small></div><p>${rich(c.text)}</p></div>`).join('')
    : '<p class="tp-none">No comments yet.</p>';
  const isOpen = t.status === 'open';
  $('tpViewBody').innerHTML = `
    <span class="tp-state ${t.status}">${isOpen ? 'Open' : 'Resolved'}</span>
    <h3>${esc(t.title)}</h3>
    <p class="tp-by">Added by <b>${esc(cap(t.by))}</b> \u00b7 ${esc(stamp(t.at))}</p>
    ${t.body ? `<p class="tp-body">${rich(t.body)}</p>` : ''}
    ${isOpen ? '' : `<div class="tp-concl"><small>Conclusion by <b>${esc(cap(t.concludedBy))}</b> \u00b7 ${esc(stamp(t.concludedAt))}</small><p>${rich(t.conclusion)}</p></div>`}
    <h4 class="tp-sec">Comments (${t.comments.length})</h4>
    <div class="tp-cms">${comments}</div>
    <div class="tp-add">
      <textarea id="tpCmText" rows="2" maxlength="800" placeholder="${isOpen ? 'Add a comment, e.g. a note for next time' : 'Add a comment'}">${esc(keepComment)}</textarea>
      <p class="tp-hint">Paste a link and it turns into a button.</p>
      <button type="button" class="ghost sm" data-act="comment">Add comment</button>
    </div>
    ${isOpen ? `<div class="field tp-add" id="tpResolveBox"${resolveOpen ? '' : ' hidden'}>
      <label for="tpConcl">Conclusion <small>(what was decided)</small></label>
      <textarea id="tpConcl" rows="3" maxlength="800" placeholder="Write the conclusion from the meeting">${esc(keepConcl)}</textarea>
      <button type="button" class="go sm" data-act="resolveGo">Mark as resolved</button>
    </div>` : ''}
    <div class="acts">
      ${isOpen ? `<button type="button" class="ghost" data-act="resolve"${resolveOpen ? ' hidden' : ''}>Resolve with a conclusion</button>` : '<button type="button" class="ghost" data-act="reopen">Reopen</button>'}
      ${mine(t) ? '<button type="button" class="ghost" data-act="edit">Edit topic</button><button type="button" class="ghost danger" data-act="delete">Delete topic</button>' : ''}
      <button type="button" class="ghost" data-act="close">Close</button>
    </div>`;
}
const closeDetail = () => { $('tpView').hidden = true; openId = null; };
$('tpBoard').addEventListener('click', e => {
  const n = e.target.closest('.tp-note'); if (!n) return;
  openId = n.dataset.id; renderDetail(); $('tpView').hidden = false;
});
$('tpView').addEventListener('click', async e => {
  if (e.target.id === 'tpView') return closeDetail();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const t = topics.find(x => x.id === openId); if (!t) return;
  const act = b.dataset.act, who = me();
  if (act === 'close') return closeDetail();
  if (act === 'resolve') { $('tpResolveBox').hidden = false; b.hidden = true; $('tpConcl').focus(); return; }
  if (act === 'edit') { $('tpView').hidden = true; return openForm(t); }   // the form sits under the detail sheet, so hide the detail while editing
  const run = async (fn, okMsg) => {
    b.disabled = true;
    try { const d = await fn(); if (d && d.topic) put(d.topic); else if (d) { topics = topics.filter(x => x.id !== t.id); cacheSet('topics', topics); closeDetail(); render(); } toast(okMsg); }
    catch (err) { toast('Could not save: ' + err.message); }
    b.disabled = false;
  };
  if (act === 'comment') {
    const text = $('tpCmText').value.trim();
    if (!text) return toast('Write a comment first.');
    return run(() => call('addTopicComment', { topicId: t.id, by: who, text }), 'Comment added.').then(() => { const f = $('tpCmText'); if (f) f.value = ''; });
  }
  if (act === 'resolveGo') {
    const conclusion = $('tpConcl').value.trim();
    if (!conclusion) return toast('Write a conclusion before resolving.');
    return run(() => call('resolveTopic', { topicId: t.id, by: who, conclusion }), 'Moved to resolved.');
  }
  if (act === 'reopen') return run(() => call('reopenTopic', { topicId: t.id, by: who }), 'Topic reopened.');
  if (act === 'delete') {
    if (!confirm('Delete this topic and all its comments? This cannot be undone.')) return;
    return run(() => call('deleteTopic', { topicId: t.id, by: who }), 'Topic deleted.');
  }
});

/* ---------- add / edit form ---------- */
function openForm(t) {
  editId = t ? t.id : null;
  $('tpFormTitle').textContent = t ? 'Edit topic' : 'New topic';
  $('tpFormSave').textContent = t ? 'Save changes' : 'Add to board';
  $('tpTitle').value = t ? t.title : ''; $('tpBodyIn').value = t ? t.body : '';
  $('tpForm').hidden = false; $('tpTitle').focus();
}
const closeForm = () => { const back = editId && openId; $('tpForm').hidden = true; editId = null; if (back) $('tpView').hidden = false; };   // after editing, go back to the topic
$('tpNew').onclick = () => openForm(null);
$('tpFormCancel').onclick = closeForm;
$('tpForm').addEventListener('click', e => { if (e.target.id === 'tpForm') closeForm(); });
$('tpFormSave').onclick = async () => {
  const title = $('tpTitle').value.trim(), body = $('tpBodyIn').value.trim(), btn = $('tpFormSave');
  if (!title) return toast('Give the topic a title.');
  btn.disabled = true;
  try {
    const params = { by: me(), title, body }; if (editId) params.topicId = editId;
    const d = await call('saveTopic', params);
    const wasEdit = !!editId; closeForm(); put(d.topic);
    if (!wasEdit) { tab = 'open'; document.querySelectorAll('[data-ttab]').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'open')); render(); }
    toast(wasEdit ? 'Topic updated.' : 'Added to the board.');
  } catch (err) { toast('Could not save: ' + err.message); }
  btn.disabled = false;
};

/* ---------- admin: post as another person ---------- */
const TEAM = ['neo', 'ariel', 'justine', 'yuki', 'lemuel'];
async function setupActAs() {
  if (!isAdmin() || !$('tpAsWrap')) return;
  let names = TEAM;
  try { const d = await call('topicUsers'); if (d.users && d.users.length) names = d.users; } catch (_) {}   // older Code.gs: fall back to the team list
  const self = realMe();
  let saved = ''; try { saved = localStorage.getItem('tpActAs') || ''; } catch (_) {}
  actAs = names.includes(saved) ? saved : self;
  $('tpAs').innerHTML = names.map(n => `<option value="${esc(n)}"${n === actAs ? ' selected' : ''}>${esc(cap(n))}${n === self ? ' (me)' : ''}</option>`).join('');
  $('tpAsWrap').hidden = false;
  $('tpAs').onchange = () => { actAs = $('tpAs').value; try { localStorage.setItem('tpActAs', actAs); } catch (_) {} toast('Now posting as ' + cap(actAs) + '.'); };
}

/* ---------- load ---------- */
let first = true;
async function load() {
  if (!CONFIG.portfolio.endpoint) { $('tpState').textContent = "Sync isn't set up yet."; $('tpState').hidden = false; $('tpBoard').hidden = true; return; }
  const saved = first ? cacheGet('topics') : null; first = false;
  const cached = Array.isArray(saved) ? saved : null;
  if (cached) { topics = cached; render(); }
  else { $('tpState').textContent = 'Loading\u2026'; $('tpState').hidden = false; $('tpBoard').hidden = true; }
  try {
    const d = await call('topics');
    topics = d.topics || []; cacheSet('topics', topics); render(); if (openId) renderDetail();
  } catch (err) {
    console.warn('Topics load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    $('tpState').textContent = "Couldn't load the board (offline, wrong secret, or Code.gs needs a new deployment).";
    $('tpState').hidden = false; $('tpBoard').hidden = true;
  }
}
document.querySelectorAll('[data-ttab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('[data-ttab]').forEach(x => x.classList.toggle('active', x === t));
  tab = t.dataset.ttab; render();
});
$('tpSearch').addEventListener('input', () => { query = $('tpSearch').value.trim().toLowerCase(); render(); });
$('tpRefresh').onclick = load;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeForm(); closeDetail(); } });

load();
setupActAs();
})();
