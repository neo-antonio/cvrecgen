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
let activeShipPhotoType = 'proof';   // 'proof' = proof of shipment, 'card' = the item's own photo

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

const SHIP_ICON = {
  doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.4"/>',
  proof: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><path d="M9.3 13.4l2 2 3.4-3.6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16 9.7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'
};
const shipIcon = (name, cls, label, id, extra = '') => `<button type="button" class="icon-btn ${cls}" data-id="${id}" ${extra} title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SHIP_ICON[name]}</svg></button>`;

function cardHtml(it, isToShip) {
  const img = it.photo ? `<img src="${it.photo}" alt="${escShip(it.name)}" loading="lazy" class="ship-clickphoto" data-full="${it.photo}">` : `<div class="port-noimg">No photo</div>`;
  const careLine = CARE_LABEL[it.shipType] || it.shipType || '';
  const metaLines = [
    `Sold to ${escShip(it.soldTo || '\u2014')} for ${shipPhp(it.soldPrice)}`,
    `${escShip(it.shipMethod || '\u2014')} \u00b7 ${careLine}${it.deductedFrom ? ' \u00b7 deducted from ' + escShip(it.deductedFrom) : ''}`,
    isToShip
      ? (it.scheduledDate ? `Scheduled ${fmtDay(it.scheduledDate)}` : 'No schedule set')
      : `Shipped ${fmtDay(it.shippedDate)}`
  ];
  const proof = !isToShip && it.proofPhoto ? `<div class="port-thumb"><img src="${it.proofPhoto}" alt="Proof of shipment" class="ship-clickphoto" data-full="${it.proofPhoto}"></div>` : '';
  const receiptBtn = it.saleReceipt ? shipIcon('doc', 'ship-receipt', 'Receipt', it.id, `data-url="${escShip(it.saleReceipt)}"`) : '';
  const itemPhotoBtn = shipIcon('camera', 'ship-itemphoto', it.photo ? 'Change item photo' : 'Add item photo', it.id);
  const actions = isToShip
    ? `<div class="ship-actions">${shipIcon('check', 'ship-mark', 'Mark shipped', it.id)}${itemPhotoBtn}${receiptBtn}${shipIcon('trash', 'ship-delete danger', 'Delete card', it.id)}</div>`
    : `<div class="ship-actions">${proof}${shipIcon('proof', 'ship-addphoto', it.proofPhoto ? 'Change proof photo' : 'Add proof photo', it.id)}${itemPhotoBtn}${receiptBtn}${shipIcon('undo', 'ship-revert', 'Revert', it.id)}</div>`;
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
  const photo = e.target.closest('.ship-clickphoto');
  if (photo) {
    document.getElementById('imgViewImg').src = photo.dataset.full;
    document.getElementById('imgView').hidden = false;
    return;
  }
  const receiptBtn = e.target.closest('.ship-receipt');
  if (receiptBtn) { window.open(receiptBtn.dataset.url, '_blank'); return; }

  const markBtn = e.target.closest('.ship-mark');
  if (markBtn) {
    markBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=markShipped&cardId=' + encodeURIComponent(markBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadShipping();
    } catch (err) {
      console.warn('Mark shipped failed', err);
      markBtn.disabled = false;
      toast('Could not mark as shipped: ' + err.message);
    }
    return;
  }

  const revertBtn = e.target.closest('.ship-revert');
  if (revertBtn) {
    revertBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=unmarkShipped&cardId=' + encodeURIComponent(revertBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadShipping();
    } catch (err) {
      revertBtn.disabled = false;
      toast('Could not revert: ' + err.message);
    }
    return;
  }

  const delBtn = e.target.closest('.ship-delete');
  if (delBtn) {
    if (!confirm('Delete this card permanently? This cannot be undone.')) return;
    delBtn.disabled = true;
    try {
      const url = CONFIG.portfolio.endpoint + '?action=deleteCard&cardId=' + encodeURIComponent(delBtn.dataset.id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const data = await jsonp(url);
      if (!data.ok) throw new Error(data.error || 'Request failed');
      await loadShipping();
    } catch (err) {
      delBtn.disabled = false;
      toast('Could not delete: ' + err.message);
    }
    return;
  }

  const photoBtn = e.target.closest('.ship-addphoto');
  if (photoBtn) { openShipPhotoSheet(photoBtn.dataset.id, 'proof'); return; }

  const itemPhotoBtn = e.target.closest('.ship-itemphoto');
  if (itemPhotoBtn) openShipPhotoSheet(itemPhotoBtn.dataset.id, 'card');
});

document.getElementById('imgViewClose').onclick = () => document.getElementById('imgView').hidden = true;
document.getElementById('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') document.getElementById('imgView').hidden = true; });

/* ---------- Proof-of-shipment photo modal ---------- */
const findShipItem = id => shipData.toShip.concat(shipData.shipped).find(c => String(c.id) === String(id));
function openShipPhotoSheet(cardId, type) {
  activeShipCardId = cardId;
  activeShipPhotoType = type || 'proof';
  const it = findShipItem(cardId);
  const has = !!(it && (activeShipPhotoType === 'card' ? it.photo : it.proofPhoto));
  document.getElementById('shipPsTitle').textContent = activeShipPhotoType === 'card' ? 'Item photo' : 'Attach proof of shipment';
  document.getElementById('shipPsRemove').hidden = !has;
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
  sendShipPhoto(activeShipCardId, { kind: 'link', src: url }, activeShipPhotoType);
  closeShipPhotoSheet();
};
document.getElementById('shipPsRemove').onclick = async () => {
  const id = activeShipCardId, which = activeShipPhotoType;
  if (!id) return;
  closeShipPhotoSheet();
  try {
    const url = CONFIG.portfolio.endpoint + '?action=clearPhoto&which=' + which + '&cardId=' + encodeURIComponent(id) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    toast('Photo removed.');
    await loadShipping();
  } catch (err) { toast('Could not remove photo: ' + err.message); }
};
function handleShipFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activeShipCardId) return;
    const cardId = activeShipCardId, which = activeShipPhotoType;
    const reader = new FileReader();
    reader.onload = () => sendShipPhoto(cardId, { kind, src: reader.result }, which);
    reader.readAsDataURL(f);
    closeShipPhotoSheet();
  });
}
handleShipFile(document.getElementById('shipFileCamera'), 'camera');
handleShipFile(document.getElementById('shipFileUpload'), 'upload');

async function sendShipPhoto(cardId, photo, which) {
  toast('Uploading photo\u2026');
  const payload = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: which === 'card' ? 'cardPhoto' : 'shipPhoto', secret: CONFIG.portfolio.secret, cardId, photo })
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
