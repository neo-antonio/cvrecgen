/* ---------- Receipts archive — every generated receipt image, from the Receipts sheet ---------- */
const escRec = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const $recList = document.getElementById('recList');
const $recState = document.getElementById('recState');
const TYPE_LABEL = { purchase: 'Purchase', sale: 'Sale', trade: 'Trade', transfer: 'Transfer' };

let recTab = 'all';
let receipts = [];
const $recFrom = document.getElementById('recFrom'), $recTo = document.getElementById('recTo'), $recSort = document.getElementById('recSort'), $recCount = document.getElementById('recCount');

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

/* Receipts are shown by receipt date, newest first by default (ties keep the archive's own order,
   newest entry first). The date filter is inclusive on both ends; From/To can be set in either order. */
function visibleReceipts() {
  let list = recTab === 'all' ? receipts : receipts.filter(r => r.type === recTab);
  let lo = $recFrom.value, hi = $recTo.value;
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  if (lo || hi) list = list.filter(r => { const d = String(r.date || '').slice(0, 10); return d && (!lo || d >= lo) && (!hi || d <= hi); });
  const dir = $recSort.value === 'asc' ? 1 : -1;
  return list.map((r, i) => ({ r, i })).sort((a, b) => {
    const da = String(a.r.date || '').slice(0, 10), db = String(b.r.date || '').slice(0, 10);
    if (da !== db) return !da ? 1 : !db ? -1 : da < db ? -dir : dir;   // undated receipts always last
    return dir === -1 ? a.i - b.i : b.i - a.i;
  }).map(x => x.r);
}

function render() {
  const list = visibleReceipts();
  const filtered = $recFrom.value || $recTo.value;
  $recCount.textContent = receipts.length ? `${list.length} receipt${list.length === 1 ? '' : 's'}` : '';
  if (!list.length) {
    $recState.textContent = receipts.length ? (filtered ? 'No receipts in that date range.' : 'No receipts in this category.') : 'No receipts archived yet.';
    $recState.hidden = false; $recList.hidden = true;
    return;
  }
  $recList.innerHTML = list.map(rowHtml).join('');
  $recState.hidden = true; $recList.hidden = false;
}

let recFirst = true;
async function loadReceipts() {
  if (!CONFIG.portfolio.endpoint) { $recState.textContent = "Sync isn't set up yet."; $recState.hidden = false; return; }
  const cached = recFirst ? cacheGet('receipts') : null; recFirst = false;
  if (cached) { receipts = cached; render(); }
  else { $recState.textContent = 'Loading\u2026'; $recState.hidden = false; $recList.hidden = true; }
  try {
    const url = CONFIG.portfolio.endpoint + '?action=receipts&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
    const data = await jsonp(url);
    if (!data.ok) throw new Error(data.error || 'Unknown error');
    receipts = data.receipts || [];
    cacheSet('receipts', receipts);
    render();
  } catch (err) {
    console.warn('Receipts load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    $recState.textContent = "Couldn't load receipts (offline, wrong secret, or Code.gs needs a new deployment).";
    $recState.hidden = false; $recList.hidden = true;
  }
}

document.querySelectorAll('.tab[data-rtab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-rtab]').forEach(x => x.classList.toggle('active', x === t));
  recTab = t.dataset.rtab;
  render();
});

[$recFrom, $recTo].forEach(i => i.addEventListener('change', render));
$recSort.addEventListener('change', render);
document.getElementById('recClear').onclick = () => { $recFrom.value = ''; $recTo.value = ''; render(); };

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
    let del;
    try { del = await jsonp(`${base}?action=deleteReceipt&receiptId=${encodeURIComponent(id)}&secret=${sec}`, 90000); }
    catch (err) {
      // no answer is not the same as failure: the server may still have finished, so check before reporting an error
      if (err.message !== 'Timed out') throw err;
      btn.textContent = 'Checking\u2026';
      await new Promise(r => setTimeout(r, 4000));
      await loadReceipts();
      document.getElementById('imgView').hidden = true;
      toast(receipts.some(r => String(r.id) === String(id)) ? 'Still deleting \u2014 tap Refresh in a moment to confirm.' : 'Receipt deleted.');
      return;
    }
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
