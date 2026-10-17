// Проверка этапа 2 (видео с голосом): node .agent/tasks/landing-video-2026-10/raw/verify-stage2.mjs
// Dev-сервер worktree на BASE (локальная база). Браузер — Google Chrome: в
// Chromium от Playwright нет H.264/AAC, а проверяем и воспроизведение.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("D:/wt/landing-video/package.json");
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3047";
const ROOT = "D:/wt/landing-video";
const OUT = path.join(ROOT, ".agent/tasks/landing-video-2026-10/raw");
const SHOTS = path.join(OUT, "shots");
const MP4 = path.join(ROOT, "public/landing/video/qr-tour-ru.mp4");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${detail}` : ""}`);
};
const IGNORED = [/status of 401/, /Failed to load resource/, /mc\.yandex/];
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ headless: true, executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--lang=ru-RU"] });

async function open(url, { width, height }) {
  const mobile = width < 700;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, locale: "ru-RU" });
  const page = await context.newPage();
  const errors = [];
  const videoRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !IGNORED.some((re) => re.test(message.text()))) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    if (/\/landing\/video\/qr-tour-ru\.(mp4|jpg|vtt)/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForSelector("[data-qr-player]", { timeout: 90000 });
  await page.waitForTimeout(1500);
  return { context, page, errors, videoRequests };
}

const playing = (page) => page.locator("[data-qr-player]").getAttribute("data-playing");

// ---------------------------------------------------------------- компьютер
{
  const { context, page, errors, videoRequests } = await open("/", { width: 1440, height: 900 });
  const tag = (name) => `1440x900: ${name}`;
  const button = page.locator("[data-qr-video-button]");
  check(tag("кнопка «Смотреть видео со звуком» видна"), (await button.count()) === 1 && (await button.isVisible()), (await button.textContent())?.trim());
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(1800);
  check(tag("до нажатия видео, постер и субтитры не грузятся"), videoRequests.length === 0, videoRequests.join(", ") || "0 запросов");
  check(tag("немой ролик идёт, пока окно закрыто"), (await playing(page)) === "1");
  await page.screenshot({ path: path.join(SHOTS, "stage2-1440x900-button.jpg"), quality: 80 });

  await button.click();
  const dialog = page.locator('[data-qr-video-dialog="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const video = dialog.locator("video");
  const props = await video.evaluate((node) => ({
    controls: node.controls,
    playsInline: node.playsInline,
    preload: node.getAttribute("preload"),
    poster: node.getAttribute("poster"),
    src: node.getAttribute("src"),
    track: node.querySelector("track")?.getAttribute("src") ?? null,
  }));
  check(tag("окно: <video controls playsInline poster preload=none>"), props.controls && props.playsInline && props.preload === "none" && /qr-tour-ru\.jpg$/.test(props.poster ?? "") && /qr-tour-ru\.mp4$/.test(props.src ?? ""), JSON.stringify(props));
  check(tag("дорожка субтитров qr-tour-ru.vtt"), /qr-tour-ru\.vtt$/.test(props.track ?? ""), props.track);
  const box = await dialog.locator("video").boundingBox();
  check(tag("видео 16:9 в окне"), box && Math.abs(box.width / box.height - 16 / 9) < 0.02, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "нет");
  // Dev-сервер отдаёт 14 МБ не мгновенно: ждём, пока видео пойдёт (до 30 с).
  const startedAt = Date.now();
  await page.waitForFunction(() => (document.querySelector('[data-qr-video-dialog="dialog"] video')?.currentTime ?? 0) > 1, null, { timeout: 30000 }).catch(() => undefined);
  const waited = ((Date.now() - startedAt) / 1000).toFixed(1);
  const media = await video.evaluate((node) => ({ time: node.currentTime, paused: node.paused, duration: node.duration, error: node.error?.code ?? null, w: node.videoWidth, h: node.videoHeight }));
  check(tag("видео пошло со звуком после нажатия"), media.time > 1 && !media.paused && media.error === null, `${JSON.stringify(media)}, ждали ${waited} с`);
  check(tag("файл 1920×1080, ~89 с"), media.w === 1920 && media.h === 1080 && media.duration > 85 && media.duration < 92, `${media.w}×${media.h}, ${media.duration?.toFixed?.(2)} с`);
  check(tag("видео загрузилось только после нажатия"), videoRequests.some((url) => url.endsWith(".mp4")), `${videoRequests.length} запросов`);
  check(tag("немой ролик на странице стоит под окном"), (await playing(page)) === "0");
  check(tag("страница не прокручивается под окном"), (await page.evaluate(() => document.documentElement.style.overflow)) === "hidden");
  await page.screenshot({ path: path.join(SHOTS, "stage2-1440x900-dialog.jpg"), quality: 80 });

  // Клавиши в окне — для видео, а не для немого ролика (события портала).
  await video.focus();
  await page.keyboard.press(" ");
  await page.waitForTimeout(500);
  const pausedBySpace = await video.evaluate((node) => node.paused);
  check(tag("Пробел в окне не запускает немой ролик"), (await playing(page)) === "0", `видео на паузе: ${pausedBySpace}`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check(tag("Esc закрывает окно"), (await dialog.count()) === 0);
  check(tag("фокус вернулся на кнопку"), await page.evaluate(() => document.activeElement?.hasAttribute("data-qr-video-button")));
  await page.waitForTimeout(800);
  check(tag("немой ролик продолжил"), (await playing(page)) === "1");

  await button.click();
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await page.waitForTimeout(400);
  check(tag("крестик закрывает окно"), (await dialog.count()) === 0);

  await button.click();
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await page.mouse.click(20, 450);
  await page.waitForTimeout(400);
  check(tag("щелчок мимо окна закрывает"), (await dialog.count()) === 0);

  // Тот же случай у плеера на весь экран этапа 1: Пробел — только для него.
  await page.locator("[data-qr-stage]").scrollIntoViewIfNeeded();
  await page.locator("[data-qr-stage]").click();
  await page.locator("[data-qr-fullscreen]").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(900);
  await page.keyboard.press(" ");
  await page.waitForTimeout(600);
  check(tag("плеер на весь экран: Пробел не запускает ролик на странице"), (await playing(page)) === "0");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  check(tag("плеер на весь экран закрылся по Esc"), (await page.locator("[data-qr-fullscreen]").count()) === 0);
  check(tag("нет ошибок в консоли"), errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------- телефон
{
  const { context, page, errors, videoRequests } = await open("/", { width: 390, height: 800 });
  const tag = (name) => `390x800: ${name}`;
  const button = page.locator("[data-qr-video-button]");
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100));
  await page.waitForTimeout(800);
  const rect = await button.boundingBox();
  check(tag("кнопка видна целиком, без переполнения"), rect && rect.x >= 0 && rect.x + rect.width <= 390, rect ? `${Math.round(rect.width)}px` : "нет");
  check(tag("грубый указатель"), await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches));
  check(tag("до нажатия видео не грузится"), videoRequests.length === 0, `${videoRequests.length} запросов`);
  await page.screenshot({ path: path.join(SHOTS, "stage2-390x800-button.jpg"), quality: 80 });
  await button.tap();
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    fullscreen: document.fullscreenElement?.tagName ?? null,
    native: Boolean(document.querySelector('[data-qr-video-dialog="native"]')),
    dialog: Boolean(document.querySelector('[data-qr-video-dialog="dialog"]')),
  }));
  check(tag("нажатие сразу открывает нативный полный экран видео"), state.native && !state.dialog && state.fullscreen === "VIDEO", JSON.stringify(state));
  await page.waitForTimeout(1500);
  const media = await page.evaluate(() => {
    const node = document.querySelector('[data-qr-video-dialog="native"] video');
    return node ? { time: node.currentTime, paused: node.paused, playsInline: node.playsInline } : null;
  });
  check(tag("видео идёт; без playsInline (iPhone уходит в свой плеер)"), media && media.time > 0.5 && !media.paused && media.playsInline === false, JSON.stringify(media));
  await page.screenshot({ path: path.join(SHOTS, "stage2-390x800-fullscreen.jpg"), quality: 80 });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(700);
  check(tag("выход из полного экрана закрывает слой"), (await page.locator("[data-qr-video-dialog]").count()) === 0);
  check(tag("нет ошибок в консоли"), errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

// ---------------------------------------------------------------- EN и без файла
{
  const { context, page } = await open("/en", { width: 1440, height: 900 });
  check("EN-главная: кнопки видео нет", (await page.locator("[data-qr-video-button]").count()) === 0);
  await context.close();
}
{
  const hidden = `${MP4}.verify-off`;
  renameSync(MP4, hidden);
  try {
    const { context, page } = await open("/", { width: 1440, height: 900 });
    check("RU без MP4: кнопки видео нет", (await page.locator("[data-qr-video-button]").count()) === 0);
    await context.close();
  } finally {
    renameSync(hidden, MP4);
  }
  check("MP4 возвращён на место", existsSync(MP4));
}

await browser.close();
const passed = results.filter((item) => item.ok).length;
writeFileSync(path.join(OUT, "verify-stage2.json"), JSON.stringify({ base: BASE, browser: "Google Chrome (H.264/AAC)", passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
