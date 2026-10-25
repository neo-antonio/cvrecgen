/* ---------- Portfolio — one list of every card, filtered by status chip; reads back from Cards via Code.gs doGet ---------- */
const portPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $portList = document.getElementById('portList');
const $portState = document.getElementById('portState');
const $portTotal = document.getElementById('portTotal');
const $portSummaryLabel = document.querySelector('.port-summary span');
const $portCount = document.getElementById('portCount');
const $portRefresh = document.getElementById('portRefresh');
const $portSearch = document.getElementById('portSearch');

let statusFilter = 'onhand';
let searchQuery = '';
let portData = { cards: [] };

// still in our hands (onhand, sold but not yet shipped, held for safekeep, or on a shipping task that is not paid yet) vs. gone (shipped / sold / traded)
// pending cards have no sale price yet, so they stay valued at cost until the sale receipt is linked
const isOwned = it => it.tag === 'onhand' || it.tag === 'shipping' || it.tag === 'pending' || it.tag === 'safekeep';
// Code.gs now sends one `cards` list; against an older deploy (or an older cached copy) merge owned + sold
// "shipped" no longer exists as a separate state: once shipped, a card is sold (older Code.gs / cached copies still send "shipped")
const normPort = d => ({ cards: (Array.isArray(d.cards) ? d.cards : (d.owned || []).concat(d.sold || [])).map(c => c.tag === 'shipped' ? Object.assign({}, c, { tag: 'sold' }) : c) });

const TAG_LABEL = { onhand: 'Onhand', pending: 'Pending', shipping: 'Shipping', shipped: 'Shipped', sold: 'Sold', safekeep: 'Safekeep', traded: 'Traded' };

function toast(m) {
  const t = document.getElementById('portToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

function fmtCardDate(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* A card can carry two receipts: where it came from (purchase, or the trade that brought it in)
   and where it went (sale, or the trade that took it out). Newer Code.gs sends them as
   it.receipts [{label,url,link}]; against an older one we rebuild from the two raw URL fields. */
function receiptsFor(it) {
  if (Array.isArray(it.receipts)) return it.receipts.filter(r => r && (r.url || r.link));
  const out = [];
  if (it.purchaseReceipt) out.push({ label: 'Purchase receipt', url: '', link: it.purchaseReceipt });
  if (it.saleReceipt) out.push({ label: 'Sale receipt', url: '', link: it.saleReceipt });
  return out;
}
const findCard = id => portData.cards.find(c => String(c.id) === String(id));

const ICON = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>', camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.4"/>', doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>', trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'
};
Object.assign(ICON, { box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5"/><path d="M12 12v9"/>', plus: '<path d="M12 5v14M5 12h14"/>', unlink: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/><path d="M4 4l16 16"/>' });
const icon = (name, cls, label, id) => `<button type="button" class="icon-btn ${cls}" data-id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg></button>`;

/* Days held: purchase date until the sale / trade date. Cards still on hand count up to today. */
const parseDay = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
function heldLine(it) {
  const a = parseDay(it.purchaseDate); if (!a) return '';
  const ongoing = it.tag === 'onhand' || it.tag === 'pending';
  let b = ongoing ? new Date() : parseDay(it.soldDate);
  if (!b) return '';
  b = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const days = Math.max(0, Math.round((b - a) / 86400000));
  return ongoing ? `${days} day${days === 1 ? '' : 's'}` : `Held ${days} day${days === 1 ? '' : 's'}`;
}

function cardHtml(it, inLot) {
  const img = it.photo
    ? `<img src="${it.photo}" alt="${escHtml(it.name)}" loading="lazy" class="port-clickphoto" data-full="${it.photo}">`
    : `<div class="port-noimg">No photo</div>`;
  const owned = isOwned(it);
  const pend = it.tag === 'pending', safe = it.tag === 'safekeep';
  const dateLine = safe ? 'Sold ' + (fmtCardDate(it.soldDate) || '\u2014') + ' \u00b7 held for safekeep' : owned ? 'Bought ' + fmtCardDate(it.purchaseDate) : (it.tag === 'sold' && !it.soldDate ? 'Shipped \u00b7 sale receipt pending' : (it.tag === 'traded' ? 'Traded ' : 'Sold ') + fmtCardDate(it.soldDate));
  const costLine = owned ? it.purchaseCost : it.soldPrice;
  const held = heldLine(it);
  const rcpts = receiptsFor(it);
  const renameBtn = icon('pencil', 'port-rename', 'Edit name', it.id);
  const photoBtn = icon('camera', 'port-photo', it.photo ? 'Change photo' : 'Add photo', it.id);
  const receiptBtn = rcpts.length ? icon('doc', 'port-receipt', rcpts.length > 1 ? 'Receipts' : 'Receipt', it.id) : '';
  const revertBtn = (it.tag === 'shipping' || it.tag === 'pending' || it.tag === 'safekeep' || it.tag === 'shipped' || it.tag === 'traded') ? icon('undo', 'port-revert', 'Revert to onhand', it.id) : '';
  const safeBtn = (it.tag === 'shipping' || it.tag === 'sold') ? icon('box', 'port-safekeep', 'Move to safekeep (paid, kept for the buyer)', it.id) : '';   // paid cards only (waiting to ship, or sold); pending tasks are not paid
  const unlotBtn = inLot ? icon('unlink', 'port-unlot', 'Remove from lot', it.id) : '';
  const deleteBtn = icon('trash', 'port-delete danger', 'Delete card', it.id);
  return `<div class="port-card" data-id="${it.id}">
      <div class="port-card-main">
        <div class="port-thumb">${img}</div>
        <div class="port-info">
          <b>${escHtml(it.name)}</b>
          <span>${dateLine}</span>
          ${pend ? `<span class="port-held">Awaiting payment${it.soldTo ? ' \u00b7 ' + escHtml(it.soldTo) : ''}</span>` : ''}
          ${safe ? `<span class="port-held">Paid by ${escHtml(it.soldTo || '\u2014')} \u00b7 ${portPhp(it.soldPrice)}</span>` : ''}
          ${held ? `<span class="port-held">${held}</span>` : ''}
        </div>
        <div class="port-right">
          <span class="port-tag tag-${it.tag}">${TAG_LABEL[it.tag] || it.tag}</span>
          <div class="port-cost">${portPhp(costLine)}</div>
        </div>
      </div>
      <div class="port-card-acts">${renameBtn}${photoBtn}${receiptBtn}${safeBtn}${revertBtn}${unlotBtn}${deleteBtn}</div>
    </div>`;
}

/* ---------- Lots: cards bought (and sold) together are shown as one group ---------- */
const openLots = new Set();   // lots the user has expanded
const allLotCards = id => portData.cards.filter(c => String(c.lotId) === String(id));
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
function lotHtml(g) {
  const open = openLots.has(g.id);
  const value = g.cards.reduce((a, c) => a + (Number(isOwned(c) ? c.purchaseCost : c.soldPrice) || 0), 0);
  const tags = {}; g.cards.forEach(c => { tags[c.tag] = (tags[c.tag] || 0) + 1; });
  const tagTxt = Object.keys(tags).sort((a, b) => Object.keys(TAG_LABEL).indexOf(a) - Object.keys(TAG_LABEL).indexOf(b)).map(t => (Object.keys(tags).length > 1 ? tags[t] + ' ' : '') + (TAG_LABEL[t] || t)).join(' \u00b7 ');
  const first = g.cards.find(c => c.photo);
  const img = first ? `<img src="${first.photo}" alt="${escHtml(g.name)}" loading="lazy">` : '<div class="port-noimg">No photo</div>';
  return `<div class="port-card lot-group" data-lot="${escHtml(g.id)}">
      <div class="port-card-main lot-head" data-lot="${escHtml(g.id)}">
        <div class="port-thumb">${img}</div>
        <div class="port-info"><b><span class="lot-pill">LOT</span>${escHtml(g.name)}</b><span>${g.cards.length} card${g.cards.length === 1 ? '' : 's'} \u00b7 ${tagTxt}</span></div>
        <div class="port-right"><span class="lot-chev${open ? ' open' : ''}" aria-hidden="true"></span><div class="port-cost">${portPhp(value)}</div></div>
      </div>
      <div class="port-card-acts">${icon('pencil', 'lot-rename', 'Rename lot', g.id)}${icon('plus', 'lot-add', 'Add cards to lot', g.id)}${icon('unlink', 'lot-ungroup', 'Ungroup lot', g.id)}</div>
      <div class="lot-members"${open ? '' : ' hidden'}>${g.cards.map(c => cardHtml(c, true)).join('')}</div>
    </div>`;
}

/* The headline figure follows the filter: what we still hold is valued at cost (All / Onhand / Shipping),
   what has left is valued at its sale / trade price (Shipped / Sold / Traded). Search narrows it too. */
const SUMMARY_LABEL = { shipped: 'Total shipped', sold: 'Total sold', traded: 'Total traded' };
function renderTab() {
  const gone = statusFilter === 'shipped' || statusFilter === 'sold' || statusFilter === 'traded';
  $portSummaryLabel.textContent = gone ? SUMMARY_LABEL[statusFilter] : statusFilter === 'pending' ? 'Pending value' : statusFilter === 'safekeep' ? 'Safekeep value' : 'Onhand value';
  let list = portData.cards;
  if (statusFilter !== 'all') list = list.filter(i => i.tag === statusFilter);
  if (searchQuery) list = list.filter(i => (i.name || '').toLowerCase().includes(searchQuery) || (i.lotName || '').toLowerCase().includes(searchQuery));
  if (!list.length) {
    $portState.textContent = portData.cards.length ? 'No cards match your search/filter.' : 'No cards yet.';
    $portState.hidden = false; $portList.hidden = true;
    $portTotal.textContent = portPhp(0);
    $portCount.textContent = '0 cards';
    return;
  }
  $portList.innerHTML = unitsOf(list).map(u => u.lot ? lotHtml(u) : cardHtml(u.card)).join('');
  const total = gone
    ? list.reduce((a, i) => a + (Number(i.soldPrice) || 0), 0)
    : list.filter(isOwned).reduce((a, i) => a + (Number(i.purchaseCost) || 0), 0);
  $portTotal.textContent = portPhp(total);
  $portCount.textContent = list.length + (list.length === 1 ? ' card' : ' cards');   // follows the active chip + search, same as the total
  $portState.hidden = true; $portList.hidden = false;
}

let portFirst = true;
async function loadPortfolio() {
  if (!CONFIG.portfolio.endpoint) { $portState.textContent = "Portfolio sync isn't set up yet."; $portState.hidden = false; $portList.hidden = true; return; }
  const cached = portFirst ? cacheGet('portfolio') : null; portFirst = false;
  if (cached) { portData = normPort(cached); renderTab(); }
  else { $portState.textContent = 'Loading\u2026'; $portState.hidden = false; $portList.hidden = true; }
  try {
    const url = CONFIG.portfolio.endpoint + '?action=portfolio&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    portData = normPort(data);
    cacheSet('portfolio', portData);
    renderTab();
  } catch (err) {
    console.warn('Portfolio load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    $portState.textContent = "Couldn't load your portfolio (offline, wrong secret, or Code.gs needs a new deployment).";
    $portState.hidden = false;
    $portList.hidden = true;
  }
}

document.querySelectorAll('#portFilters .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#portFilters .chip').forEach(x => x.classList.toggle('active', x === c));
  statusFilter = c.dataset.tag;
  renderTab();
});
$portSearch.addEventListener('input', () => { searchQuery = $portSearch.value.trim().toLowerCase(); renderTab(); });
$portRefresh.onclick = loadPortfolio;

$portList.addEventListener('click', async e => {
  const photo = e.target.closest('.port-clickphoto');
  if (photo) {
    document.getElementById('imgViewImg').src = photo.dataset.full;
    document.getElementById('imgView').hidden = false;
    return;
  }
  const receiptBtn = e.target.closest('.port-receipt');
  if (receiptBtn) { openReceipts(findCard(receiptBtn.dataset.id)); return; }

  const photoBtn = e.target.closest('.port-photo');
  if (photoBtn) { openPortPhotoSheet(photoBtn.dataset.id); return; }

  const renameBtn = e.target.closest('.port-rename');
  if (renameBtn) {
    const card = findCard(renameBtn.dataset.id);
    const name = prompt('Edit card name', card ? card.name : '');
    if (name === null) return;
    const clean = name.trim();
    if (!clean) return toast('Name cannot be empty.');
    if (card && clean === card.name) return;
    renameBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=renameCard&cardId=' + encodeURIComponent(renameBtn.dataset.id) + '&name=' + encodeURIComponent(clean) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
      toast('Name updated.');
      await loadPortfolio();
    } catch (err) {
      renameBtn.disabled = false;
      toast('Could not rename: ' + err.message);
    }
    return;
  }

  const delBtn = e.target.closest('.port-delete');
  if (delBtn) {
    if (!confirm('Delete this card permanently? This cannot be undone.')) return;
    delBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=deleteCard&cardId=' + encodeURIComponent(delBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadPortfolio();
    } catch (err) {
      delBtn.disabled = false;
      toast('Could not delete: ' + err.message);
    }
    return;
  }

  const safeBtn = e.target.closest('.port-safekeep');
  if (safeBtn) {
    const sc = findCard(safeBtn.dataset.id), wasSold = sc && sc.tag === 'sold';
    if (!confirm('Move this card to safekeep? It is already paid and stays with you for the buyer. ' + (wasSold ? 'Its shipped date is cleared and it is taken out of its shipping record. ' : 'It leaves its shipping task. ') + 'You can give it its own shipping task later from Shipping.')) return;
    safeBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=setSafekeep&cardIds=' + encodeURIComponent(safeBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
      toast('Moved to safekeep.');
      await loadPortfolio();
    } catch (err) {
      safeBtn.disabled = false;
      toast('Could not move: ' + err.message);
    }
    return;
  }

  const revertBtn = e.target.closest('.port-revert');
  if (revertBtn) {
    if (!confirm('Revert this card back to onhand? Its sale details will be cleared.')) return;
    revertBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=revertToOnhand&cardId=' + encodeURIComponent(revertBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadPortfolio();
    } catch (err) {
      revertBtn.disabled = false;
      toast('Could not revert: ' + err.message);
    }
  }
});

/* ---------- Lot actions: add cards, unmerge a card, ungroup, rename (Code.gs: setLot / clearLot) ---------- */
async function lotCall(action, params) {
  const url = CONFIG.portfolio.endpoint + '?action=' + action + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('') + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const data = await jsonp(url);
  if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
}
async function lotBatches(action, ids, extra) {   // keep each request URL short
  for (let i = 0; i < ids.length; i += 25) await lotCall(action, Object.assign({ cardIds: ids.slice(i, i + 25).join(',') }, extra || {}));
}
let lotAddId = null, lotCreate = false; const lotAddSel = new Set();
function lotAddRender() {
  const q = document.getElementById('lotAddSearch').value.trim().toLowerCase();
  const cand = portData.cards.filter(c => c.tag === 'onhand' && !c.lotId && (!q || String(c.name || '').toLowerCase().includes(q)));
  document.getElementById('lotAddList').innerHTML = cand.length
    ? cand.map(c => `<label class="chk"><input type="checkbox" value="${escHtml(c.id)}"${lotAddSel.has(String(c.id)) ? ' checked' : ''}>${c.photo ? `<img class="cn-thumb" src="${escHtml(c.photo)}" alt="" loading="lazy">` : '<span class="cn-thumb none"></span>'}<span>${escHtml(c.name)} <small>\u2014 bought ${portPhp(c.purchaseCost)}</small></span></label>`).join('')
    : '<p class="stub-note" style="margin:10px 0 4px">No loose onhand cards to add.</p>';
  const n = lotAddSel.size;
  document.getElementById('lotAddSave').textContent = lotCreate ? (n ? `Create lot of ${n}` : 'Create lot') : (n ? `Add ${n} card${n > 1 ? 's' : ''}` : 'Add to lot');
}
document.getElementById('lotAddSearch').addEventListener('input', lotAddRender);
document.getElementById('lotAddList').addEventListener('change', e => { if (e.target.matches('input[type=checkbox]')) { e.target.checked ? lotAddSel.add(e.target.value) : lotAddSel.delete(e.target.value); lotAddRender(); } });
const closeLotAdd = () => { document.getElementById('lotAddSheet').hidden = true; lotAddId = null; lotCreate = false; };
/* Create a brand-new lot out of loose onhand cards (no receipt needed) */
document.getElementById('portNewLot').onclick = () => {
  lotCreate = true; lotAddId = null; lotAddSel.clear();
  document.getElementById('lotAddSearch').value = ''; document.getElementById('lotAddName').value = '';
  document.getElementById('lotAddNameWrap').hidden = false;
  document.getElementById('lotAddTitle').textContent = 'New lot';
  lotAddRender(); document.getElementById('lotAddSheet').hidden = false;
};
document.getElementById('lotAddCancel').onclick = closeLotAdd;
document.getElementById('lotAddSave').onclick = async () => {
  if (lotCreate && lotAddSel.size < 2) return toast('Pick at least two cards for a lot.');
  if (!lotAddSel.size) return toast('Pick at least one card.');
  const ids = [...lotAddSel], btn = document.getElementById('lotAddSave');
  const id = lotCreate ? 'lot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : lotAddId;
  const name = lotCreate ? (document.getElementById('lotAddName').value.trim() || `Lot of ${ids.length} cards`) : ((allLotCards(id)[0] || {}).lotName || '');
  btn.disabled = true;
  try { await lotBatches('setLot', ids, { lotId: id, lotName: name }); openLots.add(id); const made = lotCreate; closeLotAdd(); toast(made ? 'Lot created.' : `Added ${ids.length} card${ids.length > 1 ? 's' : ''} to the lot.`); await loadPortfolio(); }
  catch (err) { toast('Could not add: ' + err.message); }
  btn.disabled = false;
};
$portList.addEventListener('click', async e => {
  const head = e.target.closest('.lot-head');
  if (head && !e.target.closest('button')) {
    const id = head.dataset.lot; openLots.has(id) ? openLots.delete(id) : openLots.add(id);
    head.nextElementSibling.nextElementSibling.hidden = !openLots.has(id);
    head.querySelector('.lot-chev').classList.toggle('open', openLots.has(id));
    return;
  }
  const add = e.target.closest('.lot-add');
  if (add) { lotCreate = false; lotAddId = add.dataset.id; lotAddSel.clear(); document.getElementById('lotAddSearch').value = ''; document.getElementById('lotAddNameWrap').hidden = true; document.getElementById('lotAddTitle').textContent = 'Add cards to lot'; lotAddRender(); document.getElementById('lotAddSheet').hidden = false; return; }
  const ren = e.target.closest('.lot-rename');
  if (ren) {
    const cards = allLotCards(ren.dataset.id), cur = (cards[0] || {}).lotName || '';
    const name = prompt('Edit lot name', cur);
    if (name === null || !name.trim() || name.trim() === cur) return;
    try { await lotBatches('setLot', cards.map(c => c.id), { lotId: ren.dataset.id, lotName: name.trim() }); toast('Lot renamed.'); await loadPortfolio(); }
    catch (err) { toast('Could not rename: ' + err.message); }
    return;
  }
  const ung = e.target.closest('.lot-ungroup');
  if (ung) {
    const cards = allLotCards(ung.dataset.id);
    if (!confirm(`Ungroup this lot? Its ${cards.length} cards stay in your portfolio as individual cards.`)) return;
    try { await lotBatches('clearLot', cards.map(c => c.id)); openLots.delete(ung.dataset.id); toast('Lot ungrouped.'); await loadPortfolio(); }
    catch (err) { toast('Could not ungroup: ' + err.message); }
    return;
  }
  const un = e.target.closest('.port-unlot');
  if (un) {
    if (!confirm('Remove this card from its lot? It stays in your portfolio as an individual card.')) return;
    un.disabled = true;
    try { await lotBatches('clearLot', [un.dataset.id]); toast('Removed from the lot.'); await loadPortfolio(); }
    catch (err) { un.disabled = false; toast('Could not remove: ' + err.message); }
  }
});

document.getElementById('imgViewClose').onclick = () => document.getElementById('imgView').hidden = true;
document.getElementById('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') document.getElementById('imgView').hidden = true; });

/* ---------- Receipt viewer: shows every receipt attached to the card, one under the other ---------- */
function openReceipts(card) {
  const list = card ? receiptsFor(card) : [];
  if (!list.length) return;
  // older Code.gs sends no image URLs, only Drive page links: open the link as before
  if (list.length === 1 && !list[0].url) { window.open(list[0].link, '_blank'); return; }
  document.getElementById('rcptViewBody').innerHTML = list.map(r => `
      <h3>${escHtml(r.label)}</h3>
      ${r.url ? `<img src="${escHtml(r.url)}" alt="${escHtml(r.label)}" loading="lazy">` : ''}
      ${r.link ? `<a class="ghost rcpt-open" href="${escHtml(r.link)}" target="_blank" rel="noopener">Open full size</a>` : ''}`).join('');
  document.getElementById('rcptView').hidden = false;
}
document.getElementById('rcptViewClose').onclick = () => document.getElementById('rcptView').hidden = true;
document.getElementById('rcptView').addEventListener('click', e => { if (e.target.id === 'rcptView') document.getElementById('rcptView').hidden = true; });

/* ---------- Replace / remove an item photo ---------- */
let activePhotoCardId = null;
function openPortPhotoSheet(cardId) {
  const card = findCard(cardId);
  activePhotoCardId = cardId;
  document.getElementById('portPsLinkField').hidden = true;
  document.getElementById('portPsLinkInput').value = '';
  document.getElementById('portPsRemove').hidden = !(card && card.photo);
  document.getElementById('portPhotoSheet').hidden = false;
}
function closePortPhotoSheet() { document.getElementById('portPhotoSheet').hidden = true; activePhotoCardId = null; }
document.getElementById('portPsCancel').onclick = closePortPhotoSheet;
document.getElementById('portPhotoSheet').addEventListener('click', e => { if (e.target.id === 'portPhotoSheet') closePortPhotoSheet(); });
document.getElementById('portPsCamera').onclick = () => document.getElementById('portFileCamera').click();
document.getElementById('portPsUpload').onclick = () => document.getElementById('portFileUpload').click();
document.getElementById('portPsLink').onclick = () => { document.getElementById('portPsLinkField').hidden = false; document.getElementById('portPsLinkInput').focus(); };
document.getElementById('portPsLinkUse').onclick = () => {
  const url = document.getElementById('portPsLinkInput').value.trim();
  if (!url || !activePhotoCardId) return;
  sendCardPhoto(activePhotoCardId, { kind: 'link', src: url });
  closePortPhotoSheet();
};
document.getElementById('portPsRemove').onclick = async () => {
  const id = activePhotoCardId;
  if (!id) return;
  closePortPhotoSheet();
  try {
    const url = CONFIG.portfolio.endpoint + '?action=clearPhoto&which=card&cardId=' + encodeURIComponent(id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    toast('Photo removed.');
    await loadPortfolio();
  } catch (err) { toast('Could not remove photo: ' + err.message); }
};
function handlePortFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activePhotoCardId) return;
    const cardId = activePhotoCardId;
    const reader = new FileReader();
    reader.onload = () => sendCardPhoto(cardId, { kind, src: reader.result });
    reader.readAsDataURL(f);
    closePortPhotoSheet();
  });
}
handlePortFile(document.getElementById('portFileCamera'), 'camera');
handlePortFile(document.getElementById('portFileUpload'), 'upload');

async function sendCardPhoto(cardId, photo) {
  toast('Uploading photo\u2026');
  const payload = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'cardPhoto', secret: CONFIG.portfolio.secret, cardId, photo })
  };
  try {
    const res = await fetch(CONFIG.portfolio.endpoint, payload);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`);
    toast('Photo updated.');
    await loadPortfolio();
  } catch (err) {
    console.warn('Photo upload: readable response blocked (likely CORS), retrying blind.', err);
    try {
      await fetch(CONFIG.portfolio.endpoint, { ...payload, mode: 'no-cors' });
      toast('Photo sent \u2014 refresh in a moment to confirm it landed.');
    } catch (err2) {
      console.warn('Photo upload failed outright', err2);
      toast('Photo upload failed (offline?).');
    }
  }
}

loadPortfolio();
