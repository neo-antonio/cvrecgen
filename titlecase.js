/* ---------- Title case for card names ----------
   Every word starts with a capital and the rest is lower case ("luka doncic silver prizm" -> "Luka Doncic Silver Prizm").
   A word that is ALREADY in capitals (SPX, BGS, DONCIC) is left as typed, and "psa" / "rc" (any mix of upper and lower case, standing alone) are always made PSA / RC (also PSA10 / PSA-10).
   Other words to force into capitals when they are typed in lower case: add them to TITLE_KEEP_UPPER, e.g. 'BGS'.
   Used by the Receipt page (new cards are saved in title case) and by Portfolio (fix one card, or every existing title).
   Code.gs has the same function (titleCase_), keep the two in step. */
(function () {
  const TITLE_KEEP_UPPER = ['PSA', 'RC'];
  const keep = TITLE_KEEP_UPPER.map(w => ({ re: new RegExp('(^|[^A-Za-z])' + w.charAt(0) + w.slice(1).toLowerCase() + '(?![a-z])', 'g'), w }));
  window.titleCase = function (s) {
    s = String(s == null ? '' : s).trim();
    let out = '', cap = true;
    const keepCaps = [];   // words that are already in capitals (SPX, PSA, DONCIC) are left exactly as typed
    const capsRe = /[A-Za-z\u00C0-\u024F]{2,}/g; let m;
    while ((m = capsRe.exec(s))) if (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase()) for (let k = m.index; k < m.index + m[0].length; k++) keepCaps[k] = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (/\s/.test(ch)) { out += ch; cap = true; }
      else if (/[A-Za-z\u00C0-\u024F]/.test(ch)) { out += keepCaps[i] ? ch : cap ? ch.toUpperCase() : ch.toLowerCase(); cap = false; }
      else if (/[0-9]/.test(ch)) { out += ch; cap = false; }                       // "10th", "#23": no capital after a digit
      else { out += ch; if ('-/([{"\u201C\u2018#&+'.indexOf(ch) >= 0) cap = true; }   // "Mid-Range", "(Rookie)"; an apostrophe does not start a word ("Doncic's")
    }
    keep.forEach(k => { out = out.replace(k.re, '$1' + k.w); });
    return out;
  };
})();
