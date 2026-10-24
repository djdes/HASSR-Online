const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
// Credentials come from the environment; never commit them.
const env = (name) => { const v = process.env[name]; if (!v) throw new Error(`set ${name}`); return v; };
const OUT = __dirname;
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

async function login(browser, email, password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  const r = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { email, password, csrfToken: csrf.csrfToken, callbackUrl: `${BASE}/dashboard`, json: "true" },
  });
  return { context, status: r.status() };
}

(async () => {
  const browser = await chromium.launch();
  const root = await login(browser, env("E2E_ROOT_EMAIL"), env("E2E_ROOT_PASSWORD"));
  const alexey = await login(browser, env("E2E_TRANSLATOR_EMAIL"), env("E2E_TRANSLATOR_PASSWORD"));
  const plain = await login(browser, env("E2E_PLAIN_EMAIL"), env("E2E_PLAIN_PASSWORD"));

  // API access rules
  check("plain user: GET /api/translations is 403", (await plain.context.request.get(`${BASE}/api/translations?category=journal-hygiene`)).status() === 403);
  check("plain user: /api/root/translators hidden", [403, 404].includes((await plain.context.request.get(`${BASE}/api/root/translators`)).status()));
  check("translator: /api/root/translators hidden", [403, 404].includes((await alexey.context.request.get(`${BASE}/api/root/translators`)).status()));
  const plainPage = await plain.context.newPage();
  const plainResp = await plainPage.goto(`${BASE}/translations`);
  check("plain user: /translations is 404", plainResp.status() === 404, plainResp.status());

  const cats = await (await alexey.context.request.get(`${BASE}/api/translations/categories`)).json();
  const total = cats.categories.reduce((a, c) => a + c.total, 0);
  check("categories cover whole catalog", total > 15000 && cats.categories[0].id === "journal-hygiene", `${cats.categories.length} categories, ${total} keys`);

  const key = "hygiene.table.today";
  const before = await (await alexey.context.request.get(`${BASE}/api/translations?q=${key}`)).json();
  const original = before.entries.find((e) => e.key === key).values.en;
  const bad = await alexey.context.request.put(`${BASE}/api/translations`, { data: { key: "hygiene.columns.month", locale: "en", value: "Month" } });
  check("placeholder loss rejected (422 argument_mismatch)", bad.status() === 422 && (await bad.json()).error === "argument_mismatch");

  // UI as translator: edit through the page
  const page = await alexey.context.newPage();
  const resp = await page.goto(`${BASE}/translations`);
  check("translator: /translations opens", resp.status() === 200, resp.status());
  await page.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  const row = page.locator(`[data-testid="translation-row"][data-key="${key}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId("translation-input-en").fill("Today (edited E2E), {dayLabel}");
  await row.getByTestId("translation-save-en").click();
  await row.getByTestId("translation-reset-en").waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/translator-editor.png`, fullPage: false });
  const after = await (await alexey.context.request.get(`${BASE}/api/translations?q=${key}`)).json();
  const entry = after.entries.find((e) => e.key === key);
  check("override saved", entry.values.en === "Today (edited E2E), {dayLabel}" && entry.overridden.includes("en"));

  // Profile menu item for translator
  await page.goto(`${BASE}/journals`);
  await page.goto(`${BASE}/mini/me`);
  await page.getByTestId("profile-translations").waitFor({ timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/translator-profile.png` });
  check("translator: profile menu has translations link", (await page.getByTestId("profile-translations").count()) > 0);

  const pp = await plain.context.newPage();
  await pp.goto(`${BASE}/mini/me`);
  await pp.waitForTimeout(4000);
  check("plain user: no translations link in profile", (await pp.getByTestId("profile-translations").count()) === 0);

  // Root page
  const rp = await root.context.newPage();
  const rr = await rp.goto(`${BASE}/root/translations`);
  check("root: /root/translations opens", rr.status() === 200, rr.status());
  await rp.getByTestId("translators-panel").waitFor({ timeout: 60000 });
  check("root: alexey listed as translator", (await rp.getByTestId("translator-row").filter({ hasText: env("E2E_TRANSLATOR_EMAIL") }).count()) === 1);
  await rp.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  await rp.screenshot({ path: `${OUT}/root-translations.png`, fullPage: false });

  // Reset
  const reset = await alexey.context.request.put(`${BASE}/api/translations`, { data: { key, locale: "en", value: null } });
  const resetEntry = (await reset.json()).entry;
  check("reset returns original", resetEntry.values.en === original && !resetEntry.overridden.includes("en"), original);

  require("fs").writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(checks, null, 2));
  await browser.close();
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
