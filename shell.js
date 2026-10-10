/* ---------- App shell: sidebar on desktop, top bar + drawer on mobile ----------
   Add this to the <head> of every page, right after the styles.css link:
     <script src="shell.js"></script>
   It marks the page as having a shell immediately (so nothing jumps), then builds the menu once the page is parsed. */
(function () {
  document.documentElement.classList.add('has-shell');
  // folder prefix back to the site root, taken from how this script was loaded ("" on normal pages, "../" inside chatbot/)
  var BASE = (document.currentScript && document.currentScript.getAttribute('src') || 'shell.js').replace(/shell\.js.*$/, '');


  /* ---------- Login gate + auth helpers (window.CVAuth) ----------
     Every page loads this file, so every page asks for a login. The check is a front-end gate only. */
  var SESSION_KEY = 'cv_auth', ADMIN = 'neo';
  var cap = function (n) { n = String(n || ''); return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); };
  var REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
  // "Remember me" sessions live in localStorage for 7 days; otherwise the login only lasts until the browser/tab is closed (sessionStorage)
  var readSession = function (store, needExp) {
    try { var s = JSON.parse(store.getItem(SESSION_KEY)); if (s && s.user && (needExp ? s.exp > Date.now() : true)) return s; } catch (e) {}
    return null;
  };
  var curUser = function () { var s = readSession(sessionStorage, false) || readSession(localStorage, true); return s ? String(s.user).toLowerCase() : ''; };
  if (!curUser()) document.documentElement.classList.add('cv-locked');

  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.6 7 10 7a10 10 0 004.2-.9"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>';

  var css = document.createElement('style');
  css.textContent = 'html.cv-locked,html.cv-locked body{overflow:hidden}'
    + 'html.cv-locked body>*{visibility:hidden}html.cv-locked body>#cvLogin{visibility:visible}'
    + '#cvLogin{left:0!important;right:0;z-index:2000}'
    + '.cv-pw{position:relative}.cv-pw input{padding-right:44px}'
    + '.cv-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;background:none;color:var(--mut,#737373);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}'
    + '.cv-eye svg{width:20px;height:20px}.cv-err{color:#c0392b;font-size:13px;margin:0 0 12px}';
  document.head.appendChild(css);

  // JSONP call to the Apps Script backend (net.js is not loaded on every page, so this file carries its own)
  function call(action, params) {
    return new Promise(function (resolve, reject) {
      if (typeof CONFIG === 'undefined' || !CONFIG.portfolio || !CONFIG.portfolio.endpoint) return reject(new Error('Sync is not set up (config.js is not loaded on this page).'));
      var cb = 'cvAuth_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), sc = document.createElement('script'), done = false, timer;
      var end = function (fn, v) { if (done) return; done = true; clearTimeout(timer); delete window[cb]; sc.remove(); fn(v); };
      timer = setTimeout(function () { end(reject, new Error('The server took too long to answer. Try again.')); }, 25000);
      window[cb] = function (d) { end(resolve, d); };
      sc.onerror = function () { end(reject, new Error('Could not reach the server. Check your connection.')); };
      sc.src = CONFIG.portfolio.endpoint + '?action=' + action + Object.keys(params || {}).map(function (k) { return '&' + k + '=' + encodeURIComponent(params[k]); }).join('')
        + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret) + '&callback=' + cb;
      document.head.appendChild(sc);
    });
  }
  var check = function (d) {
    if (d && d.ok) return d;
    var e = d && d.error;
    throw new Error(e === 'unknown action' ? 'Logins are not set up on the server yet. Deploy the updated Code.gs first.' : e === 'unauthorized' ? 'The app secret does not match the server.' : (e || 'Something went wrong.'));
  };

  window.CVAuth = {
    user: curUser,
    name: function () { return cap(curUser()); },
    isAdmin: function () { return curUser() === ADMIN; },
    login: function (u, p, remember) {
      return call('login', { user: String(u || '').trim().toLowerCase(), pass: p }).then(check).then(function (d) {
        try {
          localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY);
          if (remember) localStorage.setItem(SESSION_KEY, JSON.stringify({ user: d.user, at: Date.now(), exp: Date.now() + REMEMBER_MS }));
          else sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: d.user, at: Date.now() }));
        } catch (e) {}
        return d.user;
      });
    },
    logout: function () { try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) {} location.reload(); },
    changePassword: function (cur, next) { return call('changePassword', { user: curUser(), pass: cur, newPass: next }).then(check); },
    listUsers: function (pass) { return call('listUsers', { user: curUser(), pass: pass }).then(check).then(function (d) { return d.users || []; }); },
    // wraps a password input with a show/hide eye button
    attachEye: function (input) {
      var wrap = document.createElement('div'); wrap.className = 'cv-pw';
      input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cv-eye'; b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false'); b.innerHTML = EYE;
      b.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-pressed', show ? 'true' : 'false'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.innerHTML = show ? EYE_OFF : EYE;
      });
      wrap.appendChild(b);
    }
  };

  function buildGate() {
    var box = document.createElement('div');
    box.id = 'cvLogin'; box.className = 'modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'cvLoginH');
    box.innerHTML = '<div class="sheet small wide"><h3 id="cvLoginH">Please login to continue</h3>'
      + '<div class="field"><label for="cvU">Username</label><input type="text" id="cvU" autocomplete="username" autocapitalize="none" spellcheck="false"></div>'
      + '<div class="field"><label for="cvP">Password</label><input type="password" id="cvP" autocomplete="current-password"></div>'
      + '<div class="field"><label class="port-chk"><input type="checkbox" id="cvRem"><span>Remember me for 7 days</span></label></div>'
      + '<p class="cv-err" id="cvErr" hidden></p>'
      + '<div class="acts"><button type="button" class="go sm" id="cvGo">Log in</button></div></div>';
    document.body.appendChild(box);
    var u = box.querySelector('#cvU'), p = box.querySelector('#cvP'), go = box.querySelector('#cvGo'), err = box.querySelector('#cvErr');
    window.CVAuth.attachEye(p);
    var busy = false;
    var submit = function () {
      if (busy) return;
      if (!u.value.trim() || !p.value) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
      busy = true; go.disabled = true; go.textContent = 'Checking\u2026'; err.hidden = true;
      window.CVAuth.login(u.value, p.value, box.querySelector('#cvRem').checked).then(function () { location.reload(); }).catch(function (e) {
        err.textContent = e && e.message || 'Could not log in.'; err.hidden = false; busy = false; go.disabled = false; go.textContent = 'Log in'; p.focus();
      });
    };
    go.addEventListener('click', submit);
    [u, p].forEach(function (el) { el.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); });
    u.focus();
  }

  var ICON = {
    home: '<path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-4.5v-6h-5v6H5a1 1 0 01-1-1z"/>',
    receipt: '<path d="M6 2.2h12v19.6l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-2 1.1z"/><line x1="8.2" y1="7" x2="15.8" y2="7"/><line x1="8.2" y1="11" x2="15.8" y2="11"/><line x1="8.2" y1="15" x2="13" y2="15"/>',
    portfolio: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c2.9 3 2.9 9.9 0 12.8M18.4 5.6c-2.9 3-2.9 9.9 0 12.8"/>',
    shipping: '<path d="M1.5 6.5h12.5v10.5h-12.5z"/><path d="M14 9.8h4.2l3.3 3.3v3.9h-7.5z"/><circle cx="6" cy="18.6" r="1.9"/><circle cx="17.8" cy="18.6" r="1.9"/>',
    finance: '<path d="M3 6.5h14.5a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3z"/><path d="M3 6.5V5a2 2 0 012-2h9.5"/><circle cx="16.3" cy="13.7" r="1.3" fill="currentColor" stroke="none"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.8v3.4M16 2.8v3.4"/>',
    marketing: '<circle cx="12" cy="7.8" r="4"/><path d="M4.2 20.5c0-4.3 3.5-6.8 7.8-6.8s7.8 2.5 7.8 6.8"/>',
    charts: '<rect x="3.5" y="12" width="4.5" height="8.5" rx=".8"/><rect x="9.75" y="7" width="4.5" height="13.5" rx=".8"/><rect x="16" y="3.5" width="4.5" height="17" rx=".8"/>',
    creatives: '<path d="M12 3a9 9 0 100 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.5-1-2.7 0-1 .8-1.7 1.9-1.7H17a4 4 0 004-4C21 6.6 17 3 12 3z"/><circle cx="7.6" cy="11.2" r="1" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.4" r="1" fill="currentColor" stroke="none"/>',
    organization: '<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="2.5" y="16" width="6" height="5" rx="1.2"/><rect x="15.5" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M5.5 16v-4h13v4"/>',
    backend: '<rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><circle cx="7" cy="7" r=".9" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".9" fill="currentColor" stroke="none"/><path d="M11 7h6M11 17h6"/>',
    social: '<circle cx="18" cy="5.5" r="2.7"/><circle cx="6" cy="12" r="2.7"/><circle cx="18" cy="18.5" r="2.7"/><path d="M8.4 10.7l7.2-3.9M8.4 13.3l7.2 3.9"/>',
    assistant: '<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 014 13.5z"/><circle cx="9" cy="9.5" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="9.5" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r=".9" fill="currentColor" stroke="none"/>',
    settings: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; };

  // [icon key, label, page]
  var GROUPS = [
    ['Workspace', [['home', 'Home', 'index.html']]],
    ['Assistant', [['assistant', 'Assistant', 'chatbot/index.html']]],
    ['Operations', [['receipt', 'Receipt', 'receipt.html'], ['portfolio', 'Portfolio', 'portfolio.html'], ['shipping', 'Shipping', 'shipping.html']]],
    ['Money', [['finance', 'Finance', 'finance.html'], ['charts', 'Charts', '#charts']]],
    ['Marketing', [['marketing', 'Marketing', 'marketing.html'], ['creatives', 'Creatives', 'creatives.html'], ['social', 'Social Media', '#social']]],
    ['Team', [['calendar', 'Calendar', 'calendar.html'], ['organization', 'Organization', 'organization.html']]]
  ];
  var BACKEND_URL = 'https://docs.google.com/spreadsheets/d/1It4a7gEvyxr-gz4SL6gClC84o6mfxjr9Ooho_DxjL9o/edit?gid=1823529634#gid=1823529634';
  var SOCIAL = [['Facebook', 'https://www.facebook.com/courtvisioncollection'], ['Instagram', 'https://www.instagram.com/courtvisioncollection'], ['TikTok', 'https://www.tiktok.com/@courtvisioncollection'], ['YouTube', 'https://www.youtube.com/@courtvisioncollection']];
  var ALIAS = { 'receipts.html': 'receipt.html', '': 'index.html' };
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  page = ALIAS[page] || page;
  if (/\/chatbot\/[^/]*$/i.test(location.pathname)) page = 'chatbot/index.html';

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var link = function (it) {
    var on = it[2] === page, u = it[2];
    if (u === '#charts') return '<a class="sb-link" href="#" data-charts="1">' + svg(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
    if (u === '#social') return '<a class="sb-link" href="#" data-social="1">' + svg(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
    if (/^https?:/.test(u)) return '<a class="sb-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + svg(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
    return '<a class="sb-link' + (on ? ' on' : '') + '" href="' + BASE + u + '"' + (on ? ' aria-current="page"' : '') + '>' + svg(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
  };
  var logo = '<span class="sb-logo" aria-hidden="true">t</span>';

  function build() {
    var body = document.body;
    if (!curUser()) buildGate();

    var bar = document.createElement('div');
    bar.className = 'appbar';
    bar.innerHTML = '<a class="sb-brand" href="' + BASE + 'index.html">' + logo + '<b>trackello</b></a>'
      + '<button type="button" class="sb-menu" aria-label="Open menu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>';

    var aside = document.createElement('aside');
    aside.className = 'sb';
    aside.setAttribute('aria-label', 'Main menu');
    aside.innerHTML = '<a class="sb-brand" href="' + BASE + 'index.html">' + logo + '<b>trackello</b></a>'
      + '<div class="sb-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input type="search" id="sbFind" placeholder="Search menu" autocomplete="off" aria-label="Search menu"></div>'
      + '<nav class="sb-nav">' + GROUPS.map(function (g) { return '<div class="sb-group"><p class="sb-lbl">' + esc(g[0]) + '</p>' + g[1].map(link).join('') + '</div>'; }).join('') + '</nav>'
      + '<div class="sb-foot">' + link(['backend', 'Backend', BACKEND_URL]) + '<a class="sb-link' + (page === 'settings.html' ? ' on' : '') + '" href="' + BASE + 'settings.html">' + svg('settings') + '<span>Settings</span></a>'
      + '<p>&copy;2026 Court Vision</p></div>';

    var scrim = document.createElement('div');
    scrim.className = 'sb-scrim';

    body.insertBefore(bar, body.firstChild);
    body.appendChild(aside);
    body.appendChild(scrim);

    var root = document.documentElement, btn = bar.querySelector('.sb-menu');
    var setOpen = function (open) { root.classList.toggle('sb-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    btn.addEventListener('click', function () { setOpen(!root.classList.contains('sb-open')); });
    scrim.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    // menu search: hides links that do not match, and groups left empty
    aside.querySelector('#sbFind').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      aside.querySelectorAll('.sb-group').forEach(function (g) {
        var any = false;
        g.querySelectorAll('.sb-link').forEach(function (a) { var hit = !q || a.textContent.toLowerCase().indexOf(q) >= 0; a.hidden = !hit; if (hit) any = true; });
        g.hidden = !any;
      });
    });

    // Social Media: popup asking which platform to open
    var sheet = document.createElement('div');
    sheet.className = 'modal'; sheet.hidden = true;
    sheet.innerHTML = '<div class="sheet small"><h3>Open which platform?</h3><div class="acts">'
      + SOCIAL.map(function (p) { return '<a class="ghost" href="' + esc(p[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(p[0]) + '</a>'; }).join('')
      + '<button type="button" class="ghost">Cancel</button></div></div>';
    body.appendChild(sheet);
    var closeSocial = function () { sheet.hidden = true; };
    sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.closest('a') || e.target.closest('button')) closeSocial(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSocial(); });
    aside.querySelector('[data-social]').addEventListener('click', function (e) { e.preventDefault(); setOpen(false); sheet.hidden = false; });

    // Charts opens the link from config.js in a new tab (same behaviour as the home tile)
    aside.querySelector('[data-charts]').addEventListener('click', function (e) {
      e.preventDefault();
      var url = typeof CONFIG !== 'undefined' && CONFIG.chartsUrl;
      if (url) { window.open(url, '_blank', 'noopener'); return; }
      var t = document.createElement('div');
      t.className = 'toast'; t.textContent = 'Charts link is not set yet. Add chartsUrl in config.js.';
      document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); setOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
