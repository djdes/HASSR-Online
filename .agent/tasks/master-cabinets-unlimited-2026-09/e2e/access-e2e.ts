// «Права доступа → Мастер-кабинеты»: дать доступ сотруднику, пригласить по
// почте (принятие приглашения → /master), убрать доступ. Стенд 3021 +
// ЛОКАЛЬНАЯ e2e-база; manager-a временно владелец аккаунта с кабинетом
// «Школы (e2e)», всё откатывается в finally.
// Запуск: DATABASE_URL=<e2e> node --import tsx .agent/tasks/master-cabinets-unlimited-2026-09/e2e/access-e2e.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

import { BASE, db, PASSWORD, signIn, USERS } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must be e2e db");

const OUT = ".agent/tasks/master-cabinets-unlimited-2026-09/e2e/access-e2e.json";
const SHOTS = "d:/wt/tmp/mca-shots";
const ORG_A = "e2e-org-a";
const CABINET = "Школы (e2e)";
const INVITE_EMAIL = "backoffice-mca@e2e.local";
const INIT = "try{localStorage.removeItem(\"wesetup.last-seen-build-sha\")}catch(e){}";

async function dismissOverlays(page: Page) {
  const later = page.getByRole("button", { name: "Напомнить позже" }).first();
  await later.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const out: Record<string, unknown> = {};
  const browser = await chromium.launch({ headless: true });
  const owner = await db.user.findFirstOrThrow({ where: { email: USERS.managerA }, select: { id: true } });
  const cook = await db.user.findFirstOrThrow({ where: { email: USERS.cookA }, select: { id: true, name: true } });
  const orgA = await db.organization.findUniqueOrThrow({ where: { id: ORG_A }, select: { accountId: true } });
  if (await db.user.findFirst({ where: { email: INVITE_EMAIL } })) throw new Error("остался пользователь прошлого прогона");
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  await db.organization.update({ where: { id: ORG_A }, data: { accountId: account.id } });
  const cabinet = await db.organization.create({
    data: { name: CABINET, type: "education", kind: "directory", serviceCode: "E2EMC-ACCES", accountId: account.id },
    select: { id: true },
  });
  await db.organizationMember.create({ data: { userId: owner.id, organizationId: cabinet.id, role: "owner" } });
  let current: Page | null = null;
  try {
    // 1. Владелец: «Права доступа» → карточка кабинета, пока доступ только у владельца.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(INIT);
    await signIn(ctx, USERS.managerA);
    const page = await ctx.newPage();
    current = page;
    await page.goto(`${BASE}/settings/permissions`, { waitUntil: "load", timeout: 300000 });
    await dismissOverlays(page);
    const block = page.getByTestId("cabinet-access").filter({ hasText: CABINET });
    await block.waitFor({ timeout: 120000 });
    out.anchorLink = await page.getByRole("link", { name: "Доступ к мастер-кабинетам" }).count();
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/1-card-empty.png` });

    // 2. Дать доступ сотруднику объекта (повар «Альфы»): поиск по имени.
    await block.getByTestId("cabinet-access-grant").click();
    await block.getByTestId("cabinet-access-search").fill(cook.name.split(/\s+/)[0] ?? cook.name);
    const candidate = block.getByTestId("cabinet-access-candidate").filter({ hasText: cook.name }).first();
    await candidate.waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}/2-picker.png` });
    await candidate.click();
    await page.getByText(`Доступ открыт: ${cook.name}`).waitFor({ timeout: 30000 });
    const memberRow = block.getByTestId("cabinet-access-person").filter({ hasText: cook.name });
    await memberRow.waitFor({ timeout: 30000 });
    out.memberRow = ((await memberRow.textContent()) ?? "").replace(/\s+/g, " ").trim();
    assert.ok(String(out.memberRow).includes("Сотрудник"));
    // Список остаётся открытым, поиск сброшен — видны остальные сотрудники.
    out.searchClearedAfterGrant = (await block.getByTestId("cabinet-access-search").inputValue()) === "";
    assert.equal(out.searchClearedAfterGrant, true);
    await block.getByRole("button", { name: "Закрыть список" }).click();

    // 3. Пригласить по почте: только этот кабинет.
    await block.getByTestId("cabinet-access-invite").click();
    await block.getByTestId("cabinet-access-invite-name").fill("Бэк-офис Тестовый");
    await block.getByTestId("cabinet-access-invite-email").fill(INVITE_EMAIL);
    const inviteResponse = page.waitForResponse(
      (res) => res.url().includes("/api/settings/master-cabinets/access") && res.request().method() === "POST"
    );
    await block.getByTestId("cabinet-access-invite-submit").click();
    const inviteJson = (await (await inviteResponse).json()) as { inviteUrl?: string; emailSent?: boolean };
    await block.getByTestId("cabinet-access-invite-result").waitFor({ timeout: 30000 });
    const invitedRow = block.getByTestId("cabinet-access-person").filter({ hasText: "Бэк-офис Тестовый" });
    await invitedRow.waitFor({ timeout: 30000 });
    out.invitedRow = ((await invitedRow.textContent()) ?? "").replace(/\s+/g, " ").trim();
    assert.ok(String(out.invitedRow).includes("Приглашён"));
    assert.ok(inviteJson.inviteUrl?.includes("/invite/"));
    out.emailSent = inviteJson.emailSent;
    await page.screenshot({ path: `${SHOTS}/3-card-two-people.png` });

    // 4. База: участие повара, приглашённый — домашняя организация-кабинет, ссылка есть.
    const membership = await db.organizationMember.findUnique({
      where: { userId_organizationId: { userId: cook.id, organizationId: cabinet.id } },
      select: { role: true },
    });
    const invited = await db.user.findFirstOrThrow({
      where: { email: INVITE_EMAIL },
      select: { id: true, organizationId: true, isActive: true, role: true },
    });
    out.db = {
      membershipRole: membership?.role ?? null,
      invitedHome: invited.organizationId === cabinet.id,
      invitedActive: invited.isActive,
      inviteTokens: await db.inviteToken.count({ where: { userId: invited.id } }),
      audit: await db.auditLog.count({ where: { organizationId: cabinet.id, action: { in: ["master_cabinet.access_granted", "master_cabinet.invited"] } } }),
    };
    assert.deepEqual(out.db, { membershipRole: "manager", invitedHome: true, invitedActive: false, inviteTokens: 1, audit: 2 });

    // 5. Повар: кабинет в списке, открывается, API кабинета отвечает; «Права доступа» ему закрыты.
    const cookCtx = await browser.newContext();
    await signIn(cookCtx, USERS.cookA);
    const cookOrgs = (await (await cookCtx.request.get(`${BASE}/api/organizations`)).json()) as {
      organizations: Array<{ id: string; kind: string }>;
    };
    out.cookSeesCabinet = cookOrgs.organizations.some((org) => org.id === cabinet.id && org.kind === "directory");
    const cookSwitch = await cookCtx.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: cabinet.id } });
    const cookDirectory = await cookCtx.request.get(`${BASE}/api/master/directory?kind=dish`);
    const cookAccessApi = await cookCtx.request.get(`${BASE}/api/settings/master-cabinets/access`);
    out.cook = { switch: cookSwitch.status(), directory: cookDirectory.status(), accessApi: cookAccessApi.status() };
    assert.equal(out.cookSeesCabinet, true);
    assert.equal(cookSwitch.status(), 200);
    assert.equal(cookDirectory.status(), 200);
    assert.equal(cookAccessApi.status(), 403);

    // 6. Приглашённый: принимает приглашение — задаёт пароль и попадает в /master.
    {
      const inviteCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await inviteCtx.addInitScript(INIT);
      const invitePage = await inviteCtx.newPage();
      current = invitePage;
      const inviteUrl = new URL(inviteJson.inviteUrl ?? "");
      await invitePage.goto(`${BASE}${inviteUrl.pathname}`, { waitUntil: "load", timeout: 300000 });
      const passwords = invitePage.locator('input[type="password"]');
      await passwords.first().waitFor({ timeout: 60000 });
      const count = await passwords.count();
      for (let i = 0; i < count; i += 1) await passwords.nth(i).fill(PASSWORD);
      await invitePage.locator('button[type="submit"]').first().click();
      await invitePage.waitForURL(/\/master/, { timeout: 180000 });
      await invitePage.getByText(CABINET).first().waitFor({ timeout: 120000 });
      await invitePage.screenshot({ path: `${SHOTS}/4-invitee-master.png` });
      out.inviteeUrl = new URL(invitePage.url()).pathname;
      const invitedAfter = await db.user.findUniqueOrThrow({ where: { id: invited.id }, select: { isActive: true } });
      out.inviteeActive = invitedAfter.isActive;
      assert.equal(out.inviteeActive, true);
      await inviteCtx.close();
      current = page;
    }

    // 7. Убрать доступ повару — участие снято, его сессия больше не открывает кабинет.
    await page.reload({ waitUntil: "load" });
    await dismissOverlays(page);
    const blockAfter = page.getByTestId("cabinet-access").filter({ hasText: CABINET });
    await blockAfter.getByTestId("cabinet-access-person").filter({ hasText: "Вошёл" }).waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${SHOTS}/5-card-invitee-joined.png` });
    await blockAfter.getByTestId("cabinet-access-person").filter({ hasText: cook.name }).getByTestId("cabinet-access-remove").click();
    await page.getByRole("button", { name: "Убрать доступ" }).click();
    await page.getByText(`Доступ убран: ${cook.name}`).waitFor({ timeout: 30000 });
    const cookAfter = await cookCtx.request.get(`${BASE}/api/master/directory?kind=dish`);
    out.cookAfterRevoke = cookAfter.status();
    assert.ok([401, 403].includes(cookAfter.status()), `после «Убрать» API кабинета: ${cookAfter.status()}`);
    assert.equal(
      await db.organizationMember.count({ where: { userId: cook.id, organizationId: cabinet.id } }),
      0
    );
    await cookCtx.close();

    // 8. Убрать приглашённого — в архив.
    await blockAfter.getByTestId("cabinet-access-person").filter({ hasText: "Бэк-офис Тестовый" }).getByTestId("cabinet-access-remove").click();
    await page.getByRole("button", { name: "Убрать доступ" }).click();
    await page.getByText("Доступ убран: Бэк-офис Тестовый").waitFor({ timeout: 30000 });
    const archived = await db.user.findUniqueOrThrow({ where: { id: invited.id }, select: { archivedAt: true, isActive: true } });
    out.invitedArchived = Boolean(archived.archivedAt) && !archived.isActive;
    assert.equal(out.invitedArchived, true);
    await page.screenshot({ path: `${SHOTS}/6-card-after-revoke.png` });
    await ctx.close();

    // 9. Телефон 390: карточка без прокрутки вбок.
    {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await phone.addInitScript(INIT);
      await signIn(phone, USERS.managerA);
      const phonePage = await phone.newPage();
      current = phonePage;
      await phonePage.goto(`${BASE}/settings/permissions#master-cabinets`, { waitUntil: "load", timeout: 300000 });
      await dismissOverlays(phonePage);
      const phoneBlock = phonePage.getByTestId("cabinet-access").filter({ hasText: CABINET });
      await phoneBlock.waitFor({ timeout: 120000 });
      await phoneBlock.getByTestId("cabinet-access-grant").click();
      await phoneBlock.scrollIntoViewIfNeeded();
      await phonePage.screenshot({ path: `${SHOTS}/7-phone-picker.png` });
      out.phoneNoHScroll = await phonePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.equal(out.phoneNoHScroll, true);
      await phone.close();
    }
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
    const invitedUser = await db.user.findFirst({ where: { email: INVITE_EMAIL }, select: { id: true } });
    if (invitedUser) {
      await db.inviteToken.deleteMany({ where: { userId: invitedUser.id } });
      await db.auditLog.deleteMany({ where: { userId: invitedUser.id } });
    }
    await db.auditLog.deleteMany({ where: { organizationId: cabinet.id } });
    await db.organizationMember.deleteMany({ where: { organizationId: cabinet.id } });
    if (invitedUser) await db.user.delete({ where: { id: invitedUser.id } }).catch((e) => { out.cleanupUser = String(e); });
    await db.organization.delete({ where: { id: cabinet.id } }).catch((e) => { out.cleanupCabinet = String(e); });
    await db.organization.update({ where: { id: ORG_A }, data: { accountId: orgA.accountId } });
    await db.account.delete({ where: { id: account.id } });
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
