// Проверка памяток в браузере на ЛОКАЛЬНОЙ тестовой базе (wesetup_memos), не на проде.
// Данные — raw/seed-local.ts. Запуск (из корня worktree):
//   BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/memos-point-2026-10-28/raw/e2e.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const LIST = `${BASE}/production-control/documents/posters`;
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, OUT));
const JSQR = fileURLToPath(new URL("../../../../node_modules/jsqr/dist/jsQR.js", import.meta.url));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function session(browser, email, viewport = { width: 1440, height: 1000 }, cookies = []) {
  const ctx = await browser.newContext({ viewport });
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  // Форма гидратируется не сразу: поля, заполненные раньше, React очищает.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    if ((await page.inputValue("#email")) !== email) continue;
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      // Курсор остаётся над кнопкой входа — уводим, чтобы на снимках не было hover.
      await page.mouse.move(1, viewport.height - 1);
      return { ctx, page };
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  throw new Error(`Не удалось войти: ${email}`);
}

/** QR памятки «Ежедневный осмотр» → адрес (jsQR в браузере по SVG листа). */
async function readQr(page) {
  if ((await page.locator("[data-poster-qr] svg").count()) === 0) return null;
  await page.addScriptTag({ path: JSQR });
  return page.evaluate(async () => {
    const svg = document.querySelector("[data-poster-qr] svg").cloneNode(true);
    const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
    const width = 800;
    const height = Math.round((width * h) / w);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    return window.jsQR(data.data, width, height)?.data ?? null;
  });
}

const tokenOf = (url) => decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
const text = async (page, selector) => (await page.locator(selector).first().textContent())?.replace(/\s+/g, " ").trim() ?? "";

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // ---------------------------------------------------------------- МАУ «КП «ДК»: 3 точки + офис, журналы по точкам
  {
    const { ctx, page } = await session(browser, "dk-owner@test.local");
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(LIST);
    await page.waitForSelector("[data-poster-point-picker]");
    const options = await page.locator("[data-poster-point-option]").evaluateAll((els) => els.map((el) => el.getAttribute("data-poster-point-option")));
    check("AC2 переключатель: три торговые точки, офиса нет", options.join(",") === "b-dk-5,b-dk-112,b-dk-mira", options.join(","));
    const active = await page.locator('[data-poster-point-option][aria-current="true"]').getAttribute("data-poster-point-option");
    check("AC2 по умолчанию — первая торговая точка (в шапке офис)", active === "b-dk-5", active);
    const previewPoint = await text(page, "[data-poster-point]");
    check("AC1 мини-листы — с точкой по умолчанию", previewPoint.includes("Пищеблок СОШ № 5"), previewPoint);
    await page.screenshot({ path: shot("1-list-default.png"), fullPage: false });

    await page.click('[data-poster-point-option="b-dk-112"]');
    await page.waitForURL(/point=b-dk-112/);
    await page.waitForFunction(() => document.querySelector("[data-poster-point]")?.textContent?.includes("Комбинат питания"));
    const activeAfter = await page.locator('[data-poster-point-option][aria-current="true"]').getAttribute("data-poster-point-option");
    check("AC2 выбор точки — в адресе и подсвечен", activeAfter === "b-dk-112", activeAfter);
    const printAll = await page.getByRole("link", { name: "Печатать все" }).getAttribute("href");
    check("AC2 «Печатать все» несёт точку", printAll?.includes("point=b-dk-112"), printAll);
    await page.getByRole("checkbox", { name: "Выбрать плакат «Мытьё столовой посуды вручную»" }).click();
    const printSelected = await page.getByRole("link", { name: /Печатать выбранные/ }).getAttribute("href");
    check("AC2 «Печатать выбранные» несёт точку", printSelected?.includes("keys=dishes") && printSelected.includes("point=b-dk-112"), printSelected);
    const pointBox = await page.locator("[data-poster-point-picker]").boundingBox();
    await page.screenshot({ path: shot("2-list-picked.png"), clip: { x: 0, y: Math.max(0, pointBox.y - 140), width: 1440, height: 900 } });

    // Печать: точка на каждом листе, подвал, QR осмотра в журнал точки.
    await page.goto(`${LIST}/all?point=b-dk-112`);
    await page.waitForSelector("[data-print-brand-frame]");
    const sheets = await page.locator("[data-print-brand-frame]").count();
    const withPoint = await page.locator("[data-print-brand-frame] [data-poster-point]").count();
    check("AC1 точка на каждом из 17 листов", sheets === 17 && withPoint === 17, `${withPoint}/${sheets}`);
    const pointText = await text(page, "[data-poster-point]");
    check("AC1 текст точки — наименование для журналов", pointText.startsWith("МАУ «Комбинат питания «Дружба»"), pointText.slice(0, 60));
    const pointLines = await page.locator("[data-poster-point] > span").first().evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    check("AC1 длинное название — не больше двух строк", pointLines <= 2, `${pointLines} строк`);
    const footers = await page.locator("[data-print-brand-footer]").allTextContents();
    check("AC4 подвал на всех листах: организация и wesetup.ru", footers.length === 17 && footers.every((f) => f.includes("МАУ «КП «ДК»") && f.trim().endsWith("wesetup.ru")), footers[0]);
    const back = await page.getByRole("link", { name: "Все плакаты" }).getAttribute("href");
    check("AC2 «Все плакаты» возвращает к выбранной точке", back?.endsWith("?point=b-dk-112"), back);
    const bw = await page.getByRole("switch").getAttribute("href");
    check("AC2 «Ч/б» сохраняет точку", bw?.includes("point=b-dk-112") && bw.includes("bw=1"), bw);

    await page.goto(`${LIST}/daily-inspection?point=b-dk-112`);
    await page.waitForSelector("[data-poster-qr] svg");
    const qr112 = await readQr(page);
    check("AC3 QR осмотра ведёт в гигиенический журнал точки 112", qr112?.includes("/journal-fill/org-dk/hygiene") && tokenOf(qr112).includes("b~b-dk-112"), qr112);
    await page.locator("[data-print-brand-frame]").screenshot({ path: shot("3-daily-inspection.png") });
    await page.goto(`${LIST}/daily-inspection?point=b-dk-5`);
    await page.waitForSelector("[data-poster-qr] svg");
    const qr5 = await readQr(page);
    check("AC3 у другой точки — другой QR", tokenOf(qr5).includes("b~b-dk-5") && !tokenOf(qr5).includes("b-dk-112"), qr5);

    await page.goto(`${LIST}/dishes?point=b-dk-office`);
    await page.waitForSelector("[data-poster-point]");
    const office = await text(page, "[data-poster-point]");
    check("AC2 офис в адресе — печать для точки по умолчанию", office.includes("Пищеблок СОШ № 5"), office);

    // Листы — в вёрстке печати (шапка кабинета скрыта, ширина 190 мм).
    await page.setViewportSize({ width: 718, height: 1100 });
    await page.emulateMedia({ media: "print" });
    for (const key of ["dishes", "storage", "hand-washing", "antiseptic", "chef-clothing", "daily-inspection", "daily-sample", "chlormisept-r"]) {
      await page.goto(`${LIST}/${key}?point=b-dk-5`);
      await page.waitForSelector("[data-print-brand-frame]");
      await page.locator("[data-print-brand-frame]").screenshot({ path: shot(`4-${key}.png`) });
    }
    await page.emulateMedia({ media: null });
    check("страницы без ошибок в браузере", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- админ, которому доступна одна точка
  {
    const { ctx, page } = await session(browser, "dk-admin5@test.local");
    await page.goto(LIST);
    await page.waitForSelector("[data-poster-point-picker]");
    const options = await page.locator("[data-poster-point-option]").count();
    const links = await page.locator("a[data-poster-point-option]").count();
    const heading = await text(page, "[data-poster-point-picker] h2");
    check("AC2 одна доступная точка — без выбора", options === 1 && links === 0 && heading === "Печатаем для точки", `${options}/${links} ${heading}`);
    await page.goto(`${LIST}/daily-inspection?point=b-dk-112`);
    await page.waitForSelector("[data-poster-point]");
    const point = await text(page, "[data-poster-point]");
    check("AC2 чужая точка в адресе не печатается", point.includes("Пищеблок СОШ № 5") && !point.includes("Комбинат"), point);
    const qr = await readQr(page);
    check("AC3 QR — журнал своей точки", tokenOf(qr ?? "https://x/?token=").includes("b~b-dk-5"), qr);
    await ctx.close();
  }

  // ---------------------------------------------------------------- одна точка, журналы общие, свой сайт
  {
    const { ctx, page } = await session(browser, "one-owner@test.local");
    await page.goto(LIST);
    await page.waitForSelector("[data-poster-point-picker]");
    await page.locator("[data-poster-point-picker]").screenshot({ path: shot("5-single-point.png") });
    await page.goto(`${LIST}/daily-inspection`);
    await page.waitForSelector("[data-print-brand-frame]");
    const header = await text(page, "[data-print-brand-header]");
    const footer = await text(page, "[data-print-brand-footer]");
    check("AC4 свой сайт — в шапке, в подвале — wesetup.ru", header.includes("dobroe-kafe.ru") && footer.endsWith("wesetup.ru") && !footer.includes("dobroe"), `${header} | ${footer}`);
    const point = await text(page, "[data-poster-point]");
    check("AC1 одна точка — её название и адрес", point === "Доброе кафе на Садовой · ул. Садовая, 7", point);
    const qr = await readQr(page);
    check("AC3 журналы общие — QR на общий журнал", qr?.includes("/journal-fill/org-one/hygiene") && !tokenOf(qr).includes("b~"), qr);
    await ctx.close();
  }

  // ---------------------------------------------------------------- точек нет
  {
    const { ctx, page } = await session(browser, "none-owner@test.local");
    await page.goto(LIST);
    await page.waitForSelector("[data-poster-points-empty]");
    const add = await page.locator("[data-poster-points-empty] a").getAttribute("href");
    check("AC2 точек нет — подсказка и «Добавить точку»", add === "/settings/buildings", add);
    await page.locator("[data-poster-points-empty]").screenshot({ path: shot("6-no-points.png") });
    await page.goto(`${LIST}/dishes`);
    await page.waitForSelector("[data-print-brand-frame]");
    check("AC1 без точки — строки нет, лист цел", (await page.locator("[data-poster-point]").count()) === 0 && (await page.locator("[data-print-brand-footer]").count()) === 1);
    await ctx.close();
  }

  // ---------------------------------------------------------------- телефон и Mini App (П-3)
  {
    const { ctx, page } = await session(browser, "dk-owner@test.local", { width: 390, height: 844 });
    await page.goto(`${LIST}?point=b-dk-mira`);
    await page.waitForSelector("[data-poster-point-picker]");
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    check("телефон 390 px — без горизонтальной прокрутки", overflow <= 0, `${overflow}px`);
    await page.screenshot({ path: shot("7-phone.png") });
    await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    await page.goto(`${LIST}?point=b-dk-mira`);
    await page.waitForSelector("[data-poster-point-picker]");
    const miniActive = await page.locator('[data-poster-point-option][aria-current="true"]').getAttribute("data-poster-point-option");
    check("П-3 Mini App: тот же выбор точки", miniActive === "b-dk-mira", miniActive);
    await page.screenshot({ path: shot("8-mini.png") });
    await ctx.close();
  }
} finally {
  writeFileSync(fileURLToPath(new URL("e2e-result.json", OUT)), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
}
