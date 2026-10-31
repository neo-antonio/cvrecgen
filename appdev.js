/* App Dev (Tech): team feature / bug requests, the admin's build queue, and what has shipped.
   Backend: Code.gs tickets / saveTicket / setTicketStatus / deleteTicket (Tickets tab).
   Version history lives in the footer (shell.js) and the "Version history" button here opens the same popup. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = n => { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); };
  const me = (window.CVAuth && CVAuth.user()) || '';
  const admin = !!(window.CVAuth && CVAuth.isAdmin());
  const KEY = 'cv:tickets';

  let people = [];   // team logins, for the admin's "Request as" picker
  let tickets = [], tab = 'requests', editId = '', actId = '', actKind = '', formType = 'feature', busy = false;
  try { const c = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(c)) tickets = c; } catch (_) {}

  const TABS = {
    requests: t => t.status === 'pending',
    queue: t => t.status === 'building',
    closed: t => t.status === 'done' || t.status === 'declined'
  };
  const EMPTY = {
    requests: 'No open requests. Use New request to suggest a feature or report a bug.',
    queue: 'Nothing is being built right now.',
    closed: 'Nothing has been completed or declined yet.'
  };
  const PLACEHOLDER = {
    feature: 'What should it do, and how would it help?',
    bug: 'What happened, what did you expect, and on which page?'
  };
  const STATE = { pending: 'Requested', building: 'Building', done: 'Done', declined: 'Declined' };

  // ---------- backend (JSONP, same pattern as the other pages) ----------
  function call(action, params) {
    return new Promise((resolve, reject) => {
      if (typeof CONFIG === 'undefined' || !CONFIG.portfolio || !CONFIG.portfolio.endpoint) return reject(new Error('Sync is not set up (config.js is not loaded).'));
      const cb = 'cvAd_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), sc = document.createElement('script');
      let done = false, timer;
      const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); delete window[cb]; sc.remove(); fn(v); };
      timer = setTimeout(() => end(reject, new Error('The server took too long to answer. Try again.')), 25000);
      window[cb] = d => end(resolve, d);
      sc.onerror = () => end(reject, new Error('Could not reach the server. Check your connection.'));
      sc.src = CONFIG.portfolio.endpoint + '?action=' + action + Object.keys(params || {}).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
        + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret) + '&callback=' + cb;
      document.head.appendChild(sc);
    });
  }
  const check = d => {
    if (d && d.ok) return d;
    const e = d && d.error;
    throw new Error(e === 'unknown action' ? 'App Dev is not set up on the server yet. Deploy the updated Code.gs first.' : e === 'unauthorized' ? 'The app secret does not match the server.' : (e || 'Something went wrong.'));
  };

  // ---------- helpers ----------
  const fmt = s => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  };
  const vlabel = v => { v = String(v || '').trim(); return /^\d/.test(v) ? 'v' + v : v; };
  let toastTimer;
  const toast = msg => { const t = $('adToast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); };
  const setBusy = on => { busy = on; ['adSave', 'adActGo'].forEach(id => { $(id).disabled = on; }); };

  // ---------- render ----------
  function actions(t) {
    const mine = t.by === me, b = [];
    const btn = (a, label, cls) => '<button type="button" class="ghost sm ' + (cls || '') + '" data-act="' + a + '" data-id="' + esc(t.id) + '">' + label + '</button>';
    if (admin) {
      if (t.status === 'pending') b.push(btn('accept', 'Accept'), btn('decline', 'Decline'));
      if (t.status === 'building') b.push(btn('done', 'Mark done'), btn('back', 'Back to requests'));
      if (t.status === 'done' || t.status === 'declined') b.push(btn('back', 'Reopen'));
    }
    if (admin || (mine && t.status === 'pending')) b.push(btn('edit', 'Edit'), btn('delete', 'Delete', 'danger'));
    return b.length ? '<div class="ad-acts">' + b.join('') + '</div>' : '';
  }

  function card(t, i) {
    let meta = '<span>by <b>' + esc(cap(t.by)) + '</b></span><span>' + esc(fmt(t.at)) + '</span>';
    if (t.status === 'building' && t.acceptedAt) meta += '<span>Accepted ' + esc(fmt(t.acceptedAt)) + '</span>';
    if (t.status === 'done') meta += (t.doneAt ? '<span>Done ' + esc(fmt(t.doneAt)) + '</span>' : '') + (t.version ? '<span>Shipped in <b>' + esc(vlabel(t.version)) + '</b></span>' : '');
    const note = t.note ? '<div class="ad-note"><small>' + (t.status === 'declined' ? 'Why not' : 'What was done') + '</small>' + esc(t.note) + '</div>' : '';
    const pos = tab === 'queue' ? '<i class="ad-pos">#' + (i + 1) + '</i>' : '';
    return '<article class="ad-card ' + t.type + '"><div class="ad-head">' + pos
      + '<span class="ad-pill ' + t.type + '">' + (t.type === 'bug' ? 'Bug' : 'Feature') + '</span>'
      + (tab === 'closed' ? '<span class="ad-pill ' + t.status + '">' + STATE[t.status] + '</span>' : '') + '</div>'
      + '<b class="ad-t">' + esc(t.title) + '</b>'
      + (t.body ? '<p class="ad-body">' + esc(t.body) + '</p>' : '')
      + '<div class="ad-meta">' + meta + '</div>' + note + actions(t) + '</article>';
  }

  function paint() {
    document.querySelectorAll('.tab[data-tab]').forEach(b => {
      const on = b.dataset.tab === tab, n = tickets.filter(TABS[b.dataset.tab]).length;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.querySelector('i').textContent = n ? n : '';
    });
    const list = tickets.filter(TABS[tab]);
    if (tab === 'queue') list.sort((a, b) => String(a.acceptedAt).localeCompare(String(b.acceptedAt)));        // oldest accepted first = next to build
    if (tab === 'closed') list.sort((a, b) => String(b.doneAt || b.updatedAt).localeCompare(String(a.doneAt || a.updatedAt)));
    $('adList').innerHTML = list.length ? list.map(card).join('') : '<p class="stub-note ad-empty">' + EMPTY[tab] + '</p>';
    if (admin && window.CVShell) CVShell.setBadge('appdev', tickets.filter(TABS.requests).length);
  }

  function apply(list) {
    tickets = Array.isArray(list) ? list : [];
    try { localStorage.setItem(KEY, JSON.stringify(tickets)); } catch (_) {}
    paint();
  }

  function load() {
    const b = $('adRefresh'); b.disabled = true; b.textContent = 'Refreshing\u2026';
    return call('tickets').then(check).then(d => { $('adLoadErr').hidden = true; apply(d.tickets); })
      .catch(e => { $('adLoadErr').textContent = e.message; $('adLoadErr').hidden = false; })
      .then(() => { b.disabled = false; b.textContent = 'Refresh'; });
  }

  // ---------- new / edit request ----------
  const setType = t => {
    formType = t === 'bug' ? 'bug' : 'feature';
    document.querySelectorAll('.ad-types .chip').forEach(c => c.classList.toggle('active', c.dataset.type === formType));
    $('adBody').placeholder = PLACEHOLDER[formType];
  };
  // admin only: who a NEW request is sent as (defaults to yourself)
  function fillAs() {
    const names = people.length ? people : [me];
    $('adAs').innerHTML = names.map(n => '<option value="' + esc(n) + '"' + (n === me ? ' selected' : '') + '>' + esc(cap(n)) + (n === me ? ' (you)' : '') + '</option>').join('');
  }
  function loadPeople() {
    if (!admin || people.length) return;
    call('topicUsers').then(check).then(d => { people = (d.users || []).filter(Boolean); if (me && people.indexOf(me) < 0) people.unshift(me); fillAs(); }).catch(() => {});
  }
  function openSheet(t) {
    editId = t ? t.id : '';
    $('adAsWrap').hidden = !(admin && !t);
    if (admin && !t) { fillAs(); loadPeople(); }
    $('adSheetH').textContent = t ? 'Edit request' : 'New request';
    $('adSave').textContent = t ? 'Save changes' : 'Send request';
    $('adTitle').value = t ? t.title : ''; $('adBody').value = t ? t.body : '';
    $('adSheetErr').hidden = true; setType(t ? t.type : 'feature');
    $('adSheet').hidden = false; $('adTitle').focus();
  }
  const closeSheet = () => { $('adSheet').hidden = true; };
  function saveSheet() {
    if (busy) return;
    const title = $('adTitle').value.trim();
    if (!title) { $('adSheetErr').textContent = 'Add a short title.'; $('adSheetErr').hidden = false; return; }
    $('adSheetErr').hidden = true; setBusy(true);
    const extra = admin && !editId && $('adAs').value && $('adAs').value !== me ? { forUser: $('adAs').value } : {};
    call('saveTicket', Object.assign({ by: me, ticketId: editId, type: formType, title, body: $('adBody').value.trim() }, extra)).then(check).then(d => {
      setBusy(false); closeSheet(); apply(d.tickets);
      if (!editId) { tab = 'requests'; paint(); }
      toast(editId ? 'Request updated' : (extra.forUser ? 'Request sent as ' + cap(extra.forUser) : 'Request sent'));
    }).catch(e => { setBusy(false); $('adSheetErr').textContent = e.message; $('adSheetErr').hidden = false; });
  }

  // ---------- status changes (admin) ----------
  function setStatus(id, status, extra, msg) {
    if (busy) return Promise.resolve();
    setBusy(true);
    return call('setTicketStatus', Object.assign({ by: me, ticketId: id, status }, extra || {})).then(check).then(d => {
      setBusy(false); apply(d.tickets); toast(msg);
      return true;
    }).catch(e => { setBusy(false); toast(e.message); return false; });
  }
  function openAct(kind, id) {
    const t = tickets.filter(x => x.id === id)[0]; if (!t) return;
    actKind = kind; actId = id;
    $('adActH').textContent = kind === 'done' ? 'Mark as done' : 'Decline request';
    $('adActT').textContent = t.title;
    $('adVerField').hidden = kind !== 'done'; $('adVer').value = '';
    $('adNoteL').textContent = kind === 'done' ? 'What was done (optional)' : 'Reason (optional)';
    $('adNote').value = ''; $('adActErr').hidden = true;
    $('adActGo').textContent = kind === 'done' ? 'Mark done' : 'Decline';
    $('adAct').hidden = false; (kind === 'done' ? $('adVer') : $('adNote')).focus();
  }
  const closeAct = () => { $('adAct').hidden = true; };

  // ---------- events ----------
  document.querySelectorAll('.tab[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
  $('adNew').addEventListener('click', () => openSheet(null));
  $('adRefresh').addEventListener('click', load);
  $('adVers').addEventListener('click', () => { if (window.CVShell && CVShell.openVersions) CVShell.openVersions(); });
  document.querySelectorAll('.ad-types .chip').forEach(c => c.addEventListener('click', () => setType(c.dataset.type)));
  $('adSave').addEventListener('click', saveSheet);
  $('adCancel').addEventListener('click', closeSheet);
  $('adSheet').addEventListener('click', e => { if (e.target === $('adSheet')) closeSheet(); });
  $('adActCancel').addEventListener('click', closeAct);
  $('adAct').addEventListener('click', e => { if (e.target === $('adAct')) closeAct(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); closeAct(); } });
  $('adActGo').addEventListener('click', () => {
    const kind = actKind, id = actId;
    const extra = { note: $('adNote').value.trim() };
    if (kind === 'done') extra.version = $('adVer').value.trim();
    setStatus(id, kind === 'done' ? 'done' : 'declined', extra, kind === 'done' ? 'Marked as done' : 'Request declined').then(ok => { if (ok) closeAct(); });
  });
  $('adList').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, t = tickets.filter(x => x.id === id)[0]; if (!t) return;
    switch (b.dataset.act) {
      case 'accept': setStatus(id, 'building', null, 'Accepted: added to the build queue'); break;
      case 'back': setStatus(id, 'pending', null, 'Moved back to requests'); break;
      case 'decline': openAct('declined', id); break;
      case 'done': openAct('done', id); break;
      case 'edit': openSheet(t); break;
      case 'delete':
        if (busy || !confirm('Delete this request?\n\n' + t.title)) break;
        setBusy(true);
        call('deleteTicket', { by: me, ticketId: id }).then(check).then(d => { setBusy(false); apply(d.tickets); toast('Request deleted'); })
          .catch(err => { setBusy(false); toast(err.message); });
        break;
    }
  });

  if (!admin) $('adHint').textContent = 'Send a feature idea or a bug. ' + cap('neo') + ' reviews each request, and accepted ones move to the build queue.';
  paint();
  load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
