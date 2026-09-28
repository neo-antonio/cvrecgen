/* ---------- Receipts archive — every generated receipt image, from the Receipts sheet ---------- */
const escRec = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $recList = document.getElementById('recList');
const $recState = document.getElementById('recState');
const TYPE_LABEL = { purchase: 'Purchase', sale: 'Sale', trade: 'Trade' };

let recTab = 'all';
let receipts = [];

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'recCb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
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

function fmtDay(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function rowHtml(r) {
  return `<div class="receipt-tile" data-id="${escRec(r.id)}" data-url="${escRec(r.url)}">
      <div class="receipt-tile-img"><img src="${r.url}" alt="Receipt" loading="lazy"></div>
      <div class="receipt-tile-info"><b>${TYPE_LABEL[r.type] || r.type}</b><span>${fmtDay(r.date)}</span></div>
    </div>`;
}

function render() {
  const list = recTab === 'all' ? receipts : receipts.filter(r => r.type === recTab);
  if (!list.length) {
    $recState.textContent = 'No receipts archived yet.';
    $recState.hidden = false; $recList.hidden = true;
    return;
  }
  $recList.innerHTML = list.map(rowHtml).join('');
  $recState.hidden = true; $recList.hidden = false;
}

async function loadReceipts() {
  if (!CONFIG.portfolio.endpoint) { $recState.textContent = "Sync isn't set up yet."; $recState.hidden = false; return; }
  $recState.textContent = 'Loading\u2026'; $recState.hidden = false; $recList.hidden = true;
  try {
    const url = CONFIG.portfolio.endpoint + '?action=receipts&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    receipts = data.receipts || [];
    render();
  } catch (err) {
    console.warn('Receipts load failed', err);
    $recState.textContent = "Couldn't load receipts (offline, wrong secret, or Code.gs needs a new deployment).";
    $recState.hidden = false; $recList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-rtab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-rtab]').forEach(x => x.classList.toggle('active', x === t));
  recTab = t.dataset.rtab;
  render();
});

let activeReceiptId = null;
function toast(m) {
  const t = document.getElementById('recToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}
$recList.addEventListener('click', e => {
  const card = e.target.closest('.receipt-tile');
  if (!card || !card.dataset.url) return;
  activeReceiptId = card.dataset.id;
  const r = receipts.find(x => String(x.id) === String(activeReceiptId));
  document.getElementById('imgViewDesc').textContent = r ? [r.description, fmtDay(r.date)].filter(Boolean).join(' \u00b7 ') : '';
  document.getElementById('imgViewDelete').hidden = !r;
  document.getElementById('imgViewImg').src = card.dataset.url;
  document.getElementById('imgView').hidden = false;
});

/* Delete a receipt together with everything it created: its cards (Portfolio / Shipping) and its
   Finance entries. We ask the backend what is linked first, so the confirmation lists exactly what goes. */
const sumList = (arr, max = 5) => arr.slice(0, max).join(', ') + (arr.length > max ? ` and ${arr.length - max} more` : '');
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
document.getElementById('imgViewDelete').onclick = async () => {
  const id = activeReceiptId, btn = document.getElementById('imgViewDelete');
  if (!id) return;
  const base = CONFIG.portfolio.endpoint, sec = encodeURIComponent(CONFIG.portfolio.secret);
  btn.disabled = true; btn.textContent = 'Checking\u2026';
  try {
    const imp = await jsonp(`${base}?action=receiptImpact&receiptId=${encodeURIComponent(id)}&secret=${sec}`);
    if (!imp.ok) throw new Error(imp.error || 'Request failed');
    const cards = imp.cards || [], fin = imp.finance || [];
    let msg = 'Delete this receipt?\n\n';
    if (cards.length || fin.length) {
      msg += 'This will also permanently delete:\n';
      if (cards.length) msg += `\u2022 ${cards.length} card${cards.length > 1 ? 's' : ''} (Portfolio / Shipping): ${sumList(cards)}\n`;
      if (fin.length) msg += `\u2022 ${fin.length} Finance entr${fin.length > 1 ? 'ies' : 'y'}: ${sumList(fin)}\n`;
    } else {
      msg += 'No cards or Finance entries are linked to it.\n';
    }
    msg += '\nThis cannot be undone.';
    if (!confirm(msg)) return;
    btn.textContent = 'Deleting\u2026';
    const del = await jsonp(`${base}?action=deleteReceipt&receiptId=${encodeURIComponent(id)}&secret=${sec}`);
    if (!del.ok) throw new Error(del.error || 'Request failed');
    document.getElementById('imgView').hidden = true;
    toast(`Receipt deleted (${del.deletedCards || 0} card${del.deletedCards === 1 ? '' : 's'}, ${del.deletedFinance || 0} finance entr${del.deletedFinance === 1 ? 'y' : 'ies'}).`);
    await loadReceipts();
  } catch (err) {
    toast('Could not delete: ' + backendErr(err));
  } finally {
    btn.disabled = false; btn.textContent = 'Delete receipt';
  }
};
document.getElementById('imgViewClose').onclick = () => document.getElementById('imgView').hidden = true;
document.getElementById('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') document.getElementById('imgView').hidden = true; });

loadReceipts();
