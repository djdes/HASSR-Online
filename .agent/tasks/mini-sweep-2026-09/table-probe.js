(() => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, pageScrollW: document.documentElement.scrollWidth, tables: [] };
  for (const t of Array.from(document.querySelectorAll("table"))) {
    const r = t.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    let scroller = null;
    for (let n = t.parentElement; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 2) { scroller = n; break; } }
    let clipped = null;
    for (let n = t.parentElement; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (/(hidden|clip)/.test(s.overflowX) && t.scrollWidth > n.clientWidth + 2) { clipped = (n.className || n.tagName).toString().slice(0, 60); break; } }
    let moved = null;
    if (scroller) { const before = scroller.scrollLeft; scroller.scrollLeft = before + 120; moved = scroller.scrollLeft !== before; scroller.scrollLeft = before; }
    out.tables.push({ w: Math.round(r.width), right: Math.round(r.right), wider: r.width > vw + 2, scroller: scroller ? (scroller.className || "").toString().slice(0, 70) : null, moved, touchAction: scroller ? getComputedStyle(scroller).touchAction : null, clippedBy: clipped });
  }
  return out;
})()
