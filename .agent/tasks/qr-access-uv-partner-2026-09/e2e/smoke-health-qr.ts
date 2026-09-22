// Смоук QR «Гигиена и здоровье»: 5 галок → оба журнала, «не допущен» → уведомление,
// хранитель журналов правит отметки, крон конца дня присылает список.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-health-qr.ts
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
const HYGIENE_DOC = "cmu3xjc390004ks9mroi7qi9i";
const KEEPER_PIN = "5831";

const envText = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = /^(EQUIPMENT_QR_TOKEN_SECRET|TELEGRAM_LINK_TOKEN_SECRET|NEXTAUTH_SECRET|CRON_SECRET)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function noOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const { mintQrFillToken } = await import("../../../../src/lib/qr-fill-token");
  const token = mintQrFillToken("journal", `${ORG}:hygiene:${HYGIENE_DOC}`);
  const hubToken = mintQrFillToken("journal", `${ORG}:all`);
  const qr = (params: Record<string, string>) => `${BASE}/journal-fill/${ORG}/hygiene?${new URLSearchParams({ token, ...params })}`;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const day = new Date(`${todayKey}T00:00:00.000Z`);
  const cook = state.users.cookA.id as string;
  const cleaner = state.users.cleanerA.id as string;
  const head = state.users.headA.id as string;
  const people = [cook, cleaner, head];

  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { qrFillMode: true, healthQrRequired: true } });
  const users = await db.user.findMany({ where: { id: { in: people } }, select: { id: true, qrPinHash: true, qrPinEncrypted: true, keepsCoreJournals: true } });
  const beforeEntries = await db.journalDocumentEntry.findMany({
    where: { employeeId: { in: people }, date: day, document: { organizationId: ORG, template: { code: { in: ["hygiene", "health_check"] } } } },
  });
  const beforeShifts = await db.workShift.findMany({ where: { userId: { in: people }, date: day } });

  const browser = await chromium.launch({ channel: "chrome" });
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: "public", healthQrRequired: true } });
    await db.user.updateMany({ where: { id: { in: [cook, cleaner] } }, data: { qrPinHash: null, qrPinEncrypted: null } });
    await db.user.update({ where: { id: head }, data: { keepsCoreJournals: true, qrPinHash: await bcrypt.hash(KEEPER_PIN, 10), qrPinFailedCount: 0, qrPinLockedUntil: null } });
    await db.journalDocumentEntry.deleteMany({ where: { id: { in: beforeEntries.map((e) => e.id) } } });
    await db.workShift.deleteMany({ where: { userId: { in: people }, date: day } });
    await db.notification.deleteMany({ where: { organizationId: ORG, kind: { in: ["health-qr-suspended", "health-qr-missing"] } } });

    // ---- хаб: один пункт вместо двух
    const hubCtx = await browser.newContext(mobile);
    const hub = await hubCtx.newPage();
    await hub.goto(`${BASE}/journal-fill/${ORG}/all?token=${encodeURIComponent(hubToken)}`, { waitUntil: "load", timeout: 240_000 });
    const hubText = await hub.locator("main").innerText();
    check("в «Все журналы» — один пункт «Гигиена и здоровье»", hubText.includes("Гигиена и здоровье") && !hubText.includes("Журнал здоровья"), hubText.slice(0, 400));

    // ---- повар: все пять
    const cookCtx = await browser.newContext(mobile);
    const cookPage = await cookCtx.newPage();
    await cookPage.goto(qr({ employee: cook }), { waitUntil: "load", timeout: 240_000 });
    await cookPage.locator("#hq-form").waitFor({ timeout: 60_000 });
    check("форма: пять крупных подтверждений", (await cookPage.locator("[data-hq]").count()) === 5);
    check("форма без горизонтальной прокрутки (390px)", await noOverflow(cookPage));
    await cookPage.screenshot({ path: path.join(SHOTS, "30-health-form.png"), fullPage: true });
    for (const box of await cookPage.locator("[data-hq]").all()) await box.check();
    await cookPage.locator("#hq-form button[type=submit]").click();
    await cookPage.locator(".ok").waitFor({ timeout: 60_000 });
    const cookResult = await cookPage.locator("main").innerText();
    await cookPage.screenshot({ path: path.join(SHOTS, "31-health-admitted.png") });
    check("итог: «Допущен к работе», галка, без перехода в другие журналы", cookResult.includes("Допущен к работе") && !cookResult.includes("Дальше"), cookResult);
    const cookEntries = await db.journalDocumentEntry.findMany({
      where: { employeeId: cook, date: day, document: { organizationId: ORG } },
      select: { data: true, document: { select: { template: { select: { code: true } } } } },
    });
    const hyg = cookEntries.find((e) => e.document.template.code === "hygiene")?.data as Record<string, unknown> | undefined;
    const hea = cookEntries.find((e) => e.document.template.code === "health_check")?.data as Record<string, unknown> | undefined;
    check("гигиена: «Здоров», без температуры, подтверждения записаны", hyg?.status === "healthy" && hyg?.temperatureAbove37 === false && Boolean(hyg?.confirmations), hyg);
    check("журнал здоровья: подпись", hea?.signed === true, hea);
    const shift = await db.workShift.findUnique({ where: { userId_date: { userId: cook, date: day } }, select: { status: true } });
    check("отметка «на смене» в графике", shift?.status === "working", shift);

    // ---- уборщица: не всё
    const cleanerCtx = await browser.newContext(mobile);
    const cleanerPage = await cleanerCtx.newPage();
    await cleanerPage.goto(qr({ employee: cleaner }), { waitUntil: "load", timeout: 240_000 });
    await cleanerPage.locator("#hq-form").waitFor({ timeout: 60_000 });
    const boxes = await cleanerPage.locator("[data-hq]").all();
    for (const box of boxes.slice(1)) await box.check(); // первая — «Нет повышенной температуры» — не отмечена
    await cleanerPage.locator("#hq-form button[type=submit]").click();
    await cleanerPage.getByText("Сегодня вы не допущены к работе").waitFor({ timeout: 60_000 });
    await cleanerPage.screenshot({ path: path.join(SHOTS, "32-health-suspended.png") });
    const cleanerHyg = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: HYGIENE_DOC, employeeId: cleaner, date: day } },
      select: { data: true },
    });
    const ch = cleanerHyg?.data as Record<string, unknown> | undefined;
    check("не всё отмечено: «Отстранён», температура выше 37", ch?.status === "suspended" && ch?.temperatureAbove37 === true, ch);
    const alert = await db.notification.findFirst({ where: { organizationId: ORG, userId: head, kind: "health-qr-suspended" } });
    check("хранителю журналов — уведомление «не допущен»", Boolean(alert), alert?.title);

    // ---- хранитель: все за сегодня (с PIN)
    const keeperCtx = await browser.newContext(mobile);
    const keeper = await keeperCtx.newPage();
    await keeper.goto(qr({ employee: head, view: "all" }), { waitUntil: "load", timeout: 240_000 });
    await keeper.locator('input[name="pin"]').waitFor({ timeout: 60_000 });
    check("сводка дня требует PIN", true);
    await keeper.fill('input[name="pin"]', KEEPER_PIN);
    await keeper.locator('form:has(input[name="pin"]) button[type=submit]').first().click();
    await keeper.getByText("Все за сегодня").first().waitFor({ timeout: 60_000 });
    await keeper.waitForSelector(`select[name="st:${cleaner}"]`, { timeout: 60_000 });
    const dayText = await keeper.locator("main").innerText();
    await keeper.screenshot({ path: path.join(SHOTS, "33-health-keeper-day.png"), fullPage: true });
    check("сводка: повар допущен, уборщица не допущена", /допущен/.test(dayText) && /не допущен/.test(dayText), dayText.slice(0, 500));
    check("сводка без горизонтальной прокрутки (390px)", await noOverflow(keeper));
    await keeper.selectOption(`select[name="st:${cleaner}"]`, "sick_leave");
    await keeper.locator('form button[type=submit]', { hasText: "Сохранить изменения" }).click();
    await keeper.waitForURL(/saved=/, { timeout: 60_000 });
    const fixed = await db.journalDocumentEntry.findUnique({
      where: { documentId_employeeId_date: { documentId: HYGIENE_DOC, employeeId: cleaner, date: day } },
      select: { data: true },
    });
    const fd = fixed?.data as Record<string, unknown> | undefined;
    check("хранитель поставил «Болен», в записи — кто исправил", fd?.status === "sick_leave" && fd?.editedById === head, fd);

    // ---- крон конца дня
    const cron = await fetch(`${BASE}/api/cron/health-qr-missing?force=1&secret=${encodeURIComponent(process.env.CRON_SECRET ?? "")}`);
    const cronBody = (await cron.json()) as { orgs?: Array<{ orgId: string; missing: number; sent: boolean }> };
    const mine = cronBody.orgs?.find((o) => o.orgId === ORG);
    check("крон: список не отметившихся отправлен", cron.status === 200 && mine?.sent === true && (mine?.missing ?? 0) > 0, cronBody);
    const digest = await db.notification.findFirst({ where: { organizationId: ORG, userId: head, kind: "health-qr-missing" }, select: { items: true } });
    const items = JSON.stringify(digest?.items ?? []);
    check("в списке нет отметившегося повара", Boolean(digest) && !items.includes(cook), items.slice(0, 300));
    const again = (await (await fetch(`${BASE}/api/cron/health-qr-missing?force=1&secret=${encodeURIComponent(process.env.CRON_SECRET ?? "")}`)).json()) as { orgs?: Array<{ orgId: string; skipped?: string }> };
    check("повторный запуск в тот же день не шлёт второй раз", again.orgs?.find((o) => o.orgId === ORG)?.skipped === "already-sent", again);
  } finally {
    await browser.close();
    await db.journalDocumentEntry.deleteMany({ where: { employeeId: { in: people }, date: day, document: { organizationId: ORG, template: { code: { in: ["hygiene", "health_check"] } } } } });
    for (const entry of beforeEntries) await db.journalDocumentEntry.create({ data: entry as never }).catch(() => null);
    await db.workShift.deleteMany({ where: { userId: { in: people }, date: day } });
    for (const shift of beforeShifts) await db.workShift.create({ data: shift as never }).catch(() => null);
    await db.notification.deleteMany({ where: { organizationId: ORG, kind: { in: ["health-qr-suspended", "health-qr-missing"] } } });
    for (const user of users) {
      await db.user.update({ where: { id: user.id }, data: { qrPinHash: user.qrPinHash, qrPinEncrypted: user.qrPinEncrypted, keepsCoreJournals: user.keepsCoreJournals } });
    }
    await db.organization.update({ where: { id: ORG }, data: { qrFillMode: org.qrFillMode, healthQrRequired: org.healthQrRequired } });
    fs.writeFileSync(path.join(HERE, "smoke-health-qr.json"), JSON.stringify(checks, null, 2));
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
