/* ---------- Home widgets ----------
   Widgets are assigned per person in the Organization tab (person sheet, "Home widgets"). They are stored in the same
   Organization column as the old Home alerts (Notifs), so Code.gs needs no change for that.
   CVWidgets.CATALOG            every assignable widget, grouped for the Organization form
   CVWidgets.load()             fetch people + goals from Organization
   CVWidgets.keysFor(user)      widget keys for a login (a login is the person whose name is that login or starts with it)
   CVWidgets.render(el, S, user, keys, ctx)   draws the assigned widgets into el, returns how many were drawn
   S is the data Home already holds: port (cards), cr (creatives), fin, freshFin, cm (commercial price log), acct (account totals) */
(function () {
  const CATALOG = [
    { group: 'Goals', items: [
      { key: 'goals', label: 'Goals progress', hint: 'A progress bar for every goal in the Goals tab' } ] },
    { group: 'Commercial', items: [
      { key: 'cm_missing', label: 'Cards without a price', hint: 'Onhand cards that have no target price yet' },
      { key: 'cm_history', label: 'Price edits', hint: 'Target prices changed today and this week, with the latest changes' } ] },
    { group: 'Creatives', items: [
      { key: 'video_edit', label: 'Videos to edit', hint: 'Pending videos with title, due date and how many are due today' },
      { key: 'post_edit', label: 'Posts to edit', hint: 'Pending posts with title, due date and how many are due today' } ] },
    { group: 'Finance', items: [
      { key: 'fin_recent', label: 'Recent transactions', hint: 'The last 5 transactions, and which ones are new since you last looked' } ] },
    { group: 'Pinned notification', items: [
      { key: 'ops_due', label: 'Shipping due today', hint: 'A pinned notice at the top of Home while shipments are scheduled for today' } ] }
  ];
  const ALL = CATALOG.reduce((a, g) => a.concat(g.items.map(i => i.key)), []);
  const ORDER = ALL.filter(k => k !== 'ops_due');   // ops_due is a notification, not a card

  const norm = u => String(u || '').trim().toLowerCase();
  const p2 = n => String(n).padStart(2, '0');
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const dayNum = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
  const away = iso => dayNum(iso) - dayNum(isoToday());   // 0 today, 1 tomorrow, <0 overdue
  const d10 = v => String(v || '').slice(0, 10);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const php = n => (n < 0 ? '-' : '') + 'PHP ' + Math.abs(Math.round(n)).toLocaleString('en-PH');
  const phpC = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const dayLbl = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  const clock = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const cg = k => { try { return typeof cacheGet === 'function' ? cacheGet(k) : null; } catch (_) { return null; } };
  const cs = (k, v) => { try { if (typeof cacheSet === 'function') cacheSet(k, v); } catch (_) {} };
  const api = a => CONFIG.portfolio.endpoint + '?action=' + a + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const canSync = () => typeof CONFIG !== 'undefined' && CONFIG.portfolio && CONFIG.portfolio.endpoint && typeof jsonp === 'function';


  /* ---- shared money maths (Goals tab, Home widgets and the Finance cash reserves calculator all use these) ---- */
  const PR_MARK = '[[PR1]]';
  const r2 = x => Math.round(x * 100) / 100;
  const isPR = t => String((t && t.notes) || '').indexOf(PR_MARK) === 0;
  // open receivables / payables: Finance tasks whose notes carry the marker + a JSON record (same as the Finance page)
  function prTotals(tasks) {
    let pay = 0, rec = 0;
    (tasks || []).forEach(t => {
      if (!isPR(t)) return;
      try { const o = JSON.parse(String(t.notes).slice(PR_MARK.length)); if (!o || o.status === 'settled') return; const a = Number(o.amount) || 0; if (o.kind === 'payable') pay += a; else if (o.kind === 'receivable') rec += a; } catch (_) {}
    });
    return { pay: r2(pay), rec: r2(rec) };
  }
  // Net profit between lo and hi (either may be blank) =
  //   sale price - purchase cost of every PAID card sale dated in the period (tags sold, shipping, safekeep; pending sales are unpaid)
  //   + packaging and buyer-paid shipping received - shipping we paid (sales and purchases).
  // A receivable (a customer who paid in full on the receipt and was then lent money, or who still owes) never reduces profit:
  // the sale is already counted at its full price, and the loan is a separate Finance task that is skipped here.
  function netProfit(cards, tasks, lo, hi) {
    if (lo && hi && lo > hi) { const t = lo; lo = hi; hi = t; }
    const inRange = v => { const d = d10(v); return !!d && (!lo || d >= lo) && (!hi || d <= hi); };
    let rev = 0, cost = 0, n = 0, fees = 0, ship = 0;
    (cards || []).forEach(c => {
      if (!['sold', 'shipping', 'safekeep'].includes(c.tag) || !inRange(c.soldDate)) return;
      rev += Number(c.soldPrice) || 0; cost += Number(c.purchaseCost) || 0; n++;
    });
    (tasks || []).forEach(t => {
      if (isPR(t) || !inRange(t.date)) return;
      const amt = Number(t.amount) || 0, desc = String(t.description || '');
      if (t.type === 'sale' && t.flow === 'inflow' && /^(Packaging|Shipping paid by buyer):/.test(desc)) fees += amt;
      else if (t.type === 'shipping' && t.flow === 'outflow') ship += amt;
      else if (t.type === 'purchase' && t.flow === 'outflow' && /^Shipping:/.test(desc)) ship += amt;
    });
    return { n, rev: r2(rev), cost: r2(cost), fees: r2(fees), ship: r2(ship), net: r2(rev - cost + fees - ship) };
  }

  /* ---- who has which widgets, and the goals (both live in the Organization sheet) ---- */
  let org = cg('org') || [];
  async function load() {
    if (!canSync()) return org;
    try {
      const d = await jsonp(api('organization'));
      if (d && d.ok) { org = d.items || []; cs('org', org); }
    } catch (e) { console.warn('Widget assignments failed to load', e); }
    return org;
  }
  const keysFor = user => {
    const u = norm(user), out = new Set();
    org.forEach(p => {
      if (p.kind !== 'person') return;
      const t = norm(p.title);
      if (u && (t === u || t.split(/\s+/)[0] === u)) (p.notifs || []).forEach(k => ALL.includes(k) && out.add(k));   // old alert keys are ignored
    });
    return [...out];
  };

  /* ---- Finance: "new" = not on your list the last time Home loaded fresh data (this session adds to it) ----
     The Receipt page sets the rebase flag after you record something yourself, so your own records are never "new". */
  const seenKey = u => 'cv:finSeen:' + norm(u), rebaseKey = u => 'cv:finRebase:' + norm(u);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };
  let seen = null; const sessionNew = new Set();
  function trackNew(user, ids) {
    if (!seen) { try { const a = JSON.parse(lsGet(seenKey(user)) || 'null'); if (Array.isArray(a)) seen = new Set(a); } catch (_) {} }
    if (!seen || lsGet(rebaseKey(user))) { seen = new Set(ids); lsDel(rebaseKey(user)); lsSet(seenKey(user), JSON.stringify([...seen])); return; }
    let grew = false;
    ids.forEach(i => { if (!seen.has(i)) { sessionNew.add(i); seen.add(i); grew = true; } });
    if (grew) lsSet(seenKey(user), JSON.stringify([...seen]));
  }

  /* ---- shared pieces ---- */
  const dueLbl = iso => {
    if (!iso) return '<em>No date</em>';
    const n = away(iso);
    return n < 0 ? `<em class="late">${-n}d overdue</em>` : n === 0 ? '<em class="today">Today</em>' : n === 1 ? '<em>Tomorrow</em>' : `<em>${esc(dayLbl(iso))}</em>`;
  };
  const shell = (cls, href, title, count, sub, body) =>
    `<a class="wg ${cls || ''}" href="${href}"><div class="wg-h"><span class="hs-l">${esc(title)}</span>${count == null ? '' : `<b class="wg-n">${count}</b>`}</div>${sub ? `<div class="wg-sub">${sub}</div>` : ''}${body || ''}</a>`;

  // video / post edit widgets: pending count, how many are due today, and the next few with their due dates
  function taskWidget(title, href, list, dateOf, titleOf) {
    const rows = list.map(x => ({ t: String(titleOf(x) || '').trim() || 'Untitled', d: d10(dateOf(x)) }))
      .sort((a, b) => (a.d || '9999').localeCompare(b.d || '9999'));
    const today = rows.filter(r => r.d && away(r.d) === 0).length, late = rows.filter(r => r.d && away(r.d) < 0).length;
    const subs = [];
    if (today) subs.push(`<em class="today">${today} due today</em>`);
    if (late) subs.push(`<em class="late">${late} overdue</em>`);
    const body = rows.length
      ? `<ul class="wg-list">${rows.slice(0, 5).map(r => `<li><span>${esc(r.t)}</span>${dueLbl(r.d)}</li>`).join('')}</ul>${rows.length > 5 ? `<div class="wg-more">+${rows.length - 5} more</div>` : ''}`
      : '<div class="wg-empty">Nothing pending</div>';
    return shell(late ? 'wg-late' : today ? 'wg-warn' : '', href, title, rows.length, subs.join(' &middot; ') || (rows.length ? 'None due today' : ''), body);
  }

  const W = {
    goals(S) {
      const goals = org.filter(i => i.kind === 'goal');
      if (!goals.length) return shell('', 'organization.html', 'Goals', null, '', '<div class="wg-empty">No goals yet. Add them in Organization, Goals.</div>');
      const prog = g => {
        if (!S.port) return null;
        const inWin = c => c.soldDate && (!g.start || c.soldDate >= g.start) && (!g.deadline || c.soldDate <= g.deadline);
        if (g.metric === 'cards') return S.port.filter(c => c.tag === 'sold' && inWin(c)).length;
        const tasks = S.fin ? (S.fin.toRecord || []).concat(S.fin.recorded || []) : null;
        if (g.metric === 'profit') return tasks ? netProfit(S.port, tasks, g.start, g.deadline).net : null;   // same maths as the cash reserves calculator
        // business value = every account + cards on hand and pending at cost + receivables - payables (same as the Goals tab and the Home total)
        if (!S.acct || !tasks) return null;
        const pr = prTotals(tasks);
        return S.acct.cash + S.acct.maribank + S.acct.reserves + S.acct.others + S.port.filter(c => c.tag === 'onhand' || c.tag === 'pending').reduce((a, c) => a + (Number(c.purchaseCost) || 0), 0) + pr.rec - pr.pay;
      };
      const rows = goals.map(g => {
        const cur = prog(g), left = away(g.deadline), done = cur != null && cur >= g.target;
        return { g, cur, left, done, late: !done && left < 0 };
      }).sort((a, b) => (a.done || a.late ? 1 : 0) - (b.done || b.late ? 1 : 0) || String(a.g.deadline).localeCompare(String(b.g.deadline)));
      const fmt = (g, n) => g.metric === 'cards' ? Math.round(n).toLocaleString('en-PH') : php(n);
      const body = rows.slice(0, 6).map(r => {
        const pct = r.cur == null || !(r.g.target > 0) ? 0 : Math.max(0, Math.min(100, r.cur / r.g.target * 100));
        const badge = r.cur == null ? '' : r.done ? '<span class="wg-badge ok">Reached</span>' : r.late ? '<span class="wg-badge bad">Missed</span>' : `<span class="wg-badge">${r.left === 0 ? 'Due today' : r.left + 'd left'}</span>`;
        return `<div class="wg-goal ${r.done ? 'ok' : r.late ? 'bad' : ''}"><div class="wg-gh"><b>${esc(r.g.title)}</b>${badge}</div>
          <div class="wg-gn"><span class="${r.g.metric === 'cards' ? '' : 'wg-money'}">${r.cur == null ? 'Calculating\u2026' : fmt(r.g, r.cur) + ' of ' + fmt(r.g, r.g.target)}</span><span>${r.cur == null ? '' : Math.floor(pct) + '%'}</span></div>
          <span class="wg-bar"><u style="width:${pct}%"></u></span></div>`;
      }).join('');
      return shell('wg-wide', 'organization.html', 'Goals', goals.length, '', body + (rows.length > 6 ? `<div class="wg-more">+${rows.length - 6} more in Organization</div>` : ''));
    },

    cm_missing(S) {
      if (!S.port) return null;
      const n = S.port.filter(c => c.tag === 'onhand' && !(Number(c.targetPrice) > 0)).length;   // onhand only: pending cards are not counted
      return shell(n ? 'wg-warn' : '', 'commercial.html', 'Cards without a price', n, n ? 'Onhand cards with no target price' : 'Every onhand card has a target price', '');
    },

    cm_history(S) {
      if (!S.cm) return null;
      const today = isoToday(), log = S.cm, tod = log.filter(e => d10(e.at) === today).length, wk = log.filter(e => { const n = away(d10(e.at)); return n <= 0 && n > -7; }).length;
      const rng = (lo, hi) => !(lo > 0) ? 'no price' : hi > lo ? `${phpC(lo)}\u2013${phpC(hi)}` : phpC(lo);
      const body = log.length
        ? `<ul class="wg-list">${log.slice(0, 3).map(e => `<li><span>${esc(e.name || 'Card')}<small>${esc(rng(e.oldLo, e.oldHi))} \u2192 ${esc(rng(e.newLo, e.newHi))}${e.by ? ' \u00b7 ' + esc(e.by.charAt(0).toUpperCase() + e.by.slice(1)) : ''}</small></span><em>${esc(dayLbl(d10(e.at)))}</em></li>`).join('')}</ul>`
        : '<div class="wg-empty">No price edits recorded yet</div>';
      return shell('', 'commercial.html', 'Price edits today', tod, `${pl(wk, 'edit')} in the last 7 days`, body);
    },

    video_edit(S) {
      if (!S.cr) return null;
      return taskWidget('Videos to edit', 'creatives.html', (S.cr.videos || []).filter(x => (x.status || 'todo') === 'todo'), x => x.date, x => x.title);
    },
    post_edit(S) {
      if (!S.cr) return null;
      return taskWidget('Posts to edit', 'creatives.html', (S.cr.posts || []).filter(x => x.status === 'toedit'), x => x.scheduled, x => x.label || x.title);
    },

    fin_recent(S, user) {
      if (!S.fin) return null;
      const all = (S.fin.toRecord || []).concat(S.fin.recorded || []);
      if (S.freshFin) trackNew(user, all.map(t => 'f:' + t.id));   // only fresh server data decides what is new, never the cached copy
      const rows = all.slice().sort((a, b) => (d10(b.date) + ' ' + (b.time || '00:00')).localeCompare(d10(a.date) + ' ' + (a.time || '00:00'))).slice(0, 5);
      const nNew = S.freshFin ? all.filter(t => sessionNew.has('f:' + t.id)).length : 0;
      const body = rows.length ? `<ul class="wg-list">${rows.map(t => {
        const sign = t.flow === 'inflow' ? '+' : t.flow === 'outflow' ? '-' : '', cls = t.flow === 'inflow' ? 'in' : t.flow === 'outflow' ? 'out' : '';
        const isNew = S.freshFin && sessionNew.has('f:' + t.id);
        return `<li class="${isNew ? 'is-new' : ''}"><span>${isNew ? '<i class="wg-new">NEW</i>' : ''}${esc(t.description || 'Transaction')}<small>${esc([dayLbl(d10(t.date)), clock(t.time), t.payMethod].filter(Boolean).join(' \u00b7 '))}</small></span><b class="wg-money ${cls}">${sign}${phpC(Math.abs(t.amount))}</b></li>`;
      }).join('')}</ul>` : '<div class="wg-empty">No transactions yet</div>';
      return shell(nNew ? 'wg-warn' : '', 'finance.html', 'Recent transactions', null, S.freshFin ? (nNew ? `<em class="today">${nNew} new since you last looked</em>` : 'Nothing new since you last looked') : '', body);
    }
  };

  function render(el, S, user, keys, ctx) {
    const on = new Set(keys || []), out = [];
    ORDER.forEach(k => {
      if (!on.has(k) || !W[k]) return;
      try { const h = W[k](S, user, ctx || {}); if (h) out.push(h); } catch (e) { console.warn('Widget ' + k + ' failed', e); }
    });
    el.innerHTML = out.join('');
    return out.length;
  }

  window.CVWidgets = { CATALOG, load, keysFor, render, netProfit, prTotals };
})();
