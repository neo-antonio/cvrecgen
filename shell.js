/* ---------- App shell: sidebar on desktop, top bar + drawer on mobile ----------
   Add this to the <head> of every page, right after the styles.css link:
     <script src="shell.js"></script>
   It marks the page as having a shell immediately (so nothing jumps), then builds the menu once the page is parsed. */
(function () {
  document.documentElement.classList.add('has-shell');

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
    settings: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; };

  // [icon key, label, page]
  var GROUPS = [
    ['Workspace', [['home', 'Home', 'index.html']]],
    ['Operations', [['receipt', 'Receipt', 'receipt.html'], ['portfolio', 'Portfolio', 'portfolio.html'], ['shipping', 'Shipping', 'shipping.html']]],
    ['Money', [['finance', 'Finance', 'finance.html'], ['charts', 'Charts', '#charts']]],
    ['Marketing', [['marketing', 'Marketing', 'marketing.html'], ['creatives', 'Creatives', 'creatives.html']]],
    ['Team', [['calendar', 'Calendar', 'calendar.html'], ['organization', 'Organization', 'organization.html']]]
  ];
  var ALIAS = { 'receipts.html': 'receipt.html', '': 'index.html' };
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  page = ALIAS[page] || page;

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var link = function (it) {
    var on = it[2] === page;
    return '<a class="sb-link' + (on ? ' on' : '') + '" href="' + (it[2] === '#charts' ? '#' : it[2]) + '"' + (it[2] === '#charts' ? ' data-charts="1"' : '') + (on ? ' aria-current="page"' : '') + '>' + svg(it[0]) + '<span>' + esc(it[1]) + '</span></a>';
  };
  var logo = '<span class="sb-logo" aria-hidden="true">t</span>';

  function build() {
    var body = document.body;

    var bar = document.createElement('div');
    bar.className = 'appbar';
    bar.innerHTML = '<a class="sb-brand" href="index.html">' + logo + '<b>trackello</b></a>'
      + '<button type="button" class="sb-menu" aria-label="Open menu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>';

    var aside = document.createElement('aside');
    aside.className = 'sb';
    aside.setAttribute('aria-label', 'Main menu');
    aside.innerHTML = '<a class="sb-brand" href="index.html">' + logo + '<b>trackello</b></a>'
      + '<div class="sb-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg><input type="search" id="sbFind" placeholder="Search menu" autocomplete="off" aria-label="Search menu"></div>'
      + '<nav class="sb-nav">' + GROUPS.map(function (g) { return '<div class="sb-group"><p class="sb-lbl">' + esc(g[0]) + '</p>' + g[1].map(link).join('') + '</div>'; }).join('') + '</nav>'
      + '<div class="sb-foot"><a class="sb-link' + (page === 'settings.html' ? ' on' : '') + '" href="settings.html">' + svg('settings') + '<span>Settings</span></a>'
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
