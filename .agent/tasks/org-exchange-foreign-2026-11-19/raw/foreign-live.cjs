// Live check of part 3: exchange with another account by the master cabinet code, confirmed by e-mail.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "raw3");
const DEVLOG = path.join(__dirname, "next-dev.log");
const stamp = Date.now().toString(36);
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();
const list = (query) => sql(query).split("\n").filter(Boolean).sort();
const snapshot = (orgId) => ({
  products: list(`select name from "Product" where "organizationId"='${orgId}' and "isActive"`),
  staff: list(`select name || coalesce(' ' || phone, '') from "User" where "organizationId"='${orgId}' and "passwordHash"='' and "archivedAt" is null`),
  buildings: list(`select name from "Building" where "organizationId"='${orgId}' and kind <> 'office'`),
  equipment: list(`select e.name from "Equipment" e join "Area" a on a.id=e."areaId" where a."organizationId"='${orgId}'`),
});
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
async function login(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  return page;
}
const profile = (page, name, inn, phone) => api(page, "POST", "/api/profile/complete", {
  organizationName: name, phone, sphere: "restaurant", ownershipKind: "private", locationsCount: 1, inn,
  name: "Владелец", newPassword: "Passw0rd-1", asEmployee: false,
});
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 72, ...opts });
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const open = async (page, url) => { await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 }); await page.waitForTimeout(1500); };
/** The mail stub logs only the text of a letter, so the owner opens a request by its id — the same way the card link does. */
async function newestIncoming(page) {
  const incoming = (await api(page, "GET", "/api/settings/directory-exchange/requests")).json.incoming ?? [];
  return incoming.length ? incoming[incoming.length - 1].id : null;
}
function mailLogged(subjectPart) {
  return fs.readFileSync(DEVLOG, "utf8").includes(subjectPart);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);

    // ---- the company that owns the master cabinet
    const ownerEmail = `cab-${stamp}@example.com`;
    const owner = await register(browser, ownerEmail);
    await profile(owner, "Сеть Вкусно", "5001000041", "+79168880011");
    const ownerOrg = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    const position = await api(owner, "POST", "/api/positions", { name: "Повар", categoryKey: "staff" });
    const positionId = position.json?.position?.id ?? position.json?.id;
    await api(owner, "POST", "/api/staff", { jobPositionId: positionId, fullName: "Иванова Мария", phone: "+79161234567" });
    await api(owner, "POST", "/api/staff", { jobPositionId: positionId, fullName: "Сидоров Олег" });
    const building = await api(owner, "POST", "/api/settings/buildings", { name: "Кафе на Тверской", address: "Москва, Тверская, 1" });
    const area = await api(owner, "POST", "/api/areas", { name: "Горячий цех", buildingId: building.json?.building?.id ?? building.json?.id });
    await api(owner, "POST", "/api/equipment", { name: "Холодильник 1", type: "refrigerator", areaId: area.json?.area?.id ?? area.json?.id, tempMin: 2, tempMax: 6 });
    for (const name of ["Молоко 3,2 %", "Курица охлаждённая"]) await api(owner, "POST", "/api/products", { name, unit: "kg", kind: "raw" });
    say("owner before", snapshot(ownerOrg.id));

    // The owner takes the cabinet code from the card.
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-cabinet-code-get").click();
    await tid(owner, "exchange-cabinet-code-value").waitFor({ timeout: 60000 });
    const code = (await tid(owner, "exchange-cabinet-code-value").innerText()).trim();
    say("cabinet code looks like a code", /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code));
    await tid(owner, "exchange-card").screenshot({ path: path.join(OUT, "01-owner-card-code.jpg"), type: "jpeg", quality: 80 });

    // ---- the requesting company: first on trial (refused), then paid
    const reqEmail = `req-${stamp}@example.com`;
    const req = await register(browser, reqEmail);
    await profile(req, "Кафе Партнёр", "5001000059", "+79168880022");
    const reqOrg = (await api(req, "GET", "/api/organizations")).json.organizations[0];
    say("request on a trial account", await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] }));
    const invoice = await api(req, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    say("requester pays the tariff", (await api(root, "POST", `/api/root/orders/${invoice.json.orderId}/mark-paid`)).status);
    say("request with a wrong code", await api(req, "POST", "/api/settings/directory-exchange/requests", { code: "ABCDE-FGH23", mode: "link", kinds: ["products"] }));

    // The request through the window: block «Другая компания».
    await open(req, "/settings/master-cabinet");
    await tid(req, "exchange-card").waitFor({ timeout: 60000 });
    await tid(req, "exchange-foreign-open").click();
    await tid(req, "exchange-dialog").waitFor({ timeout: 30000 });
    await req.waitForTimeout(1200);
    for (const kind of ["products", "staff", "objects", "equipment"]) {
      const box = tid(req, `exchange-kind-${kind}`);
      if (!(await box.isChecked().catch(() => false))) await box.check({ force: true }).catch(() => box.click());
    }
    await tid(req, "exchange-foreign-code").fill(code.toLowerCase().replace("-", " "));
    await shot(req, "02-requester-dialog-code.jpg");
    await tid(req, "exchange-foreign-send").click();
    await tid(req, "exchange-foreign-pending").waitFor({ timeout: 60000 });
    say("requester sees", (await tid(req, "exchange-foreign-pending").innerText()).replace(/\n+/g, " | "));
    await shot(req, "03-requester-pending.jpg");
    say("requester's view of requests (must name only the cabinet)", (await api(req, "GET", "/api/settings/directory-exchange/requests")).json.outgoing);
    say("duplicate request", (await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] })).status);
    // A person with the same name works in the requesting company too — a different person.
    const reqPosition = await api(req, "POST", "/api/positions", { name: "Повар", categoryKey: "staff" });
    await api(req, "POST", "/api/staff", { jobPositionId: reqPosition.json?.position?.id ?? reqPosition.json?.id, fullName: "Сидоров Олег", phone: "+79160000099" });
    say("requester before approval", snapshot(reqOrg.id));

    // ---- the e-mail and the confirmation page
    await req.waitForTimeout(2500);
    const token = await newestIncoming(owner);
    say("letter to the cabinet owner was produced", mailLogged("Запрос на обмен справочниками от «Кафе Партнёр»"));
    say("owner sees the request in the card list", Boolean(token));
    say("requester opens the link", (await api(req, "GET", `/api/exchange-requests/${encodeURIComponent(token)}`)).status);
    await open(owner, `/exchange-request/${encodeURIComponent(token)}`);
    await tid(owner, "exchange-request-card").waitFor({ timeout: 60000 });
    say("owner sees", (await tid(owner, "exchange-request-card").innerText()).replace(/\n+/g, " | ").slice(0, 700));
    await shot(owner, "04-owner-confirmation-page.jpg", { fullPage: true });
    say("own organizations offered and preselected", await owner.locator('[data-testid="exchange-request-own"]').evaluateAll((items) => items.map((item) => item.checked)));
    await tid(owner, "exchange-request-kind-equipment").uncheck({ force: true }).catch(() => tid(owner, "exchange-request-kind-equipment").click());
    await tid(owner, "exchange-request-approve").click();
    await tid(owner, "exchange-request-approve-confirm").click();
    await owner.waitForTimeout(6000);
    say("owner after approval sees", (await owner.locator("main, body").first().innerText()).replace(/\n+/g, " | ").slice(0, 400));
    await shot(owner, "05-owner-approved.jpg", { fullPage: true });

    // ---- what crossed the border
    say("requester after approval", snapshot(reqOrg.id));
    say("owner after approval", snapshot(ownerOrg.id));
    say("member row", sql(`select kinds::text, "foreign" from "DirectoryExchangeMember" where "organizationId"='${reqOrg.id}'`));
    say("second approval of the same request", (await api(owner, "POST", `/api/exchange-requests/${encodeURIComponent(token)}`, { decision: "approve", allowedKinds: ["products"] })).status);

    // New records travel both ways.
    say("requester adds a product", (await api(req, "POST", "/api/products", { name: "Сливки 20 %", unit: "l", kind: "raw" })).status);
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    say("owner products after sync", snapshot(ownerOrg.id).products);
    say("owner staff (phones untouched, no second Сидоров)", snapshot(ownerOrg.id).staff);
    say("requester staff (own Сидоров kept with own phone)", snapshot(reqOrg.id).staff);

    // Edits travel only from the cabinet owner to the other company.
    const supplierOf = (orgId) => sql(`select coalesce(supplier,'-') from "Product" where "organizationId"='${orgId}' and name='Молоко 3,2 %'`);
    const milkReq = sql(`select id from "Product" where "organizationId"='${reqOrg.id}' and name='Молоко 3,2 %'`);
    const milkOwner = sql(`select id from "Product" where "organizationId"='${ownerOrg.id}' and name='Молоко 3,2 %'`);
    say("requester edits a shared product", (await api(req, "PUT", "/api/products", { id: milkReq, name: "Молоко 3,2 %", unit: "kg", kind: "raw", supplier: "Поставщик заявителя" })).status);
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    say("owner's record after the other company's edit", supplierOf(ownerOrg.id));
    say("owner edits the same product", (await api(owner, "PUT", "/api/products", { id: milkOwner, name: "Молоко 3,2 %", unit: "kg", kind: "raw", supplier: "Ферма владельца" })).status);
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    say("requester's record after the owner's edit", supplierOf(reqOrg.id));

    // Only one other company per cabinet.
    const thirdEmail = `third-${stamp}@example.com`;
    const third = await register(browser, thirdEmail);
    await profile(third, "Третья компания", "5001000066", "+79168880033");
    const thirdInvoice = await api(third, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    await api(root, "POST", `/api/root/orders/${thirdInvoice.json.orderId}/mark-paid`);
    const thirdRequest = await api(third, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] });
    say("third company sends a request", { status: thirdRequest.status, cabinetName: thirdRequest.json?.request?.cabinetName });
    say("owner approves a second company", await api(owner, "POST", `/api/exchange-requests/${thirdRequest.json.request.id}`, { decision: "approve", allowedKinds: ["products"] }));
    const thirdOrg = (await api(third, "GET", "/api/organizations")).json.organizations[0];
    say("third company received nothing", snapshot(thirdOrg.id).products);

    // ---- the requester's card and leaving
    await open(req, "/settings/master-cabinet");
    await tid(req, "exchange-foreign-linked").first().waitFor({ timeout: 60000 });
    say("requester card", (await tid(req, "exchange-foreign-linked").first().innerText()).replace(/\n+/g, " | "));
    await tid(req, "exchange-card").screenshot({ path: path.join(OUT, "06-requester-linked.jpg"), type: "jpeg", quality: 80 });
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1200);
    say("owner card: other company and incoming request", {
      foreignMember: await tid(owner, "exchange-foreign-member").count(),
      incoming: await tid(owner, "exchange-incoming-request").count(),
      openLink: await tid(owner, "exchange-incoming-open").count(),
    });
    await tid(owner, "exchange-card").screenshot({ path: path.join(OUT, "07-owner-card.jpg"), type: "jpeg", quality: 80 });
    const links = (await api(req, "GET", "/api/settings/directory-exchange/requests")).json.foreignLinks;
    say("leave", (await api(req, "DELETE", `/api/settings/directory-exchange/requests/${links[0].id}`)).status);
    say("member and link rows after leaving", sql(`select (select count(*) from "DirectoryExchangeMember" where "organizationId"='${reqOrg.id}') || ' / ' || (select count(*) from "DirectoryExchangeLink" where "organizationId"='${reqOrg.id}')`));
    await api(req, "POST", "/api/products", { name: "После выхода", unit: "kg", kind: "raw" });
    await api(owner, "POST", "/api/settings/directory-exchange/sync");
    say("owner did not get a product added after leaving", !snapshot(ownerOrg.id).products.includes("После выхода"));

    // ---- cancel, one-off transfer, decline and the cool-down
    const cancelled = await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "transfer", kinds: ["equipment"] });
    say("cancel", (await api(req, "DELETE", `/api/settings/directory-exchange/requests/${cancelled.json.request.id}`)).status);
    say("approve a cancelled request", (await api(owner, "POST", `/api/exchange-requests/${cancelled.json.request.id}`, { decision: "approve", allowedKinds: ["equipment"] })).status);

    const transfer = await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "transfer", kinds: ["equipment"] });
    const transferPage = await api(owner, "GET", `/api/exchange-requests/${transfer.json.request.id}`);
    say("transfer request: sources offered", transferPage.json.sources?.map((source) => source.name));
    say("approve transfer", (await api(owner, "POST", `/api/exchange-requests/${transfer.json.request.id}`, { decision: "approve", allowedKinds: ["equipment"], sourceOrganizationId: transferPage.json.sources?.[0]?.id })).status);
    say("requester equipment after transfer", snapshot(reqOrg.id).equipment);
    say("links kept after transfer", sql(`select count(*) from "DirectoryExchangeLink" where "organizationId"='${reqOrg.id}'`));

    const declined = await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] });
    say("decline", (await api(owner, "POST", `/api/exchange-requests/${declined.json.request.id}`, { decision: "decline" })).json);
    say("request again right after a decline", await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] }));

    // ---- strangers and the requester's journal
    const stranger = await register(browser, `stranger-${stamp}@example.com`);
    say("stranger reads a request by its id", (await api(stranger, "GET", `/api/exchange-requests/${declined.json.request.id}`)).status);
    say("requester reads own request through the owner's route", (await api(req, "GET", `/api/exchange-requests/${declined.json.request.id}`)).status);
    say("requester's journal names no organisation of the owner", sql(`select count(*) from "AuditLog" where "organizationId"='${reqOrg.id}' and action like 'directory_exchange.%' and details::text like '%Сеть Вкусно%'`));
    say("audit on both sides", sql(`select action, count(*) from "AuditLog" where action like 'directory_exchange.%' and "organizationId" in ('${ownerOrg.id}','${reqOrg.id}') group by action order by action`).replace(/\n/g, "; "));
  } finally {
    fs.writeFileSync(path.join(OUT, "foreign-live.log"), log.join("\n"));
    await browser.close();
  }
})().catch((error) => { console.error("FAILED", String(error).slice(0, 700)); process.exit(1); });
