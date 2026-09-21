(() => {
  const nl = String.fromCharCode(10);
  const t = document.body.innerText;
  const bad = [];
  const rx = /\b(Error|Failed|Unauthorized|Forbidden|undefined|null|NaN|Loading|Submit|Cancel|Save|Delete|Edit|Close|Success|Warning|Invalid|Required|Not found|TypeError|Internal Server|Bad Request|pipeline|dashboard|compliance|score|heatmap|preset|scope|SKU|status|draft|pending|approved|rejected|true|false)\b/g;
  let m;
  while ((m = rx.exec(t)) !== null) {
    const s = Math.max(0, m.index - 45), e = Math.min(t.length, m.index + 45);
    bad.push(m[0] + ' :: ' + t.slice(s, e).split(nl).join(' ⏎ '));
    if (bad.length > 25) break;
  }
  // элементы за краем экрана
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right > innerWidth + 2 || r.left < -2) {
      const cs = getComputedStyle(el);
      wide.push(el.tagName + '.' + String(el.className).slice(0, 50) + ' L=' + Math.round(r.left) + ' R=' + Math.round(r.right) + ' ovx=' + cs.overflowX);
      if (wide.length > 6) break;
    }
  }
  // мелкие поля
  const small = [];
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const r = el.getBoundingClientRect();
    if (r.width < 3) continue;
    if (fs < 16) small.push(el.tagName + '[' + el.type + '] fs=' + fs + ' ph=' + (el.placeholder || ''));
  }
  // элементы под нижним меню
  const nav = document.querySelector('nav.mini-nav-rail');
  const navTop = nav ? nav.getBoundingClientRect().top : null;
  return {
    url: location.pathname + location.search,
    h1: (document.querySelector('h1') || {}).innerText || '',
    docScrollW: document.documentElement.scrollWidth,
    bad: [...new Set(bad)].slice(0, 14),
    wide, small: [...new Set(small)].slice(0, 6), navTop,
    text: t.slice(0, 900)
  };
})()
