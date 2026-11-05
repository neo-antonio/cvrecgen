/* ---------- Receipt Fix: rebuild a sale or purchase receipt image from the (corrected) backend data ----------
   ONE-OFF TOOL: pick a sale receipt, check the details filled in from Cards + Finance, fix anything, then download the new JPG and upload it in Drive
   as a new version of the old file (Manage versions) so every link keeps working. The drawing code below is copied from app.js (draw / render),
   so the new image looks exactly like a normal receipt. Nothing here writes to the backend. */
const php = n => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
const fmtTime = v => { const [h, m] = String(v).split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtDate = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); };
const SHIP_LABEL = { buyer: 'c/o buyer', us: 'c/o us', none: 'No shipping' };
const PEOPLE = ['Ariel', 'Justine', 'Lemuel', 'Neo', 'Yuki'];

/* ---------- Receipt renderer (1080 x 1080) ---------- */
function draw(x, d, s, dry, logo) {
  const W = 1080, P = 72, R = W - P, G = '#b4b4b4', sold = d.mode === 'sold', trade = d.mode === 'trade', xfer = d.mode === 'transfer';
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
  if (!dry) { x.font = '58px "Archivo Black"'; txt(xfer ? 'TRANSFER RECEIPT' : trade ? 'TRADE RECEIPT' : (sold ? 'SALES RECEIPT' : 'PURCHASE RECEIPT'), P, y, '#fff'); }
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
  if (xfer) {
    row('Transferred by', d.people);
    row('From', d.from);
    row('To', d.to);
    if (d.fee > 0) row('Transfer fee', `${php(d.fee)} (from ${d.from})`);
  } else if (trade) {
    row('Traded to', d.party);
    row('Traded by', d.people);
  } else {
    row(sold ? 'Buyer' : 'Seller', d.party);
    row(sold ? 'Sold by' : 'Bought by', d.people);
    if (d.payments && d.payments.length > 1) d.payments.forEach((p, k) => row(k ? '' : (sold ? 'Received in' : 'Purchased using'), `${p.method} \u2014 ${php(p.amount)}`));
    else row(sold ? 'Received in' : 'Purchased using', d.pay);
  }
  y += 8 * s; rule(y); y += 22 * s;

  if (xfer) {
    y += 6 * s; rule(y, G); y += 24 * s;
    set(400, 30, true); txt('AMOUNT TRANSFERRED', P, y + 12 * s, '#fff');
    set(400, 44, true); txt(php(d.amount), R, y, '#fff', 'right');
    y += 66 * s;
  } else if (trade) {
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
    d.entries.forEach(e => {
      set(600, 28);
      if (e.type === 'lot') {
        const lines = wrap(`${e.name} (${e.names.length} cards)`, 600);
        lines.forEach((t, k) => txt(t, P, y + k * lh, '#fff'));
        txt(php(e.total), R, y, '#fff', 'right');
        y += lines.length * lh + 2 * s;
        set(400, 22);
        wrap(e.names.join(', '), R - P - 40).forEach(t => { txt(t, P + 16, y, '#9a9a9a'); y += 30 * s; });
        y += 8 * s;
        return;
      }
      const lines = wrap(e.name || '(unnamed)', 600);
      lines.forEach((t, k) => txt(t, P, y + k * lh, '#fff'));
      txt(php(e.cost), R, y, '#fff', 'right');
      y += lines.length * lh + 8 * s;
    });
    if (d.multi) { y += 4 * s; row('Item subtotal', php(d.sub)); }
    y += 4 * s; rule(y); y += 22 * s;

    if (sold) {
      if (d.pack > 0) row('Packaging', php(d.pack));
      row('Shipping method', d.method);
      row('Shipping', d.shipType === 'none' ? 'No shipping (PHP 0.00)' : `${php(d.ship)} (${SHIP_LABEL[d.shipType]})`);
      if (d.shipType === 'us') row('Shipping deducted from', d.deduct);
      if (d.shipType === 'buyer' && d.ship > 0 && d.shipAcct) row('Shipping received in', d.shipAcct);
      if (d.safekeep) row('Status', 'Paid \u00b7 held for safekeep');
    } else {
      if (d.method) row('Shipping method', d.method);
      row('Shipping', php(d.ship));
      if (d.ship > 0 && d.shipAcct) row('Shipping paid using', d.shipAcct);
    }

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
function render(d, logo) {
  const c = document.createElement('canvas'); c.width = c.height = 1080;
  const x = c.getContext('2d');
  let s = 1;
  while (s > 0.45 && draw(x, d, s, true, logo) > 1080 - 120) s -= 0.05;
  draw(x, d, s, false, logo);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.93));  // throws if the canvas is tainted
}


/* ---------------- data ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = u => (String(u || '').match(/[-\w]{25,}/) || [''])[0];
const r2 = n => Math.round(n * 100) / 100;
const api = a => CONFIG.portfolio.endpoint + '?action=' + a + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
let toastT; function toast(m) { const t = $('frToast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600); }
let kind = 'sale', receiptsAll = [], shipCards = [], portCards = null, finAll = [], list = [], cur = null, blobUrl = '';

async function load() {
  try {
    const [r, s, f] = await Promise.all([jsonp(api('receipts'), 60000), jsonp(api('shipping'), 60000), jsonp(api('finance'), 60000)]);
    if (!r.ok || !s.ok || !f.ok) throw new Error((r.error || s.error || f.error) || 'Request failed');
    receiptsAll = r.receipts || [];
    shipCards = (s.toShip || []).concat(s.shipped || []);
    finAll = (f.toRecord || []).concat(f.recorded || []);
    $('frState').hidden = true; $('frBody').hidden = false;
    setKind('sale');
  } catch (err) { $('frState').textContent = "Couldn't load (offline, wrong secret, or Code.gs needs a new deployment): " + err.message; }
}
async function ensurePortfolio() {   // purchase receipts read the cards' seller / bought by / notes, so the full portfolio is only loaded when needed
  if (portCards) return;
  const p = await jsonp(api('portfolio'), 90000);
  if (!p.ok) throw new Error(p.error || 'Request failed');
  portCards = p.cards || [];
}
async function setKind(k) {
  kind = k;
  document.querySelectorAll('#frKind .chip').forEach(c => c.classList.toggle('active', c.dataset.k === k));
  const sale = k === 'sale';
  document.querySelectorAll('.fr-sale').forEach(e => { e.hidden = !sale; });
  $('frLBuyer').textContent = sale ? 'Buyer' : 'Seller';
  $('frLPeople').innerHTML = (sale ? 'Sold by' : 'Bought by') + ' <small>(tap the names)</small>';
  $('frLPay').textContent = sale ? 'Received in' : 'Purchased using';
  $('frLItems').textContent = sale ? 'Cards sold' : 'Items bought';
  $('frLAcct').innerHTML = sale ? 'Shipping received in <small>(blank = same as above)</small>' : 'Shipping paid using <small>(blank = same as above)</small>';
  $('frLTotal').textContent = sale ? 'Total received' : 'Total spent';
  list = receiptsAll.filter(x => x.type === k);
  $('frSel').innerHTML = list.map((x, i) => `<option value="${i}">${esc(x.date)} \u00b7 ${esc(x.description)}</option>`).join('');
  $('frOut').hidden = true;
  if (!list.length) { $('frFound').textContent = 'No ' + k + ' receipts found.'; cur = null; return; }
  await pick(0);
}

async function pick(i) {
  const rc = list[i]; cur = rc; if (!rc) return;
  if (kind === 'purchase') { try { await ensurePortfolio(); } catch (err) { return toast('Could not load the portfolio: ' + err.message); } }
  const key = keyOf(rc.link);
  $('frOrig').src = rc.url || ''; $('frOrig').hidden = !rc.url;
  $('frDate').value = rc.date || ''; $('frTime').value = rc.time || '';
  $('frOut').hidden = true; if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  $('frItems').innerHTML = '';
  (kind === 'sale' ? fillSale : fillPurchase)(rc, key);
  recalc();
}
const setPeople = names => {
  const set = new Set(String(names || '').split(',').map(s => s.trim()).filter(Boolean));
  document.querySelectorAll('#frChips .chip').forEach(c => c.classList.toggle('active', set.has(c.dataset.p)));
  $('frPeople').value = names || '';
};
// payments by account -> the "Received in" / "Purchased using" box (a split is kept as a list so the receipt prints each amount)
function setPay(by) {
  const m = Object.keys(by).filter(k => by[k] > 0);
  $('frPay').value = m.length === 1 ? m[0] : m.map(k => k + ' ' + r2(by[k])).join(' + ');
  $('frPay').dataset.split = m.length > 1 ? JSON.stringify(m.map(k => ({ method: k, amount: r2(by[k]) }))) : '';
  return m;
}

function fillSale(rc, key) {
  const cards = shipCards.filter(c => keyOf(c.saleReceipt) === key);
  const fin = finAll.filter(t => keyOf(t.receipt) === key && t.type === 'sale' && t.flow === 'inflow');
  const itemRows = fin.filter(t => /^Sale:/.test(t.description)), packRows = fin.filter(t => /^Packaging:/.test(t.description)), shipRows = fin.filter(t => /^Shipping paid by buyer/.test(t.description));
  $('frBuyer').value = (cards[0] && cards[0].soldTo) || String(rc.description || '').replace(/^Sale to /, '');
  // the cards of this receipt (their sold price); a receipt with no card left on Shipping (e.g. safekeep) falls back to its Finance "Sale:" rows
  let items = cards.map(c => ({ name: c.name, cost: c.soldPrice }));
  if (!items.length) { const m = {}; itemRows.forEach(t => { const n = t.description.replace(/^Sale: /, ''); m[n] = (m[n] || 0) + t.amount; }); items = Object.keys(m).map(n => ({ name: n, cost: r2(m[n]) })); }
  items.forEach(addItem); if (!items.length) addItem({ name: '', cost: '' });
  const by = {}; itemRows.forEach(t => { by[t.payMethod] = (by[t.payMethod] || 0) + t.amount; });
  const methods = setPay(by); if (!methods.length) $('frPay').value = 'Maribank';
  const f0 = cards[0] || {}, shipFeeCards = cards.reduce((n, c) => n + (Number(c.shipFee) || 0), 0), shipPaid = shipRows.reduce((n, t) => n + t.amount, 0);
  $('frType').value = f0.shipType || (shipRows.length ? 'buyer' : 'none');
  $('frMethod').value = f0.shipMethod || '';
  $('frShip').value = (f0.shipType === 'buyer' && shipPaid) ? shipPaid : (shipFeeCards || shipPaid || '');
  $('frPack').value = packRows.reduce((n, t) => n + t.amount, 0) || '';
  const main = methods.length === 1 ? methods[0] : '';
  $('frAcct').value = shipRows.length && shipRows[0].payMethod && shipRows[0].payMethod !== main ? shipRows[0].payMethod : '';
  $('frDeduct').value = f0.deductedFrom || 'Cash';
  $('frNotes').value = f0.notes || '';
  $('frKeep').checked = !cards.length && itemRows.length > 0;
  setPeople('');
  $('frFound').textContent = cards.length ? `${cards.length} card${cards.length === 1 ? '' : 's'} found for this receipt.` : (itemRows.length ? 'No card is on Shipping for this receipt (safekeep?). Items were read from Finance.' : 'No cards or Finance rows were found for this receipt. Fill the details in by hand.');
}

function fillPurchase(rc, key) {
  const cards = portCards.filter(c => keyOf(c.purchaseReceipt) === key).reverse();   // the portfolio lists newest first; a receipt lists its items in the order they were added
  const fin = finAll.filter(t => keyOf(t.receipt) === key && t.type === 'purchase' && t.flow === 'outflow');
  const shipRows = fin.filter(t => /^Shipping/.test(t.description)), itemRows = fin.filter(t => !/^Shipping/.test(t.description));
  $('frBuyer').value = (cards[0] && cards[0].seller) || String(rc.description || '').replace(/^Purchase from /, '');
  // items: lots (cards bought together) are one line with their cards listed; other cards one line each
  const items = [], lots = {};
  cards.forEach(c => {
    if (c.lotId) {
      if (!lots[c.lotId]) { lots[c.lotId] = { name: c.lotName || 'Lot', names: [], cost: 0 }; items.push(lots[c.lotId]); }
      lots[c.lotId].names.push(c.name); lots[c.lotId].cost = r2(lots[c.lotId].cost + c.purchaseCost);
    } else items.push({ name: c.name, cost: c.purchaseCost });
  });
  // items that were billed but not recorded to the portfolio (e.g. supplies) only exist as Finance rows
  const known = new Set(cards.map(c => c.name)), extra = {};
  itemRows.forEach(t => { if (!known.has(t.description)) extra[t.description] = (extra[t.description] || 0) + t.amount; });
  Object.keys(extra).forEach(n => items.push({ name: n, cost: r2(extra[n]) }));
  items.forEach(addItem); if (!items.length) addItem({ name: '', cost: '' });
  // paid from: one account, or several. Shipping that was paid from its own account is shown separately.
  const by = {}; itemRows.forEach(t => { by[t.payMethod] = (by[t.payMethod] || 0) + t.amount; });
  const itemMethods = Object.keys(by);
  let sepAcct = '';
  shipRows.forEach(t => { if (itemMethods.length && !(itemMethods.length === 1 && itemMethods[0] === t.payMethod) && !itemMethods.includes(t.payMethod)) sepAcct = t.payMethod; else by[t.payMethod] = (by[t.payMethod] || 0) + t.amount; });
  const methods = setPay(by); if (!methods.length) $('frPay').value = (cards[0] && cards[0].payLabel) || 'Cash';
  const shipTotal = shipRows.reduce((n, t) => n + t.amount, 0), sm = shipRows.map(t => (t.description.match(/^Shipping \((.+?)\):/) || [])[1]).find(Boolean);
  $('frShip').value = shipTotal || '';
  $('frMethod').value = sm || '';
  $('frAcct').value = sepAcct;
  $('frNotes').value = (cards[0] && cards[0].purchaseNotes) || '';
  setPeople((cards[0] && cards[0].boughtBy) || '');
  $('frFound').textContent = cards.length ? `${cards.length} card${cards.length === 1 ? '' : 's'} found for this receipt.` : (itemRows.length ? 'No cards are linked to this receipt. Items were read from Finance.' : 'No cards or Finance rows were found for this receipt. Fill the details in by hand.');
}

function addItem(it) {
  const row = document.createElement('div'); row.className = 'fr-item';
  if (it.names) row.dataset.names = JSON.stringify(it.names);
  row.innerHTML = `<input type="text" class="fr-n" placeholder="${kind === 'sale' ? 'Card' : 'Item'}" value="${esc(it.name)}"><div class="money"><em>PHP</em><input type="number" class="fr-c" step="0.01" min="0" inputmode="decimal" value="${it.cost === '' ? '' : esc(it.cost)}"></div><button type="button" class="ghost sm fr-x" aria-label="Remove">\u00d7</button>`;
  $('frItems').appendChild(row);
}
const num = id => parseFloat($(id).value) || 0;
function data() {
  const sale = kind === 'sale';
  const entries = [...document.querySelectorAll('#frItems .fr-item')].map(r => {
    const name = r.querySelector('.fr-n').value.trim(), cost = parseFloat(r.querySelector('.fr-c').value) || 0;
    if (r.dataset.names) { let names = []; try { names = JSON.parse(r.dataset.names); } catch (_) {} return { type: 'lot', name, names, total: cost, cost }; }
    return { type: 'item', name, cost };
  }).filter(e => e.name || e.cost);
  const sub = r2(entries.reduce((n, e) => n + e.cost, 0)), pack = sale ? num('frPack') : 0, type = sale ? $('frType').value : 'buyer';
  const ship = sale && type === 'none' ? 0 : num('frShip');
  let payments = []; try { payments = $('frPay').dataset.split ? JSON.parse($('frPay').dataset.split) : []; } catch (_) {}
  return { mode: sale ? 'sold' : 'purchase', date: $('frDate').value, time: $('frTime').value, party: $('frBuyer').value.trim(), people: $('frPeople').value.trim(),
    pay: payments.length ? payments[0].method : $('frPay').value.trim(), payments, entries, multi: entries.length > 1, items: entries,
    sub, ship, pack, total: sale ? r2(sub + pack + (type === 'buyer' ? ship : 0)) : r2(sub + ship),
    method: $('frMethod').value.trim() || (sale ? '-' : ''), shipAcct: ship > 0 ? $('frAcct').value.trim() : '', shipType: type,
    deduct: $('frDeduct').value.trim() || 'Cash', safekeep: sale && $('frKeep').checked, notes: $('frNotes').value.trim() };
}
function recalc() { $('frTotal').textContent = php(data().total); }

async function generate() {
  const d = data();
  if (!d.date) return toast('Pick the receipt date.');
  if (!d.entries.length) return toast('Add at least one item.');
  const b = $('frGen'); b.disabled = true; b.textContent = 'Generating\u2026';
  try {
    await Promise.all([document.fonts.load('40px "Archivo Black"'), document.fonts.load('400 24px Poppins'), document.fonts.load('600 24px Poppins')]);
    const logo = await loadImg(CONFIG.logo);
    let blob;
    try { blob = await render(d, logo); } catch (err) { if (!logo) throw err; blob = await render(d, null); toast('The logo was blocked by the browser, so it is missing from this image.'); }
    if (!blob) throw new Error('Image export returned nothing');
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    $('frImg').src = blobUrl;
    const name = (cur ? String(cur.description || 'Receipt') : 'Receipt').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + d.date + '.jpg';
    $('frDl').href = blobUrl; $('frDl').download = name; $('frOut').hidden = false;
    $('frOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { toast('Could not generate: ' + err.message); }
  b.disabled = false; b.textContent = 'Generate image';
}

$('frKind').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b && b.dataset.k !== kind) setKind(b.dataset.k); });
$('frSel').onchange = () => pick(+$('frSel').value);
$('frAdd').onclick = () => addItem({ name: '', cost: '' });
$('frItems').addEventListener('click', e => { const x = e.target.closest('.fr-x'); if (x) { x.closest('.fr-item').remove(); recalc(); } });
document.querySelector('main').addEventListener('input', recalc);
$('frChips').innerHTML = PEOPLE.map(p => `<button type="button" class="chip" data-p="${p}">${p}</button>`).join('');
$('frChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; b.classList.toggle('active');
  $('frPeople').value = [...document.querySelectorAll('#frChips .chip.active')].map(c => c.dataset.p).join(', ');
});
$('frGen').onclick = generate;
load();
