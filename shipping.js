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
let activeShipCardIds = [];       // one card (item photo) or every card of a group (proof photo)
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

const isoToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const dayNum = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
// days past the scheduled date for a to-ship group: >0 delayed, 0 due today, <0 upcoming, null = no schedule
const daysLate = f => (f && f.scheduledDate) ? dayNum(isoToday()) - dayNum(f.scheduledDate) : null;
const fmtWeekday = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };

const SHIP_ICON = {
  doc: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.2" r="3.4"/>',
  proof: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><path d="M9.3 13.4l2 2 3.4-3.6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16 9.7"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'
};
const shipIcon = (name, cls, label, id, extra = '') => `<button type="button" class="icon-btn ${cls}" data-id="${id}" ${extra} title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SHIP_ICON[name]}</svg></button>`;

/* Cards that came from the same sale receipt are one task: Code.gs gives them a shared groupKey.
   Order inside a group follows the sheet (the order they were picked on the receipt). */
function groupCards(list) {
  const map = new Map();
  list.forEach(it => {
    const k = it.groupKey || ('c:' + it.id);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  return [...map.values()].map(g => g.slice().reverse());
}

function itemRowHtml(it) {
  const img = it.photo ? `<img src="${it.photo}" alt="${escShip(it.name)}" loading="lazy" class="ship-clickphoto" data-full="${it.photo}">` : `<div class="port-noimg">No photo</div>`;
  return `<div class="ship-item">
      <div class="port-thumb">${img}</div>
      <div class="port-info"><b>${escShip(it.name)}</b><span>${shipPhp(it.soldPrice)}</span></div>
      <div class="ship-item-acts">
        ${shipIcon('camera', 'flat ship-itemphoto', it.photo ? 'Change item photo' : 'Add item photo', it.id)}
        ${shipIcon('trash', 'flat danger ship-delete', 'Delete card', it.id)}
      </div>
    </div>`;
}

function cardHtml(group, isToShip) {
  const f = group[0];
  const ids = group.map(i => i.id).join(',');
  const n = group.length;
  const soldTotal = group.reduce((a, i) => a + (Number(i.soldPrice) || 0), 0);
  const fee = group.reduce((a, i) => a + (Number(i.shipFee) || 0), 0);
  const careLine = CARE_LABEL[f.shipType] || f.shipType || '';
  const proofUrl = (group.find(i => i.proofPhoto) || {}).proofPhoto || '';
  const receiptUrl = (group.find(i => i.saleReceipt) || {}).saleReceipt || '';
  const hasProof = !!proofUrl;
  const late = isToShip ? daysLate(f) : null;
  const state = late === null ? '' : late > 0 ? 'late' : late === 0 ? 'today' : '';
  const metaLines = [
    `Sold to ${escShip(f.soldTo || '\u2014')}${n > 1 ? ` \u00b7 ${n} cards` : ''} for ${shipPhp(soldTotal)}`,
    `${careLine}${f.deductedFrom ? ' \u00b7 deducted from ' + escShip(f.deductedFrom) : ''}`,
    `${shipPhp(fee)} shipping fee`
  ];
  // the two things you act on, shown large: how it ships and when
  const dateText = isToShip
    ? (f.scheduledDate ? fmtWeekday(f.scheduledDate) : 'No schedule set')
    : fmtWeekday(f.shippedDate);
  const dateLabel = isToShip ? 'Ship on' : 'Shipped on';
  const badge = state === 'late' ? `<span class="ship-badge late">Delayed ${late} day${late === 1 ? '' : 's'}</span>`
    : state === 'today' ? `<span class="ship-badge today">Ship today</span>` : '';
  const key = `<div class="ship-key">
      <div><small>Method</small><b>${escShip(f.shipMethod || '\u2014')}</b></div>
      <div class="${state}"><small>${dateLabel}</small><b>${escShip(dateText)}</b>${badge}</div>
    </div>`;
  const address = (f.address || isToShip) ? `<div class="ship-addr"><small>Ship to</small>${f.address ? escShip(f.address) : '<em>No address yet</em>'}</div>` : '';
  const proof = !isToShip && hasProof ? `<div class="port-thumb"><img src="${proofUrl}" alt="Proof of shipment" class="ship-clickphoto" data-full="${proofUrl}"></div>` : '';
  const receiptBtn = receiptUrl ? shipIcon('doc', 'ship-receipt', 'Receipt', ids, `data-url="${escShip(receiptUrl)}"`) : '';
  const actions = isToShip
    ? `<div class="ship-actions">${shipIcon('pencil', 'ship-edit', 'Edit address & schedule', ids)}${shipIcon('check', 'ship-mark', n > 1 ? 'Mark all shipped' : 'Mark shipped', ids)}${receiptBtn}</div>`
    : `<div class="ship-actions">${proof}${shipIcon('proof', 'ship-addphoto', hasProof ? 'Change proof photo' : 'Add proof photo', ids)}${receiptBtn}${shipIcon('undo', 'ship-revert', n > 1 ? 'Revert all' : 'Revert', ids)}</div>`;
  return `<div class="ship-card ${state}" data-ids="${escShip(ids)}">
      ${key}
      <div class="ship-items">${group.map(itemRowHtml).join('')}</div>
      <div class="ship-meta">${metaLines.join('<br>')}</div>
      ${address}
      ${actions}
    </div>`;
}

function renderAlert() {
  const groups = groupCards(shipData.toShip);
  const late = groups.filter(g => daysLate(g[0]) > 0), today = groups.filter(g => daysLate(g[0]) === 0);
  const $a = document.getElementById('shipAlert');
  const parts = [];
  if (late.length) {
    const worst = Math.max(...late.map(g => daysLate(g[0])));
    parts.push(`<b>\u26a0 ${late.length} shipment${late.length > 1 ? 's are' : ' is'} delayed</b> \u2014 the oldest is ${worst} day${worst === 1 ? '' : 's'} past its scheduled date.`);
  }
  if (today.length) parts.push(`${today.length} shipment${today.length > 1 ? 's are' : ' is'} scheduled to go out today.`);
  $a.className = 'ship-alert' + (late.length ? '' : ' mild');
  $a.innerHTML = parts.join('<br>');
  $a.hidden = !parts.length;
}

function renderTab() {
  renderAlert();
  const list = shipTab === 'toship' ? shipData.toShip : shipData.shipped;
  if (!list.length) {
    $shipState.textContent = shipTab === 'toship' ? 'Nothing waiting to ship.' : 'Nothing shipped yet.';
    $shipState.hidden = false; $shipList.hidden = true;
    $shipTotal.textContent = shipPhp(0);
    return;
  }
  let groups = groupCards(list);
  if (shipTab === 'toship') {   // most overdue first, then by scheduled date; unscheduled last
    const rank = g => { const d = g[0].scheduledDate; return d ? dayNum(d) : Infinity; };
    groups = groups.map((g, i) => ({ g, i })).sort((a, b) => (rank(a.g) - rank(b.g)) || (a.i - b.i)).map(x => x.g);
  }
  $shipList.innerHTML = groups.map(g => cardHtml(g, shipTab === 'toship')).join('');
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

  const editBtn = e.target.closest('.ship-edit');
  if (editBtn) { openShipEdit(editBtn.dataset.id.split(',')); return; }

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
  if (photoBtn) { openShipPhotoSheet(photoBtn.dataset.id.split(','), 'proof'); return; }

  const itemPhotoBtn = e.target.closest('.ship-itemphoto');
  if (itemPhotoBtn) openShipPhotoSheet([itemPhotoBtn.dataset.id], 'card');
});

document.getElementById('imgViewClose').onclick = () => document.getElementById('imgView').hidden = true;
document.getElementById('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') document.getElementById('imgView').hidden = true; });

/* ---------- Edit scheduled date + address of a to-ship task (applies to every card in the group) ---------- */
let editShipIds = [];
function openShipEdit(ids) {
  const f = findShipItem(ids[0]);
  if (!f) return;
  editShipIds = ids;
  document.getElementById('shipEditSched').value = f.scheduledDate ? String(f.scheduledDate).slice(0, 10) : '';
  document.getElementById('shipEditAddr').value = f.address || '';
  document.getElementById('shipEditSheet').hidden = false;
}
const closeShipEdit = () => { document.getElementById('shipEditSheet').hidden = true; editShipIds = []; };
document.getElementById('shipEditCancel').onclick = closeShipEdit;
document.getElementById('shipEditSheet').addEventListener('click', e => { if (e.target.id === 'shipEditSheet') closeShipEdit(); });
document.getElementById('shipEditClear').onclick = () => document.getElementById('shipEditSched').value = '';
document.getElementById('shipEditSave').onclick = async () => {
  if (!editShipIds.length) return;
  const btn = document.getElementById('shipEditSave');
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const url = CONFIG.portfolio.endpoint + '?action=updateShipping&cardId=' + encodeURIComponent(editShipIds.join(','))
      + '&sched=' + encodeURIComponent(document.getElementById('shipEditSched').value)
      + '&address=' + encodeURIComponent(document.getElementById('shipEditAddr').value.trim())
      + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    closeShipEdit();
    toast('Shipping details updated.');
    await loadShipping();
  } catch (err) { toast('Could not save: ' + err.message); }
  btn.disabled = false; btn.textContent = 'Save changes';
};

/* ---------- Proof-of-shipment photo modal ---------- */
const findShipItem = id => shipData.toShip.concat(shipData.shipped).find(c => String(c.id) === String(id));
function openShipPhotoSheet(cardIds, type) {
  activeShipCardIds = cardIds;
  activeShipPhotoType = type || 'proof';
  const has = cardIds.some(id => { const it = findShipItem(id); return !!(it && (activeShipPhotoType === 'card' ? it.photo : it.proofPhoto)); });
  document.getElementById('shipPsTitle').textContent = activeShipPhotoType === 'card' ? 'Item photo' : (cardIds.length > 1 ? 'Attach proof of shipment (all cards)' : 'Attach proof of shipment');
  document.getElementById('shipPsRemove').hidden = !has;
  document.getElementById('shipPsLinkField').hidden = true;
  document.getElementById('shipPsLinkInput').value = '';
  document.getElementById('shipPhotoSheet').hidden = false;
}
function closeShipPhotoSheet() { document.getElementById('shipPhotoSheet').hidden = true; activeShipCardIds = []; }
document.getElementById('shipPsCancel').onclick = closeShipPhotoSheet;
document.getElementById('shipPhotoSheet').addEventListener('click', e => { if (e.target.id === 'shipPhotoSheet') closeShipPhotoSheet(); });
document.getElementById('shipPsCamera').onclick = () => document.getElementById('shipFileCamera').click();
document.getElementById('shipPsUpload').onclick = () => document.getElementById('shipFileUpload').click();
document.getElementById('shipPsLink').onclick = () => { document.getElementById('shipPsLinkField').hidden = false; document.getElementById('shipPsLinkInput').focus(); };
document.getElementById('shipPsLinkUse').onclick = () => {
  const url = document.getElementById('shipPsLinkInput').value.trim();
  if (!url || !activeShipCardIds.length) return;
  sendShipPhoto(activeShipCardIds, { kind: 'link', src: url }, activeShipPhotoType);
  closeShipPhotoSheet();
};
document.getElementById('shipPsRemove').onclick = async () => {
  const ids = activeShipCardIds.slice(), which = activeShipPhotoType;
  if (!ids.length) return;
  closeShipPhotoSheet();
  try {
    const url = CONFIG.portfolio.endpoint + '?action=clearPhoto&which=' + which + '&cardId=' + encodeURIComponent(ids.join(',')) + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (data.error || 'Request failed'));
    toast('Photo removed.');
    await loadShipping();
  } catch (err) { toast('Could not remove photo: ' + err.message); }
};
function handleShipFile(input, kind) {
  input.addEventListener('change', () => {
    const f = input.files[0]; input.value = '';
    if (!f || !activeShipCardIds.length) return;
    const cardIds = activeShipCardIds.slice(), which = activeShipPhotoType;
    const reader = new FileReader();
    reader.onload = () => sendShipPhoto(cardIds, { kind, src: reader.result }, which);
    reader.readAsDataURL(f);
    closeShipPhotoSheet();
  });
}
handleShipFile(document.getElementById('shipFileCamera'), 'camera');
handleShipFile(document.getElementById('shipFileUpload'), 'upload');

async function sendShipPhoto(cardIds, photo, which) {
  toast('Uploading photo\u2026');
  const payload = {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(which === 'card'
      ? { action: 'cardPhoto', secret: CONFIG.portfolio.secret, cardId: cardIds[0], photo }
      : { action: 'shipPhoto', secret: CONFIG.portfolio.secret, cardIds, photo })
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
