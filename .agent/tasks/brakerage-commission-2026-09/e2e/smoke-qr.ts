// Смоук этапа F «QR бракеража»: повар «Несколько блюд», комиссия подписывает по PIN, редактор правит и удаляет.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-qr.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";
const EDITOR_PIN = "4827";

// Секрет QR-токена — тот же, что у dev-сервера (из .env берём только его).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
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

type Row = { id: string; productName: string; signatures?: Array<{ userId: string; method: string; grade?: string }> };
const rowsOf = async (): Promise<Row[]> =>
  (((await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as { rows?: Row[] }).rows ?? []);

async function noOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const token = mintQrFillToken("journal", `${ORG}:finished_product:${FP_DOC}`);
  const qr = (params: Record<string, string>) =>
    `${BASE}/journal-fill/${ORG}/finished_product?${new URLSearchParams({ token, ...params }).toString()}`;

  const originalDoc = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true, status: true } });
  const originalOrg = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true, qrFillMode: true } });
  const originalPins = await db.user.findMany({
    where: { id: { in: [state.users.cookA.id, state.users.managerA.id] } },
    select: { id: true, qrPinHash: true, qrPinEncrypted: true },
  });
  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const managerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cookCtx = await browser.newContext(mobile);
  const commissionCtx = await browser.newContext(mobile);
  const editorCtx = await browser.newContext(mobile);
  let memberId: string | null = null;
  try {
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public" } });
    await db.user.update({ where: { id: state.users.cookA.id }, data: { qrPinHash: null, qrPinEncrypted: null } });
    await db.user.update({ where: { id: state.users.managerA.id }, data: { qrPinHash: await bcrypt.hash(EDITOR_PIN, 10), qrPinFailedCount: 0, qrPinLockedUntil: null } });
    const cfg = originalDoc.config as Record<string, unknown>;
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { status: "active", config: { ...cfg, rows: [] } as never } });

    const manager = await managerCtx.newPage();
    await login(manager, state.users.managerA.email);
    const created = await managerCtx.request.post(`${BASE}/api/settings/brakerage-commission/finished_product/members`, {
      data: { fullName: "Проверяющая QR Смоук" },
    });
    const createdBody = (await created.json()) as { user?: { id: string }; pin?: string };
    memberId = createdBody.user?.id ?? null;
    const memberPin = createdBody.pin ?? "";
    await managerCtx.request.put(`${BASE}/api/settings/brakerage-commission/finished_product`, {
      data: { members: [{ employeeId: memberId, role: "Председатель" }] },
    });
    check("сторонний член комиссии создан с PIN", Boolean(memberId) && /^\d{4}$/.test(memberPin), createdBody);

    // ---- повар: «Несколько блюд»
    const cook = await cookCtx.newPage();
    await cook.goto(qr({ employee: state.users.cookA.id }), { waitUntil: "load", timeout: 240_000 });
    const cookHtml = await cook.content();
    check("повар видит форму добавления, без списка «За сегодня»", cookHtml.includes('id="qr-form"') && !cookHtml.includes("За сегодня"));
    await cook.getByRole("link", { name: "Несколько блюд" }).click();
    await cook.locator("#f-productNames").waitFor({ timeout: 60_000 });
    await cook.locator("#f-productNames").fill("Борщ\nКотлета куриная\nКомпот");
    await cook.screenshot({ path: path.join(SHOTS, "150-qr-bulk-form.png"), fullPage: true });
    check("форма «Несколько блюд» без горизонтальной прокрутки (390px)", await noOverflow(cook));
    await cook.locator("#qr-form button[type=submit]").click();
    await cook.locator(".ok").waitFor({ timeout: 60_000 });
    const resultText = await cook.locator("main").innerText();
    await cook.screenshot({ path: path.join(SHOTS, "151-qr-bulk-done.png") });
    check("после сохранения: галка и «Добавлено: 3», без перехода в другие журналы", resultText.includes("Добавлено: 3") && !resultText.includes("Дальше"), resultText);
    const afterAdd = await rowsOf();
    check("в журнале 3 строки", afterAdd.length === 3 && afterAdd.map((r) => r.productName).join("|") === "Борщ|Котлета куриная|Компот", afterAdd.map((r) => r.productName));

    // ---- комиссия: PIN один раз, оценка и подпись
    const member = await commissionCtx.newPage();
    await member.goto(qr({ employee: memberId ?? "" }), { waitUntil: "load", timeout: 240_000 });
    check("член комиссии: сначала PIN", (await member.locator('input[name="pin"]').count()) === 1);
    await member.fill('input[name="pin"]', memberPin);
    await member.locator("form button[type=submit]").click();
    await member.locator("#bk-form").waitFor({ timeout: 60_000 });
    const listText = await member.locator("main").innerText();
    check("список за сегодня: 3 блюда ждут подписи", (listText.match(/Ждёт подписи/g) ?? []).length === 3, listText.slice(0, 500));
    check("комиссия не может менять наименование и время", (await member.locator('#bk-form input[name^="name:"]').count()) === 0 && (await member.locator('#bk-form input[name^="time:"]').count()) === 0);
    check("список без горизонтальной прокрутки (390px)", await noOverflow(member));
    await member.screenshot({ path: path.join(SHOTS, "152-qr-commission-list.png"), fullPage: true });
    // Оценка второй строки — «Хорошо».
    const second = afterAdd[1].id;
    await member.locator(`input[name="grade:${second}"][value="Хорошо"]`).evaluate((el: HTMLInputElement) => el.click());
    // Попытка подменить наименование в запросе игнорируется сервером.
    await member.evaluate((rowId) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = `name:${rowId}`;
      input.value = "Подмена";
      document.getElementById("bk-form")?.appendChild(input);
    }, afterAdd[0].id);
    await member.locator('button[value="sign"]').click();
    await member.locator(".ok").waitFor({ timeout: 60_000 });
    check("«Подписано: 3»", (await member.locator("main").innerText()).includes("Подписано: 3"));
    const afterSign = await rowsOf();
    check(
      "подписи в строках: член комиссии, метод QR",
      afterSign.every((r) => r.signatures?.length === 1 && r.signatures[0].userId === memberId && r.signatures[0].method === "qr"),
      afterSign.map((r) => r.signatures)
    );
    check("оценка «Хорошо» записана", afterSign.find((r) => r.id === second)?.signatures?.[0]?.grade === "Хорошо", afterSign.find((r) => r.id === second));
    check("подмена наименования комиссией не прошла", afterSign[0].productName === "Борщ", afterSign[0].productName);
    const events = await db.signatureEvent.count({ where: { documentId: FP_DOC, entryKind: "brakerage_row", method: "qr" } });
    check("3 события в журнале подписей", events === 3, events);

    // ---- редактор (руководитель): правит наименование, удаляет строку
    const editor = await editorCtx.newPage();
    await editor.goto(qr({ employee: state.users.managerA.id }), { waitUntil: "load", timeout: 240_000 });
    await editor.fill('input[name="pin"]', EDITOR_PIN);
    await editor.locator("form button[type=submit]").click();
    await editor.locator("#bk-form").waitFor({ timeout: 60_000 });
    check("редактору видны вкладки «За сегодня / Добавить блюдо»", (await editor.locator("nav.tabs").first().innerText()).includes("Добавить блюдо"));
    await editor.locator(`input[name="name:${afterAdd[0].id}"]`).fill("Борщ красный");
    await editor.screenshot({ path: path.join(SHOTS, "153-qr-editor-list.png"), fullPage: true });
    await editor.locator('button[value="edit"]').click();
    await editor.locator(".ok").waitFor({ timeout: 60_000 });
    const afterEdit = await rowsOf();
    check("редактор исправил наименование", afterEdit[0].productName === "Борщ красный", afterEdit[0].productName);
    await editor.goto(qr({ employee: state.users.managerA.id, view: "list", del: afterAdd[2].id }), { waitUntil: "load", timeout: 240_000 });
    const confirmText = await editor.locator("main").innerText();
    check("удаление подписанной строки — с предупреждением", confirmText.includes("Удалить «Компот»?") && confirmText.includes("подпись останется"), confirmText);
    await editor.getByRole("button", { name: "Да, удалить" }).click();
    await editor.locator("#bk-form").waitFor({ timeout: 60_000 });
    const afterDelete = await rowsOf();
    check("строка удалена", afterDelete.length === 2 && !afterDelete.some((r) => r.id === afterAdd[2].id), afterDelete.map((r) => r.productName));
  } finally {
    await browser.close();
    await db.signatureEvent.deleteMany({ where: { documentId: FP_DOC } });
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: originalDoc.config as never, status: originalDoc.status } });
    await db.organization.update({
      where: { id: ORG },
      data: { journalCommissionJson: originalOrg.journalCommissionJson as never, qrFillMode: originalOrg.qrFillMode },
    });
    for (const pin of originalPins) {
      await db.user.update({ where: { id: pin.id }, data: { qrPinHash: pin.qrPinHash, qrPinEncrypted: pin.qrPinEncrypted } });
    }
    if (memberId) {
      await db.userJournalAccess.deleteMany({ where: { userId: memberId } }).catch(() => null);
      await db.user.delete({ where: { id: memberId } }).catch(() => null);
    }
    fs.writeFileSync(path.join(HERE, "smoke-qr.json"), JSON.stringify(checks, null, 2));
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
