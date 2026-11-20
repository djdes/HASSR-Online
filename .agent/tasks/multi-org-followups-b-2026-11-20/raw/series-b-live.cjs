// Live check of series B through the browser (local `next dev`, Playwright, system Chromium).
// Item 9: skipped records and their review; item 12: recent transfers and undo; item 13: a new cabinet code;
// item 10: account balance and a transfer between own organizations; item 11: ROOT own-14-days card.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT = __dirname;
const stamp = Date.now().toString(36);
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();

/** ИНН юрлица (10 цифр) с верной контрольной цифрой. */
function inn10(prefix9) {
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const sum = prefix9.split("").reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
  return prefix9 + String((sum % 11) % 10);
}
const innSeed = String(Date.now()).slice(-6);

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 160) };
      }
      return { status: res.status, json };
    },
    { method, url, body },
  );
}
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  return ctx.newPage();
}
async function register(browser, email) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  return page;
}
async function login(browser, email, password) {
  const page = await newPage(browser);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  return page;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 74, ...opts });
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const open = async (page, url) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.waitForTimeout(1500);
};
const switchTo = async (page, id) => {
  await api(page, "POST", "/api/me/active-organization", { organizationId: id });
  await page.reload({ waitUntil: "networkidle" });
};
const confirmInDialog = async (page, label) => {
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: label }).click();
};

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);

    // ---- owner with three organizations
    const owner = await register(browser, `ownb-${stamp}@example.com`);
    say("profile", (await api(owner, "POST", "/api/profile/complete", {
      organizationName: "Сеть Ужин", phone: `+7916${innSeed.slice(0, 7).padEnd(7, "1")}`, sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: inn10(`50${innSeed}2`.slice(0, 9)), name: "Владелец", newPassword: "Passw0rd-1", asEmployee: false,
    })).status);
    const orgA = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    for (const [name, kind] of [["Молоко 3,2 %", "raw"], ["Курица охлаждённая", "raw"], ["Сливки 20 %", "raw"]]) {
      await api(owner, "POST", "/api/products", { name, unit: "kg", kind });
    }
    say("org B", (await api(owner, "POST", "/api/organizations", { name: "Ужин на Пресне", sphere: "restaurant" })).status);
    say("org C", (await api(owner, "POST", "/api/organizations", { name: "Ужин на Арбате", sphere: "restaurant" })).status);
    const orgs = (await api(owner, "GET", "/api/organizations")).json.organizations;
    const orgB = orgs.find((o) => o.name === "Ужин на Пресне");
    const orgC = orgs.find((o) => o.name === "Ужин на Арбате");

    // ---- item 9: two conflicts in B — an inactive «Молоко 3,2 %» and a finished dish «Курица охлаждённая»
    await switchTo(owner, orgB.id);
    await api(owner, "POST", "/api/products", { name: "Молоко 3,2 %", unit: "kg", kind: "raw" });
    await api(owner, "POST", "/api/products", { name: "Курица охлаждённая", unit: "kg", kind: "finished" });
    sql(`update "Product" set "isActive"=false where "organizationId"='${orgB.id}' and name='Молоко 3,2 %'`);
    await switchTo(owner, orgA.id);
    const saved = await api(owner, "PUT", "/api/settings/directory-exchange", {
      members: [
        { organizationId: orgA.id, kinds: ["products"] },
        { organizationId: orgB.id, kinds: ["products"] },
      ],
    });
    say("exchange A↔B saved", saved.status);
    say("skip rows", sql(`select string_agg(name || ' — ' || reason, '; ' order by name) from "DirectoryExchangeSkip" where "organizationId"='${orgB.id}'`));
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-skips-open").waitFor({ timeout: 30000 });
    say("card line", (await tid(owner, "exchange-skips").innerText()).replace(/\n+/g, " | "));
    await tid(owner, "exchange-skips-open").click();
    await tid(owner, "exchange-skips-dialog").waitFor({ timeout: 30000 });
    await owner.waitForTimeout(800);
    say("skips dialog", (await tid(owner, "exchange-skips-dialog").innerText()).replace(/\n+/g, " | ").slice(0, 700));
    await shot(owner, "01-skips-dialog.jpg");
    const rows = tid(owner, "exchange-skip");
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (text.includes("Курица") && (await row.locator('[data-testid="exchange-skip-link"]').count())) {
        await row.locator('[data-testid="exchange-skip-link"]').click();
        break;
      }
    }
    await owner.waitForTimeout(2000);
    const milk = tid(owner, "exchange-skip").filter({ hasText: "Молоко" });
    if (await milk.count()) await milk.locator('[data-testid="exchange-skip-ignore"]').click();
    await owner.waitForTimeout(2000);
    await shot(owner, "02-skips-after-actions.jpg");
    say("skip rows after the actions", sql(`select count(*) from "DirectoryExchangeSkip" where "organizationId"='${orgB.id}'`));
    say(
      "links in B after the actions (entity|has record)",
      sql(`select string_agg(entity || '|' || ("entityId" is not null)::text, ', ') from "DirectoryExchangeLink" where "organizationId"='${orgB.id}'`),
    );
    say("B dish «Курица охлаждённая» kept its kind", sql(`select kind from "Product" where "organizationId"='${orgB.id}' and name='Курица охлаждённая'`));
    await owner.keyboard.press("Escape").catch(() => null);

    // ---- item 13: a new cabinet code
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1000);
    if ((await tid(owner, "exchange-cabinet-code-value").count()) === 0) await tid(owner, "exchange-cabinet-code-get").click();
    await tid(owner, "exchange-cabinet-code-value").waitFor({ timeout: 60000 });
    const oldCode = (await tid(owner, "exchange-cabinet-code-value").innerText()).trim();
    await tid(owner, "exchange-cabinet-code-renew").click();
    await tid(owner, "exchange-cabinet-code-renew-confirm").waitFor({ timeout: 10000 });
    await tid(owner, "exchange-cabinet-code").screenshot({ path: path.join(OUT, "03-code-renew-confirm.jpg"), type: "jpeg", quality: 80 });
    await tid(owner, "exchange-cabinet-code-renew-confirm").click();
    await owner.waitForTimeout(2500);
    const newCode = (await tid(owner, "exchange-cabinet-code-value").innerText()).trim();
    say("cabinet code changed", { changed: oldCode !== newCode, looksLikeCode: /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(newCode) });
    await tid(owner, "exchange-cabinet-code").screenshot({ path: path.join(OUT, "04-code-renewed.jpg"), type: "jpeg", quality: 80 });
    say("menu/raw codes of A and B unchanged (linkedServiceCode)", sql(`select count(*) from "Organization" where id in ('${orgA.id}','${orgB.id}') and "linkedServiceCode" is not null`));

    // ---- item 12: a one-off transfer into C and its undo
    await switchTo(owner, orgC.id);
    const moved = await api(owner, "POST", "/api/settings/directory-exchange/transfer", { fromOrganizationId: orgA.id, selection: { products: "all" } });
    say("transfer A → C", { status: moved.status, created: moved.json?.summary?.organizations?.[0]?.kinds?.products?.created });
    // One product is edited after the transfer — it must stay after the undo.
    sql(`update "Product" set supplier='Новый поставщик', "updatedAt"=now() + interval '1 minute' where "organizationId"='${orgC.id}' and name='Сливки 20 %'`);
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-transfers").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-transfers").screenshot({ path: path.join(OUT, "05-recent-transfers.jpg"), type: "jpeg", quality: 80 });
    say("recent transfers", (await tid(owner, "exchange-transfers").innerText()).replace(/\n+/g, " | ").slice(0, 400));
    await tid(owner, "exchange-transfer-undo").first().click();
    await tid(owner, "exchange-transfer-undo-confirm").click();
    await tid(owner, "exchange-transfer-result").waitFor({ timeout: 60000 });
    say("undo result", (await tid(owner, "exchange-transfer-result").innerText()).replace(/\n+/g, " | "));
    await tid(owner, "exchange-transfers").screenshot({ path: path.join(OUT, "06-transfer-undone.jpg"), type: "jpeg", quality: 80 });
    say("C products after undo (name|active)", sql(`select string_agg(name || '|' || "isActive"::text, ', ' order by name) from "Product" where "organizationId"='${orgC.id}'`));

    // ---- item 10: account balance and a transfer between own organizations
    sql(`update "Organization" set "balanceRub"=5000 where id='${orgA.id}'`);
    sql(`update "Organization" set "balanceRub"=1000 where id='${orgB.id}'`);
    await switchTo(owner, orgA.id);
    await open(owner, "/settings/balance");
    await owner.locator("[data-account-balance]").waitFor({ timeout: 60000 });
    say("account balance block", (await owner.locator("[data-account-balance]").innerText()).replace(/\n+/g, " | ").slice(0, 400));
    await owner.locator("[data-account-transfer-open]").click();
    const form = owner.locator("[data-account-transfer-form]");
    await form.waitFor({ timeout: 10000 });
    await form.locator("select").nth(1).selectOption(orgB.id);
    await form.locator('input[type="number"], input[inputmode="numeric"]').first().fill("1500");
    await form.locator("input").last().fill("на закупку");
    await owner.locator("[data-account-balance]").screenshot({ path: path.join(OUT, "07-account-balance-form.jpg"), type: "jpeg", quality: 80 });
    await form.locator('button[type="submit"]').click();
    await owner.waitForTimeout(800);
    await confirmInDialog(owner, "Перевести");
    await owner.waitForTimeout(3000);
    say("balances after the transfer A|B", sql(`select string_agg("balanceRub"::text, '|' order by name) from "Organization" where id in ('${orgA.id}','${orgB.id}')`));
    say("history rows", sql(`select string_agg(kind || ' ' || amount::text, ', ' order by amount) from "BalanceTransaction" where "organizationId" in ('${orgA.id}','${orgB.id}')`));
    await shot(owner, "08-balance-after-transfer.jpg", { fullPage: true });
    say("not the owner: transfer refused", (await api(root, "POST", "/api/balance/transfer", { fromId: orgA.id, toId: orgB.id, amountRub: 10, idempotencyKey: `x-${stamp}` })).status);

    // ---- item 11: ROOT — own 14 days of organization B
    await open(root, `/root/organizations/${orgB.id}`);
    const card = root.locator("[data-org-trial-card]");
    await card.waitFor({ timeout: 60000 });
    await card.scrollIntoViewIfNeeded();
    say("ROOT org-trial card", (await card.innerText()).replace(/\n+/g, " | ").slice(0, 500));
    await card.screenshot({ path: path.join(OUT, "09-root-org-trial.jpg"), type: "jpeg", quality: 80 });
    const before = sql(`select "trialEndsAt" from "Organization" where id='${orgB.id}'`);
    await card.locator('input[type="number"]').fill("5");
    await card.getByRole("button", { name: "Продлить" }).click();
    await root.waitForTimeout(800);
    await confirmInDialog(root, "Продлить");
    await root.waitForTimeout(2500);
    say("ROOT extend by 5 days", { before, after: sql(`select "trialEndsAt" from "Organization" where id='${orgB.id}'`) });
    say("audit", sql(`select string_agg(action, ', ') from "AuditLog" where "organizationId"='${orgB.id}' and action like 'root.org_trial%'`));
    await card.screenshot({ path: path.join(OUT, "10-root-org-trial-extended.jpg"), type: "jpeg", quality: 80 });
  } catch (error) {
    say("SCRIPT ERROR", String(error && error.stack ? error.stack : error));
  } finally {
    fs.writeFileSync(path.join(OUT, "series-b-live.log"), log.join("\n") + "\n");
    await browser.close();
  }
})();
