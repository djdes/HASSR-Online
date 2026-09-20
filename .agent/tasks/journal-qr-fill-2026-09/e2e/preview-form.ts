// Статический предпросмотр формы без БД: климат (склады) и холодильники → HTML → скриншот 390px.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderForm, renderPage, renderWho } from "@/lib/journal-fill-html";
const OUT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const who = renderWho({ employeeName: "Абдухалилова Шайирахон Фахритдиновна", changeHref: "#" });
const climate = renderPage({
  orgName: "Одинцовская Лингвистическая Гимназия",
  title: "Бланк контроля температуры и влажности на складах",
  body: renderForm({
    action: "#", token: "t", who, employeeName: "Абдухалилова Шайирахон Фахритдиновна", correctionPresets: ["Сообщил руководителю", "Вызвал мастера"], openedAt: 1, suggestions: {}, hints: {},
    values: { time: "10:00", r1t: "18", r1h: "38" }, stamp: { date: "20.09.2026", time: "20:17" },
    form: {
      intro: "Абдухалилова Шайирахон Фахритдиновна, снимите показания температуры (и влажности — где включено) по каждому помещению и выберите время замера.",
      fields: [
        { type: "select", key: "time", label: "Время замера", required: true, options: [{ value: "10:00", label: "10:00" }, { value: "16:00", label: "16:00" }] },
        { type: "number", key: "r1t", label: "Склад Бакалея — t° · норма 18…22", unit: "°C", required: true, min: -40, max: 60 },
        { type: "number", key: "r1h", label: "Склад Бакалея — влажность · норма 40…60", unit: "%", min: 0, max: 100 },
        { type: "number", key: "r2t", label: "Склад Буфетная продукция — t° · норма 18…22", unit: "°C", required: true, min: -40, max: 60 },
        { type: "number", key: "r2h", label: "Склад Буфетная продукция — влажность · норма 40…60", unit: "%", min: 0, max: 100 },
        { type: "number", key: "r3t", label: "Склад Овощи/Фрукты — t° · норма 16…20", unit: "°C", required: true, min: -40, max: 60 },
        { type: "number", key: "r3h", label: "Склад Овощи/Фрукты — влажность · норма 40…75", unit: "%", min: 0, max: 100 },
      ],
      submitLabel: "Сохранить замер",
    },
  }),
});
const cold = renderPage({
  orgName: "Кафе «Тестовое 1»",
  title: "Журнал контроля температурного режима холодильного и морозильного оборудования",
  body: renderForm({
    action: "#", token: "t", who, employeeName: "Абдухалилова Шайирахон Фахритдиновна", correctionPresets: ["Сообщил руководителю"], openedAt: 1, suggestions: {}, hints: {},
    values: { e1: "4", e2: "-12" },
    form: {
      intro: "Абдухалилова Шайирахон Фахритдиновна, снимите показания каждого холодильника и введите температуру в °C. Если оборудование выключено — оставьте поле пустым и сообщите начальнику.",
      fields: [
        { type: "number", key: "e1", label: "Холодильник №1 · норма 2…6", unit: "°C", min: -40, max: 30 },
        { type: "number", key: "e2", label: "Морозильник · норма -20…-16", unit: "°C", min: -40, max: 30 },
        { type: "number", key: "e3", label: "Витрина бар · норма 2…8", unit: "°C", min: -40, max: 30 },
      ],
      submitLabel: "Сохранить замеры",
    },
  }),
});
fs.writeFileSync(path.join(OUT, "preview-climate.html"), climate);
fs.writeFileSync(path.join(OUT, "preview-cold.html"), cold);
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const name of ["climate", "cold"]) {
    await page.goto("file:///" + path.join(OUT, `preview-${name}.html`).split(path.sep).join("/"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "shots", `preview-${name}.png`), fullPage: true });
    console.log(name, "prog:", await page.locator("#prog").textContent(), "| bad:", await page.locator(".fl.bad").count(), "good:", await page.locator(".fl.good").count());
  }
  await browser.close();
})();
