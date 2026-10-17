/* ---------- Topic Board — meeting topics, comments and conclusions, from the Topics sheet (Code.gs: topics, saveTopic, addTopicComment, resolveTopic, reopenTopic, deleteTopic) ----------
   Every note, comment and conclusion records the logged-in person (CVAuth, shell.js); the date and time are stamped by the server. */
(function () {
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = n => { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); };
const me = () => (window.CVAuth && CVAuth.user()) || '';
const isAdmin = () => !!(window.CVAuth && CVAuth.isAdmin());

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
/* ---------- links, images and videos pasted into text ----------
   Any http(s) link in a topic, comment or conclusion becomes a tappable link. Image links show the picture, YouTube / Vimeo /
   Google Drive links show a player, and direct video files (.mp4 etc.) play inline. Nothing extra is stored: it is all read from the text. */
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
function classify(raw) {
  let u; try { u = new URL(raw); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^(www|m)\./, ''), p = u.pathname; let id = '', m;
  if (h === 'youtu.be') id = p.slice(1).split('/')[0];
  else if (h === 'youtube.com' || h === 'music.youtube.com') id = u.searchParams.get('v') || ((p.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1]) || '';
  if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'frame', src: 'https://www.youtube-nocookie.com/embed/' + id, ratio: '16/9', thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
  if (h === 'vimeo.com' && (m = p.match(/^\/(?:video\/)?(\d{5,})/))) return { kind: 'frame', src: 'https://player.vimeo.com/video/' + m[1], ratio: '16/9' };
  if (h === 'drive.google.com' && (m = p.match(/\/file\/d\/([\w-]{10,})/) || (u.searchParams.get('id') || '').match(/^([\w-]{10,})$/)))
    return { kind: 'frame', src: 'https://drive.google.com/file/d/' + m[1] + '/preview', ratio: '4/3', thumb: 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w600' };
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(p)) return { kind: 'video', src: u.href };
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(p)) return { kind: 'image', src: u.href, thumb: u.href };
  return { kind: 'link' };
}
function shortUrl(raw) {
  try { const u = new URL(raw), t = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : ''); return t.length > 38 ? t.slice(0, 37) + '\u2026' : t; } catch (_) { return raw; }
}
function embedHtml(e) {
  if (e.kind === 'image') return `<a href="${esc(e.src)}" target="_blank" rel="noopener noreferrer"><img class="tp-img" src="${esc(e.src)}" alt="Attached image" loading="lazy" referrerpolicy="no-referrer"></a>`;
  if (e.kind === 'video') return `<video class="tp-vid" src="${esc(e.src)}" controls preload="metadata" playsinline></video>`;
  return `<div class="tp-frame" style="aspect-ratio:${e.ratio}"><iframe src="${esc(e.src)}" title="Embedded video" loading="lazy" allowfullscreen allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>`;
}
// -> { text: safe HTML with tappable links, embeds: safe HTML with the pictures / players, media: [..] }
function rich(src) {
  const s = String(src == null ? '' : src), media = []; let text = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s))) {
    const trail = (m[0].match(/[.,;:!?)\]]+$/) || [''])[0], url = m[0].slice(0, m[0].length - trail.length);
    text += esc(s.slice(last, m.index));
    const c = classify(url);
    if (c) {
      text += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(shortUrl(url))}</a>`;
      if (c.kind !== 'link' && !media.some(x => x.src === c.src)) media.push(c);
    } else text += esc(url);
    text += esc(trail); last = m.index + m[0].length;
  }
  text += esc(s.slice(last));
  return { text, media, embeds: media.length ? `<div class="tp-embeds">${media.map(embedHtml).join('')}</div>` : '' };
}
// board notes show plain text only: each link is shortened to its address, and the first picture becomes a thumbnail
const plain = s => String(s || '').replace(URL_RE, u => shortUrl(u.replace(/[.,;:!?)\]]+$/, '')));
const thumbOf = t => { for (const s of [t.body, t.conclusion].concat(t.comments.map(c => c.text))) { const e = rich(s).media.find(x => x.thumb); if (e) return e.thumb; } return ''; };
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const mine = t => isAdmin() || String(t.by).toLowerCase() === me();

function toast(m) {
  const t = $('tpToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3000);
}

async function call(action, params) {
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
  const th = thumbOf(t);
  return `<button type="button" class="tp-note ${colour(t.by)}" data-id="${esc(t.id)}">
      ${th ? `<img class="tp-thumb" src="${esc(th)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
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
    ? t.comments.map(c => { const r = rich(c.text); return `<div class="tp-cm ${colour(c.by)}"><div class="tp-cm-h"><b>${esc(cap(c.by))}</b><small>${esc(stamp(c.at))}</small></div><p>${r.text}</p>${r.embeds}</div>`; }).join('')
    : '<p class="tp-none">No comments yet.</p>';
  const isOpen = t.status === 'open', rb = rich(t.body), rc = rich(t.conclusion);
  $('tpViewBody').innerHTML = `
    <span class="tp-state ${t.status}">${isOpen ? 'Open' : 'Resolved'}</span>
    <h3>${esc(t.title)}</h3>
    <p class="tp-by">Added by <b>${esc(cap(t.by))}</b> \u00b7 ${esc(stamp(t.at))}</p>
    ${t.body ? `<div class="tp-bodywrap"><p class="tp-body">${rb.text}</p>${rb.embeds}</div>` : ''}
    ${isOpen ? '' : `<div class="tp-concl"><small>Conclusion by <b>${esc(cap(t.concludedBy))}</b> \u00b7 ${esc(stamp(t.concludedAt))}</small><p>${rc.text}</p>${rc.embeds}</div>`}
    <h4 class="tp-sec">Comments (${t.comments.length})</h4>
    <div class="tp-cms">${comments}</div>
    <div class="tp-add">
      <textarea id="tpCmText" rows="2" maxlength="800" placeholder="${isOpen ? 'Add a comment, e.g. a note for next time' : 'Add a comment'}">${esc(keepComment)}</textarea>
      <p class="tp-hint">Paste an image, video or web link and it shows up here.</p>
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
  if (act === 'edit') return openForm(t);
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
const closeForm = () => { $('tpForm').hidden = true; editId = null; };
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
document.addEventListener('error', e => {
  const i = e.target;
  if (!i || i.tagName !== 'IMG') return;
  if (i.classList.contains('tp-thumb')) i.hidden = true;
  else if (i.classList.contains('tp-img')) { const a = i.closest('a'); if (a) { a.className = 'tp-broken'; a.textContent = 'Image could not load. Open the link.'; } }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeForm(); closeDetail(); } });

load();
})();
