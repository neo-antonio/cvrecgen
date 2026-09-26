/**
 * trackello backend — Google Apps Script Web App
 * ------------------------------------------------------
 * Tracks the whole lifecycle of a portfolio item (card):
 *   onhand -> shipping -> shipped -> (shipping recorded ->) sold
 * plus a Finance ledger of billable events (every purchase item, portfolio
 * or not, and a "Shipping for X, Y, Z" entry created once every card in a
 * sale's shipment batch has been marked shipped — one entry per batch, not
 * per card, even when the fee was split across several cards) and a
 * Receipts archive of every generated receipt image.
 *
 * SETUP
 * 1. In your existing Sheet you need THREE tabs:
 *
 *    Tab "Cards" — header row (columns A-X):
 *      ID | PurchaseDate | Seller | BoughtBy | ItemName | PurchaseCost | PurchasePayMethod | Photo | PurchaseNotes | Status | SoldDate | SoldTo | SoldPrice | ShipType | ShippingMethod | ShippingFee | ShippingDeductedFrom | ShippingScheduledDate | ShippedDate | ShippingProofPhoto | ShippingRecorded | PurchaseReceiptURL | SaleReceiptURL | ShipBatchID
 *
 *    Tab "Finance" — header row (columns A-J):
 *      ID | CardID | Type | Date | Description | Amount | PayMethod | Recorded | RecordedDate | ReceiptURL
 *
 *    Tab "Receipts" — header row (columns A-E):
 *      ID | Type | Date | URL | Description
 *
 *    If you're upgrading from an older version of this sheet that only had
 *    columns A-U on Cards and A-I on Finance, just add the new headers at
 *    the end of row 1 on each tab — existing rows don't need to change,
 *    the new cells just read as blank until the app fills them in.
 *
 * 2. Fill in SHEET_ID, the three Drive folder IDs, and SECRET below.
 * 3. Extensions > Apps Script > paste this file in, replacing everything.
 * 4. Deploy > Manage deployments > edit your existing Web app deployment >
 *    Version: New version > Deploy. (Editing the code alone does NOT update
 *    the live /exec URL — this step does.)
 *
 * API
 *   GET  ?action=portfolio&secret=..&callback=..     -> { ok, owned:[...], sold:[...] }
 *   GET  ?action=onhandCards&secret=..&callback=..    -> { ok, cards:[{id,name,cost}] }
 *   GET  ?action=finance&secret=..&callback=..        -> { ok, toRecord:[...], recorded:[...] }
 *   GET  ?action=shipping&secret=..&callback=..       -> { ok, toShip:[...], shipped:[...] }
 *   GET  ?action=receipts&secret=..&callback=..       -> { ok, receipts:[...] }
 *   GET  ?action=record&financeId=..&secret=..&callback=..         -> { ok }
 *   GET  ?action=unrecord&financeId=..&secret=..&callback=..       -> { ok }
 *   GET  ?action=markShipped&cardId=..&secret=..&callback=..       -> { ok }
 *   GET  ?action=unmarkShipped&cardId=..&secret=..&callback=..     -> { ok, error? }
 *   GET  ?action=revertToOnhand&cardId=..&secret=..&callback=..    -> { ok, error? }
 *   GET  ?action=deleteCard&cardId=..&secret=..&callback=..        -> { ok }
 *   GET  ?action=deleteFinance&financeId=..&secret=..&callback=.. -> { ok }
 *   POST { action:'purchase', secret, date, seller, people, pay, notes, items:[{name,cost,photo,portfolio}], receiptPhoto:{src} }
 *   POST { action:'sell', secret, date, buyer, notes, shipType, shipMethod, shipFee, shipDeductFrom, shipSched, items:[{cardId,name,cost}], receiptPhoto:{src} }
 *   POST { action:'shipPhoto', secret, cardId, photo:{kind,src} }
 *
 *   GET actions that mutate state are deliberately GET, not POST: Apps
 *   Script doesn't reliably send CORS headers on responses, so a POST's
 *   result often can't be read back by fetch(). These small ID-only
 *   mutations go through GET + JSONP instead, which sidesteps CORS entirely
 *   and lets the app confirm success. Payload-heavy calls (photos, item
 *   lists, receipt images) still use POST with a "fire and hope" fallback.
 *
 * IS IT SAFE TO EDIT THE SHEET BY HAND?
 *   Deleting a row is safe — every lookup here scans by ID string, never
 *   by row position, and blank/missing rows are skipped. Adding a row by
 *   hand works too, as long as the ID starts with "c_" (Cards) or "f_"
 *   (Finance) so it doesn't collide with generated IDs, and Status is one
 *   of onhand/shipping/shipped. Prefer the in-app delete buttons over
 *   manual edits where you can — they also clean up related Finance rows.
 */

const SHEET_ID = '1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o';
const CARDS_SHEET = 'Cards';
const FINANCE_SHEET = 'Finance';
const RECEIPTS_SHEET = 'Receipts';
const DRIVE_FOLDER_ID = '1CYJ4iiiulbWoxY-4gn809_EFyD_XvC00';       // item/purchase photos
const SHIP_PHOTO_FOLDER_ID = '1vYYjKr46QFs1C66ICvrGZpoMJyeYDfeC';  // proof-of-shipment photos
const RECEIPT_FOLDER_ID = '1YDEr3rLQD5VGKXq6XdoOZnKp5V-Js3E8';     // generated receipt images
const SECRET = 'courtvision_$0819';

/* ---------- entry points ---------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
    const action = body.action || 'purchase';
    if (action === 'purchase') return json_(handlePurchase_(body));
    if (action === 'sell') return json_(handleSell_(body));
    if (action === 'shipPhoto') return json_(handleShipPhoto_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const cb = e.parameter.callback;
  try {
    if ((e.parameter.secret || '') !== SECRET) return jsonpOut_({ ok: false, error: 'unauthorized' }, cb);
    const action = e.parameter.action || 'portfolio';
    if (action === 'portfolio') return jsonpOut_(getPortfolio_(), cb);
    if (action === 'onhandCards') return jsonpOut_(getOnhandCards_(), cb);
    if (action === 'finance') return jsonpOut_(getFinance_(), cb);
    if (action === 'shipping') return jsonpOut_(getShipping_(), cb);
    if (action === 'receipts') return jsonpOut_(getReceipts_(), cb);
    if (action === 'record') return jsonpOut_(recordFinance_(e.parameter.financeId), cb);
    if (action === 'unrecord') return jsonpOut_(unrecordFinance_(e.parameter.financeId), cb);
    if (action === 'markShipped') return jsonpOut_(markShipped_(e.parameter.cardId), cb);
    if (action === 'unmarkShipped') return jsonpOut_(unmarkShipped_(e.parameter.cardId), cb);
    if (action === 'revertToOnhand') return jsonpOut_(revertToOnhand_(e.parameter.cardId), cb);
    if (action === 'deleteCard') return jsonpOut_(deleteCard_(e.parameter.cardId), cb);
    if (action === 'deleteFinance') return jsonpOut_(deleteFinance_(e.parameter.financeId), cb);
    return jsonpOut_({ ok: false, error: 'unknown action' }, cb);
  } catch (err) {
    return jsonpOut_({ ok: false, error: String(err) }, cb);
  }
}

/* ---------- writes ---------- */

function handlePurchase_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  const items = body.items || [];
  if (!items.length) return { ok: true };

  let receiptUrl = '';
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = saveImage_(body.receiptPhoto.src, 'purchase-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) receiptsSheet_().appendRow([newId_('rc'), 'purchase', body.date || todayStr_(), receiptUrl, 'Purchase from ' + (body.seller || '\u2014')]);
  }

  items.forEach(it => {
    let photoUrl = '';
    if (it.photo && it.photo.src) photoUrl = it.photo.kind === 'link' ? it.photo.src : saveImage_(it.photo.src, it.name, DRIVE_FOLDER_ID);
    let cardId = '';
    if (it.portfolio) {
      cardId = newId_('c');
      // ID, PurchaseDate, Seller, BoughtBy, ItemName, PurchaseCost, PurchasePayMethod, Photo, PurchaseNotes, Status,
      // SoldDate, SoldTo, SoldPrice, ShipType, ShippingMethod, ShippingFee, ShippingDeductedFrom, ShippingScheduledDate,
      // ShippedDate, ShippingProofPhoto, ShippingRecorded, PurchaseReceiptURL, SaleReceiptURL, ShipBatchID
      cards.appendRow([cardId, body.date || '', body.seller || '', body.people || '', it.name || '', it.cost || 0,
        body.pay || '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false,
        receiptUrl, '', '']);
    }
    // every purchased item bills to Finance, portfolio or not
    fin.appendRow([newId_('f'), cardId, 'purchase', body.date || '', it.name || '(unnamed item)', it.cost || 0, body.pay || '', false, '', receiptUrl]);
  });
  return { ok: true };
}

function handleSell_(body) {
  const cards = cardsSheet_();
  const list = body.items || [];
  if (!list.length) return { ok: true };
  const noShip = body.shipType === 'none';
  const perFee = list.length ? (Number(body.shipFee) || 0) / list.length : 0;
  const batchId = newId_('b');

  let receiptUrl = '';
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = saveImage_(body.receiptPhoto.src, 'sold-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) receiptsSheet_().appendRow([newId_('rc'), 'sale', body.date || todayStr_(), receiptUrl, 'Sale to ' + (body.buyer || '\u2014')]);
  }

  list.forEach(it => {
    const found = findRow_(cards, it.cardId);
    if (!found) return;
    // Every sale — shipped or not — goes into the "shipping" queue so it shows up
    // under To ship; a zero-fee item still needs a Finance entry once marked shipped.
    cards.getRange(found.idx, 10, 1, 1).setValue('shipping'); // Status (col J)
    cards.getRange(found.idx, 11, 1, 8).setValues([[           // SoldDate..ShippingScheduledDate (cols K-R)
      body.date || '', body.buyer || '', Number(it.cost) || 0,
      body.shipType || '', body.shipMethod || '', noShip ? 0 : perFee,
      body.shipDeductFrom || '', body.shipSched || ''
    ]]);
    cards.getRange(found.idx, 23, 1, 1).setValue(receiptUrl); // SaleReceiptURL (col W)
    cards.getRange(found.idx, 24, 1, 1).setValue(batchId);    // ShipBatchID (col X)
  });
  return { ok: true };
}

function handleShipPhoto_(body) {
  const cards = cardsSheet_();
  const found = findRow_(cards, body.cardId);
  if (!found) return { ok: false, error: 'card not found' };
  let url = '';
  if (body.photo && body.photo.src) {
    url = body.photo.kind === 'link' ? body.photo.src : saveImage_(body.photo.src, 'shipped-' + todayStr_() + '-' + newId_('s'), SHIP_PHOTO_FOLDER_ID);
  }
  cards.getRange(found.idx, 20, 1, 1).setValue(url); // ShippingProofPhoto (col T)
  return { ok: true };
}

function recordFinance_(financeId) {
  if (!financeId) return { ok: false, error: 'missing financeId' };
  const fin = financeSheet_();
  const found = findRow_(fin, financeId);
  if (!found) return { ok: false, error: 'not found' };
  fin.getRange(found.idx, 8, 1, 2).setValues([[true, todayStr_()]]); // Recorded, RecordedDate
  setShippingRecordedFlag_(found.row[1], found.row[2], true);
  return { ok: true };
}

function unrecordFinance_(financeId) {
  if (!financeId) return { ok: false, error: 'missing financeId' };
  const fin = financeSheet_();
  const found = findRow_(fin, financeId);
  if (!found) return { ok: false, error: 'not found' };
  fin.getRange(found.idx, 8, 1, 2).setValues([[false, '']]); // Recorded, RecordedDate
  setShippingRecordedFlag_(found.row[1], found.row[2], false);
  return { ok: true };
}

// Finance's CardID column holds either a single card ID or (for a grouped
// shipping entry) a batch ID — flip ShippingRecorded on every Cards row it covers,
// which is what turns the Portfolio "shipped" tag into "sold".
function setShippingRecordedFlag_(cardOrBatchId, type, value) {
  if (!cardOrBatchId || type !== 'shipping') return;
  const cards = cardsSheet_();
  const rows = cards.getDataRange().getValues();
  for (let r = 1; r < rows.length; r++) {
    if (rows[r][0] === cardOrBatchId || rows[r][23] === cardOrBatchId) {
      cards.getRange(r + 1, 21, 1, 1).setValue(value); // ShippingRecorded (col U)
    }
  }
}

function markShipped_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  cards.getRange(found.idx, 10, 1, 1).setValue('shipped');
  cards.getRange(found.idx, 19, 1, 1).setValue(todayStr_());
  maybeCreateBatchFinance_(found.row[23]);
  return { ok: true };
}

function unmarkShipped_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_(), fin = financeSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  if (found.row[9] !== 'shipped') return { ok: false, error: 'card is not marked shipped' };
  const batchId = found.row[23] || cardId;
  const finRow = findRow_(fin, batchId);
  if (finRow && finRow.row[7] === true) {
    return { ok: false, error: 'Its Finance entry is already recorded \u2014 unrecord it first, then revert.' };
  }
  cards.getRange(found.idx, 10, 1, 1).setValue('shipping');
  cards.getRange(found.idx, 19, 1, 1).setValue('');
  if (finRow) fin.deleteRow(finRow.idx); // batch is no longer complete, drop the not-yet-recorded entry
  return { ok: true };
}

function revertToOnhand_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_(), fin = financeSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  if (found.row[9] === 'onhand') return { ok: false, error: 'already onhand' };
  if (found.row[20] === true) return { ok: false, error: 'Its shipping fee is already recorded in Finance \u2014 unrecord it first.' };
  const batchId = found.row[23];
  cards.getRange(found.idx, 10, 1, 1).setValue('onhand');           // Status
  cards.getRange(found.idx, 11, 1, 10).setValues([['', '', '', '', '', '', '', '', '', false]]); // SoldDate..ShippingRecorded (K-U)
  cards.getRange(found.idx, 23, 1, 2).setValues([['', '']]);        // SaleReceiptURL, ShipBatchID
  if (batchId) {
    const rows = cards.getDataRange().getValues();
    const stillInBatch = rows.slice(1).some(r => r[23] === batchId && r[0] !== cardId);
    if (!stillInBatch) {
      const finRow = findRow_(fin, batchId);
      if (finRow && finRow.row[7] !== true) fin.deleteRow(finRow.idx);
    }
  }
  return { ok: true, note: 'Reverted to onhand.' };
}

function deleteCard_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  cards.deleteRow(found.idx);
  return { ok: true };
}

function deleteFinance_(financeId) {
  if (!financeId) return { ok: false, error: 'missing financeId' };
  const fin = financeSheet_();
  const found = findRow_(fin, financeId);
  if (!found) return { ok: false, error: 'not found' };
  fin.deleteRow(found.idx);
  return { ok: true };
}

// Called once a card is marked shipped; creates ONE Finance row per shipment
// batch (not one per card) as soon as every card sharing that batch ID is
// shipped — even when the total fee is PHP 0, so it still shows up to record.
function maybeCreateBatchFinance_(batchId) {
  if (!batchId) return;
  const cards = cardsSheet_(), fin = financeSheet_();
  const rows = cards.getDataRange().getValues(); rows.shift();
  const group = rows.filter(r => r[23] === batchId);
  if (!group.length) return;
  if (!group.every(r => r[9] === 'shipped')) return;
  if (findRow_(fin, batchId)) return; // already created for this batch
  const totalFee = group.reduce((a, r) => a + (Number(r[15]) || 0), 0);
  const names = group.map(r => r[4]).join(', ');
  const payMethod = group[0][16] || '';
  const receiptUrl = group[0][22] || '';
  const idField = group.length > 1 ? batchId : group[0][0];
  fin.appendRow([newId_('f'), idField, 'shipping', todayStr_(), 'Shipping for ' + names, totalFee, payMethod, false, '', receiptUrl]);
}

/* ---------- reads ---------- */

function getPortfolio_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const owned = [], sold = [];
  rows.forEach(r => {
    if (!r[4]) return;
    const status = r[9] || 'onhand';
    const tag = status === 'onhand' ? 'onhand' : status === 'shipping' ? 'shipping' : (r[20] === true ? 'sold' : 'shipped');
    const item = {
      id: r[0], name: r[4], photo: toDisplayUrl_(r[7]),
      purchaseDate: fmtDateCell_(r[1]), purchaseCost: Number(r[5]) || 0,
      tag, soldDate: fmtDateCell_(r[10]), soldPrice: Number(r[12]) || 0,
      purchaseReceipt: r[21] || '', saleReceipt: r[22] || ''
    };
    (status === 'onhand' || status === 'shipping' ? owned : sold).push(item);
  });
  return { ok: true, owned: owned.reverse(), sold: sold.reverse() };
}

function getOnhandCards_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const cards = rows.filter(r => r[4] && r[9] === 'onhand').map(r => ({ id: r[0], name: r[4], cost: Number(r[5]) || 0 })).reverse();
  return { ok: true, cards };
}

function getFinance_() {
  const rows = financeSheet_().getDataRange().getValues(); rows.shift();
  const toRecord = [], recorded = [];
  rows.forEach(r => {
    if (!r[0]) return;
    const item = { id: r[0], date: fmtDateCell_(r[3]), description: r[4], amount: Number(r[5]) || 0, payMethod: r[6], receipt: r[9] || '' };
    (r[7] === true ? recorded : toRecord).push(item);
  });
  return { ok: true, toRecord: toRecord.reverse(), recorded: recorded.reverse() };
}

function getShipping_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const toShip = [], shipped = [];
  rows.forEach(r => {
    if (!r[4]) return;
    const status = r[9];
    if (status !== 'shipping' && status !== 'shipped') return;
    const item = {
      id: r[0], name: r[4], photo: toDisplayUrl_(r[7]),
      soldTo: r[11], soldPrice: Number(r[12]) || 0,
      shipType: r[13], shipMethod: r[14], shipFee: Number(r[15]) || 0,
      deductedFrom: r[16], scheduledDate: fmtDateCell_(r[17]),
      shippedDate: fmtDateCell_(r[18]), proofPhoto: toDisplayUrl_(r[19]),
      saleReceipt: r[22] || ''
    };
    (status === 'shipping' ? toShip : shipped).push(item);
  });
  return { ok: true, toShip: toShip.reverse(), shipped: shipped.reverse() };
}

function getReceipts_() {
  const rows = receiptsSheet_().getDataRange().getValues(); rows.shift();
  const receipts = rows.filter(r => r[0]).map(r => ({ id: r[0], type: r[1], date: fmtDateCell_(r[2]), url: toDisplayUrl_(r[3]), description: r[4] }));
  return { ok: true, receipts: receipts.reverse() };
}

/* ---------- helpers ---------- */

function cardsSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(CARDS_SHEET); }
function financeSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(FINANCE_SHEET); }
function receiptsSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(RECEIPTS_SHEET); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function newId_(prefix) { return prefix + '_' + Utilities.getUuid().split('-')[0]; }

function findRow_(sheet, id) {
  if (!id) return null;
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) if (String(data[r][0]) === String(id)) return { idx: r + 1, row: data[r] };
  return null;
}

function fmtDateCell_(v) {
  if (!v) return '';
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v);
}

function toDisplayUrl_(url) {
  if (!url) return '';
  url = String(url);
  if (/drive\.google\.com/.test(url)) {
    const m = url.match(/[-\w]{25,}/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w600';
  }
  return url;
}

function saveImage_(dataUrl, name, folderId) {
  const m = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!m) return '';
  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (name || 'item').replace(/[^\w.-]+/g, '_') + '.jpg');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpOut_(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(obj);
}
