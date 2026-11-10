// AC2 and AC3: photos of journal form fields, and what happens to a record whose photo
// is lost or refused. No journal of the project emits a "photo" field today, so the form
// is given one by editing the pack saved on the device — the device and upload paths are real.
import { chromium, devices } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const raw = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../raw");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: base, serviceWorkers: "allow" });
const page = await context.newPage();
const csrf = await (await context.request.get("/api/auth/csrf")).json();
await context.request.post("/api/auth/callback/credentials", { form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } });

const store = (fn, arg) => page.evaluate(fn, arg);
const state = () =>
  store(async () => {
    if (!(await indexedDB.databases()).some((item) => item.name === "wesetup-offline-app")) return null;
    return new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction(["kv", "queue"], "readonly");
        const out = {};
        tx.objectStore("kv").get("pack").onsuccess = (event) => (out.pack = event.target.result ?? null);
        tx.objectStore("kv").get("shell").onsuccess = (event) => (out.shell = event.target.result?.ok === true);
        tx.objectStore("queue").getAll().onsuccess = (event) =>
          (out.queue = event.target.result.map((item) => ({ id: item.id, label: item.label, status: item.status, lastCode: item.lastCode, lastError: item.lastError, photoUrls: item.photoUrls ?? {}, values: item.body.values ?? null, photo: item.body.photo ?? null })));
        tx.oncomplete = () => resolve(out);
      };
    });
  });
const wait = async (fn, ms = 90000) => {
  for (const started = Date.now(); Date.now() - started < ms; ) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await page.waitForTimeout(500);
  }
  return null;
};

await page.goto("/mini", { waitUntil: "domcontentloaded" });
const ready = await wait(async () => {
  const current = await state();
  return current?.pack && current.shell ? current : null;
}, 150000);
check("device is ready", ready);
const pack = ready.pack.pack;

// Give the perishable-brakerage form a required photo field (in the pack on the device only).
await store(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", "readwrite");
        const kv = tx.objectStore("kv");
        kv.get("pack").onsuccess = (event) => {
          const stored = event.target.result;
          const journal = stored.pack.journals.find((item) => item.code === "perishable_rejection");
          for (const form of Object.values(journal.documents[0].forms)) form.fields.push({ type: "photo", key: "labelPhoto", label: "Фото этикетки", required: true });
          // Keep the edited pack: a fresh download would drop the test field.
          stored.savedAt = Date.now();
          kv.put(stored, "pack");
        };
        tx.oncomplete = () => resolve(null);
      };
    })
);

await context.setOffline(true);
await page.goto("about:blank");
await page.goto("/mini?src=app", { waitUntil: "domcontentloaded" });
await page.locator('[data-journal="perishable_rejection"]').click({ timeout: 20000 });
await page.locator('[data-testid="offline-signers"] button:has-text("Крылов")').first().click();
await page.fill('[data-field="productName"]', "Сыр (фото этикетки)");
await page.fill('[data-field="supplier"]', "ООО Сыровар");
await page.fill('[data-field="quantity"]', "3 кг");
await page.locator('[data-testid="offline-journal-form"] button[type="submit"]').click();
check("AC2 a required photo field asks for a photo instead of blocking the form", (await page.locator('[data-testid="offline-journal-form"] [role="alert"]').innerText().catch(() => "")).includes("фото"));
await page.setInputFiles('[data-testid="offline-photo-labelPhoto-input"]', { name: "label-1.png", mimeType: "image/png", buffer: PNG });
await page.setInputFiles('[data-testid="offline-photo-labelPhoto-input"]', { name: "label-2.png", mimeType: "image/png", buffer: PNG });
await page.screenshot({ path: path.join(raw, "11-offline-form-photo-field.png"), fullPage: true });
await page.locator('[data-testid="offline-journal-form"] button[type="submit"]').click();
await page.waitForSelector('[data-testid="offline-done"]', { timeout: 20000 });
const queued = (await state()).queue.find((item) => item.label.includes("скоропорт") || item.values?.productName?.includes("Сыр"));
check("AC2 two photos of the field wait in the queue as markers", queued?.values?.labelPhoto === "offline-photo:field:labelPhoto#0,offline-photo:field:labelPhoto#1", JSON.stringify(queued?.values?.labelPhoto));

// AC3: a record whose photo is gone, and a record whose photo the server refuses.
const fridge = pack.objects.find((object) => object.fill === "temperature" && object.photo !== "off");
await store(
  ({ fridge, userId, orgId, userName }) =>
    new Promise((resolve) => {
      const open = indexedDB.open("wesetup-offline-app");
      open.onsuccess = () => {
        const tx = open.result.transaction("queue", "readwrite");
        const item = (id, photos) => ({
          id,
          ownerUserId: userId,
          organizationId: orgId,
          employeeId: userId,
          employeeName: userName,
          auth: "self",
          pinFp: null,
          recordedAt: new Date().toISOString(),
          target: { kind: "equipment", objectId: fridge.id, action: "temperature" },
          url: `/api/equipment-fill/${encodeURIComponent(fridge.id)}`,
          body: { token: fridge.token, employeeId: userId, temperature: 3, photo: "offline-photo:reading" },
          label: `${fridge.name}: ${id}`,
          sublabel: "",
          status: "pending",
          attempts: 0,
          nextAttemptAt: Date.now(),
          lastError: null,
          lastCode: null,
          ...(photos ? { photos } : {}),
        });
        tx.objectStore("queue").put(item("e2e-photo-lost-0000000001", null));
        // Declared as a PNG, but the bytes are not an image — the server must refuse it.
        tx.objectStore("queue").put(item("e2e-photo-fake-0000000001", { reading: new Blob(["not an image at all"], { type: "image/png" }) }));
        tx.oncomplete = () => resolve(null);
      };
    }),
  { fridge, userId: pack.user.id, orgId: pack.organization.id, userName: pack.user.name }
);

await context.setOffline(false);
await page.goto("/mini-offline#queue", { waitUntil: "domcontentloaded" });
const done = await wait(async () => {
  const current = await state();
  return current.queue.every((item) => item.status !== "pending") ? current : null;
}, 120000);
const byId = Object.fromEntries((done?.queue ?? []).map((item) => [item.id, item]));
check("AC2 the record with photo fields is delivered after its photos are uploaded", done && !done.queue.some((item) => item.values?.productName?.includes("Сыр")), JSON.stringify(done?.queue.map((item) => [item.label, item.status, item.lastError])));
check("AC3 a record whose photo is lost stays in «Не ушло» with the reason", byId["e2e-photo-lost-0000000001"]?.status === "rejected" && byId["e2e-photo-lost-0000000001"].lastCode === "offline-photo-lost", JSON.stringify(byId["e2e-photo-lost-0000000001"]));
check("AC3 a record whose photo the server refuses stays in «Не ушло» with the reason", byId["e2e-photo-fake-0000000001"]?.status === "rejected" && byId["e2e-photo-fake-0000000001"].lastCode === "offline-photo-rejected", JSON.stringify(byId["e2e-photo-fake-0000000001"]));
await page.screenshot({ path: path.join(raw, "12-queue-photo-refused.png"), fullPage: true });
const uploads = await context.request.get("/api/offline/pack");
check("the cabinet still answers after the run", uploads.ok());
await browser.close();
process.exit(failed > 0 ? 1 : 0);
