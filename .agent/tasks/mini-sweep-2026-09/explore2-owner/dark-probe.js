(() => {
  const root = document.documentElement;
  function rgb(c) { const m = String(c).match(/\d+/g); return m ? m.slice(0, 3).map(Number) : null; }
  function lum(c) { const v = rgb(c); if (!v) return null; return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255; }
  const white = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width < 70 || r.height < 26) continue;
    if (r.bottom < 0 || r.top > innerHeight * 4) continue;
    const v = rgb(getComputedStyle(e).backgroundColor);
    const a = String(getComputedStyle(e).backgroundColor).match(/rgba\([^)]*,\s*([\d.]+)\)/);
    if (!v) continue;
    if (a && Number(a[1]) < 0.5) continue;
    if (v[0] > 234 && v[1] > 234 && v[2] > 234) {
      white.push(e.tagName + '.' + String(e.className).slice(0, 55) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' @' + Math.round(r.top) + ' txt=' + (e.innerText || '').slice(0, 30).replace(/\n/g, ' '));
      if (white.length > 8) break;
    }
  }
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.children.length) continue;
    const t = (e.textContent || '').trim(); if (t.length < 3) continue;
    const r = e.getBoundingClientRect(); if (r.width < 10 || r.height < 6) continue;
    if (r.top > innerHeight * 4) continue;
    const cs = getComputedStyle(e); const fl = lum(cs.color);
    let p = e, bg = null;
    while (p && p !== document.documentElement) {
      const c = getComputedStyle(p).backgroundColor;
      const al = String(c).match(/rgba\([^)]*,\s*([\d.]+)\)/);
      if (c && !(al && Number(al[1]) < 0.15) && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      p = p.parentElement;
    }
    if (bg == null) bg = getComputedStyle(document.body).backgroundColor;
    const bl = lum(bg); if (fl == null || bl == null) continue;
    const cr = (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05);
    if (cr < 2.0) { bad.push(t.slice(0, 45) + ' | color=' + cs.color + ' bg=' + bg + ' cr=' + cr.toFixed(2) + ' @' + Math.round(r.top)); if (bad.length > 7) break; }
  }
  return { theme: root.getAttribute('data-theme') || String(root.className).slice(0, 60), bodyBg: getComputedStyle(document.body).backgroundColor, white, bad };
})()
