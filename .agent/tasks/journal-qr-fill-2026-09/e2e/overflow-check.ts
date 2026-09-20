// Переполнение колонок в карточках складов на узких экранах и с крупным шрифтом.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderForm, renderPage, renderWho } from "@/lib/journal-fill-html";
const OUT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const who = renderWho({ employeeName: "Абдухалилова Шайирахон Фахритдиновна", changeHref: "#" });
const html = renderPage({
  orgName: "Одинцовская Лингвистическая Гимназия",
  title: "Бланк контроля температуры и влажности на складах",
  body: renderForm({
    action: "#", token: "t", who, employeeName: "Абдухалилова", correctionPresets: ["Сообщил руководителю"], openedAt: 1, suggestions: {}, hints: {},
    values: { time: "10:00", r1t: "18", r1h: "38" }, stamp: { date: "20.09.2026", time: "20:17" }, offKeys: ["r2t"],
    form: {
      fields: [
        { type: "select", key: "time", label: "Время замера", required: true, options: [{ value: "10:00", label: "10:00" }] },
        { type: "number", key: "r1t", label: "Склад Бакалея — t° · норма 18…22", unit: "°C", required: true, min: -40, max: 60 },
        { type: "number", key: "r1h", label: "Склад Бакалея — влажность · норма 40…60", unit: "%", min: 0, max: 100 },
        { type: "number", key: "r2t", label: "Склад Овощи/Фрукты — t° · норма 16…20", unit: "°C", required: true, min: -40, max: 60 },
        { type: "number", key: "r2h", label: "Склад Овощи/Фрукты — влажность · норма 40…75", unit: "%", min: 0, max: 100 },
      ],
      submitLabel: "Сохранить замер",
    },
  }),
});
const file = path.join(OUT, "preview-overflow.html");
fs.writeFileSync(file, html);
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [w, font] of [[390, 16], [360, 16], [375, 19], [320, 17]] as const) {
    const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 })).newPage();
    await page.goto(`file://${file}`);
    await page.addStyleTag({ content: `html{font-size:${font}px}` });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll(".cols"));
      const overflow = cols.filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      const chips = Array.from(document.querySelectorAll(".cols .chip.offc")).map((el) => {
        const fl = el.closest(".fl")!.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return Math.round(b.right - fl.right);
      });
      const boxes = Array.from(document.querySelectorAll(".cols .box")).map((el) => Math.round(el.getBoundingClientRect().top));
      return { overflow, chipOverhang: Math.max(...chips), boxTops: boxes };
    });
    console.log(`${w}px font ${font}:`, JSON.stringify(r));
    await page.screenshot({ path: path.join(OUT, "shots", `overflow-${w}-${font}.png`), fullPage: true });
    await page.context().close();
  }
  await browser.close();
})();
