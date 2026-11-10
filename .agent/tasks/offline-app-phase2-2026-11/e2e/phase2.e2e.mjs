// End-to-end check of the second stage of offline work against a local production build.
//
//   BASE_URL=http://localhost:3000 CHROME_PATH=/path/to/chrome node phase2.e2e.mjs
//
// Preparation (local demo database only), in this order:
//   sh ../../offline-app-2026-11/e2e/reset-demo.sh
//   npx tsx setup-rooms.ts            # building + rooms
//   node ../../offline-app-2026-11/e2e/setup-demo.mjs   # this month's documents
//   npx tsx setup-rooms.ts            # daily cleaning document → those rooms
//   npx tsx ../../offline-app-2026-11/e2e/set-pin.ts
// Prints one line per check; exits non-zero if any fails. Screenshots → ../raw.
import { chromium, devices } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const raw = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../raw");
mkdirSync(raw, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const sql = (query) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "haccp_online", "-Atc", query], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" } }).toString().trim();

// A real 1×1 PNG and an oversized "image" for the size check.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const HUGE = Buffer.alloc(6 * 1024 * 1024, 1);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: base, serviceWorkers: "allow" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("  [pageerror]", String(error).slice(0, 200)));
const shot = (name) => page.screenshot({ path: path.join(raw, `${name}.png`), fullPage: true });

async function login(ctx, email) {
  const csrf = await (await ctx.request.get("/api/auth/csrf")).json();
  return (await ctx.request.post("/api/auth/callback/credentials", { form: { email, password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } })).ok();
}

const readStore = () =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((item) => item.name === "wesetup-offline-app")) return { pack: null, shell: null, tasks: null, queue: [] };
    return new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction(["kv", "queue"], "readonly");
        const out = { pack: null, shell: null, tasks: null, queue: [] };
        tx.objectStore("kv").get("pack").onsuccess = (event) => (out.pack = event.target.result ?? null);
        tx.objectStore("kv").get("shell").onsuccess = (event) => (out.shell = event.target.result ?? null);
        tx.objectStore("kv").get("tasks").onsuccess = (event) => (out.tasks = event.target.result ?? null);
        tx.objectStore("queue").getAll().onsuccess = (event) =>
          (out.queue = (event.target.result ?? []).map((item) => ({ ...item, photos: Object.fromEntries(Object.entries(item.photos ?? {}).map(([slot, blob]) => [slot, blob.size])) })));
        tx.oncomplete = () => resolve(out);
      };
    });
  });

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
const click = (selector) => page.locator(selector).first().click({ timeout: 15000 });
const pickSigner = (name) => click(`[data-testid="offline-signers"] button:has-text("${name}")`);
const saved = () => page.waitForSelector('[data-testid="offline-done"]', { timeout: 20000 }).then(() => true, () => false);
const toList = () => click('[data-testid="offline-to-list"]');
async function offlineHome() {
  await page.goto("about:blank");
  await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="offline-app"]', { timeout: 20000 });
}

// ---------------------------------------------------------------- online: device gets ready
check("login", await login(context, "admin@haccp.local"));
await page.goto("/mini", { waitUntil: "domcontentloaded" });
const ready = await waitFor(async () => {
  const store = await readStore();
  return store.pack && store.shell?.ok && store.tasks ? store : null;
}, 150000);
check("device is ready: pack, offline screen and today's tasks are saved", ready, ready ? `journals ${ready.pack.pack.journals.length}, objects ${ready.pack.pack.objects.length}` : JSON.stringify(await readStore()).slice(0, 200));
if (!ready) {
  await browser.close();
  process.exit(1);
}
const pack = ready.pack.pack;
const userId = pack.user.id;
const fridge = pack.objects.find((object) => object.fill === "temperature" && object.temperature?.max != null);
const room = pack.objects.find((object) => object.kind === "room");
const fryer = pack.objects.find((object) => object.fill === "fryer");
const cleaning = pack.journals.find((journal) => journal.code === "cleaning");
writeFileSync(
  path.join(raw, "pack-summary.json"),
  JSON.stringify(
    {
      objects: pack.objects.map((object) => ({ name: object.name, kind: object.kind, fill: object.fill, photo: object.photo, today: object.today, fryer: object.fryer ? { fatTypes: object.fryer.fatTypes.length, productTypes: object.fryer.productTypes.length, phase: object.fryer.phase } : undefined })),
      journals: pack.journals.map((journal) => ({ code: journal.code, append: journal.append, documents: journal.documents.map((document) => ({ rows: document.rows.length, perEmployee: document.perEmployee, todayCount: document.todayCount })) })),
      tasks: ready.tasks.groups.map((group) => ({ code: group.code, tasks: group.tasks.length })),
    },
    null,
    2
  )
);
check("AC5 pack: fryer can be filled offline, with fat and product lists", fryer && fryer.fryer.fatTypes.length > 0 && fryer.fryer.productTypes.length > 0, fryer ? JSON.stringify(fryer.fryer).slice(0, 120) : "no fryer in pack");
check("AC6 pack: rooms (climate) and the daily cleaning journal with rows are there", room && cleaning && cleaning.documents[0].rows.length > 0, `room ${room?.name}, cleaning rows ${cleaning?.documents[0]?.rows.length}`);
check("AC1 pack: photo mode of readings comes from the organization setting", fridge.photo === "optional" || fridge.photo === "required", fridge.photo);

// Heartbeat: the device reported itself.
const device = await waitFor(async () => {
  const row = sql(`select label, "pendingCount", "stuckCount", ("packAt" is not null) from "OfflineDevice" where "userId" = '${userId}'`);
  return row || null;
}, 30000);
check("AC10 the device reported itself to the server", device && device.includes("Chrome (Android)"), device ?? "no row");

// Profile: refresh button gives a newer stamp.
await page.goto("/mini/me", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="offline-ready-status"]', { timeout: 20000 });
const before = (await readStore()).pack.savedAt;
await page.waitForTimeout(1100);
await click('[data-testid="offline-refresh"]');
const refreshed = await waitFor(async () => ((await readStore()).pack.savedAt > before ? true : null), 60000);
check("AC7 «Обновить данные» in the profile downloads fresh data", refreshed);
await shot("01-profile-refresh");

// ---------------------------------------------------------------- languages
const anon = await browser.newContext({ ...devices["Pixel 7"], baseURL: base });
for (const [locale, phrase] of [["ru", "Работаем без связи"], ["en", "Working offline"], ["uz", "Aloqasiz ishlayapmiz"]]) {
  const html = await (await anon.request.get("/mini-offline", { headers: { cookie: `wesetup.site-locale=${locale}` } })).text();
  check(`AC12 offline screen texts in ${locale}`, html.includes(phrase));
}

// ---------------------------------------------------------------- offline work
await context.setOffline(true);
await offlineHome();
const summaryBefore = await text("offline-summary");
check("AC8 home shows today's summary", /\d+.*\d+/.test(summaryBefore), summaryBefore);
check("AC9 today's tasks are shown read-only (or there are none today)", ready.tasks.groups.length === 0 || (await page.locator('[data-testid="offline-tasks"]').isVisible()), `${ready.tasks.groups.length} groups`);
await shot("02-offline-home");

// Fridge with a photo of the reading.
await click(`[data-object="${fridge.id}"]`);
await pickSigner("Крылов");
await page.setInputFiles('[data-testid="offline-reading-photo-input"]', { name: "huge.jpg", mimeType: "image/jpeg", buffer: HUGE });
check("AC1 an oversized photo is refused on the device", (await page.locator('[data-testid="offline-reading-photo"] [role="alert"]').innerText().catch(() => "")).includes("МБ"));
await page.setInputFiles('[data-testid="offline-reading-photo-input"]', { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
check("AC1 a file that is not a picture is refused on the device", (await page.locator('[data-testid="offline-reading-photo"] [role="alert"]').innerText().catch(() => "")).includes("JPG"));
await page.setInputFiles('[data-testid="offline-reading-photo-input"]', { name: "reading.png", mimeType: "image/png", buffer: PNG });
await page.fill('[data-testid="offline-temperature"]', String(fridge.temperature.max - 1));
await shot("03-offline-fridge-photo");
await click('[data-testid="offline-object-form"] button[type="submit"]');
check("AC1 fridge reading with a photo is saved on the device", await saved());
const withPhoto = (await readStore()).queue.find((item) => item.target.objectId === fridge.id);
check("AC1 the photo waits in the queue with the record", withPhoto?.photos?.reading === PNG.length && withPhoto.body.photo === "offline-photo:reading", JSON.stringify({ photos: withPhoto?.photos, photo: withPhoto?.body.photo }));

// Room climate.
await toList();
await click(`[data-object="${room.id}"]`);
await pickSigner("Крылов");
await page.fill('[data-testid="offline-temperature"]', "21");
await page.fill('[data-testid="offline-humidity"]', "50");
await shot("04-offline-room-climate");
await click('[data-testid="offline-object-form"] button[type="submit"]');
check("AC6 room climate is saved without network", await saved());

// Fryer: start, then end.
await toList();
await click(`[data-object="${fryer.id}"]`);
await pickSigner("Крылов");
check("AC5 fryer form opens on «Начало жарки»", (await page.locator('[data-testid="offline-fryer-start"]').getAttribute("aria-checked")) === "true");
await shot("05-offline-fryer-start");
await click('[data-testid="offline-fryer-form"] button[type="submit"]');
check("AC5 fryer start is saved without network", await saved());
await toList();
await click(`[data-object="${fryer.id}"]`);
await pickSigner("Крылов");
check("AC5 after a queued start the form offers «Окончание жарки»", (await page.locator('[data-testid="offline-fryer-end"]').getAttribute("aria-checked")) === "true");
await page.fill('[data-testid="offline-fryer-carryover"]', "2,5");
await page.fill('[data-testid="offline-fryer-disposed"]', "1");
await shot("06-offline-fryer-end");
await click('[data-testid="offline-fryer-form"] button[type="submit"]');
check("AC5 fryer end is saved without network", await saved());

// Daily cleaning.
await toList();
await click('[data-journal="cleaning"]');
await page.waitForSelector('[data-testid="offline-rows"] button, [data-testid="offline-signers"]', { timeout: 15000 });
if (await page.locator('[data-testid="offline-rows"]').count()) await click('[data-testid="offline-rows"] button');
await pickSigner("Крылов");
await page.waitForSelector('[data-testid="offline-journal-form"]', { timeout: 15000 });
// Tick every step: the list of unticked boxes shrinks as we go, so always take the first one.
for (let guard = 0; guard < 30; guard++) {
  const unticked = page.locator('[data-testid="offline-journal-form"] [role="checkbox"][aria-checked="false"]');
  if ((await unticked.count()) === 0) break;
  await unticked.first().click();
}
await shot("07-offline-daily-cleaning");
await click('[data-testid="offline-journal-form"] button[type="submit"]');
check("AC6 daily cleaning is saved without network", await saved());

// Home marks.
await toList();
const fridgeMark = await page.locator(`[data-object="${fridge.id}"] [data-mark]`).getAttribute("data-mark").catch(() => null);
const cleaningMark = await page.locator('[data-journal="cleaning"] [data-mark]').getAttribute("data-mark").catch(() => null);
const summaryAfter = await text("offline-summary");
check("AC8 filled objects and journals are marked on the home screen", fridgeMark === "queued" && cleaningMark === "queued" && summaryAfter !== summaryBefore, `${summaryBefore} → ${summaryAfter}`);
await shot("08-offline-home-marks");

// ---------------------------------------------------------------- network is back
await context.setOffline(false);
await page.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
const drained = await waitFor(async () => {
  const store = await readStore();
  return store.queue.every((item) => item.status !== "pending") ? store : null;
}, 120000, 1000);
check("all records made without network are delivered", drained && drained.queue.length === 0, drained ? drained.queue.map((item) => `${item.label}: ${item.status} ${item.lastError ?? ""}`).join(" | ") : "timeout");
await shot("09-online-synced");

const todayKey = pack.todayKey;
const fridgeEntry = sql(`select e.data::text from "JournalDocumentEntry" e join "JournalDocument" d on d.id = e."documentId" join "JournalTemplate" t on t.id = d."templateId" where t.code = 'cold_equipment_control' and e."employeeId" = '${userId}' and e.date = '${todayKey}'`);
check("AC1 the fridge reading is in the journal with its photo", fridgeEntry.includes("/uploads/readings/"), fridgeEntry.slice(0, 200));
const climateEntry = sql(`select e.data::text from "JournalDocumentEntry" e join "JournalDocument" d on d.id = e."documentId" join "JournalTemplate" t on t.id = d."templateId" where t.code = 'climate_control' and e."employeeId" = '${userId}' and e.date = '${todayKey}'`);
check("AC6 the room climate reading is in the journal", climateEntry.includes("21") && climateEntry.includes("50"), climateEntry.slice(0, 200));
const fryerEntry = sql(`select e.data::text from "JournalDocumentEntry" e join "JournalDocument" d on d.id = e."documentId" join "JournalTemplate" t on t.id = d."templateId" where t.code = 'fryer_oil' and e.data::text not like '%_autoSeeded%' order by e."createdAt" desc limit 1`);
check("AC5 the fryer row has both the start and the end", fryerEntry.includes("2.5") || fryerEntry.includes("2,5"), fryerEntry.slice(0, 260));
const cleaningAudit = sql(`select count(*) from "AuditLog" where action = 'journal.qr_fill' and details->'offline' is not null and "entityId" = '${cleaning.documents[0].id}'`);
check("AC6 the daily cleaning record reached the journal", Number(cleaningAudit) >= 1, `audit rows ${cleaningAudit}`);

// Fryer end without a start is refused and stays fixable (direct request, as the device would send it).
const fryerDay = new Date().toISOString();
sql(`delete from "JournalDocumentEntry" where "documentId" in (select d.id from "JournalDocument" d join "JournalTemplate" t on t.id = d."templateId" where t.code = 'fryer_oil')`);
const orphanEnd = await context.request.post(`/api/equipment-fill/${encodeURIComponent(fryer.id)}/fryer`, {
  headers: { "Idempotency-Key": "e2e-fryer-orphan-end-0001", "x-offline-recorded-at": fryerDay, "x-offline-auth": "self" },
  data: { token: fryer.token, employeeId: userId, phase: "end", quality: 4, carryoverKg: 0, disposedKg: 0 },
});
check("AC5 fryer end without a start is refused by the server", orphanEnd.status() === 409, `status ${orphanEnd.status()}`);

// ---------------------------------------------------------------- merge sees cabinet edits
const hygiene = pack.journals.find((journal) => journal.code === "hygiene");
const rowKey = `employee-${userId}`;
const hygieneUrl = `/api/journal-fill/${pack.organization.id}/hygiene`;
const send = (key, values, baseValues) =>
  context.request.post(hygieneUrl, {
    headers: { "Idempotency-Key": key, "x-offline-recorded-at": new Date().toISOString(), "x-offline-auth": "self" },
    data: { token: hygiene.token, documentId: hygiene.documents[0].id, employeeId: userId, rowKey, values, base: baseValues },
  });
const all = { temperature: true, infection: true, respiratorySkin: true };
const first = await send("e2e-p2-hygiene-first-00001", all, {});
// «Правка в таблице кабинета»: the entry is changed directly, with no form submission and no audit row.
sql(`update "JournalDocumentEntry" set data = jsonb_set(data, '{confirmations,infection}', 'false') where "documentId" = '${hygiene.documents[0].id}' and "employeeId" = '${userId}' and date = '${todayKey}'`);
const freshPack = await (await context.request.get("/api/offline/pack")).json();
const seen = freshPack.journals.find((journal) => journal.code === "hygiene").documents[0].history[rowKey]?.[todayKey];
check("AC4 offline history shows the value edited in the cabinet table", first.ok() && seen?.infection === false && seen?.temperature === true, JSON.stringify(seen));
// A device with the old data (it saw all three ticked) unticks another field.
const stale = await send("e2e-p2-hygiene-stale-00001", { ...all, respiratorySkin: false }, all);
const staleBody = await stale.json();
const entryAfter = sql(`select data->'confirmations' from "JournalDocumentEntry" where "documentId" = '${hygiene.documents[0].id}' and "employeeId" = '${userId}' and date = '${todayKey}'`);
const confirmations = JSON.parse(entryAfter || "{}");
check("AC4 the cabinet edit is not overwritten by a device with older data; the device's own change is written", stale.ok() && !staleBody.conflicts && confirmations.infection === false && confirmations.respiratorySkin === false && confirmations.temperature === true, entryAfter);
writeFileSync(path.join(raw, "merge-with-cabinet-edit.json"), JSON.stringify({ deviceBase: all, cabinetEdit: { infection: false }, deviceEdit: { respiratorySkin: false }, journalAfter: confirmations }, null, 2));

// ---------------------------------------------------------------- notifications and the manager's page
const beat = (stuck) => context.request.post("/api/offline/heartbeat", { data: { deviceKey: "e2e-device-key-0000000001", packAt: new Date().toISOString(), pending: 1, stuck, delivered: 2 } });
const notifCount = () => Number(sql(`select count(*) from "Notification" where kind = 'offline-stuck' and "userId" = '${userId}'`));
const n0 = notifCount();
const b1 = await (await beat(3)).json();
const b2 = await (await beat(3)).json();
check("AC11 records not accepted → one notification per device a day", b1.notifiedStuck === true && b2.notifiedStuck === false && notifCount() === n0 + 1, `${JSON.stringify(b1)} ${JSON.stringify(b2)}, notifications ${n0} → ${notifCount()}`);
check("AC11 heartbeat is refused without a session and with garbage", (await anon.request.post("/api/offline/heartbeat", { data: { deviceKey: "e2e-device-key-0000000001" } })).status() === 401 && (await context.request.post("/api/offline/heartbeat", { data: { deviceKey: "x" } })).status() === 400);

await page.goto("/settings/offline", { waitUntil: "domcontentloaded" });
const devicesText = await page.locator('[data-testid="offline-devices"]').innerText({ timeout: 20000 }).catch(() => "");
const recordsRows = await page.locator('[data-testid="offline-records"] tbody tr').count();
check("AC10 the manager's page lists devices and offline records", devicesText.includes("Chrome (Android)") && recordsRows >= 5, `devices: ${devicesText.replace(/\s+/g, " ").slice(0, 120)}; records ${recordsRows}`);
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto("/settings/offline", { waitUntil: "domcontentloaded" });
await shot("10-manager-offline-page");
const cook = await browser.newContext({ ...devices["Pixel 7"], baseURL: base });
await login(cook, "hotcook1@haccp.local");
const denied = await cook.request.get("/settings/offline", { maxRedirects: 0 });
check("AC10 the manager's page is closed to line staff and to guests", denied.status() !== 200 && (await anon.request.get("/settings/offline", { maxRedirects: 0 })).status() !== 200, `cook ${denied.status()}`);

const links = await (await anon.request.get("/.well-known/assetlinks.json")).json();
check("AC13 assetlinks.json is not empty: the upload key fingerprint is always there", links[0]?.target?.sha256_cert_fingerprints?.includes("8C:28:3E:01:28:7C:9A:D3:4B:1D:32:8F:5E:4F:2D:D0:6B:49:CF:91:54:4C:B8:DE:6D:65:5D:21:F9:6A:60:2D"));

writeFileSync(path.join(raw, "phase2-results.json"), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
