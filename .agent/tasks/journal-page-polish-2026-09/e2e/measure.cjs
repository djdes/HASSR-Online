/** Всё считается в браузере: прямоугольники, зазоры, подчёркивание, полоса под рядом. */
function measureInPage() {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) };
  };
  const round = (n) => (n == null ? null : +n.toFixed(2));
  const main = document.querySelector("main") || document.body;
  const h1 = main.querySelector("h1");
  const block = main.querySelector("[data-journal-list-actions]");
  const qr = block && block.querySelector('[data-testid="journal-qr-point"]');
  const cells = block ? Array.from(block.children).filter((c) => c !== qr) : [];
  const btn = (cell) => (cell ? cell.firstElementChild || cell : null);
  const create = cells.length > 1 ? btn(cells[0]) : null;
  const guide = btn(cells[cells.length - 1]);
  const row = block && block.parentElement; // строка «заголовок + блок»

  // Вкладки: ссылка «Активные» и её ряд (общий предок с «Закрытые»).
  const links = Array.from(main.querySelectorAll("a")).filter((a) => /^(Активные|Закрытые)$/.test(a.textContent.trim()));
  const active = links.find((a) => a.textContent.trim() === "Активные");
  const closed = links.find((a) => a.textContent.trim() === "Закрытые");
  let tabsRow = active;
  while (tabsRow && closed && !tabsRow.contains(closed)) tabsRow = tabsRow.parentElement;
  // Самый внешний контейнер вкладок, который содержит только их (без соседних блоков страницы).
  let tabsOuter = tabsRow;
  while (
    tabsOuter &&
    tabsOuter.parentElement &&
    tabsOuter.parentElement !== main &&
    tabsOuter.parentElement.children.length === 1
  ) {
    tabsOuter = tabsOuter.parentElement;
  }

  function textRect(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return r(range);
      }
    }
    return null;
  }

  /** Подчёркивание — ::after с заливкой у ссылки или её потомка. */
  function underline(el) {
    if (!el) return null;
    const cands = [el, ...el.querySelectorAll("*")];
    for (const c of cands) {
      const s = getComputedStyle(c, "::after");
      if (!s || s.content === "none" || s.content === "normal") continue;
      const bg = s.backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
      const box = c.getBoundingClientRect();
      const top = parseFloat(s.top);
      const left = parseFloat(s.left);
      const width = parseFloat(s.width);
      const height = parseFloat(s.height);
      return {
        on: c === el ? "link" : c.tagName.toLowerCase(),
        top: round(box.top + top),
        bottom: round(box.top + top + height),
        left: round(box.left + left),
        right: round(box.left + left + width),
        width: round(width),
        height: round(height),
        color: bg,
      };
    }
    return null;
  }

  function lineUnder(el) {
    // Полоса «под всем рядом» — нижняя граница у контейнера вкладок или его предков до main.
    for (let c = el; c && c !== main; c = c.parentElement) {
      const s = getComputedStyle(c);
      const w = parseFloat(s.borderBottomWidth);
      if (w > 0 && s.borderBottomStyle !== "none") {
        const b = c.getBoundingClientRect();
        return { width: round(b.width), px: w, color: s.borderBottomColor, y: round(b.bottom - w), tag: c.tagName.toLowerCase() };
      }
    }
    return null;
  }

  // Что стоит прямо над строкой «заголовок + блок» (полоса автоматики / крошки).
  let above = null;
  if (row) {
    const rowTop = row.getBoundingClientRect().top;
    for (const el of main.querySelectorAll("*")) {
      if (el.contains(row) || row.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.height <= 0 || b.width <= 0) continue;
      if (b.bottom <= rowTop + 0.5 && (!above || b.bottom > above.bottom + 0.01)) {
        above = { bottom: b.bottom, tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 40) };
      }
    }
  }

  // Первая карточка документа под вкладками.
  let card = null;
  if (tabsOuter) {
    const tabsBottom = tabsOuter.getBoundingClientRect().bottom;
    for (const el of main.querySelectorAll("div")) {
      const b = el.getBoundingClientRect();
      if (b.top >= tabsBottom - 0.5 && b.height > 30 && /rounded-2xl/.test(el.className) && (!card || b.top < card.top)) {
        card = { top: b.top, cls: el.className.slice(0, 60) };
      }
    }
  }

  const R = {
    title: r(h1),
    row: r(row),
    block: r(block),
    qr: r(qr),
    create: r(create),
    guide: r(guide),
    tabsOuter: r(tabsOuter),
    activeLink: r(active),
    activeText: active ? textRect(active) : null,
    closedText: closed ? textRect(closed) : null,
    underline: underline(active),
    line: tabsOuter ? lineUnder(tabsRow) : null,
    above: above && { bottom: round(above.bottom), tag: above.tag, text: above.text },
    cardTop: card && round(card.top),
    viewport: { width: innerWidth, height: innerHeight },
    blockGapCss: block ? getComputedStyle(block).rowGap + " / " + getComputedStyle(block).columnGap : null,
    rowGapCss: row ? getComputedStyle(row).rowGap : null,
  };
  const stacked = R.title && R.block && R.block.top >= R.title.bottom - 0.5; // блок под заголовком (телефон)
  R.layout = stacked ? "stacked" : "side-by-side";
  R.gaps = {
    titleToQr: stacked && R.qr ? round(R.qr.top - R.title.bottom) : null,
    aboveToBlock: !stacked && R.above && R.block ? round(R.block.top - R.above.bottom) : null,
    aboveToRow: R.above && R.row ? round(R.row.top - R.above.bottom) : null,
    qrToRow: R.qr && (R.create || R.guide) ? round((R.create || R.guide).top - R.qr.bottom) : null,
    createToGuide: R.create && R.guide ? round(R.guide.left - R.create.right) : null,
    blockToTabs: R.block && R.tabsOuter ? round(R.tabsOuter.top - R.block.bottom) : null,
    rowToTabs: R.row && R.tabsOuter ? round(R.tabsOuter.top - R.row.bottom) : null,
    blockToTabText: R.block && R.activeText ? round(R.activeText.top - R.block.bottom) : null,
    textToUnderline: R.activeText && R.underline ? round(R.underline.top - R.activeText.bottom) : null,
    underlineVsTextWidth: R.activeText && R.underline ? round(R.underline.width - R.activeText.width) : null,
    underlineToLine: R.underline && R.line ? round(R.line.y - R.underline.bottom) : null,
    tabsToCard: R.tabsOuter && R.cardTop != null ? round(R.cardTop - R.tabsOuter.bottom) : null,
    underlineToCard: R.underline && R.cardTop != null ? round(R.cardTop - R.underline.bottom) : null,
  };
  return R;
}


module.exports = { measureInPage };
