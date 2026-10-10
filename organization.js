/* ---------- Organization — org chart (people and the apps each one uses), business processes and FAQ ---------- */
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
  { id: 'organization', label: 'Organization', href: 'organization.html', desc: 'Team chart, business processes and FAQ.',
    svg: '<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="2.5" y="16" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M5.5 16v-4h13v4"/>' },
  { id: 'settings', label: 'Settings', href: 'settings.html', desc: 'App settings.',
    svg: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/>' }
];
const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
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

/* ---------- Processes ---------- */
const stepsOf = body => String(body || '').split(/\r?\n/).map(s => s.replace(/^\s*(\d+[.)]|[-*\u2022])\s*/, '').trim()).filter(Boolean);
function renderProcs() {
  const list = items.filter(i => i.kind === 'process');
  $o('procList').innerHTML = list.length ? list.map(p => `<details class="org-card">
      <summary><b>${escOrg(p.title)}</b>${p.role ? `<span>Owner: ${escOrg(p.role)}</span>` : ''}</summary>
      <div class="org-card-body">
        ${stepsOf(p.body).length ? `<ol>${stepsOf(p.body).map(s => `<li>${escOrg(s)}</li>`).join('')}</ol>` : '<p class="stub-note">No steps written yet.</p>'}
        ${p.apps.length ? `<div class="org-apps-line"><small>Apps used</small>${p.apps.map(i => APP[i]).filter(Boolean).map(a => `<a class="org-chip" href="${a.href}">${appSvg(a)}${escOrg(a.label)}</a>`).join('')}</div>` : ''}
        <button type="button" class="ghost sm org-edit" data-id="${escOrg(p.id)}">Edit</button>
      </div>
    </details>`).join('') : '<p class="stub-note">No processes yet. Tap + Add process to write down how something is done.</p>';
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
  if (orgTab === 'team') renderTeam(); else if (orgTab === 'proc') renderProcs(); else renderFaq();
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
    items = (res.items || []).map(i => Object.assign({ apps: [], parent: '', role: '', body: '' }, i));
    cacheSet('org', items);
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
  $o('panelTeam').hidden = orgTab !== 'team'; $o('panelProc').hidden = orgTab !== 'proc'; $o('panelFaq').hidden = orgTab !== 'faq';
  renderAll();
});
$o('faqSearch').addEventListener('input', renderFaq);

/* ---------- Person details ---------- */
let viewId = '';
function openView(id) {
  const p = findItem(id); if (!p) return;
  viewId = id;
  const boss = findItem(p.parent), team = people().filter(x => x.parent === p.id);
  const apps = p.apps.map(i => APP[i]).filter(Boolean);
  $o('orgViewBody').innerHTML = `<div class="org-vhead"><span class="org-av big">${escOrg(initials(p.title))}</span><div><b>${escOrg(p.title)}</b>${p.role ? `<span>${escOrg(p.role)}</span>` : ''}</div></div>
    ${boss ? `<div class="ed-row"><small>Reports to</small><span>${escOrg(boss.title)}</span></div>` : ''}
    ${team.length ? `<div class="ed-row"><small>Direct reports</small><span>${team.map(t => escOrg(t.title)).join(', ')}</span></div>` : ''}
    <div class="ed-row"><small>Description</small><span class="org-text">${p.body ? escOrg(p.body) : '<em class="ed-none">Not set</em>'}</span></div>
    <div class="ed-row"><small>Apps</small>${apps.length ? `<div class="org-applist">${apps.map(a => `<a class="org-app" href="${a.href}"><i>${appSvg(a)}</i><span><b>${escOrg(a.label)}</b>${escOrg(a.desc)}</span></a>`).join('')}</div>` : '<span><em class="ed-none">No apps assigned</em></span>'}</div>`;
  $o('orgView').hidden = false;
}
const closeView = () => { $o('orgView').hidden = true; viewId = ''; };
$o('orgViewClose').onclick = closeView;
$o('orgView').addEventListener('click', e => { if (e.target.id === 'orgView') closeView(); });
$o('orgViewEdit').onclick = () => { const id = viewId; closeView(); openEdit('person', id); };
$o('orgChart').addEventListener('click', e => { const n = e.target.closest('.org-node'); if (n) openView(n.dataset.id); });
['procList', 'faqList'].forEach(l => $o(l).addEventListener('click', e => { const b = e.target.closest('.org-edit'); if (b) openEdit(findItem(b.dataset.id).kind, b.dataset.id); }));

/* ---------- Add / edit ---------- */
const FORM = {
  person:  { add: 'Add person', edit: 'Edit person', title: 'Name', role: 'Role / position', body: 'What they do', apps: 'Apps they use', parent: true },
  process: { add: 'Add process', edit: 'Edit process', title: 'Process name', role: 'Owner (optional)', body: 'Steps (one per line)', apps: 'Apps used', parent: false },
  faq:     { add: 'Add question', edit: 'Edit question', title: 'Question', role: null, body: 'Answer', apps: null, parent: false }
};
let editId = '', editKind = 'person', pickedApps = [];
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
const closeEdit = () => { $o('orgSheet').hidden = true; editId = ''; };
$o('addPerson').onclick = () => openEdit('person', '');
$o('addProc').onclick = () => openEdit('process', '');
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
  send($o('orgSave'), 'Saving\u2026', 'saveOrgItem', {
    id: editId, kind: editKind, title,
    role: F.role === null ? '' : $o('orgRole').value.trim(),
    parent: F.parent ? $o('orgParent').value : '',
    apps: F.apps === null ? '' : pickedApps.join('|'),
    body: $o('orgBody').value.trim()
  }, 'Saved.', 'Could not save: ');
};
$o('orgDelete').onclick = () => {
  const it = findItem(editId); if (!it) return;
  const extra = it.kind === 'person' && people().some(p => p.parent === it.id) ? '\n\nTheir direct reports will move up to whoever they reported to.' : '';
  if (!confirm(`Delete "${it.title}"?${extra}`)) return;
  send($o('orgDelete'), 'Deleting\u2026', 'deleteOrgItem', { id: it.id }, 'Deleted.', 'Could not delete: ');
};

loadData();
