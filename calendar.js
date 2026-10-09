/* ---------- Calendar — shipping schedule, receipts and shared events on one month grid ---------- */
const escCal = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;          // m is 0-based
const todayIsoCal = () => { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth(), d.getDate()); };
// '14:30' -> '2:30 PM' (blank in, blank out)
const fmtClock = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const $ = id => document.getElementById(id);
let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
let selected = todayIsoCal();
let filter = 'all';
let data = { shipping: [], receipts: [], events: [], creatives: [] };
let staged = {};   // creatives ticked on this page but not applied yet: id -> true (edited) / false (to edit)   // all normalised to {date, kind, ...}
let unscheduled = 0;

function toast(m) {
  const t = $('calToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800);
}
const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);

/* ---------- markers ---------- */
const SHIP_STATUS_LABEL = { toship: 'To ship', missed: 'Missed / delayed', done: 'Shipped' };
const RECEIPT_COLOR = { purchase: '#d93a3a', sale: '#2e9e4a', trade: '#8a4fd0', transfer: '#e08a00' };
const RECEIPT_LABEL = { purchase: 'Purchase', sale: 'Sale', trade: 'Trade', transfer: 'Transfer' };
const EVENT_COLOR = '#2f6fe0';
const CREATIVE_PATH = {
  video: '<rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="M15 10.5l6-3v9l-6-3"/>',
  pic: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>'
};
// what a creatives item looks like right now: the staged tick if there is one, else its saved state
const crDone = x => x.id in staged ? staged[x.id] : x.done;
const mkOf = x => x.kind === 'creative' ? marker('creative', x.media + '-' + (crDone(x) ? 'ok' : 'todo'), 11) : marker(x.kind, x.status, 11);

function marker(kind, status, size = 12) {
  if (kind === 'shipping') {
    const box = '<rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke-width="2.4"/>';
    const inner = status === 'missed' ? '<path d="M8 8l8 8M16 8l-8 8" fill="none" stroke-width="2.4" stroke-linecap="round"/>'
      : status === 'done' ? '<path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    const col = status === 'missed' ? '#c0392b' : status === 'done' ? '#1c8a3a' : '#242424';
    return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24" stroke="${col}">${box}${inner}</svg>`;
  }
  if (kind === 'receipt') return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="${RECEIPT_COLOR[status] || '#888'}"/></svg>`;
  if (kind === 'creative') {   // status = '<video|pic>-<todo|ok>': red outline = still to edit, green = edited
    const [media, st] = String(status).split('-'), ok = st === 'ok', col = ok ? '#1e8e3e' : '#d93025';
    return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${ok ? col : 'none'}" fill-opacity="${ok ? '.22' : '0'}" stroke="${col}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CREATIVE_PATH[media] || ''}</svg>`;
  }
  return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(45 12 12)" fill="${EVENT_COLOR}"/></svg>`;
}

/* ---------- loading + normalising ---------- */
function groupShip(list) {
  const map = new Map();
  list.forEach(it => { const k = it.groupKey || ('c:' + it.id); if (!map.has(k)) map.set(k, []); map.get(k).push(it); });
  return [...map.values()];
}
function buildShipping(ship) {
  const today = todayIsoCal(), out = [];
  unscheduled = 0;
  groupShip(ship.toShip || []).forEach(g => {
    const f = g[0], d = String(f.scheduledDate || '').slice(0, 10);
    if (!d) { unscheduled++; return; }
    out.push({ kind: 'shipping', status: d < today ? 'missed' : 'toship', date: d, names: g.map(i => i.name), soldTo: f.soldTo, method: f.shipMethod });
  });
  groupShip(ship.shipped || []).forEach(g => {
    const f = g[0], d = String(f.shippedDate || '').slice(0, 10);
    if (!d) return;
    out.push({ kind: 'shipping', status: 'done', date: d, time: f.shippedTime, names: g.map(i => i.name), soldTo: f.soldTo, method: f.shipMethod });
  });
  return out;
}

function applyCalendar(sh, rc, ev, cr) {
  const ok = r => r && r.ok;
  const failed = [];
  data.shipping = ok(sh) ? buildShipping(sh) : (failed.push('shipping'), []);
  data.receipts = ok(rc) ? (rc.receipts || []).filter(r => r.date).map(r => ({ kind: 'receipt', status: r.type, date: String(r.date).slice(0, 10), id: r.id, url: r.url, description: r.description, time: r.time })) : (failed.push('receipts'), []);
  data.events = ok(ev) ? (ev.events || []).map(e => ({ kind: 'event', status: 'event', date: String(e.date).slice(0, 10), id: e.id, title: e.title, time: e.time, notes: e.notes })) : (failed.push('events'), []);
  // Creatives: video tasks (by scheduled date) and picture-edit groups (one per receipt)
  data.creatives = ok(cr) ? (cr.videos || []).filter(v => v.date).map(v => ({ kind: 'creative', media: 'video', id: v.id, date: String(v.date).slice(0, 10), done: v.status === 'done', title: v.title, sub: v.auto ? 'Video \u00b7 from receipt' : 'Video' }))
    .concat((cr.posts || []).filter(g => g.scheduled).map(g => ({ kind: 'creative', media: 'pic', id: g.id, date: String(g.scheduled).slice(0, 10), done: g.status === 'edited', title: g.label || 'Cards', sub: `Pictures \u00b7 ${g.editedCount} of ${g.cards.length} card${g.cards.length === 1 ? '' : 's'} edited` }))) : (failed.push('creatives'), []);
  return failed;
}
let calFirst = true;
async function load() {
  if (!CONFIG.portfolio.endpoint) { setState("Sync isn't set up yet."); return; }
  const cached = calFirst ? cacheGet('calendar') : null; calFirst = false;
  if (cached) { applyCalendar(cached.sh, cached.rc, cached.ev, cached.cr); setState(''); render(); }
  else setState('Loading\u2026');
  const [sh, rc, ev, cr] = await Promise.allSettled([jsonp(api('shipping')), jsonp(api('receipts')), jsonp(api('events')), jsonp(api('creatives'))]);
  const val = r => r.status === 'fulfilled' ? r.value : null;
  const fresh = { sh: val(sh), rc: val(rc), ev: val(ev), cr: val(cr) };
  // a part that failed keeps its last saved copy rather than disappearing
  const old = cacheGet('calendar') || {};
  const merged = { sh: fresh.sh && fresh.sh.ok ? fresh.sh : old.sh, rc: fresh.rc && fresh.rc.ok ? fresh.rc : old.rc, ev: fresh.ev && fresh.ev.ok ? fresh.ev : old.ev, cr: fresh.cr && fresh.cr.ok ? fresh.cr : old.cr };
  const failed = applyCalendar(merged.sh, merged.rc, merged.ev, merged.cr);
  cacheSet('calendar', merged);
  if (fresh.cr && fresh.cr.ok) cacheSet('creatives', { videos: fresh.cr.videos || [], posts: fresh.cr.posts || [] });   // keep the Creatives page's copy fresh too
  const stale = ['sh', 'rc', 'ev', 'cr'].filter(k => !(fresh[k] && fresh[k].ok));
  setState(failed.length === 4 ? "Couldn't load the calendar (offline, wrong secret, or Code.gs needs a new deployment)."
    : stale.length ? "Some data couldn't be refreshed \u2014 showing what was last saved. Tap Refresh to retry." : '');
  render();
}
function setState(msg) { const s = $('calState'); s.textContent = msg; s.hidden = !msg; }

/* ---------- rendering ---------- */
const visible = () => [].concat(
  filter === 'all' || filter === 'shipping' ? data.shipping : [],
  filter === 'all' || filter === 'receipts' ? data.receipts : [],
  filter === 'all' || filter === 'events' ? data.events : [],
  filter === 'creatives' ? data.creatives : []);   // creatives get their own tab so the All view stays uncluttered
const ORDER = { event: 0, shipping: 1, receipt: 2, creative: 3 };
// kind first, then by time of day inside a kind (anything without a time goes last)
const byKindThenTime = (a, b) => (ORDER[a.kind] - ORDER[b.kind]) || String(a.time || '99:99').localeCompare(String(b.time || '99:99'));

function renderLegend() {
  const parts = [];
  if (filter === 'all' || filter === 'shipping')
    parts.push(`<span>${marker('shipping', 'toship')} To ship</span><span>${marker('shipping', 'missed')} Missed</span><span>${marker('shipping', 'done')} Shipped</span>`);
  if (filter === 'all' || filter === 'receipts')
    parts.push(['purchase', 'sale', 'trade', 'transfer'].map(t => `<span>${marker('receipt', t)} ${RECEIPT_LABEL[t]}</span>`).join(''));
  if (filter === 'all' || filter === 'events') parts.push(`<span>${marker('event')} Event</span>`);
  if (filter === 'creatives') parts.push(['video-todo|To edit video', 'video-ok|Video edited', 'pic-todo|To edit picture', 'pic-ok|Picture edited'].map(p => { const [s, l] = p.split('|'); return `<span>${marker('creative', s)} ${l}</span>`; }).join(''));
  $('calLegend').innerHTML = parts.join('');
}

function render() {
  $('calTitle').textContent = `${MONTHS[view.m]} ${view.y}`;
  const byDate = {};
  visible().forEach(x => (byDate[x.date] = byDate[x.date] || []).push(x));
  const first = new Date(view.y, view.m, 1).getDay(), days = new Date(view.y, view.m + 1, 0).getDate(), today = todayIsoCal();
  let html = '';
  for (let i = 0; i < first; i++) html += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(view.y, view.m, d), items = (byDate[iso] || []).slice().sort(byKindThenTime);
    const shown = items.slice(0, 6), more = items.length - shown.length;
    html += `<button type="button" class="cal-cell${iso === today ? ' today' : ''}${iso === selected ? ' sel' : ''}" data-d="${iso}" aria-label="${iso}">
      <span class="cal-num">${d}</span>
      <span class="cal-mks">${shown.map(mkOf).join('')}${more > 0 ? `<i>+${more}</i>` : ''}</span></button>`;
  }
  $('calGrid').innerHTML = html;
  renderLegend();
  renderDay();
  renderBar();
  const showUn = unscheduled > 0 && (filter === 'all' || filter === 'shipping');
  $('calUnsched').hidden = !showUn;
  if (showUn) $('calUnsched').innerHTML = `${unscheduled} shipping task${unscheduled > 1 ? 's have' : ' has'} no scheduled date, so ${unscheduled > 1 ? 'they are' : 'it is'} not on the calendar. Set a date from the <a href="shipping.html">Shipping tab</a>.`;
}

function fmtLong(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : iso;
}
function renderDay() {
  $('dayTitle').textContent = fmtLong(selected) + (selected === todayIsoCal() ? ' (today)' : '');
  const items = visible().filter(x => x.date === selected).sort(byKindThenTime);
  if (!items.length) { $('dayList').innerHTML = '<p class="stub-note" style="margin:8px 0 0">Nothing on this day.</p>'; return; }
  $('dayList').innerHTML = items.map(x => {
    if (x.kind === 'creative') {
      const on = crDone(x);
      return `<label class="cc-row${x.id in staged ? ' changed' : ''}"><input type="checkbox" class="cr-tick cc-tick" data-id="${escCal(x.id)}" ${on ? 'checked' : ''}>${marker('creative', x.media + '-' + (on ? 'ok' : 'todo'), 20)}<span class="cc-t"><b>${escCal(x.title)}</b><small>${escCal(x.sub)}</small></span></label>`;
    }
    if (x.kind === 'event') return `<div class="cal-item">${marker('event', '', 16)}<div class="cal-item-body"><b>${escCal(x.title)}</b>
        <span>${[fmtClock(x.time), 'Event'].filter(Boolean).map(escCal).join(' \u00b7 ')}</span>${x.notes ? `<span class="fin-notes">${escCal(x.notes)}</span>` : ''}</div>
        <button type="button" class="ghost sm ev-edit" data-id="${escCal(x.id)}">Edit</button></div>`;
    if (x.kind === 'shipping') return `<a class="cal-item st-${x.status}" href="shipping.html">${marker('shipping', x.status, 16)}<div class="cal-item-body">
        <b>${escCal(x.names.join(', '))}</b><span>${[SHIP_STATUS_LABEL[x.status], fmtClock(x.time), x.method || '\u2014', 'sold to ' + (x.soldTo || '\u2014')].map(escCal).join(' \u00b7 ')}</span></div></a>`;
    return `<a class="cal-item" ${x.url ? `href="${escCal(x.url)}" target="_blank" rel="noopener"` : ''}>${marker('receipt', x.status, 16)}<div class="cal-item-body">
        <b>${escCal(x.description || 'Receipt')}</b><span>${[(RECEIPT_LABEL[x.status] || 'Receipt') + ' receipt', fmtClock(x.time)].filter(Boolean).map(escCal).join(' \u00b7 ')}</span></div></a>`;
  }).join('');
}

/* ---------- creatives: tick tasks, then Apply changes ---------- */
function renderBar() {
  const n = Object.keys(staged).length;
  $('ccBar').hidden = !n;
  $('ccCount').textContent = `${n} change${n === 1 ? '' : 's'} not saved`;
}
$('dayList').addEventListener('change', e => {
  if (!e.target.classList.contains('cc-tick')) return;
  const x = data.creatives.find(i => i.id === e.target.dataset.id); if (!x) return;
  if (e.target.checked === x.done) delete staged[x.id]; else staged[x.id] = e.target.checked;   // ticking back to the saved state cancels the change
  render();
});
$('ccCancel').onclick = () => { staged = {}; render(); };
$('ccApply').onclick = async () => {
  const done = Object.keys(staged).filter(id => staged[id]), todo = Object.keys(staged).filter(id => !staged[id]);
  if (!done.length && !todo.length) return;
  const btn = $('ccApply'); btn.disabled = true; btn.textContent = 'Applying\u2026'; $('ccCancel').disabled = true;
  try {
    for (const [ids, status] of [[done, 'done'], [todo, 'todo']]) {
      if (!ids.length) continue;
      const r = await jsonp(api('completeCreatives', { ids: ids.join(','), status }), 60000);
      if (!r.ok) throw new Error(r.error || 'Request failed');
    }
    staged = {};
    toast('Changes applied.');
    await load();   // refresh from the sheet so the icons update
  } catch (err) { toast('Could not apply: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Apply changes'; $('ccCancel').disabled = false;
  render();
};

/* ---------- interaction ---------- */
document.querySelectorAll('.tab[data-cfilter]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-cfilter]').forEach(x => x.classList.toggle('active', x === t));
  filter = t.dataset.cfilter; render();
});
const shiftMonth = n => { view.m += n; if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; } render(); };
$('calPrev').onclick = () => shiftMonth(-1);
$('calNext').onclick = () => shiftMonth(1);
$('calToday').onclick = () => { const d = new Date(); view = { y: d.getFullYear(), m: d.getMonth() }; selected = todayIsoCal(); render(); };
$('calRefresh').onclick = load;
$('calGrid').addEventListener('click', e => { const c = e.target.closest('.cal-cell[data-d]'); if (c) { selected = c.dataset.d; render(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && CONFIG.portfolio.endpoint) load(); });   // pick up events others added

/* ---------- add / edit / delete events (stored in the shared Events tab) ---------- */
let editing = null;   // {id, isNew}
const newEventId = () => 'e_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
function openEvent(id) {
  const ev = id ? data.events.find(e => e.id === id) : null;
  editing = { id: ev ? ev.id : newEventId(), isNew: !ev };
  $('evHeading').textContent = ev ? 'Edit event' : 'Add event';
  $('evSave').textContent = ev ? 'Save changes' : 'Add event';
  $('evTitle').value = ev ? ev.title : '';
  $('evDate').value = ev ? ev.date : selected;
  $('evTime').value = ev ? ev.time : '';
  $('evNotes').value = ev ? ev.notes : '';
  $('evDelete').hidden = !ev;
  $('evSheet').hidden = false;
  if (!ev) $('evTitle').focus();
}
const closeEvent = () => { $('evSheet').hidden = true; editing = null; };
$('evAdd').onclick = () => openEvent(null);
$('evCancel').onclick = closeEvent;
$('evSheet').addEventListener('click', e => { if (e.target.id === 'evSheet') closeEvent(); });
$('dayList').addEventListener('click', e => { const b = e.target.closest('.ev-edit'); if (b) openEvent(b.dataset.id); });

const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
$('evSave').onclick = async () => {
  const title = $('evTitle').value.trim(), date = $('evDate').value;
  if (!title) return toast('Add a title.');
  if (!date) return toast('Pick a date.');
  const btn = $('evSave'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const r = await jsonp(api('saveEvent', { eventId: editing.id, title, date, time: $('evTime').value, notes: $('evNotes').value.trim() }));
    if (!r.ok) throw new Error(r.error || 'Request failed');
    selected = date;
    const m = date.match(/^(\d{4})-(\d{2})/); if (m) view = { y: +m[1], m: +m[2] - 1 };
    closeEvent(); toast('Event saved.');
    await load();
  } catch (err) { toast('Could not save: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = label;
};
$('evDelete').onclick = async () => {
  if (!editing || editing.isNew || !confirm('Delete this event for everyone?')) return;
  const btn = $('evDelete'); btn.disabled = true;
  try {
    const r = await jsonp(api('deleteEvent', { eventId: editing.id }));
    if (!r.ok) throw new Error(r.error || 'Request failed');
    closeEvent(); toast('Event deleted.');
    await load();
  } catch (err) { toast('Could not delete: ' + backendErr(err)); }
  btn.disabled = false;
};

render();
load();
