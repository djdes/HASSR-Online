// Проверка этапа 1 (ролик на главной): node .agent/tasks/landing-video-2026-10/raw/verify-stage1.mjs
// Dev-сервер worktree на BASE (локальная база), Playwright + chromium 1234.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("D:/wt/landing-video/package.json");
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3031";
const OUT = "D:/wt/landing-video/.agent/tasks/landing-video-2026-10/raw";
const SHOTS = path.join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${detail}` : ""}`);
};
const IGNORED = [/status of 401/, /Failed to load resource.*(metrika|yandex)/i, /mc\.yandex/];

function executable() {
  const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const dir = readdirSync(base).find((name) => /^chromium-\d+$/.test(name));
  const exe = path.join(base, dir, "chrome-win64", "chrome.exe");
  return existsSync(exe) ? exe : undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: executable(), args: ["--lang=ru-RU"] });

async function open({ width, height, reduced = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: width < 700,
    isMobile: width < 700,
    reducedMotion: reduced ? "reduce" : "no-preference",
    locale: "ru-RU",
  });
  const page = await context.newPage();
  const errors = [];
  // «Failed to load resource» без адреса — ловим ответы с адресом; локально без
  // ключей reCAPTCHA /api/auth/registration-challenge отвечает 503, /api/live — 401.
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text()) && !IGNORED.some((re) => re.test(message.text()))) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !/\/api\/auth\/registration-challenge|\/api\/live|mc\.yandex/.test(response.url())) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 240000 });
  await page.waitForSelector("[data-qr-player]", { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { context, page, errors };
}

const attr = (page, name) => page.locator("[data-qr-player]").getAttribute(name);
const frameOf = async (page) => Number(await attr(page, "data-frame"));
const playingOf = (page) => attr(page, "data-playing");

async function scrollToQr(page) {
  await page.locator("[data-qr-stage]").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector("[data-qr-stage]")?.scrollIntoView({ block: "center" }));
}

for (const [label, viewport] of [["390x800", { width: 390, height: 800 }], ["1440x900", { width: 1440, height: 900 }]]) {
  const { context, page, errors } = await open(viewport);
  const tag = (name) => `${label}: ${name}`;

  // Вне экрана — стоит.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const qrTop = await page.evaluate(() => document.querySelector("[data-qr-stage]").getBoundingClientRect().top);
  const startFrame = await frameOf(page);
  await page.waitForTimeout(1000);
  if (qrTop > viewport.height * 0.8) {
    check(tag("вне экрана ролик стоит"), (await playingOf(page)) === "0" && (await frameOf(page)) === startFrame, `top=${Math.round(qrTop)}, frame ${startFrame}`);
  } else {
    check(tag("вне экрана ролик стоит"), true, `секция видна сразу (top=${Math.round(qrTop)}) — проверка ниже, после ухода вниз`);
  }

  // Нижнего управления нет.
  const qr = page.locator("#qr");
  check(tag("нет полосы перемотки под роликом"), (await qr.locator('input[aria-label="Перемотка"]').count()) === 0);
  const timeText = await qr.evaluate((node) => /\d:\d\d \/ \d:\d\d/.test(node.innerText));
  check(tag("нет времени «0:12 / 0:48»"), !timeText);
  check(tag("«Попробуйте сами» на месте"), (await qr.getByRole("button", { name: "Попробуйте сами" }).count()) === 1);
  check(tag("две кнопки в углу сцены"), (await page.locator("[data-qr-corner] button").count()) === 2);

  // Прокрутили — пошёл.
  await scrollToQr(page);
  // Плеер монтируется после гидрации: ждём старта до 10 с.
  await page.waitForFunction(() => document.querySelector("[data-qr-player]")?.getAttribute("data-playing") === "1", null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const f1 = await frameOf(page);
  await page.waitForTimeout(1200);
  const f2 = await frameOf(page);
  check(tag("стартует при прокрутке"), (await playingOf(page)) === "1" && f2 > f1, `frame ${f1} → ${f2}`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-section.jpg`) });

  // Темп: через 6,5 с от начала первая глава ещё идёт (раньше было 6 с на главу).
  await page.locator('[data-qr-player] nav button').first().click();
  await page.waitForTimeout(6500);
  const tabNow = await page.locator('[data-qr-player] nav button[aria-current="step"]').innerText();
  const frameAfter = await frameOf(page);
  check(tag("глава длится дольше 6 с (темп 8 с)"), /^1/.test(tabNow.trim()) && frameAfter < 240, `через 6,5 с: вкладка «${tabNow.replace(/\s+/g, " ").trim()}», кадр ${frameAfter}`);

  // Ушли вниз — встал.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(900);
  const off1 = await frameOf(page);
  await page.waitForTimeout(800);
  check(tag("вне экрана — пауза"), (await playingOf(page)) === "0" && (await frameOf(page)) === off1, `frame ${off1}`);

  // Кнопка паузы в углу — пауза, плеер не открывается.
  await scrollToQr(page);
  await page.waitForTimeout(1200);
  await page.locator("[data-qr-stage]").hover();
  await page.locator("[data-qr-corner] button").first().click();
  await page.waitForTimeout(500);
  check(tag("пауза в углу останавливает и не открывает плеер"), (await playingOf(page)) === "0" && (await page.locator("[data-qr-fullscreen]").count()) === 0);
  await page.locator("[data-qr-corner] button").first().click();
  await page.waitForTimeout(400);
  check(tag("кнопка в углу снова запускает"), (await playingOf(page)) === "1");

  // Нажатие на сцену — плеер на весь экран.
  const box = await page.locator("[data-qr-stage]").boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.waitForSelector("[data-qr-fullscreen]", { timeout: 5000 });
  await page.waitForTimeout(1500);
  const overlay = await page.evaluate(() => {
    const node = document.querySelector("[data-qr-fullscreen]");
    const rect = node.getBoundingClientRect();
    const stage = document.querySelector("[data-qr-fullscreen-stage]").getBoundingClientRect();
    return {
      position: getComputedStyle(node).position,
      width: rect.width,
      height: rect.height,
      stageW: Math.round(stage.width),
      stageH: Math.round(stage.height),
      overflow: document.documentElement.style.overflow,
      inertMain: Array.from(document.body.children).filter((child) => child !== node && child.hasAttribute("inert")).length,
      fullscreenElement: Boolean(document.fullscreenElement),
      rotateHint: /Поверните телефон/.test(node.innerText),
      segments: node.querySelectorAll('[role="group"] button').length,
    };
  });
  check(
    tag("плеер на весь экран: fixed, весь вьюпорт, страница не крутится"),
    overlay.position === "fixed" && Math.abs(overlay.width - viewport.width) <= 1 && Math.abs(overlay.height - viewport.height) <= 1 && overlay.overflow === "hidden" && overlay.inertMain > 0,
    JSON.stringify(overlay),
  );
  check(tag("кадр 16:9 на компьютере, 4:5 и подсказка «поверните» на телефоне"), viewport.width >= 768 ? Math.abs(overlay.stageW / overlay.stageH - 16 / 9) < 0.02 : Math.abs(overlay.stageW / overlay.stageH - 0.8) < 0.02 && overlay.rotateHint, `${overlay.stageW}×${overlay.stageH}`);
  check(tag("перемотка по главам — 6 сегментов"), overlay.segments === 6);
  check(tag("на странице ролик стоит, пока открыт плеер"), (await playingOf(page)) === "0");
  const fsFrame1 = await page.evaluate(() => document.querySelector("[data-qr-fullscreen]").innerText);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: path.join(SHOTS, `${label}-fullscreen.jpg`) });
  // Управление прячется, пока ролик идёт.
  await page.waitForTimeout(2900);
  const opacityOf = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-qr-fullscreen] [role="group"]').parentElement.parentElement).opacity);
  const hidden = await opacityOf();
  const fsStage = await page.locator("[data-qr-fullscreen-stage]").boundingBox();
  const center = { x: fsStage.x + fsStage.width / 2, y: fsStage.y + fsStage.height / 2 };
  const isPlaying = () => page.evaluate(() => Boolean(document.querySelector('[data-qr-fullscreen] button[aria-label="Пауза"]')));
  if (viewport.width < 768) {
    await page.touchscreen.tap(center.x, center.y);
    await page.waitForTimeout(450);
    const shown = await opacityOf();
    check(tag("касание по сцене со спрятанным управлением только показывает его"), hidden === "0" && shown === "1" && (await isPlaying()), `opacity ${hidden} → ${shown}`);
  } else {
    check(tag("управление прячется, пока ролик идёт"), hidden === "0", `opacity ${hidden}`);
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(300);
    const paused = !(await isPlaying());
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(300);
    check(tag("щелчок по кадру — пауза и снова пуск"), paused && (await isPlaying()));
  }
  // Третья глава — по сегменту.
  await page.mouse.move(fsStage.x + 20, fsStage.y + 20);
  await page.locator('[data-qr-fullscreen] [role="group"] button').nth(2).click();
  await page.waitForTimeout(400);
  const chip = await page.locator("[data-qr-fullscreen]").innerText();
  check(tag("сегмент перематывает на главу"), /УФ-лампа/.test(chip), chip.split("\n").slice(0, 2).join(" | "));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  check(tag("Esc закрывает плеер"), (await page.locator("[data-qr-fullscreen]").count()) === 0 && (await page.evaluate(() => document.documentElement.style.overflow)) !== "hidden");
  const resumed = await frameOf(page);
  check(tag("после закрытия ролик продолжает с того же места"), resumed >= 480, `кадр ${resumed} (глава 3 начинается с 480)`);
  check(tag("фокус вернулся на сцену"), await page.evaluate(() => document.activeElement?.hasAttribute("data-qr-stage")));

  // «Развернуть» в углу и крестик.
  await page.locator("[data-qr-stage]").hover();
  await page.locator("[data-qr-corner] button").nth(1).click();
  await page.waitForSelector("[data-qr-fullscreen]", { timeout: 5000 });
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.waitForTimeout(500);
  check(tag("«Развернуть» открывает, крестик закрывает"), (await page.locator("[data-qr-fullscreen]").count()) === 0);

  // Enter на сцене.
  await page.locator("[data-qr-stage]").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  check(tag("Enter на сцене открывает плеер"), (await page.locator("[data-qr-fullscreen]").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  check(tag("нет ошибок в консоли"), errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

// reduced-motion: раскадровка без автозапуска.
for (const [label, viewport] of [["390x800", { width: 390, height: 800 }], ["1440x900", { width: 1440, height: 900 }]]) {
  const { context, page, errors } = await open({ ...viewport, reduced: true });
  await scrollToQr(page);
  await page.waitForTimeout(1500);
  const frame = await frameOf(page);
  await page.waitForTimeout(800);
  const caption = await page.locator("#qr").innerText();
  check(`${label} reduced-motion: раскадровка, без автозапуска`, (await playingOf(page)) === "0" && frame === (await frameOf(page)) && frame === 224 && /Раскадровка 1\/6/.test(caption), `кадр ${frame}`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-reduced.jpg`) });
  check(`${label} reduced-motion: нет ошибок`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

await browser.close();
writeFileSync(path.join(OUT, "verify-stage1.json"), `${JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2)}\n`);
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
