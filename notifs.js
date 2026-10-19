/* ---------- Pinned notices (Home) ----------
   The only notice left is "Shipping due today". It is pinned: it has no X and goes away by itself once nothing is scheduled for today.
   Who sees it is set per person in Organization (Home widgets, "Shipping due today"; key ops_due). Widgets live in widgets.js.
   CVNotifs.evaluate(S, keys) -> [{id, tone, text, href}];  CVNotifs.render(el, list)
   CVNotifs.touchFin()  call after the user records a receipt / finance task, so their own record is not shown as "new" on Home */
(function () {
  const p2 = n => String(n).padStart(2, '0');
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const d10 = v => String(v || '').slice(0, 10);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // shipping TASKS, not cards: cards from one sale receipt share a groupKey and are one task
  function evaluate(S, keys) {
    const out = [];
    if (S.ship && (keys || []).includes('ops_due')) {
      const t = isoToday(), n = new Set((S.ship.toShip || []).filter(i => d10(i.scheduledDate) === t).map(i => i.groupKey || ('c:' + i.id))).size;
      if (n) out.push({ id: 'ops_due', tone: 'orange', text: `${pl(n, 'shipment')} due today`, href: 'shipping.html' });
    }
    return out;
  }

  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
  function render(el, list) {
    el.innerHTML = list.map(n => `<div class="nt nt-${n.tone} nt-lock" role="status"><a class="nt-body" href="${esc(n.href)}">${BELL}<span>${esc(n.text)}</span></a></div>`).join('');
    el.hidden = !list.length;
  }

  // Finance "new" tracking lives in widgets.js; this only tells it to start fresh from the next load
  function touchFin() {
    try { localStorage.setItem('cv:finRebase:' + String((window.CVAuth && CVAuth.user()) || '').trim().toLowerCase(), '1'); } catch (_) {}
    try { if (window.CVShell) CVShell.setBadge('finance', 0); } catch (_) {}
  }

  window.CVNotifs = { evaluate, render, touchFin };
})();
