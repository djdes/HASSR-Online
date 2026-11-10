// Demo data for the offline end-to-end run: creates this month's documents for the
// most used journals, then prints what the offline pack holds.
import { chromium, devices } from "playwright";
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: base });
const csrf = await (await context.request.get("/api/auth/csrf")).json();
await context.request.post("/api/auth/callback/credentials", {
  form: { email: "admin@haccp.local", password: "admin1234", csrfToken: csrf.csrfToken, json: "true" },
});
const codes = ["hygiene", "health_check", "cleaning", "general_cleaning", "cleaning_ventilation_checklist", "finished_product", "perishable_rejection", "cold_equipment_control", "climate_control", "incoming_control", "product_writeoff", "disinfectant_usage", "uv_lamp_runtime", "fryer_oil", "equipment_cleaning"];
const created = await context.request.post("/api/journal-documents/bulk-create", { data: { codes }, timeout: 120000 });
console.log("bulk-create", created.status(), (await created.text()).slice(0, 160));
const json = await (await context.request.get("/api/offline/pack", { timeout: 120000 })).json();
console.log(JSON.stringify({ journals: json.journals?.map((j) => [j.code, j.append, j.documents.map((d) => [d.perEmployee, d.rows.length, Object.keys(d.forms).length, d.employeeIds.length])]), objects: json.objects?.map((o) => [o.name, o.fill, o.employeeIds.length]) }));
await browser.close();
