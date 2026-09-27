// Страница журнала и окно переименования в оболочке приложения (как на iPhone владельца):
// кука ws-shell=mini, 390×844, touch. Замеры шапки/вкладок, снимки, цепочка стилей и обработчиков поля.
// Запуск: node mini-probe.cjs <label>
const fs = require("node:fs");
const path = require("node:path");
const { OUT, BASE, launch, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
const { measureInPage } = require("./measure.cjs");

const label = process.argv[2] || "before";
const dir = path.join(OUT, label);
fs.mkdirSync(dir, { recursive: true });
const INPUT = '[data-testid="journal-rename-dialog"] input';

(async () => {
  const out = { label, at: new Date().toISOString(), pageErrors: [] };
  const browser = await launch();
  try {
    const ctx = await newContext(browser, { width: 390, height: 844 }, "manager");
    const host = new URL(BASE).hostname;
    await ctx.addCookies([{ name: "ws-shell", value: "mini", domain: host, path: "/", sameSite: "Lax" }]);
    const page = await quietPage(ctx, out);
    await gotoHydrated(page, "/journals/cold_equipment_control", "[data-journal-list-actions]");
    out.shell = await page.evaluate(() => ({
      miniRoot: !!document.getElementById("mini-root"),
      appShellClass: document.querySelector(".app-shell")?.className?.slice(0, 80) ?? null,
    }));
    out.geometry = await page.evaluate(measureInPage);
    console.log("mini gaps", JSON.stringify(out.geometry.gaps), "line", JSON.stringify(out.geometry.line));
    await page.screenshot({ path: path.join(dir, "cold-390-mini.png") });

    const pencil = page.locator('button[aria-label="Переименовать журнал"]').first();
    await pencil.scrollIntoViewIfNeeded();
    await pencil.tap();
    await page.waitForSelector(INPUT, { timeout: 20000 });
    await page.waitForTimeout(500);
    out.rename = await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      const chain = [];
      for (let el = input; el; el = el.parentElement) {
        const s = getComputedStyle(el);
        chain.push({
          el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + String(el.className).slice(0, 40),
          userSelect: s.userSelect || s.webkitUserSelect,
          pointerEvents: s.pointerEvents,
          touchAction: s.touchAction,
          position: s.position,
          overflowY: s.overflowY,
        });
      }
      const fiberKey = Object.keys(input).find((k) => k.startsWith("__reactFiber"));
      const handlers = [];
      for (let f = fiberKey ? input[fiberKey] : null; f; f = f.return) {
        const p = f.memoizedProps;
        if (!p || typeof p !== "object") continue;
        const keys = Object.keys(p).filter((k) => /^on[A-Z]/.test(k) && typeof p[k] === "function");
        if (!keys.length) continue;
        const name = typeof f.type === "string" ? f.type : (f.type && (f.type.displayName || f.type.name)) || "?";
        handlers.push(`${name}: ${keys.join(",")}`);
      }
      return {
        focused: document.activeElement === input,
        active: document.activeElement?.tagName,
        selection: [input.selectionStart, input.selectionEnd],
        fontSize: getComputedStyle(input).fontSize,
        chain,
        handlers,
        bodyStyle: document.body.getAttribute("style"),
      };
    }, INPUT);
    console.log(JSON.stringify(out.rename, null, 1));
    await page.screenshot({ path: path.join(dir, "rename-390-mini.png") });
    await ctx.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(dir, "mini-probe.json"), JSON.stringify(out, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
