/**
 * A2 browser e2e for the master cabinet UI against the private worktree DB
 * (wesetup_wt_a) and the local dev server (http://localhost:3031).
 *
 * Flow: kitchens X and Y (Y linked to X's code, Y has its own dish) →
 * X owner creates the cabinet in /settings/master-cabinet → back-office
 * accepts the invite in the browser → /master: xlsx menu (3 dishes), pasted
 * raw materials (3 items) → X and Y documents get the lists → remove one dish
 * → Y loses only it → master session can't leave /master. Screenshots
 * 1440 / 390 into ../shots. Throw-away orgs are deleted at the end.
 *
 * Run: npx tsx .agent/tasks/master-cabinet-2026-09/e2e/a2-browser-e2e.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { chromium, type BrowserContext, type Page } from "playwright-core";

import { db } from "@/lib/db";
import { ensureServiceCode, linkDishPool } from "@/lib/dish-pool";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";

const BASE = process.env.E2E_BASE ?? "http://localhost:3031";
const TASK_DIR = path.resolve(__dirname, "..");
const SHOTS = path.join(TASK_DIR, "shots");
const TMP = path.join(__dirname, "tmp");
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const stamp = Date.now().toString(36);
const password = "Test12345!";

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
async function check(name: string, fn: () => void | Promise<void>, detail?: unknown) {
  try {
    await fn();
    results.push({ check: name, ok: true, detail });
    console.log("PASS", name);
  } catch (err) {
    results.push({ check: name, ok: false, detail: String(err) });
    console.log("FAIL", name, String(err));
  }
}

const created: string[] = [];
const consoleErrors: string[] = [];
function cfg(doc: { config: unknown }) {
  return (doc.config ?? {}) as Record<string, unknown>;
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

async function lastToast(page: Page): Promise<string> {
  const toast = page.locator("[data-sonner-toast]").first();
  await toast.waitFor({ state: "visible", timeout: 30_000 });
  return (await toast.innerText()).trim();
}

function waitForPut(page: Page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/api/master/directory") && response.request().method() === "PUT",
    { timeout: 120_000 }
  );
}

async function apiLogin(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  assert.equal(res.status(), 200, `login ${email}: ${res.status()}`);
}

async function main() {
  const [fpTemplate, prTemplate] = await Promise.all([
    db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" } }),
    db.journalTemplate.findFirstOrThrow({ where: { code: "perishable_rejection" } }),
  ]);
  const passwordHash = await bcrypt.hash(password, 10);

  async function makeOrg(label: string) {
    const org = await db.organization.create({ data: { name: `Столовая ${label} ${stamp}`, type: "cafe" } });
    created.push(org.id);
    const owner = await db.user.create({
      data: {
        name: `Руководитель ${label}`,
        email: `e2e-a2-${label.toLowerCase()}-${stamp}@example.test`,
        passwordHash,
        role: "manager",
        organizationId: org.id,
        isActive: true,
        // No legal-update / what's-new modals over the page under test.
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const fp = await db.journalDocument.create({
      data: {
        templateId: fpTemplate.id,
        organizationId: org.id,
        title: "БЖГП",
        dateFrom: from,
        dateTo: to,
        config: { rows: [], itemsCatalog: [`Своё блюдо ${label}`], productLists: [] },
      },
    });
    const pr = await db.journalDocument.create({
      data: {
        templateId: prTemplate.id,
        organizationId: org.id,
        title: "Скоропорт",
        dateFrom: from,
        dateTo: to,
        config: {
          rows: [],
          productLists: [{ id: "l1", name: "Изделия", items: [`Своё сырьё ${label}`] }],
          suppliers: [`Свой поставщик ${label}`],
          manufacturers: [],
        },
      },
    });
    return { org, owner, fp, pr };
  }

  const X = await makeOrg("X");
  const Y = await makeOrg("Y");
  const codeX = await ensureServiceCode(X.org.id);
  const linked = await linkDishPool(Y.org.id, codeX);
  assert.ok(!("error" in linked), "Y linked to X");

  // Menu file: 3 dishes with a header row.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Наименование"], ["Борщ"], ["Плов"], ["Компот"]]), "Меню");
  const menuPath = path.join(TMP, "menu.xlsx");
  XLSX.writeFile(wb, menuPath);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-gl=swiftshader", "--no-sandbox"],
  });
  const rawNewContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await rawNewContext(options);
    // First dev-server compile of a route can take a while.
    ctx.setDefaultTimeout(120_000);
    ctx.setDefaultNavigationTimeout(180_000);
    ctx.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text().slice(0, 2500)}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400) consoleErrors.push(`${page.url()} :: HTTP ${response.status()} ${response.url()}`);
      });
      page.on("pageerror", (err) => consoleErrors.push(`${page.url()} :: pageerror ${String(err).slice(0, 400)}`));
    });
    return ctx;
  };
  try {
    /* ───────────── X owner: settings hub + create the cabinet ───────────── */
    const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    await apiLogin(ownerCtx, X.owner.email);
    const owner = await ownerCtx.newPage();
    await owner.goto(`${BASE}/settings`, { waitUntil: "load" });
    const hubCard = owner.locator('a[href="/settings/master-cabinet"]');
    await check("settings hub has the «Мастер-кабинет справочников» card", async () => {
      await hubCard.waitFor({ state: "visible", timeout: 20_000 });
      assert.match(await hubCard.innerText(), /Мастер-кабинет справочников/);
    });
    await hubCard.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: path.join(SHOTS, "desktop-1440-settings-hub-card.png") });

    await owner.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load" });
    await owner.getByTestId("master-pool-code").waitFor();
    await check("settings page shows pool code and both kitchens", async () => {
      assert.equal((await owner.getByTestId("master-pool-code").innerText()).trim(), codeX);
      const body = await owner.locator("main").innerText();
      assert.ok(body.includes(X.org.name) && body.includes(Y.org.name), "pool orgs listed");
    });
    await shot(owner, "desktop-1440-settings-empty");

    const masterEmail = `e2e-a2-master-${stamp}@example.test`;
    await owner.getByTestId("master-invite-name").fill("Бэк Офисова Мария");
    await owner.getByTestId("master-invite-email").fill(masterEmail);
    await owner.getByTestId("master-invite-submit").click();
    const confirm = owner.getByRole("dialog");
    await confirm.waitFor();
    await shot(owner, "desktop-1440-settings-confirm", false);
    await confirm.getByRole("button", { name: "Создать и пригласить" }).click();
    await owner.getByTestId("master-invite-result").waitFor({ timeout: 30_000 });
    const inviteUrl = await owner.getByTestId("master-invite-url").inputValue();
    const resultText = await owner.getByTestId("master-invite-result").innerText();
    await check(
      "AC-A1: cabinet created from settings UI, invite link shown",
      async () => {
        assert.match(inviteUrl, /\/invite\/[A-Za-z0-9_-]+$/);
        assert.match(resultText, /Приглашение отправлено на|не ушло/);
        const masterOrg = await db.organization.findFirstOrThrow({
          where: { kind: "directory", linkedServiceCode: codeX },
        });
        created.push(masterOrg.id);
        assert.match(await owner.getByTestId("master-cabinet-name").innerText(), /Мастер-кабинет/);
      },
      { inviteUrl: inviteUrl.replace(/\/invite\/.+$/, "/invite/<token>"), resultText }
    );
    await shot(owner, "desktop-1440-settings-created");

    /* ───────────── back-office: accept invite in the browser ───────────── */
    const masterCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const master = await masterCtx.newPage();
    await master.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
    await master.locator("#password").fill(password);
    await master.locator("#confirm").fill(password);
    await master.locator('button[type="submit"]').click();
    await master.waitForURL(/\/master(\?|$)/, { timeout: 60_000 });
    await master.getByTestId("master-tab-menu").waitFor();
    await check("AC-A1/A2: invite link works and lands on /master", async () => {
      assert.match(master.url(), /\/master$/);
      assert.equal((await master.getByTestId("master-code").innerText()).trim(), codeX);
    });
    await shot(master, "desktop-1440-master-menu-empty");

    /* ───────────── menu from xlsx ───────────── */
    const chooser = master.waitForEvent("filechooser");
    await master.getByTestId("master-upload-dish").first().click();
    await (await chooser).setFiles(menuPath);
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const previewMenu = await master.getByTestId("master-preview-summary").innerText();
    await shot(master, "desktop-1440-master-preview-xlsx", false);
    await Promise.all([waitForPut(master), master.getByRole("button", { name: "Сохранить и разослать" }).click()]);
    const toastMenu = await lastToast(master);
    await check(
      "AC-A3: xlsx preview (+3) and save & distribute toast",
      () => {
        assert.match(previewMenu, /Добавится 3 · Уберётся 0 · Изменится 0 · Без изменений 0/);
        assert.match(toastMenu, /Готово: список обновлён в 2 объектах \(4 журнала\)/);
      },
      { previewMenu, toastMenu }
    );
    await master.getByTestId("master-list-dish").waitFor();
    await shot(master, "desktop-1440-master-menu-list");

    /* ───────────── raw materials pasted as text ───────────── */
    await master.getByTestId("master-tab-raw").click();
    await master.getByTestId("master-paste-product").first().click();
    await master.getByTestId("master-paste-text").fill("Молоко | ИП Иванов | Молокозавод\nКефир | ИП Иванов\nТворог");
    await master.getByRole("button", { name: "Показать изменения" }).click();
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const previewRaw = await master.getByTestId("master-preview-summary").innerText();
    await Promise.all([waitForPut(master), master.getByRole("button", { name: "Сохранить и разослать" }).click()]);
    await master.waitForTimeout(300);
    const toastRaw = await master.locator("[data-sonner-toast]").filter({ hasText: "Готово" }).first().innerText();
    await master.getByTestId("master-list-product").waitFor();
    await shot(master, "desktop-1440-master-raw-list");

    const [xFp, yFp, yPr, xPr] = await Promise.all([
      db.journalDocument.findUniqueOrThrow({ where: { id: X.fp.id } }),
      db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } }),
      db.journalDocument.findUniqueOrThrow({ where: { id: Y.pr.id } }),
      db.journalDocument.findUniqueOrThrow({ where: { id: X.pr.id } }),
    ]);
    await check(
      "AC-A3: menu is in active BЖГП documents of X and Y (+ suggestions)",
      async () => {
        assert.deepEqual(cfg(xFp).itemsCatalog, ["Своё блюдо X", "Борщ", "Плов", "Компот"]);
        assert.deepEqual(cfg(yFp).itemsCatalog, ["Своё блюдо Y", "Борщ", "Плов", "Компот"]);
        const sug = await listNameSuggestions(Y.org.id, "dish");
        for (const dish of ["Борщ", "Плов", "Компот"]) assert.ok(sug.values.includes(dish), `suggestion ${dish}`);
      },
      { x: cfg(xFp).itemsCatalog, y: cfg(yFp).itemsCatalog }
    );
    await check(
      "AC-A4: raw materials in perishable docs of X and Y (items, suppliers, manufacturers)",
      () => {
        assert.match(previewRaw, /Добавится 3/);
        assert.match(toastRaw, /Готово: список обновлён в 2 объектах/);
        const yLists = cfg(yPr).productLists as Array<{ items: string[] }>;
        const xLists = cfg(xPr).productLists as Array<{ items: string[] }>;
        assert.deepEqual(yLists[0].items, ["Своё сырьё Y", "Молоко", "Кефир", "Творог"]);
        assert.deepEqual(xLists[0].items, ["Своё сырьё X", "Молоко", "Кефир", "Творог"]);
        assert.deepEqual(cfg(yPr).suppliers, ["Свой поставщик Y", "ИП Иванов"]);
        assert.deepEqual(cfg(yPr).manufacturers, ["Молокозавод"]);
      },
      { previewRaw, toastRaw, yItems: (cfg(yPr).productLists as Array<{ items: string[] }>)[0].items }
    );

    /* ───────────── remove one dish via «Вставить списком» ───────────── */
    await master.getByTestId("master-tab-menu").click();
    await master.getByTestId("master-paste-dish").first().click();
    // Меню вводится таблицей «Наименование | Выход | Время» (2026-09-24): удаляем строку «Плов».
    await master.getByTestId("master-menu-table-dialog").waitFor();
    const prefilled = (
      await Promise.all([0, 1, 2].map((i) => master.getByTestId(`menu-name-${i}`).inputValue()))
    ).join("\n");
    await master.getByRole("button", { name: "Удалить строку 2" }).click();
    await master.getByTestId("master-menu-table-submit").click();
    await master.getByTestId("master-preview").waitFor({ timeout: 30_000 });
    const previewRemove = await master.getByTestId("master-preview-summary").innerText();
    await shot(master, "desktop-1440-master-preview-remove", false);
    const [putRemove] = await Promise.all([
      waitForPut(master),
      master.getByRole("button", { name: "Сохранить и разослать" }).click(),
    ]);
    const putRemoveBody = (await putRemove.json()) as Record<string, unknown>;
    console.log("PUT remove", putRemoveBody);
    const [yFp2, xFp2] = await Promise.all([
      db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } }),
      db.journalDocument.findUniqueOrThrow({ where: { id: X.fp.id } }),
    ]);
    await check(
      "AC-A5: removing one dish removes only it; local dish of Y stays",
      () => {
        assert.equal(prefilled, "Борщ\nПлов\nКомпот");
        assert.match(previewRemove, /Добавится 0 · Уберётся 1 · Изменится 0 · Без изменений 2/);
        assert.deepEqual(cfg(yFp2).itemsCatalog, ["Своё блюдо Y", "Борщ", "Компот"]);
        assert.deepEqual(cfg(xFp2).itemsCatalog, ["Своё блюдо X", "Борщ", "Компот"]);
      },
      { previewRemove, y: cfg(yFp2).itemsCatalog }
    );

    const seeded = await prefillResponsiblesForNewDocument({ organizationId: Y.org.id, journalCode: "finished_product" });
    await check("AC-A6: new BЖГП document of Y is seeded with the master menu", () => {
      assert.deepEqual(seeded.config.itemsCatalog, ["Борщ", "Компот"]);
    });

    /* ───────────── master session stays inside /master ───────────── */
    const dash = await master.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    const afterDash = master.url();
    const journals = await master.goto(`${BASE}/journals`, { waitUntil: "domcontentloaded" });
    const afterJournals = master.url();
    const staff = await masterCtx.request.get(`${BASE}/api/staff`, { maxRedirects: 0 });
    const settingsApi = await masterCtx.request.get(`${BASE}/api/settings/master-cabinet`, { maxRedirects: 0 });
    await check(
      "AC-A2: /dashboard and /journals → /master, /api/staff → 403",
      () => {
        assert.match(afterDash, /\/master$/);
        assert.match(afterJournals, /\/master$/);
        assert.equal(staff.status(), 403);
        assert.equal(settingsApi.status(), 403);
      },
      { dash: dash?.status(), afterDash, journals: journals?.status(), afterJournals, staff: staff.status() }
    );

    await master.goto(`${BASE}/master?tab=objects`, { waitUntil: "load" });
    await check("objects tab lists X and Y", async () => {
      const text = await master.getByTestId("master-objects-list").innerText();
      assert.ok(text.includes(X.org.name) && text.includes(Y.org.name));
    });
    await shot(master, "desktop-1440-master-objects");

    /* ───────────── mobile 390 ───────────── */
    const storage = await masterCtx.storageState();
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "ru-RU",
      storageState: storage,
    });
    const mobile = await mobileCtx.newPage();
    const mobileWidths: Record<string, unknown> = {};
    for (const [tab, name] of [
      ["menu", "mobile-390-master-menu"],
      ["raw", "mobile-390-master-raw"],
      ["objects", "mobile-390-master-objects"],
    ] as const) {
      await mobile.goto(`${BASE}/master${tab === "menu" ? "" : `?tab=${tab}`}`, { waitUntil: "load" });
      await mobile.getByTestId(`master-tab-${tab}`).waitFor();
      mobileWidths[name] = await noHorizontalScroll(mobile);
      await shot(mobile, name);
    }
    await mobile.goto(`${BASE}/master`, { waitUntil: "load" });
    await mobile.getByTestId("master-paste-dish").first().click();
    await mobile.getByTestId("master-menu-table-dialog").waitFor();
    await mobile.getByTestId("menu-name-2").fill("Солянка");
    await mobile.getByTestId("master-menu-table-submit").click();
    await mobile.getByTestId("master-preview").waitFor();
    mobileWidths["mobile-390-master-preview"] = await noHorizontalScroll(mobile);
    await shot(mobile, "mobile-390-master-preview", false);
    await mobile.keyboard.press("Escape");

    const ownerMobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "ru-RU",
      storageState: await ownerCtx.storageState(),
    });
    const ownerMobile = await ownerMobileCtx.newPage();
    await ownerMobile.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load" });
    await ownerMobile.getByTestId("master-cabinet-name").waitFor();
    mobileWidths["mobile-390-settings"] = await noHorizontalScroll(ownerMobile);
    await shot(ownerMobile, "mobile-390-settings");
    await check(
      "390px: no horizontal page scroll on /master tabs, preview and settings",
      () => {
        for (const [name, value] of Object.entries(mobileWidths)) {
          const { scrollWidth, innerWidth } = value as { scrollWidth: number; innerWidth: number };
          assert.ok(scrollWidth <= innerWidth, `${name}: ${scrollWidth} > ${innerWidth}`);
        }
      },
      mobileWidths
    );

    /* ───────────── owner opens the cabinet and returns ───────────── */
    await owner.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "load" });
    await owner.getByTestId("master-open").click();
    await owner.waitForURL(/\/master$/, { timeout: 60_000 });
    await owner.getByTestId("master-tab-menu").waitFor();
    await owner.getByRole("button", { name: "Профиль" }).click();
    const returnItem = owner.getByText(`Вернуться в «${X.org.name}»`);
    await returnItem.waitFor();
    await shot(owner, "desktop-1440-master-owner-menu", false);
    await returnItem.click();
    await owner.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await check("owner: «Открыть мастер-кабинет» → /master, «Вернуться в …» → /dashboard", () => {
      assert.match(owner.url(), /\/dashboard/);
    });
    const ownerMasterAgain = await owner.goto(`${BASE}/master`, { waitUntil: "domcontentloaded" });
    await check("regular session: /master → /dashboard", () => {
      assert.match(owner.url(), /\/dashboard/);
    }, { status: ownerMasterAgain?.status() });
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ check: "script", ok: false, detail: String(err) });
  })
  .finally(async () => {
    await db.organization.deleteMany({ where: { id: { in: created } } }).catch((err) => console.error("cleanup", err));
    fs.rmSync(TMP, { recursive: true, force: true });
    results.push({ check: "browser console errors (info)", ok: true, detail: consoleErrors });
    const failed = results.filter((r) => !r.ok);
    const summary = { passed: results.length - failed.length, failed: failed.length, results };
    fs.writeFileSync(path.join(__dirname, "a2-results.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    await db.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
