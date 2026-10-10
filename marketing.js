/* ---------- Marketing — who we buy from / sell to / trade with the most, and the saved entities behind them ---------- */
const mkPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escMk = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $m = id => document.getElementById(id);

const KIND = {
  buy:   { sum: 'Total bought', noun: 'seller', empty: 'No purchases on record yet.' },
  sell:  { sum: 'Total sold', noun: 'buyer', empty: 'No sales on record yet.' },
  trade: { sum: 'Total traded', noun: 'trade partner', empty: 'No trades on record yet.' }
};
let mkTab = 'rank', mkKind = 'buy';
let data = { entities: [], tx: [] };   // tx: [entityName, kind, date, value]
let mkFirst = true;
const normData = d => ({ tx: d.tx || [], entities: (d.entities || []).map(e => Object.assign({ contact: '', address: '', email: '', facebook: '', notes: '' }, e, { aliases: e.aliases || [], payment: e.payment || [] })) });
const fbUrl = v => { v = String(v || '').trim(); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''); };

function toast(m) {
  const t = $m('mkToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}
function fmtDay(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);

/* ---------- numbers: per entity, per kind, optionally inside a date range ---------- */
function aggregate(lo, hi) {
  const by = {};
  const blank = () => ({ n: 0, v: 0, last: '' });
  data.entities.forEach(e => by[e.name] = { buy: blank(), sell: blank(), trade: blank() });
  data.tx.forEach(([name, kind, date, value]) => {
    const d = String(date || '').slice(0, 10);
    if ((lo || hi) && (!d || (lo && d < lo) || (hi && d > hi))) return;
    const a = by[name] && by[name][kind];
    if (!a) return;
    a.n++; a.v += Number(value) || 0;
    if (d > a.last) a.last = d;
  });
  return by;
}

/* ---------- Rankings ---------- */
function renderRank() {
  let lo = $m('mkFrom').value, hi = $m('mkTo').value;
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  const by = aggregate(lo, hi), K = KIND[mkKind];
  const rows = Object.keys(by).map(name => Object.assign({ name }, by[name][mkKind])).filter(r => r.n > 0)
    .sort((a, b) => (b.v - a.v) || (b.n - a.n) || a.name.localeCompare(b.name));
  if (!rows.length) {
    $m('mkState').textContent = (lo || hi) ? 'Nothing in that date range.' : (data.entities.length || data.tx.length ? K.empty : 'Nothing on record yet.');
    $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true;
    return;
  }
  const total = rows.reduce((a, r) => a + r.v, 0), top = rows[0].v || 1;
  $m('mkSumLbl').textContent = `${K.sum} \u00b7 ${plural(rows.length, K.noun)}`;
  $m('mkSumVal').textContent = mkPhp(total);
  $m('mkSum').hidden = false;
  $m('mkList').innerHTML = rows.map((r, i) => {
    const share = total ? Math.round(r.v / total * 100) : 0;
    return `<div class="mk-row${i === 0 ? ' top' : ''}">
        <span class="mk-rank">${i + 1}</span>
        <div class="mk-main"><b>${escMk(r.name)}</b>
          <span>${plural(r.n, 'card')} \u00b7 last ${fmtDay(r.last) || '\u2014'} \u00b7 ${share}% of total</span>
          <i class="mk-bar"><u style="width:${Math.max(2, Math.round(r.v / top * 100))}%"></u></i></div>
        <b class="mk-val">${mkPhp(r.v)}</b>
      </div>`;
  }).join('');
  $m('mkState').hidden = true; $m('mkList').hidden = false;
}

/* ---------- Entities ---------- */
const ENT_ICON = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  merge: '<path d="M6 3v5c0 3 2 4 6 4s6 1 6 4v5"/><path d="M18 3v5c0 3-2 4-6 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>'
};
const entIcon = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${escMk(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ENT_ICON[name]}</svg></button>`;

function renderEntities() {
  const q = $m('entSearch').value.trim().toLowerCase();
  const by = aggregate('', '');
  let list = data.entities.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (q) list = list.filter(e => [e.name, e.contact, e.address, e.email, e.facebook, e.notes].concat(e.aliases, e.payment).join(' ').toLowerCase().includes(q));
  $m('entCount').textContent = data.entities.length ? `${list.length} of ${plural(data.entities.length, 'entity').replace('entitys', 'entities')}` : '';
  if (!list.length) {
    $m('entState').textContent = data.entities.length ? 'No entities match your search.' : 'No entities yet. They are saved automatically from your receipts, or tap + Add entity.';
    $m('entState').hidden = false; $m('entList').hidden = true;
    return;
  }
  $m('entList').innerHTML = list.map(e => {
    const a = by[e.name] || {};
    const bits = [['Bought', a.buy], ['Sold', a.sell], ['Traded', a.trade]].filter(([, s]) => s && s.n).map(([l, s]) => `${l} ${s.n} \u00b7 ${mkPhp(s.v)}`);
    const none = !bits.length;
    return `<div class="ent-card click" data-id="${escMk(e.id)}">
        <div class="ent-head"><div class="ent-name"><b>${escMk(e.name)}</b>${e.contact ? `<span>${escMk(e.contact)}</span>` : ''}</div>
          <div class="ent-acts">${entIcon('pencil', 'ent-edit', 'Rename / edit', e.id)}${entIcon('merge', 'ent-merge', 'Merge into another entity', e.id)}${none ? entIcon('trash', 'danger ent-del', 'Delete', e.id) : ''}</div></div>
        ${e.aliases.length ? `<div class="ent-alias">Also spelled: ${e.aliases.map(escMk).join(', ')}</div>` : ''}
        <div class="ent-stats">${bits.length ? bits.join('<br>') : 'No cards yet'}</div>
      </div>`;
  }).join('');
  $m('entState').hidden = true; $m('entList').hidden = false;
}

/* ---------- Load ---------- */
function renderAll() { if (mkTab === 'rank') renderRank(); else renderEntities(); }
async function loadData() {
  if (!CONFIG.portfolio.endpoint) { $m('mkState').textContent = "Sync isn't set up yet."; $m('mkState').hidden = false; return; }
  const cached = mkFirst ? cacheGet('entities') : null; mkFirst = false;
  if (cached) { data = normData(cached); renderAll(); }
  else { $m('mkState').textContent = 'Loading\u2026'; $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true; }
  try {
    const res = await jsonp(api('entities'), 60000);   // the first run also saves every name already in your sheets
    if (!res.ok) throw new Error(res.error || 'Unknown error');
    data = normData(res);
    cacheSet('entities', data);
    renderAll();
  } catch (err) {
    console.warn('Marketing load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    const msg = "Couldn't load this page (offline, wrong secret, or Code.gs needs a new deployment).";
    $m('mkState').textContent = msg; $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true;
    $m('entState').textContent = msg; $m('entState').hidden = false; $m('entList').hidden = true;
  }
}

/* ---------- Tabs, filters ---------- */
document.querySelectorAll('.tab[data-mtab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-mtab]').forEach(x => x.classList.toggle('active', x === t));
  mkTab = t.dataset.mtab;
  $m('panelRank').hidden = mkTab !== 'rank'; $m('panelEnt').hidden = mkTab !== 'ent';
  renderAll();
});
document.querySelectorAll('#mkKinds .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#mkKinds .chip').forEach(x => x.classList.toggle('active', x === c));
  mkKind = c.dataset.kind; renderRank();
});
[$m('mkFrom'), $m('mkTo')].forEach(i => i.addEventListener('change', renderRank));
$m('mkClear').onclick = () => { $m('mkFrom').value = ''; $m('mkTo').value = ''; renderRank(); };
$m('mkRefresh').onclick = loadData;
$m('entSearch').addEventListener('input', renderEntities);

/* ---------- Add / rename / edit details ---------- */
let editEntId = '', entPay = [], reopenView = false;
const PAY_PRESETS = ['Cash', 'GCash', 'Maya', 'Maribank', 'Bank transfer'];
const findEnt = id => data.entities.find(e => e.id === id);
const hasPay = p => entPay.some(x => x.toLowerCase() === p.toLowerCase());
function renderPay() {
  const extra = entPay.filter(p => !PAY_PRESETS.some(x => x.toLowerCase() === p.toLowerCase()));
  $m('entPayChips').innerHTML = PAY_PRESETS.concat(extra).map(p => `<button type="button" class="chip${hasPay(p) ? ' active' : ''}" data-pay="${escMk(p)}">${escMk(p)}</button>`).join('');
}
$m('entPayChips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  const p = c.dataset.pay;
  entPay = hasPay(p) ? entPay.filter(x => x.toLowerCase() !== p.toLowerCase()) : entPay.concat(p);
  renderPay();
});
function addPay() {
  const v = $m('entPayOther').value.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (v && !hasPay(v)) entPay.push(v);
  $m('entPayOther').value = ''; renderPay();
}
$m('entPayAdd').onclick = addPay;
$m('entPayOther').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPay(); } });

function openEnt(id, fromView) {
  const e = id ? findEnt(id) : null;
  editEntId = e ? e.id : ''; reopenView = !!fromView;
  $m('entHeading').textContent = e ? 'Edit entity' : 'Add entity';
  $m('entName').value = e ? e.name : ''; $m('entContact').value = e ? e.contact : '';
  $m('entAddress').value = e ? e.address : ''; $m('entEmail').value = e ? e.email : '';
  $m('entFb').value = e ? e.facebook : ''; $m('entNotes').value = e ? e.notes : '';
  entPay = e ? e.payment.slice() : []; $m('entPayOther').value = ''; renderPay();
  $m('entHint').hidden = !e;
  $m('entSheet').hidden = false;
  if (!e) $m('entName').focus();
}
const closeEnt = () => { $m('entSheet').hidden = true; editEntId = ''; };
$m('entAdd').onclick = () => openEnt('');
$m('entCancel').onclick = () => { const back = reopenView && editEntId; closeEnt(); if (back) openView(back); };
$m('entSheet').addEventListener('click', e => { if (e.target.id === 'entSheet') $m('entCancel').onclick(); });
const entParams = (e, over) => Object.assign({ entityId: e.id, name: e.name, contact: e.contact, address: e.address, email: e.email, facebook: e.facebook, payment: e.payment.join('|'), notes: e.notes }, over);
$m('entSave').onclick = async () => {
  const name = $m('entName').value.trim().replace(/\s+/g, ' ');
  if (!name) return toast('Enter a name.');
  if ($m('entPayOther').value.trim()) addPay();
  const old = editEntId ? findEnt(editEntId) : null;
  if (old && name !== old.name && !confirm(`Rename "${old.name}" to "${name}"?\n\nEvery receipt, card and finance entry that uses the old spelling will be updated. This can take a few seconds.`)) return;
  const btn = $m('entSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const res = await jsonp(api('saveEntity', {
      entityId: editEntId, name, contact: $m('entContact').value.trim(), address: $m('entAddress').value.trim(),
      email: $m('entEmail').value.trim(), facebook: $m('entFb').value.trim(), payment: entPay.join('|'), notes: $m('entNotes').value.trim()
    }), 90000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    const back = reopenView && editEntId;
    closeEnt(); toast(old ? 'Entity updated.' : 'Entity added.');
    await loadData();
    if (back) openView(back);
  } catch (err) { toast('Could not save: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Save';
};

/* ---------- Entity details: contact info, first / latest transaction, notes, all cards ---------- */
const PAST = { buy: 'Bought', sell: 'Sold', trade: 'Traded' };
let viewId = '';
function txLine(t) { return t ? `${PAST[t[1]] || ''} \u00b7 ${fmtDay(t[2])} \u00b7 ${mkPhp(t[3])}` : ''; }
function openView(id) {
  const e = findEnt(id); if (!e) return;
  viewId = id;
  const mine = data.tx.filter(t => t[0] === e.name && String(t[2] || '').slice(0, 10)).sort((a, b) => String(a[2]).slice(0, 10).localeCompare(String(b[2]).slice(0, 10)));
  const a = aggregate('', '')[e.name] || {};
  const totals = [['Bought', a.buy], ['Sold', a.sell], ['Traded', a.trade]].filter(([, s]) => s && s.n).map(([l, s]) => `${l} ${s.n} \u00b7 ${mkPhp(s.v)}`);
  const row = (label, html) => `<div class="ed-row"><small>${label}</small>${html || '<span class="ed-none">Not set</span>'}</div>`;
  const fb = fbUrl(e.facebook);
  $m('entViewBody').innerHTML = `<div class="ed-head"><b>${escMk(e.name)}</b>${e.aliases.length ? `<span>Also spelled: ${e.aliases.map(escMk).join(', ')}</span>` : ''}</div>
    ${row('Contact number', e.contact && `<a href="tel:${escMk(e.contact.replace(/\s+/g, ''))}">${escMk(e.contact)}</a>`)}
    ${row('Address', e.address && `<span>${escMk(e.address).replace(/\n/g, '<br>')}</span>`)}
    ${row('Email', e.email && `<a href="mailto:${escMk(e.email)}">${escMk(e.email)}</a>`)}
    ${row('Facebook', fb && `<a href="${escMk(fb)}" target="_blank" rel="noopener">${escMk(e.facebook)}</a>`)}
    ${row('Payment methods', e.payment.length && `<div class="ed-chips">${e.payment.map(p => `<span class="chip">${escMk(p)}</span>`).join('')}</div>`)}
    ${row('First transaction', mine.length && `<span>${escMk(txLine(mine[0]))}</span>`) .replace('Not set', 'No dated transactions yet')}
    ${row('Most recent transaction', mine.length && `<span>${escMk(txLine(mine[mine.length - 1]))}</span>`).replace('Not set', 'No dated transactions yet')}
    ${row('Totals', totals.length && `<span>${totals.join('<br>')}</span>`).replace('Not set', 'No cards yet')}
    <div class="ed-row"><small>Notes</small>
      <textarea class="ed-notes" id="entViewNotes" rows="3" maxlength="1000" placeholder="Add a note about this entity">${escMk(e.notes)}</textarea>
      <button type="button" class="ghost sm" id="entViewNotesSave" style="margin-top:6px">Save notes</button></div>`;
  $m('entViewCards').hidden = true; $m('entViewCards').innerHTML = '';
  $m('entViewLoad').textContent = 'Load purchased, sold & traded cards'; $m('entViewLoad').disabled = false;
  $m('entView').hidden = false;
}
const closeView = () => { $m('entView').hidden = true; viewId = ''; };
$m('entViewClose').onclick = closeView;
$m('entView').addEventListener('click', e => { if (e.target.id === 'entView') closeView(); });
$m('entViewEdit').onclick = () => { const id = viewId; closeView(); openEnt(id, true); };
$m('entViewBody').addEventListener('click', async e => {
  if (e.target.id !== 'entViewNotesSave') return;
  const ent = findEnt(viewId); if (!ent) return;
  const notes = $m('entViewNotes').value.trim(), btn = e.target;
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const res = await jsonp(api('saveEntity', entParams(ent, { notes })), 60000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    ent.notes = notes; cacheSet('entities', data); toast('Notes saved.');
  } catch (err) { toast('Could not save notes: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Save notes';
});
$m('entViewLoad').onclick = async () => {
  const ent = findEnt(viewId); if (!ent) return;
  const btn = $m('entViewLoad'); btn.disabled = true; btn.textContent = 'Loading\u2026';
  try {
    const res = await jsonp(api('entityCards', { entityId: ent.id }), 60000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    const cards = res.cards || [];
    const html = [['buy', 'Purchased'], ['sell', 'Sold'], ['trade', 'Traded']].map(([k, label]) => {
      const list = cards.filter(x => x.kind === k).sort((x, y) => String(y.date).localeCompare(String(x.date)));
      if (!list.length) return '';
      return `<div class="ed-group">${label}<span>${plural(list.length, 'card')} \u00b7 ${mkPhp(list.reduce((s, x) => s + x.value, 0))}</span></div>`
        + list.map(x => `<div class="ed-card">${x.photo ? `<img src="${escMk(x.photo)}" alt="" loading="lazy">` : '<div class="ed-noimg"></div>'}
            <div><b>${escMk(x.name)}</b><small>${fmtDay(x.date) || 'No date'}</small></div><em>${mkPhp(x.value)}</em></div>`).join('');
    }).join('');
    $m('entViewCards').innerHTML = html || '<p class="stub-note" style="text-align:center">No cards on record for this entity.</p>';
    $m('entViewCards').hidden = false;
    btn.textContent = 'Reload cards';
  } catch (err) { toast('Could not load cards: ' + backendErr(err)); btn.textContent = 'Load purchased, sold & traded cards'; }
  btn.disabled = false;
};

/* ---------- Merge ---------- */
let mergeFrom = '', mergeInto = '';
function renderMergeList() {
  const q = $m('mergeSearch').value.trim().toLowerCase();
  const list = data.entities.filter(e => e.id !== mergeFrom && (!q || [e.name].concat(e.aliases).join(' ').toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  $m('mergeList').innerHTML = list.length
    ? list.map(e => `<button type="button" class="rs-item mg-item${e.id === mergeInto ? ' on' : ''}" data-id="${escMk(e.id)}" style="grid-template-columns:1fr"><span><b>${escMk(e.name)}</b>${e.aliases.length ? escMk(e.aliases.join(', ')) : ''}</span></button>`).join('')
    : '<p class="stub-note" style="margin:6px 0">No other entities.</p>';
  $m('mergeGo').disabled = !mergeInto;
}
function openMerge(id) {
  const e = findEnt(id); if (!e) return;
  mergeFrom = id; mergeInto = ''; $m('mergeSearch').value = '';
  $m('mergeText').innerHTML = `Merge <b>${escMk(e.name)}</b> into another entity. Everything recorded under it moves to the one you pick, and <b>${escMk(e.name)}</b> is removed.`;
  renderMergeList();
  $m('mergeSheet').hidden = false;
}
const closeMerge = () => { $m('mergeSheet').hidden = true; mergeFrom = mergeInto = ''; };
$m('mergeCancel').onclick = closeMerge;
$m('mergeSheet').addEventListener('click', e => { if (e.target.id === 'mergeSheet') closeMerge(); });
$m('mergeSearch').addEventListener('input', renderMergeList);
$m('mergeList').addEventListener('click', e => {
  const b = e.target.closest('.mg-item'); if (!b) return;
  mergeInto = b.dataset.id; renderMergeList();
});
$m('mergeGo').onclick = async () => {
  const from = findEnt(mergeFrom), into = findEnt(mergeInto);
  if (!from || !into) return;
  if (!confirm(`Merge "${from.name}" into "${into.name}"?\n\nAll receipts, cards and finance entries will use "${into.name}". This cannot be undone.`)) return;
  const btn = $m('mergeGo'); btn.disabled = true; btn.textContent = 'Merging\u2026';
  try {
    const res = await jsonp(api('mergeEntities', { fromIds: from.id, intoId: into.id }), 90000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    closeMerge(); toast(`Merged into ${into.name}.`);
    await loadData();
  } catch (err) { toast('Could not merge: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Merge';
};

/* ---------- List actions ---------- */
$m('entList').addEventListener('click', async e => {
  const edit = e.target.closest('.ent-edit'); if (edit) return openEnt(edit.dataset.id);
  const merge = e.target.closest('.ent-merge'); if (merge) return openMerge(merge.dataset.id);
  const del = e.target.closest('.ent-del');
  if (del) {
    const ent = findEnt(del.dataset.id); if (!ent || !confirm(`Delete "${ent.name}"?`)) return;
    del.disabled = true;
    try {
      const res = await jsonp(api('deleteEntity', { entityId: ent.id }), 60000);
      if (!res.ok) throw new Error(res.error || 'Request failed');
      toast('Entity deleted.'); await loadData();
    } catch (err) { del.disabled = false; toast('Could not delete: ' + backendErr(err)); }
    return;
  }
  const card = e.target.closest('.ent-card'); if (card) openView(card.dataset.id);
});

loadData();
