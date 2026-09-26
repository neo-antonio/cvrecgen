/* ===== EDIT THESE ===== */
const CONFIG = {
  brand: 'CV RecGen',
  siteLink: 'Court Vision',   // printed at the bottom of every receipt
  logo: 'icons/logo.png',         // printed at the top of every receipt
  portfolio: {
    endpoint: 'https://script.google.com/macros/s/AKfycbzL7Fs7HbRE2LHWYqyO1edz5JZUQPI0RKAFI0LHf-BZ5xM9aKtvI738Soqh1FYsHVVw6g/exec',
    secret: 'courtvision_$0819'   // must match the SECRET constant in Code.gs
  }
};
/* ====================== */

const PEOPLE = ['Ariel', 'Justine', 'Lemuel', 'Neo', 'Yuki'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const php = n => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); };
const shipType = () => $('input[name=st]:checked').value;
const SHIP_LABEL = { buyer: 'c/o buyer', us: 'c/o us', none: 'No shipping' };
let mode = 'purchase';

/* ---------- Items ---------- */
const CAMERA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
let itemSeq = 0;
const itemPhotos = {};  // id -> {kind:'camera'|'upload'|'link', src}
let activePhotoId = null;

function addItem() {
  const id = 'p' + (++itemSeq);
  const block = document.createElement('div');
  block.className = 'item-block';
  block.dataset.id = id;
  block.innerHTML = `<div class="item">
      <button type="button" class="photo-btn" data-id="${id}" aria-label="Add photo">${CAMERA_ICON}</button>
      <input class="in-name" placeholder="Item name" autocomplete="off">
      <input class="in-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
      <button type="button" class="x" aria-label="Remove item">&times;</button>
    </div>
    <label class="port-chk"><input type="checkbox" class="in-port" checked><span>Record to portfolio</span></label>`;
  $('#items').append(block);
  update();
}
$('#addItem').onclick = () => { addItem(); $$('.in-name').pop().focus(); };
$('#items').addEventListener('click', e => {
  if (e.target.classList.contains('x')) { const b = e.target.closest('.item-block'); delete itemPhotos[b.dataset.id]; b.remove(); update(); }
  const pb = e.target.closest('.photo-btn'); if (pb) openPhotoSheet(pb.dataset.id);
});
$('#items').addEventListener('input', update);
const items = () => $$('.item-block').map(b => ({
  id: b.dataset.id,
  name: b.querySelector('.in-name').value.trim(),
  cost: parseFloat(b.querySelector('.in-cost').value) || 0,
  portfolio: mode === 'purchase' && b.querySelector('.in-port').checked,
  photo: itemPhotos[b.dataset.id] || null
})).filter(i => i.name || i.cost);
const subtotal = () => items().reduce((a, i) => a + i.cost, 0);

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
function handleFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activePhotoId) return;
    const id = activePhotoId;
    const reader = new FileReader();
    reader.onload = () => { itemPhotos[id] = { kind, src: reader.result }; updateThumb(id); };
    reader.readAsDataURL(f);
    closePhotoSheet();
  });
}
handleFile($('#fileCamera'), 'camera');
handleFile($('#fileUpload'), 'upload');
const shipping = () => (mode === 'sold' && shipType() === 'none') ? 0 : (parseFloat($('#ship').value) || 0);
// Purchase: shipping always counted in the total. Sold: shipping counts only when the buyer shoulders it (c/o buyer);
// it's excluded when it's on us (c/o us) or when there's no shipping at all.
const grandTotal = () => mode === 'purchase' ? subtotal() + shipping() : (shipType() === 'buyer' ? subtotal() + shipping() : subtotal());

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
function setMode(m) {
  mode = m;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  $('#items').classList.toggle('mode-purchase', m === 'purchase');
  const p = m === 'purchase';
  $('#lParty').textContent = p ? 'Seller' : 'Buyer';
  $('#lPeople').textContent = p ? 'Bought by' : 'Sold by';
  $('#lPay').textContent = p ? 'Purchased using' : 'Received in';
  $('#lTotal').textContent = p ? 'Total spent' : 'Total received';
  $('#notes').placeholder = p ? 'Add notes e.g. box size, supplier link.' : 'Add notes e.g. excess cash from shipping overpay, for CV storing, for reimbursements';
  update();
}
$$('.tab').forEach(t => t.onclick = () => setMode(t.dataset.mode));

function update() {
  $$('[data-only]').forEach(e => e.hidden = e.dataset.only !== mode);
  const rows = $$('.item');
  rows.forEach(r => r.classList.toggle('solo', rows.length === 1));
  $('#subRow').hidden = rows.length < 2;
  $('#subVal').textContent = php(subtotal());
  if (mode === 'sold') {
    const none = shipType() === 'none';
    $('#ship').disabled = none;
    if (none) $('#ship').value = '';
    $('#deductRow').hidden = shipType() !== 'us';
    $('#methodOther').hidden = $('#method').value !== 'Others';
    $('#deductOther').hidden = $('#deduct').value !== 'Others';
  } else $('#deductRow').hidden = true;
  $('#ship').disabled = mode === 'sold' && shipType() === 'none';
  $('#payOther').hidden = $('#pay').value !== 'Others';
  $('#totalVal').textContent = php(grandTotal());
}
['#ship', '#method', '#deduct', '#pay'].forEach(s => $(s).addEventListener('input', update));
$$('input[name=st]').forEach(r => r.addEventListener('change', update));

$('#sched').addEventListener('click', e => { if (!e.target.value) { e.target.value = todayStr(); try { e.target.showPicker(); } catch (_) {} } });
$('#schedClear').onclick = () => $('#sched').value = '';

/* ---------- Collect data ---------- */
function collect() {
  const sold = mode === 'sold';
  const t = shipType();
  return {
    mode, date: $('#date').value || todayStr(),
    party: $('#party').value.trim(), people: people().join(', '),
    pay: $('#pay').value === 'Others' ? ($('#payOther').value.trim() || 'Others') : $('#pay').value,
    items: items(), multi: $$('.item').length > 1, sub: subtotal(), ship: shipping(),
    total: grandTotal(),
    method: $('#method').value === 'Others' ? ($('#methodOther').value.trim() || 'Others') : $('#method').value,
    shipType: t, sched: $('#sched').value,
    deduct: $('#deduct').value === 'Others' ? ($('#deductOther').value.trim() || 'Others') : $('#deduct').value,
    notes: $('#notes').value.trim()
  };
}

/* ---------- Receipt renderer (1080 x 1080) ---------- */
function draw(x, d, s, dry, logo) {
  const W = 1080, P = 72, R = W - P, G = '#b4b4b4', sold = d.mode === 'sold';
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
  if (!dry) { x.font = '58px "Archivo Black"'; txt(sold ? 'SALES RECEIPT' : 'PURCHASE RECEIPT', P, y, '#fff'); }
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
  row(sold ? 'Buyer' : 'Seller', d.party);
  row(sold ? 'Sold by' : 'Bought by', d.people);
  row(sold ? 'Received in' : 'Purchased using', d.pay);
  y += 8 * s; rule(y); y += 22 * s;
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
    row('Shipping method', d.method);
    row('Shipping', d.shipType === 'none' ? 'No shipping (PHP 0.00)' : `${php(d.ship)} (${SHIP_LABEL[d.shipType]})`);
    if (d.sched) row('Scheduled shipping', fmtDate(d.sched));
    if (d.shipType === 'us') row('Shipping deducted from', d.deduct);
  } else row('Shipping', php(d.ship));

  y += 6 * s; rule(y, G); y += 24 * s;
  set(400, 30, true); txt(sold ? 'TOTAL RECEIVED' : 'TOTAL SPENT', P, y + 12 * s, '#fff');
  set(400, 44, true); txt(php(d.total), R, y, '#fff', 'right');
  y += 66 * s;

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

/* ---------- Portfolio sync (Google Sheets via Apps Script) ---------- */
async function syncPortfolio(d) {
  if (!CONFIG.portfolio.endpoint) return;  // not set up yet — see apps-script/Code.gs
  const flagged = d.items.filter(i => i.portfolio);
  if (!flagged.length) return;
  try {
    const res = await fetch(CONFIG.portfolio.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // avoids a CORS preflight to Apps Script
      body: JSON.stringify({
        secret: CONFIG.portfolio.secret, date: d.date, seller: d.party, people: d.people, notes: d.notes,
        items: flagged.map(i => ({ name: i.name, cost: i.cost, photo: i.photo }))
      })
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok !== true) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      console.warn('Portfolio sync rejected:', msg, data);
      toast('Portfolio sync failed: ' + msg);
    }
  } catch (err) {
    console.warn('Portfolio sync failed', err);
    toast('Receipt saved, but portfolio sync failed (network/CORS?).');
  }
}

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
  if (!d.items.length) return toast('Add at least one item.');
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
    if (d.mode === 'purchase') syncPortfolio(d);
    if (skipped) toast('Logo skipped. Open the app from http://localhost or your website to include it.');
  } catch (e) {
    console.error(e);
    toast('Could not generate receipt: ' + (e.message || e.name));
  }
  $('#gen').disabled = false;
}
$('#gen').onclick = generate;

function showPreview(blob, name) {
  const url = URL.createObjectURL(blob);
  $('#prevImg').src = url;
  $('#dl').href = url; $('#dl').download = name;
  const file = new File([blob], name, { type: 'image/jpeg' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $('#share').hidden = !canShare;
  $('#share').onclick = () => navigator.share({ files: [file] }).catch(() => {});
  $('#close').onclick = () => { $('#modal').hidden = true; URL.revokeObjectURL(url); };
  $('#modal').hidden = false;
}

function toast(m) {
  const t = $('#toast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

/* ---------- Init ---------- */
$('#date').value = todayStr();
addItem();
setMode('purchase');