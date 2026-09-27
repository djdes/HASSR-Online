// Помещается ли «Создать документ» в одну строку: ширина кнопки, ширина содержимого, строк текста.
const { launch, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
(async () => {
  const browser = await launch();
  try {
    for (const w of [360, 375, 390, 430]) {
      const ctx = await newContext(browser, { width: w, height: 800 }, "manager");
      const page = await quietPage(ctx);
      await gotoHydrated(page, "/journals/cold_equipment_control", "[data-journal-list-actions]");
      const m = await page.evaluate(() => {
        const block = document.querySelector("[data-journal-list-actions]");
        const cells = Array.from(block.children).slice(1);
        return cells.map((cell) => {
          const btn = cell.firstElementChild;
          const s = getComputedStyle(btn);
          const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
          let n, rects = [];
          while ((n = walker.nextNode())) if (n.textContent.trim()) { const r = document.createRange(); r.selectNodeContents(n); rects = Array.from(r.getClientRects()); }
          const icon = btn.querySelector("svg");
          const b = btn.getBoundingClientRect();
          const first = icon ? icon.getBoundingClientRect().left : rects[0]?.left;
          const last = rects.length ? Math.max(...rects.map((r) => r.right)) : 0;
          return { text: btn.textContent.trim(), width: +b.width.toFixed(1), padL: s.paddingLeft, font: s.fontSize, lines: rects.length, contentW: +(last - first).toFixed(1), slack: +((b.width - (last - first)) / 2).toFixed(1) };
        });
      });
      console.log(w, JSON.stringify(m));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
