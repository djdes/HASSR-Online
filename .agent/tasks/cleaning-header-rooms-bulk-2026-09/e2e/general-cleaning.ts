// e2e cleaning-header-rooms-bulk-2026-09: график ген. уборок — утверждающий из диалога,
// помещения при создании, цех без помещения в «Добавить помещение».
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/cleaning-header-rooms-bulk-2026-09/e2e/general-cleaning.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8"));
const ORG = state.orgA as string;
const AREA = "E2E Основное производство";

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
};

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
  await page.fill("#email", email);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

async function dismissOverlays(page: Page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
    await terms.click();
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 4_000 }).catch(() => {});
  const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
  if (await guide.isVisible().catch(() => false)) await guide.getByRole("button", { name: "Понятно" }).first().click().catch(() => null);
}

async function main() {
  // Здание с помещением и цех без помещения.
  let building = await db.building.findFirst({ where: { organizationId: ORG }, select: { id: true } });
  if (!building) building = await db.building.create({ data: { organizationId: ORG, name: "E2E здание" }, select: { id: true } });
  const roomCount = await db.room.count({ where: { building: { organizationId: ORG } } });
  if (roomCount === 0) await db.room.create({ data: { buildingId: building.id, name: "E2E Склад", kind: "storage" } });
  await db.room.deleteMany({ where: { building: { organizationId: ORG }, name: AREA } });
  await db.area.deleteMany({ where: { organizationId: ORG, name: AREA } });
  await db.area.create({ data: { organizationId: ORG, name: AREA } });
  const head = await db.user.findUnique({
    where: { id: state.users.headA.id },
    select: { id: true, name: true, positionTitle: true, jobPosition: { select: { name: true } } },
  });
  const headTitle = head?.jobPosition?.name || head?.positionTitle || "Заведующий производством";

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let id: string | null = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, state.users.managerA.email);
    const year = new Date().getUTCFullYear();
    // Как присылает диалог создания: должность + выбранный человек в approve*/responsible*.
    const created = await ctx.request.post(`${BASE}/api/journal-documents`, {
      data: {
        templateCode: "general_cleaning",
        title: "E2E график ген. уборок",
        dateFrom: `${year}-01-01`,
        dateTo: `${year}-12-31`,
        responsibleTitle: headTitle,
        responsibleUserId: head!.id,
        force: true,
        config: {
          year,
          documentDate: `${year}-01-01`,
          approveRole: headTitle,
          approveEmployeeId: head!.id,
          approveEmployee: head!.name,
          responsibleRole: headTitle,
          responsibleEmployeeId: head!.id,
          responsibleEmployee: head!.name,
        },
      },
      timeout: 180_000,
    });
    id = (await created.json().catch(() => null))?.document?.id ?? null;
    check("график создан", created.ok() && Boolean(id), created.status());
    const doc = await db.journalDocument.findUnique({ where: { id: id! }, select: { config: true } });
    const cfg = (doc?.config ?? {}) as Record<string, unknown>;
    check("УТВЕРЖДАЮ: человек из диалога", cfg.approveEmployeeId === head!.id, { approveEmployeeId: cfg.approveEmployeeId, approveEmployee: cfg.approveEmployee });
    check("УТВЕРЖДАЮ: должность этого же человека", cfg.approveRole === headTitle, { approveRole: cfg.approveRole, headTitle });
    const rows = Array.isArray(cfg.rows) ? (cfg.rows as unknown[]) : [];
    check("помещения подтянулись при создании", rows.length > 0, rows.length);

    await page.goto(`${BASE}/journals/general_cleaning/documents/${id}`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForTimeout(2500);
    await dismissOverlays(page);
    const bodyText = await page.locator("body").innerText();
    check("шапка на экране: должность и ФИО одного человека", bodyText.includes(head!.name) && bodyText.includes(headTitle));
    await page.screenshot({ path: path.join(SHOTS, "gc-header.png") });

    await page.getByRole("button", { name: "Добавить помещение" }).first().click();
    const picker = page.getByRole("dialog").filter({ hasText: "Цеха без помещения" }).first();
    await picker.waitFor({ timeout: 30_000 });
    check("окно: группа «Цеха без помещения» с цехом", (await picker.innerText()).includes(AREA));
    await page.screenshot({ path: path.join(SHOTS, "gc-picker.png") });
    await picker.getByRole("button", { name: new RegExp(AREA) }).first().click();
    let room: { id: string; kind: string } | null = null;
    for (let i = 0; i < 20 && !room; i++) {
      await page.waitForTimeout(1000);
      room = await db.room.findFirst({ where: { building: { organizationId: ORG }, name: AREA }, select: { id: true, kind: true } });
    }
    check("«+» создал помещение с именем цеха (тип кухня)", Boolean(room) && room!.kind === "kitchen", room);
    let linked = false;
    for (let i = 0; i < 20 && !linked && room; i++) {
      await page.waitForTimeout(1000);
      const c = (await db.journalDocument.findUnique({ where: { id: id! }, select: { config: true } }))?.config as { rows?: Array<{ roomId?: string }> } | null;
      linked = Boolean(c?.rows?.some((r) => r.roomId === room!.id));
    }
    check("помещение добавлено в график", linked);
    const areas = await db.area.count({ where: { organizationId: ORG, name: AREA } });
    check("дубль цеха не создан", areas === 1, areas);
    await page.screenshot({ path: path.join(SHOTS, "gc-after-add.png") });
  } catch (e) {
    console.log("E2E ERROR", (e as Error).message.split("\n")[0]);
  } finally {
    await browser.close();
    if (id) await db.journalDocument.delete({ where: { id } }).catch(() => null);
    await db.room.deleteMany({ where: { building: { organizationId: ORG }, name: AREA } });
    await db.area.deleteMany({ where: { organizationId: ORG, name: AREA } });
    fs.writeFileSync(path.join(HERE, "general-cleaning.json"), JSON.stringify(checks, null, 2));
    console.log(`${checks.filter((c) => c.ok).length}/${checks.length} PASS`);
    await db.$disconnect();
  }
}
void main();
