/* ---------- Auction details, shared by Portfolio and Commercial ----------
   A card tagged as auction can carry: start, end, starting bid, bid increment and the auction link (Code.gs setAuction, Cards AI-AM).
   Tapping an auction card opens a read-only view of these details with a "View link" button (the link is never opened by tapping the card);
   Edit changes them. The sheets are built here, so a page only needs this file after net.js and config.js.
     CVAuction.has(card)        any detail saved
     CVAuction.line(card)       small summary line for the card (html, no link)
     CVAuction.open(card, ctx)  auction card -> details view; untagged card -> "Tag as auction" sheet
     CVAuction.edit(card, ctx)  the edit / tag sheet
     CVAuction.save(ids, on, d) tag or untag cards (d = { start, end, bid, step, link }); untagging clears the details
     CVAuction.warn(card)       confirmation text before the tag (and its details) is removed
   ctx = { toast(message), reload() } */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const php = n => 'PHP ' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const when = v => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/); if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + (m[4] == null ? '' : ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  };
  const safe = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const has = c => !!(c && (c.auctionStart || c.auctionEnd || safe(c.auctionLink) || num(c.auctionBid) || num(c.auctionStep)));

  function line(c) {
    if (!c || !c.auction || !has(c)) return '';
    const s = when(c.auctionStart), e = when(c.auctionEnd), parts = [];
    if (s && e) parts.push(s.replace(/, \d{4}/, '') + ' \u2192 ' + e.replace(/, \d{4}/, '')); else if (s) parts.push('Starts ' + s.replace(/, \d{4}/, '')); else if (e) parts.push('Ends ' + e.replace(/, \d{4}/, ''));
    if (num(c.auctionBid)) parts.push('Start bid ' + php(c.auctionBid));
    if (num(c.auctionStep)) parts.push('+' + php(c.auctionStep) + ' per bid');
    return `<span class="port-held auc-line">Auction${parts.length ? ' \u00b7 ' + esc(parts.join(' \u00b7 ')) : ''}</span>`;
  }
  const warn = c => `Remove the auction tag from "${c.name}"?\n\nIts auction details (${[c.auctionStart && 'start', c.auctionEnd && 'end', num(c.auctionBid) && 'starting bid', num(c.auctionStep) && 'increment', safe(c.auctionLink) && 'link'].filter(Boolean).join(', ')}) will be deleted.`;

  async function save(ids, on, d) {
    for (let i = 0; i < ids.length; i += 25) {
      const p = { cardIds: ids.slice(i, i + 25).join(','), on: on ? '1' : '0' };
      if (on && d) Object.assign(p, { start: d.start || '', end: d.end || '', bid: d.bid || '', step: d.step || '', link: d.link || '' });
      const url = CONFIG.portfolio.endpoint + '?action=setAuction' + Object.keys(p).map(k => '&' + k + '=' + encodeURIComponent(p[k])).join('') + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
      const res = await jsonp(url);
      if (!res.ok) throw new Error(res.error === 'unknown action' ? 'Code.gs needs the latest version deployed' : (res.error || 'Request failed'));
    }
  }

  /* ---- the two sheets, built on first use ---- */
  let built = false, cur = null, ctx = {};
  const $ = id => document.getElementById(id);
  function build() {
    if (built) return; built = true;
    const st = document.createElement('style');
    st.textContent = '.auc-dl{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:13px;margin:0 0 6px}.auc-dl dt{color:var(--mut)}.auc-dl dd{margin:0;font-weight:500;text-align:right;overflow-wrap:anywhere}'
      + '.auc-go{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.auc-go[hidden]{display:none}';
    document.head.appendChild(st);
    const box = document.createElement('div');
    box.innerHTML = `
<div class="modal" id="aucView" hidden><div class="sheet small wide">
  <h3>Auction details</h3>
  <p class="stub-note" id="aucVName" style="margin:-6px 0 14px;font-size:12px;text-align:center"></p>
  <dl class="auc-dl" id="aucVBody"></dl>
  <div class="acts">
    <a class="go sm auc-go" id="aucVLink" href="#" target="_blank" rel="noopener noreferrer">View link</a>
    <button type="button" class="ghost" id="aucVEdit">Edit</button>
    <button type="button" class="ghost" id="aucVClose">Close</button>
  </div>
</div></div>
<div class="modal" id="aucSheet" hidden><div class="sheet small wide">
  <h3 id="aucTitle">Auction details</h3>
  <p class="stub-note" id="aucSub" style="margin:-6px 0 14px;font-size:12px;text-align:center"></p>
  <div class="field"><label for="aucStart">Auction start <small>(optional)</small></label><input type="datetime-local" id="aucStart"></div>
  <div class="field"><label for="aucEnd">Auction end <small>(optional)</small></label><input type="datetime-local" id="aucEnd"></div>
  <div class="field"><label>Bidding <small>(optional, PHP)</small></label>
    <div class="so-plan"><input type="number" id="aucBid" inputmode="decimal" min="0" step="any" placeholder="Starting bid" aria-label="Starting bid"><input type="number" id="aucStep" inputmode="decimal" min="0" step="any" placeholder="Increment" aria-label="Bid increment"></div>
  </div>
  <div class="field"><label for="aucLink">Auction link <small>(optional)</small></label><input type="url" id="aucLink" inputmode="url" autocomplete="off" maxlength="500" placeholder="https://"></div>
  <div class="acts">
    <button type="button" class="go sm" id="aucSave">Save</button>
    <button type="button" class="ghost danger" id="aucRemove" hidden>Remove auction tag</button>
    <button type="button" class="ghost" id="aucCancel">Cancel</button>
  </div>
</div></div>`;
    while (box.firstChild) document.body.appendChild(box.firstChild);
    $('aucVClose').onclick = closeView; $('aucCancel').onclick = closeEdit;
    ['aucView', 'aucSheet'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) { id === 'aucView' ? closeView() : closeEdit(); } }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('aucSheet').hidden) closeEdit(); else if (!$('aucView').hidden) closeView(); } });
    $('aucVEdit').onclick = () => { const c = cur; closeView(); if (c) edit(c, ctx); };
    $('aucSave').onclick = async () => {
      const c = cur; if (!c) return;
      const start = $('aucStart').value, end = $('aucEnd').value, link = $('aucLink').value.trim(), bid = $('aucBid').value.trim(), step = $('aucStep').value.trim();
      if (start && end && end < start) return say('The auction cannot end before it starts.');
      if ((bid && !(Number(bid) >= 0)) || (step && !(Number(step) >= 0))) return say('Bid and increment must be zero or more.');
      if (link && !/^https?:\/\//i.test(link)) return say('The link must start with http:// or https://');
      const b = $('aucSave'), label = b.textContent; b.disabled = true; b.textContent = 'Saving\u2026';
      try { await save([c.id], true, { start, end, link, bid, step }); const was = c.auction; closeEdit(); say(was ? 'Auction details saved.' : 'Tagged as auction.'); if (ctx.reload) await ctx.reload(); }
      catch (err) { say('Could not save: ' + err.message); }
      b.disabled = false; b.textContent = label;
    };
    $('aucRemove').onclick = async () => {
      const c = cur; if (!c) return;
      if (has(c) && !confirm(warn(c))) return;   // details exist: ask before throwing them away
      const b = $('aucRemove'); b.disabled = true;
      try { await save([c.id], false); closeEdit(); say('Auction tag removed.'); if (ctx.reload) await ctx.reload(); }
      catch (err) { say('Could not update: ' + err.message); }
      b.disabled = false;
    };
  }
  const say = m => { if (ctx.toast) ctx.toast(m); };
  const closeView = () => { if ($('aucView')) $('aucView').hidden = true; };
  const closeEdit = () => { if ($('aucSheet')) $('aucSheet').hidden = true; };

  function view(c, x) {
    build(); cur = c; ctx = x || ctx;
    $('aucVName').textContent = c.name || '';
    const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
    $('aucVBody').innerHTML = row('Starts', esc(when(c.auctionStart))) + row('Ends', esc(when(c.auctionEnd))) + row('Starting bid', num(c.auctionBid) ? esc(php(c.auctionBid)) : '') + row('Bid increment', num(c.auctionStep) ? esc(php(c.auctionStep)) : '')
      || '';
    if (!$('aucVBody').innerHTML) $('aucVBody').innerHTML = '<dt style="grid-column:1/-1;text-align:center">No details yet. Tap Edit to add them.</dt>';
    const a = $('aucVLink'); a.hidden = !safe(c.auctionLink); if (safe(c.auctionLink)) a.href = c.auctionLink;
    $('aucView').hidden = false;
  }
  function edit(c, x) {
    build(); cur = c; ctx = x || ctx;
    $('aucTitle').textContent = c.auction ? 'Edit auction details' : 'Tag as auction';
    $('aucSub').textContent = c.name || '';
    $('aucStart').value = String(c.auctionStart || '').slice(0, 16); $('aucEnd').value = String(c.auctionEnd || '').slice(0, 16);
    $('aucBid').value = num(c.auctionBid) || ''; $('aucStep').value = num(c.auctionStep) || ''; $('aucLink').value = c.auctionLink || '';
    $('aucRemove').hidden = !c.auction; $('aucSave').textContent = c.auction ? 'Save' : 'Tag as auction';
    $('aucSheet').hidden = false; $('aucStart').focus();
  }
  const open = (c, x) => { if (!c) return; if (c.auction) view(c, x); else edit(c, x); };

  window.CVAuction = { has, line, open, edit, save, warn };
})();
