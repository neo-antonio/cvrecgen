// CONFIG now lives in config.js (loaded before this file) so portfolio.js can use it too.

const PEOPLE = ['Ariel', 'Justine', 'Lemuel', 'Neo', 'Yuki'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const php = n => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTimeStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtTime = v => { const [h, m] = String(v).split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtDate = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); };
const shipType = () => $('input[name=st]:checked').value;
const SHIP_LABEL = { buyer: 'c/o buyer', us: 'c/o us', none: 'No shipping' };
const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let mode = 'purchase';

// Apps Script GET responses aren't reliably CORS-readable via fetch(), so reads go through
// JSONP (a <script> tag) instead — see portfolio.js for the same helper.
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'cvCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { delete window[cbName]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('Timed out')); } }, 15000);
    window[cbName] = data => { if (!settled) { settled = true; cleanup(); resolve(data); } };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Script load failed')); } };
    document.body.appendChild(script);
  });
}

let onhandCards = [];
async function loadOnhandCards() {
  if (!CONFIG.portfolio.endpoint) return;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=onhandCards&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    onhandCards = (data && data.ok && data.cards) || [];
  } catch (err) {
    console.warn('Could not load portfolio cards for sale picker', err);
    onhandCards = [];
  }
}

/* ---------- Items ---------- */
const CAMERA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
let itemSeq = 0;
const itemPhotos = {};  // id -> {kind:'camera'|'upload'|'link', src}
let activePhotoId = null;

// "Record to portfolio" is one checkbox for the whole receipt now (purchase mode's
// #globalPortfolio, trade mode's #receivedPortfolio) — it applies to every item in that
// list, not per item, so a multi-item receipt can't have some items in and some out.
function addItem() {
  const id = 'p' + (++itemSeq);
  const block = document.createElement('div');
  block.className = 'item-block';
  block.dataset.id = id;
  {
    block.innerHTML = `<div class="item">
        <button type="button" class="photo-btn" data-id="${id}" aria-label="Add photo">${CAMERA_ICON}</button>
        <input class="in-name" placeholder="Item name" autocomplete="off">
        <input class="in-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
        <button type="button" class="x" aria-label="Remove item">&times;</button>
      </div>`;
  }
  $('#items').append(block);
  update();
}
$('#addItem').onclick = () => { addItem(); $$('.in-name').pop().focus(); };
$('#items').addEventListener('click', e => {
  if (e.target.classList.contains('x')) { const b = e.target.closest('.item-block'); delete itemPhotos[b.dataset.id]; b.remove(); if (mode === 'sold') refreshPicker('sold'); update(); }
  const pb = e.target.closest('.photo-btn'); if (pb) openPhotoSheet(pb.dataset.id);
});
$('#items').addEventListener('input', update);
const items = () => $$('#items .item-block').map(b => {
  if (mode === 'sold') {
    return {
      id: b.dataset.id,
      cardId: b.dataset.cardId || '',
      name: b.dataset.name || '',
      cost: parseFloat(b.querySelector('.in-cost').value) || 0,
      photo: null
    };
  }
  return {
    id: b.dataset.id,
    cardId: '',
    name: b.querySelector('.in-name').value.trim(),
    cost: parseFloat(b.querySelector('.in-cost').value) || 0,
    photo: itemPhotos[b.dataset.id] || null
  };
}).filter(i => i.name || i.cost);
const subtotal = () => items().reduce((a, i) => a + i.cost, 0);

/* ---------- Trade items: two independent lists, plus one cash flow field ---------- */
// Traded (given away): picked from the onhand-card checklist above the list; the value
// defaults to the card's purchase amount but stays editable.
$('#tradedItems').addEventListener('click', e => {
  if (e.target.classList.contains('x')) { e.target.closest('.item-block').remove(); refreshPicker('trade'); update(); }
});
$('#tradedItems').addEventListener('input', update);
const tradedItems = () => $$('#tradedItems .item-block').map(b => ({
  id: b.dataset.id,
  cardId: b.dataset.cardId || '',
  name: b.dataset.name || '',
  cost: parseFloat(b.querySelector('.in-cost').value) || 0
})).filter(i => i.cardId);

/* ---------- Card checklists (sale + trade): each onhand card can be ticked once ---------- */
const PICK = {
  sold:  { root: '#soldPicker',  list: '#items',       costPh: 'Sold price', useCost: false },
  trade: { root: '#tradePicker', list: '#tradedItems', costPh: 'Value',      useCost: true }
};
const pickedIds = kind => $$(`${PICK[kind].list} .item-block`).map(b => b.dataset.cardId);

function initPicker(kind) {
  const root = $(PICK[kind].root);
  root.innerHTML = `<button type="button" class="ms-btn"><span class="ph">Select card(s)</span><i></i></button>
    <div class="ms-panel scroll" hidden>
      <input type="search" class="pick-search" placeholder="Search cards" autocomplete="off">
      <div class="pick-list"></div>
    </div>`;
  root.querySelector('.ms-btn').onclick = () => { const p = root.querySelector('.ms-panel'); p.hidden = !p.hidden; };
  root.querySelector('.pick-search').addEventListener('input', () => refreshPicker(kind));
  root.querySelector('.pick-list').addEventListener('change', e => {
    const cb = e.target;
    if (!cb.matches('input[type=checkbox]')) return;
    const card = onhandCards.find(c => String(c.id) === cb.value);
    if (!card) return;
    if (cb.checked) addCardRow(kind, card); else removeCardRow(kind, card.id);
    refreshPicker(kind);
    update();
  });
  refreshPicker(kind);
}

function refreshPicker(kind) {
  const root = $(PICK[kind].root);
  if (!root || !root.querySelector('.pick-list')) return;
  const q = root.querySelector('.pick-search').value.trim().toLowerCase();
  const ids = new Set(pickedIds(kind));
  const shown = onhandCards.filter(c => !q || String(c.name || '').toLowerCase().includes(q));
  root.querySelector('.pick-list').innerHTML = shown.length
    ? shown.map(c => `<label class="chk"><input type="checkbox" value="${escHtml(c.id)}"${ids.has(String(c.id)) ? ' checked' : ''}><span>${escHtml(c.name)} <small>\u2014 bought ${php(c.cost)}</small></span></label>`).join('')
    : `<p class="stub-note" style="margin:10px 0 4px">${onhandCards.length ? 'No cards match.' : 'No onhand cards found.'}</p>`;
  const n = ids.size, t = root.querySelector('.ms-btn span');
  t.textContent = n ? `${n} card${n > 1 ? 's' : ''} selected` : 'Select card(s)';
  t.className = n ? '' : 'ph';
}

function addCardRow(kind, card) {
  const cfg = PICK[kind];
  if (pickedIds(kind).includes(String(card.id))) return;  // a card can only be on the list once
  const block = document.createElement('div');
  block.className = 'item-block';
  block.dataset.id = 'cr' + (++itemSeq);
  block.dataset.cardId = String(card.id);
  block.dataset.name = card.name || '';
  block.innerHTML = `<div class="item">
      <div class="card-name"><b>${escHtml(card.name)}</b><small>bought ${php(card.cost)}</small></div>
      <input class="in-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="${cfg.costPh}"${cfg.useCost ? ` value="${card.cost || 0}"` : ''}>
      <button type="button" class="x" aria-label="Remove item">&times;</button>
    </div>`;
  $(cfg.list).append(block);
}
function removeCardRow(kind, cardId) {
  const b = $$(`${PICK[kind].list} .item-block`).find(x => x.dataset.cardId === String(cardId));
  if (b) b.remove();
}
document.addEventListener('click', e => {
  $$('.ms.pick').forEach(p => { if (!p.contains(e.target)) { const pn = p.querySelector('.ms-panel'); if (pn) pn.hidden = true; } });
});

// Received: free-text name plus an optional cost per card (what it's worth to us; blank = 0) —
// whether they're recorded to the portfolio is decided once for the whole list by #receivedPortfolio.
function addReceivedItem() {
  const id = 'rc' + (++itemSeq);
  const block = document.createElement('div');
  block.className = 'item-block';
  block.dataset.id = id;
  block.innerHTML = `<div class="item">
      <button type="button" class="photo-btn" data-id="${id}" aria-label="Add photo">${CAMERA_ICON}</button>
      <input class="in-name" placeholder="Item name" autocomplete="off">
      <input class="in-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Cost">
      <button type="button" class="x" aria-label="Remove item">&times;</button>
    </div>`;
  $('#receivedItems').append(block);
  update();
}
$('#addReceivedItem').onclick = () => { addReceivedItem(); $$('#receivedItems .in-name').pop().focus(); };
$('#receivedItems').addEventListener('click', e => {
  if (e.target.classList.contains('x')) { const b = e.target.closest('.item-block'); delete itemPhotos[b.dataset.id]; b.remove(); update(); }
  const pb = e.target.closest('.photo-btn'); if (pb) openPhotoSheet(pb.dataset.id);
});
$('#receivedItems').addEventListener('input', update);
const receivedItems = () => $$('#receivedItems .item-block').map(b => ({
  id: b.dataset.id,
  name: b.querySelector('.in-name').value.trim(),
  cost: parseFloat(b.querySelector('.in-cost').value) || 0,
  photo: itemPhotos[b.dataset.id] || null
})).filter(i => i.name);

const cashDirection = () => $('input[name=cashDir]:checked').value;
const cashAmount = () => cashDirection() === 'none' ? 0 : (parseFloat($('#cashAmount').value) || 0);

/* ---------- Item photo sheet ---------- */
function updateThumb(id) {
  const btn = $(`.photo-btn[data-id="${id}"]`);
  if (!btn) return;
  const p = itemPhotos[id];
  btn.innerHTML = p ? `<img src="${p.src}" alt="">` : CAMERA_ICON;
}
function openPhotoSheet(id) {
  activePhotoId = id;
  $('#psLinkField').hidden = true;
  $('#psLinkInput').value = '';
  $('#psRemove').hidden = !itemPhotos[id];
  $('#photoSheet').hidden = false;
}
function closePhotoSheet() { $('#photoSheet').hidden = true; activePhotoId = null; }
$('#psCancel').onclick = closePhotoSheet;
$('#photoSheet').addEventListener('click', e => { if (e.target.id === 'photoSheet') closePhotoSheet(); });
$('#psCamera').onclick = () => $('#fileCamera').click();
$('#psUpload').onclick = () => $('#fileUpload').click();
$('#psLink').onclick = () => { $('#psLinkField').hidden = false; $('#psLinkInput').focus(); };
$('#psRemove').onclick = () => { delete itemPhotos[activePhotoId]; updateThumb(activePhotoId); closePhotoSheet(); };
$('#psLinkUse').onclick = () => {
  const url = $('#psLinkInput').value.trim();
  if (!url) return;
  itemPhotos[activePhotoId] = { kind: 'link', src: url };
  updateThumb(activePhotoId);
  closePhotoSheet();
};
// Phone photos are several MB each and ride along in the same request as the receipt, which is what made
// big receipts slow or fail. Scale to 1600px / JPEG 85% (plenty for a card photo) before keeping them.
function shrinkPhoto(file, max = 1600, q = 0.85) {
  return new Promise(res => {
    const raw = () => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); };
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && file.size < 400 * 1024) return raw();
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); raw(); };
    img.src = url;
  });
}
function handleFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activePhotoId) return;
    const id = activePhotoId;
    shrinkPhoto(f).then(src => { itemPhotos[id] = { kind, src }; updateThumb(id); });
    closePhotoSheet();
  });
}
handleFile($('#fileCamera'), 'camera');
handleFile($('#fileUpload'), 'upload');
const shipping = () => (mode === 'sold' && shipType() === 'none') ? 0 : (parseFloat($('#ship').value) || 0);
const packaging = () => mode === 'sold' ? (parseFloat($('#pack').value) || 0) : 0;   // optional, sale only
// Purchase: shipping always counted in the total. Sold: shipping counts only when the buyer shoulders it (c/o buyer);
// it's excluded when it's on us (c/o us) or when there's no shipping at all. Trade: there's no
// item-for-item price, so the "total" is just whatever cash changed hands (if any).
const grandTotal = () => {
  if (mode === 'trade') return cashAmount();
  return mode === 'purchase' ? subtotal() + shipping() : subtotal() + packaging() + (shipType() === 'buyer' ? shipping() : 0);
};

/* ---------- People multi-select ---------- */
$('#msPanel').innerHTML = [...PEOPLE, 'Others'].map(p => `<label class="chk"><input type="checkbox" value="${p}"><span>${p}</span></label>`).join('') +
  '<input type="text" id="msOther" placeholder="Type name(s), separated by commas" hidden>';
$('#msBtn').onclick = () => $('#msPanel').hidden = !$('#msPanel').hidden;
document.addEventListener('click', e => { if (!$('#ms').contains(e.target)) $('#msPanel').hidden = true; });
$('#msPanel').addEventListener('input', () => {
  $('#msOther').hidden = !$('#msPanel input[value=Others]').checked;
  const p = people();
  $('#msText').textContent = p.length ? p.join(', ') : 'Select name(s)';
  $('#msText').className = p.length ? '' : 'ph';
});
function people() {
  const out = $$('#msPanel input[type=checkbox]:checked').map(c => c.value).filter(v => v !== 'Others');
  if ($('#msPanel input[value=Others]').checked) out.push(...$('#msOther').value.split(',').map(s => s.trim()).filter(Boolean));
  return out;
}

/* ---------- Mode + UI sync ---------- */
const MODE_LABELS = {
  purchase: { party: 'Seller', people: 'Bought by', pay: 'Purchased using', total: 'Total spent', notes: 'Add notes e.g. box size, supplier link.' },
  sold: { party: 'Buyer', people: 'Sold by', pay: 'Received in', total: 'Total received', notes: 'Add notes e.g. excess cash from shipping overpay, for CV storing, for reimbursements' },
  trade: { party: 'Traded to', people: 'Traded by', pay: 'Purchased using', total: 'Cash amount', notes: 'Add notes about the trade.' }
};
async function setMode(m) {
  mode = m;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  $('#items').classList.toggle('mode-purchase', m === 'purchase');
  const L = MODE_LABELS[m];
  $('#lParty').textContent = L.party;
  $('#lPeople').textContent = L.people;
  $('#lPay').textContent = L.pay;
  $('#lTotal').textContent = L.total;
  $('#notes').placeholder = L.notes;
  // item shape (free text vs card picker vs traded/received pair) differs enough between
  // modes that we reset every item list on switch
  Object.keys(itemPhotos).forEach(k => delete itemPhotos[k]);
  $('#items').innerHTML = ''; $('#tradedItems').innerHTML = ''; $('#receivedItems').innerHTML = '';
  itemSeq = 0;
  if (m === 'sold' || m === 'trade') {
    const loading = '<p class="stub-note">Loading onhand cards\u2026</p>';
    if (m === 'sold') $('#items').innerHTML = loading; else $('#tradedItems').innerHTML = loading;
    await loadOnhandCards();
    $('#items').innerHTML = ''; $('#tradedItems').innerHTML = '';
    initPicker(m);
  }
  if (m === 'trade') addReceivedItem(); else if (m === 'purchase') addItem();
  update();
}
$$('.tab').forEach(t => t.onclick = () => setMode(t.dataset.mode));

function update() {
  $$('[data-only]').forEach(e => { e.hidden = !e.dataset.only.split(' ').includes(mode); });

  if (mode === 'purchase' || mode === 'sold') {
    const rows = $$('#items .item');
    rows.forEach(r => r.classList.toggle('solo', mode === 'purchase' && rows.length === 1));
    $('#subRow').hidden = rows.length < 2;
    $('#subVal').textContent = php(subtotal());
  }
  if (mode === 'sold') {
    const none = shipType() === 'none';
    $('#ship').disabled = none;
    if (none) $('#ship').value = '';
    $('#deductRow').hidden = shipType() !== 'us';
    $('#methodOther').hidden = $('#method').value !== 'Others';
    $('#deductOther').hidden = $('#deduct').value !== 'Others';
  } else {
    $('#deductRow').hidden = true;
  }
  $('#ship').disabled = mode === 'sold' && shipType() === 'none';
  $('#payOther').hidden = $('#pay').value !== 'Others';

  if (mode === 'trade') {
    const rRows = $$('#receivedItems .item');
    rRows.forEach(r => r.classList.toggle('solo', rRows.length === 1));
    const none = cashDirection() === 'none';
    $('#cashAmount').disabled = none;
    if (none) $('#cashAmount').value = '';
    $('#cashMethodOther').hidden = $('#cashMethod').value !== 'Others';
  }

  $('#buyerWarn').hidden = !(mode === 'sold' && shipType() === 'buyer');
  $('#totalVal').textContent = php(grandTotal());
}
['#ship', '#pack', '#method', '#deduct', '#pay', '#cashAmount', '#cashMethod'].forEach(s => $(s).addEventListener('input', update));
$$('input[name=st]').forEach(r => r.addEventListener('change', update));
$$('input[name=cashDir]').forEach(r => r.addEventListener('change', update));

$('#sched').addEventListener('click', e => { if (!e.target.value) { e.target.value = todayStr(); try { e.target.showPicker(); } catch (_) {} } });
$('#schedClear').onclick = () => $('#sched').value = '';

/* ---------- Collect data ---------- */
function collect() {
  const trade = mode === 'trade';
  const t = shipType();
  return {
    mode, date: $('#date').value || todayStr(), time: $('#time').value,
    party: $('#party').value.trim(), people: people().join(', '),
    pay: $('#pay').value === 'Others' ? ($('#payOther').value.trim() || 'Others') : $('#pay').value,
    items: trade ? [] : items(), multi: trade ? false : $$('#items .item').length > 1,
    sub: trade ? 0 : subtotal(), ship: trade ? 0 : shipping(), pack: packaging(),
    total: grandTotal(),
    method: $('#method').value === 'Others' ? ($('#methodOther').value.trim() || 'Others') : $('#method').value,
    shipType: t, sched: $('#sched').value, shipAddr: mode === 'sold' ? $('#shipAddr').value.trim() : '',
    deduct: $('#deduct').value === 'Others' ? ($('#deductOther').value.trim() || 'Others') : $('#deduct').value,
    notes: $('#notes').value.trim(),
    // whole-receipt "record to portfolio" flag (purchase mode) — applies to every item
    portfolio: $('#globalPortfolio').checked,
    // trade-only fields
    tradedItems: trade ? tradedItems() : [],
    receivedItems: trade ? receivedItems() : [],
    receivedPortfolio: $('#receivedPortfolio').checked,
    cashDirection: trade ? cashDirection() : 'none',
    cashAmount: trade ? cashAmount() : 0,
    cashMethod: $('#cashMethod').value === 'Others' ? ($('#cashMethodOther').value.trim() || 'Others') : $('#cashMethod').value
  };
}

/* ---------- Receipt renderer (1080 x 1080) ---------- */
function draw(x, d, s, dry, logo) {
  const W = 1080, P = 72, R = W - P, G = '#b4b4b4', sold = d.mode === 'sold', trade = d.mode === 'trade';
  if (!dry) { x.fillStyle = '#000'; x.fillRect(0, 0, W, W); }
  x.textBaseline = 'top';
  const set = (w, z, a) => x.font = `${w} ${Math.round(z * s)}px ${a ? '"Archivo Black"' : 'Poppins'}, sans-serif`;
  const txt = (t, px, py, c, al = 'left') => { if (dry) return; x.fillStyle = c; x.textAlign = al; x.fillText(t, px, py); };
  const wrap = (t, mw) => {
    const out = [];
    for (const para of String(t).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        const test = line ? line + ' ' + w : w;
        if (!line || x.measureText(test).width <= mw) line = test; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };
  const rule = (py, c = '#2a2a2a') => { if (!dry) { x.fillStyle = c; x.fillRect(P, py, R - P, 2); } };
  const lh = 40 * s;
  let y = 64;

  // header (fixed size)
  if (logo) {
    const h = 76, w = Math.min(300, logo.width * h / logo.height), hh = w * logo.height / logo.width;
    if (!dry) x.drawImage(logo, P, y + (h - hh) / 2, w, hh);
  } else if (!dry) { x.font = '34px "Archivo Black"'; txt(CONFIG.brand, P, y + 20, '#fff'); }
  if (!dry) { x.font = '600 22px Poppins'; txt(CONFIG.brand, R, y + 26, G, 'right'); }
  y = 168;
  if (!dry) { x.font = '58px "Archivo Black"'; txt(trade ? 'TRADE RECEIPT' : (sold ? 'SALES RECEIPT' : 'PURCHASE RECEIPT'), P, y, '#fff'); }
  y += 92; rule(y); y += 28;

  const row = (l, v) => {
    set(400, 24); const lw = x.measureText(l).width;
    set(600, 28); const lines = wrap(v || '-', Math.max(280, R - P - lw - 40));
    set(400, 24); txt(l, P, y + 4 * s, G);
    set(600, 28); lines.forEach((t, i) => txt(t, R, y + i * lh, '#fff', 'right'));
    y += lines.length * lh + 10 * s;
  };
  const sec = t => { set(600, 20); txt(t.toUpperCase(), P, y, G); y += 34 * s; };

  row('Date', fmtDate(d.date));
  if (d.time) row('Time', fmtTime(d.time));
  if (trade) {
    row('Traded to', d.party);
    row('Traded by', d.people);
  } else {
    row(sold ? 'Buyer' : 'Seller', d.party);
    row(sold ? 'Sold by' : 'Bought by', d.people);
    row(sold ? 'Received in' : 'Purchased using', d.pay);
  }
  y += 8 * s; rule(y); y += 22 * s;

  if (trade) {
    sec('Items traded');
    if (d.tradedItems.length) {
      d.tradedItems.forEach(i => {
        set(600, 28);
        const lines = wrap(i.name || '(unnamed)', 600);
        lines.forEach((t, k) => txt(t, P, y + k * lh, '#fff'));
        txt(php(i.cost), R, y, '#fff', 'right');
        y += lines.length * lh + 8 * s;
      });
    } else { set(400, 24); txt('None', P, y, '#888'); y += lh; }
    y += 10 * s;
    sec('Items received');
    if (d.receivedItems.length) {
      d.receivedItems.forEach(i => {
        set(600, 28);
        const lines = wrap(i.name || '(unnamed)', i.cost ? 600 : R - P);
        lines.forEach((t, k) => txt(t, P, y + k * lh, '#fff'));
        if (i.cost) txt(php(i.cost), R, y, '#fff', 'right');
        y += lines.length * lh + 8 * s;
      });
    } else { set(400, 24); txt('None', P, y, '#888'); y += lh; }
    y += 4 * s; rule(y); y += 22 * s;

    row('Cash', d.cashDirection === 'none' ? 'None' : `${php(d.cashAmount)} (${d.cashDirection === 'paid' ? 'Paid' : 'Received'})`);
    if (d.cashDirection !== 'none') row(d.cashDirection === 'paid' ? 'Paid using' : 'Received in', d.cashMethod);

    y += 6 * s; rule(y, G); y += 24 * s;
    const cashTitle = d.cashDirection === 'received' ? 'CASH RECEIVED' : d.cashDirection === 'paid' ? 'CASH PAID' : 'NO CASH INVOLVED';
    set(400, 30, true); txt(cashTitle, P, y + 12 * s, '#fff');
    set(400, 44, true); txt(php(d.cashAmount), R, y, '#fff', 'right');
    y += 66 * s;
  } else {
    sec('Items');
    d.items.forEach(i => {
      set(600, 28);
      const lines = wrap(i.name || '(unnamed)', 600);
      lines.forEach((t, k) => txt(t, P, y + k * lh, '#fff'));
      txt(php(i.cost), R, y, '#fff', 'right');
      y += lines.length * lh + 8 * s;
    });
    if (d.multi) { y += 4 * s; row('Item subtotal', php(d.sub)); }
    y += 4 * s; rule(y); y += 22 * s;

    if (sold) {
      if (d.pack > 0) row('Packaging', php(d.pack));
      row('Shipping method', d.method);
      row('Shipping', d.shipType === 'none' ? 'No shipping (PHP 0.00)' : `${php(d.ship)} (${SHIP_LABEL[d.shipType]})`);
      if (d.shipType === 'us') row('Shipping deducted from', d.deduct);
    } else row('Shipping', php(d.ship));

    y += 6 * s; rule(y, G); y += 24 * s;
    set(400, 30, true); txt(sold ? 'TOTAL RECEIVED' : 'TOTAL SPENT', P, y + 12 * s, '#fff');
    set(400, 44, true); txt(php(d.total), R, y, '#fff', 'right');
    y += 66 * s;
  }

  if (d.notes) {
    y += 8 * s; sec('Notes');
    set(400, 24);
    wrap(d.notes, R - P).forEach(t => { txt(t, P, y, '#d8d8d8'); y += 34 * s; });
  }

  // footer (fixed)
  if (!dry) {
    rule(W - 104);
    x.font = '400 24px Poppins'; txt(CONFIG.siteLink, W / 2, W - 78, G, 'center');
  }
  return y;
}

const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

/* ---------- Receipt sync (Google Sheets via Apps Script) ----------
   A receipt is sent as ONE request carrying the receipt image and any item photos. It is first
   written to an on-device outbox (IndexedDB), then sent with a progress panel; it leaves the outbox
   only once the server confirms. If the page is closed mid-upload, or the answer never arrives, the
   same request (same syncId) is re-sent on the next visit — the server ignores a syncId it has
   already processed, so a re-send can never create duplicate cards or Finance tasks. */
const nPl = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Every purchased item bills to Finance (portfolio-flagged or not, e.g. packaging supplies);
// portfolio-flagged items also get a new Cards row — d.portfolio is ONE checkbox for the whole receipt.
function purchaseBody(d, receiptPhoto) {
  if (!d.items.length) return null;
  return { action: 'purchase', date: d.date, time: d.time, seller: d.party, people: d.people, pay: d.pay, notes: d.notes,
    items: d.items.map(i => ({ name: i.name, cost: i.cost, photo: i.photo, portfolio: d.portfolio })), receiptPhoto };
}
// Cards sold always move to "shipping" so they show up under To ship, even with no shipping fee; the
// sale amount bills to Finance right away, the shipping-fee entry is created once the batch ships.
function saleBody(d, receiptPhoto) {
  const sold = d.items.filter(i => i.cardId);
  if (!sold.length) return null;
  return { action: 'sell', date: d.date, time: d.time, buyer: d.party, notes: d.notes, pay: d.pay,
    shipType: d.shipType, shipMethod: d.method, shipFee: d.ship, shipDeductFrom: d.deduct, shipSched: d.sched,
    shipAddress: d.shipAddr, packaging: d.pack,
    items: sold.map(i => ({ cardId: i.cardId, name: i.name, cost: i.cost })), receiptPhoto };
}
// Items traded away become "traded"; items received become new onhand Cards only if d.receivedPortfolio is
// ticked. Any cash paid/received bills to Finance as one entry.
function tradeBody(d, receiptPhoto) {
  if (!d.tradedItems.length && !d.receivedItems.length) return null;
  return { action: 'trade', date: d.date, time: d.time, tradedTo: d.party, tradedBy: d.people, notes: d.notes,
    tradedItems: d.tradedItems.map(i => ({ cardId: i.cardId, name: i.name, cost: i.cost })),
    receivedItems: d.receivedItems.map(i => ({ name: i.name, cost: i.cost, photo: i.photo })),
    receivedPortfolio: d.receivedPortfolio, cashDirection: d.cashDirection, cashAmount: d.cashAmount, cashMethod: d.cashMethod, receiptPhoto };
}

/* on-device outbox */
const outbox = (() => {
  let p = null;
  const open = () => p || (p = new Promise(res => {
    try {
      const r = indexedDB.open('cv-outbox', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch (_) { res(null); }
  }));
  const run = (mode, fn) => open().then(db => db ? new Promise(res => {
    try { const t = db.transaction('q', mode), req = fn(t.objectStore('q')); t.oncomplete = () => res(req.result); t.onerror = t.onabort = () => res(undefined); }
    catch (_) { res(undefined); }
  }) : undefined);
  return { put: e => run('readwrite', s => s.put(e)), del: id => run('readwrite', s => s.delete(id)), all: () => run('readonly', s => s.getAll()).then(r => r || []) };
})();

function xhrPost(bodyStr, onUpload) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', CONFIG.portfolio.endpoint);
    x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');   // avoids a CORS preflight to Apps Script
    x.timeout = 120000;
    if (onUpload) x.upload.onprogress = e => { if (e.lengthComputable) onUpload(e.loaded / e.total); };
    x.onload = () => { let data = null; try { data = JSON.parse(x.responseText); } catch (_) {} resolve({ status: x.status, data }); };
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(bodyStr);
  });
}
// "Did it land anyway?" — the server remembers each finished syncId for a few hours.
async function pollStatus(id, tries) {
  for (let k = 0; k < tries; k++) {
    await sleep(3000);
    try {
      const r = await jsonp(CONFIG.portfolio.endpoint + '?action=syncStatus&syncId=' + encodeURIComponent(id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret));
      if (r && r.ok && r.done) return r.result;
    } catch (_) {}
  }
  return null;
}
// -> { state: 'done', result } | { state: 'error', message } | { state: 'unconfirmed' }
async function deliver(entry, onUpload, onWaiting) {
  let resp;
  try { resp = await xhrPost(entry.body, onUpload); }
  catch (_) {
    if (onWaiting) onWaiting();
    const r = await pollStatus(entry.id, 20);   // ~60s
    return r ? { state: 'done', result: r } : { state: 'unconfirmed' };
  }
  const d = resp.data;
  if (d && d.ok === true) return { state: 'done', result: d };
  if (d && d.error) return { state: 'error', message: d.error === 'unauthorized' ? 'wrong secret in config.js' : d.error };
  const r = await pollStatus(entry.id, 5);      // a reply we could not read: check whether it landed
  return r ? { state: 'done', result: r } : { state: 'error', message: 'HTTP ' + resp.status };
}

/* progress panel */
let inflight = 0;
window.addEventListener('beforeunload', e => { if (inflight > 0) { e.preventDefault(); e.returnValue = ''; } });
const IC = { wait: '', run: '', ok: '\u2713', warn: '!', err: '\u2715' };
const drawSteps = steps => { $('#syncSteps').innerHTML = steps.map(s => `<li class="${s.st}"><span class="ic">${IC[s.st]}</span><span>${s.t}</span></li>`).join(''); };
const setBar = (p, busy) => { $('#syncBar').style.width = Math.round(p * 100) + '%'; $('#syncBar').parentNode.classList.toggle('busy', !!busy); };
const setClose = (disabled, label) => { $('#close').disabled = disabled; $('#close').textContent = label; };

function plannedSteps(d) {
  const k = d.mode === 'purchase' ? d.items.length : d.mode === 'sold' ? d.items.filter(i => i.cardId).length : 0;
  const st = [{ st: 'ok', t: 'Receipt image created' }, { st: 'run', t: 'Uploading\u2026 0%' }, { st: 'wait', t: 'Saving receipt to archive' }];
  if (d.mode === 'purchase') { if (d.portfolio) st.push({ st: 'wait', t: `Adding ${nPl(k, 'card')} to portfolio` }); st.push({ st: 'wait', t: `Creating ${nPl(k, 'finance task')}` }); }
  else if (d.mode === 'sold') st.push({ st: 'wait', t: `Moving ${nPl(k, 'card')} to Shipping` }, { st: 'wait', t: 'Creating finance tasks' });
  else { if (d.tradedItems.length || (d.receivedItems.length && d.receivedPortfolio)) st.push({ st: 'wait', t: 'Updating portfolio' }); st.push({ st: 'wait', t: 'Creating finance task' }); }
  return st;
}
function resultSteps(d, r) {
  const st = [{ st: 'ok', t: 'Receipt image created' }, { st: 'ok', t: 'Uploaded' },
    r.receipt ? { st: 'ok', t: 'Receipt saved to archive' } : { st: 'warn', t: 'Receipt image could not be saved to the archive' }];
  const pf = r.photosFailed ? ` (${nPl(r.photosFailed, 'photo')} could not be saved)` : '';
  if (d.mode === 'purchase') { if (d.portfolio) st.push({ st: r.photosFailed ? 'warn' : 'ok', t: `${nPl(r.cards || 0, 'card')} added to portfolio${pf}` }); st.push({ st: 'ok', t: `${nPl(r.finance || 0, 'finance task')} created` }); }
  else if (d.mode === 'sold') st.push({ st: 'ok', t: `${nPl(r.cards || 0, 'card')} moved to Shipping` }, { st: 'ok', t: `${nPl(r.finance || 0, 'finance task')} created` });
  else {
    if (d.tradedItems.length || (d.receivedItems.length && d.receivedPortfolio))
      st.push({ st: r.photosFailed ? 'warn' : 'ok', t: `Portfolio updated: ${r.traded || 0} traded out, ${r.received || 0} added${pf}` });
    st.push({ st: 'ok', t: 'Finance task created' });
  }
  return st;
}

async function runEntry(entry, d) {
  $('#sync').hidden = false; $('#syncRetry').hidden = true; $('#syncMsg').textContent = 'Keep this page open until this finishes.';
  const steps = plannedSteps(d); drawSteps(steps); setBar(0, false);
  setClose(true, 'Saving\u2026');
  inflight++;
  await outbox.put(entry);   // survives the page being closed; removed only once the server confirms
  const out = await deliver(entry,
    p => { steps[1].t = `Uploading\u2026 ${Math.round(p * 100)}%`; setBar(p, false); if (p >= 1) { steps[1] = { st: 'ok', t: 'Uploaded' }; steps[2].st = 'run'; setBar(1, true); } drawSteps(steps); },
    () => { steps[1] = { st: 'ok', t: 'Sent' }; steps[2].st = 'run'; $('#syncMsg').textContent = 'Connection dropped \u2014 checking whether it went through\u2026'; setBar(1, true); drawSteps(steps); });
  inflight--;
  setBar(1, false); setClose(false, 'Close');
  if (out.state === 'done') {
    await outbox.del(entry.id);
    drawSteps(resultSteps(d, out.result));
    const bad = !out.result.receipt || out.result.photosFailed;
    $('#syncMsg').textContent = bad ? 'Saved, with the warning above. The cards and finance tasks are in place.' : (out.result.duplicate ? 'Already saved earlier \u2014 nothing was added twice.' : 'All saved.');
  } else if (out.state === 'unconfirmed') {
    steps[2] = { st: 'warn', t: 'Could not confirm the save' }; steps.slice(3).forEach(s => s.st = 'wait'); drawSteps(steps);
    $('#syncMsg').textContent = 'Nothing is lost: this receipt is stored on your device and will be re-sent automatically the next time you open Receipt. You can also tap Retry now.';
    $('#syncRetry').hidden = false; $('#syncRetry').onclick = () => runEntry(entry, d);
  } else {
    await outbox.del(entry.id);
    steps[2] = { st: 'err', t: 'Server rejected it: ' + out.message }; steps.slice(3).forEach(s => s.st = 'wait'); drawSteps(steps);
    $('#syncMsg').textContent = 'The receipt image is still above, so you can download it. Tap Retry to send it again.';
    $('#syncRetry').hidden = false; $('#syncRetry').onclick = () => runEntry(entry, d);
  }
}
function startSync(d, body) {
  if (!CONFIG.portfolio.endpoint || !body) return Promise.resolve();
  const id = 'rs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  body.secret = CONFIG.portfolio.secret; body.syncId = id;
  return runEntry({ id, body: JSON.stringify(body), createdAt: Date.now() }, d);
}

// Receipts that never got confirmed (page closed mid-upload, offline, ...) are re-sent when Receipt is opened.
async function resumeOutbox() {
  if (!CONFIG.portfolio.endpoint) return;
  const pending = await outbox.all();
  if (!pending.length) return;
  toast(`Finishing ${nPl(pending.length, 'receipt')} that didn\u2019t finish saving\u2026`);
  let ok = 0;
  for (const e of pending) {
    inflight++;
    const out = await deliver(e);
    inflight--;
    if (out.state === 'done') { await outbox.del(e.id); ok++; }
    else if (out.state === 'error') await outbox.del(e.id);   // the server refused it: retrying will not change that
  }
  toast(ok === pending.length ? `Saved ${nPl(ok, 'pending receipt')}.` : `${ok} of ${pending.length} pending receipts saved; the rest will retry next time.`);
}

const blobToDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

function render(d, logo) {
  const c = document.createElement('canvas'); c.width = c.height = 1080;
  const x = c.getContext('2d');
  let s = 1;
  while (s > 0.45 && draw(x, d, s, true, logo) > 1080 - 120) s -= 0.05;
  draw(x, d, s, false, logo);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.93));  // throws if the canvas is tainted
}

async function generate() {
  const d = collect();
  if (d.mode === 'trade') {
    if (!d.tradedItems.length && !d.receivedItems.length) return toast('Add at least one traded or received item.');
    if (d.cashDirection !== 'none' && !d.cashAmount) return toast('Enter a cash amount, or set cash to None.');
  } else {
    if (!d.items.length) return toast(d.mode === 'sold' ? 'Select at least one card to sell.' : 'Add at least one item.');
    if (d.mode === 'sold' && d.items.some(i => !i.cardId)) return toast('Select a card for every item before generating.');
  }
  $('#gen').disabled = true;
  try {
    await Promise.all([
      document.fonts.load('40px "Archivo Black"'), document.fonts.load('400 24px Poppins'), document.fonts.load('600 24px Poppins')
    ]);
    const logo = await loadImg(CONFIG.logo);
    let blob, skipped = false;
    try { blob = await render(d, logo); }
    catch (err) {
      if (!logo) throw err;
      console.warn('Logo blocked by the browser (file:// security). Rendering without it.', err);
      blob = await render(d, null); skipped = true;
    }
    if (!blob) throw new Error('Image export returned nothing');
    const now = new Date();
    const name = `CVRecGen-${d.mode}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
    showPreview(blob, name);
    const receiptPhoto = { kind: 'camera', src: await blobToDataUrl(blob) };
    startSync(d, d.mode === 'purchase' ? purchaseBody(d, receiptPhoto) : d.mode === 'sold' ? saleBody(d, receiptPhoto) : tradeBody(d, receiptPhoto)).catch(err => console.warn('Sync failed', err));
    resetAfterCardReceipt(d);
    if (skipped) toast('Logo skipped. Open the app from http://localhost or your website to include it.');
  } catch (e) {
    console.error(e);
    toast('Could not generate receipt: ' + (e.message || e.name));
  }
  $('#gen').disabled = false;
}
$('#gen').onclick = generate;

// Cards used on a sale/trade receipt are no longer onhand: drop them from the local list and
// clear the form so the same card can't be picked (and sold) a second time from this screen.
function resetAfterCardReceipt(d) {
  if (d.mode === 'sold') {
    const used = new Set(d.items.map(i => String(i.cardId)));
    onhandCards = onhandCards.filter(c => !used.has(String(c.id)));
    $('#items').innerHTML = ''; refreshPicker('sold');
    $('#pack').value = ''; $('#shipAddr').value = '';   // per-sale fields: never carry one buyer's over to the next sale
  } else if (d.mode === 'trade') {
    const used = new Set(d.tradedItems.map(i => String(i.cardId)));
    onhandCards = onhandCards.filter(c => !used.has(String(c.id)));
    Object.keys(itemPhotos).forEach(k => delete itemPhotos[k]);
    $('#tradedItems').innerHTML = ''; $('#receivedItems').innerHTML = '';
    refreshPicker('trade'); addReceivedItem();
  }
  update();
}

function showPreview(blob, name) {
  const url = URL.createObjectURL(blob);
  $('#prevImg').src = url;
  $('#dl').href = url; $('#dl').download = name;
  const file = new File([blob], name, { type: 'image/jpeg' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $('#share').hidden = !canShare;
  $('#share').onclick = () => navigator.share({ files: [file] }).catch(() => {});
  $('#sync').hidden = true; setClose(false, 'Close');
  $('#close').onclick = () => { if (inflight > 0 && $('#close').disabled) return; $('#modal').hidden = true; URL.revokeObjectURL(url); };
  $('#modal').hidden = false;
}

function toast(m) {
  const t = $('#toast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

/* ---------- Init ---------- */
$('#date').value = todayStr();
$('#time').value = nowTimeStr();   // time the page was loaded; editable
setMode('purchase');
resumeOutbox().catch(err => console.warn('Outbox resume failed', err));
