// The owner's case in a browser, against a local production build:
// a tablet signed in by the office manager, no network, the poster of another point.
//
//   SETUP='<json printed by setup-points.ts up>' BASE_URL=http://localhost:3000 node point-qr.e2e.mjs
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const setup = JSON.parse(process.env.SETUP);
const raw = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../raw");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Galaxy Tab S4"], baseURL: base, serviceWorkers: "allow" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("  [pageerror]", String(error).slice(0, 200)));

const csrf = await (await context.request.get("/api/auth/csrf")).json();
await context.request.post("/api/auth/callback/credentials", { form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } });

const readPack = () =>
  page.evaluate(
    () =>
      new Promise(async (resolve) => {
        const names = (await indexedDB.databases()).map((item) => item.name);
        if (!names.includes("wesetup-offline-app")) return resolve(null);
        const open = indexedDB.open("wesetup-offline-app");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("kv")) return resolve(null);
          const tx = db.transaction(["kv"], "readonly");
          let out = null;
          let shell = null;
          tx.objectStore("kv").get("pack").onsuccess = (event) => (out = event.target.result ?? null);
          tx.objectStore("kv").get("shell").onsuccess = (event) => (shell = event.target.result ?? null);
          tx.oncomplete = () => {
            db.close();
            resolve(out && shell?.ok ? out.pack : null);
          };
        };
      })
  );

await page.goto("/mini", { waitUntil: "domcontentloaded" });
let pack = null;
for (let i = 0; i < 240 && !pack; i += 1) {
  pack = await readPack().catch(() => null);
  if (!pack) await page.waitForTimeout(500);
}
check("данные сохранены на устройстве, в них обе точки", pack && pack.version === 2 && pack.points.length === 2, pack ? `точки: ${pack.points.map((point) => point.name).join(", ")}; в кабинете выбрана: ${pack.point?.name ?? "—"}` : "нет данных");
if (!pack) {
  await browser.close();
  process.exit(1);
}

await context.setOffline(true);
const open = async (address) => {
  await page.goto("about:blank");
  await page.goto(`/mini-offline#u=${encodeURIComponent(address)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="offline-app"]', { timeout: 20000 });
};

await open(setup.poster);
await page.waitForSelector('[data-testid="offline-signers"]', { timeout: 15000 });
const heading = await page.locator('[data-testid="offline-journal-title"]').locator("xpath=..").innerText();
const signers = (await page.locator('[data-testid="offline-signers"]').innerText()).replace(/\s+/g, " ");
check("без сети плакат точки открыл документ этой точки", heading.includes(setup.garden) && !heading.includes(setup.office), heading.replace(/\s+/g, " "));
check("в «Кто вы?» — все сотрудники точки плаката", setup.gardenStaff.every((name) => signers.includes(name)), signers.slice(0, 200));
check("вошедшего руководителя другой точки в списке нет", !signers.includes(setup.admin));
check("в списке ровно сотрудники точки", (await page.locator('[data-testid="offline-signers"] button').count()) === setup.gardenStaff.length);
await page.screenshot({ path: path.join(raw, "01-poster-of-point-offline.png"), fullPage: true });

await page.locator(`[data-testid="offline-signers"] button:has-text("${setup.gardenStaff[0]}")`).first().click();
const formShown = await page.waitForSelector("form, [data-testid='offline-form']", { timeout: 15000 }).then(() => true).catch(() => false);
check("сотрудник точки открывает форму записи", formShown);
await page.screenshot({ path: path.join(raw, "02-form-of-point-employee.png"), fullPage: true });

// Home screen: the point chosen in the cabinet first, the other one by the selector.
await page.goto("about:blank");
await page.goto("/mini-offline", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="offline-point"]', { timeout: 20000 });
const select = page.locator('[data-testid="offline-point"]');
check("на главном экране — выбор точки", (await select.locator("option").count()) === 3, `выбрана: ${await select.evaluate((node) => node.selectedOptions[0]?.textContent)}`);
await select.selectOption(setup.gardenId);
await page.locator('[data-journal="hygiene"]').click();
await page.waitForSelector('[data-testid="offline-signers"]', { timeout: 15000 });
check("журнал с главного экрана выбранной точки — её сотрудники", (await page.locator('[data-testid="offline-signers"] button').count()) === setup.gardenStaff.length);
await page.screenshot({ path: path.join(raw, "03-home-point-journal.png"), fullPage: true });

await context.setOffline(false);
await browser.close();
writeFileSync(path.join(raw, "point-qr-e2e.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((item) => item.ok).length} of ${results.length} checks passed`);
process.exit(results.every((item) => item.ok) ? 0 : 1);
