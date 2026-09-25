// Автопроверка экрана мини-приложения (выполняется в странице).
// Размеры кнопок и полей, шрифт полей, горизонтальная прокрутка, зазоры между
// кликабельными элементами, контраст текста, высота шапки и нижнего меню.
(() => {
  const vw = document.documentElement.clientWidth;
  const MIN = 48;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const desc = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 36);
    return `${el.tagName.toLowerCase()}«${t}»`;
  };
  const zone = (el) => (el.closest(".mini-topbar") ? "header" : el.closest(".mini-nav-rail") ? "nav" : el.closest("main") ? "main" : "other");

  // Горизонтальная прокрутка страницы и вылезающие за экран блоки.
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  const offscreen = [];
  for (const el of document.querySelectorAll("body *")) {
    if (offscreen.length >= 8) break;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.position === "fixed" || s.visibility === "hidden" || s.display === "none") continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) offscreen.push(`${desc(el)} L${Math.round(r.left)} R${Math.round(r.right)}`);
  }

  // Кнопки и поля. Ссылки считаем кнопками, если они оформлены плиткой
  // (блочные, с фоном или рамкой); ссылки внутри текста — нет.
  const controls = [];
  const sel = "button, [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], input, select, textarea, a[href]";
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    if (el.closest("[aria-hidden=true]")) continue;
    const tag = el.tagName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "INPUT" && ["hidden", "checkbox", "radio", "file", "range"].includes(type)) continue;
    const s = getComputedStyle(el);
    if (tag === "A") {
      const blocky = /(block|flex|grid)/.test(s.display);
      const painted = s.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(s.borderTopWidth) > 0;
      if (!blocky || !painted) continue;
    }
    // Чекбокс/радио на роли: палец попадает в расширенную зону ::after (см. mini-theme.css).
    const r = el.getBoundingClientRect();
    const field = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    controls.push({ el, r, field, s, z: zone(el) });
  }
  const small = [];
  const smallFont = [];
  for (const c of controls) {
    const role = c.el.getAttribute("role");
    if (["checkbox", "radio", "switch"].includes(role || "")) continue;
    if (c.r.height < MIN - 0.5) small.push(`${c.z}:${desc(c.el)} ${Math.round(c.r.width)}x${Math.round(c.r.height)}`);
    if (c.field && parseFloat(c.s.fontSize) < 16) smallFont.push(`${c.z}:${desc(c.el)} ${c.s.fontSize}`);
  }

  // Зазоры: соседние кликабельные элементы (не вложенные) ближе 8 px.
  const near = [];
  const rects = controls.filter((c) => c.r.height >= 1).slice(0, 400);
  for (let i = 0; i < rects.length && near.length < 12; i++) {
    for (let j = i + 1; j < rects.length && near.length < 12; j++) {
      const a = rects[i], b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Меню и шапка плавают поверх прокручиваемого содержимого — их
      // «соседство» с карточками под ними не зазор между кнопками.
      if (a.z !== b.z) continue;
      const dx = Math.max(0, Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right));
      const dy = Math.max(0, Math.max(a.r.top, b.r.top) - Math.min(a.r.bottom, b.r.bottom));
      const overlapX = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 4;
      const overlapY = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 4;
      // Только соседи по строке или по столбцу.
      const gap = overlapY ? dx : overlapX ? dy : Infinity;
      if (gap < 8) near.push(`${a.z}:${desc(a.el)} ↔ ${desc(b.el)} ${gap.toFixed(0)}px`);
    }
  }

  // Контраст текста (WCAG): цвет текста против первого непрозрачного фона.
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  // Градиентные фоны (шапка, герои) читаем по их базовому цвету.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 0.99) break;
      if (s.backgroundImage && s.backgroundImage !== "none" && /gradient/.test(s.backgroundImage)) {
        const stops = [...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter((x) => x && x.a >= 0.99);
        if (stops.length) { layers.push(stops[stops.length - 1]); break; }
      }
      if (n === document.documentElement) layers.push({ r: 255, g: 255, b: 255, a: 1 });
    }
    let out = layers.pop() || { r: 255, g: 255, b: 255, a: 1 };
    while (layers.length) out = blend(layers.pop(), out);
    return out;
  };
  const lowContrast = [];
  let checked = 0;
  for (const el of document.querySelectorAll("main *, .mini-topbar *, .mini-nav-rail *")) {
    if (lowContrast.length >= 12) break;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own || !visible(el)) continue;
    if (el.closest("[disabled], [aria-disabled=true], [aria-hidden=true]")) continue;
    const s = getComputedStyle(el);
    let color = parse(s.color);
    if (!color) continue;
    let op = 1;
    for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    color = { ...color, a: color.a * op };
    const bg = bgOf(el);
    const cr = ratio(blend(color, bg), bg);
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    checked++;
    if (cr < need) {
      const cls = String(el.className?.toString?.() ?? "").split(/\s+/).filter((c) => /^(text-|bg-)/.test(c)).slice(0, 3).join(" ");
      const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      lowContrast.push(`${zone(el)}:${desc(el)} ${cr.toFixed(2)} (${s.fontSize}) ${hex(blend(color, bg))}/${hex(bg)} ${cls}`);
    }
  }

  const header = document.querySelector(".mini-topbar");
  const nav = document.querySelector(".mini-nav-rail");
  const mainEl = document.querySelector("main");
  const bodyText = mainEl ? [...mainEl.querySelectorAll("p, li, span, div")].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 8)).map((e) => parseFloat(getComputedStyle(e).fontSize)) : [];
  bodyText.sort((a, b) => a - b);
  return {
    url: location.pathname,
    vw,
    scrollW: document.documentElement.scrollWidth,
    hScroll: document.documentElement.scrollWidth > vw,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    headerBg: header ? getComputedStyle(header).backgroundImage.slice(0, 60) : null,
    navH: nav ? Math.round(nav.getBoundingClientRect().height) : null,
    controls: controls.length,
    small: small.length,
    smallList: small.slice(0, 14),
    smallFont: smallFont.slice(0, 8),
    near: near.length,
    nearList: near.slice(0, 8),
    offscreen,
    textChecked: checked,
    lowContrast,
    bodyFontMedian: bodyText.length ? bodyText[Math.floor(bodyText.length / 2)] : null,
  };
})()
