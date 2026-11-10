// Sign-out wipes the offline pack; unsent records stay and are not delivered by another account (AC12).
import { chromium, devices } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const raw = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../raw");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: base, serviceWorkers: "allow" });
const page = await context.newPage();
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
async function login(email) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  return (await context.request.post("/api/auth/callback/credentials", { form: { email, password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } })).ok();
}
const store = () =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((item) => item.name === "wesetup-offline-app")) return { packUser: null, queue: [] };
    return new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction(["kv", "queue"], "readonly");
        const out = { packUser: null, shell: false, queue: [] };
        tx.objectStore("kv").get("shell").onsuccess = (event) => (out.shell = event.target.result?.ok === true);
        tx.objectStore("kv").get("pack").onsuccess = (event) => (out.packUser = event.target.result?.userId ?? null);
        tx.objectStore("queue").getAll().onsuccess = (event) => (out.queue = event.target.result.map((item) => ({ owner: item.ownerUserId, status: item.status, attempts: item.attempts })));
        tx.oncomplete = () => resolve(out);
      };
    });
  });
const waitPack = async (expected) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const state = await store().catch(() => null);
    if (state && (expected === null ? state.packUser === null : state.packUser !== null && state.packUser !== expected.not)) return state;
    await page.waitForTimeout(500);
  }
  return store();
};

await login("admin@haccp.local");
await page.goto("/mini", { waitUntil: "domcontentloaded" });
const first = await waitPack({ not: null });
check("pack of the signed-in account is on the device", first.packUser, String(first.packUser));
// The offline screen itself must be saved too before the network goes away.
for (let attempt = 0; attempt < 240 && !(await store().catch(() => null))?.shell; attempt++) await page.waitForTimeout(500);

// A record made without network by this account.
await context.setOffline(true);
await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
await page.locator('[data-journal="hygiene"]').click({ timeout: 20000 });
await page.locator('[data-testid="offline-signers"] button:has-text("Крылов")').first().click();
await page.locator('[data-field="temperature"]').click();
await page.locator('[data-testid="offline-journal-form"] button[type="submit"]').click();
await page.waitForSelector('[data-testid="offline-done"]', { timeout: 15000 });
// The session is gone before the network returns (cookies cleared = expired session).
const cookies = await context.cookies();
await context.clearCookies();
await context.setOffline(false);
await page.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const expired = await store();
check("AC12 with an expired session the record waits, it is neither lost nor refused", expired.queue.length === 1 && expired.queue[0].status === "pending" && expired.queue[0].attempts > 0, JSON.stringify(expired.queue));
check("AC12 the offline screen still opens for the last signed-in account without a session", (await page.locator('[data-testid="offline-user"]').innerText().catch(() => "")).includes("Крылов"));
await page.screenshot({ path: path.join(raw, "16-expired-session-record-waits.png"), fullPage: true });

// Another account signs in on the same device.
await context.addCookies(cookies.filter((cookie) => !cookie.name.includes("session")));
await login("chef@haccp.local");
await page.goto("/mini", { waitUntil: "domcontentloaded" });
const second = await waitPack({ not: first.packUser });
await page.waitForTimeout(6000);
const foreign = await store();
check("another account gets its own pack", second.packUser && second.packUser !== first.packUser, String(second.packUser));
check("AC12 a record of the previous account is not delivered by another account", foreign.queue.length === 1 && foreign.queue[0].owner === first.packUser, JSON.stringify(foreign.queue));

// Sign-out from the profile wipes the pack and keeps the record.
await page.goto("/mini/me", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /^Выйти/ }).last().click({ timeout: 20000 });
await page.getByRole("button", { name: /^Выйти/ }).last().click({ timeout: 20000 });
await page.waitForURL(/\/mini\/login/, { timeout: 30000 }).catch(() => null);
const after = await store();
check("AC12 sign-out wipes the offline pack", after.packUser === null, String(after.packUser));
check("AC12 unsent records survive sign-out", after.queue.length === 1, JSON.stringify(after.queue));

// The author signs in again — the record goes out.
await login("admin@haccp.local");
await page.goto("/mini", { waitUntil: "domcontentloaded" });
let delivered = null;
for (let attempt = 0; attempt < 240; attempt++) {
  delivered = await store().catch(() => null);
  if (delivered && delivered.queue.length === 0) break;
  await page.waitForTimeout(500);
}
check("AC12 after the author signs in again the record is delivered", delivered?.queue.length === 0, JSON.stringify(delivered?.queue));
await browser.close();
process.exit(failed > 0 ? 1 : 0);
