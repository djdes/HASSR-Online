// «Создать мастер-кабинет» в меню профиля: сколько угодно кабинетов.
// Стенд 3021 + ЛОКАЛЬНАЯ e2e-база. Фикстура: manager-a временно владелец
// аккаунта с тремя объектами и старым кабинетом у «Альфы»; в finally всё
// возвращается как было.
// Запуск: DATABASE_URL=<e2e> node --import tsx .agent/tasks/master-cabinets-unlimited-2026-09/e2e/create-cabinets.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

import { findPoolMasterOrgId } from "@/lib/master-directory";
import { APP_UA, BASE, db, signIn, USERS } from "../../mobile-apps-2026-09/e2e/server-db";

if (!/@localhost:5432\/wesetup_e2e\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must be e2e db");

const SHOTS = "d:/wt/tmp/mc-shots";
const OUT = ".agent/tasks/master-cabinets-unlimited-2026-09/e2e/create-cabinets.json";
const HIDE_DEV =
  "try{localStorage.removeItem(\"wesetup.last-seen-build-sha\")}catch(e){};" +
  "document.addEventListener(\"DOMContentLoaded\",function(){var s=document.createElement(\"style\");" +
  "s.textContent=\"nextjs-portal{display:none!important}\";document.head.appendChild(s)})";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const ORG_A = "e2e-org-a";
const OLD_MASTER_NAME = "Мастер-кабинет — Кафе «Альфа»";

type Fixture = {
  ownerId: string;
  accountId: string;
  orgA: { serviceCode: string | null; linkedServiceCode: string | null; accountId: string | null };
  schoolId: string;
  gardenId: string;
  oldMasterId: string;
};

async function setup(): Promise<Fixture> {
  const owner = await db.user.findFirstOrThrow({ where: { email: USERS.managerA }, select: { id: true } });
  const existing = await db.account.findUnique({ where: { ownerUserId: owner.id } });
  if (existing) throw new Error("manager-a уже владелец аккаунта — прогон не начинаем");
  const orgA = await db.organization.findUniqueOrThrow({
    where: { id: ORG_A },
    select: { serviceCode: true, linkedServiceCode: true, accountId: true },
  });
  const code = orgA.serviceCode ?? "E2EMC-ALPHA";
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  await db.organization.update({ where: { id: ORG_A }, data: { accountId: account.id, serviceCode: code } });
  const school = await db.organization.create({
    data: { name: "Школа №2 (e2e)", type: "education", accountId: account.id, linkedServiceCode: code },
    select: { id: true },
  });
  const garden = await db.organization.create({
    data: { name: "Детский сад №1 (e2e)", type: "education", accountId: account.id },
    select: { id: true },
  });
  const oldMaster = await db.organization.create({
    data: { name: OLD_MASTER_NAME, type: "education", kind: "directory", linkedServiceCode: code, accountId: account.id },
    select: { id: true },
  });
  for (const organizationId of [school.id, garden.id, oldMaster.id]) {
    await db.organizationMember.create({ data: { userId: owner.id, organizationId, role: "owner" } });
  }
  return { ownerId: owner.id, accountId: account.id, orgA, schoolId: school.id, gardenId: garden.id, oldMasterId: oldMaster.id };
}

async function cleanup(fx: Fixture | null) {
  if (!fx) return;
  const created = await db.organization.findMany({
    where: { accountId: fx.accountId, id: { notIn: [ORG_A] } },
    select: { id: true },
  });
  const ids = created.map((org) => org.id);
  await db.auditLog.deleteMany({ where: { organizationId: { in: [...ids, ORG_A] }, action: "master_cabinet.created" } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.organization.update({
    where: { id: ORG_A },
    data: { accountId: fx.orgA.accountId, serviceCode: fx.orgA.serviceCode, linkedServiceCode: fx.orgA.linkedServiceCode },
  });
  await db.account.delete({ where: { id: fx.accountId } });
}

let current: Page | null = null;

async function newPage(browser: Browser, ua: string, width: number, height: number) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width, height } });
  await ctx.addInitScript(HIDE_DEV);
  await signIn(ctx, USERS.managerA);
  const page = await ctx.newPage();
  current = page;
  return { ctx, page };
}

/** Порядок строк раздела «Кабинет» по тексту, как на экране. */
async function cabinetRows(page: Page, rowSelector: string): Promise<string[]> {
  return page.locator(rowSelector).evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
  );
}

/** Окна главной поверх меню (напоминание о CAPA и т. п.) — «Напомнить позже». */
async function dismissOverlays(page: Page) {
  const later = page.getByRole("button", { name: "Напомнить позже" }).first();
  await later.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
}

async function openDesktopMenu(page: Page) {
  await dismissOverlays(page);
  await page.getByRole("button", { name: "Профиль" }).first().click();
  await page.getByTestId("profile-create-master-cabinet").first().waitFor({ state: "visible", timeout: 30000 });
}

async function createViaDialog(page: Page, name: string, check: string[], uncheck: string[]) {
  const dialog = page.getByTestId("create-master-cabinet-dialog");
  await dialog.waitFor({ state: "visible", timeout: 30000 });
  await dialog.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 30000 });
  await dialog.getByTestId("create-master-cabinet-name").fill(name);
  for (const label of check) {
    const box = dialog.locator("label", { hasText: label }).getByTestId("create-master-cabinet-object");
    if (!(await box.isChecked())) await box.check();
  }
  for (const label of uncheck) {
    const box = dialog.locator("label", { hasText: label }).getByTestId("create-master-cabinet-object");
    if (await box.isChecked()) await box.uncheck();
  }
}

async function main() {
  const out: Record<string, unknown> = {};
  let fx: Fixture | null = null;
  const browser = await chromium.launch({ headless: true });
  try {
    fx = await setup();

    // 1. Компьютер: меню профиля — старый кабинет, под ним «Создать мастер-кабинет».
    const { ctx, page } = await newPage(browser, DESKTOP_UA, 1440, 900);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
    await openDesktopMenu(page);
    const rowsSel = '[data-testid="profile-master-cabinet"], [data-testid="profile-create-master-cabinet"]';
    out.menuBefore = await cabinetRows(page, rowsSel);
    assert.deepEqual(out.menuBefore, [OLD_MASTER_NAME, "Создать мастер-кабинет"]);
    await page.screenshot({ path: `${SHOTS}/1-menu-before.png` });

    // 2. Окно: сразу отмечен только объект без кабинета, у остальных подпись «Сейчас меню из …».
    await page.getByTestId("profile-create-master-cabinet").first().click();
    const dialog = page.getByTestId("create-master-cabinet-dialog");
    await dialog.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 30000 });
    const boxes = dialog.getByTestId("create-master-cabinet-object");
    out.initialChecks = await boxes.evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: (node.closest("label")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        checked: (node as HTMLInputElement).checked,
      }))
    );
    const checks = out.initialChecks as Array<{ label: string; checked: boolean }>;
    assert.equal(checks.length, 3);
    assert.deepEqual(
      checks.map((c) => c.checked),
      checks.map((c) => c.label.startsWith("Детский сад"))
    );
    assert.ok(checks.find((c) => c.label.startsWith("Кафе"))?.label.includes(`Сейчас меню из «${OLD_MASTER_NAME}»`));
    await createViaDialog(page, "Сады", ["Детский сад №1 (e2e)"], []);
    await page.screenshot({ path: `${SHOTS}/2-dialog-gardens.png` });
    await dialog.getByTestId("create-master-cabinet-submit").click();
    await page.getByText("Мастер-кабинет «Сады» создан").waitFor({ timeout: 30000 });
    await dialog.waitFor({ state: "detached", timeout: 30000 });
    await page.waitForTimeout(1500);

    // 3. После первого — кабинет в меню и снова «Создать мастер-кабинет» под ним.
    await openDesktopMenu(page);
    await page.locator('[data-testid="profile-master-cabinet"]', { hasText: "Сады" }).waitFor({ timeout: 30000 });
    out.menuAfterFirst = await cabinetRows(page, rowsSel);
    assert.deepEqual(out.menuAfterFirst, [OLD_MASTER_NAME, "Сады", "Создать мастер-кабинет"]);
    await page.screenshot({ path: `${SHOTS}/3-menu-after-first.png` });

    // 4. Второй: «Школы», школа уходит из старого кабинета — окно предупреждает.
    await page.getByTestId("profile-create-master-cabinet").first().click();
    await dialog.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 30000 });
    const gardenLabel = await dialog.locator("label", { hasText: "Детский сад" }).textContent();
    out.gardenHintNow = (gardenLabel ?? "").replace(/\s+/g, " ").trim();
    assert.ok(String(out.gardenHintNow).includes("Сейчас меню из «Сады»"));
    await createViaDialog(page, "Школы", ["Школа №2 (e2e)"], ["Детский сад №1 (e2e)"]);
    out.movingText = ((await dialog.textContent()) ?? "").replace(/\s+/g, " ");
    assert.ok(String(out.movingText).includes(`1 объект перейдёт из «${OLD_MASTER_NAME}»`));
    assert.ok(String(out.movingText).includes("Меню и сырьё из кабинета получат 1 объект."));
    await page.screenshot({ path: `${SHOTS}/4-dialog-schools-moving.png` });
    await dialog.getByTestId("create-master-cabinet-submit").click();
    await page.getByText("Мастер-кабинет «Школы» создан").waitFor({ timeout: 30000 });
    await dialog.waitFor({ state: "detached", timeout: 30000 });
    await page.waitForTimeout(1500);
    await openDesktopMenu(page);
    await page.locator('[data-testid="profile-master-cabinet"]', { hasText: "Школы" }).waitFor({ timeout: 30000 });
    out.menuAfterSecond = await cabinetRows(page, rowsSel);
    assert.deepEqual(out.menuAfterSecond, [OLD_MASTER_NAME, "Сады", "Школы", "Создать мастер-кабинет"]);
    await page.screenshot({ path: `${SHOTS}/5-menu-after-second.png` });
    await page.keyboard.press("Escape");

    // 5. База: у каждого нового кабинета свой код, объекты подключены к своему кабинету.
    const cabinets = await db.organization.findMany({
      where: { accountId: fx.accountId, kind: "directory" },
      select: { id: true, name: true, serviceCode: true, linkedServiceCode: true, disabledJournalCodes: true },
      orderBy: { createdAt: "asc" },
    });
    const gardens = cabinets.find((c) => c.name === "Сады");
    const schools = cabinets.find((c) => c.name === "Школы");
    assert.ok(gardens?.serviceCode && schools?.serviceCode && gardens.serviceCode !== schools.serviceCode);
    assert.equal(gardens.linkedServiceCode, null);
    assert.ok(gardens.disabledJournalCodes.length > 10, "журналы в кабинете выключены");
    const membership = await db.organizationMember.findMany({
      where: { userId: fx.ownerId, organizationId: { in: [gardens.id, schools.id] } },
      select: { role: true },
    });
    assert.deepEqual(membership.map((m) => m.role), ["owner", "owner"]);
    out.poolMasters = {
      garden: await findPoolMasterOrgId(fx.gardenId),
      school: await findPoolMasterOrgId(fx.schoolId),
      alpha: await findPoolMasterOrgId(ORG_A),
    };
    assert.deepEqual(out.poolMasters, { garden: gardens.id, school: schools.id, alpha: fx.oldMasterId });
    out.cabinets = cabinets.map((c) => ({ name: c.name, ownCode: Boolean(c.serviceCode), linked: c.linkedServiceCode }));

    // 6. Открыть «Сады» из меню — оболочка /master с одним объектом.
    await openDesktopMenu(page);
    await page.locator('[data-testid="profile-master-cabinet"]', { hasText: "Сады" }).click();
    await page.waitForURL(/\/master/, { timeout: 120000 });
    await page.getByText("Сады").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/6-master-gardens.png` });
    out.masterUrl = new URL(page.url()).pathname;
    // Обратно в обычную организацию — для следующих шагов.
    await page.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: ORG_A } });
    await ctx.close();

    // 7. Телефон: лист профиля — кабинеты и «Создать мастер-кабинет» последней строкой.
    {
      const phone = await newPage(browser, PHONE_UA, 390, 844);
      await phone.page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
      await dismissOverlays(phone.page);
      await phone.page.getByRole("button", { name: "Профиль" }).first().click();
      await phone.page.getByTestId("profile-create-master-cabinet").last().waitFor({ state: "visible", timeout: 30000 });
      out.phoneRows = await cabinetRows(phone.page, rowsSel);
      await phone.page.screenshot({ path: `${SHOTS}/7-phone-sheet.png` });
      await phone.page.getByTestId("profile-create-master-cabinet").last().click();
      await phone.page.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 30000 });
      await phone.page.screenshot({ path: `${SHOTS}/8-phone-dialog.png` });
      out.phoneNoHScroll = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      await phone.ctx.close();
    }

    // 8. Мини-приложение: карточка «Кабинет» с кнопкой создания.
    {
      const app = await newPage(browser, APP_UA("1.0.0"), 390, 844);
      await app.page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
      await app.page.getByTestId("mini-create-master-cabinet").waitFor({ timeout: 60000 });
      out.miniCabinets = await app.page.getByTestId("mini-master-cabinet").allTextContents();
      await app.page.getByTestId("mini-create-master-cabinet").scrollIntoViewIfNeeded();
      await app.page.screenshot({ path: `${SHOTS}/9-mini-card.png` });
      await app.page.getByTestId("mini-create-master-cabinet").click();
      await app.page.getByTestId("create-master-cabinet-object").first().waitFor({ timeout: 30000 });
      await app.page.screenshot({ path: `${SHOTS}/10-mini-dialog.png` });
      await app.ctx.close();
    }

    // 9. API: проверки ввода и чужие объекты; повар — 403.
    {
      const apiCtx = await browser.newContext();
      await signIn(apiCtx, USERS.managerA);
      const noName = await apiCtx.request.post(`${BASE}/api/settings/master-cabinets`, { data: { name: " ", organizationIds: [] } });
      const foreign = await db.organization.findFirst({ where: { accountId: { not: fx.accountId }, kind: "regular" }, select: { id: true } });
      const alien = await apiCtx.request.post(`${BASE}/api/settings/master-cabinets`, {
        data: { name: "Чужой", organizationIds: [foreign?.id ?? "nope"] },
      });
      out.api = { noName: noName.status(), alien: alien.status(), alienBody: await alien.json() };
      assert.equal(noName.status(), 400);
      assert.equal(alien.status(), 400);
      await apiCtx.close();
      const cookCtx = await browser.newContext();
      await signIn(cookCtx, USERS.cookA);
      const cookGet = await cookCtx.request.get(`${BASE}/api/settings/master-cabinets`);
      const cookOrgs = await (await cookCtx.request.get(`${BASE}/api/organizations`)).json();
      out.cook = { get: cookGet.status(), canCreateMasterCabinet: cookOrgs.canCreateMasterCabinet };
      assert.equal(cookGet.status(), 403);
      assert.equal(cookOrgs.canCreateMasterCabinet, false);
      await cookCtx.close();
    }
    out.ok = true;
  } catch (error) {
    out.ok = false;
    if (current && !current.isClosed()) {
      out.failUrl = current.url();
      await current.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
    }
    out.error = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    throw error;
  } finally {
    await browser.close();
    await cleanup(fx).catch((error) => {
      out.cleanupError = String(error);
    });
    writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  }
}

main().catch(() => process.exit(1));
