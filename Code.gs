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
 *    Tab "Cards" — header row (columns A-Y):
 *      ID | PurchaseDate | Seller | BoughtBy | ItemName | PurchaseCost | PurchasePayMethod | Photo | PurchaseNotes | Status | SoldDate | SoldTo | SoldPrice | ShipType | ShippingMethod | ShippingFee | ShippingDeductedFrom | ShippingScheduledDate | ShippedDate | ShippingProofPhoto | ShippingRecorded | PurchaseReceiptURL | SaleReceiptURL | ShipBatchID | ShippingAddress
 *      ShippingAddress (col Y) is new and optional: the script adds the column and header by itself the
 *      first time a sale is saved. Older rows simply read as blank.
 *      Status is one of: onhand, shipping, shipped, traded.
 *      A "traded" card (given away in a Trade receipt) reuses the SoldDate/
 *      SoldTo/SoldPrice/SaleReceiptURL columns to hold TradedDate/TradedWith/
 *      TradeValue/TradeReceiptURL instead — it never goes through shipping,
 *      so those columns are otherwise unused for it.
 *
 *    Tab "Finance" — header row (columns A-M):
 *      ID | CardID | Type | Date | Description | Amount | PayMethod | Recorded | RecordedDate | ReceiptURL | Flow | Images | Notes
 *      Images (col L) = up to 5 image URLs as a JSON array; Notes (col M) = the task's longer description
 *      (Description, col E, is the task title). L and M are optional: older rows leave them blank, and
 *      the script adds the two headers and columns by itself the first time a task is saved.
 *      Type is one of: purchase, sale, shipping, trade.
 *      Flow is one of: inflow (money received into PayMethod), outflow (money spent from PayMethod).
 *
 *    Tab "Receipts" — header row (columns A-E):
 *      ID | Type | Date | URL | Description
 *      Type is one of: purchase, sale, trade.
 *
 *    If you're upgrading from an older version of this sheet that only had
 *    columns A-U on Cards and A-J on Finance, just add the new headers at
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
 *        (cardId may be several IDs separated by commas: the Shipping tab groups every card of one
 *        sale receipt into a single task, and marks / reverts them together in one call. clearPhoto
 *        accepts the same comma-separated form.)
 *   GET  ?action=revertToOnhand&cardId=..&secret=..&callback=..    -> { ok, error? }
 *   GET  ?action=deleteCard&cardId=..&secret=..&callback=..        -> { ok }
 *   GET  ?action=deleteFinance&financeId=..&secret=..&callback=.. -> { ok }
 *   POST { action:'purchase', secret, date, seller, people, pay, notes, items:[{name,cost,photo,portfolio}], receiptPhoto:{src} }
 *   POST { action:'sell', secret, date, buyer, notes, pay, shipType, shipMethod, shipFee, shipDeductFrom, shipSched,
 *          shipAddress, packaging, items:[{cardId,name,cost}], receiptPhoto:{src} }
 *        packaging (optional) = what the buyer paid for packaging; it bills to Finance as one extra
 *        inflow row tied to the sale receipt. shipAddress / shipSched are stored on the cards for the
 *        Shipping tab only and never appear on the receipt image.
 *   POST { action:'trade', secret, date, tradedTo, tradedBy, notes,
 *          tradedItems:[{cardId,name,cost}], receivedItems:[{name,photo}], receivedPortfolio,
 *          cashDirection:'none'|'paid'|'received', cashAmount, cashMethod, receiptPhoto:{src} }
 *   POST { action:'shipPhoto', secret, cardId | cardIds:[..], photo:{kind,src} }   (cardIds: one upload, applied to every card of a group)
 *   POST { action:'cardPhoto', secret, cardId, photo:{kind,src} }   -> replaces the item photo on a Cards row
 *   GET  ?action=clearPhoto&cardId=..&which=card|proof&secret=..&callback=.. -> { ok }
 *   GET  ?action=addFinance&description=..&amount=..&flow=inflow|outflow&payMethod=..&date=..&secret=..&callback=.. -> { ok, id }
 *        (a standalone Finance task: no CardID, no receipt, type "manual" — touches nothing else)
 *   GET  ?action=updateShipping&cardId=..[,..]&sched=YYYY-MM-DD|''&address=..&secret=..&callback=.. -> { ok }   (to-ship cards only)
 *   GET  ?action=events&secret=..&callback=..   -> { ok, events:[{id,date,title,time,notes}] }
 *   GET  ?action=saveEvent&eventId=..&date=YYYY-MM-DD&title=..&time=HH:mm&notes=..&secret=..&callback=.. -> { ok, id }
 *   GET  ?action=deleteEvent&eventId=..&secret=..&callback=.. -> { ok }
 *        Events are stored in a tab named "Events" (ID | Date | Title | Time | Notes) that the script creates by
 *        itself on the first saved event, so every user of the app sees the same calendar.
 *   GET  ?action=receiptImpact&receiptId=..&secret=..&callback=..  -> { ok, cards:[names], finance:[descriptions] }  (read-only preview)
 *   GET  ?action=deleteReceipt&receiptId=..&secret=..&callback=..  -> { ok, deletedCards, deletedFinance }
 *        Deletes the Receipts row, the receipt image (moved to Drive trash), every Cards row that
 *        points at that receipt (PurchaseReceiptURL or SaleReceiptURL) and every Finance row that
 *        points at it or at one of those cards. Rows are matched by the receipt's Drive file ID, and
 *        a receipt with no URL never matches anything.
 *
 *   GET  ?action=renameCard&cardId=..&name=..&secret=..&callback=..  -> { ok }   (edits ItemName only)
 *   GET  ?action=linkFinanceReceipt&financeId=..&receiptId=..|url=..&secret=..&callback=.. -> { ok }
 *   GET  ?action=unlinkFinanceReceipt&financeId=..&secret=..&callback=..  -> { ok }
 *   POST { action:'financeReceipt', secret, financeId, photo:{kind,src} }  -> uploads an image and attaches it
 *        Receipt actions only work on standalone (type \"manual\") tasks. addFinance flow may also be \"none\".
 *
 *   NOTE: no sheet columns were added for these features. Finance rows are grouped by receipt in
 *   the app using the ReceiptURL column that already exists, and standalone tasks are simply
 *   Finance rows with Type "manual" and blank CardID/ReceiptURL.
 *
 *   POST { action:'saveFinance', secret, financeId, isNew, title, notes, images:[{kind:'keep'|'link'|'upload'|'receipt', src|receiptId}],
 *          (new tasks only:) amount, flow, payMethod, date }  -> { ok, id, images }
 *        Upsert by financeId: creates a standalone task when isNew and the ID doesn't exist yet, otherwise edits
 *        Title (col E), Images (col L) and Notes (col M) of the existing row — for ANY task, including
 *        receipt-generated ones. Nothing else on the row is touched, so grouping, recording and the
 *        receipt-delete cascade keep working. Safe to retry.
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
const MAX_TASK_IMAGES = 5;

/* ---------- entry points ---------- */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
    const action = body.action || 'purchase';
    if (action === 'purchase') return json_(handlePurchase_(body));
    if (action === 'sell') return json_(handleSell_(body));
    if (action === 'trade') return json_(handleTrade_(body));
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
    if (action === 'record') return jsonpOut_(recordFinance_(e.parameter.financeId), cb);
    if (action === 'unrecord') return jsonpOut_(unrecordFinance_(e.parameter.financeId), cb);
    if (action === 'markShipped') return jsonpOut_(markShipped_(e.parameter.cardId), cb);
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
    if (action === 'events') return jsonpOut_(getEvents_(), cb);
    if (action === 'saveEvent') return jsonpOut_(saveEvent_(e.parameter), cb);
    if (action === 'deleteEvent') return jsonpOut_(deleteEvent_(e.parameter.eventId), cb);
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

  const cardRows = [], finRows = [];
  items.forEach(it => {
    let photoUrl = '';
    if (it.photo && it.photo.src) photoUrl = it.photo.kind === 'link' ? it.photo.src : saveImage_(it.photo.src, it.name, DRIVE_FOLDER_ID);
    let cardId = '';
    if (it.portfolio) {
      cardId = newId_('c');
      // ID, PurchaseDate, Seller, BoughtBy, ItemName, PurchaseCost, PurchasePayMethod, Photo, PurchaseNotes, Status,
      // SoldDate, SoldTo, SoldPrice, ShipType, ShippingMethod, ShippingFee, ShippingDeductedFrom, ShippingScheduledDate,
      // ShippedDate, ShippingProofPhoto, ShippingRecorded, PurchaseReceiptURL, SaleReceiptURL, ShipBatchID
      cardRows.push([cardId, body.date || '', body.seller || '', body.people || '', it.name || '', it.cost || 0,
        body.pay || '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false,
        receiptUrl, '', '']);
    }
    // every purchased item bills to Finance, portfolio or not
    finRows.push([newId_('f'), cardId, 'purchase', body.date || '', it.name || '(unnamed item)', it.cost || 0, body.pay || '', false, '', receiptUrl, 'outflow']);
  });
  appendRows_(cards, cardRows);
  appendRows_(fin, finRows);
  return { ok: true };
}

function handleSell_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  const list = body.items || [];
  if (!list.length) return { ok: true };
  ensureCardsColumns_(cards);
  const noShip = body.shipType === 'none';
  const address = String(body.shipAddress || '').trim().slice(0, 500);
  const packaging = Number(body.packaging) || 0;
  const perFee = list.length ? (Number(body.shipFee) || 0) / list.length : 0;
  const batchId = newId_('b');

  let receiptUrl = '';
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = saveImage_(body.receiptPhoto.src, 'sold-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) receiptsSheet_().appendRow([newId_('rc'), 'sale', body.date || todayStr_(), receiptUrl, 'Sale to ' + (body.buyer || '\u2014')]);
  }

  const rowOf = rowIndex_(cards), finRows = [];
  list.forEach(it => {
    const found = rowOf[String(it.cardId)] ? { idx: rowOf[String(it.cardId)] } : null;
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
    cards.getRange(found.idx, 24, 1, 2).setValues([[batchId, address]]); // ShipBatchID, ShippingAddress (cols X-Y)
    // the sale amount itself bills to Finance right away (as an inflow), separate from the
    // shipping-fee entry, which is only created later once the whole batch is marked shipped
    finRows.push([newId_('f'), it.cardId, 'sale', body.date || '', 'Sale: ' + (it.name || '(unnamed item)'), Number(it.cost) || 0, body.pay || '', false, '', receiptUrl, 'inflow']);
  });
  // packaging the buyer paid for is part of "total received": one inflow row for the whole receipt
  // (no CardID; it is still removed with the receipt because it carries the same ReceiptURL)
  if (packaging > 0) {
    finRows.push([newId_('f'), '', 'sale', body.date || '', 'Packaging: sale to ' + (body.buyer || '\u2014'), packaging, body.pay || '', false, '', receiptUrl, 'inflow']);
  }
  // shipping the buyer paid us ("care of buyer") is money received too, so it is part of the total to
  // record: one inflow row per receipt. The matching outflow row (what we pay the courier) is still
  // created later, when the batch is marked shipped. Care of us / no shipping receive nothing.
  const buyerShipping = body.shipType === 'buyer' ? (Number(body.shipFee) || 0) : 0;
  if (buyerShipping > 0) {
    finRows.push([newId_('f'), '', 'sale', body.date || '', 'Shipping paid by buyer: sale to ' + (body.buyer || '\u2014'), buyerShipping, body.pay || '', false, '', receiptUrl, 'inflow']);
  }
  appendRows_(fin, finRows);
  return { ok: true };
}

// Proof of shipment for one card, or (cardIds) for every card of a grouped shipping task:
// the image is uploaded once and the same URL is written to each card.
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

// A trade moves items in both directions with no sale price on either side:
// items given away are marked "traded" on Cards (reusing the Sold* columns to
// hold TradedDate/TradedWith/TradeValue instead, since a traded card never
// goes through shipping); items received optionally become new onhand Cards
// (one "record to portfolio" checkbox governs ALL received items, never
// per-item); and any cash that changed hands as part of the trade bills to
// Finance as a single entry, tagged with the direction it flowed.
function handleTrade_(body) {
  const cards = cardsSheet_(), fin = financeSheet_();
  const tradedItems = body.tradedItems || [];
  const receivedItems = body.receivedItems || [];
  if (!tradedItems.length && !receivedItems.length) return { ok: true };

  const partyLabel = body.tradedTo || body.tradedBy || '\u2014';
  let receiptUrl = '';
  if (body.receiptPhoto && body.receiptPhoto.src) {
    receiptUrl = saveImage_(body.receiptPhoto.src, 'trade-receipt-' + (body.date || todayStr_()) + '-' + newId_('r'), RECEIPT_FOLDER_ID);
    if (receiptUrl) receiptsSheet_().appendRow([newId_('rc'), 'trade', body.date || todayStr_(), receiptUrl, 'Trade with ' + partyLabel]);
  }

  // Items given away: mark the existing Cards row "traded". SoldDate/SoldTo/SoldPrice
  // hold TradedDate/TradedWith/TradeValue and SaleReceiptURL holds the trade receipt —
  // safe to reuse since a traded card never carries real sale/shipping data.
  tradedItems.forEach(it => {
    const found = findRow_(cards, it.cardId);
    if (!found) return;
    cards.getRange(found.idx, 10, 1, 1).setValue('traded'); // Status (col J)
    cards.getRange(found.idx, 11, 1, 3).setValues([[body.date || '', body.tradedTo || '', Number(it.cost) || 0]]); // SoldDate/SoldTo/SoldPrice (K-M)
    cards.getRange(found.idx, 23, 1, 1).setValue(receiptUrl); // SaleReceiptURL (col W)
  });

  // Items received: one checkbox (receivedPortfolio) decides whether ALL of them
  // become new onhand Cards, at zero purchase cost (a trade has no per-item price).
  if (body.receivedPortfolio) {
    receivedItems.forEach(it => {
      let photoUrl = '';
      if (it.photo && it.photo.src) photoUrl = it.photo.kind === 'link' ? it.photo.src : saveImage_(it.photo.src, it.name, DRIVE_FOLDER_ID);
      cards.appendRow([newId_('c'), body.date || '', body.tradedTo || '', body.tradedBy || '', it.name || '', 0,
        '', photoUrl, body.notes || '', 'onhand', '', '', '', '', '', '', '', '', '', '', false,
        receiptUrl, '', '']);
    });
  }

  // Any cash paid or received as part of the trade bills to Finance as one entry
  // (not per item), so it shows up in the finance to-do list like any other billable event.
  const amt = Number(body.cashAmount) || 0;
  if ((body.cashDirection === 'paid' || body.cashDirection === 'received') && amt > 0) {
    const names = tradedItems.map(i => i.name).concat(receivedItems.map(i => i.name)).filter(Boolean).join(', ');
    const flow = body.cashDirection === 'received' ? 'inflow' : 'outflow';
    const desc = (body.cashDirection === 'received' ? 'Cash received \u2014 trade with ' : 'Cash paid \u2014 trade with ') + partyLabel + (names ? ' (' + names + ')' : '');
    fin.appendRow([newId_('f'), '', 'trade', body.date || '', desc, amt, body.cashMethod || '', false, '', receiptUrl, flow]);
  } else {
    // No cash changed hands — still surface the trade in Finance as a task to tick off,
    // so every trade receipt has an entry there (flow "none" = no money moved).
    const names = tradedItems.map(i => i.name).concat(receivedItems.map(i => i.name)).filter(Boolean).join(', ');
    fin.appendRow([newId_('f'), '', 'trade', body.date || '', 'Trade with ' + partyLabel + ' (no cash)' + (names ? ' \u2014 ' + names : ''), 0, '', false, '', receiptUrl, 'none']);
  }

  return { ok: true };
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

// Finance needs columns L (Images) and M (Notes). Older sheets don't have them; add on first use.
function ensureFinanceColumns_(fin) {
  const need = 13;
  if (fin.getMaxColumns() < need) fin.insertColumnsAfter(fin.getMaxColumns(), need - fin.getMaxColumns());
  const h = fin.getRange(1, 12, 1, 2).getValues()[0];
  if (!h[0]) fin.getRange(1, 12, 1, 1).setValue('Images');
  if (!h[1]) fin.getRange(1, 13, 1, 1).setValue('Notes');
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
  // flow "none" = a reminder with no money moving: amount and pay method are forced blank
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
  const plan = { rSheet, receiptIdx: rFound.idx, rawUrl, key, cards: [], finance: [] };
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
  return { ok: true, cards: plan.cards.map(c => c.name), finance: plan.finance.map(f => f.description) };
}

function deleteReceipt_(receiptId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // row numbers are only valid if nothing else writes while we delete
  try {
    const plan = planReceiptDelete_(receiptId);
    if (plan.error) return { ok: false, error: plan.error };
    // sheets are opened once (opening the spreadsheet per row was the slow part), and neighbouring
    // rows go in a single deleteRows call
    deleteRowsBatch_(financeSheet_(), plan.finance.map(f => f.idx));
    deleteRowsBatch_(cardsSheet_(), plan.cards.map(c => c.idx));
    plan.rSheet.deleteRow(plan.receiptIdx);
    // the image itself goes to the Drive trash (recoverable there); never fail the delete over it
    try {
      const m = plan.rawUrl.match(/[-\w]{25,}/);
      if (m) DriveApp.getFileById(m[0]).setTrashed(true);
    } catch (err) {}
    return { ok: true, deletedCards: plan.cards.length, deletedFinance: plan.finance.length };
  } finally {
    lock.releaseLock();
  }
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

// cardId may hold several comma-separated IDs (a grouped shipping task). Every card is validated
// first, then all are marked, and each batch's Finance entry is created once at the end.
function markShipped_(cardId) {
  const ids = splitIds_(cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const cards = cardsSheet_();
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  const today = todayStr_(), batches = {};
  founds.forEach(f => {
    cards.getRange(f.idx, 10, 1, 1).setValue('shipped');
    cards.getRange(f.idx, 19, 1, 1).setValue(today);
    if (f.row[23]) batches[String(f.row[23])] = true;
  });
  Object.keys(batches).forEach(b => maybeCreateBatchFinance_(b));
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
  if (finRows.some(f => f.row[7] === true)) {
    return { ok: false, error: 'Its Finance entry is already recorded \u2014 unrecord it first, then revert.' };
  }
  founds.forEach(f => {
    cards.getRange(f.idx, 10, 1, 1).setValue('shipping');
    cards.getRange(f.idx, 19, 1, 1).setValue('');
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
  if (found.row[20] === true) return { ok: false, error: 'Its shipping fee is already recorded in Finance \u2014 unrecord it first.' };
  const batchId = found.row[23];
  cards.getRange(found.idx, 10, 1, 1).setValue('onhand');           // Status
  cards.getRange(found.idx, 11, 1, 10).setValues([['', '', '', '', '', '', '', '', '', false]]); // SoldDate..ShippingRecorded (K-U)
  ensureCardsColumns_(cards);
  cards.getRange(found.idx, 23, 1, 3).setValues([['', '', '']]);    // SaleReceiptURL, ShipBatchID, ShippingAddress
  if (batchId) {
    const rows = cards.getDataRange().getValues();
    const stillInBatch = rows.slice(1).some(r => r[23] === batchId && r[0] !== cardId);
    if (!stillInBatch) {
      findShippingFinance_(fin, [batchId, cardId]).filter(f => f.row[7] !== true)
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
// for a multi-card shipment, or the card's own ID for a single-card one. (Column A is the row's own ID,
// so findRow_ can't be used for this.) Returns [{ idx, row }].
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
  if (findShippingFinance_(fin, [batchId, group[0][0]]).length) return; // already created for this batch
  const totalFee = group.reduce((a, r) => a + (Number(r[15]) || 0), 0);
  const names = group.map(r => r[4]).join(', ');
  const payMethod = group[0][16] || '';
  const receiptUrl = group[0][22] || '';
  const idField = group.length > 1 ? batchId : group[0][0];
  fin.appendRow([newId_('f'), idField, 'shipping', todayStr_(), 'Shipping for ' + names, totalFee, payMethod, false, '', receiptUrl, 'outflow']);
}

/* ---------- shipping edits + shared calendar events ---------- */

// Edit the scheduled date (col R) and/or address (col Y) of every card in a shipping task.
// Only the params that are present are changed; sched='' clears the date. Cards must still be to-ship.
function updateShipping_(p) {
  const ids = splitIds_(p.cardId);
  if (!ids.length) return { ok: false, error: 'missing cardId' };
  const hasSched = Object.prototype.hasOwnProperty.call(p, 'sched');
  const hasAddr = Object.prototype.hasOwnProperty.call(p, 'address');
  if (!hasSched && !hasAddr) return { ok: false, error: 'nothing to change' };
  const sched = String(p.sched || '').trim();
  if (hasSched && sched && !/^\d{4}-\d{2}-\d{2}$/.test(sched)) return { ok: false, error: 'invalid date' };
  const cards = cardsSheet_();
  ensureCardsColumns_(cards);
  const founds = ids.map(id => findRow_(cards, id));
  if (founds.some(f => !f)) return { ok: false, error: 'not found' };
  if (founds.some(f => f.row[9] !== 'shipping')) return { ok: false, error: 'only cards still to ship can be edited' };
  const address = String(p.address || '').trim().slice(0, 500);
  founds.forEach(f => {
    if (hasSched) cards.getRange(f.idx, 18, 1, 1).setValue(sched);   // ShippingScheduledDate (col R)
    if (hasAddr) cards.getRange(f.idx, 25, 1, 1).setValue(address);  // ShippingAddress (col Y)
  });
  return { ok: true };
}

// Calendar events live in their own "Events" tab (created on first save), so they are shared by everyone
// who uses the app. Columns: ID | Date | Title | Time | Notes. Everything is stored as text.
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

/* ---------- reads ---------- */

function getPortfolio_() {
  const rows = cardsSheet_().getDataRange().getValues(); rows.shift();
  const rmap = receiptMap_();
  const owned = [], sold = [];
  rows.forEach(r => {
    if (!r[4]) return;
    const status = r[9] || 'onhand';
    const tag = status === 'onhand' ? 'onhand'
      : status === 'shipping' ? 'shipping'
      : status === 'traded' ? 'traded'
      : (r[20] === true ? 'sold' : 'shipped');
    const item = {
      id: r[0], name: r[4], photo: toDisplayUrl_(r[7]),
      purchaseDate: fmtDateCell_(r[1]), purchaseCost: Number(r[5]) || 0,
      tag, soldDate: fmtDateCell_(r[10]), soldPrice: Number(r[12]) || 0,
      purchaseReceipt: r[21] || '', saleReceipt: r[22] || '',
      receipts: receiptLinks_(r[21], r[22], rmap)
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
  const rmap = receiptMap_();
  const toRecord = [], recorded = [];
  rows.forEach(r => {
    if (!r[0]) return;
    const key = fileKey_(r[9]);
    const rc = key ? rmap[key] : null;
    const item = { id: r[0], date: fmtDateCell_(r[3]), description: r[4], amount: Number(r[5]) || 0, payMethod: r[6], receipt: r[9] || '', flow: r[10] || 'outflow',
      type: r[2] || '', groupKey: key,
      notes: r[12] || '',
      images: taskImages_(r).map(u => ({ raw: u, thumb: toDisplayUrl_(u, 300), full: toDisplayUrl_(u, 1080) })),
      groupType: rc ? rc.type : '', groupLabel: rc ? rc.description : '', groupDate: rc ? rc.date : '' };
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
      saleReceipt: r[22] || '',
      address: r[24] || '',
      // cards that came from one sale receipt share a key, so the app can show them as one task
      groupKey: fileKey_(r[22]) || (r[23] ? 'b:' + r[23] : 'c:' + r[0])
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

// "a,b,c" -> ['a','b','c'] (blank entries dropped)
function splitIds_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

// Cards needs column Y (ShippingAddress). Older sheets stop at X; add it on first use.
function ensureCardsColumns_(cards) {
  const need = 25;
  if (cards.getMaxColumns() < need) cards.insertColumnsAfter(cards.getMaxColumns(), need - cards.getMaxColumns());
  if (!cards.getRange(1, need).getValue()) cards.getRange(1, need).setValue('ShippingAddress');
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

// fileKey -> { id, type, date, description } for every row in Receipts
function receiptMap_() {
  const map = {};
  const sheet = receiptsSheet_();
  if (!sheet) return map;
  const rows = sheet.getDataRange().getValues(); rows.shift();
  rows.forEach(r => {
    const k = fileKey_(r[3]);
    if (r[0] && k) map[k] = { id: r[0], type: r[1] || '', date: fmtDateCell_(r[2]), description: r[4] || '' };
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
