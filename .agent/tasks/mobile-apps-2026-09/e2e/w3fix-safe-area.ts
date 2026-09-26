// Волна 3, fixes №2: отступы под вырез через var(--safe-area-inset-X, env(...)).
// Без переменной значения прежние (env = 0 в Chromium без выреза), с
// переменной Android (как её ставит приложение) — берутся из неё.
// Стенд 3021. Запуск: node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/w3fix-safe-area.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { BASE, USERS, db, signIn } from "./server-db";

const CLASSES = [
  "pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))]",
  "pb-[max(12px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]",
  "pb-[max(var(--safe-area-inset-bottom,env(safe-area-inset-bottom)),16px)]",
  "bottom-[max(1.5rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]",
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown> = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await signIn(ctx, USERS.managerA);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
    await page.waitForTimeout(1500);
    const measure = (withVar: boolean) =>
      page.evaluate(
        ({ classes, withVar }) => {
          const root = document.documentElement;
          if (withVar) root.style.setProperty("--safe-area-inset-bottom", "30px");
          else root.style.removeProperty("--safe-area-inset-bottom");
          return classes.map((cls) => {
            const el = document.createElement("div");
            el.className = cls;
            el.style.position = "fixed";
            document.body.appendChild(el);
            const cs = getComputedStyle(el);
            const v = cls.startsWith("bottom") ? cs.bottom : cs.paddingBottom;
            el.remove();
            return v;
          });
        },
        { classes: CLASSES, withVar }
      );
    out.withoutVar = await measure(false);
    out.withVar = await measure(true);
    assert.deepEqual(out.withoutVar, ["0px", "12px", "16px", "24px"]);
    assert.deepEqual(out.withVar, ["30px", "30px", "30px", "30px"]);

    // Страница заполнения по QR (journal-fill-html): CSS с тем же var().
    const html = await (await ctx.request.get(`${BASE}/journal-fill/x/y`)).text();
    out.fillHtmlHasVar = html.includes("var(--safe-area-inset-bottom,env(safe-area-inset-bottom))");
    out.fillHtmlViewport = /<meta name="viewport"[^>]*viewport-fit=cover/.test(html);
    await ctx.close();
    out.ok = true;
  } finally {
    writeFileSync(".agent/tasks/mobile-apps-2026-09/e2e/w3fix-safe-area.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
