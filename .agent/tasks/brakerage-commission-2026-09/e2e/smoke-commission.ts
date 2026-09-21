// Смоук этапа C «Сторонняя комиссия — люди в штате».
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/brakerage-commission-2026-09/e2e/smoke-commission.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { ORG_ROSTER_WHERE } from "../../../../src/lib/journal-roster";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const ORG = "e2e-org-a";
const FP_DOC = "cmu3xu9lc005lks9mmmr8ltma";

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

async function main() {
  const originalDoc = await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } });
  const originalOrg = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { journalCommissionJson: true } });
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  let createdUserId: string | null = null;
  try {
    await login(page, state.users.managerA.email);

    const created = await ctx.request.post(`${BASE}/api/settings/brakerage-commission/finished_product/members`, {
      data: { fullName: "Сторонняя Проверяющая Е2Е" },
    });
    const createdBody = (await created.json()) as { user?: { id: string }; pin?: string | null; error?: string };
    createdUserId = createdBody.user?.id ?? null;
    check("«Новый человек»: создан, ПИН выдан сразу", created.status() === 200 && /^\d{4}$/.test(createdBody.pin ?? ""), createdBody);
    const person = createdUserId
      ? await db.user.findUnique({
          where: { id: createdUserId },
          select: { role: true, jobPosition: { select: { categoryKey: true, name: true } }, qrPinHash: true },
        })
      : null;
    check(
      "новый человек — в должности категории «Комиссия», не руководитель",
      person?.jobPosition?.categoryKey === "commission" && person.role === "cook" && Boolean(person.qrPinHash),
      person
    );

    const saved = await ctx.request.put(`${BASE}/api/settings/brakerage-commission/finished_product`, {
      data: { members: [{ employeeId: createdUserId, role: "Председатель" }, { employeeId: state.users.headA.id, role: "Член комиссии" }] },
    });
    const savedBody = (await saved.json()) as { members?: unknown[]; updatedDocuments?: number };
    check("состав сохранён и скопирован в активные документы", saved.status() === 200 && (savedBody.updatedDocuments ?? 0) > 0, savedBody);

    const docCfg = (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as {
      commissionMembers?: Array<{ employeeId: string }>;
    };
    check(
      "в документе — состав с привязкой к сотрудникам",
      docCfg.commissionMembers?.some((m) => m.employeeId === createdUserId) === true,
      docCfg.commissionMembers
    );

    // Ловушка: сохранение документа с сайта не обнуляет employeeId члена комиссии.
    const patch = await ctx.request.patch(`${BASE}/api/journal-documents/${FP_DOC}`, {
      data: { config: docCfg, knownRowIds: [] },
    });
    const afterPatch = (await db.journalDocument.findUniqueOrThrow({ where: { id: FP_DOC }, select: { config: true } })).config as {
      commissionMembers?: Array<{ employeeId: string }>;
    };
    check(
      "после сохранения документа привязка стороннего члена комиссии не слетела",
      patch.status() === 200 && afterPatch.commissionMembers?.some((m) => m.employeeId === createdUserId) === true,
      afterPatch.commissionMembers
    );

    // Ростер: сторонней нет, сотрудники без должности на месте.
    const rosterIds = (await db.user.findMany({ where: { organizationId: ORG, ...ORG_ROSTER_WHERE }, select: { id: true } })).map((u) => u.id);
    const withoutPosition = await db.user.count({ where: { organizationId: ORG, isActive: true, archivedAt: null, isRoot: false, jobPositionId: null } });
    const rosterWithoutPosition = await db.user.count({ where: { organizationId: ORG, ...ORG_ROSTER_WHERE, jobPositionId: null } });
    check("ростер журналов (гигиена и др.) без стороннего члена комиссии", !rosterIds.includes(createdUserId ?? ""));
    check("сотрудники без должности остались в ростере", withoutPosition === rosterWithoutPosition, { withoutPosition, rosterWithoutPosition });

    // Страница сотрудников: колонка «Комиссия».
    await page.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 240_000 });
    await page.getByText("Комиссия", { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "130-staff-commission-column.png"), fullPage: false });
    check("на странице сотрудников есть колонка «Комиссия»", true);

    // Галка «правит список блюд».
    const flag = await ctx.request.put(`${BASE}/api/users/${state.users.headA.id}`, { data: { canEditBrakerageDishes: true } });
    const head = await db.user.findUniqueOrThrow({ where: { id: state.users.headA.id }, select: { canEditBrakerageDishes: true } });
    check("галка «Уполномочен редактировать… список блюд» сохраняется", flag.status() === 200 && head.canEditBrakerageDishes, flag.status());

    // Окно комиссии открывается из документа.
    await page.goto(`${BASE}/journals/finished_product/documents/${FP_DOC}`, { waitUntil: "load", timeout: 240_000 });
    await page.getByRole("button", { name: /Комиссия/ }).first().click();
    await page.getByText("Сторонняя бракеражная комиссия").first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "131-commission-dialog.png") });
    const dialogText = await page.getByRole("dialog").innerText();
    check("окно комиссии показывает состав и ПИН задан", dialogText.includes("Сторонняя Проверяющая Е2Е") && dialogText.includes("ПИН задан"), dialogText.slice(0, 300));
    check("без ошибок в консоли страницы", errors.length === 0, errors);
  } finally {
    await browser.close();
    await db.journalDocument.update({ where: { id: FP_DOC }, data: { config: originalDoc.config as never } });
    await db.organization.update({ where: { id: ORG }, data: { journalCommissionJson: originalOrg.journalCommissionJson as never } });
    await db.user.update({ where: { id: state.users.headA.id }, data: { canEditBrakerageDishes: false } });
    if (createdUserId) {
      await db.userJournalAccess.deleteMany({ where: { userId: createdUserId } }).catch(() => null);
      await db.user.delete({ where: { id: createdUserId } }).catch(() => null);
    }
    fs.writeFileSync(path.join(HERE, "smoke-commission.json"), JSON.stringify(checks, null, 2));
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
