// Живая проверка решений владельца 2026-11-01 (AC1–AC4) на локальной копии — НЕ прод.
// node .agent/tasks/point-owner-decisions-2026-11-01/raw/live.mjs <out-file>
//   BASE_URL — сервер (3020 «после», 3021 «до»), DB_URL — его копия базы.
import pg from "pg";
import { check, fx, isNotFoundPage, login, note, req, save, withPoint } from "./lib.mjs";

const outFile = process.argv[2] ?? "live-after.txt";
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const [owner, headA, headB, cookA, cookB] = await Promise.all(
  ["owner", "headA", "headB", "cookA", "cookB"].map((key) => login(fx.users[key].email)),
);
const ORG = withPoint(owner, "organization");
const OWNER_A = withPoint(owner, fx.pointA);
const OWNER_B = withPoint(owner, fx.pointB);
const HEAD_A = withPoint(headA, fx.pointA);
const HEAD_B = withPoint(headB, fx.pointB);

// Повторяемый прогон: ППК организации заводим заново (локальная копия).
await q(`delete from "PpkRecord" where "organizationId"=$1`, [fx.orgId]);
await q(`delete from "KnowledgeDocument" where "organizationId"=$1 and (kind is not null or folder is not null)`, [fx.orgId]);
await q(`update "Building" set "ppkSeededAt"=null where "organizationId"=$1`, [fx.orgId]);
await q(`delete from "PaperJournalDocument" where "organizationId"=$1`, [fx.orgId]);

const records = async (cookie, block) => (await req("GET", `/api/production-control/records?block=${block}`, cookie)).json?.records ?? [];
const create = (cookie, block, data) => req("POST", "/api/production-control/records", cookie, { block, data });

// ── AC1. ППК организации (офис / «Вся организация») ───────────────────────
const hazard = await create(ORG, "hazards", {
  step: "Приёмка", hazard: "Сальмонелла", type: "bio", probability: 3, severity: 4, measures: "Входной контроль",
});
const orgHazardId = hazard.json?.record?.id;
await create(ORG, "control-points", {
  hazardId: orgHazardId, kind: "ccp", answers: { q1: true, q2: true, q3: null, q4: null }, number: "ККТ-1",
  limits: "", monitoring: "", frequency: "", responsibleId: null, corrective: "", journalCode: null,
  limitMin: null, limitMax: null,
});
await create(ORG, "team", { userId: fx.users.owner.id, role: "leader", duties: "Руководит группой" });
await create(ORG, "policy", { text: "Политика организации", approvedById: null, approvedAt: null });
const upload = new FormData();
upload.set("kind", "ppk");
upload.set("file", new File([Buffer.from("%PDF-1.4 ORG-PPK")], "ppk-org.pdf", { type: "application/pdf" }));
const orgFile = await req("POST", "/api/production-control/documents", ORG, null, { form: upload });
note(`ППК организации: опасность ${hazard.status}, документ ППК ${orgFile.status}`);

// Первое открытие ППК точки А руководителем точки: копия ППК организации.
const page = await req("GET", "/production-control", HEAD_A);
note(`руководитель точки А открыл ППК: ${page.status}`);
const hazA = await records(HEAD_A, "hazards");
const cpA = await records(HEAD_A, "control-points");
check(
  "точка А получила свою копию ППК организации (новые id)",
  hazA.length === 1 && hazA[0].id !== orgHazardId,
  `опасностей ${hazA.length}, id ${hazA[0]?.id === orgHazardId ? "те же" : "свои"}`,
);
check(
  "ККТ точки А ссылается на опасность точки А (ссылки перенесены)",
  cpA.length === 1 && cpA[0].data.hazardId === hazA[0]?.id,
  `hazardId=${cpA[0]?.data?.hazardId === hazA[0]?.id ? "копия" : cpA[0]?.data?.hazardId === orgHazardId ? "опасность организации" : cpA[0]?.data?.hazardId}`,
);

// Правка на точке А не меняет организацию и точку Б.
const polA = await records(HEAD_A, "policy");
const editA = await req("PATCH", `/api/production-control/records/${polA[0]?.id}`, HEAD_A, {
  data: { text: "Политика точки А", approvedById: null, approvedAt: null },
});
const polOrg = await records(ORG, "policy");
const polB = await records(OWNER_B, "policy");
check("правка политики на точке А", editA.status === 200, `HTTP ${editA.status}`);
check("политика организации не изменилась", polOrg[0]?.data?.text === "Политика организации", polOrg[0]?.data?.text);
check("политика точки Б не изменилась (своя копия)", polB[0]?.data?.text === "Политика организации", polB[0]?.data?.text);
check(
  "у политики точки своя публичная ссылка",
  Boolean(polA[0]?.data?.token) && polA[0]?.data?.token !== polOrg[0]?.data?.token,
);

// Запись точки Б по id у руководителя точки А — «не найдено».
const hazB = await records(OWNER_B, "hazards");
const foreign = await req("PATCH", `/api/production-control/records/${hazB[0]?.id}`, HEAD_A, {
  data: { step: "Чужая", hazard: "Чужая", type: "bio", probability: 1, severity: 1, measures: "" },
});
check("руководитель точки А не правит запись ППК точки Б", foreign.status === 404, `HTTP ${foreign.status}`);
const foreignDel = await req("DELETE", `/api/production-control/records/${hazB[0]?.id}`, HEAD_A);
check("руководитель точки А не удаляет запись ППК точки Б", foreignDel.status === 404, `HTTP ${foreignDel.status}`);

// Группа ХАССП: только люди точки.
const addB = await create(HEAD_A, "team", { userId: fx.users.cookB.id, role: "member", duties: "" });
check("в группу ХАССП точки А нельзя взять повара точки Б", addB.status === 400, `HTTP ${addB.status} ${addB.json?.error ?? ""}`);
const addA = await create(HEAD_A, "team", { userId: fx.users.cookA.id, role: "member", duties: "" });
check("в группу ХАССП точки А можно взять повара точки А", addA.status === 201, `HTTP ${addA.status} ${addA.json?.error ?? ""}`);
const teamB = await records(OWNER_B, "team");
check("группа точки Б не изменилась", teamB.length === 1 && !teamB.some((r) => r.data.userId === fx.users.cookA.id), `в группе Б ${teamB.length}`);
const teamPage = await req("GET", "/production-control/haccp/team", HEAD_A);
check("страница группы точки А не показывает повара точки Б в выборе", teamPage.status === 200 && !teamPage.text.includes("Повар Бета"), `HTTP ${teamPage.status}`);

// Загруженный ППК: точка заменяет свой, у организации прежний.
const uploadA = new FormData();
uploadA.set("kind", "ppk");
uploadA.set("file", new File([Buffer.from("%PDF-1.4 POINT-A-PPK")], "ppk-a.pdf", { type: "application/pdf" }));
const upA = await req("POST", "/api/production-control/documents", HEAD_A, null, { form: uploadA });
const fileA = await req("GET", "/api/production-control/documents/ppk/file", HEAD_A);
const fileOrg = await req("GET", "/api/production-control/documents/ppk/file", ORG);
const fileB = await req("GET", "/api/production-control/documents/ppk/file", OWNER_B);
check("точка А загрузила свой ППК", upA.status === 201 && fileA.text.includes("POINT-A-PPK"), `HTTP ${upA.status}`);
check("файл ППК организации прежний", fileOrg.text.includes("ORG-PPK"), fileOrg.text.slice(0, 30));
check("файл ППК точки Б — копия организации, не точки А", fileB.text.includes("ORG-PPK"), fileB.text.slice(0, 30));

// Проверяющий по ссылке точки — её ППК.
const inspA = await req("GET", `/api/inspector/${fx.inspectorRaw.A}/production-control/ppk?file=1`);
const inspB = await req("GET", `/api/inspector/${fx.inspectorRaw.B}/production-control/ppk?file=1`);
check("проверяющий точки А получает ППК точки А", inspA.text.includes("POINT-A-PPK"), `HTTP ${inspA.status} ${inspA.text.slice(0, 30)}`);
check("проверяющий точки Б получает ППК точки Б", inspB.text.includes("ORG-PPK") && !inspB.text.includes("POINT-A"), `HTTP ${inspB.status} ${inspB.text.slice(0, 30)}`);

// Ознакомление: повар видит политику своей точки.
const ackA = await req("GET", "/acknowledge/policy", withPoint(cookA, fx.pointA));
const ackB = await req("GET", "/acknowledge/policy", withPoint(cookB, fx.pointB));
check("повар точки А знакомится с политикой точки А", ackA.text.includes("Политика точки А"), `HTTP ${ackA.status}`);
check("повар точки Б знакомится с политикой точки Б", ackB.text.includes("Политика организации") && !ackB.text.includes("Политика точки А"), `HTTP ${ackB.status}`);

// Копия — один раз: точка, удалившая всё, не получает ППК снова; одновременные открытия не дублируют.
for (const row of await records(HEAD_A, "hazards")) await req("DELETE", `/api/production-control/records/${row.id}`, HEAD_A);
await req("GET", "/production-control", HEAD_A);
const afterDelete = await records(HEAD_A, "hazards");
check("точка, удалившая опасности, не получает копию снова", afterDelete.length === 0, `опасностей ${afterDelete.length}`);
await q(`delete from "PpkRecord" where "buildingId"=$1`, [fx.pointB]);
await q(`delete from "KnowledgeDocument" where "buildingId"=$1`, [fx.pointB]);
await q(`update "Building" set "ppkSeededAt"=null where id=$1`, [fx.pointB]);
await Promise.all(Array.from({ length: 6 }, () => req("GET", "/api/production-control/records?block=hazards", OWNER_B)));
const [{ n: orgCount }] = await q(`select count(*)::int n from "PpkRecord" where "organizationId"=$1 and "buildingId" is null`, [fx.orgId]);
const [{ n: bCount }] = await q(`select count(*)::int n from "PpkRecord" where "buildingId"=$1`, [fx.pointB]);
check("шесть одновременных первых открытий точки Б — одна копия", bCount === orgCount, `организация ${orgCount}, точка Б ${bCount}`);

// ── AC2. «Закрыть день» на уровне организации ──────────────────────────────
// В копии кнопка «Автозаполнить» выключена спецрежимом — включает владелец.
const controls = await req("PATCH", "/api/settings/journal-controls", ORG, {
  automation: { enabled: true, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: true },
});
note(`владелец включил «Автозаполнить» на главной: ${controls.status}`);
const closeOrg = await req("POST", "/api/dashboard/close-day", ORG, { upTo: new Date().toISOString().slice(0, 10) });
check("«Закрыть день» в режиме организации — просит точку", closeOrg.status === 400 && /Выберите точку/.test(closeOrg.json?.error ?? ""), `HTTP ${closeOrg.status} ${closeOrg.json?.error ?? ""}`);
const closeA = await req("POST", "/api/dashboard/close-day", OWNER_A, { upTo: new Date().toISOString().slice(0, 10) });
check("«Закрыть день» на точке А работает", closeA.status === 200, `HTTP ${closeA.status} ${closeA.json?.error ?? ""}`);
// Кнопка рисуется в браузере: проверяем её свойство в данных страницы (RSC), вид — снимком.
const dash = await req("GET", "/dashboard", ORG);
const dashA = await req("GET", "/dashboard", OWNER_A);
check("главная в режиме организации: кнопка просит точку", dash.text.includes('pointRequired\\":true'), `HTTP ${dash.status}`);
check("главная на точке А: кнопка запускает автозаполнение", dashA.text.includes('pointRequired\\":false'), `HTTP ${dashA.status}`);

// ── AC3. Приказы и УПД ─────────────────────────────────────────────────────
const ordersHead = await req("GET", "/orders", HEAD_A);
check("«Приказы» руководителю точки закрыты", [302, 303, 307, 308].includes(ordersHead.status) && /\/dashboard/.test(ordersHead.headers.get("location") ?? ""), `HTTP ${ordersHead.status} → ${ordersHead.headers.get("location")}`);
const ordersOwner = await req("GET", "/orders", ORG);
check("«Приказы» руководству компании открыты", ordersOwner.status === 200, `HTTP ${ordersOwner.status}`);
const orderCreate = await req("POST", "/api/orders", HEAD_A, { templateCode: "haccp-responsible", number: "1", issuedAt: "2026-11-01", values: {} });
check("руководитель точки не издаёт приказ", orderCreate.status === 403, `HTTP ${orderCreate.status}`);
const orderPdfHead = await req("GET", "/api/orders/haccp-responsible/pdf", HEAD_A);
const orderPdfOwner = await req("GET", "/api/orders/haccp-responsible/pdf", ORG);
check("PDF приказа компании — не руководителю точки", orderPdfHead.status === 403, `HTTP ${orderPdfHead.status}`);
check("PDF приказа — руководству компании", orderPdfOwner.status === 200, `HTTP ${orderPdfOwner.status}`);
const [payment] = await q(`select id from "PaymentOrder" where "organizationId"=$1 order by id desc limit 1`, [fx.orgId]);
if (payment) {
  const updHead = await req("GET", `/api/closing-documents/${payment.id}/pdf`, HEAD_A);
  const updOwner = await req("GET", `/api/closing-documents/${payment.id}/pdf`, ORG);
  check("УПД руководителю точки — отказ", updHead.status === 404 && updHead.json?.error === "Не найдено", `HTTP ${updHead.status} ${updHead.json?.error ?? ""}`);
  check("УПД руководству — не «не найдено»", updOwner.json?.error !== "Не найдено", `HTTP ${updOwner.status} ${updOwner.json?.error ?? "файл"}`);
} else {
  note("платежей в копии нет — УПД проверен тестом маршрута");
}
const updRefresh = await req("POST", "/api/closing-documents/1/refresh-buyer", HEAD_A);
check("руководитель точки не меняет покупателя в УПД", updRefresh.status === 403, `HTTP ${updRefresh.status}`);

// ── AC4. Бумажные журналы по точкам ───────────────────────────────────────
const paperA = await req("POST", "/api/settings/journals/paper/ot_intro/documents", OWNER_A, { title: "Инструктаж точки А" });
const paperAId = paperA.json?.document?.id;
const [paperRow] = paperAId ? await q(`select "buildingId" from "PaperJournalDocument" where id=$1`, [paperAId]) : [];
check("бумажный документ привязан к точке из шапки", paperRow?.buildingId === fx.pointA, `buildingId=${paperRow?.buildingId ?? "нет"}`);
const listB = await req("GET", "/api/settings/journals/paper/ot_intro/documents", HEAD_B);
check("руководитель точки Б не видит документ точки А в списке", listB.status === 200 && !(listB.json?.documents ?? []).some((d) => d.id === paperAId), `HTTP ${listB.status}`);
const getB = await req("GET", `/api/settings/journals/paper/ot_intro/documents/${paperAId}`, HEAD_B);
const putB = await req("PUT", `/api/settings/journals/paper/ot_intro/documents/${paperAId}`, HEAD_B, { rows: [["x"]] });
const delB = await req("DELETE", `/api/settings/journals/paper/ot_intro/documents/${paperAId}`, HEAD_B);
const [stillThere] = await q(`select count(*)::int n from "PaperJournalDocument" where id=$1`, [paperAId]);
check("документ точки А по ссылке у точки Б — «не найдено»", getB.status === 404 && putB.status === 404, `GET ${getB.status}, PUT ${putB.status}`);
check("точка Б не удаляет документ точки А", stillThere.n === 1, `DELETE ${delB.status}, осталось ${stillThere.n}`);
const pageB = await req("GET", `/settings/journals/paper/ot_intro/documents/${paperAId}`, HEAD_B);
check("страница документа точки А у точки Б — «не найдено»", isNotFoundPage(pageB), `HTTP ${pageB.status}`);
const listOrg = await req("GET", "/api/settings/journals/paper/ot_intro/documents", ORG);
const inOrg = (listOrg.json?.documents ?? []).find((d) => d.id === paperAId);
check("руководство на уровне организации видит документ точки А с её названием", Boolean(inOrg) && inOrg.buildingName === "Точка А", `buildingName=${inOrg?.buildingName ?? "нет"}`);
const listA = await req("GET", "/api/settings/journals/paper/ot_intro/documents", HEAD_A);
check("руководитель точки А видит свой документ", (listA.json?.documents ?? []).some((d) => d.id === paperAId), `HTTP ${listA.status}`);

await db.end();
save(outFile);
