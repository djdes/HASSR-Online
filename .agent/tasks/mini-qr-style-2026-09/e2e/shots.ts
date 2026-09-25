// Снимки 390 px в светлой и тёмной теме + автопроверка каждого экрана.
// Запуск (dev на 3041): PHASE=before|after npx tsx .agent/tasks/mini-qr-style-2026-09/e2e/shots.ts
import fs from "node:fs";
import path from "node:path";

import { db } from "./db";
import { HERE, BASE, openTelegram, type Role, type Theme } from "./tg";

const PHASE = process.env.PHASE ?? "after";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const THEMES: Theme[] = (process.env.THEMES ?? "light,dark").split(",") as Theme[];
const OUT = path.join(HERE, "..", "evidence", PHASE);
fs.mkdirSync(OUT, { recursive: true });
const PROBE = fs.readFileSync(path.join(HERE, "probe.js"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "state.json"), "utf8")) as { docs: Record<string, string>; claimId: string | null };

const SCREENS: Array<{ key: string; role: Role; path: string }> = [
  { key: "home-manager", role: "manager", path: "/dashboard" },
  { key: "journals", role: "manager", path: "/journals" },
  { key: "documents", role: "manager", path: `/mini/documents/${state.docs.hygiene}` },
  { key: "handover", role: "manager", path: "/mini/shift-handover" },
  { key: "me", role: "manager", path: "/mini/me" },
  { key: "sections", role: "manager", path: "/mini/sections" },
  // Дополнительно (без «до»): свои экраны приложения вне обязательного списка.
  { key: "outbox", role: "manager", path: "/mini/outbox" },
  { key: "login", role: "manager", path: "/mini/login" },
  { key: "home-cook-today", role: "cook", path: "/mini/today" },
  { key: "fill-claim", role: "cook", path: `/mini/claim/${state.claimId}` },
];

async function main() {
  const report: unknown[] = [];
  for (const theme of THEMES) {
    for (const role of ["manager", "cook"] as Role[]) {
      const screens = SCREENS.filter((s) => s.role === role && (!ONLY || ONLY.test(s.key)));
      if (screens.length === 0) continue;
      const s = await openTelegram({ role, theme });
      try {
        // Прогрев: в dev первый заход на маршрут компилирует его и может
        // перезагрузить страницу посреди замера.
        for (const screen of screens) {
          await s.page.goto(`${BASE}${screen.path}`, { waitUntil: "load", timeout: 300000 }).catch(() => null);
          await s.page.waitForSelector("header.mini-topbar", { timeout: 120000 }).catch(() => null);
          await s.page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => null);
        }
        for (const screen of screens) {
          s.errors.length = 0;
          // Редирект /mini/* → страница кабинета иногда обрывает первый переход (ERR_ABORTED) — повторяем.
          for (let attempt = 0; attempt < 3; attempt++) {
            const ok = await s.page.goto(`${BASE}${screen.path}`, { waitUntil: "load", timeout: 300000 }).then(() => true).catch(() => false);
            if (ok) break;
            await s.page.waitForTimeout(2000);
          }
          // Экран «устоялся»: есть шапка оболочки, ушли заглушки «Загружаем…»
          // и крутилки. В dev страницу иногда перезагружает пересборка, поэтому
          // проверяем перед замером и перед каждым снимком.
          const ready = () =>
            s.page
              .evaluate(() => {
                if (!document.querySelector("header.mini-topbar")) return false;
                if (/Загружаем задачи|Открываем задачу|Загружаем…|Открываем кабинет/.test(document.body.innerText)) return false;
                return ![...document.querySelectorAll("main .animate-spin")].some((el) => el.getBoundingClientRect().width > 0);
              })
              .catch(() => false);
          const settle = async () => {
            await s.page.waitForSelector("header.mini-topbar", { timeout: 60000 }).catch(() => null);
            await s.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
            for (let i = 0; i < 45 && !(await ready()); i++) await s.page.waitForTimeout(2000);
            await s.page.waitForTimeout(800);
          };
          await settle();
          // Всплывающие окна «Что нового» / подсказки закрываем — снимаем сам экран.
          for (const name of ["Понятно", "Закрыть", "Позже"]) {
            const b = s.page.locator('[role="dialog"]').getByRole("button", { name }).first();
            if (await b.isVisible().catch(() => false)) {
              await b.click().catch(() => null);
              await s.page.waitForTimeout(300);
            }
          }
          let probe: Record<string, unknown> | null = null;
          for (let attempt = 0; attempt < 4 && !probe; attempt++) {
            await settle();
            probe = (await s.page.evaluate(PROBE).catch(() => null)) as Record<string, unknown> | null;
            if (probe && probe.headerH === null) probe = null;
          }
          if (!probe) probe = { error: "probe failed" };
          const file = `${theme}-${screen.key}.png`;
          // Снимок принимаем, только если до и после него экран «устоялся»
          // (не белый кадр перезагрузки и не крутилка).
          for (let attempt = 0; attempt < 5; attempt++) {
            await settle();
            const png = await s.page.screenshot({ fullPage: false }).catch(() => null);
            if (png && png.length > 12000 && (await ready())) {
              fs.writeFileSync(path.join(OUT, file), png);
              break;
            }
            await s.page.waitForTimeout(3000);
          }
          const row = { theme, screen: screen.key, final: s.page.url().replace(BASE, ""), ...probe, errors: s.errors.slice(0, 4), shot: file };
          report.push(row);
          console.log(
            JSON.stringify({ theme, screen: screen.key, final: row.final, hScroll: probe.hScroll, headerH: probe.headerH, navH: probe.navH, small: probe.small, smallFont: (probe.smallFont as string[] | undefined)?.length, near: probe.near, lowC: (probe.lowContrast as string[] | undefined)?.length, font: probe.bodyFontMedian })
          );
        }
      } finally {
        await s.close();
      }
    }
  }
  // Частичный прогон (ONLY=…) дописывает свои экраны в уже снятый отчёт.
  const reportFile = path.join(OUT, "report.json");
  const rowKey = (r: unknown) => `${(r as { theme: string }).theme}/${(r as { screen: string }).screen}`;
  const merged =
    ONLY && fs.existsSync(reportFile)
      ? [
          ...(JSON.parse(fs.readFileSync(reportFile, "utf8")) as unknown[]).filter(
            (old) => !report.some((row) => rowKey(row) === rowKey(old))
          ),
          ...report,
        ]
      : report;
  fs.writeFileSync(reportFile, JSON.stringify(merged, null, 1));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
