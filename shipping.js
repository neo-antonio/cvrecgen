/* ---------- Shipping (To ship / Shipped) — reads Cards, marks shipped, attaches proof photos ---------- */
const shipPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escShip = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $shipList = document.getElementById('shipList');
const $shipState = document.getElementById('shipState');
const $shipTotal = document.getElementById('shipTotal');
const $shipRefresh = document.getElementById('shipRefresh');
const CARE_LABEL = { buyer: 'c/o buyer', us: 'c/o us', none: 'No shipping' };

let shipTab = 'toship';
let shipData = { toShip: [], shipped: [] };
let activeShipCardId = null;

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'shipCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
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

function toast(m) {
  const t = document.getElementById('shipToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600);
}

function fmtDay(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function cardHtml(it, isToShip) {
  const img = it.photo ? `<img src="${it.photo}" alt="${escShip(it.name)}" loading="lazy">` : `<div class="port-noimg">No photo</div>`;
  const careLine = CARE_LABEL[it.shipType] || it.shipType || '';
  const metaLines = [
    `Sold to ${escShip(it.soldTo || '\u2014')} for ${shipPhp(it.soldPrice)}`,
    `${escShip(it.shipMethod || '\u2014')} \u00b7 ${careLine}${it.deductedFrom ? ' \u00b7 deducted from ' + escShip(it.deductedFrom) : ''}`,
    isToShip
      ? (it.scheduledDate ? `Scheduled ${fmtDay(it.scheduledDate)}` : 'No schedule set')
      : `Shipped ${fmtDay(it.shippedDate)}`
  ];
  const proof = !isToShip && it.proofPhoto ? `<div class="port-thumb" style="width:36px;height:36px"><img src="${it.proofPhoto}" alt="Proof of shipment"></div>` : '';
  const actions = isToShip
    ? `<div class="ship-actions"><button type="button" class="ghost sm ship-mark" data-id="${it.id}">Mark shipped</button></div>`
    : `<div class="ship-actions">${proof}<button type="button" class="ghost sm ship-addphoto" data-id="${it.id}">${it.proofPhoto ? 'Replace photo' : 'Add photo'}</button></div>`;
  return `<div class="ship-card" data-id="${it.id}">
      <div class="ship-top">
        <div class="port-thumb">${img}</div>
        <div class="port-info"><b>${escShip(it.name)}</b><span>${shipPhp(it.shipFee)} shipping fee</span></div>
      </div>
      <div class="ship-meta">${metaLines.join('<br>')}</div>
      ${actions}
    </div>`;
}

function renderTab() {
  const list = shipTab === 'toship' ? shipData.toShip : shipData.shipped;
  if (!list.length) {
    $shipState.textContent = shipTab === 'toship' ? 'Nothing waiting to ship.' : 'Nothing shipped yet.';
    $shipState.hidden = false; $shipList.hidden = true;
    $shipTotal.textContent = shipPhp(0);
    return;
  }
  $shipList.innerHTML = list.map(it => cardHtml(it, shipTab === 'toship')).join('');
  $shipTotal.textContent = shipPhp(list.reduce((a, i) => a + (Number(i.shipFee) || 0), 0));
  $shipState.hidden = true; $shipList.hidden = false;
}

async function loadShipping() {
  if (!CONFIG.portfolio.endpoint) { $shipState.textContent = "Sync isn't set up yet."; $shipState.hidden = false; $shipList.hidden = true; return; }
  $shipState.textContent = 'Loading\u2026'; $shipState.hidden = false; $shipList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=shipping&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    shipData = { toShip: data.toShip || [], shipped: data.shipped || [] };
    renderTab();
  } catch (err) {
    console.warn('Shipping load failed', err);
    $shipState.textContent = "Couldn't load shipping data (offline, wrong secret, or Code.gs needs a new deployment).";
    $shipState.hidden = false; $shipList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-stab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-stab]').forEach(x => x.classList.toggle('active', x === t));
  shipTab = t.dataset.stab;
  renderTab();
});
$shipRefresh.onclick = loadShipping;

$shipList.addEventListener('click', async e => {
  const markBtn = e.target.closest('.ship-mark');
  if (markBtn) {
    markBtn.disabled = true; markBtn.textContent = 'Marking\u2026';
    try {
      const url = CONFIG.portfolio.endpoint + '?action=markShipped&cardId=' + encodeURIComponent(markBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadShipping();
    } catch (err) {
      console.warn('Mark shipped failed', err);
      markBtn.disabled = false; markBtn.textContent = 'Mark shipped';
      toast('Could not mark as shipped: ' + err.message);
    }
    return;
  }
  const photoBtn = e.target.closest('.ship-addphoto');
  if (photoBtn) openShipPhotoSheet(photoBtn.dataset.id);
});

/* ---------- Proof-of-shipment photo modal ---------- */
function openShipPhotoSheet(cardId) {
  activeShipCardId = cardId;
  document.getElementById('shipPsLinkField').hidden = true;
  document.getElementById('shipPsLinkInput').value = '';
  document.getElementById('shipPhotoSheet').hidden = false;
}
function closeShipPhotoSheet() { document.getElementById('shipPhotoSheet').hidden = true; activeShipCardId = null; }
document.getElementById('shipPsCancel').onclick = closeShipPhotoSheet;
document.getElementById('shipPhotoSheet').addEventListener('click', e => { if (e.target.id === 'shipPhotoSheet') closeShipPhotoSheet(); });
document.getElementById('shipPsCamera').onclick = () => document.getElementById('shipFileCamera').click();
document.getElementById('shipPsUpload').onclick = () => document.getElementById('shipFileUpload').click();
document.getElementById('shipPsLink').onclick = () => { document.getElementById('shipPsLinkField').hidden = false; document.getElementById('shipPsLinkInput').focus(); };
document.getElementById('shipPsLinkUse').onclick = () => {
  const url = document.getElementById('shipPsLinkInput').value.trim();
  if (!url || !activeShipCardId) return;
  sendShipPhoto(activeShipCardId, { kind: 'link', src: url });
  closeShipPhotoSheet();
};
function handleShipFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activeShipCardId) return;
    const cardId = activeShipCardId;
    const reader = new FileReader();
    reader.onload = () => sendShipPhoto(cardId, { kind, src: reader.result });
    reader.readAsDataURL(f);
    closeShipPhotoSheet();
  });
}
handleShipFile(document.getElementById('shipFileCamera'), 'camera');
handleShipFile(document.getElementById('shipFileUpload'), 'upload');

async function sendShipPhoto(cardId, photo) {
  toast('Uploading photo\u2026');
  const payload = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'shipPhoto', secret: CONFIG.portfolio.secret, cardId, photo })
  };
  try {
    const res = await fetch(CONFIG.portfolio.endpoint, payload);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`);
    toast('Photo attached.');
    await loadShipping();
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

loadShipping();
