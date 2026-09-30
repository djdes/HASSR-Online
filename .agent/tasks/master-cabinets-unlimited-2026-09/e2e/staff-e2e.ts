// Люди мастер-кабинета — сотрудники организаций (владелец, 30.09: «все должны
// быть в сотрудниках, но в своих группах; при приглашении указывать
// организацию»; «из МК можно направлять приглашение»).
// Стенд 3021 + ЛОКАЛЬНАЯ e2e-база; manager-a временно владелец аккаунта с
// кабинетом «Школы (e2e)»; всё созданное удаляется в finally.
// Запуск: DATABASE_URL=<e2e> node --import tsx .agent/tasks/master-cabinets-unlimited-2026-09/e2e/staff-e2e.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

import { BASE, db, PASSWORD, signIn, USERS } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must be e2e db");

const OUT = ".agent/tasks/master-cabinets-unlimited-2026-09/e2e/staff-e2e.json";
const SHOTS = "d:/wt/tmp/mcs-shots";
const ORG_A = "e2e-org-a";
const CABINET = "Школы (e2e)";
const EMAIL_SETTINGS = "mk-settings@e2e.local";
const EMAIL_MASTER = "mk-master@e2e.local";
const EMAIL_LEGACY = "mk-legacy@e2e.local";
const EMAILS = [EMAIL_SETTINGS, EMAIL_MASTER, EMAIL_LEGACY];
const INIT = "try{localStorage.removeItem(\"wesetup.last-seen-build-sha\")}catch(e){}";

async function dismissOverlays(page: Page) {
  const later = page.getByRole("button", { name: "Напомнить позже" }).first();
  await later.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
}

async function staffRecord(email: string) {
  return db.user.findFirstOrThrow({
    where: { email },
    select: {
      id: true,
      organizationId: true,
      isActive: true,
      archivedAt: true,
      journalAccessMigrated: true,
      lastActiveOrganizationId: true,
      jobPosition: { select: { name: true, organizationId: true } },
      organizationMemberships: { select: { organizationId: true, role: true } },
      inviteToken: { select: { id: true } },
    },
  });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  const owner = await db.user.findFirstOrThrow({ where: { email: USERS.managerA }, select: { id: true } });
  const orgA = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { accountId: true, name: true } });
  if (await db.user.findFirst({ where: { email: { in: EMAILS } } })) throw new Error("остались пользователи прошлого прогона");
  const positionBefore = await db.jobPosition.findFirst({ where: { organizationId: ORG_A, name: "Мастер-кабинет" } });
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  await db.organization.update({ where: { id: ORG_A }, data: { accountId: account.id } });
  const cabinet = await db.organization.create({
    data: { name: CABINET, type: "education", kind: "directory", serviceCode: "E2EMC-STAFF", accountId: account.id },
    select: { id: true },
  });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: cabinet.id, role: "owner" } });
  let current: Page | null = null;
  try {
    // 1. «Права доступа»: приглашение сотрудником выбранной организации.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(INIT);
    await signIn(ctx, USERS.managerA);
    const page = await ctx.newPage();
    current = page;
    await page.goto(`${BASE}/settings/permissions#master-cabinets`, { waitUntil: "load", timeout: 300000 });
    await dismissOverlays(page);
    const block = page.getByTestId("cabinet-access").filter({ hasText: CABINET });
    await block.waitFor({ timeout: 120000 });
    await block.getByTestId("cabinet-access-invite").click();
    const orgSelect = block.getByTestId("cabinet-access-invite-org");
    out.orgOptions = await orgSelect.locator("option").allTextContents();
    await orgSelect.selectOption(ORG_A);
    await block.getByTestId("cabinet-access-invite-name").fill("Технолог Сетевой");
    await block.getByTestId("cabinet-access-invite-email").fill(EMAIL_SETTINGS);
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/1-invite-form-org.png` });
    const inviteResponse = page.waitForResponse(
      (res) => res.url().includes("/api/settings/master-cabinets/access") && res.request().method() === "POST"
    );
    await block.getByTestId("cabinet-access-invite-submit").click();
    const inviteJson = (await (await inviteResponse).json()) as { inviteUrl?: string };
    const invitedRow = block.getByTestId("cabinet-access-person").filter({ hasText: "Технолог Сетевой" });
    await invitedRow.waitFor({ timeout: 30000 });
    out.invitedRow = ((await invitedRow.textContent()) ?? "").replace(/\s+/g, " ").trim();
    assert.ok(String(out.invitedRow).includes("Приглашён"));
    assert.ok(String(out.invitedRow).includes(`${orgA.name} · Мастер-кабинет`));
    await page.screenshot({ path: `${SHOTS}/2-invited-row.png` });

    // 2. База: сотрудник «Альфы» в группе «Мастер-кабинет», журналов нет, доступ к кабинету, первый вход — в кабинет.
    const invited = await staffRecord(EMAIL_SETTINGS);
    out.invitedDb = {
      home: invited.organizationId === ORG_A,
      position: invited.jobPosition?.name,
      positionInOrgA: invited.jobPosition?.organizationId === ORG_A,
      pending: !invited.isActive,
      strictJournals: invited.journalAccessMigrated,
      lastActiveIsCabinet: invited.lastActiveOrganizationId === cabinet.id,
      cabinetMember: invited.organizationMemberships.some((m) => m.organizationId === cabinet.id && m.role === "manager"),
      inviteToken: Boolean(invited.inviteToken),
    };
    assert.deepEqual(out.invitedDb, {
      home: true,
      position: "Мастер-кабинет",
      positionInOrgA: true,
      pending: true,
      strictJournals: true,
      lastActiveIsCabinet: true,
      cabinetMember: true,
      inviteToken: true,
    });
    const groupPermissions = await db.jobPosition.findFirstOrThrow({
      where: { organizationId: ORG_A, name: "Мастер-кабинет" },
      select: { permissionsJson: true, categoryKey: true },
    });
    out.group = groupPermissions;

    // 3. Приглашённый задаёт пароль и попадает сразу в кабинет.
    {
      const inviteCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await inviteCtx.addInitScript(INIT);
      const invitePage = await inviteCtx.newPage();
      current = invitePage;
      await invitePage.goto(`${BASE}${new URL(inviteJson.inviteUrl ?? "").pathname}`, { waitUntil: "load", timeout: 300000 });
      await invitePage.getByText(`Мастер-кабинет справочников «${CABINET}»`).waitFor({ timeout: 60000 });
      await invitePage.screenshot({ path: `${SHOTS}/3-invite-page.png` });
      const passwords = invitePage.locator('input[type="password"]');
      const count = await passwords.count();
      for (let i = 0; i < count; i += 1) await passwords.nth(i).fill(PASSWORD);
      await invitePage.locator('button[type="submit"]').first().click();
      await invitePage.waitForURL(/\/master/, { timeout: 180000 });
      await invitePage.getByText(CABINET).first().waitFor({ timeout: 120000 });
      out.inviteeLanding = new URL(invitePage.url()).pathname;
      // В кабинете у приглашённого кнопки «Доступ» нет — она только у владельца.
      out.inviteeSeesAccessButton = await invitePage.getByTestId("master-access").count();
      assert.equal(out.inviteeSeesAccessButton, 0);
      await invitePage.screenshot({ path: `${SHOTS}/4-invitee-in-master.png` });
      await inviteCtx.close();
      current = page;
    }

    // 4. Владелец в кабинете: «Доступ» → пригласить сотрудником организации прямо из кабинета.
    await page.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: cabinet.id } });
    await page.goto(`${BASE}/master`, { waitUntil: "load", timeout: 300000 });
    await page.getByTestId("master-access").click();
    const dialog = page.getByTestId("master-access-dialog");
    const masterBlock = dialog.getByTestId("cabinet-access");
    await masterBlock.waitFor({ timeout: 60000 });
    const joinedRow = masterBlock.getByTestId("cabinet-access-person").filter({ hasText: "Технолог Сетевой" });
    out.joinedRow = ((await joinedRow.textContent()) ?? "").replace(/\s+/g, " ").trim();
    assert.ok(String(out.joinedRow).includes("Сотрудник"));
    await masterBlock.getByTestId("cabinet-access-invite").click();
    await masterBlock.getByTestId("cabinet-access-invite-org").selectOption(ORG_A);
    await masterBlock.getByTestId("cabinet-access-invite-name").fill("Бэк-офис Из Кабинета");
    await masterBlock.getByTestId("cabinet-access-invite-email").fill(EMAIL_MASTER);
    await masterBlock.getByTestId("cabinet-access-invite-submit").click();
    await masterBlock.getByTestId("cabinet-access-person").filter({ hasText: "Бэк-офис Из Кабинета" }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}/5-master-access-dialog.png` });
    const fromMaster = await staffRecord(EMAIL_MASTER);
    out.fromMasterDb = {
      home: fromMaster.organizationId === ORG_A,
      position: fromMaster.jobPosition?.name,
      cabinetMember: fromMaster.organizationMemberships.some((m) => m.organizationId === cabinet.id),
    };
    assert.deepEqual(out.fromMasterDb, { home: true, position: "Мастер-кабинет", cabinetMember: true });
    const audit = await db.auditLog.findFirst({
      where: { organizationId: cabinet.id, action: "master_cabinet.invited", entityId: fromMaster.id },
      select: { details: true },
    });
    out.masterAuditVia = (audit?.details as { via?: string } | null)?.via ?? null;
    assert.equal(out.masterAuditVia, "master-cabinet");

    // 5. «Убрать» приглашённого из кабинета — только ради кабинета: в архив.
    await masterBlock
      .getByTestId("cabinet-access-person")
      .filter({ hasText: "Бэк-офис Из Кабинета" })
      .getByTestId("cabinet-access-remove")
      .click();
    await page.getByRole("button", { name: "Убрать доступ" }).click();
    await page.getByText("Доступ убран: Бэк-офис Из Кабинета").waitFor({ timeout: 30000 });
    const removed = await staffRecord(EMAIL_MASTER);
    out.removedFromMaster = {
      archived: Boolean(removed.archivedAt),
      inactive: !removed.isActive,
      member: removed.organizationMemberships.some((m) => m.organizationId === cabinet.id),
      inviteToken: Boolean(removed.inviteToken),
    };
    assert.deepEqual(out.removedFromMaster, { archived: true, inactive: true, member: false, inviteToken: false });
    await page.keyboard.press("Escape");

    // 6. Прежний путь (настройки пищеблока): приглашённый — тоже сотрудник этой организации.
    await page.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: ORG_A } });
    const legacy = await page.request.post(`${BASE}/api/settings/master-cabinet`, {
      data: { name: "Прежний Путь", email: EMAIL_LEGACY },
    });
    out.legacyStatus = legacy.status();
    assert.equal(legacy.status(), 200);
    const legacyUser = await staffRecord(EMAIL_LEGACY);
    const legacyMaster = await db.organization.findFirstOrThrow({
      where: { accountId: account.id, kind: "directory", id: { not: cabinet.id } },
      select: { id: true },
    });
    out.legacyDb = {
      home: legacyUser.organizationId === ORG_A,
      position: legacyUser.jobPosition?.name,
      member: legacyUser.organizationMemberships.some((m) => m.organizationId === legacyMaster.id),
    };
    assert.deepEqual(out.legacyDb, { home: true, position: "Мастер-кабинет", member: true });
    const status = (await (await page.request.get(`${BASE}/api/settings/master-cabinet`)).json()) as {
      master?: { users?: Array<{ email: string; invited: boolean }> };
    };
    out.legacyListed = status.master?.users?.some((user) => user.email === EMAIL_LEGACY && user.invited) ?? false;
    assert.equal(out.legacyListed, true);
    await ctx.close();
    out.ok = true;
  } catch (error) {
    out.ok = false;
    out.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    if (current && !current.isClosed()) {
      out.failUrl = current.url();
      await current.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
    const users = await db.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    const cabinets = (
      await db.organization.findMany({ where: { accountId: account.id, kind: "directory" }, select: { id: true } })
    ).map((org) => org.id);
    await db.inviteToken.deleteMany({ where: { userId: { in: userIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: cabinets } }] } });
    await db.auditLog.deleteMany({ where: { organizationId: ORG_A, action: { startsWith: "master_cabinet." } } });
    await db.organizationMember.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: cabinets } }] } });
    for (const id of userIds) await db.user.delete({ where: { id } }).catch((e) => { out[`cleanupUser_${id}`] = String(e); });
    if (!positionBefore) {
      await db.jobPosition.deleteMany({ where: { organizationId: ORG_A, name: "Мастер-кабинет" } }).catch((e) => { out.cleanupPosition = String(e); });
    }
    await db.organization.deleteMany({ where: { id: { in: cabinets } } }).catch((e) => { out.cleanupCabinets = String(e); });
    await db.organization.update({ where: { id: ORG_A }, data: { accountId: orgA.accountId } });
    await db.account.delete({ where: { id: account.id } });
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
