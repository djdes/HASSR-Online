/**
 * E2E: «Документы клиенту» в карточке клиента — КП и счёт «от пользователя».
 * Предусловия: node .agent/tasks/client-contract-2026-10-29/raw/seed-local.cjs,
 * dev-сервер на http://localhost:3031 (база wesetup_contract).
 * Запуск: node --import tsx .agent/tasks/kp-invoice-design-2026-10-30/raw/e2e-documents.cjs [orgId]
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
  if (whatsNewVersion) await context.addCookies([{ name: "wesetup-whats-new", value: whatsNewVersion(WHATS_NEW_NOTES), url: BASE }]);
  const page = await context.newPage();
  const results = {};

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await page.waitForSelector("#email");
    await page.fill("#email", "root-contract@test.local");
    await page.fill("#password", "Test-12345");
    await page.waitForTimeout(400);
    if ((await page.inputValue("#email")) === "root-contract@test.local") {
      await page.click("form button[type=submit]");
      try {
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
        break;
      } catch {
        log("login retry", attempt);
      }
    }
  }

  await page.goto(`${BASE}/root/organizations/${ORG}#documents`, { waitUntil: "domcontentloaded", timeout: 300000 });
  const panel = page.getByTestId("client-documents");
  await panel.waitFor({ timeout: 120000 });
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(OUT, `e2e-${ORG}-documents.png`) });

  // ── КП: диалог, склонение, PDF, отправка
  await page.getByTestId("proposal-open").click();
  await page.getByTestId("proposal-dialog").waitFor();
  results.proposalDefaults = {
    addressee: await page.getByTestId("proposal-addressee").inputValue(),
    greeting: await page.getByTestId("proposal-greeting").inputValue(),
  };
  log("kp defaults", results.proposalDefaults);
  await page.getByRole("button", { name: "Премиум", exact: true }).first().click();
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-kp-dialog.png`) });
  const [kpDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("proposal-pdf").click()]);
  const kpPath = path.join(OUT, `e2e-${ORG}-kp.pdf`);
  await kpDownload.saveAs(kpPath);
  const kp = await pdfText(fs.readFileSync(kpPath));
  results.proposalPdf = {
    suggested: kpDownload.suggestedFilename(),
    pages: kp.pages,
    title: kp.text.includes("КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ"),
    premium: kp.text.includes("тариф «Премиум»"),
    sellerInn: kp.text.includes("5018215599"),
    greeting: kp.text.includes(results.proposalDefaults.greeting),
    addressee: kp.text.includes(results.proposalDefaults.addressee),
    signedBy: kp.text.includes("С уважением"),
  };
  log("kp pdf", results.proposalPdf);
  await page.getByTestId("documents-recipient-add").fill("client-kp@example.com");
  await page.keyboard.press("Enter");
  const kpSend = page.waitForResponse((r) => r.url().endsWith("/proposal/send") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Отправить КП", exact: true }).last().click();
  const kpResponse = await kpSend;
  results.proposalSend = { status: kpResponse.status(), body: await kpResponse.json() };
  log("kp send", results.proposalSend);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-kp-after-send.png`) });
  await page.keyboard.press("Escape");

  // ── Счёт: выставить, скачать, отправить
  await page.getByTestId("invoice-open").click();
  await page.getByTestId("invoice-dialog").waitFor();
  await page.screenshot({ path: path.join(OUT, `e2e-${ORG}-invoice-dialog.png`) });
  const issueResponse = page.waitForResponse((r) => /\/invoices$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Выставить счёт", exact: true }).last().click();
  const issued = await issueResponse;
  results.invoiceIssue = { status: issued.status(), body: await issued.json() };
  log("invoice issue", results.invoiceIssue);
  const orderId = results.invoiceIssue.body.orderId;
  await page.getByTestId("invoice-send-dialog").waitFor({ timeout: 30000 });
  const [invDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("invoice-pdf").click()]);
  const invPath = path.join(OUT, `e2e-${ORG}-invoice-${orderId}.pdf`);
  await invDownload.saveAs(invPath);
  const inv = await pdfText(fs.readFileSync(invPath));
  results.invoicePdf = {
    pages: inv.pages,
    number: inv.text.includes(`Счёт на оплату № ${orderId}`),
    sellerInn: inv.text.includes("5018215599"),
    buyerInn: inv.text.includes("7707083893"),
    words: /рублей \d\d копеек, без налога/.test(inv.text),
    contractBasis: /Договор № WS-\d{4}\/\d{4}/.test(inv.text) || inv.text.includes("договора-оферты"),
  };
  log("invoice pdf", results.invoicePdf);
  await page.getByTestId("documents-recipient-add").fill("client-invoice@example.com");
  await page.keyboard.press("Enter");
  const invSend = page.waitForResponse((r) => r.url().endsWith(`/invoices/${orderId}/send`));
  await page.getByRole("button", { name: "Отправить счёт", exact: true }).last().click();
  const invResponse = await invSend;
  results.invoiceSend = { status: invResponse.status(), body: await invResponse.json() };
  log("invoice send", results.invoiceSend);
  await page.keyboard.press("Escape");

  // ── Счёт виден в таблице оплат карточки
  await page.reload({ waitUntil: "domcontentloaded" });
  // Пока страница приходит потоком, React держит скрытую копию блока вне <main> — ждём видимый.
  await page.locator("main [data-testid=client-documents]").first().waitFor({ state: "visible", timeout: 120000 });
  const html = await page.content();
  results.paymentsTable = { hasInvoiceRow: html.includes(`/api/payments/invoice/${orderId}/pdf`) };
  await page.locator("#billing").screenshot({ path: path.join(OUT, `e2e-${ORG}-billing.png`) }).catch(() => undefined);

  fs.writeFileSync(path.join(OUT, `e2e-${ORG}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
