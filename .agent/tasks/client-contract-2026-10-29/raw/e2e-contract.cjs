/**
 * E2E: ROOT открывает организацию, видит карточку договора, выпускает
 * договор, скачивает PDF (ИНН БФС и клиента в тексте), пытается отправить
 * письмо (без SMTP — понятный ответ 503), аннулирует договор.
 *
 * Предусловия: node .agent/tasks/client-contract-2026-10-29/raw/seed-local.cjs
 * и dev-сервер на http://localhost:3031 (база wesetup_contract).
 * Запуск: node .agent/tasks/client-contract-2026-10-29/raw/e2e-contract.cjs [orgId]
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = "http://localhost:3031";
const ORG = process.argv[2] ?? "org-one";
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log("[e2e]", ...args);

async function pdfText(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  pdfjs.GlobalWorkerOptions.workerSrc = "file:///" + path.join(root, "legacy/build/pdf.worker.mjs").split(path.sep).join("/");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: path.join(root, "standard_fonts").split(path.sep).join("/") + "/" }).promise;
  const parts = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) parts.push(item.str);
  }
  return { pages: doc.numPages, text: parts.join(" ").replace(/\s+/g, " ") };
}

(async () => {
  const { whatsNewVersion, WHATS_NEW_NOTES } = await import("../../../../src/lib/whats-new-notes.ts").catch(() => ({}));
  const browser = await chromium.launch({ executablePath: "C:\\Users\\Two\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: "ru-RU" });
  if (whatsNewVersion) {
    await context.addCookies([{ name: "wesetup-whats-new", value: whatsNewVersion(WHATS_NEW_NOTES), url: BASE }]);
  }
  const page = await context.newPage();
  const results = {};

  // ── вход ROOT (поля, заполненные до гидратации, сбрасываются — повторяем)
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await page.waitForSelector("#email");
    await page.fill("#email", "root-contract@test.local");
    await page.fill("#password", "Test-12345");
    await page.waitForTimeout(400);
    if ((await page.inputValue("#email")) === "root-contract@test.local" && (await page.inputValue("#password")) === "Test-12345") {
      await page.click("form button[type=submit]");
      try {
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
        break;
      } catch {
        log("login retry", attempt);
      }
    } else {
      await page.waitForTimeout(800);
    }
  }
  log("logged in, at", page.url());

  // ── карточка на странице организации
  await page.goto(`${BASE}/root/organizations/${ORG}`, { waitUntil: "domcontentloaded", timeout: 300000 });
  const card = page.getByTestId("client-contract-card");
  await card.waitFor({ timeout: 90000 });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-card.png`), fullPage: false, clip: await card.boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 20), width: 1440, height: Math.min(b.height + 40, 1400) })) }).catch(async () => {
    await card.screenshot({ path: path.join(OUT, `e2e-${ORG}-card.png`) });
  });
  results.cardVisible = true;
  const before = await page.getByTestId("contract-row").count();

  // ── черновик PDF: без номера и без записи в базу
  const [draft] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Проект PDF" }).click()]);
  const draftPath = path.join(OUT, `e2e-${ORG}-draft.pdf`);
  await draft.saveAs(draftPath);
  const draftText = await pdfText(fs.readFileSync(draftPath));
  results.draft = { suggested: draft.suggestedFilename(), pages: draftText.pages, marked: draftText.text.includes("ПРОЕКТ"), noNumber: draftText.text.includes("WS-2026/____") };
  results.draft.rowsUnchanged = (await page.getByTestId("contract-row").count()) === before;
  log("draft", results.draft);

  // ── выпуск
  await page.getByTestId("contract-issue").click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="contract-row"]').length > n, before, { timeout: 30000 });
  const firstRow = page.getByTestId("contract-row").first();
  const number = await firstRow.getAttribute("data-contract-number");
  log("issued", number);
  results.issuedNumber = number;
  await card.screenshot({ path: path.join(OUT, `e2e-${ORG}-issued.png`) });

  // ── PDF: скачивание через кнопку
  const [download] = await Promise.all([page.waitForEvent("download"), firstRow.getByTestId("contract-pdf").click()]);
  const pdfPath = path.join(OUT, `e2e-${ORG}-${number.replace(/\W+/g, "-")}.pdf`);
  await download.saveAs(pdfPath);
  const { pages, text } = await pdfText(fs.readFileSync(pdfPath));
  results.pdf = { file: path.basename(pdfPath), suggested: download.suggestedFilename(), pages, hasBfsInn: text.includes("5018215599"), hasNumber: text.includes(number) };
  const orgInn = ORG === "org-one" ? "7707083893" : "500100732259";
  results.pdf.hasClientInn = text.includes(orgInn);
  results.pdf.hasClientName = ORG === "org-one" ? text.includes("Доброе кафе") : text.includes("Индивидуальный предприниматель");
  log("pdf", results.pdf);

  // ── отправка: диалог, свой адрес, ответ без SMTP
  await firstRow.getByTestId("contract-send").click();
  const dialog = page.getByTestId("contract-send-dialog");
  await dialog.waitFor();
  await page.getByTestId("contract-send-add").fill("client-e2e@example.com");
  await page.keyboard.press("Enter");
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-send-dialog.png`) });
  const sendResponse = page.waitForResponse((response) => response.url().includes("/send") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Отправить", exact: true }).last().click();
  const response = await sendResponse;
  const body = await response.json();
  results.send = { status: response.status(), body };
  log("send", results.send);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-after-send.png`) });
  // Диалог остаётся открытым при ошибке — закрываем.
  await page.keyboard.press("Escape");

  // ── аннулирование
  await firstRow.getByRole("button", { name: "Аннулировать" }).click();
  const voidResponse = page.waitForResponse((r) => r.url().includes("/void"));
  await page.getByRole("button", { name: "Аннулировать", exact: true }).last().click();
  results.void = { status: (await voidResponse).status() };
  await page.waitForFunction((num) => {
    const row = document.querySelector(`[data-contract-number="${num}"]`);
    return row && !row.querySelector('[data-testid="contract-send"]');
  }, number, { timeout: 15000 });
  results.void.sendHidden = true;
  await card.screenshot({ path: path.join(OUT, `e2e-${ORG}-voided.png`) });

  // ── API: аннулированный договор не отправляется
  const blocked = await page.evaluate(async ({ org, num }) => {
    const ctx = await (await fetch(`/api/root/organizations/${org}/contracts`)).json();
    const contract = ctx.contracts.find((item) => item.number === num);
    const r = await fetch(`/api/root/organizations/${org}/contracts/${contract.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: ["a@example.com"] }) });
    return { status: r.status, body: await r.json(), contractStatus: contract.status };
  }, { org: ORG, num: number });
  results.voidedSend = blocked;

  fs.writeFileSync(path.join(OUT, `e2e-${ORG}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
