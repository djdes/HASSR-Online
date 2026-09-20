(() => {
  const vw = innerWidth, vh = innerHeight;
  const t = (e) => (e.innerText || "").replace(/[\s]+/g, " ").trim();
  const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], smallFont: [], tiny: [], lowContrast: [], coveredByNav: [] };
  const rgb = (s) => { const m = (s || "").match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
  const lum = (c) => { const f = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const b = getComputedStyle(n).backgroundColor; const c = rgb(b); if (c && !/rgba\(0, 0, 0, 0\)/.test(b)) return c; n = n.parentElement; } return [255, 255, 255]; };
  for (const e of document.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right > vw + 2 || r.left < -2) { if (e.children.length === 0 || r.width > vw) out.wide.push({ tag: e.tagName, t: t(e).slice(0, 40), x: Math.round(r.x), w: Math.round(r.width) }); }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 16 && e.type !== "checkbox" && e.type !== "radio" && e.type !== "file") out.smallFont.push({ tag: e.tagName, type: e.type, ph: e.placeholder, fs }); }
    if (/^(BUTTON|A)$/.test(e.tagName) && t(e) && (r.height < 32 || r.width < 32)) out.tiny.push({ t: t(e).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    if (e.children.length === 0 && t(e)) {
      const cs = getComputedStyle(e); const fg = rgb(cs.color); const bg = bgOf(e);
      if (fg && bg) { const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); if (ratio < 3) out.lowContrast.push({ t: t(e).slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: cs.color, bg: `rgb(${bg.join(",")})`, fs: cs.fontSize }); }
    }
  }
  const nav = document.querySelector("a[data-nav-href]")?.closest("nav");
  if (nav) { const nr = nav.getBoundingClientRect();
    for (const e of document.querySelectorAll("button, a[href], input")) { const r = e.getBoundingClientRect(); if (r.width < 1) continue; if (r.bottom > nr.top && r.top < nr.bottom && !nav.contains(e)) { const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (el && !e.contains(el) && el !== e) out.coveredByNav.push({ t: t(e).slice(0, 35), y: Math.round(r.y), by: el.tagName + "|" + t(el).slice(0, 25) }); } } }
  out.wide = out.wide.slice(0, 8); out.lowContrast = out.lowContrast.slice(0, 10); out.tiny = out.tiny.slice(0, 8);
  return out;
})()
