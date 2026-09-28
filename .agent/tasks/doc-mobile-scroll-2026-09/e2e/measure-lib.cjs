// Замеры прокрутки/геометрии страницы документа журнала (одинаковые для «до» и «после»).

/**
 * Возвращает состояние страницы: прокрутку окна, переполнение документа,
 * все горизонтальные скроллеры внутри <main> (кто, насколько прокручен) и
 * геометрию шапки (H1, первая кнопка «Добавить…»).
 */
async function measurePage(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = window.innerWidth;
    const round = (n) => Math.round(n * 10) / 10;
    const describe = (el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      const attrs = [];
      for (const a of ["data-journal-doc-pan", "data-doc-table-scroll", "data-journal-grid-sheet"]) {
        if (el.hasAttribute && el.hasAttribute(a)) attrs.push(a);
      }
      return `${el.tagName.toLowerCase()}${attrs.length ? `[${attrs.join("][")}]` : ""}.${cls.split(/\s+/).slice(0, 6).join(".")}`;
    };
    const main = document.querySelector("main") || document.body;
    const scrollers = [];
    for (const el of main.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowX)) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      scrollers.push({
        el: describe(el).slice(0, 160),
        hasTable: Boolean(el.querySelector("table")),
        scrollLeft: round(el.scrollLeft),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        left: round(r.left),
        right: round(r.right),
        top: round(r.top + window.scrollY),
      });
    }
    // Любой элемент, выходящий за правый край экрана (без учёта тех, что
    // лежат внутри горизонтального скроллера — там это норма).
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    let widest = null;
    for (const el of main.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (insideScroller(el)) continue;
      const over = Math.max(r.right - vw, -r.left);
      if (!widest || over > widest.over) widest = { el: describe(el).slice(0, 160), left: round(r.left), right: round(r.right), over: round(over) };
    }
    const h1 = document.querySelector("main h1");
    const h1r = h1 ? h1.getBoundingClientRect() : null;
    // Кнопка «Добавить …» (первая видимая).
    const addBtn = [...main.querySelectorAll("button, a")].find((b) => {
      const t = (b.textContent || "").trim();
      const r = b.getBoundingClientRect();
      return /^\+?\s*Добавить/.test(t) && r.width > 0 && r.height > 0;
    });
    const addR = addBtn ? addBtn.getBoundingClientRect() : null;
    // Кнопка «Добавить…» шапки — первая вне таблицы.
    const headerAddBtn = [...main.querySelectorAll("button, a")].find((b) => {
      const t = (b.textContent || "").trim();
      const r = b.getBoundingClientRect();
      return /^\+?\s*Добавить/.test(t) && r.width > 0 && r.height > 0 && !b.closest("table");
    });
    const hdrR = headerAddBtn ? headerAddBtn.getBoundingClientRect() : null;
    const pan = document.querySelector("[data-journal-doc-pan]");
    return {
      url: location.pathname + location.search,
      vw,
      vh: window.innerHeight,
      scrollX: round(window.scrollX),
      scrollY: round(window.scrollY),
      docScrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageOverflowX: de.scrollWidth > vw + 1,
      pan: pan
        ? { scrollLeft: round(pan.scrollLeft), scrollWidth: pan.scrollWidth, clientWidth: pan.clientWidth, overflowX: getComputedStyle(pan).overflowX }
        : null,
      scrollers,
      maxScrollLeft: scrollers.reduce((m, s) => Math.max(m, s.scrollLeft), 0),
      outside: widest,
      h1: h1r ? { text: (h1.textContent || "").trim().slice(0, 70), left: round(h1r.left), right: round(h1r.right), top: round(h1r.top + window.scrollY) } : null,
      headerAdd: hdrR
        ? { text: (headerAddBtn.textContent || "").trim().slice(0, 40), left: round(hdrR.left), right: round(hdrR.right), top: round(hdrR.top + window.scrollY), width: round(hdrR.width) }
        : null,
      add: addR
        ? { text: (addBtn.textContent || "").trim().slice(0, 40), left: round(addR.left), right: round(addR.right), top: round(addR.top + window.scrollY), width: round(addR.width) }
        : null,
    };
  });
}

module.exports = { measurePage };
