// Ordinary online QR work must behave as before: no offline headers, no session.
import { chromium, devices } from "playwright";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const owner = await browser.newContext({ ...devices["Pixel 7"], baseURL: base });
const csrf = await (await owner.request.get("/api/auth/csrf")).json();
await owner.request.post("/api/auth/callback/credentials", { form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" } });
const pack = await (await owner.request.get("/api/offline/pack")).json();
const anon = await browser.newContext({ ...devices["Pixel 7"], baseURL: base });
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const fridge = pack.objects.filter((object) => object.fill === "temperature")[1];
const noPin = pack.employees.find((employee) => !employee.hasPin && employee.id !== pack.user.id);
const page = await anon.request.get(`/equipment-fill/${encodeURIComponent(fridge.id)}?token=${encodeURIComponent(fridge.token)}`);
check("QR sticker page opens without a session", page.status() === 200 && (await page.text()).includes(fridge.name), `status ${page.status()}`);
const save = await anon.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, { data: { token: fridge.token, employeeId: noPin.id, temperature: fridge.temperature.max - 1 } });
check("online QR reading is accepted as before", save.ok(), `status ${save.status()} ${(await save.text()).slice(0, 120)}`);
const again = await anon.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, { headers: { "Idempotency-Key": "plain-online-key-000000001" }, data: { token: fridge.token, employeeId: noPin.id, temperature: fridge.temperature.max - 1 } });
check("an Idempotency-Key without offline headers changes nothing", again.ok() && again.headers()["idempotent-replayed"] === undefined, `status ${again.status()}`);
const journal = pack.journals.find((item) => item.code === "perishable_rejection");
const hub = await anon.request.get(`/journal-fill/${pack.organization.id}/perishable_rejection?token=${encodeURIComponent(journal.token)}`);
check("journal QR page opens without a session", hub.status() === 200, `status ${hub.status()}`);
const fill = await anon.request.post(`/api/journal-fill/${pack.organization.id}/perishable_rejection`, {
  data: { token: journal.token, documentId: journal.documents[0].id, employeeId: noPin.id, rowKey: `employee-${noPin.id}`, values: { productName: "Сметана", supplier: "ООО Ферма", quantity: "5 кг", organolepticResult: "compliant" } },
});
check("online journal QR record is accepted as before", fill.ok() && !(await fill.json()).conflicts, `status ${fill.status()}`);
const wrongPin = await anon.request.post(`/api/equipment-fill/${encodeURIComponent(fridge.id)}`, { data: { token: fridge.token, employeeId: pack.employees.find((employee) => employee.hasPin).id, temperature: 3, pin: "0000" } });
check("online PIN check still refuses a wrong PIN", wrongPin.status() === 401, `status ${wrongPin.status()}`);
for (const url of ["/", "/login", "/mini/login", "/pricing"]) {
  const response = await anon.request.get(url);
  check(`public page ${url}`, response.status() === 200, `status ${response.status()}`);
}
for (const url of ["/dashboard", "/journals", "/mini/me"]) {
  const response = await owner.request.get(url);
  check(`cabinet page ${url}`, response.status() === 200, `status ${response.status()}`);
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
