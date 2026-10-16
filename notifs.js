/* ---------- Account notifications (Home) ----------
   Alerts are assigned per person in the Organization tab (person sheet, "Home alerts"), separate from apps.
   CVNotifs.CATALOG  every assignable alert, grouped for the Organization form
   CVNotifs.load()   fetch assignments;  CVNotifs.keysFor(user)  alerts for a login
   CVNotifs.evaluate(S, user, keys) -> [{id, tone, text, href}];  CVNotifs.render(el, list)  the X hides one until the next session
   CVNotifs.touchFin()  call after the user records a receipt / finance task */
(function () {
  const CATALOG = [
    { group: 'Creatives', items: [
      { key: 'cr_video', label: 'Video task due', hint: 'Due today or tomorrow (red once missed)' },
      { key: 'cr_post', label: 'Post task due', hint: 'Due today or tomorrow (red once missed)' } ] },
    { group: 'Calendar', items: [
      { key: 'cal_event', label: 'Calendar event', hint: 'An event from the Calendar app is today or tomorrow' } ] },
    { group: 'Finance', items: [
      { key: 'fin_new', label: 'New finance record', hint: 'A receipt or finance task was recorded since your last transaction' } ] },
    { group: 'Operations', items: [
      { key: 'ops_due', label: 'Shipping due', hint: 'Scheduled for today or tomorrow' },
      { key: 'ops_done', label: 'Shipping done by someone else', hint: 'Shipped today by another team member (green)' },
      { key: 'ops_missed', label: 'Shipping missed', hint: 'Past its scheduled date and not shipped (red)' } ] }
  ];
  const ALL = CATALOG.reduce((a, g) => a.concat(g.items.map(i => i.key)), []);
  const norm = u => String(u || '').trim().toLowerCase();
  const p2 = n => String(n).padStart(2, '0');
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const dayNum = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
  const away = iso => dayNum(iso) - dayNum(isoToday());   // 0 today, 1 tomorrow, <0 missed
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const cg = k => { try { return typeof cacheGet === 'function' ? cacheGet(k) : null; } catch (_) { return null; } };
  const cs = (k, v) => { try { if (typeof cacheSet === 'function') cacheSet(k, v); } catch (_) {} };
  const api = (a, p) => CONFIG.portfolio.endpoint + '?action=' + a + Object.keys(p || {}).map(k => '&' + k + '=' + encodeURIComponent(p[k])).join('') + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const canSync = () => typeof CONFIG !== 'undefined' && CONFIG.portfolio && CONFIG.portfolio.endpoint && typeof jsonp === 'function';

  /* Alerts are stored on each person in the Organization tab (Code.gs: Organization column I).
     A login (neo, ariel...) belongs to the person whose name is that login or starts with it, e.g. "Ariel Cruz". */
  let people = cg('notifPeople') || [];
  async function load() {
    if (!canSync()) return people;
    try {
      const d = await jsonp(api('organization'));
      if (d && d.ok) {
        people = (d.items || []).filter(i => i.kind === 'person').map(i => ({ title: i.title, keys: i.notifs || [] }));
        cs('notifPeople', people);
      }
    } catch (e) { console.warn('Notification assignments failed to load', e); }
    return people;
  }
  const keysFor = user => {
    const u = norm(user), out = new Set();
    people.forEach(p => { const t = norm(p.title); if (u && (t === u || t.split(/\s+/)[0] === u)) (p.keys || []).forEach(k => ALL.includes(k) && out.add(k)); });
    return [...out];
  };

  /* ---- Finance: "new since your last transaction" is tracked by record id on this device ---- */
  const seenKey = u => 'cv:finSeen:' + norm(u), rebaseKey = u => 'cv:finRebase:' + norm(u);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };
  function touchFin() { lsSet(rebaseKey((window.CVAuth && CVAuth.user()) || ''), '1'); try { if (window.CVShell) CVShell.setBadge('finance', 0); } catch (_) {} }
  function newFinCount(user, S) {
    if (!S.fin || !S.rc || !S.freshFin || !S.freshRc) return null;   // only judge fresh server data, never the cached copy
    const rIds = (S.rc.receipts || []).map(r => 'r:' + r.id);
    const fIds = (S.fin.toRecord || []).concat(S.fin.recorded || []).map(t => 'f:' + t.id);
    const ids = rIds.concat(fIds);
    let seen = null; try { seen = JSON.parse(lsGet(seenKey(user)) || 'null'); } catch (_) {}
    if (!Array.isArray(seen) || lsGet(rebaseKey(user))) { lsSet(seenKey(user), JSON.stringify(ids)); lsDel(rebaseKey(user)); return { r: 0, f: 0 }; }
    const set = new Set(seen);
    return { r: rIds.filter(i => !set.has(i)).length, f: fIds.filter(i => !set.has(i)).length };
  }

  /* ---- Turn the data Home already has into notices ---- */
  function dueText(today, tomorrow, noun) {
    const parts = [];
    if (today) parts.push(`${pl(today, noun)} due today`);
    if (tomorrow) parts.push(`${tomorrow} due tomorrow`);
    return parts.join(', ');
  }
  function bucket(list, dateOf) {
    const b = { today: 0, tomorrow: 0, missed: 0 };
    list.forEach(x => { const d = dateOf(x); if (!d) return; const n = away(d); if (n < 0) b.missed++; else if (n === 0) b.today++; else if (n === 1) b.tomorrow++; });
    return b;
  }
  // like bucket(), but keeps the task titles so the notice can say which tasks
  const bucketT = (list, dateOf, titleOf) => {
    const b = { today: [], tomorrow: [], missed: [] };
    list.forEach(x => {
      const d = dateOf(x); if (!d) return;
      const n = away(d), t = String(titleOf(x) || '').trim() || 'Untitled';
      if (n < 0) b.missed.push(t); else if (n === 0) b.today.push(t); else if (n === 1) b.tomorrow.push(t);
    });
    return b;
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const names = arr => { const q = arr.map(t => '\u201c' + (t.length > 40 ? t.slice(0, 39) + '\u2026' : t) + '\u201d'); return q.length > 2 ? q.slice(0, 2).join(', ') + ` +${q.length - 2} more` : q.join(', '); };
  const clock = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
  // an event with its time when it has one: \u201cCard show\u201d at 2:30 PM
  const evLabel = e => { const t = String(e.title || '').trim() || 'Untitled', q = '\u201c' + (t.length > 40 ? t.slice(0, 39) + '\u2026' : t) + '\u201d', c = clock(e.time); return c ? `${q} at ${c}` : q; };
  const evNames = arr => arr.length > 2 ? arr.slice(0, 2).map(evLabel).join(', ') + ` +${arr.length - 2} more` : arr.map(evLabel).join(', ');
  const groupsOf = list => { const m = new Map(); (list || []).forEach(i => { const k = i.groupKey || ('c:' + i.id); if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return [...m.values()]; };

  function evaluate(S, user, keys) {
    const on = new Set(keys), out = [], u = norm(user);
    const add = (id, tone, text, href) => out.push({ id, tone, text, href });
    const d10 = v => String(v || '').slice(0, 10);

    if (S.cr) {
      [['cr_video', (S.cr.videos || []).filter(x => (x.status || 'todo') === 'todo'), x => d10(x.date), x => x.title, 'video task'],
       ['cr_post', (S.cr.posts || []).filter(x => x.status === 'toedit'), x => d10(x.scheduled), x => x.label || x.title, 'post task']].forEach(([k, list, f, t, noun]) => {
        if (!on.has(k)) return;
        const b = bucketT(list, f, t);
        if (b.missed.length) add(k + ':missed', 'red', `${b.missed.length === 1 ? cap(noun) + ' missed its due date' : pl(b.missed.length, noun) + ' missed their due dates'}: ${names(b.missed)}`, 'creatives.html');
        if (b.today.length || b.tomorrow.length) {
          const parts = [];
          if (b.today.length) parts.push(`${cap(pl(b.today.length, noun))} due today: ${names(b.today)}`);
          if (b.tomorrow.length) parts.push(`${parts.length ? b.tomorrow.length : cap(pl(b.tomorrow.length, noun))} due tomorrow: ${names(b.tomorrow)}`);
          add(k + ':due', 'orange', parts.join(' \u00b7 '), 'creatives.html');
        }
      });
    }
    if (S.ship) {
      const q = groupsOf(S.ship.toShip), b = bucket(q, g => d10(g[0].scheduledDate));
      if (on.has('ops_missed') && b.missed) add('ops_missed', 'red', `${pl(b.missed, 'shipment')} missed ${b.missed === 1 ? 'its' : 'their'} scheduled date`, 'shipping.html');
      if (on.has('ops_due') && (b.today || b.tomorrow)) add('ops_due', 'orange', dueText(b.today, b.tomorrow, 'shipment'), 'shipping.html');
      if (on.has('ops_done')) {
        const today = isoToday(), by = new Set();
        let n = 0;
        groupsOf(S.ship.shipped).forEach(g => {
          const f = g[0], who = String(f.shippedBy || '').trim();
          if (d10(f.shippedDate) !== today || !who || norm(who) === u) return;   // unknown or your own: no alert
          n++; by.add(who);
        });
        if (n) add('ops_done', 'green', `${pl(n, 'shipment')} shipped today by ${[...by].join(', ')}`, 'shipping.html');
      }
    }
    if (S.ev && on.has('cal_event')) {
      // events from the Calendar app, shown the day of and the day before; they vanish by themselves once the date has passed
      const byTime = (a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99'));
      const evs = (S.ev.events || []).filter(e => d10(e.date)), todayE = evs.filter(e => away(d10(e.date)) === 0).sort(byTime), tomE = evs.filter(e => away(d10(e.date)) === 1).sort(byTime);
      if (todayE.length || tomE.length) {
        const parts = [];
        if (todayE.length) parts.push(`${todayE.length === 1 ? 'Event' : pl(todayE.length, 'event')} today: ${evNames(todayE)}`);
        if (tomE.length) parts.push(`${todayE.length ? (tomE.length === 1 ? 'Event' : pl(tomE.length, 'event')) : (tomE.length === 1 ? 'Event' : pl(tomE.length, 'event'))} tomorrow: ${evNames(tomE)}`);
        add('cal_event', 'orange', parts.join(' \u00b7 '), 'calendar.html');
      }
    }
    if (on.has('fin_new')) {
      const c = newFinCount(user, S);
      if (c && (c.r || c.f)) {
        const parts = [];
        if (c.r) parts.push(pl(c.r, 'new receipt'));
        if (c.f) parts.push(pl(c.f, 'new finance record'));
        add('fin_new', 'orange', parts.join(' and ') + ' since your last transaction', 'finance.html');
      }
    }
    return out;
  }

  /* ---- Drawing ---- */
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
  const XICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Only "done" notices (shipment done by someone else) and finance notices can be dismissed.
  // Due / missed notices stay until the task is shipped, completed or rescheduled; they then vanish by themselves because they are recalculated from live data.
  const canDismiss = n => n.tone === 'green' || n.id === 'fin_new';
  const DKEY = 'cv:notifDismissed';   // sessionStorage: gone for this session, back in the next one
  const dismissed = () => { try { return new Set(JSON.parse(sessionStorage.getItem(DKEY) || '[]')); } catch (_) { return new Set(); } };
  function dismiss(id) { const s = dismissed(); s.add(id); try { sessionStorage.setItem(DKEY, JSON.stringify([...s])); } catch (_) {} }
  function render(el, list) {
    const hide = dismissed(), show = list.filter(n => !(canDismiss(n) && hide.has(n.id)));
    el.innerHTML = show.map(n => `<div class="nt nt-${n.tone}${canDismiss(n) ? '' : ' nt-lock'}" role="status" data-id="${esc(n.id)}"><a class="nt-body" href="${esc(n.href)}">${BELL}<span>${esc(n.text)}</span></a>${canDismiss(n) ? `<button type="button" class="nt-x" aria-label="Dismiss until next session">${XICON}</button>` : ''}</div>`).join('');
    el.hidden = !show.length;
    el.onclick = e => { const x = e.target.closest('.nt-x'); if (!x) return; const row = x.closest('.nt'); dismiss(row.dataset.id); row.remove(); el.hidden = !el.children.length; };
  }

  window.CVNotifs = { CATALOG, load, keysFor, evaluate, render, touchFin };
})();
