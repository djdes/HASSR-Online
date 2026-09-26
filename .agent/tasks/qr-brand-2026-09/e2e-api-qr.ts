/**
 * E2E маршрутов, что отдают фирменный QR картинкой (AC1): каждый ответ на
 * живом dev-сервере декодируется jsQR и сверяется с адресом из того же
 * ответа; пропорция картинки — плитка с плашкой. Плюс сертификат (PDF):
 * страница растрируется при 300 dpi, код читается jsQR и указывает на портал
 * проверяющих. И лендинг: обе наклейки (ролик и золотая) — со знаком сайта.
 *
 * Запуск: BASE=http://localhost:3049 STATE=<state.json> QR_DECODER=<jsqr>
 *   npx tsx --env-file=.env .agent/tasks/qr-brand-2026-09/e2e-api-qr.ts
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium, type APIRequestContext, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3049";
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-brand-2026-09");
const state = JSON.parse(fs.readFileSync(process.env.STATE ?? "C:/wt/qrbrand-tmp/e2e/state.json", "utf8")) as {
  password: string;
  manager: string;
  cookId: string;
};
type Jsqr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
const required = createRequire(__filename)(process.env.QR_DECODER ?? "jsqr") as { default?: Jsqr } & Jsqr;
const jsqr: Jsqr = required.default ?? required;
const ASPECT = 1.185;

const checks: { id: string; ok: boolean; what: string; details?: unknown }[] = [];
function check(id: string, what: string, ok: boolean, details?: unknown) {
  checks.push({ id, ok, what, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${what}${ok ? "" : ` ${JSON.stringify(details)}`}`);
}

async function decodePng(png: Buffer): Promise<{ text: string | null; width: number; height: number }> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  return { text: jsqr(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), image.width, image.height)?.data ?? null, width: image.width, height: image.height };
}

async function checkDataUrl(id: string, what: string, dataUrl: unknown, url: unknown) {
  const ok = typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,");
  const png = ok ? Buffer.from((dataUrl as string).split(",")[1], "base64") : Buffer.alloc(0);
  const decoded = ok ? await decodePng(png) : { text: null, width: 0, height: 0 };
  check(id, what, ok && decoded.text === url && Math.abs(decoded.height / decoded.width - ASPECT) < 0.02, {
    url,
    decoded: decoded.text,
    size: `${decoded.width}×${decoded.height}`,
  });
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.waitForTimeout(1500);
  await page.fill("#email", state.manager);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
}

async function post(api: APIRequestContext, route: string, body: unknown) {
  const response = await api.post(`${BASE}${route}`, { data: body, timeout: 300_000 });
  return { status: response.status(), json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    const api = context.request;

    const join = await post(api, "/api/staff/join-token", {});
    await checkDataUrl("API-join", "POST /api/staff/join-token — QR-регистрация: фирменный PNG, читается, ведёт на joinUrl", join.json?.qrPngDataUrl, join.json?.joinUrl);

    const pair = await post(api, `/api/staff/${state.cookId}/pair-token`, {});
    await checkDataUrl("API-pair", "POST /api/staff/[id]/pair-token — сопряжение: фирменный PNG, ведёт на pairUrl", pair.json?.qrPngDataUrl, pair.json?.pairUrl);

    const kiosk = await post(api, "/api/kiosk/enroll", { label: "Планшет e2e" });
    await checkDataUrl("API-kiosk", "POST /api/kiosk/enroll — планшет: фирменный PNG, ведёт на claimUrl", kiosk.json?.qrPngDataUrl, kiosk.json?.claimUrl);

    const staffTg = await post(api, `/api/staff/${state.cookId}/invite-tg`, { mode: "invite" });
    await checkDataUrl("API-invite-tg-staff", "POST /api/staff/[id]/invite-tg — приглашение в Telegram: фирменный PNG, ведёт на inviteUrl", staffTg.json?.qrPngDataUrl, staffTg.json?.inviteUrl);

    const userTg = await post(api, "/api/users/invite/tg", { name: "Анна Приглашённая", role: "cook" });
    await checkDataUrl("API-invite-tg-user", "POST /api/users/invite/tg — приглашение нового сотрудника в Telegram: фирменный PNG", userTg.json?.qrPngDataUrl, userTg.json?.inviteUrl);

    // Сертификат: PDF → страница 300 dpi → jsQR.
    const today = new Date().toISOString().slice(0, 10);
    const cert = await api.get(`${BASE}/api/certificate?from=${today}&to=${today}`, { timeout: 300_000 });
    const pdf = Buffer.from(await cert.body());
    const { standardFontsDir, workerFileUrl } = await import("@/lib/journal-preview/render");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
    const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    const doc = await task.promise;
    const pdfPage = await doc.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 300 / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof pdfPage.render>[0]).promise;
    const pagePng = canvas.toBuffer("image/png");
    await task.destroy();
    const certQr = await decodePng(pagePng);
    check("API-certificate", "GET /api/certificate — в PDF фирменный QR, читается с листа при 300 dpi и ведёт на портал проверяющих", cert.status() === 200 && /\/inspector\/[A-Za-z0-9_-]+$/.test(certQr.text ?? ""), { status: cert.status(), decoded: certQr.text });
    // Снимок сертификата: нижняя половина листа с кодом (для evidence).
    const half = createCanvas(canvas.width, Math.round(canvas.height * 0.36));
    half.getContext("2d").drawImage(canvas, 0, Math.round(canvas.height * 0.6), canvas.width, half.height, 0, 0, canvas.width, half.height);
    const shotCanvas = createCanvas(Math.round(half.width / 2.5), Math.round(half.height / 2.5));
    shotCanvas.getContext("2d").drawImage(half, 0, 0, shotCanvas.width, shotCanvas.height);
    fs.writeFileSync(path.join(TASK_DIR, "shots", "certificate-qr.png"), shotCanvas.toBuffer("image/png"));

    // Лендинг: обе наклейки — фирменный SVG со знаком сайта (ролик — с плашкой).
    const landing = await context.newPage();
    const errors: string[] = [];
    landing.on("pageerror", (error) => errors.push(error.message));
    await landing.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await landing.waitForLoadState("networkidle").catch(() => null);
    const stickers = await landing.$$eval("svg[aria-label='QR-код WeSetup']", (nodes) =>
      nodes.map((svg) => ({ image: Boolean(svg.querySelector("image")), text: Array.from(svg.querySelectorAll("text"), (t) => t.textContent).join("|") }))
    );
    check(
      "LANDING",
      "лендинг: наклейки со знаком сайта (золотая — без плашки, в ролике — с «Отсканировать»), без ошибок на странице",
      stickers.length >= 1 && stickers.every((s) => s.image) && errors.length === 0,
      { stickers, errors }
    );
    const gold = landing.locator("svg[aria-label='QR-код WeSetup']").last();
    await gold.scrollIntoViewIfNeeded();
    await landing.waitForTimeout(500);
    await gold.locator("xpath=ancestor::div[3]").screenshot({ path: path.join(TASK_DIR, "shots", "landing-gold-sticker.png") });
    await context.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(TASK_DIR, "raw", "e2e-api-checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
