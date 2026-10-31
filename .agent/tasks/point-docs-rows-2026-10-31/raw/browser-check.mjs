// e2e-база (порт 3021), не прод: документы точки А — без людей, помещений и
// оборудования точки Б (AC3, AC4, AC6). Проверяем и текст страницы, и данные,
// которые сервер передал клиенту (HTML с RSC), — списки выбора там целиком.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const dir = ".agent/tasks/point-docs-rows-2026-10-31/raw";
const fx = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const base = "http://localhost:3021";
const T = 600000;
const out = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  await page.goto(`${base}/login`, { timeout: T });
  await page.fill("#email", fx.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T });
  const switched = await page.evaluate(async (buildingId) => {
    const res = await fetch("/api/me/active-building", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildingId }),
    });
    return res.status;
  }, fx.pointA);
  check("в шапке выбрана точка А", switched === 200, `HTTP ${switched}`);

  // AC3: справочник для окна «Добавить оборудование» документа точки А.
  const names = await page.evaluate(async (documentId) => {
    const scoped = await (await fetch(`/api/equipment?documentId=${documentId}`)).json();
    const all = await (await fetch("/api/equipment")).json();
    return { scoped: scoped.equipment.map((item) => item.name), all: all.equipment.map((item) => item.name) };
  }, fx.coldId);
  check("справочник документа точки А: только ШХ точки А", JSON.stringify(names.scoped) === JSON.stringify(["ШХ точки А"]), names.scoped.join(", "));
  check("справочник без документа — как раньше, всё оборудование", names.all.length === 2, names.all.join(", "));

  // AC6: люди в данных страницы документа уборки и холодильников.
  for (const [label, url, marker] of [
    ["уборка", `/journals/cleaning/documents/${fx.cleaningId}`, "Кухня точки А"],
    ["холодильники", `/journals/cold_equipment_control/documents/${fx.coldId}`, "ШХ точки А"],
  ]) {
    await page.goto(`${base}${url}`, { timeout: T });
    await page.getByText(marker).first().waitFor({ timeout: T });
    const html = await page.content();
    check(`${label} точки А: сотрудница точки А есть в данных страницы`, html.includes("Анна точки А"));
    check(`${label} точки А: сотрудника точки Б нет в данных страницы`, !html.includes("Борис точки Б"));
  }
  // Сам документ оборудование справочника не получает — смотрим экран. В HTML
  // dev-сервера «ШХ точки Б» есть только в отладочной записи React о запросе
  // автоочистки (`"env":"Server","name":"Promise.all","value":…`), в рабочей
  // сборке её нет.
  const coldText = await page.locator("body").innerText();
  check("холодильники точки А: шкафа точки Б нет на экране", !coldText.includes("ШХ точки Б"));

  // AC1 + AC4: график генуборок точки А.
  await page.goto(`${base}/journals/general_cleaning/documents/${fx.generalId}`, { timeout: T });
  await page.getByText("Кухня точки А").first().waitFor({ timeout: T });
  const generalHtml = await page.content();
  check("генуборки точки А: своё помещение видно", generalHtml.includes("Кухня точки А"));
  check("генуборки точки А: строка с отмеченной уборкой точки Б осталась", generalHtml.includes("Склад точки Б"));
  check("генуборки точки А: помещения «Кухня точки Б» нет ни в строках, ни в выборе", !generalHtml.includes("Кухня точки Б"));
  await page.screenshot({ path: `${dir}/general-point-a.png`, fullPage: false });
} finally {
  await browser.close();
}
writeFileSync(`${dir}/browser-check.txt`, out.join("\n") + "\n");
const failed = out.filter((line) => line.startsWith("FAIL")).length;
console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
process.exit(failed === 0 ? 0 : 1);
