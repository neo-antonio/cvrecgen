/* ---------- Socials — Facebook insights (entered by hand: daily / weekly / monthly / all time) and the Planner ----------
   Backend: Code.gs socials / saveSocialDay / saveSocialPanel / setPostViews, plus creatives / saveCreative / deleteCreative.
   Nothing is pulled from Facebook: every number is typed in.
   Planner: a week view. Done video and post tasks sit on their planned day and hour. Faded = done but not posted yet (tap to post it with its Facebook link);
   solid = posted (tap for the embed, views and link). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const php = n => 'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseIso = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const todayIso = () => isoOf(new Date());
  const shortDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const longDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  /* 'yyyy-MM-dd HH:mm' -> 'Oct 31, 2026, 3:45 PM' */
  function fmtStamp(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/); if (!m) return '';
    const dt = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + (m[4] == null ? '' : ', ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
  }
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const fbUrl = u => /^https?:\/\/([\w-]+\.)*(facebook\.com|fb\.com|fb\.watch|fb\.me)\//i.test(String(u || ''));
  const api = (action, params = {}) => CONFIG.portfolio.endpoint + '?action=' + action
    + Object.keys(params).map(k => '&' + k + '=' + encodeURIComponent(params[k])).join('')
    + '&secret=' + encodeURIComponent(CONFIG.portfolio.secret);
  const backendErr = err => err && err.message === 'unknown action' ? 'Code.gs needs the latest version deployed' : (err && err.message) || 'Something went wrong';
  let toastT;
  function toast(m) { const t = $('soToast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
  async function call(action, params, ms) {
    const res = await jsonp(api(action, params), ms || 45000);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Request failed');
    return res;
  }

  let tab = 'insights', view = 'day', vMode = 'views';   // vMode: what the top chart shows (views | both | reach)
  const startOfWeek = d => addDays(d, -d.getDay());   // weeks start on Sunday, like Meta's planner
  let weekStart = startOfWeek(new Date()), selDay = todayIso();
  let soc = { fb: { daily: [], meta: {} }, ig: { daily: [], meta: {} }, configured: false }, cre = { videos: [], posts: [] };
  let plat = 'all';   // Insights channel filter: all | fb | ig (everything is shown by default)
  let charts = {}, busy = false;

  /* ================= Insights ================= */
  const FIELDS = ['views', 'reach', 'eng', 'fol', 'unf'];
  const sumRange = (rows, from, to) => {
    const a = isoOf(from), b = isoOf(to), o = { views: 0, reach: 0, eng: 0, fol: 0, unf: 0 };
    rows.forEach(r => { if (r.d >= a && r.d <= b) FIELDS.forEach(f => { o[f] += r[f] || 0; }); });
    o.net = o.fol - o.unf;
    return o;
  };
  const PNAME = { fb: 'Facebook', ig: 'Instagram', all: 'Facebook + Instagram' };
  const normSoc = r => ({ fb: { daily: (r && r.daily) || [], meta: (r && r.meta) || {} }, ig: { daily: (r && r.ig && r.ig.daily) || [], meta: (r && r.ig && r.ig.meta) || {} }, configured: !!(r && r.configured) });
  /* two channels added together: one row per date; total followers = each channel's latest known total on or before that date, added up */
  function mergeDaily(a, b) {
    const dates = {}, maps = [a, b].map(list => { const m = {}; list.forEach(r => { m[r.d] = r; dates[r.d] = true; }); return m; }), last = [null, null], out = [];
    Object.keys(dates).sort().forEach(d => {
      const row = { d, views: 0, reach: 0, eng: 0, fol: 0, unf: 0, tot: null };
      maps.forEach((m, i) => { const r = m[d]; if (r) { FIELDS.forEach(f => { row[f] += r[f] || 0; }); if (r.tot != null) last[i] = r.tot; } });
      row.tot = last[0] == null && last[1] == null ? null : (last[0] || 0) + (last[1] || 0);
      out.push(row);
    });
    return out;
  }
  /* all-time panels of both channels added together (followers vs non-followers, and traffic sources by name) */
  function mergeMeta(a, b) {
    const out = {}, both = k => [a[k], b[k]].filter(Boolean), newest = list => list.map(x => x.updated || '').sort().pop() || '';
    const au = both('audience');
    if (au.length) out.audience = { value: { followers: au.reduce((n, x) => n + (Number(x.value.followers) || 0), 0), nonFollowers: au.reduce((n, x) => n + (Number(x.value.nonFollowers) || 0), 0) }, updated: newest(au) };
    const tr = both('traffic');
    if (tr.length) { const m = {}; tr.forEach(x => (x.value.items || []).forEach(i => { m[i.label] = (m[i.label] || 0) + (Number(i.value) || 0); })); out.traffic = { value: { items: Object.keys(m).map(k => ({ label: k, value: m[k] })) }, updated: newest(tr) }; }
    return out;
  }
  const V = () => plat === 'fb' ? soc.fb : plat === 'ig' ? soc.ig : { daily: mergeDaily(soc.fb.daily, soc.ig.daily), meta: mergeMeta(soc.fb.meta, soc.ig.meta) };
  function setPlatHeader() {
    const ic = $('soPlatIcon');
    ic.className = plat === 'ig' ? 'so-ig' : plat === 'fb' ? 'so-fb' : 'so-both';
    ic.textContent = plat === 'ig' ? 'IG' : plat === 'fb' ? 'f' : 'All';
    $('soPlatName').textContent = PNAME[plat];
    $('soOpen').hidden = plat !== 'fb';
    $('soPlat').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.p === plat ? 'true' : 'false'));
  }
  /* total followers at the end of a period: the latest known value on or before that day */
  function totAt(rows, end) {
    const b = isoOf(end); let v = null;
    for (const r of rows) { if (r.d > b) break; if (r.tot != null) v = r.tot; }
    return v;
  }
  /* buckets of `size` days anchored on the newest day with data (daily 1, weekly 7, monthly 30); All time uses calendar months */
  function buckets(rows) {
    const out = [];
    if (!rows.length) return out;
    const last = parseIso(rows[rows.length - 1].d);
    if (view === 'all') {
      const first = parseIso(rows[0].d);
      let y = first.getFullYear(), m = first.getMonth();
      while (y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth())) {
        const from = new Date(y, m, 1), to = new Date(y, m + 1, 0);
        out.push({ from, to, label: from.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
        m++; if (m > 11) { m = 0; y++; }
      }
    } else {
      const size = view === 'day' ? 1 : view === 'week' ? 7 : 30, count = view === 'day' ? 30 : 12;
      for (let i = count - 1; i >= 0; i--) {
        const to = addDays(last, -i * size), from = addDays(to, -(size - 1));
        out.push({ from, to, label: size === 1 ? shortDay(to) : shortDay(from) + '\u2013' + shortDay(to) });
      }
    }
    out.forEach(b => { Object.assign(b, sumRange(rows, b.from, b.to)); b.tot = totAt(rows, b.to); });
    return out;
  }

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const rgba = (hex, a) => { const m = hex.replace('#', ''), n = parseInt(m, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const COL = { blue: '#3b82f6', orange: '#f29900', verm: '#e8501b', green: '#15803d', ink: '#171717' };

  function setupChartDefaults() {
    if (!window.Chart || setupChartDefaults.done) return; setupChartDefaults.done = true;
    const D = Chart.defaults, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    D.font.family = 'Inter, system-ui, sans-serif'; D.font.size = 12; D.maintainAspectRatio = false;
    D.animation.duration = reduce ? 0 : 900; D.animation.easing = 'easeOutQuart';
    D.interaction = { mode: 'index', intersect: false };
    D.elements.line.cubicInterpolationMode = 'monotone'; D.elements.line.tension = 0.4; D.elements.line.borderWidth = 2.5;
    D.elements.line.borderCapStyle = 'round'; D.elements.line.borderJoinStyle = 'round';
    D.elements.point.radius = 0; D.elements.point.hoverRadius = 5; D.elements.point.hitRadius = 14;
    D.elements.bar.borderRadius = 6; D.elements.bar.borderSkipped = false;
    const t = D.plugins.tooltip;
    t.backgroundColor = '#171717'; t.titleColor = '#fff'; t.bodyColor = '#e5e5e5'; t.padding = 12; t.cornerRadius = 10; t.boxPadding = 5;
    t.usePointStyle = true; t.caretSize = 0; t.titleFont = { weight: '600', size: 12 };
    D.plugins.legend.labels.usePointStyle = true; D.plugins.legend.labels.boxWidth = 8;
  }
  function gradient(color) {
    return ctx => {
      const ch = ctx.chart, a = ch.chartArea; if (!a) return rgba(color, 0.15);
      const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, rgba(color, 0.28)); g.addColorStop(1, rgba(color, 0)); return g;
    };
  }
  function axes(extra) {
    const mut = css('--mut') || '#737373', grid = css('--line') || '#eee';
    return { x: { grid: { display: false }, ticks: { color: mut, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
      y: Object.assign({ beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: mut, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } }, extra || {}) };
  }
  function draw(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), cfg);
  }

  function deltaHtml(cur, prev, invert) {
    if (prev == null) return '';
    const d = cur - prev, up = invert ? d < 0 : d > 0, down = invert ? d > 0 : d < 0;
    const pct = prev ? Math.abs(d / prev * 100).toFixed(1) + '%' : (cur ? 'new' : '0%');
    return `<span class="so-delta ${d === 0 ? '' : up ? 'up' : 'down'}">${d === 0 ? '\u2013' : d > 0 ? '\u25B2' : '\u25BC'} ${num(Math.abs(d))}<span class="so-pct">${pct}</span></span><span class="so-prev">vs ${num(prev)}</span>`;
  }
  function card(label, value, deltaStr) {
    return `<div class="so-card"><span class="so-lbl">${esc(label)}</span><b class="so-val" data-v="${esc(value)}">${esc(value)}</b><div class="so-d">${deltaStr || ''}</div></div>`;
  }
  /* the numbers count up once when the cards appear */
  function countUp(el) {
    const txt = el.textContent, m = txt.match(/-?\d[\d,]*/);
    if (!m || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const end = parseFloat(m[0].replace(/,/g, '')); if (!isFinite(end) || end === 0) return;
    const pre = txt.slice(0, m.index), post = txt.slice(m.index + m[0].length), start = performance.now();
    (function tick(now) {
      const k = Math.min(1, (now - start) / 800), e = 1 - Math.pow(1 - k, 4);
      el.textContent = k < 1 ? pre + Math.round(end * e).toLocaleString('en-US') + post : txt;
      if (k < 1) requestAnimationFrame(tick);
    })(start);
  }

  function renderInsights() {
    const rows = V().daily, has = rows.length > 0;
    $('soState').hidden = has;
    $('soCards').hidden = !has; $('soCharts').hidden = !has;
    $('soAllTime').hidden = view !== 'all';
    if (!has) {
      $('soRange').textContent = '';
      $('soState').textContent = 'No data yet. Tap Add day to enter your first numbers.';
      if (view === 'all') renderAllTimePanels();
      return;
    }
    const bs = buckets(rows), cur = bs[bs.length - 1], prev = view === 'all' ? null : bs[bs.length - 2];
    const firstDay = parseIso(rows[0].d), lastDay = parseIso(rows[rows.length - 1].d);
    const totalNow = totAt(rows, lastDay);
    const hasReach = rows.some(r => r.reach > 0);
    let html;
    if (view === 'all') {
      const all = sumRange(rows, firstDay, lastDay);
      $('soRange').textContent = `All data on record: ${longDay(firstDay)} \u2013 ${longDay(lastDay)} (${pl(rows.length, 'day')})`;
      html = card('Views', num(all.views)) + (hasReach ? card('Reach', num(all.reach)) : '') + card('Engagement', num(all.eng)) + card('Net follows', (all.net > 0 ? '+' : '') + num(all.net)) + card('Unfollows', num(all.unf)) + card('Total followers', totalNow == null ? '\u2013' : num(totalNow));
    } else {
      const name = { day: 'Day', week: '7 days', month: '30 days' }[view];
      $('soRange').textContent = (view === 'day' ? 'Latest day ' + longDay(cur.to) : name + ': ' + shortDay(cur.from) + ' \u2013 ' + longDay(cur.to)) + ' vs the ' + (view === 'day' ? 'day' : name) + ' before';
      const prevTot = prev ? prev.tot : null;
      html = card('Views', num(cur.views), deltaHtml(cur.views, prev && prev.views))
        + (hasReach ? card('Reach', num(cur.reach), deltaHtml(cur.reach, prev && prev.reach)) : '')
        + card('Engagement', num(cur.eng), deltaHtml(cur.eng, prev && prev.eng))
        + card('Net follows', (cur.net > 0 ? '+' : '') + num(cur.net), deltaHtml(cur.net, prev && prev.net))
        + card('Unfollows', num(cur.unf), deltaHtml(cur.unf, prev && prev.unf, true))
        + card('Total followers', cur.tot == null ? '\u2013' : num(cur.tot), cur.tot != null && prevTot != null ? deltaHtml(cur.tot, prevTot) : '');
    }
    $('soCards').innerHTML = html;
    $('soCards').querySelectorAll('.so-val').forEach(countUp);

    const labels = bs.map(b => b.label), mut = css('--mut') || '#737373';
    const multi = { plugins: { legend: { display: false } }, scales: axes() };
    // the top chart: views, reach, or both overlaid on the same axis
    const mode = hasReach ? vMode : 'views', ds = [];
    if (mode !== 'reach') ds.push({ label: 'Views', data: bs.map(b => b.views), borderColor: COL.blue, backgroundColor: gradient(COL.blue), fill: true });
    if (mode !== 'views') ds.push({ label: 'Reach', data: bs.map(b => b.reach), borderColor: COL.orange, backgroundColor: mode === 'reach' ? gradient(COL.orange) : rgba(COL.orange, 0.12), fill: true });
    $('chViewsTitle').textContent = mode === 'both' ? 'Views & reach' : mode === 'reach' ? 'Reach' : 'Views';
    $('soViewMode').hidden = !hasReach;
    $('soViewMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === mode ? 'true' : 'false'));
    draw('chViews', { type: 'line', data: { labels, datasets: ds }, options: { plugins: { legend: { display: ds.length > 1, position: 'bottom', labels: { color: mut } } }, scales: axes() } });
    draw('chEng', { type: 'bar', data: { labels, datasets: [{ label: 'Engagement', data: bs.map(b => b.eng), backgroundColor: rgba(COL.orange, 0.9) }] }, options: multi });
    draw('chAud', { data: { labels, datasets: [
      { type: 'bar', label: 'Follows', data: bs.map(b => b.fol), backgroundColor: rgba(COL.blue, 0.9) },
      { type: 'bar', label: 'Unfollows', data: bs.map(b => b.unf), backgroundColor: rgba(COL.verm, 0.9) },
      { type: 'line', label: 'Net follows', data: bs.map(b => b.net), borderColor: COL.ink, backgroundColor: COL.ink }] },
      options: { plugins: { legend: { display: true, position: 'bottom', labels: { color: mut } } }, scales: axes({ beginAtZero: false }) } });
    draw('chTot', { type: 'line', data: { labels, datasets: [{ label: 'Total followers', data: bs.map(b => b.tot), borderColor: COL.green, backgroundColor: gradient(COL.green), fill: true, spanGaps: true }] },
      options: { plugins: { legend: { display: false } }, scales: axes({ beginAtZero: false }) } });
    if (view === 'all') renderAllTimePanels();
  }

  /* all-time only: followers vs non-followers pie and the traffic bars, each with its own last-updated stamp */
  function renderAllTimePanels() {
    const M = V().meta, au = M.audience, tr = M.traffic, notYet = plat === 'all' ? 'Not entered yet. Choose Facebook or Instagram to add it.' : 'Not entered yet. Tap Update.';
    $('soEditAud').hidden = $('soEditTr').hidden = plat === 'all';
    const f = au ? Number(au.value.followers) || 0 : 0, n = au ? Number(au.value.nonFollowers) || 0 : 0, tot = f + n;
    $('soAudUpd').textContent = au && au.updated ? 'Last updated ' + fmtStamp(au.updated) : notYet;
    if (charts.chPie) { charts.chPie.destroy(); delete charts.chPie; }
    $('soPieLegend').innerHTML = '';
    if (tot > 0 && window.Chart) {
      draw('chPie', { type: 'pie', data: { labels: ['Followers', 'Non-followers'], datasets: [{ data: [f, n], backgroundColor: [COL.blue, COL.orange], borderColor: css('--panel') || '#fff', borderWidth: 3 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${num(c.parsed)} (${(c.parsed / tot * 100).toFixed(1)}%)` } } } } });
      $('soPieLegend').innerHTML = [['Followers', f, COL.blue], ['Non-followers', n, COL.orange]].map(x => `<span><i style="background:${x[2]}"></i>${x[0]} <b>${num(x[1])}</b> (${(x[1] / tot * 100).toFixed(1)}%)</span>`).join('');
    }
    const items = tr && tr.value && Array.isArray(tr.value.items) ? tr.value.items.slice().sort((a, b) => b.value - a.value) : [];
    $('soTrUpd').textContent = tr && tr.updated ? 'Last updated ' + fmtStamp(tr.updated) : notYet;
    $('soTrWrap').style.height = Math.max(140, items.length * 38 + 40) + 'px';
    if (charts.chTraffic) { charts.chTraffic.destroy(); delete charts.chTraffic; }
    if (items.length && window.Chart) {
      const mut = css('--mut') || '#737373', grid = css('--line') || '#eee';
      draw('chTraffic', { type: 'bar', data: { labels: items.map(i => i.label), datasets: [{ label: 'Views', data: items.map(i => i.value), backgroundColor: rgba(COL.blue, 0.9) }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: mut } }, y: { grid: { display: false }, ticks: { color: mut } } } } });
    }
  }

  $('soViewMode').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    vMode = b.dataset.m; renderInsights();
  });
  $('soView').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    view = b.dataset.v;
    $('soView').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderInsights();
  });

  $('soPlat').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    plat = b.dataset.p; setPlatHeader(); renderInsights();
  });

  /* ---- load ---- */
  async function loadSocials(quiet) {
    if (!CONFIG.portfolio.endpoint) { $('soState').textContent = "Sync isn't set up yet."; return; }
    const cached = quiet ? null : cacheGet('socials');
    if (cached && cached.daily) { soc = normSoc(cached); renderInsights(); }
    try {
      const raw = await call('socials');
      soc = normSoc(raw);
      cacheSet('socials', raw);
      renderInsights();
    } catch (err) {
      if (!cached) { $('soState').textContent = "Couldn't load Socials (offline, wrong secret, or Code.gs needs a new deployment)."; $('soState').hidden = false; }
      else toast('Could not refresh \u2014 showing your last saved data.');
    }
  }

  /* ---- add / edit a day by hand ---- */
  const ids = { views: 'dyViews', reach: 'dyReach', eng: 'dyEng', fol: 'dyFol', unf: 'dyUnf', tot: 'dyTot' };
  const fillDay = () => {
    const r = ($('dyPlat').value === 'ig' ? soc.ig : soc.fb).daily.find(x => x.d === $('dyDate').value);
    Object.keys(ids).forEach(k => { $(ids[k]).value = r && r[k] != null ? r[k] : ''; });
  };
  $('soDay').onclick = () => { $('dyPlat').value = plat === 'ig' ? 'ig' : 'fb'; $('dyDate').value = todayIso(); fillDay(); $('dySheet').hidden = false; };
  $('dyDate').addEventListener('change', fillDay);
  $('dyPlat').addEventListener('change', fillDay);
  $('dyCancel').onclick = () => { $('dySheet').hidden = true; };
  $('dySave').onclick = async () => {
    const d = $('dyDate').value; if (!d) return toast('Pick a date.');
    const p = { date: d, platform: $('dyPlat').value }; Object.keys(ids).forEach(k => { p[k] = $(ids[k]).value; });
    const b = $('dySave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try { await call('saveSocialDay', p); $('dySheet').hidden = true; toast(PNAME[$('dyPlat').value] + ' day saved.'); await loadSocials(true); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };

  /* ---- import a Meta Business Suite CSV into the metric you choose ---- */
  /* Meta's export is usually UTF-16 with a "sep=," first line, then the metric name, then a Date / Primary header. */
  const decodeCsv = buf => {
    const u = new Uint8Array(buf); let enc = 'utf-8', off = 0;
    if (u[0] === 0xFF && u[1] === 0xFE) { enc = 'utf-16le'; off = 2; } else if (u[0] === 0xFE && u[1] === 0xFF) { enc = 'utf-16be'; off = 2; } else if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) off = 3;
    return new TextDecoder(enc).decode(u.subarray(off));
  };
  const splitCsv = (line, sep) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(c => c.trim());
  };
  const csvIso = v => {
    const s = String(v || '').trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const t = Date.parse(s); return isNaN(t) ? '' : isoOf(new Date(t));
  };
  const GUESS = [[/follower/i, 'tot'], [/unfollow/i, 'unf'], [/follow/i, 'fol'], [/reach/i, 'reach'], [/view|impression/i, 'views'], [/interaction|engage/i, 'eng']];
  let csv = null;   // { title, cols: [names], rows: [{ d, vals: [] }] }
  function parseCsv(text) {
    let lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()), sep = ',';
    const sm = lines[0] && lines[0].match(/^sep=(.)$/i); if (sm) { sep = sm[1]; lines = lines.slice(1); }
    if (!sm && lines[0] && lines[0].split(';').length > lines[0].split(',').length) sep = ';';
    const hi = lines.findIndex(l => /^date$/i.test(splitCsv(l, sep)[0] || ''));
    if (hi < 0) throw new Error('No "Date" column found. Is this an export from Meta Business Suite?');
    const head = splitCsv(lines[hi], sep), title = hi > 0 ? splitCsv(lines[hi - 1], sep)[0] : '';
    const rows = [];
    lines.slice(hi + 1).forEach(l => {
      const c = splitCsv(l, sep), d = csvIso(c[0]); if (!d) return;
      rows.push({ d, vals: head.slice(1).map((_, i) => { const n = parseFloat(String(c[i + 1] || '').replace(/[,\s]/g, '')); return isFinite(n) ? n : null; }) });
    });
    if (!rows.length) throw new Error('No dated rows found in that file.');
    return { title, cols: head.slice(1), rows };
  }
  const csvPicked = () => { const i = +($('csvCol').value || 0); return csv ? csv.rows.filter(r => r.vals[i] != null).map(r => ({ d: r.d, v: Math.max(0, Math.round(r.vals[i])) })) : []; };
  function csvRefresh() {
    const list = csvPicked(), metric = $('csvMetric').value;
    $('csvGo').disabled = !csv || !list.length || !metric;
    if (!csv) return;
    const ds = list.map(x => x.d).sort();
    $('csvInfo').textContent = (csv.title ? `File: ${csv.title}\n` : '') + (list.length ? `${pl(list.length, 'day')} found, ${longDay(parseIso(ds[0]))} \u2013 ${longDay(parseIso(ds[ds.length - 1]))}` : 'No numbers in that column.');
    $('csvInfo').hidden = false;
  }
  $('soImport').onclick = () => {
    csv = null; $('csvPlat').value = plat === 'ig' ? 'ig' : 'fb'; $('csvFile').value = ''; $('csvInfo').hidden = true; $('csvMetric').value = ''; $('csvColWrap').hidden = true; $('csvGo').disabled = true; $('csvSheet').hidden = false;
  };
  $('csvCancel').onclick = () => { $('csvSheet').hidden = true; csv = null; };
  $('csvMetric').addEventListener('change', csvRefresh);
  $('csvCol').addEventListener('change', csvRefresh);
  $('csvFile').addEventListener('change', async () => {
    const f = $('csvFile').files[0]; csv = null; $('csvInfo').hidden = true; $('csvGo').disabled = true; if (!f) return;
    try {
      csv = parseCsv(decodeCsv(await f.arrayBuffer()));
      $('csvCol').innerHTML = csv.cols.map((c, i) => `<option value="${i}">${esc(c || 'Column ' + (i + 1))}</option>`).join('');
      $('csvColWrap').hidden = csv.cols.length < 2;
      // guess the metric from the title line / file name, but the choice stays yours
      const hint = (csv.title || '') + ' ' + f.name, g = GUESS.find(x => x[0].test(hint));
      if (g && !$('csvMetric').value) $('csvMetric').value = g[1];
      csvRefresh();
    } catch (err) { csv = null; $('csvInfo').textContent = err.message || 'Could not read that file.'; $('csvInfo').hidden = false; }
  });
  $('csvGo').onclick = async () => {
    const metric = $('csvMetric').value, list = csvPicked(); if (!metric || !list.length) return;
    const b = $('csvGo'); b.disabled = true;
    let added = 0, updated = 0;
    try {
      for (let i = 0; i < list.length; i += 70) {
        b.textContent = `Importing ${Math.min(100, Math.round(i / list.length * 100))}%`;
        const r = await call('importSocialMetric', { metric, platform: $('csvPlat').value, data: list.slice(i, i + 70).map(x => x.d + ':' + x.v).join(',') }, 60000);
        added += r.added || 0; updated += r.updated || 0;
      }
      $('csvSheet').hidden = true; csv = null;
      toast(`Imported ${pl(list.length, 'day')} into ${PNAME[$('csvPlat').value]} ${({ views: 'Views', reach: 'Reach', eng: 'Engagement', fol: 'Follows', unf: 'Unfollows', tot: 'Total followers' })[metric]} (${added} new, ${updated} updated).`);
      await loadSocials(true);
    } catch (err) { toast('Could not import: ' + backendErr(err)); }
    b.textContent = 'Import'; b.disabled = false;
  };

  /* ---- all-time panels ---- */
  $('soEditAud').onclick = () => { if (plat === 'all') return; const a = soc[plat].meta.audience; $('auFol').value = a ? a.value.followers || '' : ''; $('auNon').value = a ? a.value.nonFollowers || '' : ''; $('auSheet').hidden = false; };
  $('auCancel').onclick = () => { $('auSheet').hidden = true; };
  $('auSave').onclick = async () => {
    const b = $('auSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try { await call('saveSocialPanel', { key: 'audience', platform: plat, json: JSON.stringify({ followers: +$('auFol').value || 0, nonFollowers: +$('auNon').value || 0 }) }); $('auSheet').hidden = true; toast('Saved.'); await loadSocials(true); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };
  $('soEditTr').onclick = () => { if (plat === 'all') return; const t = soc[plat].meta.traffic; $('trText').value = t && t.value.items ? t.value.items.map(i => i.label + ': ' + i.value).join('\n') : ''; $('trSheet').hidden = false; };
  $('trCancel').onclick = () => { $('trSheet').hidden = true; };
  $('trSave').onclick = async () => {
    const items = $('trText').value.split('\n').map(l => { const m = l.match(/^(.*?)[:=,\t]\s*([\d,.\s]+)$/); return m ? { label: m[1].trim(), value: parseFloat(m[2].replace(/[,\s]/g, '')) || 0 } : null; }).filter(i => i && i.label);
    if (!items.length) return toast('Add lines like  Feed: 1200');
    const b = $('trSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try { await call('saveSocialPanel', { key: 'traffic', platform: plat, json: JSON.stringify({ items }) }); $('trSheet').hidden = true; toast('Saved.'); await loadSocials(true); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };

  /* ================= Planner ================= */
  /* A task shows in the planner when it is done (a finished video, or a post whose cards are all edited) or already posted, and is not hidden. */
  const fmtClock = v => { const m = String(v || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
  const hourLabel = v => { const h = +String(v).slice(0, 2); return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`; };
  function allTasks() {
    return cre.videos.map(v => ({ kind: 'video', id: v.id, title: v.title, date: v.date, time: v.time || '', hidden: !!v.hidden, status: v.status, platforms: v.platforms || {}, caption: v.caption, cards: v.cards || [], previews: [], doneDate: v.doneDate }))
      .concat(cre.posts.map(g => ({ kind: 'post', id: g.id, title: g.label || 'Post', date: g.scheduled || g.date, time: g.time || '', hidden: !!g.hidden, status: g.status, platforms: g.platforms || {}, caption: g.caption, cards: g.cards || [], previews: g.previews || [], doneDate: g.doneDate })));
  }
  const isReady = t => t.kind === 'video' ? t.status === 'done' : t.status === 'edited';
  const isPosted = t => t.status === 'posted';
  const fbOf = t => (t.platforms && t.platforms.fb) || {};
  /* the four channels a task can be posted on; each keeps its own link and all-time views */
  const CH = [
    { k: 'fb', n: 'Facebook', s: 'FB', ok: u => fbUrl(u) },
    { k: 'ig', n: 'Instagram', s: 'IG', ok: u => /^https?:\/\/([\w-]+\.)*(instagram\.com|instagr\.am)\//i.test(u) },
    { k: 'yt', n: 'YouTube', s: 'YT', ok: u => /^https?:\/\/([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(u) },
    { k: 'tt', n: 'TikTok', s: 'TT', ok: u => /^https?:\/\/([\w-]+\.)*tiktok\.com\//i.test(u) }
  ];
  const chOf = (t, k) => (t.platforms && t.platforms[k]) || {};
  const hasViews = c => !!c && c.views != null && c.views !== '' && isFinite(+c.views);
  const chOn = (t, k) => { const c = chOf(t, k); return !!(c.link || hasViews(c)); };
  const anyViews = t => CH.some(x => hasViews(chOf(t, x.k)));
  const totalViews = t => CH.reduce((n, x) => n + (hasViews(chOf(t, x.k)) ? +chOf(t, x.k).views : 0), 0);
  const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
  /* the Views button above the planner: shows or hides the view counts on the cards (on by default, remembered on this device) */
  let showViews = true; try { showViews = localStorage.getItem('cv_plViews') !== '0'; } catch (_) {}
  const syncViewsBtn = () => { const b = $('plViewsBtn'); b.textContent = 'Views: ' + (showViews ? 'On' : 'Off'); b.setAttribute('aria-pressed', showViews ? 'true' : 'false'); };
  const canDelete = t => t.kind === 'video' || String(t.id).indexOf('pc_') === 0;   // receipt groups (pg_) can only be hidden
  const find = id => allTasks().find(t => t.id === id);
  const shown = () => allTasks().filter(t => !t.hidden && (isReady(t) || isPosted(t)));
  const whenOf = t => t.date || (isPosted(t) ? fbOf(t).date : '');   // every task sits on its planned date, posted or not, so it can be rescheduled either way
  const waiting = () => shown().filter(isReady);
  const hiddenTasks = () => allTasks().filter(t => t.hidden && (isReady(t) || isPosted(t)));
  const ICON = {
    video: '<rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="M15 10.5l6-3v9l-6-3"/>',
    post: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 6"/>'
  };
  const svgI = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  const thumbOf = t => { const x = t.previews[0]; if (x) return x.t || x.u; const c = t.cards.find(c => c.photo); return c ? c.photo : ''; };

  function viewsHtml(t) {
    if (!anyViews(t)) return '<span class="pl-views none">No views yet</span>';
    return `<span class="pl-views"><strong>${fmtK(totalViews(t))}</strong> views<span class="pl-chs">${CH.filter(x => hasViews(chOf(t, x.k))).map(x => `<i class="ch ${x.k}" title="${x.n}">${x.s}<em>${fmtK(+chOf(t, x.k).views)}</em></i>`).join('')}</span></span>`;
  }
  function itemHtml(t) {
    const posted = isPosted(t), th = thumbOf(t);
    return `<button type="button" class="pl-item ${posted ? 'posted' : 'pending'}" data-id="${esc(t.id)}" aria-label="${esc(t.title)}${posted ? ', posted' : ', not posted yet, tap to post'}">
      <span class="pl-meta">${svgI(t.kind)}<span>${t.time ? esc(fmtClock(t.time)) : 'No time set'} \u00b7 ${t.kind === 'video' ? 'Video' : 'Post'}</span></span>
      <span class="pl-thumb">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : svgI(t.kind)}</span>
      <b>${esc(t.title)}</b>
      ${posted && showViews ? viewsHtml(t) : ''}
      <span class="pl-tag">${posted ? 'Posted' + (CH.filter(x => chOn(t, x.k)).length ? ' on ' + CH.filter(x => chOn(t, x.k)).map(x => x.s).join(' \u00b7 ') : '') : 'Tap to post'}</span>
    </button>`;
  }
  /* one day: a group per hour (a task without a time goes first) */
  function dayItems(list) {
    if (!list.length) return '<p class="pl-empty">Nothing planned</p>';
    const sorted = list.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    let out = '', last = null;
    sorted.forEach(t => {
      const key = t.time ? t.time.slice(0, 2) : '';
      if (key !== last) { out += `<div class="pl-hr">${t.time ? hourLabel(t.time) : 'Any time'}</div>`; last = key; }
      out += itemHtml(t);
    });
    return out;
  }
  function renderPlanner() {
    const list = shown(), pend = waiting(), today = todayIso();
    const end = addDays(weekStart, 6);
    $('plTitle').textContent = weekStart.getMonth() === end.getMonth() ? `${weekStart.toLocaleDateString('en-US', { month: 'long' })} ${weekStart.getDate()}\u2013${end.getDate()}, ${end.getFullYear()}` : `${shortDay(weekStart)} \u2013 ${longDay(end)}`;
    const byDay = {};
    list.forEach(t => { const d = String(whenOf(t) || '').slice(0, 10); if (d) (byDay[d] = byDay[d] || []).push(t); });
    let days = '', cols = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i), iso = isoOf(d), items = byDay[iso] || [], np = items.filter(isReady).length;
      const cls = (iso === today ? ' today' : '') + (iso === selDay ? ' sel' : '');
      const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
      days += `<button type="button" class="pl-day${cls}" data-d="${iso}" aria-label="${esc(longDay(d))}${np ? ', ' + pl(np, 'task') + ' to post' : ''}"><small>${wd}</small><b>${d.getDate()}</b>${np ? `<i>${np}</i>` : (items.length ? '<em>.</em>' : '')}</button>`;
      cols += `<section class="pl-col${cls}" data-d="${iso}"><div class="pl-col-h"><span>${wd} ${d.getDate()}</span>${np ? `<i>${np}</i>` : ''}</div>${dayItems(items)}</section>`;
    }
    $('plDays').innerHTML = days; $('plWeek').innerHTML = cols;
    // the red notification: done tasks that still have to be posted
    const b = $('plBadge'); b.hidden = !pend.length; b.textContent = pend.length > 99 ? '99+' : String(pend.length);
    try { if (window.CVShell) CVShell.setBadge('social', pend.length); } catch (_) {}
    const al = $('plAlert'); al.hidden = !pend.length;
    if (pend.length) al.innerHTML = `<i>${pend.length}</i> ${pend.length === 1 ? 'task is' : 'tasks are'} waiting to be posted. Tap to jump to the first.`;
    $('plState').hidden = true;
    renderHiddenBtn();
  }
  function renderHiddenBtn() { $('plHiddenBtn').textContent = `Hidden (${hiddenTasks().length})`; if (!$('hdSheet').hidden) renderHiddenList(); }
  const plRefreshBadge = () => { const pend = waiting(), b = $('plBadge'); b.hidden = !pend.length; b.textContent = String(pend.length); try { if (window.CVShell) CVShell.setBadge('social', pend.length); } catch (_) {} };
  function renderLists() { plRefreshBadge(); if (tab === 'planner') renderPlanner(); }

  $('plPrev').onclick = () => { weekStart = addDays(weekStart, -7); selDay = isoOf(weekStart); renderPlanner(); };
  $('plNext').onclick = () => { weekStart = addDays(weekStart, 7); selDay = isoOf(weekStart); renderPlanner(); };
  $('plToday').onclick = () => { weekStart = startOfWeek(new Date()); selDay = todayIso(); renderPlanner(); };
  $('plRefresh').onclick = () => loadCreatives(true);
  $('plViewsBtn').onclick = () => { showViews = !showViews; try { localStorage.setItem('cv_plViews', showViews ? '1' : '0'); } catch (_) {} syncViewsBtn(); renderPlanner(); };

  /* ---- hidden tasks: list them and bring them back ---- */
  function renderHiddenList() {
    const list = hiddenTasks().sort((a, b) => String(whenOf(b) || '').localeCompare(String(whenOf(a) || '')));
    $('hdEmpty').hidden = list.length > 0;
    $('hdList').innerHTML = list.map(t => {
      const th = thumbOf(t), d = String(whenOf(t) || '').slice(0, 10), posted = isPosted(t);
      return `<div class="hd-item" data-id="${esc(t.id)}">
        <span class="pl-thumb">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : svgI(t.kind)}</span>
        <span class="hd-info"><b>${esc(t.title)}</b><small>${t.kind === 'video' ? 'Video' : 'Post'} \u00b7 ${posted ? 'Posted' : 'Not posted yet'}${d ? ' \u00b7 ' + esc(fmtStamp(d + (t.time ? ' ' + t.time : ''))) : ''}</small></span>
        <button type="button" class="ghost sm hd-unhide">Unhide</button>
      </div>`;
    }).join('');
  }
  $('plHiddenBtn').onclick = () => { renderHiddenList(); $('hdSheet').hidden = false; };
  $('hdClose').onclick = () => { $('hdSheet').hidden = true; };
  $('hdList').addEventListener('click', async e => {
    const btn = e.target.closest('.hd-unhide'); if (!btn) return;
    const row = btn.closest('.hd-item'), t = row && find(row.dataset.id); if (!t) return;
    btn.disabled = true;
    try {
      await call('saveCreative', { id: t.id, hidden: '' });
      const src = (t.kind === 'video' ? cre.videos : cre.posts).find(x => x.id === t.id); if (src) src.hidden = false;
      cacheSet('creatives', cre); renderLists(); renderHiddenBtn();
      toast('Task is back in the Planner.');
    } catch (err) { toast('Could not unhide: ' + backendErr(err)); btn.disabled = false; }
  });
  $('plAlert').onclick = () => {
    const first = waiting().map(t => String(whenOf(t) || '').slice(0, 10)).filter(Boolean).sort()[0]; if (!first) return;
    const d = parseIso(first); weekStart = startOfWeek(d); selDay = first; renderPlanner();
  };
  $('plDays').addEventListener('click', e => { const b = e.target.closest('.pl-day'); if (!b) return; selDay = b.dataset.d; renderPlanner(); });
  $('plWeek').addEventListener('click', e => {
    const el = e.target.closest('.pl-item'); const t = el && find(el.dataset.id); if (!t) return;
    if (isPosted(t)) openDetail(t); else openPub(t, false);
  });

  async function loadCreatives(manual) {
    if (!CONFIG.portfolio.endpoint) return;
    const c = cacheGet('creatives');
    if (c && Array.isArray(c.videos)) { cre = c; renderLists(); }
    else { $('plState').textContent = 'Loading\u2026'; $('plState').hidden = false; }
    try {
      const r = await call('creatives');
      cre = { videos: r.videos || [], posts: r.posts || [] };
      cacheSet('creatives', cre); renderLists();
      if (manual) toast('Planner refreshed.');
    } catch (err) {
      if (!c) { $('plState').textContent = "Couldn't load tasks (offline, wrong secret, or Code.gs needs a new deployment)."; $('plState').hidden = false; }
      else toast('Could not refresh \u2014 showing your last saved data.');
    }
  }

  /* ---- Facebook embeds (official plugins): videos / reels use the video plugin, everything else the post plugin ---- */
  function embedHtml(link, width) {
    const w = Math.max(280, Math.min(500, Math.floor(width || 500))), isVideo = /\/(videos?|reels?|watch)\b|fb\.watch/i.test(link), href = encodeURIComponent(link);
    const src = isVideo ? `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=${w}&height=${w}`
      : `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=${w}`;
    return `<div class="so-embed${isVideo ? ' vid' : ''}"><iframe src="${src}" title="Facebook ${isVideo ? 'video' : 'post'}" loading="lazy" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" frameborder="0" ${isVideo ? 'scrolling="no"' : ''}></iframe></div>`;
  }

  /* ---- embeds for the other channels: YouTube, Instagram and TikTok each have an official player ---- */
  function embedFor(k, link, width) {
    if (k === 'fb') return embedHtml(link, width);
    let src = '', cls = '';
    if (k === 'yt') { const m = link.match(/(?:youtu\.be\/|\/shorts\/|\/live\/|\/embed\/|[?&]v=)([\w-]{11})/); if (m) { src = 'https://www.youtube-nocookie.com/embed/' + m[1]; cls = /\/shorts\//.test(link) ? ' vid tall' : ' vid wide'; } }
    else if (k === 'ig') { const m = link.match(/instagram\.com\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/i); if (m) { src = 'https://www.instagram.com/' + (m[1].toLowerCase() === 'tv' ? 'tv' : m[1].toLowerCase() === 'p' ? 'p' : 'reel') + '/' + m[2] + '/embed/'; cls = ' ig'; } }
    else if (k === 'tt') { const m = link.match(/\/video\/(\d+)/); if (m) { src = 'https://www.tiktok.com/embed/v2/' + m[1]; cls = ' tall'; } }
    if (!src) return '<p class="stub-note">No preview for this link. Use Open to see it.</p>';
    return `<div class="so-embed${cls}"><iframe src="${src}" title="${esc(CH.find(x => x.k === k).n)} video" loading="lazy" allowfullscreen="true" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" frameborder="0" scrolling="no"></iframe></div>`;
  }

  /* ---- post it: paste the link of each channel it went on ---- */
  const PUBIN = { fb: 'pubLink', ig: 'pubLinkIg', yt: 'pubLinkYt', tt: 'pubLinkTt' };
  let pubId = '', pubEdit = false;
  function openPub(t, edit) {
    pubId = t.id; pubEdit = !!edit;
    $('pubHeading').textContent = edit ? 'Edit channel links' : 'Publish';
    $('pubSub').textContent = t.title + (t.date ? ' \u00b7 planned ' + shortDay(parseIso(t.date) || new Date()) + (t.time ? ', ' + fmtClock(t.time) : '') : '');
    CH.forEach(x => { $(PUBIN[x.k]).value = chOf(t, x.k).link || ''; });
    $('pubDate').value = fbOf(t).date || todayIso();
    $('pubSave').textContent = edit ? 'Save' : 'Publish';
    // copy / hide / delete are for tasks that are not posted yet
    $('pubPlanDate').value = t.date || ''; $('pubPlanTime').value = t.time || '';
    $('pubPlanWrap').hidden = edit; $('pubSched').hidden = edit;
    $('pubCopy').hidden = edit; $('pubHide').hidden = edit; $('pubDel').hidden = edit || !canDelete(t);
    $('pdSheet').hidden = true; $('pubSheet').hidden = false; $('pubLink').focus();
  }
  const closePub = () => { $('pubSheet').hidden = true; pubId = ''; };
  $('pubCancel').onclick = closePub;
  $('pubSheet').addEventListener('click', e => { if (e.target.id === 'pubSheet') closePub(); });
  $('pubSave').onclick = async () => {
    const t = find(pubId); if (!t) return;
    const date = $('pubDate').value || todayIso();
    const plats = JSON.parse(JSON.stringify(t.platforms || {}));
    for (const x of CH) {
      const link = $(PUBIN[x.k]).value.trim();
      if (!link) { if (pubEdit && plats[x.k]) plats[x.k].link = ''; continue; }
      if (!safeUrl(link) || !x.ok(link)) return toast(`That is not a ${x.n} link.`);
      plats[x.k] = Object.assign({}, plats[x.k], { on: true, date: x.k === 'fb' ? date : (plats[x.k] && plats[x.k].date) || date, link });
    }
    if (!CH.some(x => plats[x.k] && plats[x.k].link)) return toast('Paste at least one link.');
    const b = $('pubSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try {
      await call('saveCreative', { id: t.id, status: 'posted', platforms: JSON.stringify(plats) });
      closePub(); toast(pubEdit ? 'Links saved.' : 'Published.');
      await loadCreatives();
    } catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = pubEdit ? 'Save' : 'Publish';
  };
  /* set or change the planned date and time without posting */
  $('pubSched').onclick = async () => {
    const t = find(pubId); if (!t) return;
    const date = $('pubPlanDate').value; if (!date) return toast('Pick a planned date.');
    const b = $('pubSched'); b.disabled = true;
    try { await call('saveCreative', { id: t.id, date, time: $('pubPlanTime').value || '' }); closePub(); toast('Schedule saved.'); await loadCreatives(); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false;
  };
  $('pubCopy').onclick = async () => {
    const t = find(pubId); if (!t) return;
    if (!t.caption || !t.caption.trim()) return toast('No caption yet. Add one in Creatives.');
    try { await navigator.clipboard.writeText(t.caption); toast('Caption copied.'); }
    catch (_) { const ta = document.createElement('textarea'); ta.value = t.caption; ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Caption copied.'); } catch (__) { toast('Could not copy.'); } ta.remove(); }
  };
  /* hide: the task leaves the planner and shows under Creatives > Hidden, where it can be brought back */
  $('pubHide').onclick = async () => {
    const t = find(pubId); if (!t) return;
    const b = $('pubHide'); b.disabled = true;
    try { await call('saveCreative', { id: t.id, hidden: '1' }); closePub(); toast('Task hidden. Bring it back with the Hidden button.'); await loadCreatives(); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false;
  };
  $('pubDel').onclick = async () => {
    const t = find(pubId); if (!t) return;
    if (!confirm(`Delete "${t.title}"?${t.kind === 'post' ? '\n\nThe cards are not deleted. They go back to their own receipt groups.' : ''}`)) return;
    const b = $('pubDel'); b.disabled = true;
    try { await call('deleteCreative', { id: t.id }); closePub(); toast('Task deleted.'); await loadCreatives(); }
    catch (err) { toast('Could not delete: ' + backendErr(err)); }
    b.disabled = false;
  };

  /* ---- a posted task: embed (a tab per channel), views per channel, links ---- */
  let pdId = '';
  function openDetail(t, ch) {
    pdId = t.id;
    const links = CH.filter(x => chOf(t, x.k).link), cur = (ch && links.find(x => x.k === ch)) || links[0];
    const when = CH.map(x => chOf(t, x.k).date).filter(Boolean).sort()[0], d = parseIso(when);
    $('pdSub').textContent = `${t.title} \u00b7 ${t.kind === 'video' ? 'Video' : 'Post'}${d ? ' \u00b7 posted ' + longDay(d) : ''}`;
    $('pdTabs').hidden = links.length < 2;
    $('pdTabs').innerHTML = links.length < 2 ? '' : links.map(x => `<button type="button" class="chip${x === cur ? ' active' : ''}" data-k="${x.k}">${x.n}</button>`).join('');
    $('pdEmbed').innerHTML = cur ? embedFor(cur.k, chOf(t, cur.k).link, Math.min(420, window.innerWidth - 80)) : '<p class="stub-note">No link saved.</p>';
    const rows = CH.filter(x => chOn(t, x.k)).map(x => {
      const c = chOf(t, x.k), u = safeUrl(c.link);
      return `<div class="so-ch-row"><i class="ch ${x.k}">${x.s}</i><span class="so-ch-n">${x.n}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open &#8599;</a>` : ''}</span><strong>${hasViews(c) ? num(c.views) : '\u2013'}</strong><em>${c.viewsAt ? esc(fmtStamp(c.viewsAt)) : ''}</em></div>`;
    }).join('');
    $('pdViews').innerHTML = `<div class="so-ch-total"><small>Total views, all channels</small><strong>${anyViews(t) ? num(totalViews(t)) : '\u2013'}</strong></div>${rows}`;
    $('pdPlanDate').value = t.date || ''; $('pdPlanTime').value = t.time || '';
    const open = $('pdOpen'); open.hidden = !cur; if (cur) open.href = chOf(t, cur.k).link;
    $('pdSheet').hidden = false;
  }
  const closeDetail = () => { $('pdSheet').hidden = true; $('pdEmbed').innerHTML = ''; pdId = ''; };
  $('pdTabs').addEventListener('click', e => { const b = e.target.closest('button[data-k]'), t = b && find(pdId); if (t) openDetail(t, b.dataset.k); });
  $('pdClose').onclick = closeDetail;
  $('pdSheet').addEventListener('click', e => { if (e.target.id === 'pdSheet') closeDetail(); });
  $('pdSched').onclick = async () => {
    const t = find(pdId); if (!t) return;
    const date = $('pdPlanDate').value; if (!date) return toast('Pick a planned date.');
    const b = $('pdSched'); b.disabled = true;
    try {
      await call('saveCreative', { id: t.id, date, time: $('pdPlanTime').value || '' });
      closeDetail(); toast('Schedule saved.');
      const d = parseIso(date); if (d) { weekStart = startOfWeek(d); selDay = date; }
      await loadCreatives();
    } catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false;
  };
  $('pdViewsBtn').onclick = () => { const t = find(pdId); if (t) { closeDetail(); openViews(t); } };
  $('pdEdit').onclick = () => { const t = find(pdId); if (t) { closeDetail(); openPub(t, true); } };
  $('pdUnpub').onclick = async () => {
    const t = find(pdId); if (!t) return;
    if (!confirm(`Unpublish "${t.title}"?\n\nIt goes back to the planner as not posted. The link and views are kept.`)) return;
    try { await call('saveCreative', { id: t.id, status: t.kind === 'video' ? 'done' : 'todo' }); closeDetail(); toast('Moved back to the planner.'); await loadCreatives(); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
  };

  /* ---- links and all-time views, per channel ---- */
  let vwId = '';
  function openViews(t) {
    vwId = t.id; $('vwSub').textContent = t.title;
    $('vwRows').innerHTML = CH.map(x => {
      const c = chOf(t, x.k);
      return `<div class="vw-ch"><div class="vw-h"><i class="ch ${x.k}">${x.s}</i><b>${x.n}</b></div><div class="vw-row"><input type="url" id="vwL_${x.k}" placeholder="Link" inputmode="url" autocomplete="off" maxlength="600" value="${esc(c.link || '')}" aria-label="${x.n} link"><input type="number" id="vwV_${x.k}" placeholder="Views" inputmode="numeric" min="0" step="1" value="${hasViews(c) ? esc(c.views) : ''}" aria-label="${x.n} views"></div></div>`;
    }).join('');
    $('vwSheet').hidden = false;
  }
  $('vwCancel').onclick = () => { $('vwSheet').hidden = true; vwId = ''; };
  $('vwSave').onclick = async () => {
    const t = find(vwId); if (!t) return;
    const data = {};
    for (const x of CH) {
      const link = $('vwL_' + x.k).value.trim(), v = $('vwV_' + x.k).value.trim();
      if (link && (!safeUrl(link) || !x.ok(link))) return toast(`That is not a ${x.n} link.`);
      if (v !== '' && (!isFinite(+v) || +v < 0)) return toast(`Check the ${x.n} views.`);
      data[x.k] = { link, views: v };
    }
    const b = $('vwSave'); b.disabled = true; b.textContent = 'Saving\u2026';
    try { await call('setPostChannels', { id: vwId, json: JSON.stringify(data) }); $('vwSheet').hidden = true; vwId = ''; toast('Saved.'); await loadCreatives(); }
    catch (err) { toast('Could not save: ' + backendErr(err)); }
    b.disabled = false; b.textContent = 'Save';
  };

  /* ================= tabs, shared ================= */
  document.querySelectorAll('.tab[data-stab]').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab[data-stab]').forEach(x => x.classList.toggle('active', x === t));
    tab = t.dataset.stab;
    $('panelInsights').hidden = tab !== 'insights'; $('panelPlanner').hidden = tab !== 'planner';
    document.querySelector('main.so-wrap').classList.toggle('pl-wide', tab === 'planner');
    if (tab === 'insights') renderInsights(); else renderPlanner();
  });
  $('imgViewClose').onclick = () => { $('imgView').hidden = true; };
  $('imgView').addEventListener('click', e => { if (e.target.id === 'imgView') $('imgView').hidden = true; });
  ['pubSheet', 'pdSheet', 'csvSheet', 'vwSheet', 'dySheet', 'auSheet', 'trSheet', 'hdSheet'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) $(id).hidden = true; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ['pubSheet', 'pdSheet', 'csvSheet', 'vwSheet', 'dySheet', 'auSheet', 'trSheet', 'hdSheet', 'imgView'].forEach(id => { $(id).hidden = true; }); });

  setupChartDefaults();
  setPlatHeader(); syncViewsBtn();
  (async function init() {
    await loadSocials(false);
    loadCreatives();
  })();

})();
