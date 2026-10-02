/* ---------- Calendar — shipping schedule, receipts and shared events on one month grid ---------- */
const escCal = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;          // m is 0-based
const todayIsoCal = () => { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth(), d.getDate()); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const $ = id => document.getElementById(id);
let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
let selected = todayIsoCal();
let filter = 'all';
let data = { shipping: [], receipts: [], events: [] };   // all normalised to {date, kind, ...}
let unscheduled = 0;

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'calCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { delete window[cbName]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('Timed out')); } }, 15000);
    window[cbName] = d => { if (!settled) { settled = true; cleanup(); resolve(d); } };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Script load failed')); } };
    document.body.appendChild(script);
  });
}
function toast(m) {
  const t = $('calToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800);
}
const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);

/* ---------- markers ---------- */
const SHIP_STATUS_LABEL = { toship: 'To ship', missed: 'Missed / delayed', done: 'Shipped' };
const RECEIPT_COLOR = { purchase: '#d93a3a', sale: '#2e9e4a', trade: '#8a4fd0' };
const RECEIPT_LABEL = { purchase: 'Purchase', sale: 'Sale', trade: 'Trade' };
const EVENT_COLOR = '#2f6fe0';

function marker(kind, status, size = 12) {
  if (kind === 'shipping') {
    const box = '<rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke-width="2.4"/>';
    const inner = status === 'missed' ? '<path d="M8 8l8 8M16 8l-8 8" fill="none" stroke-width="2.4" stroke-linecap="round"/>'
      : status === 'done' ? '<path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    const col = status === 'missed' ? '#c0392b' : status === 'done' ? '#1c8a3a' : '#242424';
    return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24" stroke="${col}">${box}${inner}</svg>`;
  }
  if (kind === 'receipt') return `<svg class="mk" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="${RECEIPT_COLOR[status] || '#888'}"/></svg>`;
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
    out.push({ kind: 'shipping', status: 'done', date: d, names: g.map(i => i.name), soldTo: f.soldTo, method: f.shipMethod });
  });
  return out;
}

async function load() {
  if (!CONFIG.portfolio.endpoint) { setState("Sync isn't set up yet."); return; }
  setState('Loading\u2026');
  const [sh, rc, ev] = await Promise.allSettled([jsonp(api('shipping')), jsonp(api('receipts')), jsonp(api('events'))]);
  const ok = r => r.status === 'fulfilled' && r.value && r.value.ok;
  const failed = [];
  data.shipping = ok(sh) ? buildShipping(sh.value) : (failed.push('shipping'), []);
  data.receipts = ok(rc) ? (rc.value.receipts || []).filter(r => r.date).map(r => ({ kind: 'receipt', status: r.type, date: String(r.date).slice(0, 10), id: r.id, url: r.url, description: r.description })) : (failed.push('receipts'), []);
  data.events = ok(ev) ? (ev.value.events || []).map(e => ({ kind: 'event', status: 'event', date: String(e.date).slice(0, 10), id: e.id, title: e.title, time: e.time, notes: e.notes })) : (failed.push('events'), []);
  setState(failed.length === 3 ? "Couldn't load the calendar (offline, wrong secret, or Code.gs needs a new deployment)."
    : failed.length ? `Couldn't load ${failed.join(' and ')} \u2014 if that persists, Code.gs needs the latest version deployed.` : '');
  render();
}
function setState(msg) { const s = $('calState'); s.textContent = msg; s.hidden = !msg; }

/* ---------- rendering ---------- */
const visible = () => [].concat(
  filter === 'all' || filter === 'shipping' ? data.shipping : [],
  filter === 'all' || filter === 'receipts' ? data.receipts : [],
  filter === 'all' || filter === 'events' ? data.events : []);
const ORDER = { event: 0, shipping: 1, receipt: 2 };

function renderLegend() {
  const parts = [];
  if (filter === 'all' || filter === 'shipping')
    parts.push(`<span>${marker('shipping', 'toship')} To ship</span><span>${marker('shipping', 'missed')} Missed</span><span>${marker('shipping', 'done')} Shipped</span>`);
  if (filter === 'all' || filter === 'receipts')
    parts.push(['purchase', 'sale', 'trade'].map(t => `<span>${marker('receipt', t)} ${RECEIPT_LABEL[t]}</span>`).join(''));
  if (filter === 'all' || filter === 'events') parts.push(`<span>${marker('event')} Event</span>`);
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
    const iso = isoOf(view.y, view.m, d), items = (byDate[iso] || []).slice().sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
    const shown = items.slice(0, 6), more = items.length - shown.length;
    html += `<button type="button" class="cal-cell${iso === today ? ' today' : ''}${iso === selected ? ' sel' : ''}" data-d="${iso}" aria-label="${iso}">
      <span class="cal-num">${d}</span>
      <span class="cal-mks">${shown.map(x => marker(x.kind, x.status, 11)).join('')}${more > 0 ? `<i>+${more}</i>` : ''}</span></button>`;
  }
  $('calGrid').innerHTML = html;
  renderLegend();
  renderDay();
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
  const items = visible().filter(x => x.date === selected).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  if (!items.length) { $('dayList').innerHTML = '<p class="stub-note" style="margin:8px 0 0">Nothing on this day.</p>'; return; }
  $('dayList').innerHTML = items.map(x => {
    if (x.kind === 'event') return `<div class="cal-item">${marker('event', '', 16)}<div class="cal-item-body"><b>${escCal(x.title)}</b>
        <span>${[x.time, 'Event'].filter(Boolean).map(escCal).join(' \u00b7 ')}</span>${x.notes ? `<span class="fin-notes">${escCal(x.notes)}</span>` : ''}</div>
        <button type="button" class="ghost sm ev-edit" data-id="${escCal(x.id)}">Edit</button></div>`;
    if (x.kind === 'shipping') return `<a class="cal-item st-${x.status}" href="shipping.html">${marker('shipping', x.status, 16)}<div class="cal-item-body">
        <b>${escCal(x.names.join(', '))}</b><span>${SHIP_STATUS_LABEL[x.status]} \u00b7 ${escCal(x.method || '\u2014')} \u00b7 sold to ${escCal(x.soldTo || '\u2014')}</span></div></a>`;
    return `<a class="cal-item" ${x.url ? `href="${escCal(x.url)}" target="_blank" rel="noopener"` : ''}>${marker('receipt', x.status, 16)}<div class="cal-item-body">
        <b>${escCal(x.description || 'Receipt')}</b><span>${RECEIPT_LABEL[x.status] || 'Receipt'} receipt</span></div></a>`;
  }).join('');
}

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
