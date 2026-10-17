// AC4: бракеражная комиссия у скоропортящейся продукции — сквозной смоук.
//   1) старая копия состава без метки сервера не оживает (нет статусов, «Комиссия» без счётчика);
//   2) окно «Комиссия» назначает состав → документ получает метку commissionEnabled;
//   3) документ: «Комиссия · N», строка состава, «Сегодня: …», статус «Ждёт подписи комиссии»;
//   4) закончить журнал нельзя — сервер (4xx) и окно закрытия;
//   5) QR журнала: член комиссии входит по PIN, видит список за сегодня, подписывает;
//   6) подпись видна в документе; член комиссии подписывает на сайте «Подписать»;
//   7) все записи подписаны — журнал закрывается (потом возвращаем как было).
// Запуск (dev-сервер worktree на 3044, база wesetup_staff):
//   BASE=http://localhost:3044 npx tsx .agent/tasks/staff-data-2026-10/e2e/ac4-perishable-commission.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium, type Page } from "playwright";

const DB_URL = "postgresql://postgres:postgres@localhost:5432/wesetup_staff?sslmode=disable";
if (!/@localhost:5432\/wesetup_staff\b/.test(DB_URL)) throw new Error("Только localhost:5432/wesetup_staff");
process.env.DATABASE_URL = DB_URL;
process.env.DATABASE_URL_DIRECT = DB_URL;
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DB_URL })) });

const BASE = process.env.BASE ?? "http://localhost:3044";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const RAW = path.join(HERE, "..", "raw");
const ORG = "cmvbfyemt0000uw9mywdjiurr";
const DOC = "cmvbgz0e200c4f89mj50girdt";
const PASSWORD = "Staff2026!";
const PIN = "4827";

// Секрет QR-токена — тот же, что у dev-сервера (из .env берём только его).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (!(await page.locator("#email").waitFor({ timeout: 180_000 }).then(() => true).catch(() => false))) continue;
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error(`login failed: ${email}`);
}

type Row = { id: string; productName: string; note?: string; signatures?: Array<{ userId: string; method: string; grade?: string }> };
const docConfig = async () =>
  (await db.journalDocument.findUniqueOrThrow({ where: { id: DOC }, select: { config: true, status: true } }));
const rowsOf = async (): Promise<Row[]> => (((await docConfig()).config as { rows?: Row[] }).rows ?? []);

function todayMoscow(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function openDoc(page: Page) {
  await page.goto(`${BASE}/journals/perishable_rejection/documents/${DOC}`, { waitUntil: "load", timeout: 300_000 });
  await page.locator('[data-testid="perishable-commission-button"]').waitFor({ timeout: 180_000 });
  await page.waitForLoadState("networkidle").catch(() => null);
  // «Мы обновили условия» у руководителя, который ещё не принял новую редакцию
  // (в локальной копии базы) — принимаем, иначе окно перекрывает документ.
  const legal = page.getByTestId("legal-update-accept");
  if (await legal.isVisible().catch(() => false)) {
    await page.getByTestId("legal-consent").check();
    await legal.click();
    await legal.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => null);
  }
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const token = mintQrFillToken("journal", `${ORG}:perishable_rejection:${DOC}`);
  const qr = (params: Record<string, string>) =>
    `${BASE}/journal-fill/${ORG}/perishable_rejection?${new URLSearchParams({ token, ...params }).toString()}`;

  const admin = await db.user.findFirstOrThrow({ where: { email: "admin@haccp.local" }, select: { id: true } });
  const tech = await db.user.findFirstOrThrow({ where: { email: "technologist@haccp.local" }, select: { id: true, name: true, qrPinHash: true, qrPinEncrypted: true } });
  const originalDoc = await docConfig();
  const originalOrg = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true, qrFillMode: true } });
  // Состав копируется во ВСЕ активные документы скоропорта — их конфиги тоже вернём.
  const otherDocs = await db.journalDocument.findMany({
    where: { organizationId: ORG, status: "active", template: { code: "perishable_rejection" }, id: { not: DOC } },
    select: { id: true, config: true },
  });
  const startedAt = new Date();
  const today = todayMoscow();
  const rows = [
    { id: "ac4-row-1", productName: "Сметана 20%", arrivalDate: today, arrivalTime: "08:10", organolepticResult: "compliant", storageCondition: "2_6", responsiblePerson: "Крылов Д. С., Управляющий" },
    { id: "ac4-row-2", productName: "Творог 9%", arrivalDate: today, arrivalTime: "08:20", organolepticResult: "compliant", storageCondition: "2_6", responsiblePerson: "Крылов Д. С., Управляющий" },
  ];
  const legacyMembers = [{ id: `commission-${tech.id}`, role: "Председатель", employeeId: tech.id, employeeName: tech.name }];

  const browser = await chromium.launch({ channel: "chrome" });
  const desktop = { viewport: { width: 1440, height: 1000 } };
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const managerCtx = await browser.newContext(desktop);
  const memberCtx = await browser.newContext(desktop);
  const qrCtx = await browser.newContext(mobile);
  try {
    // ---- 1. старая копия состава (до решения 2026-09-22) без метки сервера
    const baseCfg = (originalDoc.config ?? {}) as Record<string, unknown>;
    const { commissionEnabled: _drop, ...cfgWithoutFlag } = baseCfg;
    void _drop;
    await db.journalDocument.update({
      where: { id: DOC },
      data: { status: "active", config: { ...cfgWithoutFlag, rows, commissionMembers: legacyMembers } as never },
    });
    const orgJson = { ...((originalOrg.journalCommissionJson ?? {}) as Record<string, unknown>) };
    delete orgJson.perishable_rejection;
    await db.organization.update({ where: { id: ORG }, data: { journalCommissionJson: orgJson as never, qrFillMode: "public" } });
    await db.user.update({ where: { id: tech.id }, data: { qrPinHash: await bcrypt.hash(PIN, 10), qrPinEncrypted: null, qrPinFailedCount: 0, qrPinLockedUntil: null } });

    const manager = await managerCtx.newPage();
    await login(manager, "admin@haccp.local");
    await openDoc(manager);
    const legacyButton = (await manager.locator('[data-testid="perishable-commission-button"]').innerText()).trim();
    const legacyChips = await manager.locator('[data-testid="perishable-commission-status"]').count();
    await manager.screenshot({ path: path.join(RAW, "ac4-01-legacy-copy-inactive.png"), fullPage: true });
    check("AC4.2 старая копия без метки: кнопка «Комиссия» без счётчика, статусов подписи нет", legacyButton === "Комиссия" && legacyChips === 0, { legacyButton, legacyChips });
    const legacyClose = await managerCtx.request.fetch(`${BASE}/api/journal-documents/${DOC}`, { method: "GET" });
    check("AC4.2 документ со старой копией открывается (GET 200)", legacyClose.status() === 200, legacyClose.status());

    // ---- 2. окно «Комиссия»: назначить состав
    await manager.locator('[data-testid="perishable-commission-button"]').click();
    await manager.getByText("Бракеражная комиссия скоропорта").waitFor({ timeout: 60_000 });
    await manager.getByRole("button", { name: "Добавить из сотрудников" }).click();
    await manager.getByPlaceholder("Найти по фамилии").fill("Лебедева");
    await manager.locator('[role="dialog"] button', { hasText: "Лебедева" }).first().click();
    await manager.screenshot({ path: path.join(RAW, "ac4-02-commission-dialog.png") });
    const commissionSaved = manager.waitForResponse((r) => r.url().includes("/api/settings/brakerage-commission/perishable_rejection") && r.request().method() === "PUT", { timeout: 180_000 });
    await manager.getByRole("button", { name: "Сохранить состав" }).click();
    await commissionSaved;
    await manager.waitForTimeout(500);
    const afterSave = await docConfig();
    const savedCfg = afterSave.config as { commissionEnabled?: boolean; commissionMembers?: Array<{ employeeId: string }> };
    const savedOrg = (await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true } })).journalCommissionJson as Record<string, Array<{ employeeId: string }>>;
    check(
      "AC4.1 окно «Комиссия» сохранило состав организации и скопировало его в активный документ с меткой commissionEnabled",
      savedOrg.perishable_rejection?.map((m) => m.employeeId).join() === tech.id &&
        savedCfg.commissionEnabled === true &&
        savedCfg.commissionMembers?.map((m) => m.employeeId).join() === tech.id,
      { org: savedOrg.perishable_rejection, doc: { enabled: savedCfg.commissionEnabled, members: savedCfg.commissionMembers } }
    );

    // ---- 3. документ с комиссией
    await openDoc(manager);
    const button = (await manager.locator('[data-testid="perishable-commission-button"]').innerText()).trim();
    const membersLine = (await manager.locator('[data-testid="perishable-commission-members"]').innerText()).trim();
    const todayLine = (await manager.locator('[data-testid="perishable-today-signatures"]').innerText()).trim();
    const waitingChips = await manager.locator('[data-testid="perishable-commission-status"][data-signed="0"]').count();
    await manager.screenshot({ path: path.join(RAW, "ac4-03-doc-with-commission.png"), fullPage: true });
    check("AC4.3 кнопка «Комиссия · 1»", button === "Комиссия · 1", button);
    check("AC4.3 строка состава", membersLine.includes("Бракеражная комиссия:") && membersLine.includes("Лебедева"), membersLine);
    check("AC4.3 итог «Сегодня: 2 записи, 2 ждут подписи комиссии»", todayLine.startsWith("Сегодня: 2 записи, 2 ждут подписи комиссии"), todayLine);
    check("AC4.3 у каждой записи статус «Ждёт подписи комиссии»", waitingChips === 2, waitingChips);

    // ---- 4. закончить журнал нельзя: сервер и окно
    const refused = await managerCtx.request.fetch(`${BASE}/api/journal-documents/${DOC}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ status: "closed" }),
    });
    const refusedBody = await refused.json().catch(() => null);
    check(
      "AC4.3 сервер не даёт закончить журнал с неподписанными записями",
      refused.status() >= 400 && refused.status() < 500 && (await docConfig()).status === "active",
      { status: refused.status(), body: refusedBody }
    );
    await manager.getByRole("button", { name: "Ещё действия" }).first().click();
    await manager.getByText("Закончить журнал", { exact: true }).first().click();
    const blocker = manager.getByText(/Нельзя закончить журнал: 2 записи ждут подписи комиссии/);
    await blocker.waitFor({ timeout: 30_000 });
    await manager.screenshot({ path: path.join(RAW, "ac4-04-close-blocked-dialog.png") });
    check("AC4.3 окно закрытия объясняет, что записи ждут подписи комиссии", await blocker.isVisible());
    await manager.keyboard.press("Escape");

    // ---- 5. QR журнала: член комиссии входит по PIN и подписывает
    const member = await qrCtx.newPage();
    await member.goto(qr({ employee: tech.id }), { waitUntil: "load", timeout: 300_000 });
    const pinInputs = await member.locator('#qr-pin input[name="pin"]').count();
    await member.screenshot({ path: path.join(RAW, "ac4-05-qr-pin-step.png"), fullPage: true });
    check("AC4.4 член комиссии на QR — сначала PIN", pinInputs === 1, pinInputs);
    await member.fill('#qr-pin input[name="pin"]', PIN);
    await member.locator("#qr-pin button[type=submit]").click();
    await member.locator("#bk-form").waitFor({ timeout: 120_000 });
    const listText = await member.locator("main").innerText();
    await member.screenshot({ path: path.join(RAW, "ac4-06-qr-today-list.png"), fullPage: true });
    check("AC4.4 список за сегодня: 2 позиции ждут подписи", (listText.match(/Ждёт подписи/g) ?? []).length === 2 && listText.includes("Позиций в очереди"), listText.slice(0, 400));
    await member.locator('input[name="grade:ac4-row-1"][value="compliant"]').evaluate((el: HTMLInputElement) => el.click());
    const signLabel = (await member.locator("[data-sign-btn]").innerText()).trim();
    check("AC4.4 кнопка «Подписать · 1»", signLabel === "Подписать · 1", signLabel);
    await member.locator("[data-sign-btn]").click();
    await member.locator(".ok").waitFor({ timeout: 120_000 });
    const resultText = await member.locator("main").innerText();
    await member.screenshot({ path: path.join(RAW, "ac4-07-qr-signed.png"), fullPage: true });
    check("AC4.4 «Подписано: 1»", resultText.includes("Подписано: 1"), resultText.slice(0, 300));
    const afterQr = await rowsOf();
    const row1 = afterQr.find((row) => row.id === "ac4-row-1");
    check("AC4.4 подпись в документе: член комиссии, метод qr, оценка compliant", row1?.signatures?.length === 1 && row1.signatures[0].userId === tech.id && row1.signatures[0].method === "qr" && row1.signatures[0].grade === "compliant", row1?.signatures);
    const events = await db.signatureEvent.count({ where: { documentId: DOC, entryKind: "brakerage_row", method: "qr", createdAt: { gte: startedAt } } });
    check("AC4.4 событие в журнале подписей (SignatureEvent)", events === 1, events);

    // ---- 6. подпись видна в документе
    await openDoc(manager);
    const signedChip = (await manager.locator('[data-testid="perishable-commission-status"][data-signed="1"]').first().innerText()).trim();
    const signaturesBlock = (await manager.locator('[data-testid="perishable-signatures"]').innerText()).trim();
    await manager.screenshot({ path: path.join(RAW, "ac4-08-doc-signed-by-qr.png"), fullPage: true });
    check("AC4.4 в документе у записи «Подписано: Лебедева М. О. · ЧЧ:ММ»", /^Подписано: Лебедева М\. О\. · \d{2}:\d{2}$/.test(signedChip), signedChip);
    check("AC4.3 блок «Подписи бракеражной комиссии» под таблицей", signaturesBlock.startsWith("Подписи бракеражной комиссии") && signaturesBlock.includes("Лебедева"), signaturesBlock.slice(0, 200));

    // ---- член комиссии на сайте: «Подписать» выделенную запись
    const site = await memberCtx.newPage();
    await login(site, "technologist@haccp.local");
    await openDoc(site);
    await site.getByRole("checkbox", { name: /Выбрать запись 2/ }).first().click();
    const signButton = site.locator('[data-testid="selection-sign"]');
    await signButton.waitFor({ timeout: 30_000 });
    await site.screenshot({ path: path.join(RAW, "ac4-09-site-sign-selected.png"), fullPage: false });
    await signButton.click();
    await site.getByText("Подписано записей: 1").waitFor({ timeout: 60_000 });
    const afterSite = await rowsOf();
    const row2 = afterSite.find((row) => row.id === "ac4-row-2");
    check("AC4.3 «Подписать выбранные» для члена комиссии на сайте (метод session)", row2?.signatures?.[0]?.userId === tech.id && row2.signatures[0].method === "session", row2?.signatures);
    await site.waitForTimeout(800);
    const allSigned = (await site.locator('[data-testid="perishable-today-signatures"]').innerText()).trim();
    await site.screenshot({ path: path.join(RAW, "ac4-10-all-signed.png"), fullPage: true });
    check("AC4.3 итог «Сегодня: 2 записи, все подписаны комиссией»", allSigned === "Сегодня: 2 записи, все подписаны комиссией", allSigned);

    // ---- 7. все подписаны — сервер закрывает журнал (затем возвращаем)
    const allowed = await managerCtx.request.fetch(`${BASE}/api/journal-documents/${DOC}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ status: "closed" }),
    });
    check("AC4.3 после подписей журнал закрывается (PATCH 200)", allowed.status() === 200 && (await docConfig()).status === "closed", allowed.status());

    // ---- метку нельзя подделать сохранением с сайта
    await db.journalDocument.update({ where: { id: DOC }, data: { status: "active" } });
    const current = (await docConfig()).config as Record<string, unknown>;
    const forged = await managerCtx.request.fetch(`${BASE}/api/journal-documents/${DOC}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ config: { ...current, commissionEnabled: false, commissionMembers: [] }, knownRowIds: afterSite.map((row) => row.id) }),
    });
    const afterForge = (await docConfig()).config as { commissionEnabled?: boolean; commissionMembers?: unknown[] };
    check("AC4.2 сохранение с сайта не снимает метку и состав (серверные ключи)", forged.status() === 200 && afterForge.commissionEnabled === true && afterForge.commissionMembers?.length === 1, { status: forged.status(), enabled: afterForge.commissionEnabled });
    void admin;
  } finally {
    await browser.close();
    // Только события этого прогона: прежние подписи документа не трогаем.
    await db.signatureEvent.deleteMany({ where: { documentId: DOC, createdAt: { gte: startedAt } } });
    for (const other of otherDocs) {
      await db.journalDocument.update({ where: { id: other.id }, data: { config: other.config as never } });
    }
    await db.journalDocument.update({ where: { id: DOC }, data: { config: originalDoc.config as never, status: originalDoc.status } });
    await db.organization.update({ where: { id: ORG }, data: { journalCommissionJson: originalOrg.journalCommissionJson as never, qrFillMode: originalOrg.qrFillMode } });
    await db.user.update({ where: { id: tech.id }, data: { qrPinHash: tech.qrPinHash, qrPinEncrypted: tech.qrPinEncrypted, qrPinFailedCount: 0, qrPinLockedUntil: null } });
    await db.$disconnect();
  }
  fs.writeFileSync(path.join(HERE, "ac4-perishable-commission.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  fs.writeFileSync(path.join(HERE, "ac4-perishable-commission.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, checks, error: String(error) }, null, 2));
  process.exitCode = 1;
});
