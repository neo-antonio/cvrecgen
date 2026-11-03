/* ---------- Organization — org chart (people and the apps each one uses), goals and FAQ ----------
   A person's Apps are their Home shortcuts (see CVAccess in shell.js). They do not limit what anyone can open or edit. */
const $o = id => document.getElementById(id);
const escOrg = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const backendErr = err => err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : err.message;
const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
  + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
  + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);

/* The apps on the home screen, with the same icons. Add a line here when a new app is added to the launcher. */
const APPS = [
  { id: 'receipt', label: 'Receipt', href: 'receipt.html', desc: 'Make purchase, sold, trade and transfer receipts.',
    svg: '<path d="M6 2.2h12v19.6l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1z"/><line x1="8.2" y1="7" x2="15.8" y2="7"/><line x1="8.2" y1="11" x2="15.8" y2="11"/><line x1="8.2" y1="15" x2="13" y2="15"/>' },
  { id: 'portfolio', label: 'Portfolio', href: 'portfolio.html', desc: 'Every card on hand, shipping, sold or traded.',
    svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c2.9 3 2.9 9.9 0 12.8M18.4 5.6c-2.9 3-2.9 9.9 0 12.8"/>' },
  { id: 'commercial', label: 'Commercial', href: 'commercial.html', desc: 'Target sale prices, margins and lots.',
    svg: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>' },
  { id: 'shipping', label: 'Shipping', href: 'shipping.html', desc: 'Sold cards waiting to ship, and proof of what shipped.',
    svg: '<path d="M1.5 6.5h12.5v10.5h-12.5z"/><path d="M14 9.8h4.2l3.3 3.3v3.9h-7.5z"/><circle cx="6" cy="18.6" r="1.9"/><circle cx="17.8" cy="18.6" r="1.9"/>' },
  { id: 'finance', label: 'Finance', href: 'finance.html', desc: 'Money in and out, recorded from receipts.',
    svg: '<path d="M3 6.5h14.5a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3z"/><path d="M3 6.5V5a2 2 0 012-2h9.5"/><circle cx="16.3" cy="13.7" r="1.3" fill="currentColor" stroke="none"/>' },
  { id: 'calendar', label: 'Calendar', href: 'calendar.html', desc: 'Events and schedules.',
    svg: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.8v3.4M16 2.8v3.4"/><circle cx="8.3" cy="14" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r=".9" fill="currentColor" stroke="none"/><circle cx="15.7" cy="14" r=".9" fill="currentColor" stroke="none"/><circle cx="8.3" cy="17.4" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="17.4" r=".9" fill="currentColor" stroke="none"/>' },
  { id: 'marketing', label: 'Marketing', href: 'marketing.html', desc: 'Top sellers, buyers and trade partners, and their details.',
    svg: '<circle cx="12" cy="7.8" r="4"/><path d="M4.2 20.5c0-4.3 3.5-6.8 7.8-6.8s7.8 2.5 7.8 6.8"/>' },
  { id: 'charts', label: 'Charts', href: 'index.html', desc: 'Charts, opened from the home screen.',
    svg: '<rect x="3.5" y="12" width="4.5" height="8.5" rx=".8"/><rect x="9.75" y="7" width="4.5" height="13.5" rx=".8"/><rect x="16" y="3.5" width="4.5" height="17" rx=".8"/>' },
  { id: 'creatives', label: 'Creatives', href: 'creatives.html', desc: 'Vlog tasks and post edits.',
    svg: '<path d="M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.5-1-2.7 0-1 .8-1.7 1.9-1.7H17a4 4 0 004-4C21 6.6 17 3 12 3z"/><circle cx="7.6" cy="11.2" r="1" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.4" r="1" fill="currentColor" stroke="none"/>' },
  { id: 'social', label: 'Social Media', href: 'index.html', desc: 'Facebook, Instagram, TikTok and YouTube links, opened from the home screen.',
    svg: '<circle cx=\"18\" cy=\"5.5\" r=\"2.7\"/><circle cx=\"6\" cy=\"12\" r=\"2.7\"/><circle cx=\"18\" cy=\"18.5\" r=\"2.7\"/><path d=\"M8.4 10.7l7.2-3.9M8.4 13.3l7.2 3.9\"/>' },
  { id: 'topics', label: 'Topic Board', href: 'topics.html', desc: 'Meeting topics, comments and conclusions.',
    svg: '<path d=\"M3 5.5A1.5 1.5 0 014.5 4h15A1.5 1.5 0 0121 5.5v13a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z\"/><path d=\"M7 8.5h5M7 12h10M7 15.5h7\"/>' },
  { id: 'organization', label: 'Organization', href: 'organization.html', desc: 'Team chart, goals and FAQ.',
    svg: '<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="2.5" y="16" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M5.5 16v-4h13v4"/>' },
  { id: 'legal', label: 'Legal', href: 'https://drive.google.com/drive/folders/1C8jRzBRNWcl3kvyP19aX8w4y_-8lRhvE?usp=drive_link', desc: 'Legal documents folder in Google Drive.',
    svg: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7l-3 7a3.5 3.5 0 006 0z"/><path d="M19 7l-3 7a3.5 3.5 0 006 0z"/>' },
  { id: 'backend', label: 'Backend', href: 'https://docs.google.com/spreadsheets/d/1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o/edit?gid=1823529634#gid=1823529634', desc: 'The Google Sheet behind the app, opened in a new tab.',
    svg: '<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"7\" rx=\"2\"/><rect x=\"3\" y=\"13.5\" width=\"18\" height=\"7\" rx=\"2\"/><circle cx=\"7\" cy=\"7\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"7\" cy=\"17\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M11 7h6M11 17h6\"/>' },
  { id: 'settings', label: 'Settings', href: 'settings.html', desc: 'App settings.',
    svg: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/>' }
];
const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
const extA = a => /^https?:/.test(a.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
const appSvg = a => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${a.svg}</svg>`;
const appIcons = (ids, max = 6) => {
  const list = (ids || []).map(i => APP[i]).filter(Boolean);
  return list.slice(0, max).map(a => `<i class="org-ic" title="${escOrg(a.label)}">${appSvg(a)}</i>`).join('') + (list.length > max ? `<i class="org-more">+${list.length - max}</i>` : '');
};

let orgTab = 'team', items = [], orgFirst = true;
const people = () => items.filter(i => i.kind === 'person');
const findItem = id => items.find(i => i.id === id);

function toast(m) {
  const t = $o('orgToast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200);
}
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* ---------- Team ---------- */
function nodeHtml(p) {
  return `<button type="button" class="org-node" data-id="${escOrg(p.id)}">
      <span class="org-av">${escOrg(initials(p.title))}</span>
      <span class="org-who"><b>${escOrg(p.title)}</b>${p.role ? `<span>${escOrg(p.role)}</span>` : ''}${p.apps.length ? `<span class="org-apps">${appIcons(p.apps)}</span>` : ''}</span>
    </button>`;
}
function renderTeam() {
  const list = people();
  if (!list.length) { $o('orgChart').innerHTML = '<p class="stub-note">No team members yet. Tap + Add person, then choose who they report to.</p>'; return; }
  const ids = new Set(list.map(p => p.id)), kids = {};
  list.forEach(p => { const k = ids.has(p.parent) && p.parent !== p.id ? p.parent : ''; (kids[k] = kids[k] || []).push(p); });
  const node = (p, seen) => {
    if (seen.has(p.id)) return '';
    const next = new Set(seen).add(p.id), ch = kids[p.id] || [];
    return `<li>${nodeHtml(p)}${ch.length ? `<ul>${ch.map(c => node(c, next)).join('')}</ul>` : ''}</li>`;
  };
  $o('orgChart').innerHTML = `<ul class="org-tree">${(kids[''] || []).map(p => node(p, new Set())).join('')}</ul>`;
}

/* ---------- Goals ---------- */
const METRIC = {
  cards:  { label: 'Cards sold', unit: 'cards', field: 'Target (number of cards)', ph: 'e.g. 50', hint: 'Counts cards sold from the start date up to the deadline.' },
  profit: { label: 'Net profit', unit: '', field: 'Target (PHP)', ph: 'e.g. 100000', hint: 'Sale price minus purchase cost of the cards sold, plus packaging and shipping received from buyers, minus shipping you paid, from the start date up to the deadline. Same as the cash reserves calculator. Money a customer still owes never reduces it.' },
  value:  { label: 'Business value', unit: '', field: 'Target (PHP)', ph: 'e.g. 1000000', hint: 'The total on the Finance balance card: every account plus cards on hand and pending at cost, plus receivables, less payables, measured today. The start date is not used.' }
};
const phpG = n => (n < 0 ? '-' : '') + 'PHP ' + Math.abs(Math.round(n)).toLocaleString('en-PH');
const dayFmt = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const daysTo = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/), t = new Date(); return m ? Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5) : 0; };
const goalNum = (g, n) => g.metric === 'cards' ? n.toLocaleString('en-PH') : phpG(n);

/* Progress is worked out here from the same data the other pages use (Portfolio, Balance, Finance tasks). */
let stats = null, statsAt = 0, statsBusy = null;
const needFin = () => items.some(i => i.kind === 'goal' && (i.metric === 'value' || i.metric === 'profit'));
function loadStats() {
  if (!CONFIG.portfolio.endpoint) return Promise.resolve();
  if (statsBusy) return statsBusy;
  if (stats && Date.now() - statsAt < 60000 && (!needFin() || stats.fin)) return Promise.resolve();
  statsBusy = (async () => {
    try {
      const fin = needFin();
      const [p, b, f] = await Promise.all([jsonp(api('portfolio'), 60000), fin ? jsonp(api('balance'), 60000) : null, fin ? jsonp(api('finance'), 60000) : null]);
      if (!p.ok) throw new Error(p.error || 'Unknown error');
      if (fin && (!b.ok || !f.ok)) throw new Error((b.ok ? f : b).error || 'Unknown error');
      stats = { cards: p.cards || [], fin: fin ? { balance: b.balance, interest: b.interest, tasks: (f.toRecord || []).concat(f.recorded || []) } : null }; statsAt = Date.now();
    } catch (err) { console.warn('Goal progress failed', err); toast('Could not load progress: ' + backendErr(err)); }
    statsBusy = null;
  })();
  return statsBusy;
}

/* Business value = the Finance page's grand total: what each account holds now + cards on hand at cost.
   This is a copy of computeBalance() in finance.js (without the interest history), so keep the two in step. */
const BUCKETS = ['cash', 'maribank', 'reserves', 'others'];
const DEFAULT_INTEREST = { lo: 3.25, hi: 3.75, threshold: 1000000, tax: 20, accounts: { cash: false, maribank: true, reserves: true, others: false } };
function normInterest(c) {
  const n = (v, d) => (v === '' || v == null || !isFinite(Number(v)) || Number(v) < 0) ? d : Number(v);
  c = c || {}; const a = c.accounts || {};
  return { lo: n(c.lo, DEFAULT_INTEREST.lo), hi: n(c.hi, DEFAULT_INTEREST.hi), threshold: n(c.threshold, DEFAULT_INTEREST.threshold), tax: Math.min(100, n(c.tax, DEFAULT_INTEREST.tax)),
    accounts: Object.fromEntries(BUCKETS.map(k => [k, a[k] == null ? DEFAULT_INTEREST.accounts[k] : !!a[k]])) };
}
const r2 = x => Math.round(x * 100) / 100;
const nextDay = iso => { const [y, m, d] = iso.split('-').map(Number), n = new Date(y, m - 1, d + 1), p = k => String(k).padStart(2, '0'); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; };
function bucketOf(pay) {
  const p = String(pay || '').trim().toLowerCase();
  if (!p) return '';
  if (p === 'cash') return 'cash';
  if (p.includes('maribank')) return 'maribank';
  if (/^(cash )?reserves?$/.test(p)) return 'reserves';
  return 'others';
}
function accountsNow(fin) {
  const b = fin.balance;
  if (!b) return null;
  const m = String(b.updatedAt || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/);
  const bDate = m ? m[1] : (String(b.updatedAt || '').slice(0, 10) || todayIso()), bTime = m ? m[2].padStart(5, '0') : '00:00';
  const skip = new Set((b.skip || []).map(String));
  const after = t => {
    const d = String(t.date || '').slice(0, 10);
    if (!d) return false;
    if (d !== bDate) return d > bDate;
    const tm = String(t.time || '').trim();
    return tm ? tm.padStart(5, '0') > bTime : !skip.has(String(t.id));
  };
  const daily = {}, base = { cash: +b.cash || 0, maribank: +b.maribank || 0, reserves: +b.reserves || 0, others: +b.others || 0 };
  fin.tasks.forEach(t => {
    if (t.flow !== 'inflow' && t.flow !== 'outflow') return;
    const k = bucketOf(t.payMethod);
    if (!k || !after(t)) return;
    const amt = Number(t.amount) || 0, d = String(t.date).slice(0, 10);
    (daily[k] = daily[k] || {})[d] = (daily[k][d] || 0) + (t.flow === 'inflow' ? amt : -amt);
  });
  const cfg = normInterest(fin.interest), today = todayIso();
  let total = 0;
  BUCKETS.forEach(k => {
    let cur = base[k]; const days = daily[k] || {};
    for (let d = bDate, guard = 0; d < today && guard < 4000; d = nextDay(d), guard++) {
      cur += days[d] || 0;
      if (cfg.accounts[k] && cur > 0) {
        const gross = r2(cur * (cur > cfg.threshold ? cfg.hi : cfg.lo) / 100 / 365);
        cur += r2(gross - r2(gross * cfg.tax / 100));
      }
    }
    Object.keys(days).forEach(d => { if (d >= today) cur += days[d]; });
    total += r2(cur);
  });
  return total;
}
function progressOf(g) {
  if (!stats) return null;
  const inWin = c => c.soldDate && (!g.start || c.soldDate >= g.start) && (!g.deadline || c.soldDate <= g.deadline);
  if (g.metric === 'cards') return stats.cards.filter(c => c.tag === 'sold' && inWin(c)).length;
  if (!stats.fin) return null;
  if (g.metric === 'profit') return CVWidgets.netProfit(stats.cards, stats.fin.tasks, g.start, g.deadline).net;   // same maths as the cash reserves calculator

  const accounts = accountsNow(stats.fin);
  if (accounts == null) return null;   // no starting balance saved on the Finance page yet
  const pr = CVWidgets.prTotals(stats.fin.tasks);   // receivables count in, payables come off
  return accounts + stats.cards.filter(c => c.tag === 'onhand' || c.tag === 'pending').reduce((a, c) => a + (Number(c.purchaseCost) || 0), 0) + pr.rec - pr.pay;
}
function goalState(g, cur) {
  if (cur == null) return { cls: '', badge: '', foot: '' };
  const left = daysTo(g.deadline);
  if (cur >= g.target) return { cls: 'done', badge: 'Reached', foot: left >= 0 ? (left === 0 ? 'Due today' : left + ' day' + (left === 1 ? '' : 's') + ' to spare') : 'Reached in time' };
  if (left < 0) return { cls: 'late', badge: 'Missed', foot: 'Ended ' + (-left) + ' day' + (left === -1 ? '' : 's') + ' ago' };
  return { cls: '', badge: left === 0 ? 'Due today' : left + ' day' + (left === 1 ? '' : 's') + ' left', foot: goalNum(g, g.target - cur) + (g.metric === 'cards' ? ' to go' : ' to go') };
}
function goalHtml(g) {
  const M = METRIC[g.metric] || METRIC.cards, cur = progressOf(g), st = goalState(g, cur);
  const pct = cur == null || !(g.target > 0) ? 0 : Math.max(0, Math.min(100, cur / g.target * 100));
  const range = g.metric === 'value' ? 'Before ' + dayFmt(g.deadline) : (g.start ? dayFmt(g.start) + ' to ' : 'Until ') + dayFmt(g.deadline);
  return `<div class="gl-card ${st.cls}">
      <div class="gl-head"><div><b>${escOrg(g.title)}</b><span class="gl-kind">${escOrg(M.label)}, ${escOrg(range)}</span></div>${st.badge ? `<span class="gl-badge ${st.cls}">${escOrg(st.badge)}</span>` : ''}</div>
      <div class="gl-nums"><b>${cur == null ? 'Calculating\u2026' : goalNum(g, cur) + ' of ' + goalNum(g, g.target)}</b><span>${cur == null ? '' : Math.floor(pct) + '%'}</span></div>
      <span class="gl-bar"><u style="width:${pct}%"></u></span>
      ${g.body ? `<p class="gl-note">${escOrg(g.body)}</p>` : ''}
      <div class="gl-foot"><span>${escOrg(st.foot)}</span><button type="button" class="ghost sm org-edit" data-id="${escOrg(g.id)}">Edit</button></div>
    </div>`;
}
function renderGoals() {
  const list = items.filter(i => i.kind === 'goal');
  const rank = g => { const c = progressOf(g); return c == null ? 0 : c >= g.target ? 1 : daysTo(g.deadline) < 0 ? 2 : 0; };
  list.sort((a, b) => rank(a) - rank(b) || String(a.deadline).localeCompare(String(b.deadline)));
  $o('goalList').innerHTML = list.length ? list.map(goalHtml).join('') : '<p class="stub-note">No goals yet. Tap + Add goal to set a target, like cards sold or net profit by a date.</p>';
}

/* ---------- FAQ ---------- */
function renderFaq() {
  const q = $o('faqSearch').value.trim().toLowerCase();
  let list = items.filter(i => i.kind === 'faq');
  const total = list.length;
  if (q) list = list.filter(f => (f.title + ' ' + f.body).toLowerCase().includes(q));
  $o('faqList').innerHTML = list.length ? list.map(f => `<details class="org-card">
      <summary><b>${escOrg(f.title)}</b></summary>
      <div class="org-card-body"><p class="org-text">${escOrg(f.body) || '<em>No answer yet.</em>'}</p>
        <button type="button" class="ghost sm org-edit" data-id="${escOrg(f.id)}">Edit</button></div>
    </details>`).join('') : `<p class="stub-note">${total ? 'No questions match your search.' : 'No questions yet. Tap + Add question to start the FAQ.'}</p>`;
}

function renderAll() {
  $o('orgState').hidden = true;
  if (orgTab === 'team') renderTeam();
  else if (orgTab === 'goal') { renderGoals(); loadStats().then(() => { if (orgTab === 'goal') renderGoals(); }); }
  else renderFaq();
}

/* ---------- Load ---------- */
async function loadData() {
  if (!CONFIG.portfolio.endpoint) { $o('orgState').textContent = "Sync isn't set up yet."; $o('orgState').hidden = false; return; }
  const cached = orgFirst ? cacheGet('org') : null; orgFirst = false;
  if (cached) { items = cached; renderAll(); }
  else { $o('orgState').textContent = 'Loading\u2026'; $o('orgState').hidden = false; }
  try {
    const res = await jsonp(api('organization'), 60000);
    if (!res.ok) throw new Error(res.error || 'Unknown error');
    items = (res.items || []).map(i => Object.assign({ apps: [], notifs: [], parent: '', role: '', body: '', metric: '', target: 0, start: '', deadline: '' }, i));
    cacheSet('org', items);
    if (window.CVAccess) CVAccess.update(items);   // keep this login's Home shortcuts and edit access in step with what was just saved
    renderAll();
  } catch (err) {
    console.warn('Organization load failed', err);
    if (cached) return toast('Could not refresh \u2014 showing your last saved data.');
    $o('orgState').textContent = "Couldn't load this page (offline, wrong secret, or Code.gs needs a new deployment).";
    $o('orgState').hidden = false;
  }
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab[data-otab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab[data-otab]').forEach(x => x.classList.toggle('active', x === t));
  orgTab = t.dataset.otab;
  $o('panelTeam').hidden = orgTab !== 'team'; $o('panelGoal').hidden = orgTab !== 'goal'; $o('panelFaq').hidden = orgTab !== 'faq';
  renderAll();
});
$o('faqSearch').addEventListener('input', renderFaq);

/* ---------- Person details ---------- */
let viewId = '';
function openView(id) {
  const p = findItem(id); if (!p) return;
  viewId = id;
  const boss = findItem(p.parent), team = people().filter(x => x.parent === p.id);
  const apps = p.apps.map(i => APP[i]).filter(Boolean), nts = (p.notifs || []).map(k => NOTIF_LABEL[k]).filter(Boolean);
  $o('orgViewBody').innerHTML = `<div class="org-vhead"><span class="org-av big">${escOrg(initials(p.title))}</span><div><b>${escOrg(p.title)}</b>${p.role ? `<span>${escOrg(p.role)}</span>` : ''}</div></div>
    ${boss ? `<div class="ed-row"><small>Reports to</small><span>${escOrg(boss.title)}</span></div>` : ''}
    ${team.length ? `<div class="ed-row"><small>Direct reports</small><span>${team.map(t => escOrg(t.title)).join(', ')}</span></div>` : ''}
    <div class="ed-row"><small>Description</small><span class="org-text">${p.body ? escOrg(p.body) : '<em class="ed-none">Not set</em>'}</span></div>
    <div class="ed-row"><small>Home apps</small>${apps.length ? `<div class="org-applist">${apps.map(a => `<a class="org-app" href="${a.href}"${extA(a)}><i>${appSvg(a)}</i><span><b>${escOrg(a.label)}</b>${escOrg(a.desc)}</span></a>`).join('')}</div>` : '<span><em class="ed-none">None assigned</em></span>'}</div>
    <div class="ed-row"><small>Home widgets</small><span>${nts.length ? nts.map(escOrg).join(', ') : '<em class="ed-none">None</em>'}</span></div>`;
  $o('orgView').hidden = false;
}
const closeView = () => { $o('orgView').hidden = true; viewId = ''; };
$o('orgViewClose').onclick = closeView;
$o('orgView').addEventListener('click', e => { if (e.target.id === 'orgView') closeView(); });
$o('orgViewEdit').onclick = () => { const id = viewId; closeView(); openEdit('person', id); };
$o('orgChart').addEventListener('click', e => { const n = e.target.closest('.org-node'); if (n) openView(n.dataset.id); });
['goalList', 'faqList'].forEach(l => $o(l).addEventListener('click', e => { const b = e.target.closest('.org-edit'); if (b) openEdit(findItem(b.dataset.id).kind, b.dataset.id); }));

/* ---------- Add / edit ---------- */
const FORM = {
  person:  { add: 'Add person', edit: 'Edit person', title: 'Name', role: 'Role / position', body: 'What they do', apps: 'Home apps (shortcuts)', parent: true },
  goal:    { add: 'Add goal', edit: 'Edit goal', title: 'Goal name', role: null, body: 'Notes (optional)', apps: null, parent: false },
  faq:     { add: 'Add question', edit: 'Edit question', title: 'Question', role: null, body: 'Answer', apps: null, parent: false }
};
let editId = '', editKind = 'person', pickedApps = [], pickedNotifs = [];
const NOTIF_LABEL = Object.fromEntries(CVWidgets.CATALOG.reduce((a, g) => a.concat(g.items.map(i => [i.key, i.label])), []));
function renderNotifPicker() {
  $o('orgNotifs').innerHTML = CVWidgets.CATALOG.map(g => `<div class="nt-grp"><b>${escOrg(g.group)}</b>${g.items.map(i => `<label class="port-chk"><input type="checkbox" value="${i.key}"${pickedNotifs.includes(i.key) ? ' checked' : ''}><span>${escOrg(i.label)} <small>${escOrg(i.hint)}</small></span></label>`).join('')}</div>`).join('');
}
$o('orgNotifs').addEventListener('change', e => { if (e.target.matches('input[type=checkbox]')) pickedNotifs = [...$o('orgNotifs').querySelectorAll('input:checked')].map(i => i.value); });
function renderPicker() {
  $o('orgApps').innerHTML = APPS.map(a => `<button type="button" class="org-pick${pickedApps.includes(a.id) ? ' on' : ''}" data-app="${a.id}" aria-pressed="${pickedApps.includes(a.id)}">${appSvg(a)}<span>${escOrg(a.label)}</span></button>`).join('');
}
$o('orgApps').addEventListener('click', e => {
  const b = e.target.closest('.org-pick'); if (!b) return;
  const id = b.dataset.app;
  pickedApps = pickedApps.includes(id) ? pickedApps.filter(x => x !== id) : pickedApps.concat(id);
  renderPicker();
});
function descendants(id) {
  const out = new Set([id]); let grew = true;
  while (grew) { grew = false; people().forEach(p => { if (!out.has(p.id) && out.has(p.parent)) { out.add(p.id); grew = true; } }); }
  return out;
}
function openEdit(kind, id) {
  const it = id ? findItem(id) : null, F = FORM[kind];
  editKind = kind; editId = it ? it.id : '';
  $o('orgHeading').textContent = it ? F.edit : F.add;
  $o('orgLTitle').textContent = F.title; $o('orgLBody').textContent = F.body;
  $o('orgTitle').value = it ? it.title : '';
  $o('orgRoleWrap').hidden = F.role === null; if (F.role) $o('orgLRole').textContent = F.role;
  $o('orgRole').value = it ? it.role : '';
  $o('orgBody').value = it ? it.body : '';
  $o('orgAppsWrap').hidden = F.apps === null; if (F.apps) $o('orgLApps').textContent = F.apps;
  pickedApps = it ? it.apps.slice() : []; renderPicker();
  $o('orgNotifWrap').hidden = kind !== 'person';
  pickedNotifs = it && it.notifs ? it.notifs.filter(k => NOTIF_LABEL[k]) : []; renderNotifPicker();   // alerts from before widgets existed are dropped
  $o('orgGoalWrap').hidden = kind !== 'goal';
  if (kind === 'goal') {
    $o('orgMetric').value = it && METRIC[it.metric] ? it.metric : 'cards';
    $o('orgTarget').value = it && it.target ? it.target : '';
    $o('orgStart').value = it ? it.start : todayIso();
    $o('orgDeadline').value = it ? it.deadline : '';
    metricHint();
  }
  $o('orgParentWrap').hidden = !F.parent;
  if (F.parent) {
    const banned = it ? descendants(it.id) : new Set();
    $o('orgParent').innerHTML = '<option value="">Top of the chart</option>' + people().filter(p => !banned.has(p.id)).map(p => `<option value="${escOrg(p.id)}">${escOrg(p.title)}${p.role ? ' \u00b7 ' + escOrg(p.role) : ''}</option>`).join('');
    $o('orgParent').value = it && !banned.has(it.parent) ? it.parent : '';
  }
  $o('orgDelete').hidden = !it;
  $o('orgSheet').hidden = false;
  if (!it) $o('orgTitle').focus();
}
function metricHint() {
  const M = METRIC[$o('orgMetric').value];
  $o('orgLTarget').textContent = M.field; $o('orgTarget').placeholder = M.ph; $o('orgGoalHint').textContent = M.hint;
}
$o('orgMetric').addEventListener('change', metricHint);
const closeEdit = () => { $o('orgSheet').hidden = true; editId = ''; };
$o('addPerson').onclick = () => openEdit('person', '');
$o('addGoal').onclick = () => openEdit('goal', '');
$o('addFaq').onclick = () => openEdit('faq', '');
$o('orgCancel').onclick = closeEdit;
$o('orgSheet').addEventListener('click', e => { if (e.target.id === 'orgSheet') closeEdit(); });

async function send(btn, busyText, action, params, okMsg, failMsg) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = busyText;
  try {
    const res = await jsonp(api(action, params), 60000);
    if (!res.ok) throw new Error(res.error || 'Request failed');
    closeEdit(); toast(okMsg);
    await loadData();
  } catch (err) { toast(failMsg + backendErr(err)); }
  btn.disabled = false; btn.textContent = label;
}
$o('orgSave').onclick = () => {
  const F = FORM[editKind], title = $o('orgTitle').value.trim().replace(/\s+/g, ' ');
  if (!title) return toast(`Enter the ${F.title.toLowerCase()}.`);
  const goal = {};
  if (editKind === 'goal') {
    const target = parseFloat($o('orgTarget').value), start = $o('orgStart').value, deadline = $o('orgDeadline').value;
    if (!(target > 0)) return toast('Enter a target above zero.');
    if (!deadline) return toast('Pick the date to reach it by.');
    if (start && start > deadline) return toast('"Count from" must be before the deadline.');
    Object.assign(goal, { metric: $o('orgMetric').value, target, start, deadline });
  }
  send($o('orgSave'), 'Saving\u2026', 'saveOrgItem', Object.assign({
    id: editId, kind: editKind, title,
    role: F.role === null ? '' : $o('orgRole').value.trim(),
    parent: F.parent ? $o('orgParent').value : '',
    apps: F.apps === null ? '' : pickedApps.join('|'),
    notifs: editKind === 'person' ? pickedNotifs.join('|') : '',
    body: $o('orgBody').value.trim()
  }, goal), 'Saved.', 'Could not save: ');
};
$o('orgDelete').onclick = () => {
  const it = findItem(editId); if (!it) return;
  const extra = it.kind === 'person' && people().some(p => p.parent === it.id) ? '\n\nTheir direct reports will move up to whoever they reported to.' : '';
  if (!confirm(`Delete "${it.title}"?${extra}`)) return;
  send($o('orgDelete'), 'Deleting\u2026', 'deleteOrgItem', { id: it.id }, 'Deleted.', 'Could not delete: ');
};

loadData();
