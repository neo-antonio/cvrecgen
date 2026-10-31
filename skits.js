/* ---------- Skits — video ideas to shoot ----------
   Backend: Code.gs skits / saveSkit / skitToVideo / deleteSkit / linkPreview.
   A skit is an idea (no link needed) or a pasted YouTube / Instagram / Facebook / TikTok video, shown with a thumbnail and played in an embed.
   To do -> "Move to video edit" creates a to-do video task in Creatives. When that video is posted (Socials > Planner > Publish) the skit moves to Done by itself. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
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
  /* escape first, then turn http(s) links into tappable anchors */
  function linkify(s) {
    return esc(s).replace(/https?:\/\/(?:(?!&quot;|&lt;|&gt;)[^\s<])+/g, m => {
      const url = m.replace(/[.,:!?)\]]+$/, ''), tail = m.slice(url.length);
      return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
    });
  }

  const PL = { yt: { n: 'YouTube', s: 'YT' }, ig: { n: 'Instagram', s: 'IG' }, fb: { n: 'Facebook', s: 'FB' }, tt: { n: 'TikTok', s: 'TT' } };
  function platOf(u) {
    let h; try { h = new URL(String(u).trim()).hostname.toLowerCase(); } catch (_) { return ''; }
    if (!/^https?:/i.test(String(u).trim())) return '';
    h = h.replace(/^(www|m|mobile|web|vm|vt)\./, '');
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return 'yt';
    if (/(^|\.)instagram\.com$|^instagr\.am$/.test(h)) return 'ig';
    if (/(^|\.)facebook\.com$|^fb\.watch$|^fb\.com$|^fb\.me$/.test(h)) return 'fb';
    if (/(^|\.)tiktok\.com$/.test(h)) return 'tt';
    return '';
  }
  const ytId = u => { const m = String(u).match(/(?:youtu\.be\/|\/shorts\/|\/live\/|\/embed\/|[?&]v=)([\w-]{11})/); return m ? m[1] : ''; };
  const ytThumb = u => { const id = ytId(u); return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : ''; };
  /* a Drive file link (what the server stores for copied thumbnails) -> an image address the page can show */
  const driveThumb = u => { u = String(u || ''); if (/drive\.google\.com\/(?!thumbnail)/.test(u)) { const m = u.match(/[-\w]{25,}/); if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w640'; } return u; };
  const thumbOf = k => driveThumb(k.thumb) || (k.platform === 'yt' ? ytThumb(k.link) : '');
  const ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="M15 10.5l6-3v9l-6-3"/></svg>';

  /* the official player of each site */
  function embed(k, link, embedId) {
    let src = '', cls = '';
    if (k === 'yt') { const id = ytId(link); if (id) { src = 'https://www.youtube-nocookie.com/embed/' + id; cls = /\/shorts\//.test(link) ? ' vid tall' : ' vid wide'; } }
    else if (k === 'ig') { const m = link.match(/instagram\.com\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/i); if (m) { const t = m[1].toLowerCase(); src = 'https://www.instagram.com/' + (t === 'p' ? 'p' : t === 'tv' ? 'tv' : 'reel') + '/' + m[2] + '/embed/'; cls = ' ig'; } }
    else if (k === 'tt') { const id = embedId || (link.match(/\/video\/(\d+)/) || [])[1]; if (id) { src = 'https://www.tiktok.com/embed/v2/' + id; cls = ' tall'; } }
    else if (k === 'fb') {
      const w = Math.max(280, Math.min(500, window.innerWidth - 80)), isVideo = /\/(videos?|reels?|watch)\b|fb\.watch/i.test(link), href = encodeURIComponent(link);
      src = isVideo ? `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=${w}&height=${w}` : `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=${w}`;
      cls = isVideo ? ' vid' : '';
    }
    if (!src) return '<p class="stub-note">This link can\u2019t be shown here. Use Open to watch it.</p>';
    return `<div class="so-embed${cls}"><iframe src="${src}" title="${esc(PL[k].n)} video" loading="lazy" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" frameborder="0" scrolling="no"></iframe></div>`;
  }

  /* ---------------- list ---------------- */
  let list = [], filter = 'todo', loaded = false;
  const find = id => list.find(k => k.id === id);
  const tagOf = k => k.status === 'done' ? { t: k.videoStatus === 'posted' ? 'Posted' : 'Done', c: 'done' }
    : k.status === 'edit' ? { t: 'In video edit', c: 'edit' } : k.link ? { t: 'To do', c: 'todo' } : { t: 'Idea', c: 'idea' };

  function cardHtml(k) {
    const th = thumbOf(k), tag = tagOf(k), p = PL[k.platform];
    return `<div class="sk-card" data-id="${esc(k.id)}">
      <button type="button" class="sk-thumb sk-open" aria-label="Open ${esc(k.title)}">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : ICON_VIDEO}${p ? `<i class="ch ${k.platform} sk-plat">${p.s}</i>` : ''}${k.link ? '<span class="sk-play" aria-hidden="true">&#9654;</span>' : ''}</button>
      <div class="sk-body">
        <b>${esc(k.title)}</b>
        ${k.notes ? `<p>${esc(k.notes)}</p>` : ''}
        <span class="sk-tag ${tag.c}">${tag.t}</span>
        <div class="sk-acts">
          ${k.status === 'todo' ? '<button type="button" class="go sm sk-move">Move to video edit</button>' : ''}
          <button type="button" class="ghost sm sk-open">Open</button>
          <button type="button" class="ghost sm sk-edit">Edit</button>
        </div>
      </div>
    </div>`;
  }
  function render() {
    const todo = list.filter(k => k.status !== 'done').sort((a, b) => (a.status === 'edit') - (b.status === 'edit'));
    const done = list.filter(k => k.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    document.querySelector('#kFilters [data-f=todo]').textContent = `To do (${todo.length})`;
    document.querySelector('#kFilters [data-f=done]').textContent = `Done (${done.length})`;
    const rows = filter === 'todo' ? todo : done;
    $('kCount').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'skit' : 'skits'}` : '';
    if (!rows.length) {
      $('kState').textContent = loaded ? (filter === 'todo' ? 'No skits yet. Tap Add skit to save your first idea or paste a video link.' : 'Nothing done yet. A skit lands here once its video is posted.') : 'Loading\u2026';
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
  let editId = '', prev = null, prevTok = 0, prevP = null, prevTimer = 0, autoTitle = '', origLink = '';
  function renderPrev() {
    const box = $('kPrev');
    if (!prev) { box.hidden = true; box.innerHTML = ''; return; }
    const th = driveThumb(prev.thumb || '');
    box.hidden = false; box.innerHTML = `${th ? `<img src="${esc(th)}" alt="">` : ''}<span>${esc(prev.msg || '')}</span>`;
  }
  async function fetchPreview() {
    const link = $('kLink').value.trim();
    if (!link) { prev = null; renderPrev(); return; }
    const pf = platOf(link);
    if (!pf) { prev = { thumb: '', embedId: '', msg: 'Paste a YouTube, Instagram, Facebook or TikTok link.', bad: true }; renderPrev(); return; }
    const tok = ++prevTok;
    prev = { platform: pf, thumb: pf === 'yt' ? ytThumb(link) : '', embedId: '', msg: PL[pf].n + ' link. Getting the preview\u2026' }; renderPrev();
    try {
      const r = await call('linkPreview', { url: link }, 40000);
      if (tok !== prevTok) return;
      prev.thumb = r.thumb || prev.thumb; prev.embedId = r.embedId || '';
      prev.msg = prev.thumb ? PL[pf].n + ' video found.' : PL[pf].n + ' link saved. No thumbnail was available, but it still plays when you open it.';
      const t = $('kTitle').value.trim();
      if (r.title && (!t || t === autoTitle)) { autoTitle = String(r.title).replace(/\s+/g, ' ').trim().slice(0, 120); $('kTitle').value = autoTitle; }
    } catch (err) { if (tok !== prevTok) return; prev.msg = PL[pf].n + ' link. Could not get a preview (' + backendErr(err) + ').'; }
    renderPrev();
  }
  const schedulePreview = ms => { clearTimeout(prevTimer); prevTimer = setTimeout(() => { prevTimer = 0; prevP = fetchPreview(); }, ms); };
  $('kLink').addEventListener('input', () => {
    const link = $('kLink').value.trim();
    if (link && link === origLink && editId) { const k = find(editId); prev = k ? { platform: k.platform, thumb: thumbOf(k), embedId: k.embedId, msg: (PL[k.platform] || { n: 'Video' }).n + ' video.' } : null; renderPrev(); return; }
    schedulePreview(650);
  });
  $('kLink').addEventListener('paste', () => schedulePreview(60));

  function openForm(k) {
    editId = k ? k.id : ''; autoTitle = ''; origLink = k ? k.link : ''; prevTok++; clearTimeout(prevTimer); prevTimer = 0; prevP = null;
    $('kHeading').textContent = k ? 'Edit skit' : 'Add skit';
    $('kLink').value = k ? k.link : ''; $('kTitle').value = k ? k.title : ''; $('kNotes').value = k ? k.notes : '';
    prev = k && k.link ? { platform: k.platform, thumb: thumbOf(k), embedId: k.embedId, msg: (PL[k.platform] || { n: 'Video' }).n + ' video.' } : null; renderPrev();
    $('kDel').hidden = !k; $('kView').hidden = true; $('kSheet').hidden = false; $('kLink').focus();
  }
  const closeForm = () => { $('kSheet').hidden = true; editId = ''; prevTok++; clearTimeout(prevTimer); };
  $('kAdd').onclick = () => openForm(null);
  $('kCancel').onclick = closeForm;
  $('kSave').onclick = async () => {
    const link = $('kLink').value.trim(), title = $('kTitle').value.trim(), notes = $('kNotes').value.trim();
    if (!title && !link) return toast('Add a title or paste a link.');
    if (link && !platOf(link)) return toast('Paste a YouTube, Instagram, Facebook or TikTok link.');
    const b = $('kSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try {
      if (prevTimer) { clearTimeout(prevTimer); prevTimer = 0; prevP = fetchPreview(); }   // saved before the preview started: get it now
      if (prevP) { try { await prevP; } catch (_) {} }
      const p = { title, link, notes, thumb: link ? ((prev && prev.thumb) || '') : '', embedId: link ? ((prev && prev.embedId) || '') : '' };
      if (editId) p.id = editId;
      await call('saveSkit', p);
      closeForm(); toast('Skit saved.'); await load();
    } catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };

  /* ---------------- one skit ---------------- */
  let viewId = '';
  function openView(k) {
    viewId = k.id; const tag = tagOf(k), p = PL[k.platform];
    $('kvTitle').textContent = k.title;
    $('kvSub').textContent = [p ? p.n : 'Idea', tag.t, k.status === 'edit' ? 'it moves to Done when the video is posted' : ''].filter(Boolean).join(' \u00b7 ');
    $('kvEmbed').innerHTML = k.link ? embed(k.platform, k.link, k.embedId) : '<p class="stub-note" style="text-align:center">An idea for now. Tap Edit to add a video link later.</p>';
    $('kvNotes').hidden = !k.notes; $('kvNotes').innerHTML = k.notes ? `<small>Notes</small>${linkify(k.notes)}` : '';
    $('kvMove').hidden = k.status !== 'todo';
    $('kvDone').hidden = k.status === 'done';
    $('kvReopen').hidden = k.status !== 'done';
    const o = $('kvOpen'); o.hidden = !safeUrl(k.link); if (safeUrl(k.link)) o.href = k.link;
    $('kView').hidden = false;
  }
  const closeView = () => { $('kView').hidden = true; $('kvEmbed').innerHTML = ''; viewId = ''; };
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

  $('kList').addEventListener('click', e => {
    const card = e.target.closest('.sk-card'), k = card && find(card.dataset.id); if (!k) return;
    if (e.target.closest('.sk-move')) return moveToVideo(k, e.target.closest('.sk-move'));
    if (e.target.closest('.sk-edit')) return openForm(k);
    if (e.target.closest('.sk-open')) openView(k);
  });
  ['kSheet', 'kView'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) { if (id === 'kView') closeView(); else closeForm(); } }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('kView').hidden) closeView(); if (!$('kSheet').hidden) closeForm(); } });

  load();
})();
