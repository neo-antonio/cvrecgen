/**
 * trackello backend — Google Apps Script Web App
 * ------------------------------------------------------
 * Tracks the whole lifecycle of a portfolio item (card):
 *   onhand -> shipping -> shipped -> (shipping recorded ->) sold
 * plus a Finance ledger of billable events and a Receipts archive of every generated receipt image.
 *
 * SHEET TABS
 *   Cards   (A-AB): ID | PurchaseDate | Seller | BoughtBy | ItemName | PurchaseCost | PurchasePayMethod | Photo | PurchaseNotes | Status |
 *                   SoldDate | SoldTo | SoldPrice | ShipType | ShippingMethod | ShippingFee | ShippingDeductedFrom | ShippingScheduledDate |
 *                   ShippedDate | ShippingProofPhoto | ShippingRecorded | PurchaseReceiptURL | SaleReceiptURL | ShipBatchID | ShippingAddress | ShippedTime | ShippingContact | SaleNotes
 *                   Status is one of: onhand, shipping, shipped, traded.
 *   Finance (A-N):  ID | CardID | Type | Date | Description | Amount | PayMethod | Recorded | RecordedDate | ReceiptURL | Flow | Images | Notes | Time
 *                   Type: purchase, sale, shipping, trade, transfer, manual.  Flow: inflow, outflow, none.
 *   Receipts (A-F): ID | Type | Date | URL | Description | Time      Type: purchase, sale, trade, transfer.
 *   Balance (A-G):  UpdatedAt | Cash | Maribank | Others | Note | Reserves | Skip   (one row per save; the last row is the baseline)
 *   Events:         ID | Date | Title | Time | Notes   (created automatically)
 *   Entities (A-E): ID | Name | Contact | Aliases | Created   (sellers, buyers, trade partners; created automatically).
 *                   Aliases are other spellings (pipe-separated) that resolve to this entity.
 *   Creatives (A-M): ID | Kind | ReceiptKey | Title | Date | Status | Platforms | Notes | Caption | Edited | Auto | Created | DoneDate
 *                   Kind: video (a vlog task) or post (one row per receipt group of cards, ID = pg_<receiptKey>).
 *                   Platforms is JSON {fb,ig,yt,tt: {on,date,link}}. Edited = pipe-separated card IDs already edited (posts).
 *   Optional columns/tabs are created by the script on first use. Interest settings are kept in Script Properties.
 *
 * DEPLOY: Deploy > Manage deployments > edit your Web app > Version: New version > Deploy.
 *
 * POST actions: purchase, sell, trade, transfer, shipPhoto, cardPhoto, financeReceipt, saveFinance
 * GET  actions: portfolio, onhandCards, finance, shipping, receipts, syncStatus, record, unrecord, balance, saveBalance, saveInterest,
 *               markShipped, updateShipped, unmarkShipped, revertToOnhand, deleteCard, deleteFinance, renameCard, linkFinanceReceipt,
 *               unlinkFinanceReceipt, clearPhoto, addFinance, receiptImpact, deleteReceipt, updateShipping, events, saveEvent, deleteEvent,
 *               entities, entityNames, saveEntity, mergeEntities, deleteEntity, creatives, saveCreative, setCreativeCards,
 *               completeCreatives, deleteCreative
 *   Small ID-only mutations are GET + JSONP (Apps Script does not reliably send CORS headers on POST responses).
 */

const SHEET_ID = '1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o';
const CARDS_SHEET = 'Cards';
const FINANCE_SHEET = 'Finance';
const RECEIPTS_SHEET = 'Receipts';
const DRIVE_FOLDER_ID = '1CYJ4iiiulbWoxY-4gn809_EFyD_XvC00';       // item/purchase photos
const SHIP_PHOTO_FOLDER_ID = '1vYYjKr46QFs1C66ICvrGZpoMJyeYDfeC';  // proof-of-shipment photos
const RECEIPT_FOLDER_ID = '1YDEr3rLQD5VGKXq6XdoOZnKp5V-Js3E8';     // generated receipt images
const SECRET = 'courtvision_$0819';
const MAX_TASK_IMAGES = 5;

/* ---------- entry points ---------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
    const action = body.action || 'purchase';
    if (action === 'purchase' || action === 'sell' || action === 'trade' || action === 'transfer') return json_(runOnce_(body, action));
    if (action === 'shipPhoto') return json_(handleShipPhoto_(body));
    if (action === 'cardPhoto') return json_(handleCardPhoto_(body));
    if (action === 'financeReceipt') return json_(handleFinanceReceipt_(body));
    if (action === 'saveFinance') return json_(handleSaveFinance_(body));
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
    if (action === 'syncStatus') return jsonpOut_(syncStatus_(e.parameter.syncId), cb);
    if (action === 'record') return jsonpOut_(recordFinance_(e.parameter.financeId), cb);
    if (action === 'balance') return jsonpOut_(getBalance_(), cb);
    if (action === 'saveBalance') return jsonpOut_(saveBalance_(e.parameter), cb);
    if (action === 'saveInterest') return jsonpOut_(saveInterest_(e.parameter.json), cb);
    if (action === 'unrecord') return jsonpOut_(unrecordFinance_(e.parameter.financeId), cb);
    if (action === 'markShipped') return jsonpOut_(markShipped_(e.parameter.cardId, e.parameter.date, e.parameter.time), cb);
    if (action === 'updateShipped') return jsonpOut_(updateShipped_(e.parameter), cb);
    if (action === 'unmarkShipped') return jsonpOut_(unmarkShipped_(e.parameter.cardId), cb);
    if (action === 'revertToOnhand') return jsonpOut_(revertToOnhand_(e.parameter.cardId), cb);
    if (action === 'deleteCard') return jsonpOut_(deleteCard_(e.parameter.cardId), cb);
    if (action === 'deleteFinance') return jsonpOut_(deleteFinance_(e.parameter.financeId), cb);
    if (action === 'renameCard') return jsonpOut_(renameCard_(e.parameter.cardId, e.parameter.name), cb);
    if (action === 'linkFinanceReceipt') return jsonpOut_(linkFinanceReceipt_(e.parameter), cb);
    if (action === 'unlinkFinanceReceipt') return jsonpOut_(setTaskReceipt_(e.parameter.financeId, ''), cb);
    if (action === 'clearPhoto') return jsonpOut_(clearPhoto_(e.parameter.cardId, e.parameter.which), cb);
    if (action === 'addFinance') return jsonpOut_(addFinance_(e.parameter), cb);
    if (action === 'receiptImpact') return jsonpOut_(receiptImpact_(e.parameter.receiptId), cb);
    if (action === 'deleteReceipt') return jsonpOut_(deleteReceipt_(e.parameter.receiptId), cb);
    if (action === 'updateShipping') return jsonpOut_(updateShipping_(e.parameter), cb);
    if (action === 'entities') return jsonpOut_(getEntities_(), cb);
    if (action === 'entityNames') return jsonpOut_(getEntityNames_(), cb);
    if (action === 'saveEntity') return jsonpOut_(saveEntity_(e.parameter), cb);
    if (action === 'mergeEntities') return jsonpOut_(mergeEntities_(e.parameter), cb);
    if (action === 'deleteEntity') return jsonpOut_(deleteEntity_(e.parameter.entityId), cb);
    if (action === 'events') return jsonpOut_(getEvents_(), cb);
    if (action === 'saveEvent') return jsonpOut_(saveEvent_(e.parameter), cb);
    if (action === 'deleteEvent') return jsonpOut_(deleteEvent_(e.parameter.eventId), cb);
    if (action === 'creatives') return jsonpOut_(getCreatives_(), cb);
    if (action === 'saveCreative') return jsonpOut_(saveCreative_(e.parameter), cb);
    if (action === 'setCreativeCards') return jsonpOut_(setCreativeCards_(e.parameter), cb);
    if (action === 'completeCreatives') return jsonpOut_(completeCreatives_(e.parameter), cb);
    if (action === 'deleteCreative') return jsonpOut_(deleteCreative_(e.parameter.id), cb);
    return jsonpOut_({ ok: false, error: 'unknown action' }, cb);
  } catch (err) {
    return jsonpOut_({ ok: false, error: String(err) }, cb);
  }
}

/* ---------- writes ---------- */

// Receipt syncs (purchase / sell / trade / transfer) carry a syncId made by the app. Handled one at a time, and a
// syncId that already finished is answered from the cache instead of running again, so the app can
// safely re-send a request it never got an answer to without creating duplicates.
function runOnce_(body, action) {
  const handler = action === 'purchase' ? handlePurchase_ : action === 'sell' ? handleSell_ : action === 'transfer' ? handleTransfer_ : handleTrade_;
  const id = body.syncId ? String(body.syncId).slice(0, 60) : '';
  if (!id) return handler(body);
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const cache = CacheService.getScriptCache();
    const seen = cache.get('sync_' + id);
    if (seen) { const r = JSON.parse(seen); r.duplicate = true; return r; }
    const r = handler(body);
    if (r && r.ok) cache.put('sync_' + id, JSON.stringify(r), 21600);   // remembered for 6 hours
    return r;
  } finally { lock.releaseLock(); }
}
function syncStatus_(id) {
  const v = CacheService.getScriptCache().get('sync_' + String(id || '').slice(0, 60));
  return v ? { ok: true, done: true, result: JSON.parse(v) } : { ok: true, done: false };
}
// An image that fails to upload must not stop the cards and Finance tasks from being created: it is skipped and counted.
function safeSave_(dataUrl, name, folderId) {
  try { return saveImage_(dataUrl, name, folderId); } catch (err) { return ''; }
}

function handlePurchase_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  let photosFailed = 0;
  const items = body.items || [];
  if (!items.length) return { ok: true };
  const seller = resolveParty_(body.seller);   // saved entity (spelling-safe), created on first use

  let receiptUrl = '', receiptSaved = false;
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = safeSave_(body.receiptPhoto.src, 'purchase-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) { try { appendReceipt_('purchase', body.date || todayStr_(), receiptUrl, 'Purchase from ' + (seller || '\u2014'), body.time); receiptSaved = true; } catch (err) {} }
  }

  const cardRows = [], finRows = [];
  items.forEach(it => {
    let photoUrl = '';
    if (it.photo && it.photo.src) { photoUrl = it.photo.kind === 'link' ? it.photo.src : safeSave_(it.photo.src, it.name, DRIVE_FOLDER_ID); if (it.photo.kind !== 'link' && !photoUrl) photosFailed++; }
    let cardId = '';
    if (it.portfolio) {
      cardId = newId_('c');
      cardRows.push([cardId, body.date || '', seller, body.people || '', it.name || '', it.cost || 0,
        body.pay || '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false,
        receiptUrl, '', '']);
    }
    // every purchased item bills to Finance, portfolio or not
    finRows.push([newId_('f'), cardId, 'purchase', body.date || '', it.name || '(unnamed item)', it.cost || 0, body.pay || '', false, '', receiptUrl, 'outflow']);
  });
  appendRows_(cards, cardRows);
  appendRows_(fin, finRows);
  let creatives = 0;
  if (body.vlog) { try { addVideoTask_('Vlog: Purchase from ' + (seller || '\u2014'), body.date || todayStr_(), receiptUrl); creatives = 1; } catch (err) {} }
  return { ok: true, receipt: receiptSaved, cards: cardRows.length, finance: finRows.length, creatives, photosFailed };
}

function handleSell_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  const list = body.items || [];
  if (!list.length) return { ok: true };
  ensureCardsColumns_(cards);
  const contact = String(body.shipContact || '').trim().slice(0, 60);
  const saleNotes = String(body.notes || '').trim().slice(0, 1000);
  const buyer = resolveParty_(body.buyer, contact);   // saved entity (spelling-safe); remembers the contact number
  const noShip = body.shipType === 'none';
  const address = String(body.shipAddress || '').trim().slice(0, 500);
  const packaging = Number(body.packaging) || 0;
  const perFee = list.length ? (Number(body.shipFee) || 0) / list.length : 0;
  const batchId = newId_('b');

  let receiptUrl = '', receiptSaved = false;
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = safeSave_(body.receiptPhoto.src, 'sold-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) { try { appendReceipt_('sale', body.date || todayStr_(), receiptUrl, 'Sale to ' + (buyer || '\u2014'), body.time); receiptSaved = true; } catch (err) {} }
  }

  const rowOf = rowIndex_(cards), finRows = [];
  let moved = 0;
  list.forEach(it => {
    const found = rowOf[String(it.cardId)] ? { idx: rowOf[String(it.cardId)] } : null;
    if (!found) return;
    moved++;
    // Every sale — shipped or not — goes into the "shipping" queue so it shows up under To ship.
    cards.getRange(found.idx, 10, 1, 1).setValue('shipping'); // Status (col J)
    cards.getRange(found.idx, 11, 1, 8).setValues([[           // SoldDate..ShippingScheduledDate (cols K-R)
      body.date || '', buyer, Number(it.cost) || 0,
      body.shipType || '', body.shipMethod || '', noShip ? 0 : perFee,
      body.shipDeductFrom || '', body.shipSched || ''
    ]]);
    cards.getRange(found.idx, 23, 1, 1).setValue(receiptUrl); // SaleReceiptURL (col W)
    cards.getRange(found.idx, 24, 1, 2).setValues([[batchId, address]]); // ShipBatchID, ShippingAddress (cols X-Y)
    cards.getRange(found.idx, 27, 1, 2).setNumberFormat('@').setValues([[contact, saleNotes]]); // ShippingContact, SaleNotes (cols AA-AB); text format keeps a leading 0
    finRows.push([newId_('f'), it.cardId, 'sale', body.date || '', 'Sale: ' + (it.name || '(unnamed item)'), Number(it.cost) || 0, body.pay || '', false, '', receiptUrl, 'inflow']);
  });
  // packaging the buyer paid for is part of "total received": one inflow row for the whole receipt
  if (packaging > 0) {
    finRows.push([newId_('f'), '', 'sale', body.date || '', 'Packaging: sale to ' + (buyer || '\u2014'), packaging, body.pay || '', false, '', receiptUrl, 'inflow']);
  }
  // shipping the buyer paid us ("care of buyer") is money received too: one inflow row per receipt
  const buyerShipping = body.shipType === 'buyer' ? (Number(body.shipFee) || 0) : 0;
  if (buyerShipping > 0) {
    finRows.push([newId_('f'), '', 'sale', body.date || '', 'Shipping paid by buyer: sale to ' + (buyer || '\u2014'), buyerShipping, body.pay || '', false, '', receiptUrl, 'inflow']);
  }
  appendRows_(fin, finRows);
  return { ok: true, receipt: receiptSaved, cards: moved, finance: finRows.length };
}

// Proof of shipment for one card, or (cardIds) for every card of a grouped shipping task.
function handleShipPhoto_(body) {
  const cards = cardsSheet_();
  const ids = splitIds_(Array.isArray(body.cardIds) ? body.cardIds.join(',') : (body.cardIds || body.cardId));
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'card not found' };
  let url = '';
  if (body.photo && body.photo.src) {
    url = body.photo.kind === 'link' ? body.photo.src : saveImage_(body.photo.src, 'shipped-' + todayStr_() + '-' + newId_('s'), SHIP_PHOTO_FOLDER_ID);
  }
  founds.forEach(f => cards.getRange(f.idx, 20, 1, 1).setValue(url)); // ShippingProofPhoto (col T)
  return { ok: true };
}

// A trade moves items in both directions with no sale price on either side. Items given away are marked "traded" on
// Cards; items received optionally become new onhand Cards. Finance gets ONE task with a short title; the item lists go in
// Notes (col M) as "Gave (n)" / "Received (n)".
function handleTrade_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  let photosFailed = 0, tradedN = 0, receivedN = 0;
  const tradedItems = body.tradedItems || [];
  const receivedItems = body.receivedItems || [];
  if (!tradedItems.length && !receivedItems.length) return { ok: true };

  const tradedTo = resolveParty_(body.tradedTo);
  const partyLabel = tradedTo || body.tradedBy || '\u2014';
  let receiptUrl = '', receiptSaved = false;
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = safeSave_(body.receiptPhoto.src, 'trade-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) { try { appendReceipt_('trade', body.date || todayStr_(), receiptUrl, 'Trade with ' + partyLabel, body.time); receiptSaved = true; } catch (err) {} }
  }

  tradedItems.forEach(it => {
    const found = findRow_(cards, it.cardId);
    if (!found) return;
    tradedN++;
    cards.getRange(found.idx, 10, 1, 1).setValue('traded'); // Status (col J)
    cards.getRange(found.idx, 11, 1, 3).setValues([[body.date || '', tradedTo, Number(it.cost) || 0]]); // SoldDate/SoldTo/SoldPrice (K-M)
    cards.getRange(found.idx, 23, 1, 1).setValue(receiptUrl); // SaleReceiptURL (col W)
  });

  if (body.receivedPortfolio) {
    receivedItems.forEach(it => {
      let photoUrl = '';
      if (it.photo && it.photo.src) { photoUrl = it.photo.kind === 'link' ? it.photo.src : safeSave_(it.photo.src, it.name, DRIVE_FOLDER_ID); if (it.photo.kind !== 'link' && !photoUrl) photosFailed++; }
      receivedN++;
      cards.appendRow([newId_('c'), body.date || '', tradedTo, body.tradedBy || '', it.name || '', Math.max(0, Number(it.cost) || 0),
        '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false,
        receiptUrl, '', '']);
    });
  }

  const gave = tradedItems.map(i => i.name).filter(Boolean);
  const got = receivedItems.map(i => i.name).filter(Boolean);
  const list = (head, arr) => arr.length ? head + ' (' + arr.length + ')\n' + arr.map(n => '\u2022 ' + n).join('\n') : '';
  const tradeNotes = [list('Gave', gave), list('Received', got)].filter(Boolean).join('\n').slice(0, 2000);
  ensureFinanceColumns_(fin);

  const amt = Number(body.cashAmount) || 0;
  if ((body.cashDirection === 'paid' || body.cashDirection === 'received') && amt > 0) {
    const flow = body.cashDirection === 'received' ? 'inflow' : 'outflow';
    const desc = 'Trade with ' + partyLabel + ' \u2014 cash ' + body.cashDirection;
    fin.appendRow([newId_('f'), '', 'trade', body.date || '', desc, amt, body.cashMethod || '', false, '', receiptUrl, flow, '', tradeNotes]);
  } else {
    // no cash changed hands: still a task to tick off (flow "none" = no money moved)
    fin.appendRow([newId_('f'), '', 'trade', body.date || '', 'Trade with ' + partyLabel + ' \u2014 no cash', 0, '', false, '', receiptUrl, 'none', '', tradeNotes]);
  }

  let creatives = 0;
  if (body.vlog) { try { addVideoTask_('Vlog: Trade with ' + partyLabel, body.date || todayStr_(), receiptUrl); creatives = 1; } catch (err) {} }
  return { ok: true, receipt: receiptSaved, traded: tradedN, received: receivedN, finance: 1, creatives, photosFailed };
}

// A transfer between our own accounts: one Receipts row + two Finance tasks (outflow from source, inflow to destination),
// plus an optional third outflow task for the fee.
function handleTransfer_(body) {
  const fin = financeSheet_();
  const amt = Number(body.amount);
  if (!isFinite(amt) || amt <= 0) return { ok: false, error: 'invalid amount' };
  const from = String(body.from || '').trim().slice(0, 60), to = String(body.to || '').trim().slice(0, 60);
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return { ok: false, error: 'choose two different accounts' };
  const date = body.date || todayStr_();
  const notes = String(body.notes || '').trim().slice(0, 2000);
  const fee = Number(body.fee) || 0;   // optional, paid from the source account
  if (!isFinite(fee) || fee < 0) return { ok: false, error: 'invalid fee' };

  let receiptUrl = '', receiptSaved = false;
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = safeSave_(body.receiptPhoto.src, 'transfer-receipt-' + date + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) { try { appendReceipt_('transfer', date, receiptUrl, 'Transfer: ' + from + ' \u2192 ' + to, body.time); receiptSaved = true; } catch (err) {} }
  }

  ensureFinanceColumns_(fin);
  const rows = [
    [newId_('f'), '', 'transfer', date, 'Transfer to ' + to, amt, from, false, '', receiptUrl, 'outflow', '', notes],
    [newId_('f'), '', 'transfer', date, 'Transfer from ' + from, amt, to, false, '', receiptUrl, 'inflow', '', notes]
  ];
  // the fee is a real cost taken from the source account: its own outflow task, under the same receipt
  if (fee > 0) rows.push([newId_('f'), '', 'transfer', date, 'Transfer fee: ' + from + ' \u2192 ' + to, fee, from, false, '', receiptUrl, 'outflow', '', '']);
  appendRows_(fin, rows);
  return { ok: true, receipt: receiptSaved, finance: rows.length };
}

function renameCard_(cardId, name) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  name = String(name || '').trim().slice(0, 200);
  if (!name) return { ok: false, error: 'name cannot be empty' };
  const cards = cardsSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  cards.getRange(found.idx, 5, 1, 1).setValue(name); // ItemName (col E)
  return { ok: true };
}

// Attach / clear the receipt on a standalone task (Finance ReceiptURL, col J). Receipt-derived
// rows are refused so their grouping and the receipt-delete cascade can't be disturbed.
function setTaskReceipt_(financeId, url) {
  if (!financeId) return { ok: false, error: 'missing financeId' };
  const fin = financeSheet_();
  const found = findRow_(fin, financeId);
  if (!found) return { ok: false, error: 'not found' };
  if (String(found.row[2]) !== 'manual') return { ok: false, error: 'only standalone tasks can change receipts' };
  fin.getRange(found.idx, 10, 1, 1).setValue(url || '');
  return { ok: true };
}

function linkFinanceReceipt_(p) {
  let url = '';
  if (p.receiptId) {
    const r = findRow_(receiptsSheet_(), p.receiptId);
    if (!r || !r.row[3]) return { ok: false, error: 'receipt not found' };
    url = String(r.row[3]);
  } else if (/^https?:\/\//i.test(String(p.url || ''))) {
    url = String(p.url);
  } else {
    return { ok: false, error: 'missing receipt' };
  }
  return setTaskReceipt_(p.financeId, url);
}

function handleFinanceReceipt_(body) {
  if (!body.photo || !body.photo.src) return { ok: false, error: 'no photo supplied' };
  const url = body.photo.kind === 'link' ? body.photo.src : saveImage_(body.photo.src, 'task-receipt-' + todayStr_() + '-' + newId_('r'), RECEIPT_FOLDER_ID);
  if (!url) return { ok: false, error: 'could not save photo' };
  return setTaskReceipt_(body.financeId, url);
}

function handleCardPhoto_(body) {
  const cards = cardsSheet_();
  const found = findRow_(cards, body.cardId);
  if (!found) return { ok: false, error: 'card not found' };
  if (!body.photo || !body.photo.src) return { ok: false, error: 'no photo supplied' };
  const url = body.photo.kind === 'link' ? body.photo.src : saveImage_(body.photo.src, found.row[4] || 'item', DRIVE_FOLDER_ID);
  if (!url) return { ok: false, error: 'could not save photo' };
  cards.getRange(found.idx, 8, 1, 1).setValue(url); // Photo (col H)
  return { ok: true };
}

// which = 'card' (item photo, col H) or 'proof' (proof of shipment, col T)
function clearPhoto_(cardId, which) {
  const ids = splitIds_(cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  const col = which === 'card' ? 8 : which === 'proof' ? 20 : 0;
  if (!col) return { ok: false, error: 'unknown photo type' };
  founds.forEach(f => cards.getRange(f.idx, col, 1, 1).setValue(''));
  return { ok: true };
}

// Create (standalone) or edit (any) Finance task: title, notes and up to MAX_TASK_IMAGES images.
// Upsert keyed on financeId, so a retried request can never create a duplicate.
function handleSaveFinance_(body) {
  const title = String(body.title || '').trim().slice(0, 300);
  if (!title) return { ok: false, error: 'missing title' };
  const notes = String(body.notes || '').trim().slice(0, 2000);

  // resolve images first (uploads are slow, so this happens before taking the lock)
  const urls = [];
  (Array.isArray(body.images) ? body.images : []).forEach(im => {
    if (urls.length >= MAX_TASK_IMAGES) return;
    const u = resolveTaskImage_(im);
    if (u && urls.indexOf(u) < 0) urls.push(u);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const fin = financeSheet_();
    ensureFinanceColumns_(fin);
    const found = findRow_(fin, body.financeId);
    if (found) {
      fin.getRange(found.idx, 5, 1, 1).setValue(title);                                        // Description (col E)
      fin.getRange(found.idx, 12, 1, 2).setValues([[urls.length ? JSON.stringify(urls) : '', notes]]); // Images, Notes (L-M)
      // a standalone task's old single receipt is now part of Images; clear it so it isn't shown twice
      if (String(found.row[2]) === 'manual' && found.row[9]) fin.getRange(found.idx, 10, 1, 1).setValue('');
      return { ok: true, id: String(found.row[0]), images: urls.length };
    }
    if (body.isNew !== true) return { ok: false, error: 'not found' };

    const amount = Number(body.amount);
    const flow = body.flow === 'inflow' ? 'inflow' : body.flow === 'none' ? 'none' : 'outflow';
    if (flow !== 'none' && (!isFinite(amount) || amount < 0)) return { ok: false, error: 'invalid amount' };
    const id = /^f_[0-9a-f]{4,16}$/.test(String(body.financeId || '')) ? String(body.financeId) : newId_('f');
    fin.appendRow([id, '', 'manual', String(body.date || todayStr_()), title,
      flow === 'none' ? 0 : amount, flow === 'none' ? '' : String(body.payMethod || ''), false, '', '', flow,
      urls.length ? JSON.stringify(urls) : '', notes]);
    return { ok: true, id, images: urls.length };
  } finally {
    lock.releaseLock();
  }
}

// One image spec from the app -> a stored URL ('' when it can't be used).
function resolveTaskImage_(im) {
  if (!im) return '';
  if (im.kind === 'upload') return saveImage_(im.src, 'task-' + todayStr_() + '-' + newId_('i'), RECEIPT_FOLDER_ID);
  if (im.kind === 'receipt') {
    const r = findRow_(receiptsSheet_(), im.receiptId);
    return r && r.row[3] ? String(r.row[3]) : '';
  }
  const u = String(im.src || '').trim();            // 'keep' (already stored) or 'link' (pasted)
  return /^https?:\/\//i.test(u) ? u : '';
}

// Finance needs columns L (Images), M (Notes) and N (Time). Older sheets don't have them; add on first use.
function ensureFinanceColumns_(fin) {
  const need = 14;
  if (fin.getMaxColumns() < need) fin.insertColumnsAfter(fin.getMaxColumns(), need - fin.getMaxColumns());
  const h = fin.getRange(1, 12, 1, 3).getValues()[0];
  if (!h[0]) fin.getRange(1, 12, 1, 1).setValue('Images');
  if (!h[1]) fin.getRange(1, 13, 1, 1).setValue('Notes');
  if (!h[2]) fin.getRange(1, 14, 1, 1).setValue('Time');
}

function parseImages_(cell) {
  const s = String(cell || '').trim();
  if (!s) return [];
  try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String).filter(Boolean); } catch (e) {}
  return s.split(/\s+/).filter(u => /^https?:\/\//i.test(u));
}

// Images of a Finance row: column L, plus (standalone tasks only) the older single receipt in column J.
function taskImages_(row) {
  const list = parseImages_(row[11]);
  if (String(row[2]) === 'manual' && row[9]) {
    const legacy = String(row[9]);
    if (list.map(fileKey_).indexOf(fileKey_(legacy)) < 0) list.unshift(legacy);
  }
  return list.slice(0, MAX_TASK_IMAGES);
}

// A standalone Finance task: no card, no receipt — nothing else in the sheet is touched.
function addFinance_(p) {
  const description = String(p.description || '').trim().slice(0, 300);
  if (!description) return { ok: false, error: 'missing description' };
  const amount = Number(p.amount);
  if (!isFinite(amount) || amount < 0) return { ok: false, error: 'invalid amount' };
  const flow = p.flow === 'inflow' ? 'inflow' : p.flow === 'none' ? 'none' : 'outflow';
  const id = newId_('f');
  financeSheet_().appendRow([id, '', 'manual', String(p.date || todayStr_()), description, flow === 'none' ? 0 : amount, flow === 'none' ? '' : String(p.payMethod || ''), false, '', '', flow]);
  return { ok: true, id };
}

/* ---------- receipt deletion (cascade) ---------- */

// Everything a receipt is linked to, matched by Drive file ID (never by blank).
function planReceiptDelete_(receiptId) {
  if (!receiptId) return { error: 'missing receiptId' };
  const rSheet = receiptsSheet_();
  const rFound = findRow_(rSheet, receiptId);
  if (!rFound) return { error: 'not found' };
  const rawUrl = String(rFound.row[3] || '');
  const key = fileKey_(rawUrl);
  const plan = { rSheet, receiptIdx: rFound.idx, rawUrl, key, cards: [], finance: [], creatives: [] };
  if (!key) return plan; // no URL on this receipt -> nothing can be linked to it

  const cSheet = cardsSheet_(), fSheet = financeSheet_();
  const cRows = cSheet.getDataRange().getValues();
  const cardIds = {}, batches = {};
  for (let r = 1; r < cRows.length; r++) {
    const row = cRows[r];
    if (!row[0]) continue;
    if (fileKey_(row[21]) === key || fileKey_(row[22]) === key) {
      cardIds[String(row[0])] = true;
      if (row[23]) batches[String(row[23])] = true;
      plan.cards.push({ idx: r + 1, id: String(row[0]), name: row[4] || '(unnamed)' });
    }
  }
  // a shipping batch that has no cards left after this delete has no reason to keep its Finance entry
  Object.keys(batches).forEach(b => {
    const remaining = cRows.slice(1).some(row => String(row[23]) === b && !cardIds[String(row[0])]);
    if (remaining) delete batches[b];
  });

  // Creatives (vlog tasks + post groups) tied to this receipt go with it
  const crSheet = creativesSheet_(false);
  if (crSheet) {
    const crRows = crSheet.getDataRange().getValues();
    for (let r = 1; r < crRows.length; r++) {
      const row = crRows[r];
      if (row[0] && row[2] && String(row[2]) === key) plan.creatives.push({ idx: r + 1, id: String(row[0]), title: row[3] || (row[1] === 'post' ? 'Post edits' : 'Vlog task') });
    }
  }

  const fRows = fSheet.getDataRange().getValues();
  for (let r = 1; r < fRows.length; r++) {
    const row = fRows[r];
    if (!row[0]) continue;
    const linked = fileKey_(row[9]) === key || cardIds[String(row[1])] || batches[String(row[1])];
    if (linked) plan.finance.push({ idx: r + 1, id: String(row[0]), description: row[4] || '(no description)' });
  }
  return plan;
}

// Delete the given 1-based row numbers: bottom-up so numbers stay valid, contiguous runs in one call.
function deleteRowsBatch_(sheet, idxs) {
  const rows = idxs.slice().sort((a, b) => b - a);
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sheet.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
}

function receiptImpact_(receiptId) {
  const plan = planReceiptDelete_(receiptId);
  if (plan.error) return { ok: false, error: plan.error };
  return { ok: true, cards: plan.cards.map(c => c.name), finance: plan.finance.map(f => f.description), creatives: plan.creatives.map(c => c.title) };
}

function deleteReceipt_(receiptId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // row numbers are only valid if nothing else writes while we delete
  try {
    const plan = planReceiptDelete_(receiptId);
    if (plan.error) return { ok: false, error: plan.error };
    deleteRowsBatch_(financeSheet_(), plan.finance.map(f => f.idx));
    if (plan.creatives.length) deleteRowsBatch_(creativesSheet_(false), plan.creatives.map(c => c.idx));
    deleteRowsBatch_(cardsSheet_(), plan.cards.map(c => c.idx));
    plan.rSheet.deleteRow(plan.receiptIdx);
    // the image itself goes to the Drive trash (recoverable there); never fail the delete over it
    try {
      const m = plan.rawUrl.match(/[-\w]{25,}/);
      if (m) DriveApp.getFileById(m[0]).setTrashed(true);
    } catch (err) {}
    return { ok: true, deletedCards: plan.cards.length, deletedFinance: plan.finance.length, deletedCreatives: plan.creatives.length };
  } finally {
    lock.releaseLock();
  }
}

// financeId may hold several comma-separated IDs (the app's "Record selected" button): every ID is
// validated first, then all are marked in one pass, so a bad ID changes nothing.
function recordFinance_(financeId) {
  const ids = splitIds_(financeId);
  if (!ids.length) return { ok: false, error: 'missing financeId' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const fin = financeSheet_();
    const founds = ids.map(id => findRow_(fin, id));
    if (founds.some(f => !f)) return { ok: false, error: 'not found' };
    const today = todayStr_();
    founds.forEach(found => {
      fin.getRange(found.idx, 8, 1, 2).setValues([[true, today]]); // Recorded, RecordedDate
      setShippingRecordedFlag_(found.row[1], found.row[2], true);
    });
    return { ok: true, recorded: founds.length };
  } finally {
    lock.releaseLock();
  }
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

// Finance's CardID column holds either a single card ID or (for a grouped shipping entry) a batch ID —
// flip ShippingRecorded on every Cards row it covers, which turns the Portfolio "shipped" tag into "sold".
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

// cardId may hold several comma-separated IDs (a grouped shipping task). Every card is validated
// first, then all are marked, and each batch's Finance entry is created once at the end.
function markShipped_(cardId, dateIn, timeIn) {
  const ids = splitIds_(cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  ensureCardsColumns_(cards);
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  const d = String(dateIn || '').trim(), t = String(timeIn || '').trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: 'invalid date' };
  if (t && !/^\d{1,2}:\d{2}$/.test(t)) return { ok: false, error: 'invalid time' };
  // no date given = shipped right now; a date given (backdated) keeps only the time that was typed
  const today = d || todayStr_(), now = d ? t : (t || nowTimeStr_()), batches = {};
  founds.forEach(f => {
    cards.getRange(f.idx, 10, 1, 1).setValue('shipped');
    cards.getRange(f.idx, 19, 1, 1).setValue(today);
    cards.getRange(f.idx, 26, 1, 1).setNumberFormat('@').setValue(now); // ShippedTime (col Z)
    if (f.row[23]) batches[String(f.row[23])] = true;
  });
  Object.keys(batches).forEach(b => maybeCreateBatchFinance_(b, today, now));
  return { ok: true };
}

// cardId may hold several comma-separated IDs (a grouped shipping task); all-or-nothing.
function unmarkShipped_(cardId) {
  const ids = splitIds_(cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_(), fin = financeSheet_();
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  if (founds.some(f => f.row[9] !== 'shipped')) return { ok: false, error: 'card is not marked shipped' };
  const keys = [];
  founds.forEach(f => { keys.push(f.row[23] || f.row[0]); keys.push(f.row[0]); });
  const finRows = findShippingFinance_(fin, keys);
  founds.forEach(f => {
    cards.getRange(f.idx, 10, 1, 1).setValue('shipping');
    cards.getRange(f.idx, 21, 1, 1).setValue(false);                                // ShippingRecorded
    cards.getRange(f.idx, 19, 1, 1).setValue('');
    if (cards.getMaxColumns() >= 26) cards.getRange(f.idx, 26, 1, 1).setValue(''); // ShippedTime
  });
  // batch is no longer complete, drop the not-yet-recorded entry (bottom-up so row numbers stay valid)
  finRows.map(f => f.idx).sort((a, b) => b - a).forEach(i => fin.deleteRow(i));
  return { ok: true };
}

function revertToOnhand_(cardId) {
  if (!cardId) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_(), fin = financeSheet_();
  const found = findRow_(cards, cardId);
  if (!found) return { ok: false, error: 'not found' };
  if (found.row[9] === 'onhand') return { ok: false, error: 'already onhand' };
  const batchId = found.row[23];
  cards.getRange(found.idx, 10, 1, 1).setValue('onhand');           // Status
  cards.getRange(found.idx, 11, 1, 10).setValues([['', '', '', '', '', '', '', '', '', false]]); // SoldDate..ShippingRecorded (K-U)
  ensureCardsColumns_(cards);
  cards.getRange(found.idx, 23, 1, 6).setValues([['', '', '', '', '', '']]); // SaleReceiptURL, ShipBatchID, ShippingAddress, ShippedTime, ShippingContact, SaleNotes
  if (batchId) {
    const rows = cards.getDataRange().getValues();
    const stillInBatch = rows.slice(1).some(r => r[23] === batchId && r[0] !== cardId);
    if (!stillInBatch) {
      findShippingFinance_(fin, [batchId, cardId])
        .map(f => f.idx).sort((a, b) => b - a).forEach(i => fin.deleteRow(i));
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

// The Finance row(s) of type "shipping" whose CardID column (B) holds one of the given keys: the batch ID
// for a multi-card shipment, or the card's own ID for a single-card one. Returns [{ idx, row }].
function findShippingFinance_(fin, keys) {
  const wanted = {};
  keys.forEach(k => { if (k) wanted[String(k)] = true; });
  const data = fin.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][2]) === 'shipping' && wanted[String(data[r][1])]) out.push({ idx: r + 1, row: data[r] });
  }
  return out;
}

// Change when already-shipped cards actually went out (date required, time optional). The shipping-fee
// Finance entry follows along unless it has already been recorded.
function updateShipped_(p) {
  const ids = splitIds_(p.cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const date = String(p.date || '').trim(), time = String(p.time || '').trim();
  const hasMethod = Object.prototype.hasOwnProperty.call(p, 'method'), method = String(p.method || '').trim().slice(0, 60) || 'Others';
  const hasNotes = Object.prototype.hasOwnProperty.call(p, 'notes'), notes = String(p.notes || '').trim().slice(0, 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid date' };
  if (time && !/^\d{1,2}:\d{2}$/.test(time)) return { ok: false, error: 'invalid time' };
  const cards = cardsSheet_();
  ensureCardsColumns_(cards);
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  if (founds.some(f => f.row[9] !== 'shipped')) return { ok: false, error: 'only shipped cards can be edited' };
  const keys = [];
  founds.forEach(f => {
    cards.getRange(f.idx, 19, 1, 1).setValue(date);                          // ShippedDate (col S)
    if (hasMethod) cards.getRange(f.idx, 15, 1, 1).setValue(method);         // ShippingMethod (col O)
    if (hasNotes) cards.getRange(f.idx, 28, 1, 1).setValue(notes);           // SaleNotes (col AB)
    cards.getRange(f.idx, 26, 1, 1).setNumberFormat('@').setValue(time);     // ShippedTime (col Z)
    keys.push(f.row[23] || f.row[0]); keys.push(f.row[0]);
  });
  const fin = financeSheet_();
  ensureFinanceColumns_(fin);
  findShippingFinance_(fin, keys).forEach(f => {
    fin.getRange(f.idx, 4, 1, 1).setValue(date);                             // Date (col D)
    fin.getRange(f.idx, 14, 1, 1).setNumberFormat('@').setValue(time);       // Time (col N)
  });
  return { ok: true };
}

// Called once a card is marked shipped; creates ONE Finance row per shipment batch as soon as every
// card sharing that batch ID is shipped — even when the total fee is PHP 0.
function maybeCreateBatchFinance_(batchId, dateStr, timeStr) {
  if (!batchId) return;
  const cards = cardsSheet_(), fin = financeSheet_();
  const rows = cards.getDataRange().getValues(); rows.shift();
  const group = rows.filter(r => r[23] === batchId);
  if (!group.length) return;
  if (!group.every(r => r[9] === 'shipped')) return;
  if (findShippingFinance_(fin, [batchId, group[0][0]]).length) return; // already created for this batch
  const totalFee = group.reduce((a, r) => a + (Number(r[15]) || 0), 0);
  const names = group.map(r => r[4]).join(', ');
  const payMethod = group[0][16] || '';
  const receiptUrl = group[0][22] || '';
  const idField = group.length > 1 ? batchId : group[0][0];
  ensureFinanceColumns_(fin);
  // Finance tasks are archive records now, so the entry is created already "recorded" and the cards flip to sold
  fin.appendRow([newId_('f'), idField, 'shipping', dateStr || todayStr_(), 'Shipping for ' + names, totalFee, payMethod, true, todayStr_(), receiptUrl, 'outflow', '', '', '']);
  fin.getRange(fin.getLastRow(), 14, 1, 1).setNumberFormat('@').setValue(timeStr != null ? timeStr : nowTimeStr_()); // Time (col N)
  setShippingRecordedFlag_(idField, 'shipping', true);
}

/* ---------- shipping edits + shared calendar events ---------- */

// Edit the shipping method (col O), scheduled date (col R), address (col Y), contact (col AA) and/or notes (col AB) of every card in a shipping task.
function updateShipping_(p) {
  const ids = splitIds_(p.cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const hasSched = Object.prototype.hasOwnProperty.call(p, 'sched');
  const hasAddr = Object.prototype.hasOwnProperty.call(p, 'address');
  const hasMethod = Object.prototype.hasOwnProperty.call(p, 'method');
  const hasContact = Object.prototype.hasOwnProperty.call(p, 'contact');
  const hasNotes = Object.prototype.hasOwnProperty.call(p, 'notes');
  if (!hasSched && !hasAddr && !hasMethod && !hasContact && !hasNotes) return { ok: false, error: 'nothing to change' };
  const sched = String(p.sched || '').trim();
  if (hasSched && sched && !/^\d{4}-\d{2}-\d{2}$/.test(sched)) return { ok: false, error: 'invalid date' };
  const cards = cardsSheet_();
  ensureCardsColumns_(cards);
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  if (founds.some(f => f.row[9] !== 'shipping')) return { ok: false, error: 'only cards still to ship can be edited' };
  const address = String(p.address || '').trim().slice(0, 500);
  const method = String(p.method || '').trim().slice(0, 60) || 'Others';
  const contact = String(p.contact || '').trim().slice(0, 60);
  const notes = String(p.notes || '').trim().slice(0, 1000);
  founds.forEach(f => {
    if (hasMethod) cards.getRange(f.idx, 15, 1, 1).setValue(method);  // ShippingMethod (col O)
    if (hasSched) cards.getRange(f.idx, 18, 1, 1).setValue(sched);   // ShippingScheduledDate (col R)
    if (hasAddr) cards.getRange(f.idx, 25, 1, 1).setValue(address);  // ShippingAddress (col Y)
    if (hasContact) cards.getRange(f.idx, 27, 1, 1).setNumberFormat('@').setValue(contact); // ShippingContact (col AA)
    if (hasNotes) cards.getRange(f.idx, 28, 1, 1).setValue(notes);   // SaleNotes (col AB)
  });
  return { ok: true };
}

// Calendar events live in their own "Events" tab (created on first save). Columns: ID | Date | Title | Time | Notes.
const EVENTS_SHEET = 'Events';
function eventsSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(EVENTS_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(EVENTS_SHEET);
    sh.getRange(1, 1, 1, 5).setValues([['ID', 'Date', 'Title', 'Time', 'Notes']]);
    sh.getRange('A:E').setNumberFormat('@');
  }
  return sh;
}

function fmtTimeCell_(v) {
  if (!v) return '';
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm') : String(v);
}

function getEvents_() {
  const sh = eventsSheet_(false);
  if (!sh) return { ok: true, events: [] };
  const rows = sh.getDataRange().getValues(); rows.shift();
  const events = rows.filter(r => r[0] && r[1] && r[2]).map(r => ({
    id: String(r[0]), date: fmtDateCell_(r[1]), title: String(r[2]), time: fmtTimeCell_(r[3]), notes: String(r[4] || '')
  }));
  return { ok: true, events };
}

// Upsert by eventId: edits the row if it exists, otherwise appends a new one. Safe to retry.
function saveEvent_(p) {
  const title = String(p.title || '').trim().slice(0, 200);
  const date = String(p.date || '').trim();
  const time = String(p.time || '').trim();
  const notes = String(p.notes || '').trim().slice(0, 1000);
  if (!title) return { ok: false, error: 'missing title' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid date' };
  if (time && !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'invalid time' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = eventsSheet_(true);
    const found = findRow_(sh, p.eventId);
    if (found) {
      sh.getRange(found.idx, 2, 1, 4).setNumberFormat('@').setValues([[date, title, time, notes]]);
      return { ok: true, id: String(found.row[0]) };
    }
    const id = /^e_[0-9a-f]{4,16}$/.test(String(p.eventId || '')) ? String(p.eventId) : newId_('e');
    const next = sh.getLastRow() + 1;
    sh.getRange(next, 1, 1, 5).setNumberFormat('@').setValues([[id, date, title, time, notes]]);
    return { ok: true, id };
  } finally {
    lock.releaseLock();
  }
}

function deleteEvent_(eventId) {
  if (!eventId) return { ok: false, error: 'missing eventId' };
  const sh = eventsSheet_(false);
  const found = sh && findRow_(sh, eventId);
  if (!found) return { ok: false, error: 'not found' };
  sh.deleteRow(found.idx);
  return { ok: true };
}

/* ---------- current balance (manual baseline; the app adds tasks + interest on top) ---------- */

const BALANCE_SHEET = 'Balance';

function balanceSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(BALANCE_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(BALANCE_SHEET);
    sh.getRange(1, 1, 1, 7).setValues([['UpdatedAt', 'Cash', 'Maribank', 'Others', 'Note', 'Reserves', 'Skip']]);
  }
  if (sh) {
    if (String(sh.getRange(1, 6).getValue() || '') !== 'Reserves') sh.getRange(1, 6).setValue('Reserves');
    if (sh.getMaxColumns() < 7) sh.insertColumnsAfter(sh.getMaxColumns(), 7 - sh.getMaxColumns());
    if (String(sh.getRange(1, 7).getValue() || '') !== 'Skip') sh.getRange(1, 7).setValue('Skip');
  }
  return sh;
}

function getBalance_() {
  const interest = getInterest_();
  const sh = balanceSheet_(false);
  if (!sh || sh.getLastRow() < 2) return { ok: true, balance: null, interest };
  const r = sh.getRange(sh.getLastRow(), 1, 1, 7).getValues()[0];
  const at = r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(r[0] || '');
  const skip = String(r[6] || '').split(',').map(s => s.trim()).filter(Boolean);
  return { ok: true, interest, balance: { updatedAt: at, cash: Number(r[1]) || 0, maribank: Number(r[2]) || 0, reserves: Number(r[5]) || 0, others: Number(r[3]) || 0, note: String(r[4] || ''), skip } };
}

function saveBalance_(p) {
  const num = v => (v === '' || v == null) ? 0 : Number(v);
  const cash = num(p.cash), maribank = num(p.maribank), reserves = num(p.reserves), others = num(p.others);
  if (![cash, maribank, reserves, others].every(isFinite)) return { ok: false, error: 'invalid amount' };
  const note = String(p.note || '').trim().slice(0, 500);
  const skip = String(p.skip || '').split(',').map(s => s.trim()).filter(s => /^f_[0-9a-f]{4,16}$/.test(s)).join(',').slice(0, 20000);
  let at = String(p.at || '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) at = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = balanceSheet_(true);
    const next = sh.getLastRow() + 1;
    if (next > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    sh.getRange(next, 1, 1, 1).setNumberFormat('@');
    sh.getRange(next, 5, 1, 1).setNumberFormat('@');
    sh.getRange(next, 7, 1, 1).setNumberFormat('@');
    sh.getRange(next, 1, 1, 7).setValues([[at, cash, maribank, others, note, reserves, skip]]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Interest settings live in script properties (one shared copy), NOT in the Balance tab, so changing a rate
// never creates a new balance row / resets the starting point.
function getInterest_() {
  try { const v = PropertiesService.getScriptProperties().getProperty('interest'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

function saveInterest_(json) {
  let c;
  try { c = JSON.parse(String(json || '')); } catch (e) { return { ok: false, error: 'invalid settings' }; }
  const n = v => Number(v);
  const a = c.accounts || {};
  const clean = { lo: n(c.lo), hi: n(c.hi), threshold: n(c.threshold), tax: n(c.tax),
    accounts: { cash: !!a.cash, maribank: !!a.maribank, reserves: !!a.reserves, others: !!a.others } };
  if (![clean.lo, clean.hi, clean.threshold, clean.tax].every(x => isFinite(x) && x >= 0) || clean.tax > 100) return { ok: false, error: 'invalid settings' };
  PropertiesService.getScriptProperties().setProperty('interest', JSON.stringify(clean));
  return { ok: true };
}

/* ---------- reads ---------- */

function getPortfolio_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const rmap = receiptMap_();
  const owned = [], sold = [], all = [];
  rows.forEach(r => {
    if (!r[4]) return;
    const status = r[9] || 'onhand';
    const tag = status === 'onhand' ? 'onhand'
      : status === 'shipping' ? 'shipping'
      : status === 'traded' ? 'traded'
      : 'sold';   // shipped == sold now: Finance tasks are archive records, there is no separate "recorded" step
    const item = {
      id: r[0], name: r[4], photo: toDisplayUrl_(r[7]),
      purchaseDate: fmtDateCell_(r[1]), purchaseCost: Number(r[5]) || 0,
      tag, soldDate: fmtDateCell_(r[10]), soldPrice: Number(r[12]) || 0,
      purchaseReceipt: r[21] || '', saleReceipt: r[22] || '',
      receipts: receiptLinks_(r[21], r[22], rmap)
    };
    (status === 'onhand' || status === 'shipping' ? owned : sold).push(item);
    all.push(item);
  });
  // cards = everything in one list; owned/sold kept for older app versions
  return { ok: true, cards: all.reverse(), owned: owned.reverse(), sold: sold.reverse() };
}

function getFinance_() {
  const rows = financeSheet_().getDataRange().getValues(); rows.shift();
  const rmap = receiptMap_();

  // cards indexed three ways, so a task can find the card(s) behind it
  const cRows = cardsSheet_().getDataRange().getValues(); cRows.shift();
  const byId = {}, byBatch = {}, byRcpt = {};
  const push = (map, k, v) => { (map[k] = map[k] || []).push(v); };
  cRows.forEach(c => {
    if (!c[0]) return;
    const photo = /^https?:\/\//i.test(String(c[7] || '')) ? String(c[7]) : '';
    const card = { name: String(c[4] || ''), link: photo };
    byId[String(c[0])] = card;
    if (c[23]) push(byBatch, String(c[23]), card);
    const out = fileKey_(c[22]), inn = fileKey_(c[21]);
    if (c[9] === 'traded' && out) push(byRcpt, out, { name: card.name, link: card.link, role: 'gave' });
    if (inn) push(byRcpt, inn, { name: card.name, link: card.link, role: 'received' });
  });
  const cardsFor = (r, key) => {
    const type = String(r[2]), ref = String(r[1] || '');
    if (type === 'trade') return key ? (byRcpt[key] || []) : [];
    if (type === 'shipping') return byId[ref] ? [byId[ref]] : (byBatch[ref] || []);
    if ((type === 'purchase' || type === 'sale') && byId[ref]) return [byId[ref]];
    return [];
  };

  const toRecord = [], recorded = [];
  rows.forEach(r => {
    if (!r[0]) return;
    const key = fileKey_(r[9]);
    const rc = key ? rmap[key] : null;
    const item = { id: r[0], date: fmtDateCell_(r[3]), description: r[4], amount: Number(r[5]) || 0, payMethod: r[6], receipt: r[9] || '', flow: r[10] || 'outflow',
      type: r[2] || '', groupKey: key,
      notes: r[12] || '',
      time: fmtTimeCell_(r[13]) || (['purchase', 'sale', 'trade', 'transfer'].indexOf(String(r[2])) >= 0 && rc ? rc.time : ''),
      images: taskImages_(r).map(u => ({ raw: u, thumb: toDisplayUrl_(u, 300), full: toDisplayUrl_(u, 1080) })),
      cards: cardsFor(r, key),
      groupType: rc ? rc.type : '', groupLabel: rc ? rc.description : '', groupDate: rc ? rc.date : '', groupTime: rc ? rc.time : '' };
    (r[7] === true ? recorded : toRecord).push(item);
  });
  return { ok: true, toRecord: toRecord.reverse(), recorded: recorded.reverse() };
}

function getOnhandCards_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const cards = rows.filter(r => r[4] && r[9] === 'onhand').map(r => ({ id: r[0], name: r[4], cost: Number(r[5]) || 0 })).reverse();
  return { ok: true, cards };
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
      shippedDate: fmtDateCell_(r[18]), shippedTime: fmtTimeCell_(r[25]), proofPhoto: toDisplayUrl_(r[19]),
      saleReceipt: r[22] || '',
      address: r[24] || '',
      contact: String(r[26] || ''),
      notes: String(r[27] || ''),
      // cards that came from one sale receipt share a key, so the app can show them as one task
      groupKey: fileKey_(r[22]) || (r[23] ? 'b:' + r[23] : 'c:' + r[0])
    };
    (status === 'shipping' ? toShip : shipped).push(item);
  });
  return { ok: true, toShip: toShip.reverse(), shipped: shipped.reverse() };
}

function getReceipts_() {
  const rows = receiptsSheet_().getDataRange().getValues(); rows.shift();
  const receipts = rows.filter(r => r[0]).map(r => ({ id: r[0], type: r[1], date: fmtDateCell_(r[2]), url: toDisplayUrl_(r[3]), description: r[4], time: fmtTimeCell_(r[5]) }));
  return { ok: true, receipts: receipts.reverse() };
}

/* ---------- creatives: vlog tasks (videos) and per-receipt card edits (posts) ---------- */

// Optional: only show post groups for receipts dated on/after this day (yyyy-mm-dd). '' = every receipt on record.
const CREATIVES_POSTS_FROM = '';
const CREATIVES_SHEET = 'Creatives';
const CREATIVE_HEADERS = ['ID', 'Kind', 'ReceiptKey', 'Title', 'Date', 'Status', 'Platforms', 'Notes', 'Caption', 'Edited', 'Auto', 'Created', 'DoneDate'];

function creativesSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(CREATIVES_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(CREATIVES_SHEET);
    sh.getRange(1, 1, 1, CREATIVE_HEADERS.length).setValues([CREATIVE_HEADERS]);
    sh.getRange(1, 1, sh.getMaxRows(), CREATIVE_HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

function cleanDate_(d) { d = String(d || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; }
function cleanPlatforms_(json) {
  let o = {};
  try { o = JSON.parse(json || '{}') || {}; } catch (err) {}
  const out = {};
  ['fb', 'ig', 'yt', 'tt'].forEach(k => {
    const p = o[k]; if (!p) return;
    const link = String(p.link || '').trim().slice(0, 500);
    out[k] = { on: p.on === true || p.on === 'true', date: cleanDate_(p.date), link: /^https?:\/\//i.test(link) ? link : '' };
  });
  return JSON.stringify(out);
}
function parsePlatforms_(cell) { try { return JSON.parse(cell || '{}') || {}; } catch (err) { return {}; } }
function writeCreativeRow_(sh, idx, row) {
  const at = idx || (sh.getLastRow() + 1);
  if (at > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), at - sh.getMaxRows());
  sh.getRange(at, 1, 1, CREATIVE_HEADERS.length).setNumberFormat('@').setValues([row]);
}
function blankCreative_(id, kind, key) {
  return [id, kind, key || '', '', '', 'todo', '', '', '', '', '', todayStr_(), ''];
}

// A vlog task made automatically from a purchase / trade receipt.
function addVideoTask_(title, date, receiptUrl) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = creativesSheet_(true);
    const row = blankCreative_(newId_('v'), 'video', fileKey_(receiptUrl));
    row[3] = String(title).slice(0, 200); row[4] = cleanDate_(date) || todayStr_(); row[10] = 'auto';
    writeCreativeRow_(sh, 0, row);
  } finally { lock.releaseLock(); }
}

// Every post group is one receipt's worth of portfolio cards; its ID is stable (pg_ + receipt key).
function cardGroupId_(c) {
  const key = fileKey_(c[21]);
  return key ? 'pg_' + key : 'pg_n_' + fmtDateCell_(c[1]) + '_' + String(c[2] || '').replace(/[^\w]+/g, '').slice(0, 20);
}
function creativeObj_(r) {
  return { id: String(r[0]), kind: String(r[1]), receiptKey: String(r[2] || ''), title: String(r[3] || ''), date: fmtDateCell_(r[4]),
    status: r[5] === 'done' ? 'done' : 'todo', platforms: parsePlatforms_(r[6]), notes: String(r[7] || ''), caption: String(r[8] || ''),
    edited: String(r[9] || '').split('|').filter(Boolean), auto: r[10] === 'auto', doneDate: fmtDateCell_(r[12]) };
}

function getCreatives_() {
  const sh = creativesSheet_(false);
  const rows = sh ? sh.getDataRange().getValues().slice(1) : [];
  const videos = [], stored = {};
  rows.forEach(r => {
    if (!r[0]) return;
    const o = creativeObj_(r);
    if (o.kind === 'video') videos.push(o); else stored[o.id] = o;
  });

  const rmap = receiptMap_();
  const cRows = cardsSheet_().getDataRange().getValues(); cRows.shift();
  const groups = {}, order = [];
  cRows.forEach(c => {
    if (!c[0] || !c[4]) return;
    const key = fileKey_(c[21]), rc = key ? rmap[key] : null;
    if (rc && rc.type !== 'purchase' && rc.type !== 'trade') return;
    const date = rc ? rc.date : fmtDateCell_(c[1]);
    if (CREATIVES_POSTS_FROM && (!date || date < CREATIVES_POSTS_FROM)) return;
    const id = cardGroupId_(c);
    if (!groups[id]) {
      groups[id] = { id, receiptKey: key, type: rc ? rc.type : 'purchase', label: rc ? rc.description : ('Purchase from ' + (c[2] || '\u2014')), date, cards: [] };
      order.push(id);
    }
    groups[id].cards.push({ id: String(c[0]), name: String(c[4]), photo: toDisplayUrl_(c[7], 300), full: toDisplayUrl_(c[7], 1080), cost: Number(c[5]) || 0 });
  });
  const posts = order.map(id => {
    const g = groups[id], st = stored[id] || creativeObj_(blankCreative_(id, 'post', g.receiptKey));
    const done = {}; st.edited.forEach(x => done[x] = true);
    g.cards.forEach(c => c.edited = !!done[c.id]);
    const n = g.cards.filter(c => c.edited).length;
    return Object.assign(g, { scheduled: st.date || g.date, platforms: st.platforms, notes: st.notes, caption: st.caption,
      editedCount: n, status: n === g.cards.length ? 'edited' : 'toedit' });
  });
  return { ok: true, videos: videos.reverse(), posts: posts.reverse() };
}

// Upsert by id. Only the fields that are present in the request are changed, so a date change never wipes the links.
function saveCreative_(p) {
  let id = String(p.id || '').trim();
  const isPost = id.indexOf('pg_') === 0;
  if (!isPost && !/^v_[0-9a-f]{4,16}$/.test(id)) id = newId_('v');
  if ('title' in p && !isPost && !String(p.title).trim()) return { ok: false, error: 'missing title' };
  if ('date' in p && p.date && !cleanDate_(p.date)) return { ok: false, error: 'invalid date' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = creativesSheet_(true);
    const found = findRow_(sh, id);
    const row = found ? found.row.slice() : blankCreative_(id, isPost ? 'post' : 'video', isPost ? id.slice(3) : '');
    if (!found && !isPost) { row[3] = String(p.title || '').trim().slice(0, 200); row[4] = cleanDate_(p.date) || todayStr_(); }
    if ('title' in p) row[3] = String(p.title).trim().slice(0, 200);
    if ('date' in p) row[4] = cleanDate_(p.date);
    if ('status' in p) { row[5] = p.status === 'done' ? 'done' : 'todo'; row[12] = row[5] === 'done' ? todayStr_() : ''; }
    if ('platforms' in p) row[6] = cleanPlatforms_(p.platforms);
    if ('notes' in p) row[7] = String(p.notes).trim().slice(0, 1000);
    if ('caption' in p) row[8] = String(p.caption).trim().slice(0, 1500);
    writeCreativeRow_(sh, found ? found.idx : 0, row);
    return { ok: true, id };
  } finally { lock.releaseLock(); }
}

// Mark cards of one post group edited (edited=true) or put them back on the to-edit list (edited=false).
function setCreativeCards_(p) {
  const id = String(p.id || '');
  if (id.indexOf('pg_') !== 0) return { ok: false, error: 'not a post group' };
  const ids = splitIds_(p.cardIds), on = p.edited === 'true' || p.edited === true;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = creativesSheet_(true);
    const found = findRow_(sh, id);
    const row = found ? found.row.slice() : blankCreative_(id, 'post', id.slice(3));
    const set = {}; String(row[9] || '').split('|').filter(Boolean).forEach(x => set[x] = true);
    ids.forEach(x => { if (on) set[x] = true; else delete set[x]; });
    row[9] = Object.keys(set).join('|');
    writeCreativeRow_(sh, found ? found.idx : 0, row);
    return { ok: true, edited: Object.keys(set) };
  } finally { lock.releaseLock(); }
}

// Calendar "Apply changes": many tasks at once. Videos -> done/todo. Post groups -> every card edited / none.
function completeCreatives_(p) {
  const ids = splitIds_(p.ids), done = p.status !== 'todo';
  if (!ids.length) return { ok: false, error: 'nothing selected' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = creativesSheet_(true);
    let cRows = null, changed = 0;
    ids.forEach(id => {
      const found = findRow_(sh, id);
      if (id.indexOf('pg_') === 0) {
        if (!cRows) { cRows = cardsSheet_().getDataRange().getValues(); cRows.shift(); }
        const cardIds = cRows.filter(c => c[0] && c[4] && cardGroupId_(c) === id).map(c => String(c[0]));
        const row = found ? found.row.slice() : blankCreative_(id, 'post', id.slice(3));
        row[9] = done ? cardIds.join('|') : '';
        writeCreativeRow_(sh, found ? found.idx : 0, row); changed++;
      } else if (found) {
        const row = found.row.slice();
        row[5] = done ? 'done' : 'todo'; row[12] = done ? todayStr_() : '';
        writeCreativeRow_(sh, found.idx, row); changed++;
      }
    });
    return { ok: true, changed };
  } finally { lock.releaseLock(); }
}

function deleteCreative_(id) {
  id = String(id || '');
  if (!id || id.indexOf('pg_') === 0) return { ok: false, error: 'only video tasks can be deleted' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = creativesSheet_(false);
    const found = sh && findRow_(sh, id);
    if (!found) return { ok: false, error: 'not found' };
    sh.deleteRow(found.idx);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- entities: sellers, buyers and trade partners ---------- */

// One saved entity per real person/shop. Every receipt resolves the typed name through this list, so "Kuya Rick" and
// "KUYA RICK" (or any spelling saved as an alias) end up as the same entity and the same text in every sheet.
// Matching ignores capitals and extra spaces. Renaming or merging rewrites the old spellings everywhere they were stored.
const ENTITIES_SHEET = 'Entities';
const PARTY_TEXT = /^(Purchase from |Sale to |Trade with |Packaging: sale to |Shipping paid by buyer: sale to )(.+?)( \u2014 .*)?$/;

function entitiesSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(ENTITIES_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(ENTITIES_SHEET);
    sh.getRange(1, 1, 1, 5).setValues([['ID', 'Name', 'Contact', 'Aliases', 'Created']]);
    sh.getRange('A:E').setNumberFormat('@');   // text, so a contact number keeps its leading 0
  }
  return sh;
}

function cleanParty_(s) { return String(s == null ? '' : s).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
function partyKey_(s) { return cleanParty_(s).toLowerCase(); }

function readEntities_(sh) {
  const rows = sh.getDataRange().getValues(), out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[0] || !row[1]) continue;
    out.push({ idx: r + 1, id: String(row[0]), name: String(row[1]), contact: String(row[2] || ''),
      aliases: String(row[3] || '').split('|').map(a => a.trim()).filter(Boolean) });
  }
  return out;
}
function entityKeys_(e) { return [e.name].concat(e.aliases).map(partyKey_).filter(Boolean); }
// normalized name or alias -> entity (names win over aliases)
function entityMap_(list) {
  const map = {};
  list.forEach(e => { const k = partyKey_(e.name); if (k && !map[k]) map[k] = e; });
  list.forEach(e => e.aliases.forEach(a => { const k = partyKey_(a); if (k && !map[k]) map[k] = e; }));
  return map;
}

// Used by the receipt handlers: the canonical name for what was typed (the entity is created on first use).
// A contact number, when given, is remembered on the entity. Never lets an entity problem block a receipt.
function resolveParty_(raw, contact) {
  const name = cleanParty_(raw);
  if (!name || name === '\u2014') return String(raw || '').trim();
  try {
    const sh = entitiesSheet_(true), e = entityMap_(readEntities_(sh))[partyKey_(name)];
    const c = String(contact || '').trim().slice(0, 60);
    if (e) { if (c && c !== e.contact) sh.getRange(e.idx, 3, 1, 1).setValue(c); return e.name; }
    appendRows_(sh, [[newId_('en'), name, c, '', todayStr_()]]);
    return name;
  } catch (err) { return name; }
}

function getEntityNames_() {
  const sh = entitiesSheet_(false);
  const list = sh ? readEntities_(sh) : [];
  return { ok: true, entities: list.map(e => ({ name: e.name, contact: e.contact, aliases: e.aliases })).sort((a, b) => a.name.localeCompare(b.name)) };
}

// Every party name found in the sheets, by normalized key -> { spelling: count }.
function scanParties_() {
  const found = {};
  const add = raw => {
    const n = cleanParty_(raw);
    if (!n || n === '\u2014') return;
    const k = n.toLowerCase(), c = found[k] || (found[k] = {});
    c[n] = (c[n] || 0) + 1;
  };
  const cRows = cardsSheet_().getDataRange().getValues(); cRows.shift();
  cRows.forEach(r => { if (r[0]) { add(r[2]); add(r[11]); } });
  const rs = receiptsSheet_();
  if (rs) { const rr = rs.getDataRange().getValues(); rr.shift(); rr.forEach(r => { const m = String(r[4] || '').match(PARTY_TEXT); if (m) add(m[2]); }); }
  return found;
}

function mapPartyText_(text, canon) {
  const m = String(text || '').match(PARTY_TEXT);
  if (!m) return null;
  const c = canon(m[2]);
  return c ? m[1] + c + (m[3] || '') : null;
}

// Rewrite one column (from row 2 down) through fn(value) -> new value, or null to leave it. One write per column.
function rewriteColumn_(sheet, col, fn) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return 0;
  const rng = sheet.getRange(2, col, n, 1), vals = rng.getValues();
  let changed = 0;
  vals.forEach(v => { const nv = fn(v[0]); if (nv != null && nv !== v[0]) { v[0] = nv; changed++; } });
  if (changed) rng.setValues(vals);
  return changed;
}

// canon(raw) -> the name it should have, or null when it is already right. Applied to Cards (Seller, SoldTo),
// Receipts descriptions and Finance descriptions. Finance is skipped when nothing else changed (unless forced).
function rewriteParties_(canon, forceFinance) {
  let changed = 0;
  const cards = cardsSheet_();
  changed += rewriteColumn_(cards, 3, canon);    // Seller
  changed += rewriteColumn_(cards, 12, canon);   // SoldTo
  const text = t => mapPartyText_(t, canon);
  const rs = receiptsSheet_();
  if (rs) changed += rewriteColumn_(rs, 5, text);
  if (forceFinance || changed) changed += rewriteColumn_(financeSheet_(), 5, text);
  return changed;
}

// Make sure every name already in the sheets is a saved entity, and that spelling variants (capitals / spaces / aliases)
// are written the same way everywhere. Safe to run repeatedly: when everything is in order it changes nothing.
function syncEntities_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = entitiesSheet_(true), ents = readEntities_(sh), map = entityMap_(ents), found = scanParties_(), fresh = [];
    Object.keys(found).forEach(k => {
      if (map[k]) return;
      const sp = found[k], best = Object.keys(sp).sort((a, b) => sp[b] - sp[a])[0];   // most used spelling wins
      fresh.push([newId_('en'), best, '', '', todayStr_()]);
    });
    if (fresh.length) {
      appendRows_(sh, fresh);
      fresh.forEach(row => ents.push({ idx: 0, id: row[0], name: row[1], contact: '', aliases: [] }));
    }
    const map2 = entityMap_(ents);
    rewriteParties_(raw => {
      const n = cleanParty_(raw);
      if (!n) return null;
      const e = map2[n.toLowerCase()];
      return e && e.name !== raw ? e.name : null;
    }, false);
    return fresh.length;
  } finally { lock.releaseLock(); }
}

// Entities + one slim line per card movement: [entityName, kind, date, value]
//   buy   = a card we bought (value = what we paid)       sell  = a card we sold (value = sold price)
//   trade = a card traded in or out (value = its stated value). Trade-in cards are the ones saved with no pay method.
function getEntities_() {
  syncEntities_();
  const ents = readEntities_(entitiesSheet_(true)), map = entityMap_(ents);
  const nameOf = raw => { const e = map[partyKey_(raw)]; return e ? e.name : ''; };
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const tx = [];
  rows.forEach(r => {
    if (!r[0] || !r[4]) return;
    const status = String(r[9] || 'onhand');
    const from = nameOf(r[2]);
    if (from) tx.push([from, (r[6] === '' || r[6] == null) ? 'trade' : 'buy', fmtDateCell_(r[1]), Number(r[5]) || 0]);
    const to = nameOf(r[11]);
    if (to && (status === 'shipping' || status === 'shipped')) tx.push([to, 'sell', fmtDateCell_(r[10]), Number(r[12]) || 0]);
    else if (to && status === 'traded') tx.push([to, 'trade', fmtDateCell_(r[10]), Number(r[12]) || 0]);
  });
  return { ok: true, entities: ents.map(e => ({ id: e.id, name: e.name, contact: e.contact, aliases: e.aliases })), tx };
}

// Create (no entityId) or edit (entityId): rename and/or contact. A rename keeps the old spelling as an alias and
// rewrites it everywhere. A name another entity already uses is refused: that is what Merge is for.
function saveEntity_(p) {
  const name = cleanParty_(p.name);
  if (!name) return { ok: false, error: 'name cannot be empty' };
  const contact = String(p.contact || '').trim().slice(0, 60);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = entitiesSheet_(true), ents = readEntities_(sh), key = name.toLowerCase();
    const self = p.entityId ? ents.filter(e => e.id === String(p.entityId))[0] : null;
    if (p.entityId && !self) return { ok: false, error: 'not found' };
    const clash = ents.filter(e => (!self || e.id !== self.id) && entityKeys_(e).indexOf(key) >= 0)[0];
    if (clash) return { ok: false, error: '"' + clash.name + '" already uses that name. Use Merge instead.' };
    if (!self) { appendRows_(sh, [[newId_('en'), name, contact, '', todayStr_()]]); return { ok: true }; }
    if (name === self.name) { sh.getRange(self.idx, 3, 1, 1).setValue(contact); return { ok: true }; }
    const oldKey = partyKey_(self.name), keys = {};
    entityKeys_(self).forEach(k => keys[k] = true);
    let aliases = self.aliases.filter(a => partyKey_(a) !== key);
    if (oldKey !== key && !aliases.some(a => partyKey_(a) === oldKey)) aliases.push(self.name);
    sh.getRange(self.idx, 2, 1, 3).setValues([[name, contact, aliases.join('|')]]);
    rewriteParties_(raw => { const n = cleanParty_(raw); return n && keys[n.toLowerCase()] && raw !== name ? name : null; }, true);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Fold one or more entities (fromIds, comma-separated) into another (intoId). Their names become aliases of the target,
// every record is rewritten to the target's name, and the folded entities are removed.
function mergeEntities_(p) {
  const into = String(p.intoId || ''), ids = splitIds_(p.fromIds).filter(i => i !== into);
  if (!into || !ids.length) return { ok: false, error: 'pick what to merge and where' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = entitiesSheet_(true), ents = readEntities_(sh);
    const target = ents.filter(e => e.id === into)[0], from = ents.filter(e => ids.indexOf(e.id) >= 0);
    if (!target || from.length !== ids.length) return { ok: false, error: 'not found' };
    const keys = {}, have = {};
    let aliases = target.aliases.slice(), contact = target.contact;
    entityKeys_(target).forEach(k => { keys[k] = true; have[k] = true; });
    from.forEach(e => {
      entityKeys_(e).forEach(k => keys[k] = true);
      [e.name].concat(e.aliases).forEach(a => { const k = partyKey_(a); if (k && !have[k]) { have[k] = true; aliases.push(a); } });
      if (!contact && e.contact) contact = e.contact;
    });
    sh.getRange(target.idx, 3, 1, 2).setValues([[contact, aliases.join('|')]]);
    deleteRowsBatch_(sh, from.map(e => e.idx));
    rewriteParties_(raw => { const n = cleanParty_(raw); return n && keys[n.toLowerCase()] && raw !== target.name ? target.name : null; }, true);
    return { ok: true, merged: from.length };
  } finally { lock.releaseLock(); }
}

// Only an entity with no history can be deleted (otherwise the next sync would recreate it): merge it instead.
function deleteEntity_(entityId) {
  if (!entityId) return { ok: false, error: 'missing entityId' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = entitiesSheet_(true), e = readEntities_(sh).filter(x => x.id === String(entityId))[0];
    if (!e) return { ok: false, error: 'not found' };
    const found = scanParties_();
    if (entityKeys_(e).some(k => found[k])) return { ok: false, error: 'it has receipts or cards on record. Merge it into another entity instead.' };
    sh.deleteRow(e.idx);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- helpers ---------- */

// "a,b,c" -> ['a','b','c'] (blank entries dropped)
function splitIds_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

// Cards needs columns Y-AB (ShippingAddress, ShippedTime, ShippingContact, SaleNotes). Older sheets stop at X; add them on first use.
function ensureCardsColumns_(cards) {
  const need = 28;
  if (cards.getMaxColumns() < need) cards.insertColumnsAfter(cards.getMaxColumns(), need - cards.getMaxColumns());
  const h = cards.getRange(1, 25, 1, 4).getValues()[0];
  ['ShippingAddress', 'ShippedTime', 'ShippingContact', 'SaleNotes'].forEach((name, i) => { if (!h[i]) cards.getRange(1, 25 + i).setValue(name); });
}

// Opening the spreadsheet is the slowest single call here; do it once per request, not once per helper call.
let SS_ = null;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(SHEET_ID)); }

// Append many rows with ONE write (appendRow per row is a round trip each).
function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const start = sheet.getLastRow() + 1, width = rows[0].length;
  const needRows = start + rows.length - 1 - sheet.getMaxRows();
  if (needRows > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needRows);
  sheet.getRange(start, 1, rows.length, width).setValues(rows);
}

// id -> 1-based row number, from a single read of the sheet.
function rowIndex_(sheet) {
  const data = sheet.getDataRange().getValues(), map = {};
  for (let r = 1; r < data.length; r++) if (data[r][0] !== '') map[String(data[r][0])] = r + 1;
  return map;
}

function cardsSheet_() { return ss_().getSheetByName(CARDS_SHEET); }
function financeSheet_() { return ss_().getSheetByName(FINANCE_SHEET); }
function receiptsSheet_() { return ss_().getSheetByName(RECEIPTS_SHEET); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function nowTimeStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm'); }
function cleanTime_(t) { t = String(t || '').trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : ''; }

// Receipts needs column F (Time). Older sheets stop at E; add it on first use.
function ensureReceiptsColumns_(sh) {
  if (sh.getMaxColumns() < 6) sh.insertColumnsAfter(sh.getMaxColumns(), 6 - sh.getMaxColumns());
  if (!sh.getRange(1, 6).getValue()) sh.getRange(1, 6).setValue('Time');
}
// One Receipts row. The time is written as text so Sheets never turns "14:30" into a time-of-day value.
function appendReceipt_(type, date, url, description, time) {
  const sh = receiptsSheet_();
  ensureReceiptsColumns_(sh);
  sh.appendRow([newId_('rc'), type, date, url, description, '']);
  const t = cleanTime_(time);
  if (t) sh.getRange(sh.getLastRow(), 6, 1, 1).setNumberFormat('@').setValue(t);
}
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

function toDisplayUrl_(url, size) {
  if (!url) return '';
  url = String(url);
  if (/drive\.google\.com/.test(url)) {
    const m = url.match(/[-\w]{25,}/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[0] + '&sz=w' + (size || 600);
  }
  return url;
}

// Stable identity for a stored file URL: its Drive file ID when it has one, else the URL itself.
function fileKey_(url) {
  if (!url) return '';
  url = String(url);
  const m = url.match(/[-\w]{25,}/);
  return m ? m[0] : url;
}

// fileKey -> { id, type, date, description, time } for every row in Receipts
function receiptMap_() {
  const map = {};
  const sheet = receiptsSheet_();
  if (!sheet) return map;
  const rows = sheet.getDataRange().getValues(); rows.shift();
  rows.forEach(r => {
    const k = fileKey_(r[3]);
    if (r[0] && k) map[k] = { id: r[0], type: r[1] || '', date: fmtDateCell_(r[2]), description: r[4] || '', time: fmtTimeCell_(r[5]) };
  });
  return map;
}

// The receipts attached to a card (purchase/trade-in receipt first, then sale/trade-out receipt).
function receiptLinks_(purchaseUrl, saleUrl, rmap) {
  const NAMES = { purchase: 'Purchase receipt', sale: 'Sale receipt', trade: 'Trade receipt' };
  const out = [];
  [[purchaseUrl, 'Purchase receipt'], [saleUrl, 'Sale receipt']].forEach(pair => {
    if (!pair[0]) return;
    const rc = rmap[fileKey_(pair[0])];
    out.push({ label: (rc && NAMES[rc.type]) || pair[1], url: toDisplayUrl_(pair[0], 1080), link: String(pair[0]) });
  });
  return out;
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
