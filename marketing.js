/* ---------- Marketing — who we buy from / sell to / trade with the most, and the saved entities (profiles) behind them ---------- */
const mkPhp = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escMk = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $m = id => document.getElementById(id);

const KIND = {
  buy:   { sum: 'Total bought', noun: 'seller', empty: 'No purchases on record yet.' },
  sell:  { sum: 'Total sold', noun: 'buyer', empty: 'No sales on record yet.' },
  trade: { sum: 'Total traded', noun: 'trade partner', empty: 'No trades on record yet.' }
};
let mkTab = 'rank', mkKind = 'buy';
let data = { entities: [], tx: [] };   // tx: [entityName, kind, date, value, dir]  (dir: 'in' | 'out' on trades)
let mkFirst = true;
const normData = d => ({ tx: d.tx || [], entities: (d.entities || []).map(e => Object.assign({ contact: '', address: '', email: '', facebook: '', notes: '' }, e, { aliases: e.aliases || [], payment: e.payment || [], profile: e.profile || {} })) });
const fbUrl = v => { v = String(v || '').trim(); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''); };

function toast(m) {
  const t = $m('mkToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}
function fmtDay(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);

/* ---------- Profile extras (photo, gender, nickname, manual flags, blacklist) and the details toggle.
   Saved in the Entities sheet (column K) and the profile photos in the Drive folder, so every device and teammate sees the same profile.
   This device keeps a copy (keyed by entity id) so the page still shows them offline. ---------- */
const PROF_KEY = 'trackello.entProfiles', DET_KEY = 'trackello.entDetails';
let prof = {};
try { prof = JSON.parse(localStorage.getItem(PROF_KEY) || '{}') || {}; } catch (_) { prof = {}; }
let showDetails = true;
try { showDetails = localStorage.getItem(DET_KEY) !== '0'; } catch (_) {}
const profOf = id => Object.assign({ g: '', pic: '', n: '', fc: '', fs: '', bl: false, blr: '' }, prof[id]);
// patch = only the fields to change; a profile with nothing left in it is dropped
function setProf(id, patch) {
  if (!id) return true;
  const p = Object.assign(profOf(id), patch);
  if (!p.g && !p.pic && !p.n && !p.fc && !p.fs && !p.bl) delete prof[id];
  else prof[id] = { g: p.g, pic: p.pic, n: p.n, fc: p.fc, fs: p.fs, bl: !!p.bl, blr: p.bl ? p.blr : '' };
  try { localStorage.setItem(PROF_KEY, JSON.stringify(prof)); return true; } catch (_) { return false; }
}
function clearProf(id) { delete prof[id]; try { localStorage.setItem(PROF_KEY, JSON.stringify(prof)); } catch (_) {} }

// What goes to the sheet. A photo that is still a raw upload (data:) is sent separately (see uploadPhoto).
const profPayload = p => ({ g: p.g, n: p.n, fc: p.fc, fs: p.fs, bl: !!p.bl, blr: p.bl ? p.blr : '', pic: /^data:/.test(p.pic || '') ? '' : (p.pic || '') });
const profEmpty = p => !p || !Object.keys(p).length;
// The sheet is the source of truth: an entity that has a saved profile there replaces this device's copy.
function adoptServerProfiles() {
  (data.entities || []).forEach(e => {
    const sp = e.profile;
    if (profEmpty(sp)) return;
    const local = prof[e.id] || {};
    // keep a not-yet-uploaded local photo until it reaches Drive
    const pic = /^data:/.test(local.pic || '') && !sp.pic ? local.pic : (sp.pic || '');
    prof[e.id] = { g: sp.g || '', pic, n: sp.n || '', fc: sp.fc || '', fs: sp.fs || '', bl: !!sp.bl, blr: sp.bl ? (sp.blr || '') : '' };
  });
  try { localStorage.setItem(PROF_KEY, JSON.stringify(prof)); } catch (_) {}
}
async function postJson(body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const res = await fetch(CONFIG.portfolio.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ secret: CONFIG.portfolio.secret }, body)), signal: ctl.signal });
    return await res.json();
  } finally { clearTimeout(timer); }
}
// Upload a cropped photo to the Drive folder; the sheet then holds its link.
async function uploadPhoto(entityId, dataUrl) {
  const res = await postJson({ action: 'entityPhoto', entityId, photo: dataUrl });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Upload failed');
  return res.pic;
}
// One-time, automatic: profiles that only exist on this device (saved before this update, or when offline) are copied to the sheet / Drive.
let migrating = false;
async function migrateLocalProfiles() {
  if (migrating || !CONFIG.portfolio.endpoint) return;
  migrating = true;
  let moved = 0;
  try {
    for (const e of data.entities) {
      const p = prof[e.id]; if (!p) continue;
      try {
        if (profEmpty(e.profile)) {
          const res = await jsonp(api('saveEntity', entParams(e, { profile: JSON.stringify(profPayload(p)) })), 60000);
          if (!res.ok) throw new Error(res.error || 'Request failed');
          e.profile = profPayload(p); moved++;
        }
        if (/^data:/.test(p.pic || '')) {
          const url = await uploadPhoto(e.id, p.pic);
          setProf(e.id, { pic: url }); e.profile = Object.assign({}, e.profile, { pic: url }); moved++;
        }
      } catch (err) { console.warn('Profile sync failed for', e.name, err); }
    }
  } finally { migrating = false; }
  if (moved) { cacheSet('entities', data); renderAll(); toast('Profiles saved to your Drive and sheet.'); }
}

/* Blank profile pictures: neutral, male, female. */
const AV_SVG = {
  n: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="11"/><path d="M10 64c0-14 9-22 22-22s22 8 22 22z"/></svg>',
  m: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="27" y="32" width="10" height="12" rx="3"/><circle cx="32" cy="22" r="11"/><path d="M4 64c0-13 11-21 28-21s28 8 28 21z"/></svg>',
  f: '<svg viewBox="0 0 64 64" aria-hidden="true"><path class="hair" d="M18 28c0-12 6-19 14-19s14 7 14 19v13c0 3-2 5-5 5H23c-3 0-5-2-5-5z"/><circle cx="32" cy="24" r="10.5"/><path d="M12 64c0-13 8-20 20-20s20 7 20 20z"/></svg>'
};
const avatarRaw = (pic, g, size) => `<span class="av av-${size} g-${g || 'n'}">${AV_SVG[g || 'n']}${pic ? `<img src="${escMk(pic)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
const avatar = (e, size) => { const p = e ? profOf(e.id) : {}; return avatarRaw(p.pic, p.g, size); };
/* real name first, nickname as small text after it */
const nickOf = e => (e && profOf(e.id).n) || '';
const nameHtml = e => `${escMk(e.name)}${nickOf(e) ? ` <small class="pf-nick">\u201c${escMk(nickOf(e))}\u201d</small>` : ''}`;
// a picture that fails to load (bad link) falls back to the blank profile underneath
document.addEventListener('error', ev => { const t = ev.target; if (t && t.tagName === 'IMG' && t.closest('.av')) t.remove(); }, true);

/* ---------- numbers: per entity, per kind, optionally inside a date range ---------- */
function aggregate(lo, hi) {
  const by = {};
  const blank = () => ({ n: 0, v: 0, last: '', nIn: 0, vIn: 0, nOut: 0, vOut: 0 });
  data.entities.forEach(e => by[e.name] = { buy: blank(), sell: blank(), trade: blank() });
  data.tx.forEach(([name, kind, date, value, dir]) => {
    const d = String(date || '').slice(0, 10);
    if ((lo || hi) && (!d || (lo && d < lo) || (hi && d > hi))) return;
    const a = by[name] && by[name][kind];
    if (!a) return;
    const v = Number(value) || 0;
    a.n++; a.v += v;
    if (kind === 'trade') { if (dir === 'in') { a.nIn++; a.vIn += v; } else if (dir === 'out') { a.nOut++; a.vOut += v; } }
    if (d > a.last) a.last = d;
  });
  return by;
}
// trades are split into cards given (out) and cards received (in); older Code.gs has no direction, so fall back to one total
const hasSplit = a => a.n > 0 && a.nIn + a.nOut === a.n;
const entByName = name => data.entities.find(e => e.name === name);

/* ---------- Automatic flags (a manual choice on the profile always wins) ----------
   Customers use sales only; suppliers use purchases only; trades are not counted.
   An "order" is one day with sales (or purchases), however many cards moved that day. */
const CF = { hero: ['Hero', 'gold'], loyal: ['Loyalist', 'green'], pot: ['Potential Loyalist', 'blue'], new: ['New', 'teal'], sleep: ['Sleeper', 'purple'], cold: ['Cold', 'grey'] };
const SF = { goto: ['Go-to Source', 'gold'], bulk: ['Bulk Deals', 'blue'], rare: ['Rare-Find Holder', 'purple'], occ: ['Occasional', 'grey'] };
const dayNum = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; };
const todayNum = () => { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y), i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
let flagSrc = null, flagVal = null;
function autoFlags() {
  if (flagSrc === data && flagVal) return flagVal;
  const today = todayNum(), cust = {}, supp = {};
  data.tx.forEach(([name, kind, date, value]) => {
    if (kind !== 'sell' && kind !== 'buy') return;
    const bag = kind === 'sell' ? cust : supp;
    const o = bag[name] || (bag[name] = { v: 0, n: 0, days: new Set() });
    o.v += Number(value) || 0; o.n++;
    const d = dayNum(date); if (d !== null) o.days.add(d);
  });
  const C = {}, S = {};
  const cNames = Object.keys(cust), lvs = cNames.map(n => cust[n].v);
  const med = pct(lvs, 0.5), heroCut = pct(lvs, 0.9);
  cNames.forEach(n => {
    const o = cust[n], ds = Array.from(o.days).sort((a, b) => a - b), orders = ds.length;
    if (!orders) return;
    const first = ds[0], last = ds[orders - 1], since = today - last, age = today - first;
    const gap = orders > 1 ? (last - first) / (orders - 1) : 0;
    const lapsed = since > Math.max(21, 2 * gap);
    const base = `${plural(orders, 'order')}, ${mkPhp(o.v)}, last order ${since} days ago`;
    let key = '', why = '';
    if (o.v > 0 && o.v >= heroCut && orders >= 2 && lapsed && since <= 180) { key = 'hero'; why = `Top 10% spender: ${base}${gap ? ` (usually orders every ~${Math.round(gap)} days)` : ''}`; }
    else if (orders >= 3 && !lapsed) { key = 'loyal'; why = `Regular buyer: ${base}`; }
    else if (orders <= 2 && since <= 30 && o.v >= med) { key = 'pot'; why = `Recent buyer who spent well: ${base}`; }
    else if (age <= 30) { key = 'new'; why = `First order ${age} days ago, ${mkPhp(o.v)} so far`; }
    else if (orders >= 2 && since > 45) { key = 'sleep'; why = `Used to buy: ${base}`; }
    else if (orders === 1 && since > 90 && o.v < med) { key = 'cold'; why = `One small order, ${since} days ago (${mkPhp(o.v)})`; }
    if (key) C[n] = { key, why };
  });
  const sNames = Object.keys(supp);
  const spendCut = pct(sNames.map(n => supp[n].v), 0.75), unitCut = pct(sNames.map(n => supp[n].v / supp[n].n), 0.5);
  sNames.forEach(n => {
    const o = supp[n], orders = o.days.size, unit = o.v / o.n;
    const hiSpend = o.v > 0 && o.v >= spendCut, hiUnit = unit >= unitCut;
    const base = `${mkPhp(o.v)} over ${plural(orders, 'order')}, ${plural(o.n, 'card')} at about ${mkPhp(unit)} each`;
    let key = '', why = '';
    if (hiSpend && hiUnit && orders >= 2) { key = 'goto'; why = `High spend, premium cards, repeat supplier: ${base}`; }
    else if (hiSpend && !hiUnit) { key = 'bulk'; why = `High spend on lower-priced cards: ${base}`; }
    else if (hiUnit) { key = 'rare'; why = `Premium cards, low spend or a single order: ${base}`; }
    else { key = 'occ'; why = `Small, occasional buys: ${base}`; }
    S[n] = { key, why };
  });
  flagSrc = data;
  return flagVal = { C, S, th: { nCust: cNames.length, nSupp: sNames.length, med, heroCut, spendCut, unitCut } };
}
// effective flag = manual choice if there is one, otherwise the automatic one
function flagsOf(e) {
  const A = autoFlags(), p = profOf(e.id);
  const pick = (ov, auto, defs) => {
    if (ov === 'none') return null;
    if (ov && defs[ov]) return { key: ov, manual: true, why: 'Set manually. ' + (auto ? 'Automatic would be ' + defs[auto.key][0] + '.' : 'No automatic flag.') };
    return auto ? { key: auto.key, manual: false, why: auto.why } : null;
  };
  return { c: pick(p.fc, A.C[e.name], CF), s: pick(p.fs, A.S[e.name], SF), bl: p.bl ? (p.blr || 'No reason given') : '' };
}
const flChip = (f, defs, title) => `<span class="fl fl-${defs[f.key][1]}" title="${escMk(title === undefined ? f.why : title)}">${defs[f.key][0]}</span>`;
// which: 'c' customer only, 's' supplier only, '' neither (Blacklisted always shows)
function flagChips(e, which) {
  const x = flagsOf(e), out = [];
  if (x.bl) out.push(`<span class="fl fl-red" title="${escMk(x.bl)}">Blacklisted</span>`);
  if (which !== 's' && which !== '' && x.c) out.push(flChip(x.c, CF));
  if (which === 's' && x.s) out.push(flChip(x.s, SF));
  if (which === 'both') { if (x.s) out.push(flChip(x.s, SF)); }
  return out.join('');
}
const flagLabels = e => { const x = flagsOf(e); return [x.c && CF[x.c.key][0], x.s && SF[x.s.key][0], x.bl && 'blacklisted blacklist'].filter(Boolean).join(' '); };

/* ---------- Rankings ---------- */
function renderRank() {
  let lo = $m('mkFrom').value, hi = $m('mkTo').value;
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  const by = aggregate(lo, hi), K = KIND[mkKind];
  const rows = Object.keys(by).map(name => Object.assign({ name }, by[name][mkKind])).filter(r => r.n > 0)
    .sort((a, b) => (b.v - a.v) || (b.n - a.n) || a.name.localeCompare(b.name));
  if (!rows.length) {
    $m('mkState').textContent = (lo || hi) ? 'Nothing in that date range.' : (data.entities.length || data.tx.length ? K.empty : 'Nothing on record yet.');
    $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true;
    return;
  }
  const total = rows.reduce((a, r) => a + r.v, 0), top = rows[0].v || 1;
  $m('mkSumLbl').textContent = `${K.sum} \u00b7 ${plural(rows.length, K.noun)}`;
  $m('mkSumVal').textContent = mkPhp(total);
  if (mkKind === 'trade' && rows.every(hasSplit)) {
    const t = rows.reduce((o, r) => ({ nIn: o.nIn + r.nIn, vIn: o.vIn + r.vIn, nOut: o.nOut + r.nOut, vOut: o.vOut + r.vOut }), { nIn: 0, vIn: 0, nOut: 0, vOut: 0 });
    $m('mkSumSub').textContent = `Out ${mkPhp(t.vOut)} (${plural(t.nOut, 'card')}) \u00b7 In ${mkPhp(t.vIn)} (${plural(t.nIn, 'card')})`;
    $m('mkSumSub').hidden = false;
  } else $m('mkSumSub').hidden = true;
  $m('mkSum').hidden = false;
  $m('mkList').innerHTML = rows.map((r, i) => {
    const share = total ? Math.round(r.v / total * 100) : 0, ent = entByName(r.name);
    const nm = ent ? nameHtml(ent) : escMk(r.name);
    const fch = ent ? flagChips(ent, mkKind === 'buy' ? 's' : mkKind === 'sell' ? 'c' : '') : '';
    const split = mkKind === 'trade' && hasSplit(r);
    const sub = split
      ? `${plural(r.n, 'card')} traded \u00b7 ${r.nOut} out \u00b7 ${r.nIn} in \u00b7 last ${fmtDay(r.last) || '\u2014'}`
      : `${plural(r.n, 'card')} \u00b7 last ${fmtDay(r.last) || '\u2014'} \u00b7 ${share}% of total`;
    const val = split
      ? `<div class="mk-io"><span><em>Out</em>${mkPhp(r.vOut)}</span><span><em>In</em>${mkPhp(r.vIn)}</span></div>`
      : `<b class="mk-val">${mkPhp(r.v)}</b>`;
    return `<div class="mk-row click${i === 0 ? ' first' : ''}${ent && flagsOf(ent).bl ? ' bl' : ''}" data-id="${ent ? escMk(ent.id) : ''}" role="button" tabindex="0" aria-label="Open profile: ${escMk(r.name)}">
        <span class="mk-rank">${i + 1}</span>
        ${avatar(ent, 'sm')}
        <div class="mk-main"><b>${nm}${fch ? ' ' + fch : ''}</b>
          <span>${sub}</span>
          <i class="mk-bar"><u style="width:${Math.max(2, Math.round(r.v / top * 100))}%"></u></i></div>
        ${val}
      </div>`;
  }).join('');
  $m('mkState').hidden = true; $m('mkList').hidden = false;
}
function openFromRank(e) {
  const row = e.target.closest('.mk-row'); if (!row || !row.dataset.id) return;
  openView(row.dataset.id);
}
$m('mkList').addEventListener('click', openFromRank);
$m('mkList').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromRank(e); } });

/* ---------- Profile pieces ---------- */
const PF_IC = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>',
  msg: '<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.6-1.2A9 9 0 1012 3z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
};
const pfIc = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PF_IC[k]}</svg>`;

// "Message" goes to the saved social link (Facebook by default); "SMS" opens the phone's text app
function socialInfo(v) {
  const url = fbUrl(v); if (!url) return null;
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) {}
  const P = [[/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)(m\.me|messenger\.com)$/, 'Messenger'], [/instagram\.com$/, 'Instagram'], [/tiktok\.com$/, 'TikTok'], [/(^|\.)(x\.com|twitter\.com)$/, 'X'], [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram'], [/(^|\.)(wa\.me|whatsapp\.com)$/, 'WhatsApp'], [/viber\.com$/, 'Viber']];
  const hit = P.find(([re]) => re.test(host));
  return { url, name: hit ? hit[1] : '', text: url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '') };
}
const smsHref = c => { const d = String(c || '').replace(/[^\d+]/g, ''); return d ? 'sms:' + d : ''; };
function actionBtns(e, showMissing) {
  const so = socialInfo(e.facebook), sms = smsHref(e.contact);
  const msg = so ? `<a class="pf-btn" href="${escMk(so.url)}" target="_blank" rel="noopener">${pfIc('msg')}<span>${so.name === 'Facebook' ? 'Facebook Chat' : so.name ? 'Message on ' + so.name : 'Message'}</span></a>`
    : showMissing ? `<span class="pf-btn off" title="No social link saved">${pfIc('msg')}<span>Message</span></span>` : '';
  const txt = sms ? `<a class="pf-btn" href="${escMk(sms)}">${pfIc('sms')}<span>SMS</span></a>`
    : showMissing ? `<span class="pf-btn off" title="No phone number saved">${pfIc('sms')}<span>SMS</span></span>` : '';
  return msg || txt ? `<div class="pf-actions">${msg}${txt}</div>` : '';
}

// only the details that exist are shown
function detailRows(e, full) {
  const so = socialInfo(e.facebook), rows = [];
  const add = (ic, label, html) => rows.push(`<div class="pf-row">${pfIc(ic)}<div><small>${label}</small>${html}</div></div>`);
  if (e.contact) add('phone', 'Phone', full ? `<a href="tel:${escMk(e.contact.replace(/\s+/g, ''))}">${escMk(e.contact)}</a>` : `<span>${escMk(e.contact)}</span>`);
  if (e.email) add('mail', 'Email', full ? `<a href="mailto:${escMk(e.email)}">${escMk(e.email)}</a>` : `<span>${escMk(e.email)}</span>`);
  if (so) add('link', so.name || 'Social', full ? `<a href="${escMk(so.url)}" target="_blank" rel="noopener">${escMk(so.text)}</a>` : `<span>${escMk(so.text)}</span>`);
  if (e.address) add('pin', 'Address', `<span class="${full ? '' : 'clamp'}">${escMk(e.address).replace(/\n/g, '<br>')}</span>`);
  if (e.payment.length) add('pay', 'Payment methods', `<div class="ed-chips">${e.payment.map(p => `<span class="chip">${escMk(p)}</span>`).join('')}</div>`);
  if (!full && e.notes) add('note', 'Notes', `<span class="clamp">${escMk(e.notes)}</span>`);
  return rows.join('');
}

function tradeBlock(a) {
  if (!hasSplit(a)) return `<div class="pf-stat"><small>Traded \u00b7 ${plural(a.n, 'card')}</small><b>${mkPhp(a.v)}</b></div>`;
  return `<div class="pf-stat trade"><small>Traded \u00b7 ${plural(a.n, 'card')}</small>
      <div class="pf-io"><span><em>Out</em>${plural(a.nOut, 'card')}</span><b>${mkPhp(a.vOut)}</b></div>
      <div class="pf-io"><span><em>In</em>${plural(a.nIn, 'card')}</span><b>${mkPhp(a.vIn)}</b></div></div>`;
}
function statBlocks(a) {
  const out = [];
  if (a.buy && a.buy.n) out.push(`<div class="pf-stat"><small>Bought \u00b7 ${plural(a.buy.n, 'card')}</small><b>${mkPhp(a.buy.v)}</b></div>`);
  if (a.sell && a.sell.n) out.push(`<div class="pf-stat"><small>Sold \u00b7 ${plural(a.sell.n, 'card')}</small><b>${mkPhp(a.sell.v)}</b></div>`);
  if (a.trade && a.trade.n) out.push(tradeBlock(a.trade));
  return out.join('');
}

/* ---------- Entities (profile cards) ---------- */
const ENT_ICON = {
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>',
  merge: '<path d="M6 3v5c0 3 2 4 6 4s6 1 6 4v5"/><path d="M18 3v5c0 3-2 4-6 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>'
};
const entIcon = (name, cls, label, id) => `<button type="button" class="icon-btn flat ${cls}" data-id="${escMk(id)}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ENT_ICON[name]}</svg></button>`;

function syncToggleLabels() {
  const t = showDetails ? 'Hide details' : 'Show details';
  $m('entDetailsToggle').textContent = t;
  const v = $m('pfToggle'); if (v) v.textContent = t;
}
function setShowDetails(on) {
  showDetails = on;
  try { localStorage.setItem(DET_KEY, on ? '1' : '0'); } catch (_) {}
  syncToggleLabels();
  const d = $m('pfDetails'); if (d) d.hidden = !on;
  renderEntities();
}
$m('entDetailsToggle').onclick = () => setShowDetails(!showDetails);

/* ---------- Sort / filter (filter icon) ----------
   Card value in  = cards that came to us (bought + traded in); Card value out = cards that left (sold + traded out). */
const SORTS = {
  sell: { label: 'Cards sold', note: 'Cards sold to them', val: a => a.sell.n, fmt: v => plural(v, 'card') + ' sold' },
  buy:  { label: 'Cards purchased', note: 'Cards bought from them', val: a => a.buy.n, fmt: v => plural(v, 'card') + ' bought' },
  tout: { label: 'Trade cards out', note: 'Cards we gave in trades', val: a => a.trade.nOut, fmt: v => plural(v, 'card') + ' traded out' },
  tin:  { label: 'Trade cards in', note: 'Cards we received in trades', val: a => a.trade.nIn, fmt: v => plural(v, 'card') + ' traded in' },
  tx:   { label: 'Number of transactions', note: 'Every card bought, sold or traded', val: a => a.buy.n + a.sell.n + a.trade.n, fmt: v => plural(v, 'transaction') },
  vin:  { label: 'Card value in', note: 'Bought + traded in', val: a => a.buy.v + a.trade.vIn, fmt: v => mkPhp(v) + ' in' },
  vout: { label: 'Card value out', note: 'Sold + traded out', val: a => a.sell.v + a.trade.vOut, fmt: v => mkPhp(v) + ' out' }
};
let entSort = '', entDir = 'most', entFlag = '';
function renderSortOpts() {
  $m('sortOpts').innerHTML = [['', 'Name (A\u2013Z)', 'Alphabetical']].concat(Object.keys(SORTS).map(k => [k, SORTS[k].label, SORTS[k].note]))
    .map(([k, l, n]) => `<button type="button" class="so-item${k === entSort ? ' on' : ''}" data-k="${k}"><b>${l}</b><span>${n}</span></button>`).join('');
  $m('sortDirField').hidden = !entSort;
  document.querySelectorAll('input[name=sortDir]').forEach(r => r.checked = r.value === entDir);
  const opt = (v, l) => `<option value="${v}">${l}</option>`;
  $m('flagFilter').innerHTML = opt('', 'All entities') + opt('bl', 'Blacklisted') + opt('none', 'No flag')
    + '<optgroup label="Customers (sold to)">' + Object.keys(CF).map(k => opt('c:' + k, CF[k][0])).join('') + '</optgroup>'
    + '<optgroup label="Suppliers (bought from)">' + Object.keys(SF).map(k => opt('s:' + k, SF[k][0])).join('') + '</optgroup>';
  $m('flagFilter').value = entFlag;
}
const flagFilterLabel = () => entFlag === 'bl' ? 'Blacklisted' : entFlag === 'none' ? 'No flag' : entFlag.startsWith('c:') ? CF[entFlag.slice(2)][0] : SF[entFlag.slice(2)][0];
function flagMatch(e) {
  if (!entFlag) return true;
  const x = flagsOf(e);
  if (entFlag === 'bl') return !!x.bl;
  if (entFlag === 'none') return !x.c && !x.s && !x.bl;
  const k = entFlag.slice(2);
  return entFlag[0] === 'c' ? !!x.c && x.c.key === k : !!x.s && x.s.key === k;
}
$m('entFilterBtn').onclick = () => { renderSortOpts(); $m('sortSheet').hidden = false; };
$m('sortOpts').addEventListener('click', e => { const b = e.target.closest('.so-item'); if (!b) return; entSort = b.dataset.k; renderSortOpts(); renderEntities(); });
document.querySelectorAll('input[name=sortDir]').forEach(r => r.addEventListener('change', () => { if (r.checked) { entDir = r.value; renderEntities(); } }));
$m('flagFilter').addEventListener('change', () => { entFlag = $m('flagFilter').value; renderEntities(); });
$m('sortDone').onclick = () => $m('sortSheet').hidden = true;
$m('sortReset').onclick = () => { entSort = ''; entDir = 'most'; entFlag = ''; renderSortOpts(); renderEntities(); };
$m('sortSheet').addEventListener('click', e => { if (e.target.id === 'sortSheet') $m('sortSheet').hidden = true; });
$m('entActive').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.clear === 'sort') { entSort = ''; entDir = 'most'; } else entFlag = '';
  renderEntities();
});

/* the rules, with the live thresholds worked out from your own data */
function showFlagInfo() {
  const t = autoFlags().th;
  const li = (name, txt) => `<div class="fi-row"><b>${name}</b><span>${txt}</span></div>`;
  $m('flagInfoBody').innerHTML = `<p class="fi-lead">Flags are worked out automatically from your sales and purchases and refresh every time the page loads. Set a flag on a profile and your choice always wins. Blacklist is only ever set by hand. Trades are not counted.</p>
    <h4>Customers (sold to)</h4>
    <p class="fi-note">An order is one day with sales, however many cards. Top 10% means lifetime sales of ${mkPhp(t.heroCut)} or more across ${plural(t.nCust, 'customer')}. A good spender is at or above the middle customer (${mkPhp(t.med)}).</p>
    ${li('Hero', 'Top 10% spender, 2+ orders, now quiet for longer than twice their usual gap (at least 3 weeks, up to 180 days).')}
    ${li('Loyalist', '3+ orders and still active: last order within 30 days or twice their usual gap.')}
    ${li('Potential Loyalist', '1 to 2 orders, last one within 30 days, and a good spender.')}
    ${li('New', 'First order within the last 30 days.')}
    ${li('Sleeper', '2+ orders but nothing for 45 days or more.')}
    ${li('Cold', 'One order, over 90 days ago, below the middle spend.')}
    <h4>Suppliers (bought from)</h4>
    <p class="fi-note">High spend means lifetime purchases of ${mkPhp(t.spendCut)} or more (top 25% of ${plural(t.nSupp, 'supplier')}). Premium cards means an average cost per card of ${mkPhp(t.unitCut)} or more (the middle supplier).</p>
    ${li('Go-to Source', 'High spend, premium cards, and bought from on 2+ days.')}
    ${li('Bulk Deals', 'High spend, but lower-priced cards. Easy to shop around.')}
    ${li('Rare-Find Holder', 'Premium cards with low spend or a single order. Keep them warm.')}
    ${li('Occasional', 'Everything else.')}
    <p class="fi-note">Anyone who fits no rule is left unflagged.</p>`;
  $m('flagInfo').hidden = false;
}
$m('flagInfoBtn').onclick = showFlagInfo;
$m('flagInfoClose').onclick = () => $m('flagInfo').hidden = true;
$m('flagInfo').addEventListener('click', e => { if (e.target.id === 'flagInfo') $m('flagInfo').hidden = true; });

// cards are dealt into columns one after another, so a short card never leaves a gap beside a tall one
const entCols = () => window.matchMedia('(min-width:640px)').matches ? 2 : 1;
let lastCols = 0;
window.addEventListener('resize', () => { if (mkTab === 'ent' && entCols() !== lastCols) renderEntities(); });

function renderEntities() {
  const q = $m('entSearch').value.trim().toLowerCase();
  const by = aggregate('', '');
  let list = data.entities.slice();
  if (q) list = list.filter(e => [e.name, nickOf(e), flagLabels(e), e.contact, e.address, e.email, e.facebook, e.notes].concat(e.aliases, e.payment).join(' ').toLowerCase().includes(q));
  if (entFlag) list = list.filter(flagMatch);
  const S = SORTS[entSort];
  if (S) { const d = entDir === 'least' ? 1 : -1; list.sort((x, y) => d * (S.val(by[x.name]) - S.val(by[y.name])) || x.name.localeCompare(y.name)); }
  else list.sort((a, b) => a.name.localeCompare(b.name));
  $m('entCount').textContent = data.entities.length ? `${list.length} of ${plural(data.entities.length, 'entity').replace('entitys', 'entities')}` : '';
  $m('entFilterBtn').classList.toggle('on', !!S || !!entFlag);
  const act = [];
  if (S) act.push(['sort', `${entDir === 'least' ? 'Least' : 'Most'} \u00b7 ${S.label}`]);
  if (entFlag) act.push(['flag', flagFilterLabel()]);
  $m('entActive').hidden = !act.length;
  $m('entActive').innerHTML = act.map(([k, t]) => `<button type="button" class="chip active" data-clear="${k}" title="Clear">${t} &times;</button>`).join('');
  syncToggleLabels();
  if (!list.length) {
    $m('entState').textContent = data.entities.length ? 'No entities match your search.' : 'No entities yet. They are saved automatically from your receipts, or tap + Add entity.';
    $m('entState').hidden = false; $m('entList').hidden = true;
    return;
  }
  const cards = list.map(e => {
    const a = by[e.name] || {};
    const stats = statBlocks(a), none = !stats;
    const rows = showDetails ? detailRows(e, false) : '';
    const fx = flagsOf(e);
    const chips = [fx.bl ? `<span class="fl fl-red" title="${escMk(fx.bl)}">Blacklisted</span>` : '', fx.c ? flChip(fx.c, CF) : '', fx.s ? flChip(fx.s, SF) : ''].join('');
    return `<div class="ent-card pf-card click${fx.bl ? ' bl' : ''}" data-id="${escMk(e.id)}">
        <div class="pf-top">
          ${avatar(e, 'md')}
          <div class="ent-name"><b>${nameHtml(e)}</b>${e.aliases.length ? `<span class="pf-alias">Also spelled: ${e.aliases.map(escMk).join(', ')}</span>` : ''}${chips ? `<span class="fl-row">${chips}</span>` : ''}${S ? `<span class="pf-metric">${S.fmt(S.val(a))}</span>` : ''}</div>
          <div class="ent-acts">${entIcon('pencil', 'ent-edit', 'Edit profile', e.id)}${entIcon('merge', 'ent-merge', 'Merge into another entity', e.id)}${none ? entIcon('trash', 'danger ent-del', 'Delete', e.id) : ''}</div>
        </div>
        ${actionBtns(e, false)}
        ${rows ? `<div class="pf-rows">${rows}</div>` : ''}
        ${stats ? `<div class="pf-stats">${stats}</div>` : '<div class="pf-none">No cards yet</div>'}
      </div>`;
  });
  lastCols = entCols();
  $m('entList').innerHTML = lastCols === 1 ? cards.join('')
    : [0, 1].map(c => `<div class="mk-col">${cards.filter((_, i) => i % 2 === c).join('')}</div>`).join('');
  $m('entList').classList.toggle('cols', lastCols === 2);
  $m('entState').hidden = true; $m('entList').hidden = false;
}

/* ---------- Load ---------- */
function renderAll() { if (mkTab === 'rank') renderRank(); else renderEntities(); }
async function loadData() {
  if (!CONFIG.portfolio.endpoint) { $m('mkState').textContent = "Sync isn't set up yet."; $m('mkState').hidden = false; return; }
  const cached = mkFirst ? cacheGet('entities') : null; mkFirst = false;
  if (cached) { data = normData(cached); adoptServerProfiles(); renderAll(); }
  else { $m('mkState').textContent = 'Loading\u2026'; $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true; }
  try {
    const res = await jsonp(api('entities'), 60000);   // the first run also saves every name already in your sheets
    if (!res.ok) throw new Error(res.error || 'Unknown error');
    data = normData(res);
    adoptServerProfiles();
    cacheSet('entities', data);
    renderAll();
    migrateLocalProfiles();
  } catch (err) {
    console.warn('Marketing load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    const msg = "Couldn't load this page (offline, wrong secret, or Code.gs needs a new deployment).";
    $m('mkState').textContent = msg; $m('mkState').hidden = false; $m('mkList').hidden = true; $m('mkSum').hidden = true;
    $m('entState').textContent = msg; $m('entState').hidden = false; $m('entList').hidden = true;
  }
}

/* ---------- Tabs, filters ---------- */
document.querySelectorAll('.tab[data-mtab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-mtab]').forEach(x => x.classList.toggle('active', x === t));
  mkTab = t.dataset.mtab;
  $m('panelRank').hidden = mkTab !== 'rank'; $m('panelEnt').hidden = mkTab !== 'ent';
  renderAll();
});
document.querySelectorAll('#mkKinds .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#mkKinds .chip').forEach(x => x.classList.toggle('active', x === c));
  mkKind = c.dataset.kind; renderRank();
});
[$m('mkFrom'), $m('mkTo')].forEach(i => i.addEventListener('change', renderRank));
$m('mkClear').onclick = () => { $m('mkFrom').value = ''; $m('mkTo').value = ''; renderRank(); };
$m('mkRefresh').onclick = loadData;
$m('entSearch').addEventListener('input', renderEntities);

/* ---------- Add / rename / edit details ---------- */
let editEntId = '', entPay = [], reopenView = false, editPic = '', editGender = '';
const PAY_PRESETS = ['Cash', 'GCash', 'Maya', 'Maribank', 'Bank transfer'];
const findEnt = id => data.entities.find(e => e.id === id);
const hasPay = p => entPay.some(x => x.toLowerCase() === p.toLowerCase());
function renderPay() {
  const extra = entPay.filter(p => !PAY_PRESETS.some(x => x.toLowerCase() === p.toLowerCase()));
  $m('entPayChips').innerHTML = PAY_PRESETS.concat(extra).map(p => `<button type="button" class="chip${hasPay(p) ? ' active' : ''}" data-pay="${escMk(p)}">${escMk(p)}</button>`).join('');
}
$m('entPayChips').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  const p = c.dataset.pay;
  entPay = hasPay(p) ? entPay.filter(x => x.toLowerCase() !== p.toLowerCase()) : entPay.concat(p);
  renderPay();
});
function addPay() {
  const v = $m('entPayOther').value.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (v && !hasPay(v)) entPay.push(v);
  $m('entPayOther').value = ''; renderPay();
}
$m('entPayAdd').onclick = addPay;
$m('entPayOther').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPay(); } });

/* profile picture + gender inside the edit sheet */
function renderEditAvatar() {
  $m('entAvatar').innerHTML = avatarRaw(editPic, editGender, 'xl');
  $m('entPicRemove').hidden = !editPic;
  document.querySelectorAll('input[name=entGender]').forEach(r => r.checked = r.value === editGender);
}
document.querySelectorAll('input[name=entGender]').forEach(r => r.addEventListener('change', () => { if (r.checked) { editGender = r.value; renderEditAvatar(); } }));
$m('entPicUpload').onclick = () => $m('entPicFile').click();
$m('entPicLink').onclick = () => { const f = $m('entPicLinkField'); f.hidden = !f.hidden; if (!f.hidden) $m('entPicUrl').focus(); };
$m('entPicRemove').onclick = () => { editPic = ''; renderEditAvatar(); };
function usePicLink() {
  const v = $m('entPicUrl').value.trim();
  if (!v) return;
  if (!/^https?:\/\//i.test(v)) return toast('Paste a full link that starts with https://');
  editPic = v; $m('entPicUrl').value = ''; $m('entPicLinkField').hidden = true; renderEditAvatar();
}
$m('entPicUse').onclick = usePicLink;
$m('entPicUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); usePicLink(); } });
// uploads are cropped to a small square so they stay light on this device
function fileToAvatar(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => {
        const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
        const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) * 0.25;   // favour the top of portrait photos
        c.getContext('2d').drawImage(img, sx, sy, m, m, 0, 0, S, S);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
$m('entPicFile').addEventListener('change', async () => {
  const f = $m('entPicFile').files[0]; $m('entPicFile').value = '';
  if (!f) return;
  try { editPic = await fileToAvatar(f); renderEditAvatar(); } catch (_) { toast('Could not read that image.'); }
});

function fillFlagSelects(e) {
  const A = autoFlags(), p = e ? profOf(e.id) : profOf('');
  const opts = (defs, auto) => `<option value="">${auto ? 'Auto (' + defs[auto.key][0] + ')' : 'Auto (no flag yet)'}</option>`
    + Object.keys(defs).map(k => `<option value="${k}">${defs[k][0]}</option>`).join('') + '<option value="none">No flag</option>';
  $m('entFlagC').innerHTML = opts(CF, e && A.C[e.name]); $m('entFlagC').value = p.fc;
  $m('entFlagS').innerHTML = opts(SF, e && A.S[e.name]); $m('entFlagS').value = p.fs;
  $m('entBl').checked = !!p.bl; $m('entBlReason').value = p.blr || ''; $m('entBlField').hidden = !p.bl;
}
$m('entBl').addEventListener('change', () => { $m('entBlField').hidden = !$m('entBl').checked; if ($m('entBl').checked) $m('entBlReason').focus(); });
function openEnt(id, fromView) {
  const e = id ? findEnt(id) : null;
  editEntId = e ? e.id : ''; reopenView = !!fromView;
  $m('entHeading').textContent = e ? 'Edit profile' : 'Add entity';
  $m('entName').value = e ? e.name : ''; $m('entNick').value = e ? nickOf(e) : ''; $m('entContact').value = e ? e.contact : '';
  $m('entAddress').value = e ? e.address : ''; $m('entEmail').value = e ? e.email : '';
  $m('entFb').value = e ? e.facebook : ''; $m('entNotes').value = e ? e.notes : '';
  entPay = e ? e.payment.slice() : []; $m('entPayOther').value = ''; renderPay();
  const p = e ? profOf(e.id) : {}; editPic = p.pic || ''; editGender = p.g || '';
  $m('entPicUrl').value = ''; $m('entPicLinkField').hidden = true; renderEditAvatar();
  $m('entHint').hidden = !e;
  $m('entSheet').hidden = false;
  if (!e) $m('entName').focus();
}
const closeEnt = () => { $m('entSheet').hidden = true; editEntId = ''; };
$m('entAdd').onclick = () => openEnt('');
$m('entCancel').onclick = () => { const back = reopenView && editEntId; closeEnt(); if (back) openView(back); };
$m('entSheet').addEventListener('click', e => { if (e.target.id === 'entSheet') $m('entCancel').onclick(); });
const entParams = (e, over) => Object.assign({ entityId: e.id, name: e.name, contact: e.contact, address: e.address, email: e.email, facebook: e.facebook, payment: e.payment.join('|'), notes: e.notes }, over);
$m('entSave').onclick = async () => {
  const name = $m('entName').value.trim().replace(/\s+/g, ' ');
  if (!name) return toast('Enter a name.');
  if ($m('entPayOther').value.trim()) addPay();
  const old = editEntId ? findEnt(editEntId) : null;
  const fields = { name, contact: $m('entContact').value.trim(), address: $m('entAddress').value.trim(), email: $m('entEmail').value.trim(), facebook: $m('entFb').value.trim(), payment: entPay.join('|'), notes: $m('entNotes').value.trim() };
  const changed = !old || ['name', 'contact', 'address', 'email', 'facebook', 'notes'].some(k => fields[k] !== old[k]) || fields.payment !== old.payment.join('|');
  if (old && name !== old.name && !confirm(`Rename "${old.name}" to "${name}"?\n\nEvery receipt, card and finance entry that uses the old spelling will be updated. This can take a few seconds.`)) return;
  const btn = $m('entSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    if (changed) {
      const res = await jsonp(api('saveEntity', Object.assign({ entityId: editEntId }, fields)), 90000);
      if (!res.ok) throw new Error(res.error || 'Request failed');
    }
    const back = reopenView && editEntId;
    const wasId = editEntId;
    closeEnt();
    if (changed) await loadData();
    const id = wasId || (data.entities.find(x => x.name.toLowerCase() === name.toLowerCase()) || {}).id;
    const bl = $m('entBl').checked;
    const np = { g: editGender, pic: editPic, n: $m('entNick').value.replace(/\s+/g, ' ').trim().slice(0, 40), fc: $m('entFlagC').value, fs: $m('entFlagS').value, bl, blr: bl ? $m('entBlReason').value.trim().slice(0, 120) : '' };
    const kept = setProf(id, np);
    // save the profile to the sheet; a new upload goes to the Drive folder and its link replaces the raw photo
    let synced = true;
    try {
      const ent = findEnt(id);
      if (ent) {
        const payload = profPayload(np);
        if (/^data:/.test(np.pic)) payload.pic = (ent.profile && ent.profile.pic) || '';   // keep the current Drive photo until the new one lands
        const res = await jsonp(api('saveEntity', entParams(ent, { profile: JSON.stringify(payload) })), 60000);
        if (!res.ok) throw new Error(res.error || 'Request failed');
        ent.profile = payload;
        if (/^data:/.test(np.pic)) { const url = await uploadPhoto(id, np.pic); setProf(id, { pic: url }); ent.profile = Object.assign({}, payload, { pic: url }); }
        cacheSet('entities', data);
      } else synced = false;
    } catch (err) { console.warn('Profile sync failed', err); synced = false; }
    toast(!synced ? 'Saved on this device, but could not reach Drive. It will retry next time Marketing loads.' : !kept ? 'Saved, but the photo is too large to keep on this device.' : old ? 'Profile updated.' : 'Entity added.');
    renderAll();
    if (back) openView(back);
  } catch (err) { toast('Could not save: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Save';
};

/* ---------- Profile view ---------- */
const PAST = { buy: 'Bought', sell: 'Sold', trade: 'Traded' };
let viewId = '';
function txLine(t) {
  if (!t) return '';
  const what = t[1] === 'trade' ? (t[4] === 'in' ? 'Traded in' : t[4] === 'out' ? 'Traded out' : 'Traded') : (PAST[t[1]] || '');
  return `${what} \u00b7 ${fmtDay(t[2])} \u00b7 ${mkPhp(t[3])}`;
}
function openView(id) {
  const e = findEnt(id); if (!e) return;
  viewId = id;
  const mine = data.tx.filter(t => t[0] === e.name && String(t[2] || '').slice(0, 10)).sort((a, b) => String(a[2]).slice(0, 10).localeCompare(String(b[2]).slice(0, 10)));
  const a = aggregate('', '')[e.name] || {};
  const stats = statBlocks(a);
  const rows = detailRows(e, true);
  const fx = flagsOf(e);
  const blBox = fx.bl ? `<div class="pf-bl"><b>Blacklisted \u00b7 Do not transact</b><span>${escMk(fx.bl)}</span></div>` : '';
  const flagRows = [['Customer', fx.c, CF], ['Supplier', fx.s, SF]].filter(r => r[1])
    .map(([l, f, defs]) => `<div class="pf-fl"><small>${l}</small>${flChip(f, defs, '')}<span>${escMk(f.why)}</span></div>`).join('');
  const when = (label, t) => t ? `<div class="ed-row"><small>${label}</small><span>${escMk(txLine(t))}</span></div>` : '';
  $m('entViewBody').innerHTML = `${blBox}<div class="pf-hero">
      <div class="pf-avwrap">${avatar(e, 'xl')}<button type="button" class="pf-cam" id="pfCam" aria-label="Change photo or gender" title="Change photo or gender">${pfIc('cam')}</button></div>
      <b class="pf-name">${escMk(e.name)}</b>
      ${nickOf(e) ? `<span class="pf-nick big">\u201c${escMk(nickOf(e))}\u201d</span>` : ''}
      ${e.aliases.length ? `<span class="pf-alias">Also spelled: ${e.aliases.map(escMk).join(', ')}</span>` : ''}
    </div>
    ${actionBtns(e, true)}
    ${flagRows ? `<div class="pf-flagbox">${flagRows}</div>` : ''}
    <div class="pf-sec"><span>Details</span><button type="button" class="ghost sm" id="pfToggle">${showDetails ? 'Hide details' : 'Show details'}</button></div>
    <div id="pfDetails"${showDetails ? '' : ' hidden'}>
      ${rows ? `<div class="pf-rows full">${rows}</div>` : '<p class="pf-none">No contact details saved yet. Tap Edit details to add some.</p>'}
      <div class="pf-notes"><small>Notes</small>
        <textarea class="ed-notes" id="entViewNotes" rows="3" maxlength="1000" placeholder="Add a note about this entity">${escMk(e.notes)}</textarea>
        <button type="button" class="ghost sm" id="entViewNotesSave" style="margin-top:6px">Save notes</button></div>
    </div>
    <div class="pf-sec"><span>Activity</span></div>
    ${stats ? `<div class="pf-stats">${stats}</div>` : '<p class="pf-none">No cards yet</p>'}
    ${when('First transaction', mine[0])}${when('Most recent transaction', mine.length > 1 ? mine[mine.length - 1] : mine[0])}`;
  $m('entViewCards').hidden = true; $m('entViewCards').innerHTML = '';
  $m('entViewLoad').textContent = 'Load purchased, sold & traded cards'; $m('entViewLoad').disabled = false;
  $m('entView').hidden = false;
}
const closeView = () => { $m('entView').hidden = true; viewId = ''; };
$m('entViewClose').onclick = closeView;
$m('entView').addEventListener('click', e => { if (e.target.id === 'entView') closeView(); });
$m('entViewEdit').onclick = () => { const id = viewId; closeView(); openEnt(id, true); };
$m('entViewBody').addEventListener('click', async e => {
  if (e.target.closest('#pfCam')) { const id = viewId; closeView(); return openEnt(id, true); }
  if (e.target.closest('#pfToggle')) return setShowDetails(!showDetails);
  if (e.target.id !== 'entViewNotesSave') return;
  const ent = findEnt(viewId); if (!ent) return;
  const notes = $m('entViewNotes').value.trim(), btn = e.target;
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const res = await jsonp(api('saveEntity', entParams(ent, { notes })), 60000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    ent.notes = notes; cacheSet('entities', data); toast('Notes saved.'); renderEntities();
  } catch (err) { toast('Could not save notes: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Save notes';
});
$m('entViewLoad').onclick = async () => {
  const ent = findEnt(viewId); if (!ent) return;
  const btn = $m('entViewLoad'); btn.disabled = true; btn.textContent = 'Loading\u2026';
  try {
    const res = await jsonp(api('entityCards', { entityId: ent.id }), 60000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    const cards = res.cards || [];
    const GROUPS = [
      ['Purchased', x => x.kind === 'buy'],
      ['Sold', x => x.kind === 'sell'],
      ['Traded out (given)', x => x.kind === 'trade' && x.dir === 'out'],
      ['Traded in (received)', x => x.kind === 'trade' && x.dir === 'in'],
      ['Traded', x => x.kind === 'trade' && x.dir !== 'in' && x.dir !== 'out']
    ];
    const html = GROUPS.map(([label, fn]) => {
      const list = cards.filter(fn).sort((x, y) => String(y.date).localeCompare(String(x.date)));
      if (!list.length) return '';
      return `<div class="ed-group">${label}<span>${plural(list.length, 'card')} \u00b7 ${mkPhp(list.reduce((s, x) => s + x.value, 0))}</span></div>`
        + list.map(x => `<div class="ed-card">${x.photo ? `<img src="${escMk(x.photo)}" alt="" loading="lazy">` : '<div class="ed-noimg"></div>'}
            <div><b>${escMk(x.name)}</b><small>${fmtDay(x.date) || 'No date'}</small></div><em>${mkPhp(x.value)}</em></div>`).join('');
    }).join('');
    $m('entViewCards').innerHTML = html || '<p class="stub-note" style="text-align:center">No cards on record for this entity.</p>';
    $m('entViewCards').hidden = false;
    btn.textContent = 'Reload cards';
  } catch (err) { toast('Could not load cards: ' + backendErr(err)); btn.textContent = 'Load purchased, sold & traded cards'; }
  btn.disabled = false;
};

/* ---------- Merge ---------- */
let mergeFrom = '', mergeInto = '';
function renderMergeList() {
  const q = $m('mergeSearch').value.trim().toLowerCase();
  const list = data.entities.filter(e => e.id !== mergeFrom && (!q || [e.name].concat(e.aliases).join(' ').toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  $m('mergeList').innerHTML = list.length
    ? list.map(e => `<button type="button" class="rs-item mg-item${e.id === mergeInto ? ' on' : ''}" data-id="${escMk(e.id)}" style="grid-template-columns:1fr"><span><b>${escMk(e.name)}</b>${e.aliases.length ? escMk(e.aliases.join(', ')) : ''}</span></button>`).join('')
    : '<p class="stub-note" style="margin:6px 0">No other entities.</p>';
  $m('mergeGo').disabled = !mergeInto;
}
function openMerge(id) {
  const e = findEnt(id); if (!e) return;
  mergeFrom = id; mergeInto = ''; $m('mergeSearch').value = '';
  $m('mergeText').innerHTML = `Merge <b>${escMk(e.name)}</b> into another entity. Everything recorded under it moves to the one you pick, and <b>${escMk(e.name)}</b> is removed.`;
  renderMergeList();
  $m('mergeSheet').hidden = false;
}
const closeMerge = () => { $m('mergeSheet').hidden = true; mergeFrom = mergeInto = ''; };
$m('mergeCancel').onclick = closeMerge;
$m('mergeSheet').addEventListener('click', e => { if (e.target.id === 'mergeSheet') closeMerge(); });
$m('mergeSearch').addEventListener('input', renderMergeList);
$m('mergeList').addEventListener('click', e => {
  const b = e.target.closest('.mg-item'); if (!b) return;
  mergeInto = b.dataset.id; renderMergeList();
});
$m('mergeGo').onclick = async () => {
  const from = findEnt(mergeFrom), into = findEnt(mergeInto);
  if (!from || !into) return;
  if (!confirm(`Merge "${from.name}" into "${into.name}"?\n\nAll receipts, cards and finance entries will use "${into.name}". This cannot be undone.`)) return;
  const btn = $m('mergeGo'); btn.disabled = true; btn.textContent = 'Merging\u2026';
  try {
    const res = await jsonp(api('mergeEntities', { fromIds: from.id, intoId: into.id }), 90000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    // the kept profile inherits the merged one's photo / gender when it has none of its own
    const pf = profOf(from.id), pi = profOf(into.id);
    setProf(into.id, { g: pi.g || pf.g, pic: pi.pic || pf.pic, n: pi.n || pf.n, bl: pi.bl || pf.bl, blr: pi.blr || pf.blr }); clearProf(from.id);
    closeMerge(); toast(`Merged into ${into.name}.`);
    await loadData();
  } catch (err) { toast('Could not merge: ' + backendErr(err)); }
  btn.disabled = false; btn.textContent = 'Merge';
};

/* ---------- List actions ---------- */
$m('entList').addEventListener('click', async e => {
  if (e.target.closest('a.pf-btn')) return;   // Message / SMS follow their link instead of opening the profile
  const edit = e.target.closest('.ent-edit'); if (edit) return openEnt(edit.dataset.id);
  const merge = e.target.closest('.ent-merge'); if (merge) return openMerge(merge.dataset.id);
  const del = e.target.closest('.ent-del');
  if (del) {
    const ent = findEnt(del.dataset.id); if (!ent || !confirm(`Delete "${ent.name}"?`)) return;
    del.disabled = true;
    try {
      const res = await jsonp(api('deleteEntity', { entityId: ent.id }), 60000);
      if (!res.ok) throw new Error(res.error || 'Request failed');
      clearProf(ent.id);
      toast('Entity deleted.'); await loadData();
    } catch (err) { del.disabled = false; toast('Could not delete: ' + backendErr(err)); }
    return;
  }
  const card = e.target.closest('.ent-card'); if (card) openView(card.dataset.id);
});

loadData();
