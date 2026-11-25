// Verifier (independent) stand checks for AC7: PPK API errors carry `code` (and keep the Russian
// `error`); the UI shows the text by code in the interface language (en, uz), an unknown code —
// the server text, no body — the local fallback. Own test point; the owner's locale and active
// point, the point's PPK revisions and the point itself are restored/removed at the end.
// Usage (env loaded, next dev on :3000): node ac7-stand.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, db, reporter, session, acceptLegal } from "./lib.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const { check, finish } = reporter(`${OUT}/ac7-results.json`);
const { client, q } = await db();
const ADMIN = (await q(`select id, "organizationId", locale, "lastActiveBuildingId" from "User" where email='admin@haccp.local'`))[0];
const COOK = (await q(`select id, "lastActiveBuildingId" from "User" where email='cook-e2e-special@haccp.local'`))[0];
const ORG = ADMIN.organizationId;
const OTHER_DOC = "text:text-terms@cmwvpz4ua0001hd7dxso1aiok"; // another point's doc with revisions 6 and 7
const browser = await chromium.launch();
const owner = await session(browser, "admin@haccp.local", "admin1234");
const cook = await session(browser, "cook-e2e-special@haccp.local", "cook-e2e-2026");
let point = null;

const api = async (who, method, path, data) => {
  const res = await who.request.fetch(`${BASE}${path}`, { method, ...(data !== undefined ? { data } : {}) });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};
const expectCode = (label, r, status, code, error) =>
  check(`${label} — ${status} ${code}`, r.status === status && r.body.code === code && (error === undefined || r.body.error === error), `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

// Waits for a toast matching `pattern`; on timeout reports every visible toast (no DOM surgery:
// removing Sonner's nodes by hand crashes React).
async function toastText(page, pattern, timeout = 30000) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: pattern }).last();
  try {
    await toast.waitFor({ timeout });
    return (await toast.innerText()).trim();
  } catch {
    const all = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    return `[no toast matching ${pattern}; visible: ${JSON.stringify(all)}]`;
  }
}
const dismissToasts = async (page) => page.waitForTimeout(300);

try {
  const made = await owner.request.post(`${BASE}/api/settings/buildings`, { data: { name: `Verifier AC7 ${new Date().toISOString().slice(11, 19)}`, sphere: "food" } });
  point = (await made.json().catch(() => ({}))).building;
  check("setup: test point", made.ok() && point?.id, String(made.status()));
  await owner.request.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });
  const TERMS = `text:text-terms@${point.id}`;
  // The first PPK request seeds the point's PPK from the organization (copies its records); only then
  // set the point's own text (a record inserted before seeding collides with the copy → 500).
  const seed = await owner.request.get(`${BASE}/api/production-control/revisions/compare?docKey=garbage`);
  check("setup: point PPK seeded by the first PPK request", seed.status() === 404, String(seed.status()));
  await q(`insert into "PpkRecord"(id, "organizationId", block, data, "sortOrder", singleton, "buildingId", "createdAt", "updatedAt")
           values ('cver' || substr(md5(random()::text), 1, 21), $1, 'text-terms', $2::jsonb, 0, $3, $4, now(), now())
           on conflict ("organizationId", singleton) do update set data=excluded.data, "updatedAt"=now()`,
    [ORG, JSON.stringify({ text: "Термины проверки: ХАССП, ККТ, ПОПМ." }), `text-terms@${point.id}`, point.id]);

  // ---------- API: codes next to the unchanged Russian text ----------
  const cmp = (query) => api(owner, "GET", `/api/production-control/revisions/compare?${query}`);
  expectCode("API compare: empty docKey", await cmp("docKey="), 400, "bad_request", "Неверный запрос");
  expectCode("API compare: docKey of 201 chars", await cmp(`docKey=${"x".repeat(201)}`), 400, "bad_request");
  expectCode("API compare: from=abc", await cmp(`docKey=${encodeURIComponent(TERMS)}&from=abc`), 400, "bad_request");
  expectCode("API compare: to=xyz", await cmp(`docKey=${encodeURIComponent(TERMS)}&to=xyz`), 400, "bad_request");
  expectCode("API compare: garbage key", await cmp("docKey=garbage"), 404, "doc_not_found", "Документ не найден");
  expectCode("API compare: no revisions", await cmp(`docKey=${encodeURIComponent(TERMS)}`), 404, "no_revisions", "У документа нет утверждённых редакций");
  expectCode("API compare: from=999", await cmp(`docKey=${encodeURIComponent(OTHER_DOC)}&from=999`), 404, "revision_not_found", "Редакция не найдена");
  expectCode("API compare: other point's doc → current side unavailable", await cmp(`docKey=${encodeURIComponent(OTHER_DOC)}&from=6&to=current`), 404, "no_current_text", "Текущего текста документа нет");
  const ok = await cmp(`docKey=${encodeURIComponent(OTHER_DOC)}&from=6&to=7`);
  check("API compare: success body unchanged (history, from/to, diff; no code)", ok.status === 200 && Array.isArray(ok.body.history) && ok.body.from?.number === 6 && ok.body.to?.number === 7 && ok.body.code === undefined, `${ok.status}`);
  const appr = (data) => api(owner, "POST", "/api/production-control/revisions", data);
  expectCode("API approve: {}", await appr({}), 400, "bad_request", "Неверный запрос");
  expectCode("API approve: garbage key", await appr({ docKey: "garbage" }), 404, "doc_not_found", "Документ не найден");
  expectCode("API approve: empty text doc", await appr({ docKey: `text:text-ccp-method@${point.id}` }), 400, "doc_empty", "Документ пуст: сохраните текст или загрузите скан");
  const drf = (data) => api(owner, "POST", "/api/production-control/text-docs/draft", data);
  expectCode("API draft: {}", await drf({}), 400, "bad_request", "Неверный запрос");
  expectCode("API draft: unknown block", await drf({ block: "nope" }), 400, "bad_request");
  expectCode("API draft: AI not configured on the stand", await drf({ block: "text-terms" }), 503, "ai_not_configured", "ИИ-помощник не подключён: черновик сейчас недоступен");
  expectCode("API access: cook → compare", await api(cook, "GET", "/api/production-control/revisions/compare?docKey=garbage"), 403, "forbidden", "Нет доступа к разделу");
  expectCode("API access: cook → approve", await api(cook, "POST", "/api/production-control/revisions", { docKey: TERMS }), 403, "forbidden");
  expectCode("API access: cook → draft", await api(cook, "POST", "/api/production-control/text-docs/draft", { block: "text-terms" }), 403, "forbidden");

  // ---------- UI: English ----------
  await q(`update "User" set locale='en' where id=$1`, [ADMIN.id]);
  const page = await owner.newPage();
  await page.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  await page.locator("[data-ppk-draft]").first().waitFor({ timeout: 120000 });
  check("UI en: page is in English (draft button)", /Draft from the AI assistant/.test(await page.locator("[data-ppk-draft]").first().innerText()));
  await page.locator("[data-ppk-draft]").first().click();
  await page.getByRole("button", { name: /^Replace$/ }).click({ timeout: 15000 });
  let text = await toastText(page, /AI assistant/);
  check("UI en: draft error (real 503 ai_not_configured) → English text by code", text === "The AI assistant is not connected: drafts are unavailable right now", text);
  await page.screenshot({ path: `${OUT}/screens/ac7-en-draft-toast.png` });
  await dismissToasts(page);

  // Approve: errors by code (route), unknown code → server text, no body → local fallback; then a real approval.
  let approveReply = { status: 409, body: { error: "Документ изменился во время утверждения — утвердите ещё раз", code: "doc_changed" } };
  await page.route("**/api/production-control/revisions", (route) =>
    route.request().method() === "POST" && approveReply
      ? route.fulfill({ status: approveReply.status, contentType: "application/json", body: approveReply.body === null ? "<html>oops</html>" : JSON.stringify(approveReply.body) })
      : route.continue());
  await page.locator("[data-revision-approve]").first().click();
  const confirm = page.getByRole("button", { name: /^Approve — / });
  await confirm.click({ timeout: 15000 });
  text = await toastText(page, /changed during approval|изменился/);
  check("UI en: approve 409 doc_changed → «The document changed during approval — approve it again»", text === "The document changed during approval — approve it again", text);
  await page.screenshot({ path: `${OUT}/screens/ac7-en-approve-doc-changed.png` });
  await dismissToasts(page);
  approveReply = { status: 400, body: { error: "Серверный текст с новым кодом", code: "brand_new_code" } };
  await confirm.click({ timeout: 15000 });
  text = await toastText(page, /Серверный текст/);
  check("UI en: approve with an unknown code → server text", text === "Серверный текст с новым кодом", text);
  await dismissToasts(page);
  approveReply = { status: 500, body: null };
  await confirm.click({ timeout: 15000 });
  text = await toastText(page, /Could not approve/);
  check("UI en: approve without a JSON body → local fallback «Could not approve the revision»", text === "Could not approve the revision", text);
  await dismissToasts(page);
  approveReply = null;
  await confirm.click({ timeout: 15000 });
  text = await toastText(page, /Revision .* approved/);
  const revs = await q(`select number from "PpkRevision" where "organizationId"=$1 and "docKey"=$2`, [ORG, TERMS]);
  check("UI en: real approval still works (revision created)", revs.length === 1, `${text} / revisions=${revs.length}`);
  await page.unroute("**/api/production-control/revisions");
  await dismissToasts(page);

  // Compare dialog: errors by code (route), unknown code → server text; then the real compare.
  await page.reload({ waitUntil: "networkidle", timeout: 240000 });
  let compareReply = { status: 404, body: { error: "Редакция не найдена", code: "revision_not_found" } };
  await page.route("**/api/production-control/revisions/compare**", (route) =>
    compareReply ? route.fulfill({ status: compareReply.status, contentType: "application/json", body: JSON.stringify(compareReply.body) }) : route.continue());
  const openCompare = async () => {
    await page.locator("[data-revision-compare-open]").first().click({ timeout: 30000 });
    const dialog = page.locator("[data-revision-compare]");
    await dialog.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    return dialog;
  };
  let dialog = await openCompare();
  check("UI en: compare 404 revision_not_found → «Revision not found»", (await dialog.innerText()).includes("Revision not found"), (await dialog.innerText()).slice(0, 160).replace(/\n/g, " | "));
  await page.screenshot({ path: `${OUT}/screens/ac7-en-compare-error.png` });
  await page.keyboard.press("Escape");
  compareReply = { status: 403, body: { error: "Выберите свою точку в шапке: ППК ведётся для каждой точки", code: "choose_point" } };
  dialog = await openCompare();
  check("UI en: compare 403 choose_point → English text", (await dialog.innerText()).includes("Choose your site in the header"), (await dialog.innerText()).slice(0, 160).replace(/\n/g, " | "));
  await page.keyboard.press("Escape");
  compareReply = { status: 404, body: { error: "Сервер: новая ошибка сравнения", code: "zzz" } };
  dialog = await openCompare();
  check("UI en: compare with an unknown code → server text", (await dialog.innerText()).includes("Сервер: новая ошибка сравнения"), (await dialog.innerText()).slice(0, 160).replace(/\n/g, " | "));
  await page.keyboard.press("Escape");
  compareReply = null;
  dialog = await openCompare();
  const body = await dialog.innerText();
  check("UI en: real compare opens without an error", !/Could not compare|not found/i.test(body) && (await page.locator("[data-compare-from]").count()) > 0, body.slice(0, 160).replace(/\n/g, " | "));
  await page.keyboard.press("Escape");
  await page.unroute("**/api/production-control/revisions/compare**");

  // ---------- UI: Uzbek ----------
  await q(`update "User" set locale='uz' where id=$1`, [ADMIN.id]);
  // Change the text so «approve the new revision» is offered again.
  await q(`update "PpkRecord" set data=$2::jsonb, "updatedAt"=now() where singleton=$1`, [`text-terms@${point.id}`, JSON.stringify({ text: "Termins changed for uz check." })]);
  await page.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  await page.locator("[data-ppk-draft]").first().click({ timeout: 60000 });
  await page.getByRole("button", { name: /^Almashtirish$/ }).click({ timeout: 15000 });
  text = await toastText(page, /AI-yordamchi/);
  check("UI uz: draft error → «AI-yordamchi ulanmagan: qoralama hozircha mavjud emas»", text === "AI-yordamchi ulanmagan: qoralama hozircha mavjud emas", text);
  await page.screenshot({ path: `${OUT}/screens/ac7-uz-draft-toast.png` });
  await dismissToasts(page);
  await page.route("**/api/production-control/revisions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Документ изменился во время утверждения — утвердите ещё раз", code: "doc_changed" }) })
      : route.continue());
  await page.locator("[data-revision-approve]").first().click({ timeout: 30000 });
  await page.getByRole("button", { name: /^Tasdiqlash — / }).click({ timeout: 15000 });
  text = await toastText(page, /tasdiqlang|изменился/);
  check("UI uz: approve 409 doc_changed → «Tasdiqlash vaqtida hujjat oʻzgardi — yana tasdiqlang»", text === "Tasdiqlash vaqtida hujjat oʻzgardi — yana tasdiqlang", text);
  await page.unroute("**/api/production-control/revisions");
  await page.close();
} finally {
  await q(`update "User" set locale=$2, "lastActiveBuildingId"=$3 where id=$1`, [ADMIN.id, ADMIN.locale, ADMIN.lastActiveBuildingId]);
  await q(`update "User" set "lastActiveBuildingId"=$2 where id=$1`, [COOK.id, COOK.lastActiveBuildingId]);
  if (point) {
    const removed = await q(`delete from "PpkRevision" where "organizationId"=$1 and "docKey" like $2 returning number`, [ORG, `%@${point.id}`]);
    const d = await owner.request.delete(`${BASE}/api/settings/buildings/${point.id}`);
    check("cleanup: point revisions removed and test point deleted", d.ok(), `revisions=${removed.length}, delete ${d.status()}`);
  }
  const user = (await q(`select locale, "lastActiveBuildingId" from "User" where id=$1`, [ADMIN.id]))[0];
  check("cleanup: owner locale and active point restored", user.locale === ADMIN.locale && user.lastActiveBuildingId === ADMIN.lastActiveBuildingId, JSON.stringify(user));
  const failed = finish();
  await browser.close();
  await client.end();
  process.exitCode = failed ? 1 : 0;
}
