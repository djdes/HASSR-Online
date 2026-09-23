// Смоук brakerage-commission-qr-2026-09: член комиссии по QR → список блюд за сегодня (как у заведующего),
// должность без состава — только просмотр, запасная проверка по составу организации, смена человека
// сбрасывает вид, PIN при commission=1 в режиме «только после входа», формулировки оценок, одно время (6a).
// Запуск (dev с wesetup_e2e): BASE=http://localhost:3025 npx tsx .agent/tasks/brakerage-commission-qr-2026-09/e2e/smoke-member-list.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type BrowserContext, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { orgTodayKey } from "../../../../src/lib/timezone";

const BASE = process.env.BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";
const MEMBER_PIN = "5931";
const VIEWER_PIN = "6042";
const ORG_ONLY_PIN = "7153";
const EDITOR_PIN = "8264";
const OLD_GOOD = "Доброкачественная";

// Секрет QR-токена — тот же, что у dev-сервера (из .env берём только секреты подписи, не базу).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("login failed");
}

type Sig = { userId: string; method: string; grade?: string };
type Row = {
  id: string;
  productName: string;
  organoleptic: string;
  productionDateTime: string;
  rejectionTime: string;
  releasePermissionTime: string;
  signatures?: Sig[];
};
type Member = { id: string; role: string; employeeId: string; employeeName: string };
const docConfig = async () =>
  (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as {
    rows?: Row[];
    commissionMembers?: Member[];
  };
const rowsOf = async () => (await docConfig()).rows ?? [];
const rowByName = async (name: string) => (await rowsOf()).find((row) => row.productName === name);

async function enterPin(page: Page, pin: string) {
  await page.locator("#qr-pin").waitFor({ timeout: 120_000 });
  await page.fill('#qr-pin input[name="pin"]', pin);
  await Promise.all([page.waitForLoadState("load"), page.locator("#qr-pin button[type=submit]").click()]);
}

async function pdfText(ctx: BrowserContext, url: string): Promise<string> {
  const response = await ctx.request.get(url, { timeout: 240_000 });
  const data = new Uint8Array(await response.body());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return parts.join("\n");
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const token = mintQrFillToken("journal", `${ORG}:finished_product:${FP_DOC}`);
  const qr = (params: Record<string, string>) =>
    `${BASE}/journal-fill/${ORG}/finished_product?${new URLSearchParams({ token, ...params }).toString()}`;

  // ---- снимок стенда (всё вернём в finally)
  const originalDoc = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true, status: true } });
  const otherDocs = await db.journalDocument.findMany({
    where: { organizationId: ORG, status: "active", template: { code: "finished_product" }, id: { not: FP_DOC } },
    select: { id: true, config: true },
  });
  const originalOrg = await db.organization.findUniqueOrThrow({
    where: { id: ORG },
    select: { journalCommissionJson: true, qrFillMode: true, timezone: true },
  });
  const cookId = state.users.cookA.id as string;
  const originalCook = await db.user.findUniqueOrThrow({
    where: { id: cookId },
    select: { qrPinHash: true, qrPinEncrypted: true, canEditBrakerageDishes: true, qrPinFailedCount: true, qrPinLockedUntil: true },
  });
  const positionBefore = await db.jobPosition.findFirst({
    where: { organizationId: ORG, categoryKey: "commission", name: "Член бракеражной комиссии" },
    select: { id: true },
  });
  const createdUsers: string[] = [];
  const today = orgTodayKey(originalOrg.timezone ?? undefined);

  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    await db.organization.update({
      where: { id: ORG },
      data: { qrFillMode: "public", journalCommissionJson: { ...(originalOrg.journalCommissionJson as object ?? {}), finished_product: [] } as never },
    });
    await db.user.update({ where: { id: cookId }, data: { qrPinHash: null, qrPinEncrypted: null, canEditBrakerageDishes: false } });
    const baseCfg = originalDoc.config as Record<string, unknown>;
    const legacyRow = (id: string, name: string, time: string, organoleptic: string) => ({
      id,
      productionDateTime: `${today} ${time}`,
      rejectionTime: "",
      releasePermissionTime: "",
      productName: name,
      organoleptic,
      releaseAllowed: "yes",
    });
    // Старые записи хранят «Доброкачественная» / «Не доброкачественная» — должны показываться новыми словами.
    await db.journalDocument.update({
      where: { id: FP_DOC },
      data: {
        status: "active",
        config: {
          ...baseCfg,
          fieldNameMode: "dish",
          organolepticOptions: [],
          commissionMembers: [],
          rows: [
            legacyRow("smoke-ml-r1", "Суп легаси", "11:00", OLD_GOOD),
            legacyRow("smoke-ml-r2", "Каша легаси", "11:10", "Не доброкачественная"),
          ],
        } as never,
      },
    });

    // ---- руководитель: сайт и PDF — новые слова для старых записей (до любых записей в документ)
    const managerCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const manager = await managerCtx.newPage();
    await login(manager, state.users.managerA.email);
    await manager.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await manager.locator("tbody tr", { hasText: "Суп легаси" }).first().waitFor({ timeout: 120_000 });
    const siteText = await manager.evaluate(() => {
      const values = Array.from(document.querySelectorAll("main input, main textarea")).map((el) => (el as HTMLInputElement).value);
      return `${document.querySelector("main")?.textContent ?? ""}\n${values.join("\n")}`;
    });
    check(
      "сайт: старые оценки показываются «Доброкачественно / Недоброкачественно»",
      siteText.includes("Доброкачественно") && siteText.includes("Недоброкачественно") && !/оброкачественная/.test(siteText),
      siteText.match(/.{0,30}оброкачествен.{0,30}/g)
    );
    await manager.screenshot({ path: path.join(SHOTS, "01-site-grades.png") });
    const pdf = await pdfText(managerCtx, `${BASE}/api/journal-documents/${FP_DOC}/pdf`);
    check(
      "PDF: оценки «Доброкачественно / Недоброкачественно», старых слов нет",
      pdf.includes("Доброкачественно") && pdf.includes("Недоброкачественно") && !/оброкачественная/.test(pdf),
      pdf.match(/.{0,30}оброкачествен.{0,30}/g) ?? pdf.slice(0, 300)
    );

    // ---- AC2/AC1: «Новый человек» через API → сразу в составе → QR → PIN → «За сегодня» → «Допущено» → «Подписано»
    const created = await managerCtx.request.post(`${BASE}/api/settings/brakerage-commission/finished_product/members`, {
      data: { fullName: "Член Списка Смоук", pin: MEMBER_PIN },
    });
    const createdBody = (await created.json()) as { user?: { id: string; name: string }; pin?: string; members?: Member[] };
    const memberId = createdBody.user?.id ?? "";
    if (memberId) createdUsers.push(memberId);
    const orgAfterCreate = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true } });
    const orgMembers = ((orgAfterCreate.journalCommissionJson as Record<string, Member[]>)?.finished_product ?? []).map((m) => m.employeeId);
    check(
      "«Новый человек»: ответ несёт состав, человек в составе организации и в копии документа",
      created.ok() &&
        (createdBody.members ?? []).some((m) => m.employeeId === memberId) &&
        orgMembers.includes(memberId) &&
        ((await docConfig()).commissionMembers ?? []).some((m) => m.employeeId === memberId),
      { status: created.status(), body: createdBody, orgMembers }
    );

    const memberCtx = await browser.newContext(mobile);
    const member = await memberCtx.newPage();
    await member.goto(qr({ employee: memberId }), { waitUntil: "load", timeout: 240_000 });
    check("член комиссии: сначала PIN", (await member.locator("#qr-pin").count()) === 1);
    await enterPin(member, MEMBER_PIN);
    await member.locator("#bk-form").waitFor({ timeout: 120_000 });
    const memberList = await member.locator("main").innerText();
    check(
      "член комиссии видит список «За сегодня», а не форму «Одно блюдо / Несколько блюд»",
      (await member.locator('input[name^="adm:"]').count()) >= 2 && (await member.locator("#qr-form").count()) === 0 && !memberList.includes("Несколько блюд"),
      memberList.slice(0, 400)
    );
    const qrGrades = await member.locator('.seg input[name^="grade:"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    const legacyChecked = await member.locator('input[name="grade:smoke-ml-r1"]:checked').getAttribute("value").catch(() => null);
    check(
      "QR: варианты оценки — новые слова, старая запись отмечена «Доброкачественно»",
      qrGrades.includes("Доброкачественно") && qrGrades.includes("Недоброкачественно") && !qrGrades.some((g) => /качественная$/.test(g)) && legacyChecked === "Доброкачественно",
      { legacyChecked, sample: [...new Set(qrGrades)] }
    );
    await member.locator('input[name="adm:smoke-ml-r1"][value="yes"]').evaluate((el: HTMLInputElement) => el.click());
    const signLabel = (await member.locator("[data-sign-btn]").innerText()).trim();
    check("кнопка «Подписать · 1»", signLabel === "Подписать · 1", signLabel);
    await member.screenshot({ path: path.join(SHOTS, "02-member-list.png"), fullPage: true });
    await member.locator("[data-sign-btn]").click();
    await member.locator(".ok").waitFor({ timeout: 120_000 });
    const signedText = await member.locator("main").innerText();
    const r1 = await rowByName("Суп легаси");
    check(
      "«Подписано: 1», подпись нового человека в строке (QR)",
      signedText.includes("Подписано: 1") && r1?.signatures?.length === 1 && r1.signatures[0].userId === memberId && r1.signatures[0].method === "qr",
      { signedText: signedText.slice(0, 200), r1 }
    );
    await member.screenshot({ path: path.join(SHOTS, "03-member-signed.png") });

    const position = await db.jobPosition.findFirstOrThrow({
      where: { organizationId: ORG, categoryKey: "commission", name: "Член бракеражной комиссии" },
      select: { id: true },
    });
    const makeUser = async (name: string, pin: string) => {
      const user = await db.user.create({
        data: {
          organizationId: ORG,
          name,
          email: `smoke-ml-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.local`,
          role: "cook",
          jobPositionId: position.id,
          qrPinHash: await bcrypt.hash(pin, 10),
          // Вход в кабинет не нужен — только PIN на QR.
          passwordHash: await bcrypt.hash(`smoke-${Math.random()}`, 4),
          isActive: true,
        },
        select: { id: true, name: true },
      });
      createdUsers.push(user.id);
      return user;
    };

    // ---- AC3: должность «Член бракеражной комиссии» без состава — список только для чтения + плашка; POST — отказ
    const viewer = await makeUser("Должность Без Состава Смоук", VIEWER_PIN);
    const viewerCtx = await browser.newContext(mobile);
    const viewerPage = await viewerCtx.newPage();
    await viewerPage.goto(qr({ employee: viewer.id }), { waitUntil: "load", timeout: 240_000 });
    await enterPin(viewerPage, VIEWER_PIN);
    await viewerPage.locator("[data-viewer-notice]").waitFor({ timeout: 120_000 });
    const notice = await viewerPage.locator("[data-viewer-notice]").innerText();
    check(
      "должность без состава: плашка «Вас нет в утверждённом составе…»",
      notice.includes("Вас нет в утверждённом составе бракеражной комиссии") && notice.includes("журнал → «Комиссия»"),
      notice
    );
    check(
      "должность без состава: список без радио, полей оценки и кнопки подписи",
      (await viewerPage.locator('input[name^="adm:"]').count()) === 0 &&
        (await viewerPage.locator('input[name^="grade:"]').count()) === 0 &&
        (await viewerPage.locator("#bk-form").count()) === 0 &&
        (await viewerPage.locator("main").innerText()).includes("Каша легаси")
    );
    const noticeColors = await viewerPage.locator("[data-viewer-notice]").evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.backgroundColor} ${style.color}`;
    });
    check("плашка — амбер #fff8eb / #a16d32, не красная", noticeColors === "rgb(255, 248, 235) rgb(161, 109, 50)", noticeColors);
    const signedBadge = await viewerPage.locator(".bk-s.signed").first().innerText();
    check("подписанная без правок строка — «Подписано», без «изменено после подписи»", !signedBadge.includes("изменено после подписи"), signedBadge);
    await viewerPage.screenshot({ path: path.join(SHOTS, "04-viewer-readonly.png"), fullPage: true });
    const forged = await viewerPage.request.post(viewerPage.url(), {
      form: { action: "save", "adm:smoke-ml-r2": "yes", "grade:smoke-ml-r2": "Отлично" },
      maxRedirects: 0,
    });
    const r2AfterForge = await rowByName("Каша легаси");
    check(
      "должность без состава: прямой POST подписи — отказ 403, подписи нет",
      forged.status() === 403 && (r2AfterForge?.signatures?.length ?? 0) === 0,
      { status: forged.status(), r2AfterForge }
    );

    // ---- AC1 (запасная проверка): член только в составе организации, копия документа пустая
    const orgOnly = await makeUser("Только Организация Смоук", ORG_ONLY_PIN);
    await db.organization.update({
      where: { id: ORG },
      data: {
        journalCommissionJson: {
          ...((originalOrg.journalCommissionJson as object) ?? {}),
          finished_product: [
            { id: `commission-${memberId}`, role: "Председатель", employeeId: memberId, employeeName: "Член Списка Смоук" },
            { id: `commission-${orgOnly.id}`, role: "Член комиссии", employeeId: orgOnly.id, employeeName: orgOnly.name },
          ],
        } as never,
      },
    });
    const cfgNow = (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as Record<string, unknown>;
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: { ...cfgNow, commissionMembers: [] } as never } });
    const orgOnlyCtx = await browser.newContext(mobile);
    const orgOnlyPage = await orgOnlyCtx.newPage();
    await orgOnlyPage.goto(qr({ employee: orgOnly.id }), { waitUntil: "load", timeout: 240_000 });
    await enterPin(orgOnlyPage, ORG_ONLY_PIN);
    await orgOnlyPage.locator("#bk-form").waitFor({ timeout: 120_000 });
    check("член только состава организации: список с «Допущено / Не допущено»", (await orgOnlyPage.locator('input[name="adm:smoke-ml-r2"]').count()) === 2);
    await orgOnlyPage.locator('input[name="adm:smoke-ml-r2"][value="no"]').evaluate((el: HTMLInputElement) => el.click());
    await orgOnlyPage.locator("[data-sign-btn]").click();
    await orgOnlyPage.locator(".ok").waitFor({ timeout: 120_000 });
    const orgOnlyText = await orgOnlyPage.locator("main").innerText();
    const afterOrgOnly = await docConfig();
    const r2 = afterOrgOnly.rows?.find((row) => row.id === "smoke-ml-r2");
    check(
      "член только состава организации: «Подписано: 1», подпись в строке",
      orgOnlyText.includes("Подписано: 1") && r2?.signatures?.some((sig) => sig.userId === orgOnly.id) === true,
      { orgOnlyText: orgOnlyText.slice(0, 200), r2 }
    );
    check(
      "копия состава документа досинхронизирована (добавлен только он)",
      (afterOrgOnly.commissionMembers ?? []).map((m) => m.employeeId).join(",") === orgOnly.id,
      afterOrgOnly.commissionMembers
    );
    await orgOnlyPage.screenshot({ path: path.join(SHOTS, "05-org-only-signed.png") });
    // Вернуть копии документа полный состав — дальше нужен член из «Нового человека».
    await db.journalDocument.update({
      where: { id: FP_DOC },
      data: {
        config: {
          ...((await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as object),
          commissionMembers: [
            { id: `commission-${memberId}`, role: "Председатель", employeeId: memberId, employeeName: "Член Списка Смоук" },
            { id: `commission-${orgOnly.id}`, role: "Член комиссии", employeeId: orgOnly.id, employeeName: orgOnly.name },
          ],
        } as never,
      },
    });

    // ---- AC6a (QR «Несколько блюд») + AC4: повар добавляет блюда, затем «Сменить» на члена комиссии
    const cookCtx = await browser.newContext(mobile);
    const cook = await cookCtx.newPage();
    await cook.goto(qr({ employee: cookId }), { waitUntil: "load", timeout: 240_000 });
    await cook.getByRole("link", { name: "Несколько блюд" }).click();
    await cook.locator("#f-productNames").waitFor({ timeout: 120_000 });
    await cook.locator("#f-productNames").fill("Плов смоук\nЧай смоук");
    await cook.locator("#f-productionTime").fill("12:40");
    await cook.screenshot({ path: path.join(SHOTS, "06-cook-bulk.png"), fullPage: true });
    await cook.locator("#qr-form button[type=submit]").click();
    await cook.locator(".ok").waitFor({ timeout: 120_000 });
    check("повар: «Добавлено: 2»", (await cook.locator("main").innerText()).includes("Добавлено: 2"));
    const bulkRows = (await rowsOf()).filter((row) => ["Плов смоук", "Чай смоук"].includes(row.productName));
    check(
      "QR «Несколько блюд»: изготовление 12:40 → бракераж 12:45, разрешение 12:50 сразу в строках",
      bulkRows.length === 2 &&
        bulkRows.every(
          (row) => row.productionDateTime === `${today} 12:40` && row.rejectionTime === `${today} 12:45` && row.releasePermissionTime === `${today} 12:50`
        ),
      bulkRows.map((row) => [row.productName, row.productionDateTime, row.rejectionTime, row.releasePermissionTime])
    );
    await cook.goto(qr({ employee: cookId, bulk: "1" }), { waitUntil: "load", timeout: 240_000 });
    await cook.locator("#f-productNames").waitFor({ timeout: 120_000 });
    await cook.locator("a[data-emp-open]").click();
    const sheet = cook.locator("#emp-sheet");
    const sheetOpened = await sheet.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
    if (sheetOpened) {
      await Promise.all([cook.waitForLoadState("load"), sheet.locator(`button[name="employee"][value="${memberId}"]`).click()]);
    } else {
      await cook.locator(`button[name="employee"][value="${memberId}"]`).first().click();
    }
    await enterPin(cook, MEMBER_PIN);
    await cook.waitForLoadState("load");
    const afterSwitchUrl = new URL(cook.url());
    check(
      "после «Сменить» член комиссии видит список, а не форму «Несколько блюд»",
      (await cook.locator("#bk-form").count()) === 1 &&
        (await cook.locator("#f-productNames").count()) === 0 &&
        !afterSwitchUrl.searchParams.has("bulk") &&
        afterSwitchUrl.searchParams.get("view") !== "add",
      { url: cook.url(), sheetOpened }
    );
    await cook.screenshot({ path: path.join(SHOTS, "07-switch-to-member-list.png"), fullPage: true });

    // ---- AC6a (коррекция) + заведующий производством с флагом правит строку
    await db.user.update({
      where: { id: cookId },
      data: { canEditBrakerageDishes: true, qrPinHash: await bcrypt.hash(EDITOR_PIN, 10), qrPinFailedCount: 0, qrPinLockedUntil: null },
    });
    const editorCtx = await browser.newContext(mobile);
    const editor = await editorCtx.newPage();
    await editor.goto(qr({ employee: cookId }), { waitUntil: "load", timeout: 240_000 });
    await enterPin(editor, EDITOR_PIN);
    await editor.locator("#bk-form").waitFor({ timeout: 120_000 });
    const plov = (await rowByName("Плов смоук"))!;
    check("заведующий с флагом: наименование и время правятся", (await editor.locator(`input[name="name:${plov.id}"]`).count()) === 1);
    await editor.locator(`input[name="name:${plov.id}"]`).fill("Плов узбекский смоук");
    await editor.locator(`input[name="time:${plov.id}"]`).fill("13:00");
    // Подписанная строка: изготовление меняется, а время бракеража/разрешения — нет.
    await editor.locator(`input[name="time:smoke-ml-r1"]`).fill("11:30");
    const r1Before = (await rowByName("Суп легаси"))!;
    await editor.screenshot({ path: path.join(SHOTS, "08-editor-list.png"), fullPage: true });
    await editor.locator('#bk-form button[name="action"][value="save"]').click();
    await editor.locator(".ok").waitFor({ timeout: 120_000 });
    const plovAfter = (await rowsOf()).find((row) => row.id === plov.id);
    check(
      "заведующий: наименование исправлено; изготовление 13:00 неподписанной строки → бракераж 13:05, разрешение 13:10",
      plovAfter?.productName === "Плов узбекский смоук" &&
        plovAfter.productionDateTime === `${today} 13:00` &&
        plovAfter.rejectionTime === `${today} 13:05` &&
        plovAfter.releasePermissionTime === `${today} 13:10`,
      plovAfter
    );
    const r1After = (await rowsOf()).find((row) => row.id === "smoke-ml-r1");
    check(
      "подписанная строка: время бракеража и разрешения не пересчитаны",
      r1After?.productionDateTime === `${today} 11:30` &&
        r1After.rejectionTime === r1Before.rejectionTime &&
        r1After.releasePermissionTime === r1Before.releasePermissionTime,
      { before: r1Before, after: r1After }
    );

    // ---- AC5: режим «только после входа» + commission=1 без сессии → PIN
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "auth" } });
    const anonCtx = await browser.newContext(mobile);
    const anon = await anonCtx.newPage();
    await anon.goto(qr({ commission: "1", employee: memberId }), { waitUntil: "load", timeout: 240_000 });
    check(
      "«только после входа» + «Я член комиссии» без сессии: сначала PIN, списка нет",
      (await anon.locator("#qr-pin").count()) === 1 && (await anon.locator("#bk-form").count()) === 0,
      (await anon.locator("main").innerText()).slice(0, 300)
    );
    await anon.screenshot({ path: path.join(SHOTS, "09-auth-commission-pin.png") });
    await enterPin(anon, MEMBER_PIN);
    await anon.locator("#bk-form").waitFor({ timeout: 120_000 });
    check("после PIN — список за сегодня", (await anon.locator('input[name^="adm:"]').count()) > 0);
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
  } finally {
    await browser.close();
    await db.signatureEvent.deleteMany({ where: { documentId: FP_DOC } });
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: originalDoc.config as never, status: originalDoc.status } });
    for (const doc of otherDocs) await db.journalDocument.update({ where: { id: doc.id }, data: { config: doc.config as never } });
    await db.organization.update({
      where: { id: ORG },
      data: { journalCommissionJson: originalOrg.journalCommissionJson as never, qrFillMode: originalOrg.qrFillMode },
    });
    await db.user.update({ where: { id: cookId }, data: originalCook });
    for (const userId of createdUsers) {
      await db.userJournalAccess.deleteMany({ where: { userId } }).catch(() => null);
      await db.user.delete({ where: { id: userId } }).catch((error) => console.warn("user delete", userId, String(error).slice(0, 200)));
    }
    if (!positionBefore) {
      const position = await db.jobPosition.findFirst({
        where: { organizationId: ORG, categoryKey: "commission", name: "Член бракеражной комиссии" },
        select: { id: true },
      });
      if (position) {
        await db.jobPositionJournalAccess.deleteMany({ where: { jobPositionId: position.id } }).catch(() => null);
        await db.jobPosition.delete({ where: { id: position.id } }).catch(() => null);
      }
    }
    fs.writeFileSync(path.join(HERE, "smoke-member-list.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
