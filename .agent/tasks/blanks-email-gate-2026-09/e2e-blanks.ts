/**
 * E2E шаблонов после email на своей базе (dev-сервер :3043).
 *
 * Запуск (из корня репо, сервер уже поднят с NEXTAUTH_URL=http://localhost:3043):
 *   node --env-file=.env --import tsx .agent/tasks/blanks-email-gate-2026-09/e2e-blanks.ts
 * DEV_LOG=<путь к логу dev-сервера> — оттуда берётся письмо (SMTP в копии пуст).
 *
 * Скриншоты — в evidence/ (390 и 1440), протокол — raw/e2e.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { openBlankQrToken } from "@/lib/blank-qr-token";
import { db } from "@/lib/db";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

const BASE = process.env.BASE ?? "http://localhost:3043";
const TASK = path.join(process.cwd(), ".agent", "tasks", "blanks-email-gate-2026-09");
const EVIDENCE = path.join(TASK, "evidence");
const RAW = path.join(TASK, "raw");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "blank-e2e-"));
const CHROME =
  process.env.CHROME ?? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const DEV_LOG = process.env.DEV_LOG ?? "";
const RUN = Date.now().toString(36);
const NEW_EMAIL = `blank.e2e.${RUN}@example.com`;

const report: Record<string, unknown> = { base: BASE, newEmail: NEW_EMAIL, startedAt: new Date().toISOString() };
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function context(browser: Browser, width: 390 | 1440): Promise<BrowserContext> {
  return width === 390
    ? browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true })
    : browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, name) });
}

/** Растр первой страницы PDF → PNG (для декодера OpenCV). */
async function pdfPagePng(pdf: Buffer, file: string, dpi = 250): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
    fs.writeFileSync(file, canvas.toBuffer("image/png"));
    return file;
  } finally {
    await task.destroy();
  }
}

/** Независимое чтение QR (python cv2). */
function decodeQr(png: string): string | null {
  // QR — в правой нижней четверти листа; мелкий модуль (0,3 мм) детектор
  // берёт уверенно после увеличения. Несколько попыток — первая удачная.
  const script = [
    "import cv2, sys",
    "img = cv2.imread(sys.argv[1])",
    "h, w = img.shape[:2]",
    "crop = img[h//2:, w//2:]",
    "tries = [(cv2.QRCodeDetector(), cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)),",
    "         (cv2.QRCodeDetector(), cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)),",
    "         (cv2.QRCodeDetectorAruco(), cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)),",
    "         (cv2.QRCodeDetector(), img)]",
    "text = ''",
    "for det, im in tries:",
    "    text, pts, _ = det.detectAndDecode(im)",
    "    if text: break",
    "print(text or '')",
  ].join("\n");
  const run = spawnSync(process.env.PYTHON ?? "python", ["-c", script, png], { encoding: "utf8" });
  const text = run.stdout.trim();
  return text || null;
}

function devLogTail(fromBytes: number): string {
  if (!DEV_LOG || !fs.existsSync(DEV_LOG)) return "";
  const buffer = fs.readFileSync(DEV_LOG);
  return buffer.subarray(fromBytes).toString("utf8");
}
function devLogSize(): number {
  return DEV_LOG && fs.existsSync(DEV_LOG) ? fs.statSync(DEV_LOG).size : 0;
}

/** Поле уже «живое» (React навесил обработчики) — иначе клик отправит форму браузером. */
async function waitHydrated(page: Page, selector: string) {
  // Опрос вручную: страница входа в dev может один раз перезагрузиться
  // (сверка версии сборки), а waitForFunction на перезагрузке зависает.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        return Boolean(el && Object.keys(el).some((key) => key.startsWith("__reactProps")));
      }, selector)
      .catch(() => false);
    if (ready) {
      await page.waitForTimeout(500);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`не дождались гидрации ${selector}`);
}

async function waitDialog(page: Page) {
  await page.getByTestId("blank-download-dialog").waitFor({ state: "visible", timeout: 60_000 });
  // Окно въезжает анимацией (на телефоне — шторка снизу, 300 мс).
  await page.waitForTimeout(500);
}

async function fillAndSubmit(page: Page, email: string) {
  const dialog = page.getByTestId("blank-download-dialog");
  await dialog.locator("#blank-download-email").fill(email);
  // Проверка домена (DNS) — кнопка активна, когда адрес принят.
  await page.waitForFunction(
    () => !(document.querySelector('[data-testid="blank-download-submit"]') as HTMLButtonElement | null)?.disabled,
    null,
    { timeout: 30_000 },
  );
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const logStart = devLogSize();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    // ── 1. Страница журнала, 1440: окно email → согласие → файл ──────────
    const desk = await context(browser, 1440);
    const page = await desk.newPage();
    await page.goto(`${BASE}/journals-info/hygiene`, { waitUntil: "networkidle", timeout: 180_000 });
    await page.getByTestId("blank-download-pdf").click();
    await waitDialog(page);
    check("AC1 клик «PDF» открывает окно «Куда прислать шаблон?»", await page.getByText("Куда прислать шаблон?").isVisible());
    await fillAndSubmit(page, NEW_EMAIL);
    await page.getByTestId("blank-download-submit").click();
    const consentError = await page.getByText("Отметьте согласие — без него шаблон не отправить").isVisible();
    check("AC1 без галки согласия файл не скачивается", consentError);
    await page.getByTestId("blank-download-consent").check();
    await page.waitForTimeout(300);
    await shot(page, "01-journal-modal-1440.png");
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.getByTestId("blank-download-submit").click(),
    ]);
    const pdfFile = path.join(TMP, "hygiene.pdf");
    await pdfDownload.saveAs(pdfFile);
    const pdfUrl = new URL(pdfDownload.url());
    check("AC1 файл скачан по подписанной ссылке (?t=)", pdfUrl.pathname === "/api/journal-samples/hygiene/pdf" && Boolean(pdfUrl.searchParams.get("t")), pdfUrl.pathname);
    check("файл — PDF", fs.readFileSync(pdfFile).subarray(0, 5).toString() === "%PDF-", pdfDownload.suggestedFilename());
    await page.getByText("Шаблон скачивается").waitFor({ timeout: 30_000 });
    await shot(page, "02-journal-done-1440.png");

    // ── 2. Второй шаблон — без повторного ввода почты ──────────────────
    await page.keyboard.press("Escape");
    const posts: Array<{ email?: string; remembered?: boolean }> = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/public/blank-download") && request.method() === "POST") {
        try {
          posts.push(JSON.parse(request.postData() ?? "{}"));
        } catch {
          /* ignore */
        }
      }
    });
    const docxDownloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByTestId("blank-download-docx").click();
    // Плашка «копия — на …» появляется сразу и сама прячется через 8 с.
    await page.getByTestId("blank-download-notice").waitFor({ timeout: 30_000 });
    await page.getByText("скачивается.").waitFor({ timeout: 60_000 });
    const dialogShown = await page.getByTestId("blank-download-dialog").isVisible().catch(() => false);
    await shot(page, "03-remembered-notice-1440.png");
    const docxDownload = await docxDownloadPromise;
    const docxFile = path.join(TMP, "word-hygiene.docx");
    await docxDownload.saveAs(docxFile);
    check("AC1 второй шаблон (Word) — без окна, та же почта на сервере", !dialogShown && posts[0]?.email === NEW_EMAIL && posts[0]?.remembered === true, posts[0]);
    check("Word скачан по подписанной ссылке", new URL(docxDownload.url()).searchParams.has("t") && fs.readFileSync(docxFile).subarray(0, 2).toString() === "PK");

    // ── 3. Встроенный просмотр публичный, файл без токена — нет ─────────
    const inline = await desk.request.get(`${BASE}/api/journal-samples/hygiene/pdf?inline=1`);
    check("AC1 встроенный просмотр без почты: 200 inline, кеш public", inline.status() === 200 && /^inline/.test(inline.headers()["content-disposition"] ?? "") && (inline.headers()["cache-control"] ?? "").startsWith("public"), {
      status: inline.status(),
      disposition: inline.headers()["content-disposition"],
      cache: inline.headers()["cache-control"],
    });
    const bare = await desk.request.get(`${BASE}/api/journal-samples/hygiene/pdf`, { maxRedirects: 0 });
    check("AC1 прямой URL без токена (не браузер) → 403", bare.status() === 403, { status: bare.status(), body: await bare.json() });
    const bareBrowser = await desk.request.get(`${BASE}/api/journal-samples/hygiene/docx`, {
      maxRedirects: 0,
      headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
    });
    check("AC1 прямой URL без токена (браузер) → редирект на страницу журнала", bareBrowser.status() === 307 && bareBrowser.headers()["location"] === "/journals-info/hygiene?download=docx", {
      status: bareBrowser.status(),
      location: bareBrowser.headers()["location"],
    });
    const realToken = pdfUrl.searchParams.get("t") ?? "";
    const forgedToken = realToken.slice(0, -1) + (realToken.endsWith("A") ? "B" : "A");
    const forged = await desk.request.get(`${BASE}${pdfUrl.pathname}?t=${encodeURIComponent(forgedToken)}`, { maxRedirects: 0 });
    check("AC1 подделанный токен → 403", forged.status() === 403, forged.status());
    await desk.close();

    // ── 4. Старая ссылка на файл в браузере (390) → страница с окном ──────
    const mobile = await context(browser, 390);
    const mpage = await mobile.newPage();
    await mpage.goto(`${BASE}/api/journal-samples/cleaning/pdf`, { waitUntil: "networkidle", timeout: 180_000 });
    await waitDialog(mpage);
    const landed = new URL(mpage.url());
    check("AC1 браузер со старой ссылкой → /journals-info/cleaning, окно открыто, параметр убран", landed.pathname === "/journals-info/cleaning" && !landed.searchParams.has("download"), mpage.url());
    await shot(mpage, "04-redirect-modal-390.png");
    await mobile.close();

    // ── 5. /blanki (390): кнопка PDF → окно ────────────────────────────
    const blankiCtx = await context(browser, 390);
    const bpage = await blankiCtx.newPage();
    await bpage.goto(`${BASE}/blanki`, { waitUntil: "networkidle", timeout: 180_000 });
    await bpage.getByTestId("blank-download-pdf").first().click();
    await waitDialog(bpage);
    check("AC1 /blanki: скачивание — через окно email", await bpage.getByText("Куда прислать шаблон?").isVisible());
    await shot(bpage, "05-blanki-modal-390.png");
    // Бумажный бланк по старой ссылке → /blanki с окном для него.
    await bpage.goto(`${BASE}/api/journal-samples/paper/ot_intro/pdf`, { waitUntil: "networkidle", timeout: 180_000 });
    await waitDialog(bpage);
    check("AC1 бумажный бланк без токена → /blanki с окном этого бланка", new URL(bpage.url()).pathname === "/blanki" && (await bpage.getByText("Журнал вводного инструктажа").first().isVisible()));
    await blankiCtx.close();

    // ── 6. Главная (1440): галерея образцов → окно ─────────────────────
    const landingCtx = await context(browser, 1440);
    const lpage = await landingCtx.newPage();
    await lpage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
    const galleryPdf = lpage.getByRole("link", { name: "Скачать PDF" }).first();
    await galleryPdf.scrollIntoViewIfNeeded({ timeout: 120_000 });
    await galleryPdf.click();
    await waitDialog(lpage);
    check("AC1 главная (галерея образцов): скачивание — через окно email", await lpage.getByText("Куда прислать шаблон?").isVisible());
    await landingCtx.close();
    // SEO-лендинг «журнал здоровья» — та же кнопка.
    const seoCtx = await context(browser, 390);
    const spage = await seoCtx.newPage();
    await spage.goto(`${BASE}/zhurnal-zdorovya`, { waitUntil: "networkidle", timeout: 180_000 });
    await spage.getByTestId("blank-download-pdf").click();
    await waitDialog(spage);
    check("AC1 SEO-лендинг /zhurnal-zdorovya: скачивание — через окно email", await spage.getByText("Куда прислать шаблон?").isVisible());
    await seoCtx.close();

    // ── 7. QR из скачанного PDF и Word ─────────────────────────────────
    const pdfPng = await pdfPagePng(fs.readFileSync(pdfFile), path.join(TMP, "hygiene-p1.png"));
    const qbUrl = decodeQr(pdfPng);
    const qbToken = qbUrl?.split("/qb/")[1] ?? "";
    const opened = qbToken ? openBlankQrToken(qbToken) : null;
    check("AC3 QR скачанного PDF (OpenCV) → /qb/<токен> с почтой и журналом", Boolean(qbUrl?.startsWith(`${BASE}/qb/`)) && opened?.email === NEW_EMAIL && opened?.target?.kind === "code", {
      qbUrl,
      email: opened?.email,
      target: opened?.target,
    });
    const soffice = process.env.SOFFICE ?? "C:/Program Files/LibreOffice/program/soffice.exe";
    // Отдельный профиль LibreOffice — не трогаем профиль пользователя.
    const profile = `file:///${path.join(TMP, "lo-profile").split(path.sep).join("/")}`;
    const conv = spawnSync(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", TMP, docxFile], {
      encoding: "utf8",
      timeout: 180_000,
    });
    const converted = path.join(TMP, "word-hygiene.pdf");
    let docxQr: string | null = null;
    if (conv.status === 0 && fs.existsSync(converted)) {
      const png = await pdfPagePng(fs.readFileSync(converted), path.join(TMP, "docx-p1.png"), 200);
      docxQr = decodeQr(png);
      // Подвал Word — маленький кадр для отчёта.
      const { loadImage } = await import("@napi-rs/canvas");
      const img = await loadImage(png);
      const w = Math.round(img.width * 0.8);
      const h = Math.round(img.height * 0.2);
      const canvas = createCanvas(w, h);
      canvas.getContext("2d").drawImage(img, img.width - w, img.height - h, w, h, 0, 0, w, h);
      fs.writeFileSync(path.join(EVIDENCE, "docx-footer-hygiene.png"), canvas.toBuffer("image/png"));
    }
    const docxOpened = docxQr ? openBlankQrToken(docxQr.split("/qb/")[1] ?? "") : null;
    check("AC3 Word: QR в подвале (LibreOffice → OpenCV) → /qb с той же почтой", docxOpened?.email === NEW_EMAIL, { docxQr, email: docxOpened?.email, soffice: conv.status });

    // ── 8. /qb: новая почта → заглушка → регистрация с подставленной почтой ─
    const qbNewCtx = await context(browser, 390);
    const qpage = await qbNewCtx.newPage();
    await qpage.goto(qbUrl ?? `${BASE}/qb/x`, { waitUntil: "networkidle", timeout: 180_000 });
    const qbTitleNew = await qpage.getByTestId("qb-title").innerText();
    check("AC4 /qb с новой почтой: заглушка «Заполняйте этот журнал с телефона»", qbTitleNew.includes("Заполняйте этот журнал"), qbTitleNew);
    await shot(qpage, "06-qb-new-390.png");
    await qpage.getByTestId("qb-primary").click();
    await qpage.waitForURL(/\/register\?/, { timeout: 120_000 });
    const registerUrl = new URL(qpage.url());
    await qpage.locator("#register-email").waitFor({ timeout: 60_000 });
    const prefilled = await qpage.locator("#register-email").inputValue();
    check("AC4 регистрация: почта подставлена, source=blank, журнал", prefilled === NEW_EMAIL && registerUrl.searchParams.get("source") === "blank" && registerUrl.searchParams.get("journal") === "hygiene", {
      prefilled,
      query: registerUrl.search,
      pill: await qpage.getByTestId("register-blank-journal").innerText().catch(() => null),
    });
    await shot(qpage, "07-register-prefilled-390.png");
    const beforeRegister = devLogSize();
    await qpage.getByTestId("legal-consent").check();
    await qpage.getByRole("button", { name: /Создать аккаунт/ }).click();
    await qpage.waitForURL(/\/journals\/hygiene/, { timeout: 180_000 });
    await qpage.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined);
    check("AC4 после регистрации открылся журнал /journals/hygiene", new URL(qpage.url()).pathname === "/journals/hygiene", qpage.url());
    await shot(qpage, "08-journal-after-register-390.png");
    await qbNewCtx.close();

    // Пароль нового аккаунта — из письма (dev-лог, SMTP пуст).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const regLog = devLogTail(beforeRegister);
    const password = new RegExp(`Логин: ${NEW_EMAIL.replace(/\./g, "\\.")} Пароль: (\\S+)`).exec(regLog)?.[1] ?? null;
    check("пароль нового аккаунта найден в письме (dev-лог)", Boolean(password));

    // ── 9. /qb: почта уже зарегистрирована → «Войдите» → журнал ─────────
    const qbOldCtx = await context(browser, 1440);
    const opage = await qbOldCtx.newPage();
    await opage.goto(qbUrl ?? `${BASE}/qb/x`, { waitUntil: "networkidle", timeout: 180_000 });
    const qbTitleOld = await opage.getByTestId("qb-title").innerText();
    check("AC4 /qb с почтой существующего пользователя: «Войдите — и этот журнал откроется для заполнения»", qbTitleOld === "Войдите — и этот журнал откроется для заполнения", qbTitleOld);
    await shot(opage, "09-qb-existing-1440.png");
    await opage.getByTestId("qb-primary").click();
    await opage.waitForURL(/\/login\?/, { timeout: 120_000 });
    const loginUrl = new URL(opage.url());
    check("AC4 вход: почта подставлена, возврат на журнал", loginUrl.searchParams.get("email") === NEW_EMAIL && loginUrl.searchParams.get("next") === "/journals/hygiene", loginUrl.search);
    if (password) {
      await waitHydrated(opage, "#password");
      await opage.locator("#password").fill(password);
      await opage.getByRole("button", { name: "Войти", exact: true }).click();
      await opage.waitForURL(/\/journals\/hygiene/, { timeout: 180_000 });
      await opage.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => undefined);
      check("AC4 после входа открылся журнал /journals/hygiene", new URL(opage.url()).pathname === "/journals/hygiene", opage.url());
      await shot(opage, "10-journal-after-login-1440.png");
      await opage.goto(qbUrl ?? `${BASE}/qb/x`, { waitUntil: "networkidle", timeout: 120_000 });
      const sessionTitle = await opage.getByTestId("qb-title").innerText();
      check("/qb, уже вошли: «Открыть журнал»", (await opage.getByTestId("qb-primary").innerText()).includes("Открыть журнал"), sessionTitle);
    }
    await qbOldCtx.close();

    // ── 10. Битый токен → заглушка без почты ───────────────────────────
    const brokenCtx = await context(browser, 390);
    const xpage = await brokenCtx.newPage();
    await xpage.goto(`${BASE}/qb/${qbToken.slice(0, -6)}AAAAAA`, { waitUntil: "networkidle", timeout: 120_000 });
    const brokenTitle = await xpage.getByTestId("qb-title").innerText();
    const brokenHref = await xpage.getByTestId("qb-primary").getAttribute("href");
    check("AC4 битый токен → заглушка без почты и журнала", brokenTitle.includes("с телефона") && brokenHref === "/register?source=blank" && !(await xpage.getByTestId("qb-journal").count()), {
      brokenTitle,
      brokenHref,
    });
    await shot(xpage, "11-qb-broken-390.png");
    await brokenCtx.close();

    // ── 11. /root — список скачиваний ──────────────────────────────────
    const rootEmail = process.env.ROOT_EMAIL;
    const rootPassword = process.env.ROOT_PASSWORD;
    if (rootEmail && rootPassword) {
      for (const width of [1440, 390] as const) {
        const rootCtx = await context(browser, width);
        const rpage = await rootCtx.newPage();
        // Вход ROOT — тем же запросом, что делает форма входа (/api/auth/login):
        // форму входа через UI уже прошёл сценарий /qb выше, а страница входа
        // в dev перезагружается при сверке версии сборки и роняет ввод.
        const login = await rootCtx.request.post(`${BASE}/api/auth/login`, {
          data: { email: rootEmail, password: rootPassword },
          // Свой адрес для лимита входов (5 попыток за 5 минут на адрес).
          headers: { "x-forwarded-for": `192.0.2.${width === 1440 ? 14 : 39}` },
        });
        check(`ROOT вошёл (${width})`, login.ok(), login.status());
        await rpage.goto(`${BASE}/root/blank-downloads`, { waitUntil: "networkidle", timeout: 180_000 });
        const table = await rpage.getByTestId(width === 1440 ? "blank-downloads-table" : "blank-downloads-list").innerText();
        check(`/root/blank-downloads (${width}): почта, журнал, формат, дата`, table.includes(NEW_EMAIL) && table.includes("Гигиенический журнал") && table.includes("Word") && table.includes("PDF"));
        await shot(rpage, `${width === 1440 ? "12" : "13"}-root-downloads-${width}.png`);
        await rootCtx.close();
      }
    } else {
      check("/root: ROOT_EMAIL/ROOT_PASSWORD не заданы — пропуск", false);
    }
  } finally {
    await browser.close();
  }

  // ── 12. Лимиты API: 30/час с адреса, 50/сутки на почту ──────────────
  type PostResult = { status: number; retryAfter: string | null; body: { error?: string } };
  const post = (ip: string, email: string): Promise<PostResult> =>
    fetch(`${BASE}/api/public/blank-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, code: "cleaning", format: "pdf", consent: true }),
    }).then(async (res) => ({ status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as { error?: string } }));
  const ipLimitIp = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const ipStatuses: number[] = [];
  let ipBlocked: PostResult | null = null;
  for (let i = 0; i < 31; i += 1) {
    const res = await post(ipLimitIp, `limit.ip.${RUN}.${i}@example.com`);
    ipStatuses.push(res.status);
    if (i === 30) ipBlocked = res;
  }
  check("AC2 лимит по адресу: 30 скачиваний в час, 31-е — 429", ipStatuses.slice(0, 30).every((s) => s === 200) && ipStatuses[30] === 429, {
    ok: ipStatuses.filter((s) => s === 200).length,
    last: ipBlocked,
  });
  const emailLimit = `limit.email.${RUN}@example.com`;
  const emailStatuses: number[] = [];
  let emailBlocked: PostResult | null = null;
  const ipBase = Math.floor(Math.random() * 200);
  for (let i = 0; i < 51; i += 1) {
    const res = await post(`198.51.${ipBase}.${i + 1}`, emailLimit);
    emailStatuses.push(res.status);
    if (i === 50) emailBlocked = res;
  }
  check("AC2 лимит по почте: 50 скачиваний в сутки, 51-е — 429", emailStatuses.slice(0, 50).every((s) => s === 200) && emailStatuses[50] === 429, {
    ok: emailStatuses.filter((s) => s === 200).length,
    last: emailBlocked,
  });
  report.rateLimits = {
    ipLimitIp,
    ipStatuses,
    emailLimit,
    emailStatuses,
    consentsForLimitEmail: await db.legalConsent.count({ where: { email: emailLimit, source: "blank-download" } }),
  };
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // ── 13. База: согласие и детали скачивания ──────────────────────────
  const consents = await db.legalConsent.findMany({
    where: { email: NEW_EMAIL },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, source: true, version: true, statementText: true, ipAddress: true, userAgent: true, userId: true, createdAt: true },
  });
  const details = await db.auditLog.findMany({
    where: { action: "blank.download", entityId: { in: consents.map((c) => c.id) } },
    select: { entityId: true, organizationId: true, details: true },
  });
  report.consents = consents;
  report.auditDetails = details;
  const blankRows = consents.filter((c) => c.source === "blank-download");
  check("AC2 LegalConsent: 2 записи source=blank-download (PDF и Word), дословный текст, UA", blankRows.length === 2 && blankRows.every((c) => c.statementText === "Даю согласие на обработку персональных данных и ознакомлен с политикой конфиденциальности" && Boolean(c.userAgent)), blankRows.map((c) => c.source));
  check("AC2 детали скачиваний (журнал, формат) — в AuditLog платформы", details.length === 2 && details.every((d) => d.organizationId === (process.env.PLATFORM_ORG_ID || "platform")), details.map((d) => d.details));
  const log = devLogTail(logStart);
  const lines = log.split(/\r?\n/);
  // Письма этого прогона на почту нового пользователя (subject/body идут следующими строками).
  const letters: string[] = [];
  lines.forEach((line, index) => {
    if (line.includes(`письмо не отправлено на ${NEW_EMAIL}`)) letters.push(line, lines[index + 1] ?? "", lines[index + 2] ?? "");
  });
  const limitLetters = lines.filter((line) => line.includes(`письмо не отправлено на limit.email.${RUN}@example.com`)).length;
  check("AC2 писем на одну почту — не больше 10 в сутки (51 скачивание → 10 писем)", limitLetters === 10, { limitLetters });
  report.emailLog = letters.map((line) => line.replace(/Пароль: \S+/, "Пароль: ***").slice(0, 1200));
  check("AC2 письмо со ссылками сформировано (dev-лог)", letters.some((line) => line.includes("Subject: Шаблон «Гигиенический журнал (сотрудники)» — WeSetup")) && letters.some((line) => line.includes("/api/journal-samples/hygiene/pdf?t=")));

  report.checks = checks;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(RAW, "e2e.json"), JSON.stringify(report, null, 2));
  fs.rmSync(TMP, { recursive: true, force: true });
  await db.$disconnect();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  report.checks = checks;
  // Без секретов в протоколе: query-строки из текста ошибки убираем.
  report.error = String(error?.stack ?? error).replace(/\?[^\s"]*password=[^\s"]*/g, "?<скрыто>");
  fs.writeFileSync(path.join(RAW, "e2e.json"), JSON.stringify(report, null, 2));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
});
