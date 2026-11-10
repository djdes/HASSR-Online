// End-to-end check of offline work against a local production build.
//
//   BASE_URL=http://localhost:3000 CHROME_PATH=/path/to/chrome node offline.e2e.mjs
//
// Needs the demo organization (prisma/seed-haccp-demo.ts), this month's
// documents (setup-demo.mjs) and an employee PIN (set-pin.ts). Prints one
// line per check; exits non-zero if any check fails. Screenshots → ../raw.
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const raw = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../raw");
mkdirSync(raw, { recursive: true });
const PIN_EMPLOYEE = process.env.PIN_EMPLOYEE ?? "Волкова Анна Дмитриевна";
const PIN = process.env.PIN ?? "4821";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(raw, `${name}.png`), fullPage: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: base, serviceWorkers: "allow" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("  [pageerror]", String(error).slice(0, 200)));

async function login() {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" },
  });
  return response.ok();
}

/** Reads the on-device store the way the app does. */
const readStore = () =>
  page.evaluate(
    () =>
      new Promise(async (resolve) => {
        // Never create the database from the test: the app must be the one to create its stores.
        const names = (await indexedDB.databases()).map((item) => item.name);
        if (!names.includes("wesetup-offline-app")) return resolve({ pack: null, shell: null, queue: [] });
        const open = indexedDB.open("wesetup-offline-app");
        open.onerror = () => resolve({ pack: null, shell: null, queue: [] });
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("kv")) return resolve({ pack: null, shell: null, queue: [] });
          const tx = db.transaction(["kv", "queue"], "readonly");
          const out = { pack: null, shell: null, queue: [] };
          tx.objectStore("kv").get("pack").onsuccess = (event) => (out.pack = event.target.result ?? null);
          tx.objectStore("kv").get("shell").onsuccess = (event) => (out.shell = event.target.result ?? null);
          tx.objectStore("queue").getAll().onsuccess = (event) => (out.queue = event.target.result ?? []);
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      })
  );

async function waitFor(fn, timeoutMs = 60000, stepMs = 500) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) return null;
    await page.waitForTimeout(stepMs);
  }
}

const text = (testId) => page.locator(`[data-testid="${testId}"]`).first().innerText({ timeout: 15000 }).catch(() => "");
const visible = (testId) => page.locator(`[data-testid="${testId}"]`).first().isVisible().catch(() => false);
const click = (selector) => page.locator(selector).first().click({ timeout: 15000 });
/** Opens the offline screen the way the app does for a scanned link: a fresh load with the address in the anchor. */
async function openEntry(address) {
  await page.goto("about:blank");
  await page.goto(`/mini-offline#u=${encodeURIComponent(address)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="offline-app"]', { timeout: 20000 }).catch(() => null);
}
const pickSigner = (name) => click(`[data-testid="offline-signers"] button:has-text("${name}")`);

// ---------------------------------------------------------------- online: device gets ready
check("login", await login());
const htmlAnon = await (await (await browser.newContext()).request.get(`${base}/mini-offline`)).text();
const htmlAuthed = await (await context.request.get("/mini-offline")).text();
const personal = ["Крылов", "haccp.local", "HACCP Demo"];
check("AC1 offline screen HTML carries no personal data", !personal.some((word) => htmlAnon.includes(word) || htmlAuthed.includes(word)));

await page.goto("/mini", { waitUntil: "domcontentloaded" });
const ready = await waitFor(async () => {
  const store = await readStore();
  return store.pack && store.shell?.ok ? store : null;
}, 120000);
check("AC1/AC4 pack and offline screen are saved on the device", ready, ready ? `journals ${ready.pack.pack.journals.length}, objects ${ready.pack.pack.objects.length}` : JSON.stringify((await readStore()).shell));
if (!ready) {
  await browser.close();
  process.exit(1);
}
const pack = ready.pack.pack;
writeFileSync(
  path.join(raw, "pack-summary.json"),
  JSON.stringify(
    {
      organization: pack.organization,
      user: pack.user,
      employees: pack.employees.length,
      employeesWithPin: pack.employees.filter((employee) => employee.pin).length,
      journals: pack.journals.map((journal) => ({ code: journal.code, name: journal.name, append: journal.append, documents: journal.documents.length })),
      objects: pack.objects.map((object) => ({ name: object.name, fill: object.fill, temperature: object.temperature })),
    },
    null,
    2
  )
);
const pinEmployee = pack.employees.find((employee) => employee.name === PIN_EMPLOYEE);
check("AC15 pack holds a PIN verifier, not the PIN or the database hash", pinEmployee?.pin?.hash && !JSON.stringify(pack).includes(PIN) && !JSON.stringify(pack).includes("$2"), pinEmployee ? `iterations ${pinEmployee.pin?.iterations}` : "employee not found");
const cacheKeys = await page.evaluate(async () => {
  const out = {};
  for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
  return out;
});
const cachedPages = Object.values(cacheKeys).flat().filter((item) => !item.startsWith("/_next/static/") && !item.startsWith("/icons/") && !item.startsWith("/brand/"));
check("AC3 only the impersonal offline screen is cached, no cabinet pages", cachedPages.length === 1 && cachedPages[0] === "/mini-offline", cachedPages.join(", "));

await page.goto("/mini/me", { waitUntil: "domcontentloaded" });
const status = await text("offline-ready-status");
check("AC13 profile shows readiness", status.includes("Готово к работе без связи"), status.replace(/\s+/g, " "));
await shot(page, "01-online-profile-ready");

// ---------------------------------------------------------------- offline: start, QR, forms
await context.setOffline(true);

await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="offline-app"]', { timeout: 20000 }).catch(() => null);
check("AC2 app start without network opens the offline screen", new URL(page.url()).pathname === "/mini-offline" && (await text("offline-user")).includes("Крылов"), page.url());
check("AC2 data stamp and lists are shown", (await text("offline-data-stamp")).includes("Данные от") && (await page.locator('[data-testid="offline-journals"] button').count()) === pack.journals.length);
check("AC13 offline badge", (await text("offline-network")).includes("Без связи"));
await shot(page, "02-offline-home");

for (const start of ["/mini/today", "/mini"]) {
  await page.goto(start, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="offline-app"]', { timeout: 20000 }).catch(() => null);
  check(`AC2 ${start} without network → offline screen`, new URL(page.url()).pathname === "/mini-offline");
}

// QR of a fridge, as the service worker passes it (the address that failed to open).
const fridge = pack.objects.find((object) => object.fill === "temperature" && object.temperature?.max != null);
const fridgeUrl = `/equipment-fill/${encodeURIComponent(fridge.id)}?token=${encodeURIComponent(fridge.token)}`;
await openEntry(fridgeUrl);
check("AC6 fridge QR without network opens this fridge", (await text("offline-object-title")) === fridge.name, await text("offline-object-title"));
await shot(page, "03-offline-qr-fridge-who");

// The signed-in account signs as itself.
await pickSigner("Крылов");
const okTemp = fridge.temperature.max - 1;
await page.fill('[data-testid="offline-temperature"]', String(okTemp));
await shot(page, "04-offline-fridge-form");
await click('[data-testid="offline-object-form"] button[type="submit"]');
check("AC6/AC8 fridge reading is saved on the device", (await text("offline-done")).includes("Сохранено на устройстве"), (await text("offline-done")).replace(/\s+/g, " ").slice(0, 120));
await shot(page, "05-offline-saved");

// Same fridge by an employee with a PIN: wrong PIN is refused, right PIN lets in; out of norm needs a comment.
await openEntry(fridgeUrl);
await page.waitForSelector('[data-testid="offline-signers"]', { timeout: 15000 });
await pickSigner(PIN_EMPLOYEE.split(" ")[0]);
check("AC15 employee with a PIN is asked for it", await visible("offline-pin-step"));
await page.fill('[data-testid="offline-pin-input"]', "0000", { force: true });
await click('[data-testid="offline-pin-submit"]');
const wrongPin = await page.locator('[data-testid="offline-pin-step"] [role="alert"]').innerText({ timeout: 15000 }).catch(() => "");
check("AC15 wrong PIN is refused without network", wrongPin.includes("Неверный ПИН"), wrongPin);
await shot(page, "06-offline-pin-wrong");
await page.fill('[data-testid="offline-pin-input"]', PIN, { force: true });
await click('[data-testid="offline-pin-submit"]');
check("AC15 right PIN opens the form", await page.waitForSelector('[data-testid="offline-object-form"]', { timeout: 15000 }).then(() => true, () => false));
const badTemp = fridge.temperature.max + 6;
await page.fill('[data-testid="offline-temperature"]', String(badTemp));
await click('[data-testid="offline-object-form"] button[type="submit"]');
check("AC6 out-of-norm reading asks what was done", (await page.locator('[data-testid="offline-object-form"] [role="alert"]').innerText().catch(() => "")).includes("вне нормы"));
await page.fill('[data-testid="offline-object-correction"]', "Закрыли дверь, проверим через 30 минут");
await shot(page, "07-offline-out-of-norm");
await click('[data-testid="offline-object-form"] button[type="submit"]');
check("AC8 second reading saved", (await text("offline-done")).includes("Сохранено на устройстве"));

// Unknown sticker and a sticker of another organization.
await openEntry("/equipment-fill/unknown-object?token=x");
check("AC6 unknown object is reported", (await text("offline-notice")).includes("нет в сохранённых данных"));
await openEntry("/journal-fill/other-org/hygiene?token=x");
check("AC6 QR of another organization is refused", (await text("offline-notice")).includes("другой организации"));

// Journal poster QR → brakerage of finished products (every record is a new row).
const brak = pack.journals.find((journal) => journal.code === "finished_product");
await openEntry(`/journal-fill/${pack.organization.id}/finished_product?token=${brak.token}`);
check("AC6 journal QR opens that journal", (await text("offline-journal-title")).length > 0, await text("offline-journal-title"));
await pickSigner("Крылов");
await page.fill('[data-field="productName"]', "Борщ (проверка без связи)");
await page.fill('[data-field="productionTime"]', "09:30");
await shot(page, "08-offline-brakerage-form");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC7 finished-product brakerage saved without network", (await text("offline-done")).includes("Сохранено на устройстве"));

// From the list: perishable brakerage, required fields are enforced.
await click('[data-testid="offline-done"] button:has-text("К списку")');
await click('[data-journal="perishable_rejection"]');
await pickSigner("Крылов");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC7 required fields are enforced offline", (await page.locator('[data-testid="offline-journal-form"] [role="alert"]').innerText().catch(() => "")).includes("Проверьте"));
await page.fill('[data-field="productName"]', "Молоко 3,2%");
await page.fill('[data-field="supplier"]', "ООО Молочный двор");
await page.fill('[data-field="quantity"]', "12 л");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC7 perishable brakerage saved without network", (await text("offline-done")).includes("Сохранено на устройстве"));

// Hygiene (one row per employee per day): today, then a past day.
await click('[data-testid="offline-done"] button:has-text("К списку")');
await click('[data-journal="hygiene"]');
await pickSigner("Крылов");
const days = await page.locator('[data-testid="offline-day"] option').count();
check("AC17 past days are offered", days > 1, `${days} days`);
await click('[data-field="temperature"]');
await click('[data-field="infection"]');
await shot(page, "09-offline-hygiene-today");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC7 hygiene saved without network", (await text("offline-done")).includes("Сохранено на устройстве"));

await click('[data-testid="offline-done"] button:has-text("К списку")');
await click('[data-journal="hygiene"]');
await pickSigner("Крылов");
check("AC17 unsent record of this device is shown in the form", (await text("offline-row-state")).includes("ещё не отправлена"));
const pastDay = await page.locator('[data-testid="offline-day"] option').nth(2).getAttribute("value");
await page.selectOption('[data-testid="offline-day"]', pastDay);
await click('[data-field="respiratorySkin"]');
await shot(page, "10-offline-hygiene-past-day");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC17 past-day record saved without network", (await text("offline-done")).includes("Сохранено на устройстве"), pastDay);

// General cleaning: a row journal with step-by-step instructions.
if (pack.journals.some((journal) => journal.code === "general_cleaning")) {
  await click('[data-testid="offline-done"] button:has-text("К списку")');
  await click('[data-journal="general_cleaning"]');
  await click('[data-testid="offline-rows"] button');
  await pickSigner("Крылов");
  check("AC7 cleaning steps are shown", (await page.locator('[data-testid="offline-steps"] li').count()) > 0);
  await shot(page, "11-offline-general-cleaning");
  await click('[data-testid="offline-journal-form"] button[type="submit"]');
  check("AC7 general cleaning saved without network", (await text("offline-done")).includes("Сохранено на устройстве"));
}

// The queue survives a restart of the app.
await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="offline-queue-link"]', { timeout: 20000 }).catch(() => null);
const queued = (await readStore()).queue;
check("AC8 queue survives reopening the app", queued.length >= 6, `${queued.length} records`);
check("AC8 queue holds author, device account and device time, and no PIN", queued.every((item) => item.ownerUserId && item.employeeId && item.recordedAt) && !JSON.stringify(queued).includes(PIN));
await click('[data-testid="offline-queue-link"]');
await shot(page, "12-offline-queue");

// Move the first fridge reading to yesterday 23:30 (organization time) to prove the day comes from the device time.
const yesterday2330 = await page.evaluate(
  ({ timeZone }) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 24 * 3600 * 1000));
    // 23:30 in Moscow is 20:30 UTC.
    return `${parts}T20:30:00.000Z`;
  },
  { timeZone: pack.organization.timeZone }
);
const movedId = await page.evaluate(
  ({ recordedAt, objectId }) =>
    new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("queue", "readwrite");
        const store = tx.objectStore("queue");
        store.getAll().onsuccess = (event) => {
          const item = event.target.result.find((row) => row.target.objectId === objectId && row.auth === "self");
          if (item) store.put({ ...item, recordedAt });
          tx.oncomplete = () => {
            db.close();
            resolve(item?.id ?? null);
          };
        };
      };
    }),
  { recordedAt: yesterday2330, objectId: fridge.id }
);
check("test setup: one reading is dated yesterday 23:30", movedId, yesterday2330);

// ---------------------------------------------------------------- network is back: sync
await context.setOffline(false);
await page.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
const synced = await waitFor(async () => {
  const store = await readStore();
  return store.queue.every((item) => item.status !== "pending" || item.attempts > 3) ? store : null;
}, 90000, 1000);
const left = (await readStore()).queue;
check("AC9 queue is delivered when the network is back", left.length === 0, left.map((item) => `${item.label}: ${item.status} ${item.lastError ?? ""}`).join(" | "));
await shot(page, "13-online-synced");

const result = { yesterday2330, movedId, pastDay, fridgeId: fridge.id, pinEmployeeId: pinEmployee?.id ?? null, userId: pack.user.id, okTemp, badTemp, orgId: pack.organization.id, timeZone: pack.organization.timeZone, todayKey: pack.todayKey };

// A repeat of an already delivered record does not write twice.
const replay = await context.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, {
  headers: { "Idempotency-Key": String(movedId), "x-offline-recorded-at": yesterday2330, "x-offline-auth": "self" },
  data: { token: fridge.token, employeeId: pack.user.id, temperature: okTemp },
});
check("AC9 repeated delivery is answered from the first one", replay.headers()["idempotent-replayed"] === "true", `status ${replay.status()}`);

// Time bounds are enforced by the server.
const future = await context.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, {
  headers: { "Idempotency-Key": "e2e-future-000000000000", "x-offline-recorded-at": new Date(Date.now() + 3600_000).toISOString(), "x-offline-auth": "self" },
  data: { token: fridge.token, employeeId: pack.user.id, temperature: okTemp },
});
check("AC10 a record from the future is refused", future.status() === 422 && JSON.stringify(await future.json()).includes("offline-time-future"), `status ${future.status()}`);
const old = await context.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, {
  headers: { "Idempotency-Key": "e2e-too-old-000000000000", "x-offline-recorded-at": new Date(Date.now() - 33 * 24 * 3600_000).toISOString(), "x-offline-auth": "self" },
  data: { token: fridge.token, employeeId: pack.user.id, temperature: okTemp },
});
check("AC10 a record older than 31 days is refused", old.status() === 422 && JSON.stringify(await old.json()).includes("offline-time-too-old"), `status ${old.status()}`);

// Offline headers without a session are not trusted.
const anonymous = await (await browser.newContext()).request.post(`${base}/api/equipment-fill/${encodeURIComponent(fridge.id)}`, {
  headers: { "x-offline-recorded-at": yesterday2330, "x-offline-auth": "self" },
  data: { token: fridge.token, employeeId: pack.user.id, temperature: okTemp },
});
check("AC12 offline headers without a signed-in device are refused", anonymous.status() === 401, `status ${anonymous.status()}`);

// A stale PIN fingerprint is refused, and stays fixable.
const stalePin = await context.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, {
  headers: { "Idempotency-Key": "e2e-stale-pin-0000000000", "x-offline-recorded-at": new Date().toISOString(), "x-offline-auth": "pin", "x-offline-pin-fp": "stale000" },
  data: { token: fridge.token, employeeId: pinEmployee.id, temperature: okTemp },
});
check("AC16 a changed PIN keeps the record out of the journal", stalePin.status() === 409 && JSON.stringify(await stalePin.json()).includes("offline-pin-changed"), `status ${stalePin.status()}`);

// ---------------------------------------------------------------- merge
// Device A filled hygiene for the past day (above, already synced). Refresh the pack so the device sees it.
await page.goto("/mini", { waitUntil: "domcontentloaded" });
await page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open("wesetup-offline-app");
  open.onsuccess = () => {
    const tx = open.result.transaction("kv", "readwrite");
    tx.objectStore("kv").delete("pack");
    tx.oncomplete = () => resolve(null);
  };
}));
await page.reload({ waitUntil: "domcontentloaded" });
const refreshed = await waitFor(async () => (await readStore()).pack, 60000);
const hygiene = refreshed?.pack.journals.find((journal) => journal.code === "hygiene");
const rowKey = `employee-${pack.user.id}`;
const seen = hygiene?.documents[0].history[rowKey]?.[pastDay];
check("AC17 pack history holds the saved past-day values", seen && seen.respiratorySkin === true, JSON.stringify(seen));

await context.setOffline(true);
await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
await click('[data-journal="hygiene"]');
await pickSigner("Крылов");
await page.selectOption('[data-testid="offline-day"]', pastDay);
check("AC17 saved past-day values are shown in the form", (await page.locator('[data-field="respiratorySkin"]').getAttribute("aria-checked")) === "true" && (await text("offline-row-state")).includes("уже есть"));
// Offline: tick «infection» and untick «respiratorySkin».
await click('[data-field="infection"]');
await click('[data-field="respiratorySkin"]');
await click('[data-testid="offline-journal-form"] button[type="submit"]');
await page.waitForSelector('[data-testid="offline-done"]', { timeout: 15000 });

// Meanwhile "another device" changed the same row online: temperature → true (no overlap), respiratorySkin stays true.
const other = await context.request.post(`/api/journal-fill/${pack.organization.id}/hygiene`, {
  headers: { "Idempotency-Key": "e2e-other-device-00000001", "x-offline-recorded-at": new Date().toISOString(), "x-offline-day": pastDay, "x-offline-auth": "self" },
  data: { token: hygiene.token, documentId: hygiene.documents[0].id, employeeId: pack.user.id, rowKey, values: { temperature: true, infection: false, respiratorySkin: true }, base: seen },
});
check("merge setup: another device changed the row", other.ok(), `status ${other.status()}`);
await context.setOffline(false);

await page.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
const merged = await waitFor(async () => {
  const store = await readStore();
  return store.queue.every((item) => item.status !== "pending") ? store : null;
}, 60000, 1000);
check("AC18 non-overlapping edits merge without a conflict", merged && merged.queue.length === 0, merged ? JSON.stringify(merged.queue.map((item) => [item.status, item.conflicts])) : "timeout");

// Two devices deliver edits of one row in the same instant: neither may be lost.
{
  const cvc = pack.journals.find((journal) => journal.code === "cleaning_ventilation_checklist");
  if (cvc) {
    const url = `/api/journal-fill/${pack.organization.id}/cleaning_ventilation_checklist`;
    const start = { proc_disinfection: false, proc_ventilation: false, proc_wet_cleaning: false };
    const post = (key, values, baseValues) =>
      context.request.post(url, {
        headers: { "Idempotency-Key": key, "x-offline-recorded-at": new Date().toISOString(), "x-offline-auth": "self" },
        data: { token: cvc.token, documentId: cvc.documents[0].id, employeeId: pack.user.id, rowKey, values, base: baseValues },
      });
    await post("e2e-race-start-000000001", start, {});
    const [left, right] = await Promise.all([
      post("e2e-race-left-0000000001", { ...start, proc_disinfection: true }, start),
      post("e2e-race-right-000000001", { ...start, proc_wet_cleaning: true }, start),
    ]);
    const raced = (await (await context.request.get("/api/offline/pack")).json()).journals.find((journal) => journal.code === "cleaning_ventilation_checklist").documents[0].history[rowKey]?.[pack.todayKey];
    check("AC18 two devices syncing the same row at the same instant both keep their edits", left.ok() && right.ok() && raced?.proc_disinfection === true && raced?.proc_wet_cleaning === true && raced?.proc_ventilation === false, JSON.stringify(raced));
  }
}

const afterMerge = (await (await context.request.get("/api/offline/pack")).json()).journals.find((journal) => journal.code === "hygiene").documents[0].history[rowKey]?.[pastDay];
check("AC18 merged row holds both edits", afterMerge && afterMerge.temperature === true && afterMerge.infection === true && afterMerge.respiratorySkin === false, JSON.stringify(afterMerge));

// A real conflict needs a field with more than two values: disinfectant journal (text fields, one row per employee per day).
const dis = pack.journals.find((journal) => journal.code === "disinfectant_usage");
if (dis) {
  const disUrl = `/api/journal-fill/${pack.organization.id}/disinfectant_usage`;
  const common = { token: dis.token, documentId: dis.documents[0].id, employeeId: pack.user.id, rowKey };
  const send = (key, values, baseValues, extra = {}) =>
    context.request.post(disUrl, {
      headers: { "Idempotency-Key": key, "x-offline-recorded-at": new Date().toISOString(), "x-offline-auth": "self" },
      data: { ...common, values, base: baseValues, ...extra },
    });
  const first = { disinfectantName: "Хлорамин", quantity: "1", unit: "kg", expiryDate: "2027-01-01" };
  const r1 = await send("e2e-dis-first-0000000001", first, {});
  const r2 = await send("e2e-dis-other-0000000001", { ...first, quantity: "2" }, first);
  const r3 = await send("e2e-dis-stale-0000000001", { ...first, quantity: "3", disinfectantName: "Хлорамин Б" }, first);
  const b3 = await r3.json();
  writeFileSync(path.join(raw, "merge-conflict-response.json"), JSON.stringify(b3, null, 2));
  check("merge setup: two devices wrote the row", r1.ok() && r2.ok(), `${r1.status()} ${r2.status()}`);
  check(
    "AC18 a field changed differently on both sides is reported; the journal keeps its value",
    r3.ok() && b3.conflicts?.length === 1 && b3.conflicts[0].key === "quantity" && b3.conflicts[0].theirs === "2" && b3.conflicts[0].mine === "3",
    JSON.stringify(b3.conflicts)
  );
  const historyOf = async () => (await (await context.request.get("/api/offline/pack")).json()).journals.find((journal) => journal.code === "disinfectant_usage").documents[0].history[rowKey]?.[pack.todayKey];
  const kept = await historyOf();
  check("AC18 the non-conflicting field of the same record is still written", kept?.quantity === "2" && kept?.disinfectantName === "Хлорамин Б", JSON.stringify(kept));
  const r4 = await send("e2e-dis-force-0000000001", { ...first, quantity: "3", disinfectantName: "Хлорамин Б" }, first, { force: true });
  const b4 = await r4.json();
  const forced = await historyOf();
  check("AC18 «Записать моё» writes the device value", r4.ok() && !b4.conflicts && forced?.quantity === "3", JSON.stringify(forced));
}

// ---------------------------------------------------------------- the app: marker cookie and links from the system camera
const plain = devices["Pixel 7"].userAgent;
const viaWorker = await (await context.request.get("/mini-offline", { headers: { "user-agent": plain, cookie: "wesetup-app=1.1.0-android" } })).text();
const browserOnly = await (await context.request.get("/mini-offline", { headers: { "user-agent": plain } })).text();
check("AC3 the app is recognised by the cookie when the User-Agent suffix is missing", viaWorker.includes("viewport-fit=cover") && !browserOnly.includes("viewport-fit=cover"));

const appContext = await browser.newContext({ ...devices["Pixel 7"], userAgent: `${plain} WeSetupApp/1.1.0 (android)`, baseURL: base, serviceWorkers: "allow" });
await appContext.addInitScript(() => {
  const listeners = {};
  window.__appListeners = listeners;
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      App: {
        addListener: (event, callback) => {
          listeners[event] = callback;
          return Promise.resolve({ remove: () => Promise.resolve() });
        },
        getLaunchUrl: () => Promise.resolve({ url: window.localStorage.getItem("e2e-launch-url") ?? undefined }),
        minimizeApp: () => Promise.resolve(),
      },
    },
  };
});
const appPage = await appContext.newPage();
{
  const csrf = await (await appContext.request.get("/api/auth/csrf")).json();
  await appContext.request.post("/api/auth/callback/credentials", { form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } });
}
await appPage.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
const appStore = () =>
  appPage.evaluate(async () => {
    if (!(await indexedDB.databases()).some((item) => item.name === "wesetup-offline-app")) return null;
    return new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", "readonly");
        const out = {};
        tx.objectStore("kv").get("pack").onsuccess = (event) => (out.pack = Boolean(event.target.result));
        tx.objectStore("kv").get("shell").onsuccess = (event) => (out.shell = event.target.result?.ok === true);
        tx.oncomplete = () => resolve(out);
      };
    });
  });
let appReady = null;
for (let attempt = 0; attempt < 240 && !appReady; attempt++) {
  const state = await appStore().catch(() => null);
  if (state?.pack && state.shell) appReady = state;
  else await appPage.waitForTimeout(500);
}
const appWorker = await appPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
const appCookie = await appPage.evaluate(() => document.cookie.includes("wesetup-app=1.1.0-android"));
check("AC3 inside the app the worker is registered and the marker cookie is set", appReady && appWorker === 1 && appCookie, `workers ${appWorker}, cookie ${appCookie}`);

// Cold start of the app by a sticker link, no network: the start address fails, the link comes from getLaunchUrl.
const lamp = pack.objects.find((object) => object.fill === "uv");
await appPage.evaluate((url) => {
  window.localStorage.setItem("e2e-launch-url", url);
  window.sessionStorage.clear();
}, `https://wesetup.ru/equipment-fill/${fridge.id}?token=${encodeURIComponent(fridge.token)}`);
await appContext.setOffline(true);
await appPage.goto("about:blank");
await appPage.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
const coldTitle = await appPage.locator('[data-testid="offline-object-title"]').innerText({ timeout: 20000 }).catch(() => "");
check("AC6 app cold start by a sticker link without network opens that object", coldTitle === fridge.name, coldTitle);
await appPage.screenshot({ path: path.join(raw, "14-app-cold-start-by-link.png"), fullPage: true });

// The app is already open on the offline screen; the system camera delivers another link as an event.
if (lamp) {
  await appPage.evaluate((url) => window.__appListeners.appUrlOpen({ url }), `https://wesetup.ru/equipment-fill/${lamp.id}?token=${encodeURIComponent(lamp.token)}`);
  const lampTitle = await appPage.locator('[data-testid="offline-object-title"]').innerText({ timeout: 15000 }).catch(() => "");
  check("AC6 a link from the system camera (appUrlOpen) opens the UV lamp form", lampTitle === lamp.name, lampTitle);
  await appPage.locator('[data-testid="offline-signers"] button:has-text("Крылов")').first().click();
  check("AC6 UV lamp: «Я включил / Я выключил»", await appPage.locator('[data-testid="offline-uv-form"]').isVisible().catch(() => false));
  await appPage.screenshot({ path: path.join(raw, "15-app-uv-lamp.png"), fullPage: true });
  await appPage.locator('[data-testid="offline-uv-form"] button:has-text("Я включил")').click();
  await appPage.waitForSelector('[data-testid="offline-done"]', { timeout: 15000 });
  await appContext.setOffline(false);
  await appPage.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
  let lampLeft = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    lampLeft = await appPage.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("wesetup-offline-app");
          open.onsuccess = () => {
            const tx = open.result.transaction("queue", "readonly");
            tx.objectStore("queue").getAll().onsuccess = (event) => resolve(event.target.result.map((item) => `${item.status}: ${item.lastError ?? ""}`));
          };
        })
    );
    if (lampLeft.length === 0 || !lampLeft.some((item) => item.startsWith("pending"))) break;
    await appPage.waitForTimeout(1000);
  }
  check("AC9 UV lamp switch-on made without network is delivered", lampLeft.length === 0, lampLeft.join(" | "));
}
await appContext.close();

writeFileSync(path.join(raw, "e2e-context.json"), JSON.stringify(result, null, 2));
writeFileSync(path.join(raw, "e2e-results.json"), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
