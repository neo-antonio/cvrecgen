/* ---------- Commercial price history ----------
   The folder icon (top right of Commercial) opens the archive of target price changes kept by Code.gs (CommercialLog sheet). Read only. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const range = (lo, hi) => !(lo > 0) ? 'No price' : hi > lo ? money(lo) + ' \u2013 ' + money(hi) : money(lo);
  const clock = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})$/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
  const dayHead = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : iso; };
  const who = b => b ? b.charAt(0).toUpperCase() + b.slice(1) : '';
  let busy = false;

  async function open() {
    $('cmHist').hidden = false;
    const body = $('cmHistBody');
    if (busy) return;
    if (typeof CONFIG === 'undefined' || !CONFIG.portfolio || !CONFIG.portfolio.endpoint || typeof jsonp !== 'function') { body.innerHTML = '<p class="stub-note">Sync isn\u2019t set up yet.</p>'; return; }
    busy = true; body.innerHTML = '<p class="stub-note">Loading\u2026</p>';
    try {
      const d = await jsonp(CONFIG.portfolio.endpoint + '?action=commercialLog&secret=' + encodeURIComponent(CONFIG.portfolio.secret), 60000);
      if (!d || !d.ok) throw new Error((d && d.error) || 'Unknown error');
      const items = d.items || [];
      if (!items.length) { body.innerHTML = '<p class="stub-note">No price changes recorded yet. Changes made from now on will show up here.</p>'; busy = false; return; }
      let html = '', day = '';
      items.forEach(e => {
        const dd = String(e.at).slice(0, 10);
        if (dd !== day) { day = dd; html += `<div class="ch-day">${esc(dayHead(dd))}</div>`; }
        const up = e.newLo > e.oldLo ? 'up' : e.newLo < e.oldLo ? 'down' : '';
        html += `<div class="ch-row"><div><b>${esc(e.name || 'Card')}</b><small>${esc(range(e.oldLo, e.oldHi))} \u2192 <span class="${up}">${esc(range(e.newLo, e.newHi))}</span></small></div><span>${esc(clock(e.at))}${e.by ? '<br>' + esc(who(e.by)) : ''}</span></div>`;
      });
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = '<p class="stub-note">Couldn\u2019t load the history (' + esc(err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message) + ').</p>';
    }
    busy = false;
  }
  const close = () => { $('cmHist').hidden = true; };
  $('cmHistBtn').addEventListener('click', e => { e.preventDefault(); open(); });
  $('cmHistClose').onclick = close;
  $('cmHist').addEventListener('click', e => { if (e.target.id === 'cmHist') close(); });
})();
