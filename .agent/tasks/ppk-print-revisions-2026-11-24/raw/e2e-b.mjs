// Проверка варианта «б» на локальном стенде (next start + Postgres, демо-организация):
// редакции «ППК NNN» с повторным вопросом, документы текстом, подпись пальцем (3.7),
// печатная ППК по структуре со сканами, колонтитулом и сквозной нумерацией; права.
// Запуск: EMP=<id сотрудника с PIN 2468> node e2e-b.mjs <каталог снимков>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const { PDFDocument } = require(path.resolve("node_modules/pdf-lib"));

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out-b";
const EMP = process.env.EMP;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const json = async (r) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  await page.fill("#email", email);
  await page.fill("#password", "admin1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}

async function pdfWithPages(count) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([595, 842]).drawRectangle({ x: 60, y: 60, width: 300, height: 200 });
  return Buffer.from(await doc.save());
}

function pdfText(buffer, name) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, buffer);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())?.[1] ?? 0);
  const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
  return { pages, text };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await login(page, "admin@haccp.local");
const api = context.request;

// ---------- Редакции: текст пункта 1.9 ----------
await page.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle" });
const docKey = await page.locator("[data-revision]").first().getAttribute("data-revision");
check("1.9: плашка редакции на странице пункта", Boolean(docKey), String(docKey));
await page.fill('[data-ppk-text="text-terms"] textarea', "ХАССП — система управления безопасностью пищевой продукции.");
await page.click('[data-ppk-text="text-terms"] button:has-text("Сохранить")');
await page.waitForSelector('[data-revision-status="none"]', { timeout: 30000 });
check("1.9: после сохранения — «Редакция не утверждена»", true);
await page.click("[data-revision-approve]");
const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
await dialog.waitFor({ timeout: 15000 });
const firstAsk = await dialog.innerText();
check("вопрос показывает будущий номер", /ППК 001/.test(firstAsk), firstAsk.replace(/\s+/g, " ").slice(0, 140));
await dialog.locator("button", { hasText: "Утвердить — ППК 001" }).click();
await page.waitForSelector('[data-revision-status="approved"]', { timeout: 30000 });
const chip1 = await page.locator('[data-revision-status="approved"]').innerText();
check("1.9: утверждена ППК 001", /ППК 001/.test(chip1), chip1);
await page.screenshot({ path: path.join(OUT, "01-revision-approved.png") });

let r = await api.post(`${BASE}/api/production-control/revisions`, { data: { docKey } });
let body = await json(r);
check("повтор без изменений — та же редакция", r.status() === 200 && body?.created === false && body?.revision?.code === "ППК 001", JSON.stringify(body));

// Пробелы и переносы — не слова: редакция не меняется.
await page.fill('[data-ppk-text="text-terms"] textarea', "ХАССП —   система управления\nбезопасностью пищевой продукции.  ");
await page.click('[data-ppk-text="text-terms"] button:has-text("Сохранить")');
await page.waitForTimeout(2500);
check("пробелы и переносы не меняют редакцию", (await page.locator('[data-revision-status="approved"]').count()) === 1);

// Одно слово — программа сама спрашивает про новую редакцию.
await page.fill('[data-ppk-text="text-terms"] textarea', "ХАССП — система управления безопасностью пищевых продуктов.");
await page.click('[data-ppk-text="text-terms"] button:has-text("Сохранить")');
const reask = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Документ изменён" });
await reask.waitFor({ timeout: 30000 });
const reaskText = await reask.innerText();
check("изменено слово → вопрос «Документ изменён» с новым номером", /ППК 001/.test(reaskText) && /ППК 002/.test(reaskText), reaskText.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: path.join(OUT, "02-revision-reask.png") });
await reask.locator("button", { hasText: "ППК 002" }).click();
await page.waitForSelector('[data-revision-status="approved"]', { timeout: 30000 });
check("новая редакция ППК 002", /ППК 002/.test(await page.locator('[data-revision-status="approved"]').innerText()));

// ---------- Инструкция текстом (приложение № 6) ----------
r = await api.post(`${BASE}/api/production-control/text-docs`, { data: { source: "knowledge", title: "Личная гигиена", text: "Мыть руки перед работой.\nНосить спецодежду." } });
body = await json(r);
const instrId = body?.id;
check("инструкция текстом создана", r.status() === 201 && Boolean(instrId), String(r.status()));
await page.goto(`${BASE}/production-control/item/app-6`, { waitUntil: "networkidle" });
const row = page.locator(`[data-ppk-doc="${instrId}"]`);
await row.waitFor({ timeout: 30000 });
await row.locator("[data-revision-approve]").click();
const askInstr = page.locator('[role="alertdialog"], [role="dialog"]').last();
await askInstr.waitFor();
await askInstr.locator("button", { hasText: "ППК 003" }).click();
await row.locator('[data-revision-status="approved"]').waitFor({ timeout: 30000 });
check("«Личная гигиена» — ППК 003", /ППК 003/.test(await row.innerText()));
// Правка текста в окне → вопрос → ППК 004.
await row.locator('button[aria-label^="Изменить"]').click();
const editor = page.locator("[data-text-doc-dialog]");
await editor.waitFor();
await editor.locator("[data-text-doc-text]").waitFor();
await page.waitForFunction(() => (document.querySelector("[data-text-doc-text]")?.value ?? "").length > 0, null, { timeout: 15000 });
await editor.locator("[data-text-doc-text]").fill("Мыть руки перед работой и после перерыва.\nНосить спецодежду.");
await editor.locator("[data-text-doc-save]").click();
const askInstr2 = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Документ изменён" });
await askInstr2.waitFor({ timeout: 30000 });
check("правка инструкции → вопрос о новой редакции ППК 004", /ППК 004/.test(await askInstr2.innerText()));
await askInstr2.locator("button", { hasText: "ППК 004" }).click();
await row.locator('[data-revision-status="approved"]').waitFor({ timeout: 30000 });
await page.screenshot({ path: path.join(OUT, "03-instructions-app6.png") });
check("строка списка: «утвердил …» рядом с номером", /утвердил/.test(await row.innerText()));
await page.goto(`${BASE}/acknowledge/${encodeURIComponent(`knowledge:${instrId}`)}`, { waitUntil: "networkidle" });
const ackRevision = await page.locator("[data-ack-revision]").innerText().catch(() => "");
check("страница ознакомления инструкции: номер редакции ППК 004", /ППК 004/.test(ackRevision), ackRevision);
check("страница ознакомления инструкции: текст на странице", /после перерыва/.test(await page.locator("[data-ack-text]").innerText().catch(() => "")));

// Реестр редакций.
r = await api.get(`${BASE}/api/production-control/revisions`);
body = await json(r);
const codes = (body?.register ?? []).map((row) => `${row.code}:${row.supersededBy ?? "-"}`);
check("реестр: 4 редакции, прежние заменены новыми", codes.join(",") === "ППК 004:-,ППК 003:ППК 004,ППК 002:-,ППК 001:ППК 002", codes.join(","));
await page.goto(`${BASE}/production-control/revisions`, { waitUntil: "networkidle" });
check("страница реестра: 4 строки", (await page.locator("[data-revision-row]").count()) === 4);
await page.screenshot({ path: path.join(OUT, "04-register.png"), fullPage: true });

// ---------- Файл: утвердить, заменить → «изменён» ----------
const scanPdf = await pdfWithPages(1);
r = await api.post(`${BASE}/api/knowledge-documents`, { multipart: { file: { name: "mojka.pdf", mimeType: "application/pdf", buffer: scanPdf }, title: "Мойка инвентаря" } });
const fileDoc = (await json(r))?.id;
check("инструкция файлом загружена", r.status() === 201 && Boolean(fileDoc), String(r.status()));
r = await api.post(`${BASE}/api/production-control/revisions`, { data: { docKey: `knowledge:${fileDoc}` } });
check("файл утверждён — ППК 005", (await json(r))?.revision?.code === "ППК 005");
r = await api.patch(`${BASE}/api/production-control/text-docs/${fileDoc}`, { data: { text: "x" } });
check("текст у файла не правится → 400", r.status() === 400, String(r.status()));
r = await api.put(`${BASE}/api/production-control/text-docs/${fileDoc}`, { multipart: { file: { name: "mojka2.pdf", mimeType: "application/pdf", buffer: await pdfWithPages(2) } } });
check("файл заменён", r.status() === 200, String(r.status()));
r = await api.get(`${BASE}/api/production-control/revisions?docKeys=${encodeURIComponent(`knowledge:${fileDoc}`)}`);
check("после замены файла — «изменён после утверждения»", (await json(r))?.states?.[`knowledge:${fileDoc}`]?.status === "changed");
r = await api.post(`${BASE}/api/production-control/text-docs`, { data: { source: "knowledge", title: "", text: "x" } });
check("документ без названия → 400", r.status() === 400, String(r.status()));
r = await api.post(`${BASE}/api/production-control/revisions`, { data: { docKey: "knowledge:nope_missing" } });
check("чужой/несуществующий документ → 404", r.status() === 404, String(r.status()));

// ---------- Процедура текстом (приложение № 5) ----------
r = await api.post(`${BASE}/api/production-control/text-docs`, { data: { source: "procedures", title: "Приёмка продукции", text: "Проверить температуру и документы." } });
check("процедура текстом создана", r.status() === 201, String(r.status()));
r = await api.get(`${BASE}/api/production-control/files?folder=procedures`);
check("процедура в папке «Процедуры»", ((await json(r))?.files ?? []).some((f) => f.title === "Приёмка продукции"));

// ---------- /knowledge: номер редакции и «Создать текстом» ----------
await page.goto(`${BASE}/knowledge`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-revision-status="approved"]', { timeout: 30000 });
check("/knowledge: у инструкции номер редакции", /ППК 004/.test(await page.locator("body").innerText()));
check("/knowledge: кнопка «Создать текстом»", (await page.locator("[data-knowledge-create-text]").count()) === 1);
await page.screenshot({ path: path.join(OUT, "05-knowledge.png"), fullPage: true });

// ---------- 3.7: подпись пальцем ----------
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "doc-versions", data: { doc: "ppk", version: 1, approvedAt: "2026-11-24", approvedById: null, note: "" } } });
check("утверждена версия ППК (лист 3.7 открыт)", r.status() === 201, String(r.status()));
r = await api.post(`${BASE}/api/production-control/acknowledgements/sign`, { data: { userId: EMP, signature: "data:image/jpeg;base64,AAAA" } });
check("подпись не PNG → 400", r.status() === 400, String(r.status()));
await page.goto(`${BASE}/production-control/item/3-7`, { waitUntil: "networkidle" });
await page.locator("[data-ack-finger]").first().click();
const pad = page.locator("[data-signature-pad] canvas");
await pad.waitFor({ timeout: 15000 });
const box = await pad.boundingBox();
await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
await page.mouse.down();
for (let i = 1; i <= 24; i += 1) await page.mouse.move(box.x + 30 + i * 14, box.y + box.height * (0.6 - 0.25 * Math.sin(i / 3)));
await page.mouse.up();
await page.screenshot({ path: path.join(OUT, "06-finger-sign.png") });
const signDialog = page.locator('[role="dialog"]').last();
await signDialog.locator('button[type="submit"]').click();
await page.waitForTimeout(3000);
await page.goto(`${BASE}/production-control/item/3-7`, { waitUntil: "networkidle" });
const sheet = await page.locator("body").innerText();
check("3.7: отметка «подпись пальцем» в листе", /подпись пальцем/.test(sheet));
await page.screenshot({ path: path.join(OUT, "07-sheet-3-7.png"), fullPage: true });

// ---------- Печатная ППК ----------
r = await api.get(`${BASE}/api/production-control/program/pdf`);
const pdf1 = Buffer.from(await r.body());
check("PDF программы: 200 application/pdf", r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"] ?? ""), String(r.status()));
const p1 = pdfText(pdf1, "program-1.pdf");
check("PDF: «Содержание» и все разделы", /Содержание/.test(p1.text) && /1\. Первичная информация/.test(p1.text) && /2\. План ХАССП/.test(p1.text) && /Приложение №6/.test(p1.text));
check("PDF: сквозная нумерация «Стр. N из M»", new RegExp(`Стр\\. 2 из ${p1.pages}`).test(p1.text) && new RegExp(`Стр\\. ${p1.pages} из ${p1.pages}`).test(p1.text), `стр. ${p1.pages}`);
check("PDF: номера редакций в шапках документов", /ППК 002/.test(p1.text) && /ППК 004/.test(p1.text));
check("PDF: «Редакция не утверждена» у неутверждённых", /Редакция не утверждена/.test(p1.text));
check("PDF: лист ознакомления с отметкой", /Ознакомлен и согласен/.test(p1.text));

// Скан политики (2 страницы) → страниц больше на 2, колонтитул на страницах скана.
r = await api.post(`${BASE}/api/production-control/files`, { multipart: { folder: "policy-scan", file: { name: "politika.pdf", mimeType: "application/pdf", buffer: await pdfWithPages(2) } } });
check("скан политики загружен", r.status() === 201, String(r.status()));
r = await api.get(`${BASE}/api/production-control/program/pdf`);
const p2 = pdfText(Buffer.from(await r.body()), "program-2.pdf");
// Скан заменяет текст политики (документ владельца): 2 страницы скана под колонтитулом документа.
const policyPages = p2.text.split("\f").filter((pageText) => /Политика в области[^\n]*· Редакция не утверждена/.test(pageText)).length;
check("скан политики — 2 страницы под колонтитулом документа", policyPages >= 2, `страниц документа: ${policyPages}; всего ${p1.pages} → ${p2.pages}`);
check("сквозная нумерация после скана", new RegExp(`Стр\\. ${p2.pages} из ${p2.pages}`).test(p2.text));

// Портал/сотрудник: файл программы для сотрудника — новый PDF.
r = await api.get(`${BASE}/api/acknowledgements/ppk/file`);
check("файл программы для ознакомления — PDF", r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"] ?? ""), String(r.status()));

// ---------- Страница ознакомления сотрудника: тексты и поле подписи ----------
await page.goto(`${BASE}/acknowledge/ppk`, { waitUntil: "networkidle" });
const ackText = await page.locator("body").innerText();
check("страница ознакомления: тексты, а не ключи", !/(acknowledge|productionControl)\.[a-zA-Z]/.test(ackText), ackText.match(/(acknowledge|productionControl)\.[a-zA-Z.]+/)?.[0] ?? "");
check("страница ознакомления: поле подписи пальцем", (await page.locator("[data-ack-signature] canvas").count()) === 1);
await page.screenshot({ path: path.join(OUT, "08-ack-page.png"), fullPage: true });
await page.goto(`${BASE}/knowledge`, { waitUntil: "networkidle" });
const knowledgeText = await page.locator("body").innerText();
check("/knowledge: тексты, а не ключи", !/productionControl\.[a-zA-Z]/.test(knowledgeText), knowledgeText.match(/productionControl\.[a-zA-Z.]+/)?.[0] ?? "");

// ---------- Права: повар ----------
const cookContext = await browser.newContext();
const cookPage = await cookContext.newPage();
await login(cookPage, "hotcook1@haccp.local").catch(() => {});
for (const [method, url, data] of [
  ["GET", "/api/production-control/revisions?docKeys=policy", null],
  ["POST", "/api/production-control/revisions", { docKey: "policy" }],
  ["POST", "/api/production-control/text-docs", { source: "procedures", title: "x", text: "y" }],
  ["POST", "/api/production-control/acknowledgements/sign", { userId: EMP, signature: "data:image/png;base64,AAAA" }],
]) {
  const res = method === "GET" ? await cookContext.request.get(`${BASE}${url}`) : await cookContext.request.post(`${BASE}${url}`, { data });
  check(`повар: ${method} ${url.split("?")[0]} → 403`, res.status() === 403, String(res.status()));
}
const anon = await (await browser.newContext()).request.get(`${BASE}/api/production-control/revisions`);
check("без входа: реестр → 401", anon.status() === 401, String(anon.status()));

check("нет ошибок страницы", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((row) => !row.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
