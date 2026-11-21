// Live check of series E through the browser (local `next dev` on port 3000 with the repo .env loaded).
// 1. «Сеть»: period «Сегодня / 7 дней / 30 дней», Excel and PDF export (content checked).
// 2. Network managers: appoint in the UI, the manager's view and rights, owner-only refusals, removal.
// 3. «Собрать с организаций аккаунта и оплатить» on the subscription page: absent when the account is
//    short, confirmation with sources, payment, balances and plan before/after.
// 4. «Сеть» in the mini app (/mini/network, /mini/sections) for the owner, the manager and a non-manager.
//
// Run: cd <repo> && set -a && . ./.env && set +a && node .agent/tasks/multi-org-followups-e-2026-11-21/raw/series-e-live.cjs
// (2026-11-21 the dev server's old Turbopack cache in .next/dev answered 404 on every route group and API route;
// the run used a fresh `NEXT_DIST_DIR=.next-elive npx next dev -p 3000` — Next adds that dir to tsconfig.json, restore it.)
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT = __dirname;
const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "series-e-live-"));
const stamp = Date.now().toString(36);
const seed = String(Date.now()).slice(-6);
const log = [];
let passed = 0;
let failed = 0;
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const check = (label, ok, details) => {
  if (ok) passed += 1;
  else failed += 1;
  const line = `${ok ? "PASS" : "FAIL"}: ${label}${details !== undefined ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
function inn10(prefix9) {
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = prefix9.split("").reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  return prefix9 + String((sum % 11) % 10);
}
const flat = (text) => String(text ?? "").replace(/\s*\n+\s*/g, " | ").replace(/\s+/g, " ").trim();
const digits = (text) => Number(String(text ?? "").replace(/[^\d]/g, "") || "NaN");

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
      return { status: res.status, json };
    },
    { method, url, body },
  );
}
async function newPage(browser) {
  return (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU", acceptDownloads: true })).newPage();
}
async function register(browser, email) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 300000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 300000 });
  return page;
}
async function login(browser, email, password) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 300000 });
  await page.fill("#email", email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 300000 });
  return page;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
// The mini app keeps polling and registers a service worker, so it never reaches «networkidle»; a refused
// mini page also moves on by client-side redirects (/mini?denied=… → /dashboard?denied=… → /dashboard).
// Mini pages: wait for the commit and let the page settle.
const open = async (page, url) => {
  const waitUntil = url.startsWith("/mini") ? "commit" : "networkidle";
  const response = await page.goto(`${BASE}${url}`, { waitUntil, timeout: 300000 });
  if (waitUntil === "commit") await page.waitForTimeout(6000);
  await page.waitForTimeout(1200);
  return response ? response.status() : null;
};
const switchTo = async (page, id) => {
  const res = await api(page, "POST", "/api/me/active-organization", { organizationId: id });
  await page.reload({ waitUntil: "networkidle", timeout: 300000 });
  return res.status;
};
/** Visiting /mini/* sets the «mini shell» cookie (ws-shell); drop it so later site pages render as on the site. */
const leaveMini = (page) => page.context().clearCookies({ name: "ws-shell" });
const shot = (page, name, options = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 70, ...options });
const balances = (ids) =>
  Object.fromEntries(sql(`select name, "balanceRub" from "Organization" where id in (${ids.map((id) => `'${id}'`).join(",")}) order by name`).split("\n").map((row) => row.split("|")).map(([name, rub]) => [name, Number(rub)]));

/** Balance exactly `target` through ROOT «корректировка баланса» (ledger row + audit), like the app's own top-up path. */
async function setBalance(root, orgId, target) {
  const current = Number(sql(`select "balanceRub" from "Organization" where id='${orgId}'`));
  const delta = target - current;
  if (delta === 0) return 200;
  const res = await api(root, "POST", `/api/root/organizations/${orgId}/balance`, { amount: delta, comment: `series E live ${stamp}`, method: "adjust" });
  return res.status;
}

async function download(page, selector, name) {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }), page.locator(selector).first().click()]);
  const target = path.join(DOWNLOADS, name);
  await file.saveAs(target);
  return { path: target, suggested: file.suggestedFilename(), bytes: fs.statSync(target).size };
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    /* ───────────────────────── setup ───────────────────────── */
    const root = await login(browser, process.env.ROOT_EMAIL || "root@local.test", process.env.ROOT_PASSWORD);
    const ownerEmail = `nete-${stamp}@example.com`;
    const owner = await register(browser, ownerEmail);
    const nameA = `Сеть Обед ${seed}`;
    const nameB = `Обед на Арбате ${seed}`;
    const complete = await api(owner, "POST", "/api/profile/complete", {
      organizationName: nameA, phone: `+7916${seed.slice(0, 6)}2`, sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: inn10(`58${seed}0`.slice(0, 9)), name: "Владелец Сети", newPassword: "Passw0rd-1", asEmployee: false,
    });
    say("owner profile complete", complete.status);
    const orgA = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    say("org B created", (await api(owner, "POST", "/api/organizations", { name: nameB, sphere: "restaurant" })).status);
    const orgB = (await api(owner, "GET", "/api/organizations")).json.organizations.find((o) => o.name === nameB);
    const ownerId = sql(`select id from "User" where email='${ownerEmail}'`);
    const accountId = sql(`select "accountId" from "Organization" where id='${orgA.id}'`);
    say("ids", { owner: ownerId, account: accountId, A: orgA.id, B: orgB.id });
    // The period counts only days the organization existed: both «opened» 9 days ago.
    sql(`update "Organization" set "createdAt"=now()-interval '9 days' where id in ('${orgA.id}','${orgB.id}')`);
    await switchTo(owner, orgA.id);

    /* ───────────────────── 1. «Сеть»: period and export ───────────────────── */
    say("owner /settings/network status", await open(owner, "/settings/network"));
    await owner.locator("[data-network-summary]").waitFor({ timeout: 120000 });
    check("period bar «Сегодня / 7 дней / 30 дней» on «Сеть»", (await owner.locator("[data-network-period]").count()) === 3,
      flat(await owner.locator("[data-network-period-bar]").innerText()));
    say("today totals", flat(await owner.locator("[data-network-totals]").innerText()));
    check("«Сегодня» is the selected period by default", (await owner.locator('[data-network-period="today"][aria-current="page"]').count()) === 1);

    await owner.locator('[data-network-period="7"]').click();
    await owner.waitForURL(/period=7/, { timeout: 120000 });
    await owner.locator('[data-network-period-view="7"]').waitFor({ timeout: 120000 });
    const recordsOf = async (orgId) => digits(await owner.locator(`[data-network-period-org="${orgId}"] td`).nth(2).innerText());
    const before = { A: await recordsOf(orgA.id), B: await recordsOf(orgB.id) };
    say("7 days: records before (A, B)", before);
    // Three journal entries of A inside the 7 days (2 and 3 days ago) — the period count must grow by exactly 3.
    const templateId = sql(`select id from "JournalTemplate" where "isActive" order by code limit 1`);
    for (const [i, ago] of [[1, 2], [2, 3], [3, 3]]) {
      sql(`insert into "JournalEntry" (id, "templateId", "organizationId", "filledById", data, status, "createdAt", "updatedAt") values ('elive${stamp}${i}', '${templateId}', '${orgA.id}', '${ownerId}', '{}'::jsonb, 'submitted', now()-interval '${ago} days', now())`);
    }
    await owner.reload({ waitUntil: "networkidle", timeout: 300000 });
    await owner.locator('[data-network-period-view="7"]').waitFor({ timeout: 120000 });
    const after = { A: await recordsOf(orgA.id), B: await recordsOf(orgB.id) };
    say("7 days: records after 3 entries in A", after);
    check("7 days: A's records grew by exactly the 3 entries, B unchanged", after.A - before.A === 3 && after.B === before.B, { before, after });
    say("7 days: range note", flat(await owner.locator('[data-network-period-view="7"] > p').first().innerText()));
    say("7 days: totals", flat(await owner.locator("[data-network-period-totals]").innerText()));
    for (const org of [orgA, orgB]) say(`7 days: row ${org.name}`, flat(await owner.locator(`[data-network-period-org="${org.id}"]`).innerText()));
    check("7 days: both organizations listed with «N из 7»",
      (await owner.locator("[data-network-period-org]").count()) === 2 && /из 7/.test(await owner.locator(`[data-network-period-org="${orgB.id}"]`).innerText()));
    await shot(owner, "e01-network-7-days.jpg", { fullPage: true });

    // Exports of the 7-day view through the page's own links.
    const xlsx7 = await download(owner, '[data-network-export="xlsx"]', "network-7d.xlsx");
    say("7 days xlsx", { file: xlsx7.suggested, bytes: xlsx7.bytes });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsx7.path);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow((row) => rows.push((row.values || []).slice(1).map((v) => (v && typeof v === "object" && "result" in v ? v.result : v)).join(" | ")));
    say("7 days xlsx sheet", sheet.name);
    rows.forEach((row, i) => say(`7 days xlsx row ${i + 1}`, row));
    check("Excel (7 days) opens and lists both organizations", rows.some((r) => r.includes(nameA)) && rows.some((r) => r.includes(nameB)));
    const rowA = rows.find((r) => r.includes(nameA)) || "";
    check("Excel (7 days) row of A carries the same records as the page", rowA.split(" | ").map((c) => c.trim()).includes(String(after.A)), rowA);

    const pdf7 = await download(owner, '[data-network-export="pdf"]', "network-7d.pdf");
    const pdfBytes = fs.readFileSync(pdf7.path);
    const pdfHead = pdfBytes.subarray(0, 5).toString("latin1");
    const pdfPages = (pdfBytes.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    say("7 days pdf", { file: pdf7.suggested, bytes: pdf7.bytes, head: pdfHead, pages: pdfPages });
    check("PDF (7 days) starts with %PDF and has at least one page", pdfHead === "%PDF-" && pdfPages >= 1, { head: pdfHead, pages: pdfPages, bytes: pdf7.bytes });

    await owner.locator('[data-network-period="30"]').click();
    await owner.waitForURL(/period=30/, { timeout: 120000 });
    await owner.locator('[data-network-period-view="30"]').waitFor({ timeout: 120000 });
    say("30 days: totals", flat(await owner.locator("[data-network-period-totals]").innerText()));
    check("30 days: both organizations listed with «N из 9» (days since they opened)",
      (await owner.locator("[data-network-period-org]").count()) === 2 && /из 9/.test(await owner.locator(`[data-network-period-org="${orgA.id}"]`).innerText()),
      flat(await owner.locator(`[data-network-period-org="${orgA.id}"]`).innerText()));
    await owner.locator('[data-network-period="today"]').click();
    await owner.waitForURL((url) => url.pathname === "/settings/network" && !url.search.includes("period"), { timeout: 120000 });
    await owner.locator("[data-network-totals]").waitFor({ timeout: 120000 });
    check("back to «Сегодня»: the today table is shown again", (await owner.locator("[data-network-org]").count()) === 2);
    const xlsxToday = await download(owner, '[data-network-export="xlsx"]', "network-today.xlsx");
    const wbToday = new ExcelJS.Workbook();
    await wbToday.xlsx.readFile(xlsxToday.path);
    const todayRows = [];
    wbToday.worksheets[0].eachRow((row) => todayRows.push((row.values || []).slice(1).join(" | ")));
    say("today xlsx", { file: xlsxToday.suggested, bytes: xlsxToday.bytes, rows: todayRows.length });
    todayRows.forEach((row, i) => say(`today xlsx row ${i + 1}`, row));
    check("Excel (today) lists both organizations", todayRows.some((r) => r.includes(nameA)) && todayRows.some((r) => r.includes(nameB)));

    /* ───────────────────── 2. Network managers ───────────────────── */
    // A manager of B with full access: a «management» position, staff card, login and password.
    await switchTo(owner, orgB.id);
    const position = await api(owner, "POST", "/api/positions", { name: "Управляющий рестораном", categoryKey: "management" });
    const positionId = position.json?.position?.id
      || sql(`select id from "JobPosition" where "organizationId"='${orgB.id}' and "categoryKey"='management' order by "createdAt" limit 1`);
    say("management position in B", { status: position.status, id: positionId });
    const staff = await api(owner, "POST", "/api/staff", { jobPositionId: positionId, fullName: "Петров Пётр Управляющий" });
    const managerId = staff.json?.user?.id;
    say("staff card in B", { status: staff.status, id: managerId });
    const managerPassword = "Passw0rd-2";
    const credentials = await api(owner, "POST", `/api/staff/${managerId}/credentials`, { loginSuffix: `mgr${seed}`, password: managerPassword });
    const managerLogin = credentials.json?.login;
    say("manager credentials", { status: credentials.status, login: managerLogin, role: sql(`select role from "User" where id='${managerId}'`) });
    await switchTo(owner, orgA.id);

    await open(owner, "/settings/network");
    const section = owner.locator("[data-network-managers]");
    await section.waitFor({ timeout: 120000 });
    say("managers section before", flat(await section.innerText()));
    await owner.locator("[data-network-manager-pick]").click();
    const option = owner.locator('[role="option"]').filter({ hasText: "Петров" }).first();
    say("candidate option", flat(await option.innerText()));
    await option.click();
    await owner.locator("[data-network-manager-add]").click();
    await owner.locator(`[data-network-manager="${managerId}"]`).waitFor({ timeout: 60000 });
    await owner.waitForTimeout(800);
    say("managers section after appointment", flat(await section.innerText()));
    check("owner appoints the manager in the UI (row shown, DB row exists)",
      sql(`select count(*) from "AccountNetworkManager" where "accountId"='${accountId}' and "userId"='${managerId}'`) === "1");
    say("audit network_manager_added", sql(`select count(*) from "AuditLog" where action='account.network_manager_added' and "entityId"='${accountId}'`));
    await section.scrollIntoViewIfNeeded();
    await shot(owner, "e02-network-managers.jpg");

    const manager = await login(browser, managerLogin, managerPassword);
    say("manager landed on", manager.url());
    await open(manager, "/dashboard");
    // A staff login sees «Мы обновили условия» once — accept it so it does not cover the screenshots.
    const legal = tid(manager, "legal-update-modal");
    if (await legal.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
      await legal.locator('[data-testid="legal-consent"]').check();
      await tid(manager, "legal-update-accept").click();
      await legal.waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
      say("manager accepted the updated terms modal", true);
    }
    const navNetwork = await manager.locator('a[href="/settings/network"]').count();
    say("manager: links to «Сеть» on /dashboard", navNetwork);
    check("manager sees «Сеть» in the menu", navNetwork > 0);
    const mgrStatus = await open(manager, "/settings/network");
    say("manager /settings/network status", mgrStatus);
    await manager.locator("[data-network-summary]").waitFor({ timeout: 120000 });
    say("manager network page", flat(await manager.locator("[data-network-summary]").innerText()).slice(0, 600));
    const goA = await manager.locator(`[data-network-go="${orgA.id}"]`).count();
    const goB = await manager.locator(`[data-network-go="${orgB.id}"]`).count();
    say("manager «Перейти» buttons (A not a member, B home)", { A: goA, B: goB });
    check("manager opens «Сеть»: both organizations listed", (await manager.locator("[data-network-org]").count()) === 2);
    check("«Перейти» only where the manager is a member (B yes, A no)", goA === 0 && goB > 0, { A: goA, B: goB });
    check("manager does not see «Управляющие сетью»", (await manager.locator("[data-network-managers]").count()) === 0);
    await shot(manager, "e03-manager-network.jpg", { fullPage: true });

    const mgrState = await api(manager, "GET", "/api/settings/directory-exchange");
    say("manager GET exchange state", { status: mgrState.status, canManage: mgrState.json.canManage, isAccountOwner: mgrState.json.isAccountOwner, siblings: (mgrState.json.siblings || []).length });
    check("manager can open the exchange settings (API: canManage)", mgrState.status === 200 && mgrState.json.canManage === true);
    const mgrSave = await api(manager, "PUT", "/api/settings/directory-exchange", {
      members: [{ organizationId: orgA.id, kinds: ["products"] }, { organizationId: orgB.id, kinds: ["products"] }],
    });
    say("manager saves exchange A↔B", { status: mgrSave.status, running: mgrSave.json.running, error: mgrSave.json.error });
    check("manager configures the exchange (PUT 200)", mgrSave.status === 200);
    const mgrSync = await api(manager, "POST", "/api/settings/directory-exchange/sync");
    say("manager runs the exchange", { status: mgrSync.status, error: mgrSync.json.error });
    check("manager runs the exchange (sync 200)", mgrSync.status === 200);
    say("audit rows of the exchange with the manager's name", sql(`select count(*) from "AuditLog" where "userId"='${managerId}'`));

    // The exchange card in the UI (/settings/master-cabinet): owner as control, then the manager.
    await open(owner, "/settings/master-cabinet");
    const ownerCard = await tid(owner, "exchange-card").waitFor({ timeout: 60000 }).then(() => true, () => false);
    say("owner sees the exchange card on /settings/master-cabinet", ownerCard);
    await open(manager, "/settings/master-cabinet");
    const managerCard = await tid(manager, "exchange-card").waitFor({ timeout: 30000 }).then(() => true, () => false);
    say("manager /settings/master-cabinet text", flat(await manager.locator("main").first().innerText()).slice(0, 400));
    await shot(manager, "e04-manager-master-cabinet.jpg");
    check("manager sees the exchange card «Обмен справочниками» in the UI (/settings/master-cabinet)", managerCard,
      managerCard ? undefined : `owner sees it: ${ownerCard}; the card is rendered only when viewerIsOwner`);

    const mgrAppoint = await api(manager, "POST", "/api/settings/network/managers", { userId: ownerId });
    const mgrRemove = await api(manager, "DELETE", "/api/settings/network/managers", { userId: managerId });
    const mgrList = await api(manager, "GET", "/api/settings/network/managers");
    say("manager → managers API", { appoint: mgrAppoint.status, remove: mgrRemove.status, list: mgrList.status, error: mgrAppoint.json.error });
    check("manager cannot appoint/remove managers (403/404)", [403, 404].includes(mgrAppoint.status) && [403, 404].includes(mgrRemove.status) && [403, 404].includes(mgrList.status));
    const mgrPreview = await api(manager, "POST", "/api/settings/subscription/account-pay?preview=1", { plan: "standard", cycle: "year", points: 2 });
    const mgrPay = await api(manager, "POST", "/api/settings/subscription/account-pay", { plan: "standard", cycle: "year", points: 2, idempotencyKey: `mgr-${stamp}-key`, expectedPriceRub: 1 });
    say("manager → account-pay", { preview: mgrPreview.status, pay: mgrPay.status, code: mgrPay.json.code, error: mgrPay.json.error });
    check("manager cannot pay from the account balances (account-pay 403)", mgrPreview.status === 403 && mgrPay.status === 403);

    // Mini app as the manager (normal session cookie).
    const mgrMiniStatus = await open(manager, "/mini/network");
    say("manager /mini/network", { status: mgrMiniStatus, url: manager.url() });
    const mgrMini = await manager.locator("[data-mini-network]").waitFor({ timeout: 60000 }).then(() => true, () => false);
    const mgrMiniGo = { A: await manager.locator(`[data-mini-network-go="${orgA.id}"]`).count(), B: await manager.locator(`[data-mini-network-go="${orgB.id}"]`).count() };
    say("manager mini «Перейти»", mgrMiniGo);
    check("mini «Сеть» renders for the manager, «Перейти» only for B", mgrMini && mgrMiniGo.A === 0 && mgrMiniGo.B > 0, mgrMiniGo);
    await open(manager, "/mini/sections");
    const mgrMiniLink = await manager.locator('a[href="/mini/network"]').count();
    check("mini «Все разделы» has «Сеть» for the manager", mgrMiniLink > 0, mgrMiniLink);
    await leaveMini(manager);

    // Owner removes the manager in the UI.
    await open(owner, "/settings/network");
    await owner.locator(`[data-network-manager-remove="${managerId}"]`).click();
    const dialog = owner.locator('[role="dialog"]').last();
    await dialog.waitFor({ timeout: 30000 });
    say("remove dialog", flat(await dialog.innerText()));
    await dialog.locator("button", { hasText: "Снять" }).last().click();
    await owner.locator(`[data-network-manager="${managerId}"]`).waitFor({ state: "detached", timeout: 60000 });
    check("owner removes the manager (row and DB row gone)",
      sql(`select count(*) from "AccountNetworkManager" where "accountId"='${accountId}' and "userId"='${managerId}'`) === "0");
    say("audit network_manager_removed", sql(`select count(*) from "AuditLog" where action='account.network_manager_removed' and "entityId"='${accountId}'`));

    // The manager's very next calls, same session, no re-login.
    const goneSync = await api(manager, "POST", "/api/settings/directory-exchange/sync");
    const goneState = await api(manager, "GET", "/api/settings/directory-exchange");
    const goneExport = await api(manager, "GET", "/api/settings/network/export?period=7&format=xlsx");
    say("removed manager → exchange/export", { sync: goneSync.status, stateCanManage: goneState.json.canManage, export: goneExport.status });
    const gonePage = await open(manager, "/settings/network");
    const goneSummary = await manager.locator("[data-network-summary]").count();
    const goneText = flat(await manager.locator("main").first().innerText()).slice(0, 300);
    // The settings segment has loading.tsx, so the page streams: forbidden() renders «Нет доступа» but the HTTP
    // status is already 200 — judge by the content.
    say("removed manager /settings/network", { status: gonePage, summaryShown: goneSummary, text: goneText });
    check("removal takes the rights at once: «Сеть» shows «Нет доступа», sync 403, export 403, canManage false",
      goneSummary === 0 && /Нет доступа/.test(goneText) && goneSync.status === 403 && goneExport.status === 403 && goneState.json.canManage === false,
      { page: gonePage, summaryShown: goneSummary, sync: goneSync.status, export: goneExport.status, canManage: goneState.json.canManage });
    await open(manager, "/dashboard");
    check("removed manager no longer has «Сеть» in the menu", (await manager.locator('a[href="/settings/network"]').count()) === 0);

    /* ───────────────────── 3. Pay from the account balances ───────────────────── */
    const ids = [orgA.id, orgB.id];
    // Account total short: 10 ₽ + 10 ₽.
    say("set balances A=10, B=10", [await setBalance(root, orgA.id, 10), await setBalance(root, orgB.id, 10)]);
    await open(owner, "/settings/subscription");
    await tid(owner, "tariff-cta-standard").waitFor({ timeout: 120000 });
    const ctaStandard = { text: flat(await tid(owner, "tariff-cta-standard").innerText()), href: await tid(owner, "tariff-cta-standard").getAttribute("href") };
    say("standard CTA", ctaStandard);
    const premium = tid(owner, "tariff-cta-premium");
    if (await premium.count()) say("premium CTA", { text: flat(await premium.innerText()), href: await premium.getAttribute("href") });
    const shortButtons = await owner.locator('[data-testid^="tariff-account-collect-"]').count();
    say("balances (short case)", balances(ids));
    check("account total short → no «Собрать с организаций аккаунта и оплатить»", shortButtons === 0, shortButtons);

    const price = digits(ctaStandard.text);
    const target = Object.fromEntries(new URL(ctaStandard.href, BASE).searchParams);
    say("standard price and selection", { price, ...target });
    const activeStart = Math.floor(price / 3);
    say(`set balances A=${activeStart}, B=${price}`, [await setBalance(root, orgA.id, activeStart), await setBalance(root, orgB.id, price)]);
    await owner.reload({ waitUntil: "networkidle", timeout: 300000 });
    await owner.waitForTimeout(1200);
    const collect = tid(owner, "tariff-account-collect-standard");
    const visible = await collect.isVisible().catch(() => false);
    say("collect buttons visible", await owner.locator('[data-testid^="tariff-account-collect-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid"))));
    check("active short, account enough → «Собрать с организаций аккаунта и оплатить» under «Стандарт»", visible);

    const beforePay = balances(ids);
    const planBefore = sql(`select "subscriptionPlan", coalesce("planCycle",'-'), "planPoints", coalesce(to_char("subscriptionEnd",'YYYY-MM-DD'),'-'), coalesce(to_char("trialEndsAt",'YYYY-MM-DD'),'-') from "Account" where id='${accountId}'`);
    say("balances before payment", beforePay);
    say("plan before (plan|cycle|points|paidUntil|trialEnds)", planBefore);
    const previewSeen = owner.waitForResponse((r) => r.url().includes("/api/settings/subscription/account-pay?preview=1"), { timeout: 120000 });
    await collect.scrollIntoViewIfNeeded();
    await collect.click();
    const preview = await previewSeen;
    say("preview request body", preview.request().postDataJSON());
    say("preview response", await preview.json());
    const confirm = owner.locator('[role="dialog"]').last();
    await confirm.locator("button", { hasText: "Перевести и оплатить" }).waitFor({ timeout: 60000 });
    await owner.waitForTimeout(500);
    const confirmText = flat(await confirm.innerText());
    say("confirmation", confirmText);
    const moved = price - activeStart;
    const fmt = (n) => n.toLocaleString("ru-RU").replace(/\s/g, "");
    const plain = confirmText.replace(/\s/g, "");
    check("confirmation shows how much from which organization and the charge",
      plain.includes(`Переводиз«${nameB.replace(/\s/g, "")}»—${fmt(moved)}`) && plain.includes(`сбаланса«${nameA.replace(/\s/g, "")}»—${fmt(price)}`),
      { moved, price });
    await shot(owner, "e07-account-pay-confirm.jpg");

    const paySeen = owner.waitForResponse((r) => r.url().endsWith("/api/settings/subscription/account-pay") && r.request().method() === "POST", { timeout: 180000 });
    await confirm.locator("button", { hasText: "Перевести и оплатить" }).click();
    const pay = await paySeen;
    const payJson = await pay.json().catch(() => null);
    say("payment response", { status: pay.status(), body: payJson });
    await owner.waitForTimeout(3000);
    const toast = await owner.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    say("toast", toast.map(flat));
    const afterPay = balances(ids);
    const planAfter = sql(`select "subscriptionPlan", coalesce("planCycle",'-'), "planPoints", coalesce(to_char("subscriptionEnd",'YYYY-MM-DD'),'-') from "Account" where id='${accountId}'`);
    say("balances after payment", afterPay);
    say("plan after (plan|cycle|points|paidUntil)", planAfter);
    say("ledger rows", sql(`select o.name || ' ' || t.kind || ' ' || t.amount from "BalanceTransaction" t join "Organization" o on o.id=t."organizationId" where t."organizationId" in ('${orgA.id}','${orgB.id}') order by t."createdAt"`).split("\n"));
    check("payment ok: A = 0 after the charge, B lost exactly the moved amount",
      pay.status() === 200 && payJson?.ok === true && afterPay[nameA] === 0 && afterPay[nameB] === beforePay[nameB] - moved,
      { before: beforePay, after: afterPay, moved });
    const [plan, cycle, points] = planAfter.split("|");
    check("plan after payment = selected tariff (standard, cycle and points as selected, paid-until set)",
      plan === "standard" && cycle === target.cycle && points === target.points && planAfter.split("|")[3] !== "-", planAfter);
    await open(owner, "/settings/subscription");
    await shot(owner, "e08-subscription-after-pay.jpg");
    say("collect buttons after payment (total now short)", await owner.locator('[data-testid^="tariff-account-collect-"]').count());

    /* ───────────────────── 4. Mini app ───────────────────── */
    const ownerMiniStatus = await open(owner, "/mini/network");
    say("owner /mini/network", { status: ownerMiniStatus, url: owner.url() });
    const ownerMini = await owner.locator("[data-mini-network]").waitFor({ timeout: 60000 }).then(() => true, () => false);
    if (ownerMini) say("owner mini network", flat(await owner.locator("[data-mini-network]").innerText()).slice(0, 500));
    check("mini «Сеть» renders for the owner with both organizations and «Перейти» for both",
      ownerMini && (await owner.locator("[data-mini-network-org]").count()) === 2
        && (await owner.locator(`[data-mini-network-go="${orgA.id}"]`).count()) > 0 && (await owner.locator(`[data-mini-network-go="${orgB.id}"]`).count()) > 0);
    await shot(owner, "e05-mini-network-owner.jpg", { fullPage: true });
    await open(owner, "/mini/sections");
    const ownerMiniLink = await owner.locator('a[href="/mini/network"]').count();
    check("mini «Все разделы» has «Сеть» for the owner", ownerMiniLink > 0, ownerMiniLink);
    await shot(owner, "e06-mini-sections-owner.jpg");

    await open(manager, "/mini/network");
    await manager.waitForURL((url) => !url.pathname.startsWith("/mini") && !url.search, { timeout: 60000 }).catch(() => {});
    await manager.waitForTimeout(4000);
    say("removed manager /mini/network → url", manager.url());
    check("mini «Сеть» is closed for a non-owner/non-manager (redirect away)",
      !/\/mini\/network/.test(new URL(manager.url()).pathname) && (await manager.locator("[data-mini-network]").count()) === 0, manager.url());
    await open(manager, "/mini/sections");
    check("mini «Все разделы» has no «Сеть» for a non-owner/non-manager", (await manager.locator('a[href="/mini/network"]').count()) === 0);

    say("cleanup", "none — like series D, the live run leaves its organizations and users in the local DB");
  } catch (error) {
    failed += 1;
    say("SCRIPT ERROR", String(error && error.stack ? error.stack : error));
  } finally {
    log.push(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
    fs.writeFileSync(path.join(OUT, "series-e-live.log"), log.join("\n") + "\n");
    await browser.close();
  }
})();
