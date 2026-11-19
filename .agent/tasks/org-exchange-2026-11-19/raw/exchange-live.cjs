// Live check of part 2 through the interface: new-organization wizard → offer line → dialog → result.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw2");
const stamp = Date.now().toString(36);
const EMAIL = `exch-${stamp}@example.com`;
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
const list = (query) => sql(query).split("\n").filter(Boolean).sort();
function snapshot(orgId) {
  return {
    products: list(`select name from "Product" where "organizationId"='${orgId}' and "isActive"`),
    staff: list(`select name from "User" where "organizationId"='${orgId}' and "passwordHash"='' and "archivedAt" is null`),
    buildings: list(`select name from "Building" where "organizationId"='${orgId}' and kind <> 'office'`),
    areas: list(`select name from "Area" where "organizationId"='${orgId}'`),
    equipment: list(`select e.name from "Equipment" e join "Area" a on a.id=e."areaId" where a."organizationId"='${orgId}'`),
  };
}
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
    return { status: res.status, json };
  }, { method, url, body });
}
async function register(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  return page;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 72, ...opts });
const switchTo = async (page, id) => { await api(page, "POST", "/api/me/active-organization", { organizationId: id }); await page.reload({ waitUntil: "networkidle" }); };
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

(async () => {
  const browser = await chromium.launch();
  try {
    const owner = await register(browser, EMAIL);
    say("profile A", (await api(owner, "POST", "/api/profile/complete", {
      organizationName: "Кухня ООО", phone: "+79165550101", sphere: "restaurant", ownershipKind: "private",
      locationsCount: 1, inn: "5001000027", name: "Владелец Обмена", newPassword: "Passw0rd-1", asEmployee: false,
    })).status);
    const orgA = (await api(owner, "GET", "/api/organizations")).json.organizations[0];

    // ---- data of organization A (through the regular API of the cabinet)
    const position = await api(owner, "POST", "/api/positions", { name: "Повар", categoryKey: "staff" });
    const positionId = position.json?.position?.id ?? position.json?.id;
    for (const fullName of ["Иванова Мария", "Сидоров Олег"]) await api(owner, "POST", "/api/staff", { jobPositionId: positionId, fullName });
    const building = await api(owner, "POST", "/api/settings/buildings", { name: "Кафе на Тверской", address: "Москва, Тверская, 1" });
    const buildingId = building.json?.building?.id ?? building.json?.id;
    const area = await api(owner, "POST", "/api/areas", { name: "Горячий цех", buildingId });
    await api(owner, "POST", "/api/equipment", { name: "Холодильник 1", type: "refrigerator", areaId: area.json?.area?.id ?? area.json?.id, tempMin: 2, tempMax: 6 });
    for (const name of ["Молоко 3,2 %", "Курица охлаждённая"]) await api(owner, "POST", "/api/products", { name, unit: "kg", kind: "raw" });
    say("A before", snapshot(orgA.id));

    // ---- new organization through the dialog → the setup wizard opens for it
    await owner.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 240000 });
    await owner.getByRole("button", { name: /Добавить организацию/ }).first().click();
    await owner.waitForSelector('[data-testid="org-creation-preview"]', { timeout: 30000 }).catch(() => null);
    await owner.locator('form input[maxlength="200"]').first().fill("Кухня ИП");
    await owner.locator('form button[type="submit"]').click();
    await owner.waitForURL(/welcome-org=/, { timeout: 240000 });
    await owner.waitForSelector("#complete-profile-form", { timeout: 60000 });
    await owner.waitForTimeout(1500);
    await shot(owner, "01-new-org-wizard-step1.jpg");
    say("step 1 fields", await owner.locator("#complete-profile-form label").allInnerTexts().then((t) => t.map((s) => s.split("\n")[0].trim()).filter(Boolean)));
    const orgs = (await api(owner, "GET", "/api/organizations")).json.organizations;
    const orgB = orgs.find((o) => o.name === "Кухня ИП");
    await owner.locator('button[form="complete-profile-form"], #complete-profile-form button[type="submit"]').first().click();
    await tid(owner, "exchange-offer-line").waitFor({ timeout: 60000 });
    say("step 2 offer line", (await tid(owner, "exchange-offer-line").innerText()).replace(/\n+/g, " | "));
    await shot(owner, "02-step2-offer-line.jpg");

    // ---- the dialog: all four lists, link through the master cabinet
    await tid(owner, "exchange-offer-open").click();
    await tid(owner, "exchange-dialog").waitFor({ timeout: 30000 });
    await owner.waitForTimeout(1200);
    for (const kind of ["products", "staff", "objects", "equipment"]) {
      const box = tid(owner, `exchange-kind-${kind}`);
      if (!(await box.isChecked().catch(() => false))) await box.check({ force: true }).catch(() => box.click());
    }
    await tid(owner, "exchange-mode-link").click().catch(() => null);
    await shot(owner, "03-dialog-link.jpg");
    say("dialog text", (await tid(owner, "exchange-dialog").innerText()).replace(/\n+/g, " | ").slice(0, 900));
    await tid(owner, "exchange-submit").click();
    await tid(owner, "exchange-result").waitFor({ timeout: 120000 });
    say("result", (await tid(owner, "exchange-result").innerText()).replace(/\n+/g, " | "));
    await shot(owner, "04-dialog-result.jpg");
    await tid(owner, "exchange-done").click().catch(() => null);
    await owner.waitForTimeout(1500);
    await shot(owner, "05-step2-after-exchange.jpg");
    say("B after link", snapshot(orgB.id));

    // ---- closing the wizard: the "new organization" banner stays, a reload does not reopen the wizard
    await owner.getByRole("button", { name: "Закрыть" }).first().click().catch(() => null);
    await owner.waitForTimeout(1200);
    say("after closing: wizard steps on screen", await owner.locator("[data-setup-next], #complete-profile-form").count());
    say("after closing: banner «Новая организация»", await owner.getByText(/Новая организация «Кухня ИП»/).count());
    await owner.reload({ waitUntil: "networkidle" });
    await owner.waitForTimeout(1500);
    say("after reload: wizard steps on screen", await owner.locator("[data-setup-next], #complete-profile-form").count());
    await switchTo(owner, orgA.id);
    await owner.waitForTimeout(1200);
    say("in the first organization with the same address: wizard steps on screen", await owner.locator("[data-setup-next], #complete-profile-form").count());
    say("  address", owner.url().replace(/^https?:\/\/[^/]+/, ""));

    // ---- both directions: a new product and a rename in B reach A; a deletion in A does not come back
    await switchTo(owner, orgB.id);
    say("B: new product", (await api(owner, "POST", "/api/products", { name: "Сливки 20 %", unit: "l", kind: "raw" })).status);
    say("sync", (await api(owner, "POST", "/api/settings/directory-exchange/sync")).json?.summary?.organizations?.map((o) => ({ name: o.name, products: o.kinds.products })));
    say("A after B's addition", snapshot(orgA.id).products);
    const milkA = sql(`select id from "Product" where "organizationId"='${orgA.id}' and name='Курица охлаждённая'`);
    await switchTo(owner, orgA.id);
    say("A: delete a product", (await api(owner, "DELETE", `/api/products?id=${milkA}`)).status);
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    say("after deletion in A", { A: snapshot(orgA.id).products, B: snapshot(orgB.id).products });

    // ---- the card in settings
    await owner.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "networkidle", timeout: 240000 });
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1200);
    say("card", (await tid(owner, "exchange-card").innerText()).replace(/\n+/g, " | ").slice(0, 500));
    await tid(owner, "exchange-card").screenshot({ path: path.join(OUT, "06-settings-card.jpg"), type: "jpeg", quality: 80 });

    // ---- one-off transfer into a third organization, picked items only
    const third = await api(owner, "POST", "/api/organizations", { name: "Кухня Три", sphere: "restaurant" });
    await owner.reload({ waitUntil: "networkidle" });
    const preview = await api(owner, "GET", `/api/settings/directory-exchange/transfer?from=${orgA.id}`);
    const pick = preview.json.items.products.filter((item) => item.name === "Молоко 3,2 %").map((item) => item.id);
    say("transfer preview (products)", preview.json.items.products.map((item) => `${item.name}${item.exists ? " (есть)" : ""}`));
    say("transfer one product + all equipment", (await api(owner, "POST", "/api/settings/directory-exchange/transfer", { fromOrganizationId: orgA.id, selection: { products: pick, equipment: "all" } })).json?.summary?.organizations?.map((o) => ({ name: o.name, products: o.kinds.products, equipment: o.kinds.equipment })));
    say("third after transfer", snapshot(third.json.organizationId));
    say("links kept for the third organization", sql(`select count(*) from "DirectoryExchangeLink" where "organizationId"='${third.json.organizationId}'`));

    // ---- a stranger cannot reach these organizations
    const stranger = await register(browser, `other-${stamp}@example.com`);
    await api(stranger, "POST", "/api/profile/complete", { organizationName: "Чужая", phone: "+79165550909", sphere: "restaurant", ownershipKind: "private", locationsCount: 1, inn: "", name: "Чужой", newPassword: "Passw0rd-1", asEmployee: false });
    say("stranger: link with a foreign organization", await api(stranger, "PUT", "/api/settings/directory-exchange", { members: [{ organizationId: orgA.id, kinds: ["products"] }] }));
    say("stranger: transfer from a foreign organization", await api(stranger, "POST", "/api/settings/directory-exchange/transfer", { fromOrganizationId: orgA.id, selection: { products: "all" } }));
  } finally {
    fs.writeFileSync(path.join(OUT, "exchange-live.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", String(error).slice(0, 600)); process.exit(1); });
