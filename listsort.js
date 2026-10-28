/* ---------- Sort sheet shared by Portfolio and Commercial ----------
   Same look and flow as the sort & filter button on Marketing > Entities: a funnel icon opens a sheet with the sort options
   (.so-item) and the order (radios); the active sort shows as a chip under the search box and the funnel turns dark.
   Pages call ListSort.mount({ after, onChange }) once and ListSort.sortUnits(units, daysOf) whenever they render.
   units = [{ card } | { lot: true, name, cards: [] }]; daysOf(card) = days held, or null when it can't be told. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // dirs[0] = 'a' (the default order for that sort), dirs[1] = 'b'
  const KEYS = {
    sold:  { title: 'Date sold',    sub: 'When the card was sold',                          dirs: ['Newest first', 'Oldest first'] },
    alpha: { title: 'Alphabetical', sub: 'By card or lot name',                             dirs: ['A to Z', 'Z to A'] },
    held:  { title: 'Days held',    sub: 'Purchase date until sold, or until today if still held', dirs: ['Longest first', 'Shortest first'] }
  };
  let key = '', dir = 'a', onChange = function () {};
  const FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>';

  const day = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  function valueOf(c, daysOf) {
    if (key === 'sold') return day(c.soldDate);
    if (key === 'held') { const d = daysOf ? daysOf(c) : null; return d == null ? null : d; }
    return String(c.name || '');
  }
  // cards with no value (not sold yet, no purchase date) always go last
  function compare(a, b) {
    const na = a == null, nb = b == null;
    if (na || nb) return na && nb ? 0 : na ? 1 : -1;
    const r = typeof a === 'string' ? a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) : a - b;
    return (key === 'alpha' ? dir === 'a' : dir === 'b') ? r : -r;   // A-Z ascending; "newest" and "longest" descending
  }
  function sortUnits(units, daysOf) {
    if (!key) return units;
    const desc = key !== 'alpha' && dir === 'a';
    const unitValue = u => {
      if (!u.lot) return valueOf(u.card, daysOf);
      if (key === 'alpha') return String(u.name || '');
      const vs = u.cards.map(c => valueOf(c, daysOf)).filter(v => v != null);
      return vs.length ? (desc ? Math.max.apply(null, vs) : Math.min.apply(null, vs)) : null;   // a lot sorts by its newest / longest card (or its oldest / shortest when reversed)
    };
    units.forEach(u => { if (u.lot) u.cards = u.cards.map(c => ({ c, v: valueOf(c, daysOf) })).sort((x, y) => compare(x.v, y.v)).map(x => x.c); });
    return units.map(u => ({ u, v: unitValue(u) })).sort((x, y) => compare(x.v, y.v)).map(x => x.u);
  }

  function paint() {
    const on = !!key, btn = $('lsBtn');
    btn.classList.toggle('on', on);
    const box = $('lsActive');
    box.hidden = !on;
    box.innerHTML = on ? `<button type="button" class="chip active" id="lsChip" title="Clear sort">${esc(KEYS[key].title)} \u00b7 ${esc(KEYS[key].dirs[dir === 'a' ? 0 : 1])} \u00d7</button>` : '';
    document.querySelectorAll('#lsOpts .so-item').forEach(b => b.classList.toggle('on', b.dataset.k === key));
    $('lsDirField').hidden = !key;
    if (key) {
      const spans = document.querySelectorAll('#lsDirField .rad span');
      spans[0].textContent = KEYS[key].dirs[0]; spans[1].textContent = KEYS[key].dirs[1];
      document.querySelector('#lsDirField input[value=' + dir + ']').checked = true;
    }
  }
  function set(k, d) { key = k; dir = d || 'a'; paint(); onChange(); }

  function mount(opts) {
    onChange = opts.onChange || onChange;
    const anchor = opts.after;
    const bar = document.createElement('div');
    bar.className = 'ent-bar';
    bar.innerHTML = `<span></span><div class="ent-tools"><button type="button" class="icon-btn" id="lsBtn" aria-label="Sort and filter" title="Sort and filter">${FUNNEL}</button></div>`;
    const active = document.createElement('div');
    active.className = 'ent-active'; active.id = 'lsActive'; active.hidden = true;
    anchor.after(bar); bar.after(active);

    const sheet = document.createElement('div');
    sheet.className = 'modal'; sheet.id = 'lsSheet'; sheet.hidden = true;
    sheet.innerHTML = `<div class="sheet small wide">
      <h3>Sort cards</h3>
      <div class="so-list" id="lsOpts">${Object.keys(KEYS).map(k => `<button type="button" class="so-item" data-k="${k}"><b>${esc(KEYS[k].title)}</b><span>${esc(KEYS[k].sub)}</span></button>`).join('')}</div>
      <div class="field" id="lsDirField" hidden>
        <label>Order</label>
        <div class="radios two">
          <label class="rad"><input type="radio" name="lsDir" value="a" checked><span></span></label>
          <label class="rad"><input type="radio" name="lsDir" value="b"><span></span></label>
        </div>
      </div>
      <div class="acts">
        <button type="button" class="go sm" id="lsDone">Done</button>
        <button type="button" class="ghost" id="lsReset">Reset sort</button>
      </div>
    </div>`;
    document.body.appendChild(sheet);

    const close = () => { sheet.hidden = true; };
    $('lsBtn').onclick = () => { paint(); sheet.hidden = false; };
    $('lsDone').onclick = close;
    $('lsReset').onclick = () => { set('', 'a'); close(); };
    sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
    $('lsOpts').addEventListener('click', e => { const b = e.target.closest('.so-item'); if (b) set(b.dataset.k, 'a'); });
    $('lsDirField').addEventListener('change', e => { if (e.target.name === 'lsDir') set(key, e.target.value); });
    active.addEventListener('click', e => { if (e.target.closest('#lsChip')) set('', 'a'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    paint();
  }
  window.ListSort = { mount, sortUnits, active: () => key };
})();
