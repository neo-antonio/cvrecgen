/* ---------- Commercial — target sale prices for onhand cards, and how sold cards performed against them ----------
   Reads the same `portfolio` feed as Portfolio. Target prices are saved per card through Code.gs `setTargets`
   (see Code.gs.commercial-patch.gs). Lots use the existing setLot / clearLot actions. */
(function () {
const $ = id => document.getElementById(id);
const php = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = x => Math.round(x * 100) / 100;
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const signed = n => (n > 0 ? '+' : n < 0 ? '\u2212' : '') + php(Math.abs(n));
const pctTxt = n => (n > 0 ? '+' : n < 0 ? '\u2212' : '') + Math.abs(n).toFixed(1) + '%';

let tab = 'onhand', sub = 'all', query = '';
let data = { cards: [] };
const openLots = new Set();

const normPort = d => ({ cards: (Array.isArray(d.cards) ? d.cards : (d.owned || []).concat(d.sold || [])).map(c => c.tag === 'shipped' ? Object.assign({}, c, { tag: 'sold' }) : c) });
const findCard = id => data.cards.find(c => String(c.id) === String(id));
const allLotCards = id => data.cards.filter(c => String(c.lotId) === String(id));
const targetOf = c => { const t = num(c.targetPrice); return t > 0 ? t : 0; };            // low end (or the single price)
const targetHiOf = c => { const lo = targetOf(c), hi = num(c.targetMax); return lo > 0 && hi > lo ? hi : lo; };   // top of the range (= low when single)
const money = n => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rangeTxt = (lo, hi) => hi > lo ? 'PHP ' + money(lo) + ' \u2013 ' + money(hi) : php(lo);
const pctRange = (a, b) => a === b || Math.abs(a - b) < 0.05 ? pctTxt(a) : pctTxt(a) + ' to ' + pctTxt(b);

function toast(m) {
  const t = $('cmToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800);
}
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
const fmtDay = v => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};

const ICON = {
  target: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>',   // price tag, same as the Commercial app icon
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  unlink: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/><path d="M4 4l16 16"/>'
};
const icon = (name, cls, label, id) => `<button type="button" class="icon-btn ${cls}" data-id="${esc(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg></button>`;

/* ---------- numbers ----------
   Onhand: expected profit = target - cost (a range when the target is a range).  Sold: profit = sold price - cost.
   Margin % is profit as a share of the selling price (the target for onhand, the sold price for sold).
   Sold vs a range: below the low end = below target; inside = in range; above the top = above range. */
function metrics(cards, sold) {
  const cost = cards.reduce((a, c) => a + num(c.purchaseCost), 0);
  const priced = cards.every(c => targetOf(c) > 0);
  const tLo = priced ? r2(cards.reduce((a, c) => a + targetOf(c), 0)) : 0, tHi = priced ? r2(cards.reduce((a, c) => a + targetHiOf(c), 0)) : 0;
  const range = priced && tHi > tLo;
  const sale = sold ? cards.reduce((a, c) => a + num(c.soldPrice), 0) : tLo;
  const have = sold ? true : priced;
  const profit = have ? r2(sale - cost) : 0;
  const pct = have && sale > 0 ? profit / sale * 100 : 0;
  const profitHi = r2(tHi - cost), pctHi = tHi > 0 ? profitHi / tHi * 100 : 0;
  let status = 'none';
  if (priced) status = sold ? (r2(sale) < tLo ? 'missed' : (range && r2(sale) > tHi ? 'above' : 'met')) : 'priced';
  return { cost, sale, tLo, tHi, range, target: tLo, priced, profit, pct, profitHi, pctHi, status, have };
}
const chip = m => !m.have ? '<span class="cm-chip none">No target</span>'
  : m.range && m.profitHi !== undefined && m.status === 'priced'
    ? `<span class="cm-chip ${m.profitHi >= 0 && m.profit >= 0 ? 'pos' : m.profit < 0 && m.profitHi < 0 ? 'neg' : 'none'}">${signed(m.profit)} to ${signed(m.profitHi)}</span><span class="cm-tgt">${pctRange(m.pct, m.pctHi)}</span>`
    : `<span class="cm-chip ${m.profit >= 0 ? 'pos' : 'neg'}">${signed(m.profit)} \u00b7 ${pctTxt(m.pct)}</span>`;
const statusChip = (s, range) => s === 'met' ? `<span class="cm-chip pos">${range ? 'In range' : 'Met target'}</span>` : s === 'above' ? '<span class="cm-chip pos">Above range</span>' : s === 'missed' ? '<span class="cm-chip neg">Below target</span>' : '<span class="cm-chip none">No target</span>';
const tgtLine = m => m.priced ? (m.range ? 'Target ' + rangeTxt(m.tLo, m.tHi) : 'Target ' + php(m.tLo)) : 'No target';

/* ---------- rendering ---------- */
function unitsOf(list) {
  const out = [], groups = {};
  list.forEach(c => {
    if (!c.lotId) return out.push({ card: c });
    let g = groups[c.lotId];
    if (!g) { g = groups[c.lotId] = { lot: true, id: String(c.lotId), name: c.lotName || 'Lot', cards: [] }; out.push(g); }
    g.cards.push(c);
  });
  return out;
}
const thumb = (c, alt) => c && c.photo ? `<img src="${esc(c.photo)}" alt="${esc(alt)}" loading="lazy" class="port-clickphoto" data-full="${esc(c.photo)}">` : '<div class="port-noimg">No photo</div>';

function cardHtml(c, inLot) {
  const sold = tab === 'sold', pend = tab === 'pending', m = metrics([c], sold);
  const info = sold
    ? `<span>Sold ${c.soldDate ? fmtDay(c.soldDate) : '\u2014'}</span><span class="cm-line">Cost ${php(c.purchaseCost)}</span>`
    : `<span>Cost ${php(c.purchaseCost)}</span>` + (pend ? `<span class="cm-line">Awaiting payment${c.soldTo ? ' \u00b7 ' + esc(c.soldTo) : ''}</span>` : '');
  const right = sold
    ? `<div class="port-cost">${php(c.soldPrice)}</div><span class="cm-tgt">${tgtLine(m)}</span>${m.priced ? statusChip(m.status, m.range) : ''}${chip(m)}`
    : `<div class="port-cost">${m.priced ? rangeTxt(m.tLo, m.tHi) : '<span class="cm-tgt">No target</span>'}</div>${m.priced ? '<span class="cm-tgt">Target</span>' : ''}${m.priced ? chip(m) : ''}`;
  const acts = icon('target', 'cm-target', m.priced ? 'Edit target price' : 'Set target price', c.id) + (inLot && !sold && !pend ? icon('unlink', 'cm-unlot', 'Remove from lot', c.id) : '');
  return `<div class="port-card" data-id="${esc(c.id)}">
      <div class="port-card-main">
        <div class="port-thumb">${thumb(c, c.name)}</div>
        <div class="port-info"><b>${esc(c.name)}</b>${info}</div>
        <div class="port-right cm-right">${right}</div>
      </div>
      <div class="port-card-acts">${acts}</div>
    </div>`;
}
function lotHtml(g) {
  const sold = tab === 'sold', pend = tab === 'pending', open = openLots.has(g.id), m = metrics(g.cards, sold);
  const first = g.cards.find(c => c.photo);
  const right = sold
    ? `<div class="port-cost">${php(m.sale)}</div><span class="cm-tgt">${tgtLine(m)}</span>${m.priced ? statusChip(m.status, m.range) : ''}${chip(m)}`
    : `<div class="port-cost">${m.priced ? rangeTxt(m.tLo, m.tHi) : '<span class="cm-tgt">No target</span>'}</div>${m.priced ? '<span class="cm-tgt">Target</span>' + chip(m) : ''}`;
  const acts = icon('target', 'cm-lot-target', 'Set lot target price', g.id)
    + (sold || pend ? '' : icon('pencil', 'cm-lot-rename', 'Rename lot', g.id) + icon('plus', 'cm-lot-add', 'Add cards to lot', g.id) + icon('unlink', 'cm-lot-ungroup', 'Ungroup lot', g.id));
  return `<div class="port-card lot-group" data-lot="${esc(g.id)}">
      <div class="port-card-main lot-head" data-lot="${esc(g.id)}">
        <div class="port-thumb">${first ? `<img src="${esc(first.photo)}" alt="" loading="lazy">` : '<div class="port-noimg">No photo</div>'}</div>
        <div class="port-info"><b><span class="lot-pill">LOT</span>${esc(g.name)}</b><span>${g.cards.length} card${g.cards.length === 1 ? '' : 's'} \u00b7 Cost ${php(m.cost)}</span></div>
        <div class="port-right cm-right"><span class="lot-chev${open ? ' open' : ''}" aria-hidden="true"></span>${right}</div>
      </div>
      <div class="port-card-acts">${acts}</div>
      <div class="lot-members"${open ? '' : ' hidden'}>${g.cards.map(c => cardHtml(c, true)).join('')}</div>
    </div>`;
}

function render() {
  const sold = tab === 'sold';
  $('cmFilters').hidden = !sold;
  $('cmNewLot').hidden = sold || tab === 'pending';
  $('cmLabel').textContent = sold ? 'Total profit' : tab === 'pending' ? 'Pending target value' : 'Target value';
  let list = data.cards.filter(c => c.tag === tab);   // tab is onhand, pending or sold: the same names as the card tags
  if (query) list = list.filter(c => String(c.name || '').toLowerCase().includes(query) || String(c.lotName || '').toLowerCase().includes(query));
  let units = unitsOf(list);
  if (sold && sub !== 'all') units = units.filter(u => { const st = metrics(u.lot ? u.cards : [u.card], true).status; return sub === 'met' ? (st === 'met' || st === 'above') : st === sub; });
  const cards = units.reduce((a, u) => a.concat(u.lot ? u.cards : [u.card]), []);
  if (!cards.length) {
    $('cmState').textContent = data.cards.length ? 'No cards match your search/filter.' : 'No cards yet.';
    $('cmState').hidden = false; $('cmList').hidden = true;
    $('cmTotal').textContent = php(0); $('cmCount').textContent = '0 cards'; $('cmStats').textContent = '';
    return;
  }
  $('cmList').innerHTML = units.map(u => u.lot ? lotHtml(u) : cardHtml(u.card)).join('');
  $('cmCount').textContent = cards.length + (cards.length === 1 ? ' card' : ' cards');
  if (sold) {
    const cost = cards.reduce((a, c) => a + num(c.purchaseCost), 0), rev = cards.reduce((a, c) => a + num(c.soldPrice), 0), profit = r2(rev - cost);
    const st = units.map(u => metrics(u.lot ? u.cards : [u.card], true).status);
    const met = st.filter(s => s === 'met' || s === 'above').length, withT = st.filter(s => s !== 'none').length;
    $('cmTotal').textContent = signed(profit);
    $('cmStats').innerHTML = `Sold <b>${php(rev)}</b> on a cost of <b>${php(cost)}</b> \u00b7 margin <b>${rev > 0 ? pctTxt(profit / rev * 100) : '\u2014'}</b><br>Met target: <b>${met} of ${withT}</b> with a target`;
  } else {
    const priced = cards.filter(c => targetOf(c) > 0), tgt = r2(priced.reduce((a, c) => a + targetOf(c), 0)), tgtHi = r2(priced.reduce((a, c) => a + targetHiOf(c), 0)), pcost = priced.reduce((a, c) => a + num(c.purchaseCost), 0);
    const profit = r2(tgt - pcost), profitHi = r2(tgtHi - pcost);
    $('cmTotal').textContent = rangeTxt(tgt, tgtHi);
    $('cmStats').innerHTML = `<b>${priced.length} of ${cards.length}</b> cards have a target \u00b7 cost of those <b>${php(pcost)}</b><br>Expected profit <b>${tgtHi > tgt ? signed(profit) + ' to ' + signed(profitHi) : signed(profit)}</b>${tgt > 0 ? ' (' + (tgtHi > tgt ? pctRange(profit / tgt * 100, profitHi / tgtHi * 100) : pctTxt(profit / tgt * 100)) + ' margin)' : ''}`;
  }
  $('cmState').hidden = true; $('cmList').hidden = false;
}

/* ---------- load ---------- */
let first = true;
async function load() {
  if (!CONFIG.portfolio.endpoint) { $('cmState').textContent = "Sync isn't set up yet."; $('cmState').hidden = false; $('cmList').hidden = true; return; }
  const cached = first ? cacheGet('portfolio') : null; first = false;
  if (cached) { data = normPort(cached); render(); }
  else { $('cmState').textContent = 'Loading\u2026'; $('cmState').hidden = false; $('cmList').hidden = true; }
  try {
    const d = await jsonp(CONFIG.portfolio.endpoint + '?action=portfolio&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
    if (!d.ok) throw new Error(d.error || 'Unknown error');
    data = normPort(d); cacheSet('portfolio', data); render();
  } catch (err) {
    console.warn('Commercial load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    $('cmState').textContent = "Couldn't load your cards (offline, wrong secret, or Code.gs needs a new deployment).";
    $('cmState').hidden = false; $('cmList').hidden = true;
  }
}

document.querySelectorAll('[data-ctab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('[data-ctab]').forEach(x => x.classList.toggle('active', x === t));
  tab = t.dataset.ctab; render();
});
document.querySelectorAll('#cmFilters .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#cmFilters .chip').forEach(x => x.classList.toggle('active', x === c));
  sub = c.dataset.sub; render();
});
$('cmSearch').addEventListener('input', () => { query = $('cmSearch').value.trim().toLowerCase(); render(); });
$('cmRefresh').onclick = load;

/* ---------- backend calls ---------- */
async function call(action, params) {
  const url = CONFIG.portfolio.endpoint + '?action=' + action + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('') + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const d = await jsonp(url);
  if (!d.ok) throw new Error(d.error || 'Request failed');
}
async function lotBatches(action, ids, extra) {
  for (let i = 0; i < ids.length; i += 25) await call(action, Object.assign({ cardIds: ids.slice(i, i + 25).join(',') }, extra || {}));
}
async function targetBatches(pairs) {   // pairs: [[cardId, low|'', high|'']]
  for (let i = 0; i < pairs.length; i += 25) await call('setTargets', { pairs: pairs.slice(i, i + 25).map(p => p[0] + ':' + p[1] + ':' + p[2]).join(',') });
}

/* ---------- target editor: one card, or a whole lot (lot total split evenly, then adjustable per card).
   Every price can be a single figure or a range: leave "To" empty for a single price. ---------- */
let tgtIds = [];
const rowVals = () => [...document.querySelectorAll('#tgtRows .cm-row')].map(r => {
  const lo = r.querySelector('[data-k=lo]').value, hi = r.querySelector('[data-k=hi]').value;
  return { id: r.dataset.id, lo: lo === '' ? 0 : num(lo), hi: hi === '' ? 0 : num(hi) };
});
function tgtSum() {
  const v = rowVals(), lo = v.reduce((a, x) => a + x.lo, 0), hi = v.reduce((a, x) => a + (x.hi > x.lo ? x.hi : x.lo), 0);
  $('tgtSum').textContent = hi > lo ? 'PHP ' + money(lo) + ' \u2013 ' + money(hi) : php(lo);
  $('tgtSumLbl').textContent = tgtIds.length > 1 ? 'Lot target' : 'Target';
}
function openTarget(ids) {
  tgtIds = ids.map(String);
  const cards = tgtIds.map(findCard).filter(Boolean);
  if (!cards.length) return;
  const lot = cards.length > 1;
  $('tgtTitle').textContent = lot ? 'Lot target price' : 'Target sale price';
  $('tgtHint').textContent = (lot ? 'Set a lot total and split it, or type a price for each card. ' : cards[0].name + '. ') + 'Fill in "To" as well for a price range.';
  $('tgtLotWrap').hidden = !lot;
  const priced = cards.every(c => targetOf(c) > 0), tl = priced ? cards.reduce((a, c) => a + targetOf(c), 0) : 0, th = priced ? cards.reduce((a, c) => a + targetHiOf(c), 0) : 0;
  $('tgtLotLo').value = tl ? r2(tl) : ''; $('tgtLotHi').value = th > tl ? r2(th) : '';
  $('tgtRows').innerHTML = cards.map(c => `<div class="cm-row" data-id="${esc(c.id)}"><div>${esc(c.name)}<small>Cost ${php(c.purchaseCost)}${c.tag === 'sold' ? ' \u00b7 sold ' + php(c.soldPrice) : ''}</small></div><div class="cm-pair"><div class="money"><em>From</em><input type="number" inputmode="decimal" min="0" step="0.01" data-k="lo" value="${targetOf(c) || ''}" placeholder="0.00"></div><div class="money"><em>To</em><input type="number" inputmode="decimal" min="0" step="0.01" data-k="hi" value="${targetHiOf(c) > targetOf(c) ? targetHiOf(c) : ''}" placeholder="optional"></div></div></div>`).join('');
  tgtSum();
  $('tgtSheet').hidden = false;
}
$('tgtRows').addEventListener('input', tgtSum);
const splitCents = (total, n) => { const cents = Math.round(total * 100), base = Math.floor(cents / n), extra = cents - base * n; return Array.from({ length: n }, (_, k) => (base + (k < extra ? 1 : 0)) / 100); };
$('tgtSplit').onclick = () => {
  const lo = num($('tgtLotLo').value), hi = num($('tgtLotHi').value), rows = [...document.querySelectorAll('#tgtRows .cm-row')];
  if (!(lo > 0) || !rows.length) return toast('Enter the lot total first.');
  if ($('tgtLotHi').value !== '' && hi <= lo) return toast('The "To" total must be higher than "From".');
  const a = splitCents(lo, rows.length), b = hi > lo ? splitCents(hi, rows.length) : null;
  rows.forEach((r, k) => { r.querySelector('[data-k=lo]').value = a[k].toFixed(2); r.querySelector('[data-k=hi]').value = b ? b[k].toFixed(2) : ''; });
  tgtSum();
};
['tgtLotLo', 'tgtLotHi'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('tgtSplit').click(); } }));
const closeTarget = () => { $('tgtSheet').hidden = true; tgtIds = []; };
$('tgtCancel').onclick = closeTarget;
$('tgtSheet').addEventListener('click', e => { if (e.target.id === 'tgtSheet') closeTarget(); });
async function saveTargets(clear) {
  const v = rowVals();
  if (!clear) {
    const bad = v.find(x => (x.hi > 0 && x.lo <= 0) || (x.hi > 0 && x.hi <= x.lo));
    if (bad) return toast(bad.lo <= 0 ? 'Enter the "From" price before a "To" price.' : 'The "To" price must be higher than "From".');
  }
  const pairs = v.map(x => [x.id, clear || x.lo <= 0 ? '' : r2(x.lo), clear || x.lo <= 0 || x.hi <= x.lo ? '' : r2(x.hi)]);
  const btn = clear ? $('tgtClear') : $('tgtSave'); btn.disabled = true;
  try { await targetBatches(pairs); closeTarget(); toast(clear ? 'Target cleared.' : 'Target saved.'); await load(); }
  catch (err) { toast('Could not save: ' + backendErr(err)); }
  btn.disabled = false;
}
$('tgtSave').onclick = () => saveTargets(false);
$('tgtClear').onclick = () => saveTargets(true);

/* ---------- lots: create, add cards, remove a card, rename, ungroup ---------- */
let lotAddId = null, lotCreate = false; const lotAddSel = new Set();
function lotAddRender() {
  const q = $('lotAddSearch').value.trim().toLowerCase();
  const cand = data.cards.filter(c => c.tag === 'onhand' && !c.lotId && (!q || String(c.name || '').toLowerCase().includes(q)));
  $('lotAddList').innerHTML = cand.length
    ? cand.map(c => `<label class="chk"><input type="checkbox" value="${esc(c.id)}"${lotAddSel.has(String(c.id)) ? ' checked' : ''}>${c.photo ? `<img class="cn-thumb" src="${esc(c.photo)}" alt="" loading="lazy">` : '<span class="cn-thumb none"></span>'}<span>${esc(c.name)} <small>\u2014 bought ${php(c.purchaseCost)}</small></span></label>`).join('')
    : '<p class="stub-note" style="margin:10px 0 4px">No loose onhand cards to add.</p>';
  const n = lotAddSel.size;
  $('lotAddSave').textContent = lotCreate ? (n ? `Create lot of ${n}` : 'Create lot') : (n ? `Add ${n} card${n > 1 ? 's' : ''}` : 'Add to lot');
}
function openLotSheet(createMode, id) {
  lotCreate = createMode; lotAddId = id || null; lotAddSel.clear();
  $('lotAddSearch').value = ''; $('lotAddName').value = '';
  $('lotAddNameWrap').hidden = !createMode;
  $('lotAddTitle').textContent = createMode ? 'New lot' : 'Add cards to lot';
  lotAddRender(); $('lotAddSheet').hidden = false;
}
const closeLotSheet = () => { $('lotAddSheet').hidden = true; lotAddId = null; lotCreate = false; };
$('lotAddSearch').addEventListener('input', lotAddRender);
$('lotAddList').addEventListener('change', e => { if (e.target.matches('input[type=checkbox]')) { e.target.checked ? lotAddSel.add(e.target.value) : lotAddSel.delete(e.target.value); lotAddRender(); } });
$('lotAddCancel').onclick = closeLotSheet;
$('cmNewLot').onclick = () => openLotSheet(true);
$('lotAddSave').onclick = async () => {
  const ids = [...lotAddSel], btn = $('lotAddSave');
  if (lotCreate && ids.length < 2) return toast('Pick at least two cards for a lot.');
  if (!ids.length) return toast('Pick at least one card.');
  let id = lotAddId, name;
  if (lotCreate) { id = 'lot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); name = $('lotAddName').value.trim() || `Lot of ${ids.length} cards`; }
  else name = (allLotCards(id)[0] || {}).lotName || '';
  btn.disabled = true;
  try { await lotBatches('setLot', ids, { lotId: id, lotName: name }); openLots.add(id); const made = lotCreate; closeLotSheet(); toast(made ? 'Lot created.' : `Added ${ids.length} card${ids.length > 1 ? 's' : ''} to the lot.`); await load(); }
  catch (err) { toast('Could not save: ' + backendErr(err)); }
  btn.disabled = false;
};

$('cmList').addEventListener('click', async e => {
  const ph = e.target.closest('.port-clickphoto');
  if (ph) { $('imgViewImg').src = ph.dataset.full; $('imgView').hidden = false; return; }
  const head = e.target.closest('.lot-head');
  if (head && !e.target.closest('button')) {
    const id = head.dataset.lot; openLots.has(id) ? openLots.delete(id) : openLots.add(id);
    head.nextElementSibling.nextElementSibling.hidden = !openLots.has(id);
    head.querySelector('.lot-chev').classList.toggle('open', openLots.has(id));
    return;
  }
  const t = e.target.closest('.cm-target'); if (t) return openTarget([t.dataset.id]);
  const lt = e.target.closest('.cm-lot-target');
  if (lt) { const wanted = tab; return openTarget(allLotCards(lt.dataset.id).filter(c => c.tag === wanted).map(c => c.id)); }
  const add = e.target.closest('.cm-lot-add'); if (add) return openLotSheet(false, add.dataset.id);
  const ren = e.target.closest('.cm-lot-rename');
  if (ren) {
    const cards = allLotCards(ren.dataset.id), cur = (cards[0] || {}).lotName || '';
    const name = prompt('Edit lot name', cur);
    if (name === null || !name.trim() || name.trim() === cur) return;
    try { await lotBatches('setLot', cards.map(c => c.id), { lotId: ren.dataset.id, lotName: name.trim() }); toast('Lot renamed.'); await load(); }
    catch (err) { toast('Could not rename: ' + backendErr(err)); }
    return;
  }
  const ung = e.target.closest('.cm-lot-ungroup');
  if (ung) {
    const cards = allLotCards(ung.dataset.id);
    if (!confirm(`Ungroup this lot? Its ${cards.length} cards stay in your portfolio as individual cards.`)) return;
    try { await lotBatches('clearLot', cards.map(c => c.id)); openLots.delete(ung.dataset.id); toast('Lot ungrouped.'); await load(); }
    catch (err) { toast('Could not ungroup: ' + backendErr(err)); }
    return;
  }
  const un = e.target.closest('.cm-unlot');
  if (un) {
    if (!confirm('Remove this card from its lot? It stays in your portfolio as an individual card.')) return;
    un.disabled = true;
    try { await lotBatches('clearLot', [un.dataset.id]); toast('Removed from the lot.'); await load(); }
    catch (err) { un.disabled = false; toast('Could not remove: ' + backendErr(err)); }
  }
});

$('imgViewClose').onclick = () => $('imgView').hidden = true;
$('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') $('imgView').hidden = true; });

load();
})();
