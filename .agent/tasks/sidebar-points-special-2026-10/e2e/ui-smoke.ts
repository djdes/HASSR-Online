/**
 * UI-смоук задачи 2 на dev-сервере :3021 и e2e-базе (НЕ прод).
 * Сначала seed-ui.ts, потом:
 *   npx tsx .agent/tasks/sidebar-points-special-2026-10/e2e/ui-smoke.ts
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { db } from "@/lib/db";

if (!/localhost:5432\/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("Only the e2e database is allowed");

const BASE = "http://localhost:3021";
const DIR = ".agent/tasks/sidebar-points-special-2026-10/e2e";
const seed = JSON.parse(readFileSync(`${DIR}/seed-ui.json`, "utf8")) as {
  email: string;
  password: string;
  points: { a: string; b: string; c: string };
  users: Record<"manager" | "anna" | "boris" | "galina" | "vera", string>;
};
const steps: Array<Record<string, unknown>> = [];
const step = (name: string, data: Record<string, unknown> = {}) => {
  steps.push({ step: name, ...data });
  console.log("✔", name, JSON.stringify(data));
};
const pointsOf = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id }, select: { buildingIds: true, primaryBuildingId: true } }));

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
}

async function goto(page: Page, href: string) {
  await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await settle(page);
}

async function openEdit(page: Page, name: string) {
  const row = page.locator("label").filter({ hasText: name }).first();
  if (!(await row.isVisible().catch(() => false))) {
    // Должность «без должности» может быть свёрнута — раскрыть все группы.
    for (const header of await page.locator("button[aria-expanded='false']").all()) {
      await header.click().catch(() => {});
    }
  }
  // Dev-сервер дособирает код — первый клик до гидратации теряется.
  for (let attempt = 0; attempt < 4; attempt++) {
    await row.getByRole("button", { name: /Изменить|Редактировать/ }).first().click();
    if (await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false)) return;
  }
  await page.getByRole("dialog").waitFor({ state: "visible" });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: "C:/Users/Two/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
    args: ["--lang=ru-RU"],
  });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  try {
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: seed.email, password: seed.password },
      timeout: 600_000,
    });
    assert.ok(login.ok(), `login ${login.status()}`);

    // 1. Точка В: «Взять на замену» → Анна → «Взять на замену».
    await goto(page, `/settings/buildings/${seed.points.c}`);
    await page.locator("[data-point-take-substitute]").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    const candidates = await dialog.locator("[data-substitute-candidate]").evaluateAll((els) => els.map((el) => el.getAttribute("data-substitute-candidate")));
    assert.ok(candidates.includes(seed.users.anna) && candidates.includes(seed.users.boris));
    assert.ok(!candidates.includes(seed.users.vera) && !candidates.includes(seed.users.galina));
    step("candidates: people of other points only (no 'everywhere', no own staff)", { count: candidates.length });
    await dialog.locator(`[data-substitute-candidate="${seed.users.anna}"]`).click();
    const explanation = await dialog.locator("[data-assignment-explanation]").innerText();
    assert.match(explanation, /Вернётся на «Точка А» \d\d\.\d\d автоматически/);
    step("explanation line", { explanation });
    await page.screenshot({ path: `${DIR}/01-take-substitute-dialog.png` });
    await dialog.locator("[data-substitute-submit]").click();
    await dialog.waitFor({ state: "hidden", timeout: 180_000 });
    await page.locator("[data-substitute-badge]").first().waitFor({ state: "visible", timeout: 60_000 });
    const badge = await page.locator(`[data-point-staff="${seed.users.anna}"] [data-substitute-badge]`).innerText();
    assert.match(badge, /Замена до \d\d\.\d\d/);
    assert.deepEqual((await pointsOf(seed.users.anna)).buildingIds, [seed.points.c]);
    step("3 actions: Anna transferred to «Точка В», badge on the point page", { badge });
    await page.screenshot({ path: `${DIR}/02-point-page-badge.png`, fullPage: false });

    // 2. «Сотрудники»: ярлык рядом с Анной.
    await goto(page, "/settings/users");
    await page.locator("label").filter({ hasText: "Анна Петрова" }).first().waitFor({ state: "visible", timeout: 60_000 }).catch(async () => {
      for (const header of await page.locator("button[aria-expanded='false']").all()) await header.click().catch(() => {});
    });
    const staffBadge = page.locator("label").filter({ hasText: "Анна Петрова" }).first().locator("[data-substitute-badge]");
    await staffBadge.waitFor({ state: "visible", timeout: 30_000 });
    step("badge in the staff list", { text: await staffBadge.innerText() });
    await page.screenshot({ path: `${DIR}/03-staff-list-badge.png` });

    // 3. Борис на двух точках: звезда «основная» у Точки Б.
    await openEdit(page, "Борис Иванов");
    let edit = page.getByRole("dialog");
    await edit.locator(`[data-primary-star="${seed.points.b}"]`).click();
    await page.screenshot({ path: `${DIR}/04-primary-star.png` });
    await edit.getByRole("button", { name: "Сохранить" }).click();
    await edit.waitFor({ state: "hidden", timeout: 180_000 });
    await page.waitForTimeout(800);
    assert.equal((await pointsOf(seed.users.boris)).primaryBuildingId, seed.points.b);
    step("main point saved via the star", { primaryBuildingId: seed.points.b });

    // 4. Галина: «Временно на другую точку» → Точка Б, «Добавить эту точку», 3 дня.
    await openEdit(page, "Галина Смирнова");
    edit = page.getByRole("dialog");
    await edit.locator("[data-point-assignment-toggle]").click();
    await edit.locator(`[data-assignment-point="${seed.points.b}"]`).click();
    await edit.locator('[data-assignment-mode="extra"]').click();
    await edit.locator('[data-assignment-days="3"]').click();
    const extraLine = await edit.locator("[data-assignment-explanation]").innerText();
    assert.match(extraLine, /«Точка Б» уберётся у сотрудника \d\d\.\d\d автоматически/);
    await page.screenshot({ path: `${DIR}/05-edit-dialog-assign.png` });
    await edit.locator("[data-assignment-submit]").click();
    await edit.waitFor({ state: "hidden", timeout: 180_000 });
    await page.waitForTimeout(800);
    assert.deepEqual([...(await pointsOf(seed.users.galina)).buildingIds].sort(), [seed.points.b, seed.points.c].sort());
    step("staff card: Galina also at «Точка Б» for 3 days", { extraLine });

    // 5. Анна: «Завершить сейчас» через ConfirmDialog → вернулась на Точку А.
    await goto(page, "/settings/users");
    await openEdit(page, "Анна Петрова");
    edit = page.getByRole("dialog");
    const activeText = await edit.locator("[data-assignment-active]").innerText();
    await page.screenshot({ path: `${DIR}/06-edit-dialog-active.png` });
    await edit.locator("[data-assignment-end]").click();
    await page.getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByText("Завершить замену сейчас?").waitFor({ state: "hidden", timeout: 180_000 });
    await page.waitForTimeout(500);
    assert.deepEqual((await pointsOf(seed.users.anna)).buildingIds, [seed.points.a]);
    step("«Завершить сейчас» restores [Точка А]", { activeText });

    // 6. Вера «на всех точках»: объяснение вместо назначения.
    await goto(page, "/settings/users");
    await openEdit(page, "Вера Везде");
    edit = page.getByRole("dialog");
    await edit.locator("[data-point-assignment-toggle]").click();
    const blocked = await edit.locator("[data-assignment-blocked]").innerText();
    assert.match(blocked, /на всех точках/);
    step("'everywhere' employee sees why no assignment is needed", { blocked });
    await page.screenshot({ path: `${DIR}/07-everywhere-blocked.png` });

    // 7. Телефон: окно замены помещается.
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, `/settings/buildings/${seed.points.a}`);
    await page.locator("[data-point-take-substitute]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/08a-phone-point-staff.png` });
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.locator("[data-point-take-substitute]").click();
      if (await page.getByRole("dialog").waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false)) break;
    }
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(1_200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${DIR}/08-phone-dialog.png` });
    step("phone width: dialog without horizontal scroll");

    writeFileSync(`${DIR}/ui-smoke.json`, JSON.stringify({ ok: true, at: new Date().toISOString(), steps }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: `${DIR}/zz-failure.png` }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
