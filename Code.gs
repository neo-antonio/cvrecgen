/**
 * trackello backend — Google Apps Script Web App
 * ------------------------------------------------------
 * Tracks the whole lifecycle of a portfolio item (card):
 *   onhand -> shipping -> shipped -> (shipping recorded ->) sold
 * plus a Finance ledger of billable events (every purchase item, portfolio
 * or not, and a "Shipping for X" entry created the moment something ships).
 *
 * SETUP
 * 1. In your existing Sheet, add TWO new tabs (the old "Backend" tab is no
 *    longer used by this script and can stay as-is or be deleted):
 *
 *    Tab "Cards" — header row:
 *      ID | PurchaseDate | Seller | BoughtBy | ItemName | PurchaseCost | PurchasePayMethod | Photo | PurchaseNotes | Status | SoldDate | SoldTo | SoldPrice | ShipType | ShippingMethod | ShippingFee | ShippingDeductedFrom | ShippingScheduledDate | ShippedDate | ShippingProofPhoto | ShippingRecorded
 *
 *    Tab "Finance" — header row:
 *      ID | CardID | Type | Date | Description | Amount | PayMethod | Recorded | RecordedDate
 *
 * 2. Fill in SHEET_ID, DRIVE_FOLDER_ID and SECRET below (same values you used before).
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
 *   GET  ?action=record&financeId=..&secret=..&callback=..    -> { ok }
 *   GET  ?action=markShipped&cardId=..&secret=..&callback=..  -> { ok }
 *   POST { action:'purchase', secret, date, seller, people, pay, notes, items:[{name,cost,photo,portfolio}] }
 *   POST { action:'sell', secret, date, buyer, notes, shipType, shipMethod, shipFee, shipDeductFrom, shipSched, items:[{cardId,name,cost}] }
 *   POST { action:'shipPhoto', secret, cardId, photo:{kind,src} }
 *
 *   GET actions that mutate state (record / markShipped) are deliberately GET,
 *   not POST: Apps Script doesn't reliably send CORS headers on responses, so
 *   a POST's result often can't be read back by fetch(). These small ID-only
 *   mutations go through GET + JSONP instead, which sidesteps CORS entirely
 *   and lets the app confirm success. Payload-heavy calls (photos, item lists)
 *   still use POST with a "fire and hope" fallback, same as before.
 */

const SHEET_ID = '1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o';
const CARDS_SHEET = 'Cards';
const FINANCE_SHEET = 'Finance';
const DRIVE_FOLDER_ID = '1CYJ4iiiulbWoxY-4gn809_EFyD_XvC00';
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
    if (action === 'record') return jsonpOut_(recordFinance_(e.parameter.financeId), cb);
    if (action === 'markShipped') return jsonpOut_(markShipped_(e.parameter.cardId), cb);
    return jsonpOut_({ ok: false, error: 'unknown action' }, cb);
  } catch (err) {
    return jsonpOut_({ ok: false, error: String(err) }, cb);
  }
}

/* ---------- writes ---------- */

function handlePurchase_(body) {
  const cards = cardsSheet_(), fin = financeSheet_(), folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  (body.items || []).forEach(it => {
    let photoUrl = '';
    if (it.photo && it.photo.src) photoUrl = it.photo.kind === 'link' ? it.photo.src : saveImage_(it.photo.src, it.name, folder);
    let cardId = '';
    if (it.portfolio) {
      cardId = newId_('c');
      // ID, PurchaseDate, Seller, BoughtBy, ItemName, PurchaseCost, PurchasePayMethod, Photo, PurchaseNotes, Status, SoldDate, SoldTo, SoldPrice, ShipType, ShippingMethod, ShippingFee, ShippingDeductedFrom, ShippingScheduledDate, ShippedDate, ShippingProofPhoto, ShippingRecorded
      cards.appendRow([cardId, body.date || '', body.seller || '', body.people || '', it.name || '', it.cost || 0,
        body.pay || '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false]);
    }
    // every purchased item bills to Finance, portfolio or not
    fin.appendRow([newId_('f'), cardId, 'purchase', body.date || '', it.name || '(unnamed item)', it.cost || 0, body.pay || '', false, '']);
  });
  return { ok: true };
}

function handleSell_(body) {
  const cards = cardsSheet_();
  const list = body.items || [];
  const noShip = body.shipType === 'none';
  const perFee = (!noShip && list.length) ? (Number(body.shipFee) || 0) / list.length : 0;
  list.forEach(it => {
    const found = findRow_(cards, it.cardId);
    if (!found) return;
    cards.getRange(found.idx, 10, 1, 1).setValue(noShip ? 'shipped' : 'shipping'); // Status (col J)
    cards.getRange(found.idx, 11, 1, 8).setValues([[                                // SoldDate..ShippingScheduledDate (cols K-R)
      body.date || '', body.buyer || '', Number(it.cost) || 0,
      body.shipType || '', body.shipMethod || '', perFee,
      body.shipDeductFrom || '', body.shipSched || ''
    ]]);
    if (noShip) cards.getRange(found.idx, 19, 1, 1).setValue(todayStr_()); // ShippedDate (col S)
  });
  return { ok: true };
}

function handleShipPhoto_(body) {
  const cards = cardsSheet_();
  const found = findRow_(cards, body.cardId);
  if (!found) return { ok: false, error: 'card not found' };
  let url = '';
  if (body.photo && body.photo.src) {
    url = body.photo.kind === 'link' ? body.photo.src : saveImage_(body.photo.src, 'shipment_' + body.cardId, DriveApp.getFolderById(DRIVE_FOLDER_ID));
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
  const cardId = found.row[1], type = found.row[2];
  if (cardId && type === 'shipping') {
    const cf = findRow_(cardsSheet_(), cardId);
    if (cf) cardsSheet_().getRange(cf.idx, 21, 1, 1).setValue(true); // ShippingRecorded (col U) -> tag becomes "sold"
  }
  return { ok: true };
}

function markShipped_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  cards.getRange(found.idx, 10, 1, 1).setValue('shipped');
  cards.getRange(found.idx, 19, 1, 1).setValue(todayStr_());
  const fee = Number(found.row[15]) || 0; // ShippingFee (col P, 0-based index 15)
  if (fee > 0) {
    financeSheet_().appendRow([newId_('f'), cardId, 'shipping', todayStr_(), 'Shipping for ' + found.row[4], fee, found.row[16] || '', false, '']);
  }
  return { ok: true };
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
      tag, soldDate: fmtDateCell_(r[10]), soldPrice: Number(r[12]) || 0
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
    const item = { id: r[0], date: fmtDateCell_(r[3]), description: r[4], amount: Number(r[5]) || 0, payMethod: r[6] };
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
      shippedDate: fmtDateCell_(r[18]), proofPhoto: toDisplayUrl_(r[19])
    };
    (status === 'shipping' ? toShip : shipped).push(item);
  });
  return { ok: true, toShip: toShip.reverse(), shipped: shipped.reverse() };
}

/* ---------- helpers ---------- */

function cardsSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(CARDS_SHEET); }
function financeSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(FINANCE_SHEET); }
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

function saveImage_(dataUrl, name, folder) {
  const m = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!m) return '';
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
