// Browser check for .agent/tasks/switch-fresh-data-2026-11-12 (local dev server + local fixture).
// Usage: node switch-check.cjs <baseUrl> <outDir> <orgA> <orgB> [label]
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const [BASE, OUT, ORG_A, ORG_B, LABEL = "after"] = process.argv.slice(2);
const EMAIL = "owner-switch@local.test";
const PASSWORD = "switch-test-pass";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};
const norm = (text) => (text ?? "").replace(/[\s  ]+/g, " ").trim();

async function login(context) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: EMAIL, password: PASSWORD, json: "true", callbackUrl: `${BASE}/dashboard` },
  });
  note(`login status=${res.status()}`);
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  // Автосмена точки на странице раздела компании показывает свой тост — ждём, пока уйдёт.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(3800);
}

const amount = (page) =>
  page.getByText("Баланс организации", { exact: true }).locator("xpath=following-sibling::div[1]");

async function orgFlow(page, { mobile }) {
  const tag = mobile ? "mobile" : "desktop";
  await page.goto(`${BASE}/settings/balance`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await amount(page).waitFor({ timeout: 180000 });
  await settle(page);
  const before = norm(await amount(page).textContent());
  note(`[${tag}] org A balance before switch: ${before}`);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${tag}-1-org-a.png`) });

  const amountHandle = await amount(page).elementHandle();
  const headerHandle = await page.$("header");
  await page.evaluate(() => {
    window.__noReload = true;
  });
  const requests = [];
  const onRequest = (request) => requests.push({ t: Date.now(), method: request.method(), url: request.url() });
  page.on("request", onRequest);

  await page.getByRole("button", { name: "Профиль" }).first().click();
  const row = page.locator(`[data-testid="org-switcher-row"][data-org-id="${ORG_B}"] button`).first();
  await row.waitFor({ timeout: 30000 });
  const clickedAt = Date.now();
  await row.click();

  const baseline = LABEL.startsWith("before");
  const toast = page.locator(baseline ? "[data-sonner-toast]" : "[data-switch-toast]");
  let toastShownAt = null;
  try {
    await toast.first().waitFor({ state: "visible", timeout: 120000 });
    toastShownAt = Date.now();
  } catch {
    note(`[${tag}] no unified switch toast appeared`);
  }
  if (baseline) {
    // Прежний вид: стандартный тост sonner. Данные — ждём, сколько ждёт человек.
    await page.waitForTimeout(1500);
    note(`[${tag}] toast text: ${norm(await toast.first().innerText().catch(() => ""))}`);
    note(`[${tag}] unified switch toast present: ${(await page.locator("[data-switch-toast]").count()) > 0}`);
    note(`[${tag}] balance 1.5s after the toast (no reload): ${norm(await amount(page).textContent().catch(() => ""))}`);
    note(`[${tag}] old balance node still mounted: ${await amountHandle.evaluate((el) => el.isConnected)}`);
    await page.screenshot({ path: path.join(OUT, `${LABEL}-${tag}-2-org-b-toast.png`) });
    await page.reload({ waitUntil: "domcontentloaded" });
    await amount(page).waitFor({ timeout: 180000 });
    note(`[${tag}] balance after a manual reload: ${norm(await amount(page).textContent())}`);
    page.off("request", onRequest);
    return;
  }
  // Ждём новую страницу (без перезагрузки): сумма — уже из B.
  await page.waitForTimeout(400);
  const after = norm(await amount(page).textContent().catch(() => ""));
  note(`[${tag}] balance right after switching to B (no reload): ${after}`);
  const reloaded = !(await page.evaluate(() => window.__noReload === true));
  note(`[${tag}] full page reload happened: ${reloaded}`);
  note(`[${tag}] old balance node still mounted: ${await amountHandle.evaluate((el) => el.isConnected)}`);
  note(`[${tag}] old header node still mounted: ${headerHandle ? await headerHandle.evaluate((el) => el.isConnected) : "n/a"}`);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${tag}-2-org-b-toast.png`) });

  if (toastShownAt) {
    note(`[${tag}] toast text: ${norm(await toast.first().innerText())}`);
    const ring = await toast.first().locator("[data-toast-countdown]").getAttribute("style");
    note(`[${tag}] countdown ring style: ${ring}`);
    const close = toast.first().locator("button[aria-label]").last();
    const closeBox = await close.boundingBox();
    const cardBox = await toast.first().boundingBox();
    note(
      `[${tag}] close button top-right: ${closeBox && cardBox ? `${Math.round(cardBox.x + cardBox.width - (closeBox.x + closeBox.width))}px from right, ${Math.round(closeBox.y - cardBox.y)}px from top` : "n/a"}; aria-label=${await close.getAttribute("aria-label")}`,
    );
    const back = toast.first().locator("[data-switch-toast-back]");
    const backBox = await back.boundingBox();
    note(`[${tag}] return button: "${norm(await back.innerText())}" ${backBox ? `${Math.round(backBox.width)}x${Math.round(backBox.height)}px` : ""}`);
    if (cardBox) {
      await page.screenshot({
        path: path.join(OUT, `${LABEL}-${tag}-3-toast-closeup.png`),
        clip: { x: Math.max(0, cardBox.x - 12), y: Math.max(0, cardBox.y - 12), width: cardBox.width + 24, height: cardBox.height + 24 },
      });
    }
  }
  const sessionReread = requests.find((r) => r.method === "GET" && r.url.includes("/api/auth/session") && r.t >= clickedAt);
  const controls = requests.find(
    (r) => r.url.includes("/api/settings/journal-controls") && sessionReread && r.t >= sessionReread.t,
  );
  note(`[${tag}] client session re-read (GET /api/auth/session) after switch: ${Boolean(sessionReread)}`);
  note(`[${tag}] journal controls refetched after session re-read: ${Boolean(controls)}`);
  page.off("request", onRequest);

  if (toastShownAt) {
    // «Вернуться» — обратно в A, тост снова с возвратом.
    await toast.first().locator("[data-switch-toast-back]").click();
    await page.mouse.move(5, 5);
    const second = page.locator("[data-switch-toast]", { hasText: "ООО «Альфа»" });
    await second.first().waitFor({ state: "visible", timeout: 120000 });
    const secondShownAt = Date.now();
    await page.waitForTimeout(300);
    note(`[${tag}] after «Вернуться»: toast "${norm(await second.first().innerText())}", balance ${norm(await amount(page).textContent())}`);
    await page.screenshot({ path: path.join(OUT, `${LABEL}-${tag}-4-back-to-a.png`) });
    await page.mouse.move(5, 5);
    await second.first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const gone = (await page.locator("[data-switch-toast]").count()) === 0;
    note(`[${tag}] toast gone by itself after ${((Date.now() - secondShownAt) / 1000).toFixed(1)}s: ${gone}`);
  }
}

async function pointFlow(page) {
  const tag = "desktop-point";
  const code = process.env.JOURNAL_CODE || "hygiene";
  await page.goto(`${BASE}/journals/${code}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-current-point='switch']").first().waitFor({ timeout: 180000 });
  await settle(page);
  // Первый заход в журнал открывает «Как заполнять» — закрываем.
  const guide = page.locator("[aria-labelledby='fill-guide-title']");
  if (await guide.count()) {
    await page.keyboard.press("Escape");
    await guide.first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    if (await guide.count()) await guide.locator("button[aria-label]").first().click({ force: true });
  }
  const headerHandle = await page.$("header");
  const pageNode = await page.locator("#main-content h1").first().elementHandle();
  const trigger = page.locator("[data-current-point='switch']").first();
  note(`[${tag}] header point before: ${norm(await trigger.innerText())}`);
  await trigger.click();
  const options = page.locator("[data-point-option]:not([data-active-option])");
  const optionCount = await options.count();
  let target = null;
  for (let index = 0; index < optionCount; index++) {
    const text = norm(await options.nth(index).innerText());
    if (text.includes("Кафе")) {
      target = options.nth(index);
      break;
    }
  }
  if (!target) {
    note(`[${tag}] no other trading point option found`);
    return;
  }
  await target.click();
  const toast = page.locator("[data-switch-toast]");
  await toast.first().waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(300);
  note(`[${tag}] toast text: ${norm(await toast.first().innerText())}`);
  note(`[${tag}] header point after: ${norm(await page.locator("[data-current-point='switch']").first().innerText())}`);
  note(`[${tag}] header node kept (no shell remount on point switch): ${headerHandle ? await headerHandle.evaluate((el) => el.isConnected) : "n/a"}`);
  note(`[${tag}] page node replaced (page remounted on point switch): ${pageNode ? !(await pageNode.evaluate((el) => el.isConnected)) : "n/a"}`);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${tag}-toast.png`) });
}

(async () => {
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    await login(desktop);
    const page = await desktop.newPage();
    await orgFlow(page, { mobile: false });
    if (LABEL === "after") await pointFlow(page);
    await desktop.close();

    const phone = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
    await login(phone);
    const mobilePage = await phone.newPage();
    await orgFlow(mobilePage, { mobile: true });
    await phone.close();
  } catch (error) {
    note(`ERROR ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, `${LABEL}-log.txt`), log.join("\n") + "\n");
  }
})();
