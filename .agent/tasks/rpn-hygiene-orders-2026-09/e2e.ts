/**
 * e2e на своей базе (wesetup_wt_rpn) и dev-сервере :3037.
 *   npx tsx --env-file=.env .agent/tasks/rpn-hygiene-orders-2026-09/e2e-seed.ts
 *   npx tsx --env-file=.env .agent/tasks/rpn-hygiene-orders-2026-09/e2e.ts
 * Итог — raw/e2e-results.json, скриншоты — shots/.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Page } from "playwright-core";

import { db } from "@/lib/db";
import { dispatchExternalEntries } from "@/lib/external/dispatch";
import { resolveJournalShortQr } from "@/lib/journal-pdf-qr-link";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalShortSig } from "@/lib/qr-fill-token";

import { BASE, RAW, SHOTS, check, fixture, launch, login, results } from "./e2e-lib";

const MESSAGE = "Сотрудник ещё не ответил на вопросы о здоровье";
const fx = fixture();
const today = new Date(`${fx.todayKey}T00:00:00.000Z`);
const tomorrowKey = new Date(today.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);

async function entryData(employeeId: string, dateKey = fx.todayKey): Promise<Record<string, unknown> | null> {
  const row = await db.journalDocumentEntry.findUnique({
    where: { documentId_employeeId_date: { documentId: fx.hygieneDoc, employeeId, date: new Date(`${dateKey}T00:00:00.000Z`) } },
    select: { data: true },
  });
  return (row?.data as Record<string, unknown> | null) ?? null;
}

function verificationOf(data: Record<string, unknown> | null): string | null {
  const v = data?.verification as { result?: string } | undefined;
  return v?.result ?? null;
}

async function pdfPages(buffer: Buffer): Promise<number> {
  return (await PDFDocument.load(new Uint8Array(buffer))).getPageCount();
}

async function pageTexts(pdf: Buffer): Promise<string[]> {
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
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

async function scanPdf(label: string, pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`${label} - page ${i + 1}`, { x: 60, y: 760, size: 20, font });
    page.drawRectangle({ x: 60, y: 120, width: 475, height: 600, borderWidth: 1 });
  }
  return Buffer.from(await pdf.save());
}

function scanImage(width: number, height: number, mime: "image/png" | "image/jpeg", title: string): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#0b1024";
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, width - 60, height - 60);
  ctx.fillStyle = "#0b1024";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(title, 70, 120);
  ctx.font = "28px sans-serif";
  for (let i = 0; i < 8; i += 1) ctx.fillText("Order text ......................................", 70, 200 + i * 50);
  return mime === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");
}

async function openKeeper(page: Page): Promise<string> {
  const target = resolveJournalShortQr(fx.orgA, "hygiene", journalShortSig(fx.orgA, "hygiene"));
  await page.goto(`${BASE}${target}`);
  await page.getByText("Заведующая A").first().click();
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="pin"]').fill(fx.pin);
  await Promise.all([page.waitForLoadState("networkidle"), page.locator('input[name="pin"]').press("Enter")]);
  await page.getByRole("link", { name: /Допуск сотрудников/ }).first().click();
  await page.waitForLoadState("networkidle");
  return page.url();
}

async function main() {
  const browser = await launch();
  const ctxA = await login(browser, fx.managerA, fx.password);

  // ================= AC1: «Допущен» только после ответа =================
  const page = await ctxA.newPage();
  const keeperUrl = await openKeeper(page);
  await page.screenshot({ path: path.join(SHOTS, "ac1-keeper-1440.png"), fullPage: true });

  const petrAdmit = page.locator(`input[name="st:${fx.petr}"][value="admitted"]`);
  const petrSuspend = page.locator(`input[name="st:${fx.petr}"][value="suspended"]`);
  const ivanAdmit = page.locator(`input[name="st:${fx.ivan}"][value="admitted"]`);
  check("AC1.ui.disabled", (await petrAdmit.isDisabled()) && !(await petrSuspend.isDisabled()) && !(await ivanAdmit.isDisabled()),
    "без ответа «Допущен» disabled, «Отстранён» доступен; у ответившего «Допущен» доступен");
  const reasonCount = await page.getByText(`Допуск недоступен: ${MESSAGE.toLowerCase()}.`).count();
  check("AC1.ui.reason", reasonCount >= 1, `причина на экране у ${reasonCount} строк`);

  // Обход кнопки: POST формы напрямую с «Допущен» для Петрова (без ответа).
  const action = (await page.locator('form[method="post"]').last().getAttribute("action")) ?? "";
  const forged = await page.request.post(new URL(action, BASE).toString(), {
    form: { action: "health-keeper", [`st:${fx.petr}`]: "admitted" },
    maxRedirects: 0,
  });
  const forgedBody = await forged.text();
  const petrAfterForged = await entryData(fx.petr);
  check("AC1.server.qr", forged.status() === 409 && forgedBody.includes(MESSAGE) && forgedBody.includes("Петров Пётр") && verificationOf(petrAfterForged) === null,
    `POST QR допуска без ответа → ${forged.status()}, допуск в БД: ${verificationOf(petrAfterForged)}`);
  // Пакет «допустить всех»: Иванов (ответил) + Петров (нет) — отклоняется целиком.
  const batch = await page.request.post(new URL(action, BASE).toString(), {
    form: { action: "health-keeper", [`st:${fx.ivan}`]: "admitted", [`st:${fx.petr}`]: "admitted" },
    maxRedirects: 0,
  });
  check("AC1.server.batch", batch.status() === 409 && verificationOf(await entryData(fx.ivan)) === null,
    `массовый допуск с неответившим → ${batch.status()}, Иванов не допущен половинчато`);

  // Кнопкой: Иванов (ответил) — «Допущен», Петров — «Отстранён».
  await page.reload();
  await page.locator(`label:has(input[name="st:${fx.ivan}"][value="admitted"])`).click();
  await page.locator(`label:has(input[name="st:${fx.petr}"][value="suspended"])`).click();
  await Promise.all([page.waitForLoadState("networkidle"), page.getByRole("button", { name: "Подписать допуск" }).click()]);
  const ivanData = await entryData(fx.ivan);
  const petrData = await entryData(fx.petr);
  check("AC1.ui.admit", verificationOf(ivanData) === "admitted" && ivanData?.status === "healthy", `Иванов (ответил) допущен кнопкой: ${verificationOf(ivanData)}`);
  check("AC1.ui.suspend", verificationOf(petrData) === "suspended", `Петров (без ответа) отстранён: ${verificationOf(petrData)}`);
  await page.screenshot({ path: path.join(SHOTS, "ac1-keeper-saved-1440.png"), fullPage: true });

  const mobile = await ctxA.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(keeperUrl);
  await mobile.screenshot({ path: path.join(SHOTS, "ac1-keeper-390.png"), fullPage: true });
  await mobile.close();

  // API сайта: ячейка, пакет, массовая правка.
  const verification = { result: "admitted", byUserId: "x", byName: "Заведующая A", byTitle: null, at: "09:00", method: "session" };
  const put = await ctxA.request.put(`/api/journal-documents/${fx.hygieneDoc}/entries`, {
    data: { employeeId: fx.olga, date: fx.todayKey, data: { status: "healthy", confirmations: { temperature: true }, verification } },
  });
  const putBody = await put.json().catch(() => ({}));
  check("AC1.server.put", put.status() === 409 && putBody.error === MESSAGE, `PUT ячейки «Допущен» без ответа (и с подставленными подписями) → ${put.status()} ${putBody.error ?? ""}`);
  const patch = await ctxA.request.patch(`/api/journal-documents/${fx.hygieneDoc}/entries`, {
    data: { entries: [{ employeeId: fx.olga, date: fx.todayKey, data: { status: "healthy", verification } }] },
  });
  const patchBody = await patch.json().catch(() => ({}));
  check("AC1.server.patch", patch.status() === 409 && patchBody.error === MESSAGE, `PATCH массовой правки → ${patch.status()} ${patchBody.error ?? ""}`);
  const bulk = await ctxA.request.post(`/api/journal-documents/${fx.hygieneDoc}/entries/bulk`, {
    data: { items: [{ employeeId: fx.olga, date: fx.todayKey, data: { verification } }] },
  });
  const bulkBody = await bulk.json().catch(() => ({}));
  check("AC1.server.bulk", bulk.status() === 409 && bulkBody.error === MESSAGE, `POST bulk (штрих) → ${bulk.status()} ${bulkBody.error ?? ""}`);
  const ext = await dispatchExternalEntries({
    organizationId: fx.orgA,
    journalCode: "hygiene",
    entries: [{ employeeId: fx.olga, date: fx.todayKey, data: { status: "healthy", verification } }],
  });
  check("AC1.server.external", !ext.ok && ext.httpStatus === 409 && ext.error === MESSAGE, `внешний API → ${ext.ok ? "ok" : `${ext.httpStatus} ${ext.error}`}`);
  check("AC1.server.nothingWritten", verificationOf(await entryData(fx.olga)) === null, "у Орловой допуска нет ни одним путём");

  const suspendPut = await ctxA.request.put(`/api/journal-documents/${fx.hygieneDoc}/entries`, {
    data: { employeeId: fx.olga, date: fx.todayKey, data: { status: "suspended", verification: { ...verification, result: "suspended" } } },
  });
  check("AC1.server.suspendAlways", suspendPut.status() === 200, `«Отстранён» без ответа через API → ${suspendPut.status()}`);
  const ivanPut = await ctxA.request.put(`/api/journal-documents/${fx.hygieneDoc}/entries`, {
    data: { employeeId: fx.ivan, date: fx.todayKey, data: { ...ivanData, note: "правка" } },
  });
  check("AC1.server.answeredOk", ivanPut.status() === 200, `правка допущенного с ответом → ${ivanPut.status()}`);

  // «Догнать пропуски»: подпись и допуск на другой день не переносятся.
  const catchUp = await ctxA.request.post(`/api/dashboard/catch-up`, { data: { targets: [{ documentId: fx.hygieneDoc, date: tomorrowKey }] } });
  const ivanTomorrow = await entryData(fx.ivan, tomorrowKey);
  check("AC1.server.catchUp", catchUp.status() === 200 && ivanTomorrow === null, `catch-up на ${tomorrowKey}: Иванов не скопирован (допуск) → ${JSON.stringify(ivanTomorrow)}`);
  await db.journalDocumentEntry.deleteMany({ where: { documentId: fx.hygieneDoc, date: new Date(`${tomorrowKey}T00:00:00.000Z`) } });

  // ================= AC2 / AC3: приказы к журналу =================
  const baseHyg = await ctxA.request.get(`/api/journal-documents/${fx.hygieneDoc}/pdf`);
  const baseHygBuf = Buffer.from(await baseHyg.body());
  const baseHygPages = await pdfPages(baseHygBuf);
  const baseFin = await ctxA.request.get(`/api/journal-documents/${fx.finishedDoc}/pdf`);
  const baseFinBuf = Buffer.from(await baseFin.body());
  const baseFinPages = await pdfPages(baseFinBuf);
  writeFileSync(path.join(RAW, "hygiene-before.pdf"), baseHygBuf);

  const files = {
    pdf: path.join(RAW, "prikaz-otvetstvennyi.pdf"),
    jpg: path.join(RAW, "IMG_scan.jpg"),
    png: path.join(RAW, "prikaz-dopusk.png"),
    extra: path.join(RAW, "lishnii.pdf"),
    bjgp: path.join(RAW, "Приказ о бракеражной комиссии.pdf"),
  };
  writeFileSync(files.pdf, await scanPdf("PRIKAZ No 12 (hygiene responsible)", 2));
  writeFileSync(files.jpg, scanImage(1600, 1100, "image/jpeg", "PRIKAZ No 7 (JPG scan, landscape)"));
  writeFileSync(files.png, scanImage(900, 1270, "image/png", "PRIKAZ No 8 (PNG, portrait)"));
  writeFileSync(files.extra, await scanPdf("EXTRA", 1));
  writeFileSync(files.bjgp, await scanPdf("PRIKAZ No 3 (brakerage commission)", 1));

  const doc = await ctxA.newPage();
  const consoleErrors: string[] = [];
  doc.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  doc.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await doc.goto(`/journals/hygiene/documents/${fx.hygieneDoc}`);
  const panel = doc.locator("section[data-order-scans]");
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(SHOTS, "ac2-panel-empty-1440.png") });
  const input = doc.locator("input[data-order-scan-input]");
  for (const [file, expected] of [[files.pdf, 1], [files.jpg, 2], [files.png, 3], [files.extra, 4]] as const) {
    await input.setInputFiles(file);
    await doc.locator("li[data-order-scan]").nth(expected - 1).waitFor({ timeout: 30000 });
  }
  const uploaded = await doc.locator("li[data-order-scan]").count();
  check("AC2.upload.ui", uploaded === 4, `загружено через UI: ${uploaded} файла (PDF, JPG, PNG, PDF)`);

  // Переименование JPG.
  const jpgRow = doc.locator("li[data-order-scan]").nth(1);
  await jpgRow.getByRole("button", { name: /Переименовать/ }).click();
  await jpgRow.locator('input[aria-label="Название приказа"]').fill("Приказ № 7 о назначении ответственного");
  await jpgRow.locator('input[aria-label="Название приказа"]').press("Enter");
  await doc.getByText("Приказ № 7 о назначении ответственного").first().waitFor();
  // Удаление лишнего — через ConfirmDialog.
  const extraRow = doc.locator("li[data-order-scan]").nth(3);
  await extraRow.getByRole("button", { name: /Удалить/ }).click();
  await doc.getByRole("button", { name: "Удалить", exact: true }).last().waitFor();
  await doc.screenshot({ path: path.join(SHOTS, "ac2-delete-confirm-1440.png") });
  await doc.getByRole("button", { name: "Удалить", exact: true }).last().click();
  await doc.waitForFunction(() => document.querySelectorAll("li[data-order-scan]").length === 3);
  const scans = await db.journalOrderScan.findMany({ where: { organizationId: fx.orgA, journalCode: "hygiene" }, orderBy: { createdAt: "asc" } });
  check("AC2.rename.delete", scans.length === 3 && scans[1].title === "Приказ № 7 о назначении ответственного" && !scans.some((s) => s.fileName === "lishnii.pdf"),
    `в БД: ${scans.map((s) => `${s.title} (${s.mimeType})`).join("; ")}`);
  const audits = await db.auditLog.findMany({ where: { organizationId: fx.orgA, entity: "JournalOrderScan" }, select: { action: true } });
  const actions = audits.map((a) => a.action);
  check("AC2.audit", ["journal_order_scan.upload", "journal_order_scan.rename", "journal_order_scan.delete"].every((a) => actions.includes(a)),
    `AuditLog: ${[...new Set(actions)].join(", ")} (${actions.length} записей)`);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(SHOTS, "ac2-panel-hygiene-1440.png") });
  await doc.screenshot({ path: path.join(SHOTS, "ac2-hygiene-page-1440.png"), fullPage: true });

  // Просмотр картинки — лайтбокс.
  await doc.locator("li[data-order-scan]").nth(1).getByRole("button", { name: "Открыть" }).click();
  const lightboxLoaded = await doc
    .waitForFunction(() => [...document.images].some((i) => i.src.includes("/api/journal-order-scans/") && i.complete && i.naturalWidth > 0), null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  await doc.waitForTimeout(400);
  await doc.screenshot({ path: path.join(SHOTS, "ac2-lightbox-1440.png") });
  check("AC2.view.image", lightboxLoaded, "картинка открывается в лайтбоксе (файл загрузился по защищённой ссылке)");
  const pdfView = await ctxA.request.get(`/api/journal-order-scans/${(await doc.locator("li[data-order-scan]").first().getAttribute("data-order-scan")) ?? ""}/file`);
  check("AC2.view.pdf", pdfView.status() === 200 && pdfView.headers()["content-type"] === "application/pdf" && String(pdfView.headers()["content-disposition"]).startsWith("inline"),
    `PDF «Открыть» — inline в новой вкладке: ${pdfView.status()} ${pdfView.headers()["content-type"]} ${pdfView.headers()["content-disposition"]?.slice(0, 20)}`);
  await doc.keyboard.press("Escape");

  const heic = await ctxA.request.post("/api/journal-order-scans", {
    multipart: { code: "hygiene", file: { name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]) } },
  });
  const heicBody = await heic.json().catch(() => ({}));
  check("AC2.heic", heic.status() === 400 && String(heicBody.error).includes("HEIC"), `HEIC → ${heic.status()} ${heicBody.error ?? ""}`);
  const wrong = await ctxA.request.post("/api/journal-order-scans", {
    multipart: { code: "perishable_rejection", file: { name: "a.pdf", mimeType: "application/pdf", buffer: await scanPdf("x", 1) } },
  });
  check("AC2.onlyTwoJournals", wrong.status() === 400, `скоропорт не поддерживает приказы → ${wrong.status()}`);

  const docMobile = await ctxA.newPage();
  await docMobile.setViewportSize({ width: 390, height: 844 });
  await docMobile.goto(`/journals/hygiene/documents/${fx.hygieneDoc}`);
  const panelMobile = docMobile.locator("section[data-order-scans]");
  await panelMobile.scrollIntoViewIfNeeded();
  await panelMobile.screenshot({ path: path.join(SHOTS, "ac2-panel-hygiene-390.png") });
  const overflow = await docMobile.evaluate(() => {
    const el = document.querySelector("section[data-order-scans]") as HTMLElement | null;
    return el ? el.getBoundingClientRect().right <= window.innerWidth + 1 : false;
  });
  check("AC2.mobile", overflow, "блок приказов помещается в 390px");
  await docMobile.close();

  // БЖГП.
  const fin = await ctxA.newPage();
  await fin.goto(`/journals/finished_product/documents/${fx.finishedDoc}`);
  const finPanel = fin.locator("section[data-order-scans]");
  await finPanel.waitFor();
  await fin.locator("input[data-order-scan-input]").setInputFiles(files.bjgp);
  await fin.locator("li[data-order-scan]").first().waitFor({ timeout: 30000 });
  await finPanel.scrollIntoViewIfNeeded();
  await finPanel.screenshot({ path: path.join(SHOTS, "ac2-panel-bjgp-1440.png") });
  await fin.screenshot({ path: path.join(SHOTS, "ac2-bjgp-page-1440.png"), fullPage: true });
  const finTitle = (await fin.locator("li[data-order-scan]").first().innerText()).split("\n")[0];
  check("AC2.bjgp", finTitle.includes("Приказ о бракеражной комиссии"), `БЖГП: «${finTitle}» (название по умолчанию — имя файла)`);
  const finMobile = await ctxA.newPage();
  await finMobile.setViewportSize({ width: 390, height: 844 });
  await finMobile.goto(`/journals/finished_product/documents/${fx.finishedDoc}`);
  await finMobile.locator("section[data-order-scans]").scrollIntoViewIfNeeded();
  await finMobile.locator("section[data-order-scans]").screenshot({ path: path.join(SHOTS, "ac2-panel-bjgp-390.png") });
  await finMobile.close();

  // Сотрудник: только просмотр.
  const ctxCook = await login(browser, fx.cookEmail, fx.password);
  const cookList = await ctxCook.request.get("/api/journal-order-scans?code=hygiene");
  const cookListBody = await cookList.json();
  const cookUpload = await ctxCook.request.post("/api/journal-order-scans", {
    multipart: { code: "hygiene", file: { name: "a.pdf", mimeType: "application/pdf", buffer: await scanPdf("x", 1) } },
  });
  const cookFile = await ctxCook.request.get(`/api/journal-order-scans/${scans[0].id}/file`);
  const cookDelete = await ctxCook.request.delete(`/api/journal-order-scans/${scans[0].id}`);
  const cookPage = await ctxCook.newPage();
  await cookPage.goto(`/journals/hygiene/documents/${fx.hygieneDoc}`);
  const cookPanel = cookPage.locator("section[data-order-scans]");
  await cookPanel.waitFor();
  const cookButtons = await cookPanel.getByRole("button", { name: /Загрузить приказ|Удалить|Переименовать/ }).count();
  await cookPanel.scrollIntoViewIfNeeded();
  await cookPanel.screenshot({ path: path.join(SHOTS, "ac2-panel-cook-1440.png") });
  check("AC2.employee.viewOnly",
    cookList.status() === 200 && cookListBody.canManage === false && cookListBody.scans.length === 3 && cookUpload.status() === 403 && cookDelete.status() === 403 && cookFile.status() === 200 && cookButtons === 0,
    `сотрудник: список ${cookList.status()} (${cookListBody.scans?.length}), файл ${cookFile.status()}, загрузка ${cookUpload.status()}, удаление ${cookDelete.status()}, кнопок управления ${cookButtons}`);

  // Доступ: чужая организация и без сессии.
  const ctxB = await login(browser, fx.managerB, fx.password);
  const bFile = await ctxB.request.get(`/api/journal-order-scans/${scans[0].id}/file`);
  const bRename = await ctxB.request.patch(`/api/journal-order-scans/${scans[0].id}`, { data: { title: "взлом" } });
  const bDelete = await ctxB.request.delete(`/api/journal-order-scans/${scans[0].id}`);
  const bList = await (await ctxB.request.get("/api/journal-order-scans?code=hygiene")).json();
  const anon = await browser.newContext({ baseURL: BASE });
  anon.setDefaultNavigationTimeout(300_000);
  anon.setDefaultTimeout(120_000);
  const anonFile = await anon.request.get(`/api/journal-order-scans/${scans[0].id}/file`);
  const anonList = await anon.request.get("/api/journal-order-scans?code=hygiene");
  const aFile = await ctxA.request.get(`/api/journal-order-scans/${scans[0].id}/file`);
  const inspA = await anon.request.get(`/api/inspector/${fx.inspectorToken}/orders/${scans[0].id}`);
  const inspB = await anon.request.get(`/api/inspector/${fx.inspectorTokenB}/orders/${scans[0].id}`);
  const stillThere = await db.journalOrderScan.count({ where: { id: scans[0].id, title: scans[0].title } });
  check("AC2.access",
    bFile.status() === 404 && bRename.status() === 404 && bDelete.status() === 404 && bList.scans.length === 0 && anonFile.status() === 404 && anonList.status() === 401 &&
      aFile.status() === 200 && aFile.headers()["content-type"] === "application/pdf" && aFile.headers()["cache-control"]?.includes("no-store") &&
      inspA.status() === 200 && inspB.status() === 404 && stillThere === 1,
    `чужая орг: файл ${bFile.status()}, переименование ${bRename.status()}, удаление ${bDelete.status()}, список ${bList.scans.length}; без сессии: файл ${anonFile.status()}, список ${anonList.status()}; своя: ${aFile.status()} ${aFile.headers()["content-type"]}; проверяющий своей орг ${inspA.status()}, чужой ${inspB.status()}`);

  // Проверяющий: список приказов и листы после журнала.
  const insp = await anon.newPage();
  await insp.setViewportSize({ width: 1440, height: 900 });
  await insp.goto(`/inspector/${fx.inspectorToken}/hygiene`);
  await insp.locator("[data-order-scans]").waitFor();
  const inspScans = await insp.locator("[data-order-scan-open]").count();
  await insp.screenshot({ path: path.join(SHOTS, "ac2-inspector-1440.png"), fullPage: false });
  await insp.locator("[data-order-scans]").scrollIntoViewIfNeeded();
  const sheetCaptions = await insp.getByText(/Лист \d+ из \d+/).allInnerTexts();
  await insp.setViewportSize({ width: 390, height: 844 });
  await insp.reload();
  await insp.locator("[data-order-scans]").scrollIntoViewIfNeeded();
  await insp.screenshot({ path: path.join(SHOTS, "ac2-inspector-390.png") });
  const lastSheet = insp.locator("img").last();
  await lastSheet.scrollIntoViewIfNeeded();
  await insp.waitForFunction(() => { const imgs = [...document.images]; const last = imgs[imgs.length - 1]; return !!last && last.complete && last.naturalWidth > 0; }, null, { timeout: 120000 }).catch(() => null);
  await insp.waitForTimeout(500);
  await insp.screenshot({ path: path.join(SHOTS, "ac3-inspector-last-sheet-390.png") });

  // ================= AC3: печать =================
  const afterHyg = Buffer.from(await (await ctxA.request.get(`/api/journal-documents/${fx.hygieneDoc}/pdf`)).body());
  const afterFin = Buffer.from(await (await ctxA.request.get(`/api/journal-documents/${fx.finishedDoc}/pdf`)).body());
  writeFileSync(path.join(RAW, "hygiene-with-orders.pdf"), afterHyg);
  writeFileSync(path.join(RAW, "bjgp-with-orders.pdf"), afterFin);
  const hygPages = await pdfPages(afterHyg);
  const finPages = await pdfPages(afterFin);
  const hygTexts = await pageTexts(afterHyg);
  const finTexts = await pageTexts(afterFin);
  const qrMark = "Электронный журнал WeSetup";
  const hygJournalQr = hygTexts.slice(0, baseHygPages).every((t) => t.includes(qrMark));
  const hygScansNoQr = hygTexts.slice(baseHygPages).every((t) => !t.includes(qrMark));
  const finScansNoQr = finTexts.slice(baseFinPages).every((t) => !t.includes(qrMark));
  check("AC3.hygiene.pages", hygPages === baseHygPages + 4 && /PRIKAZ No 12/.test(hygTexts[baseHygPages] ?? ""),
    `гигиена: ${baseHygPages} стр. журнала → ${hygPages} (PDF-скан 2 стр. + JPG + PNG), первая после журнала: «${(hygTexts[baseHygPages] ?? "").slice(0, 40)}»`);
  check("AC3.bjgp.pages", finPages === baseFinPages + 1 && /PRIKAZ No 3/.test(finTexts[baseFinPages] ?? ""), `БЖГП: ${baseFinPages} → ${finPages}`);
  check("AC3.noQrOnScans", hygJournalQr && hygScansNoQr && finScansNoQr, `QR «${qrMark}» на страницах журнала: ${hygJournalQr}; на страницах приказов нет: ${hygScansNoQr && finScansNoQr}`);
  const pdfDoc = await PDFDocument.load(new Uint8Array(afterHyg));
  const sizes = pdfDoc.getPages().slice(baseHygPages).map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
  check("AC3.imagesA4", sizes[2] === "842x595" && sizes[3] === "595x842", `размеры страниц приказов: ${sizes.join(", ")} (альбомный JPG, книжный PNG)`);
  check("AC2.inspector", inspScans === 3 && sheetCaptions.length === hygPages && sheetCaptions.every((c) => c.endsWith(`из ${hygPages}`)),
    `проверяющий: приказов в списке ${inspScans}, листов ${sheetCaptions.length} (журнал ${baseHygPages} + приказы ${hygPages - baseHygPages})`);

  // Без приказов — печать как раньше (у чужой организации / после удаления).
  await db.journalOrderScan.deleteMany({ where: { organizationId: fx.orgA, journalCode: "finished_product" } });
  const finAgain = Buffer.from(await (await ctxA.request.get(`/api/journal-documents/${fx.finishedDoc}/pdf`)).body());
  check("AC3.noScansUnchanged", (await pdfPages(finAgain)) === baseFinPages, `БЖГП без приказов: ${await pdfPages(finAgain)} стр. (как до загрузки: ${baseFinPages})`);

  check("AC2.console", consoleErrors.length === 0, consoleErrors.length ? `ошибки консоли: ${consoleErrors.join(" | ")}` : "на странице документа нет ошибок консоли");
  await browser.close();
  writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), results, error: String(error) }, null, 2));
  process.exit(1);
});
