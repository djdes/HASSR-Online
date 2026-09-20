(() => {
  function nums(c){ return (String(c).match(/[0-9.]+/g)||[]).map(Number); }
  function lum(c){ const m = nums(c); if (m.length < 3) return null; return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255; }
  function alpha(c){ const m = nums(c); return m.length >= 4 ? m[3] : 1; }
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 14 || r.top > window.innerHeight || r.bottom < 0) continue;
    const cs = getComputedStyle(el);
    const b = lum(cs.backgroundColor);
    if (b === null || alpha(cs.backgroundColor) < 0.5) continue;
    if (b > 0.85) {
      const t = lum(cs.color);
      out.push('LIGHT-BG ' + el.tagName + '.' + String(el.className||'').slice(0,45) + ' bg=' + cs.backgroundColor + ' fg=' + cs.color + (t !== null && t > 0.7 ? ' !!INVISIBLE' : '') + ' txt=' + String(el.innerText||'').slice(0,25));
    }
  }
  return { bodyBg: getComputedStyle(document.body).backgroundColor, items: out.slice(0,16) };
})()
