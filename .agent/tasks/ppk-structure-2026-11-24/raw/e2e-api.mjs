import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const EMP = process.env.EMP;
const out = [];
const check = (name, ok, detail = "") => { out.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", "admin@haccp.local");
await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
const api = context.request;
const json = async (res) => { try { return await res.json(); } catch { return null; } };

// 3.7: без утверждённой версии PIN-отметка невозможна
let r = await api.post(`${BASE}/api/production-control/acknowledgements/pin`, { data: { userId: EMP, pin: "2468" } });
check("PIN без утверждённой версии → 404", r.status() === 404, `${r.status()} ${JSON.stringify(await json(r))}`);

// Утвердить версию ППК (блок «Версии документов»)
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "doc-versions", data: { doc: "ppk", version: 1, approvedAt: "2026-11-24", approvedById: null, note: "" } } });
check("утверждена версия ППК", r.status() === 201, String(r.status()));

r = await api.post(`${BASE}/api/production-control/acknowledgements/pin`, { data: { userId: EMP, pin: "1111" } });
const wrong = await json(r);
check("неверный PIN → 401 с остатком попыток", r.status() === 401 && /Осталось попыток/.test(wrong?.error ?? ""), `${r.status()} ${wrong?.error}`);
r = await api.post(`${BASE}/api/production-control/acknowledgements/pin`, { data: { userId: EMP, pin: "12" } });
check("PIN не из 4–6 цифр → 400", r.status() === 400, String(r.status()));
r = await api.post(`${BASE}/api/production-control/acknowledgements/pin`, { data: { userId: EMP, pin: "2468" } });
const ok = await json(r);
check("верный PIN → отметка «Ознакомлен и согласен»", r.status() === 200 && typeof ok?.acknowledgedAt === "string", `${r.status()} ${JSON.stringify(ok)}`);
r = await api.get(`${BASE}/api/production-control/acknowledgements?docKeys=ppk`);
const stats = await json(r);
check("сводка ознакомления: 1 отметка", stats?.stats?.ppk?.acknowledged === 1, JSON.stringify(stats));

// 1.2: «Собрать из должностей»
r = await api.post(`${BASE}/api/production-control/org-chart`);
const chart = await json(r);
check("оргструктура из должностей создана", r.status() === 201 && chart?.record?.id, `${r.status()}`);
const editor = await page.goto(`${BASE}/production-control/org-chart/${chart?.record?.id}`, { waitUntil: "networkidle" });
check("редактор оргструктуры открывается", editor?.status() === 200 && (await page.locator("svg").count()) > 0, String(editor?.status()));
await page.screenshot({ path: "out/10-org-chart-editor.png" });
const printPage = await page.goto(`${BASE}/production-control/org-chart/${chart?.record?.id}/print`, { waitUntil: "networkidle" });
check("печать оргструктуры открывается", printPage?.status() === 200, String(printPage?.status()));

// 1.5: «Загрузить из справочника»
r = await api.post(`${BASE}/api/production-control/products/import`);
const imp = await json(r);
check("из справочника добавлены 2 (готовая + п/ф, без сырья)", r.status() === 200 && imp?.added === 2, JSON.stringify(imp));
r = await api.post(`${BASE}/api/production-control/products/import`);
check("повторная загрузка не дублирует", (await json(r))?.added === 0);

// 1.3: договор с видимостью проверяющему; битые данные → 400
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "contracts", data: { title: "Договор на вывоз ТКО", counterparty: "ООО «Эко»", number: "17/2026", date: "2026-01-15", validUntil: null, visibleToInspector: true } } });
check("договор сохранён", r.status() === 201, String(r.status()));
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "contracts", data: { title: "", counterparty: "", number: "", date: "15.01.2026", validUntil: null, visibleToInspector: true } } });
check("битый договор → 400", r.status() === 400, String(r.status()));

// 1.4: одиночный блок — вторая запись запрещена
const info = { activity: "Ресторан", workingHours: "10–23", seats: "60", capacity: "400 блюд", area: "250", waterSupply: "Центр.", sewage: "Центр.", ventilation: "", heating: "", serviceForm: "", extra: "" };
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "production-info", data: info } });
check("сведения о производстве сохранены", r.status() === 201, String(r.status()));
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "production-info", data: info } });
check("вторая запись одиночного блока → 409", r.status() === 409, String(r.status()));

// 3.3: свои аварийные ситуации идут в программу
r = await api.post(`${BASE}/api/production-control/prp/fill`, { data: { block: "prp-emergencies" } });
check("3.3 «Взять за основу» добавил 7 строк", (await json(r))?.added === 7);
r = await api.post(`${BASE}/api/production-control/records`, { data: { block: "prp-emergencies", data: { situation: "Сбой кассовой системы", actions: "Перейти на ручной учёт." } } });
const program = await page.goto(`${BASE}/production-control/program`, { waitUntil: "networkidle" });
const programText = await page.locator("body").innerText();
check("программа печатает свою аварийную ситуацию", program?.status() === 200 && programText.includes("Сбой кассовой системы"));
const pdf = await api.get(`${BASE}/api/production-control/program/pdf`);
check("PDF программы собирается", pdf.status() === 200 && (pdf.headers()["content-type"] ?? "").includes("pdf"), `${pdf.status()} ${pdf.headers()["content-type"]}`);

// Ознакомление сотрудника: документ «ppk» в его списке (через API проверяющего нельзя — смотрим страницу руководителя)
const ack = await page.goto(`${BASE}/acknowledge/ppk`, { waitUntil: "networkidle" });
check("страница ознакомления с программой открывается", ack?.status() === 200, String(ack?.status()));

await browser.close();
const failed = out.filter((row) => !row.ok).length;
console.log(`\n${out.length - failed}/${out.length} passed`);
process.exit(failed ? 1 : 0);
