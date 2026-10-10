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

let statusFilter = 'all';
let searchQuery = '';
let portData = { cards: [] };

// still in our hands (onhand, or sold but not yet shipped) vs. gone (shipped / sold / traded)
const isOwned = it => it.tag === 'onhand' || it.tag === 'shipping';
// Code.gs now sends one `cards` list; against an older deploy (or an older cached copy) merge owned + sold
// "shipped" no longer exists as a separate state: once shipped, a card is sold (older Code.gs / cached copies still send "shipped")
const normPort = d => ({ cards: (Array.isArray(d.cards) ? d.cards : (d.owned || []).concat(d.sold || [])).map(c => c.tag === 'shipped' ? Object.assign({}, c, { tag: 'sold' }) : c) });

const TAG_LABEL = { onhand: 'Onhand', shipping: 'Shipping', shipped: 'Shipped', sold: 'Sold', traded: 'Traded' };

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
const icon = (name, cls, label, id) => `<button type="button" class="icon-btn ${cls}" data-id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg></button>`;

/* Days held: purchase date until the sale / trade date. Cards still on hand count up to today. */
const parseDay = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
function heldLine(it) {
  const a = parseDay(it.purchaseDate); if (!a) return '';
  const ongoing = it.tag === 'onhand';
  let b = ongoing ? new Date() : parseDay(it.soldDate);
  if (!b) return '';
  b = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const days = Math.max(0, Math.round((b - a) / 86400000));
  return `Held ${days} day${days === 1 ? '' : 's'}${ongoing ? ' so far' : ''}`;
}

function cardHtml(it) {
  const img = it.photo
    ? `<img src="${it.photo}" alt="${escHtml(it.name)}" loading="lazy" class="port-clickphoto" data-full="${it.photo}">`
    : `<div class="port-noimg">No photo</div>`;
  const owned = isOwned(it);
  const dateLine = owned ? 'Bought ' + fmtCardDate(it.purchaseDate) : (it.tag === 'traded' ? 'Traded ' : 'Sold ') + fmtCardDate(it.soldDate);
  const costLine = owned ? it.purchaseCost : it.soldPrice;
  const held = heldLine(it);
  const rcpts = receiptsFor(it);
  const renameBtn = icon('pencil', 'port-rename', 'Edit name', it.id);
  const photoBtn = icon('camera', 'port-photo', it.photo ? 'Change photo' : 'Add photo', it.id);
  const receiptBtn = rcpts.length ? icon('doc', 'port-receipt', rcpts.length > 1 ? 'Receipts' : 'Receipt', it.id) : '';
  const revertBtn = (it.tag === 'shipping' || it.tag === 'shipped' || it.tag === 'traded') ? icon('undo', 'port-revert', 'Revert to onhand', it.id) : '';
  const deleteBtn = icon('trash', 'port-delete danger', 'Delete card', it.id);
  return `<div class="port-card" data-id="${it.id}">
      <div class="port-card-main">
        <div class="port-thumb">${img}</div>
        <div class="port-info">
          <b>${escHtml(it.name)}</b>
          <span>${dateLine}</span>
          ${held ? `<span class="port-held">${held}</span>` : ''}
        </div>
        <div class="port-right">
          <span class="port-tag tag-${it.tag}">${TAG_LABEL[it.tag] || it.tag}</span>
          <div class="port-cost">${portPhp(costLine)}</div>
        </div>
      </div>
      <div class="port-card-acts">${renameBtn}${photoBtn}${receiptBtn}${revertBtn}${deleteBtn}</div>
    </div>`;
}

/* The headline figure follows the filter: what we still hold is valued at cost (All / Onhand / Shipping),
   what has left is valued at its sale / trade price (Shipped / Sold / Traded). Search narrows it too. */
const SUMMARY_LABEL = { shipped: 'Total shipped', sold: 'Total sold', traded: 'Total traded' };
function renderTab() {
  const gone = statusFilter === 'shipped' || statusFilter === 'sold' || statusFilter === 'traded';
  $portSummaryLabel.textContent = gone ? SUMMARY_LABEL[statusFilter] : 'Onhand value';
  let list = portData.cards;
  if (statusFilter !== 'all') list = list.filter(i => i.tag === statusFilter);
  if (searchQuery) list = list.filter(i => (i.name || '').toLowerCase().includes(searchQuery));
  if (!list.length) {
    $portState.textContent = portData.cards.length ? 'No cards match your search/filter.' : 'No cards yet.';
    $portState.hidden = false; $portList.hidden = true;
    $portTotal.textContent = portPhp(0);
    $portCount.textContent = '0 cards';
    return;
  }
  $portList.innerHTML = list.map(cardHtml).join('');
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
