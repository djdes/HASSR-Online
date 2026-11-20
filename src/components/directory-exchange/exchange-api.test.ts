import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approvalBody,
  defaultOwnOrganizations,
  creationRefusal,
  decisionView,
  exchangeParticipants,
  isEmptyResult,
  isExpired,
  keepsRequestOpen,
  linkMembers,
  narrowKinds,
  ownParticipants,
  isExchangeRunning,
  parseDecisionResult,
  parseDecisionState,
  parseForeignRequest,
  parseForeignState,
  parseMoment,
  parseState,
  parseSummary,
  parseTransferItems,
  pendingRequests,
  summaryTotals,
  togglePicked,
  transferSelection,
  withOutgoing,
  withoutForeign,
  type ExchangeMember,
  type ForeignRequest,
  type TransferItem,
  type TransferItems,
} from "./exchange-api";

const member = (organizationId: string, kinds: ExchangeMember["kinds"]): ExchangeMember => ({
  organizationId,
  name: organizationId,
  kinds,
  lastSyncedAt: null,
});

const stateOf = (members: ExchangeMember[]) => ({ organization: { id: "new", name: "Новая" }, members });

test("link: the current organisation and every selected sibling carry the chosen lists", () => {
  assert.deepEqual(linkMembers(stateOf([]), ["a", "b", "a"], ["staff", "products"]), [
    { organizationId: "new", kinds: ["products", "staff"] },
    { organizationId: "a", kinds: ["products", "staff"] },
    { organizationId: "b", kinds: ["products", "staff"] },
  ]);
});

test("link: joining an existing exchange does not cut the lists other organisations share", () => {
  const members = [member("a", ["products", "staff"]), member("b", ["products", "staff"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], ["equipment"]), [
    { organizationId: "new", kinds: ["equipment"] },
    { organizationId: "a", kinds: ["products", "staff", "equipment"] },
  ]);
});

test("link: a list left with a single participant is dropped from the linked sibling", () => {
  const members = [member("new", ["products", "staff"]), member("a", ["products", "staff"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], ["products"]), [
    { organizationId: "new", kinds: ["products"] },
    { organizationId: "a", kinds: ["products"] },
  ]);
});

test("link: no lists means the current organisation leaves and nobody else is touched", () => {
  const members = [member("new", ["products"]), member("a", ["products"])];
  assert.deepEqual(linkMembers(stateOf(members), ["a"], []), [{ organizationId: "new", kinds: [] }]);
});

const items: TransferItems = {
  products: [
    { id: "p1", name: "Молоко", detail: null, exists: false, parentId: null },
    { id: "p2", name: "Сыр", detail: "Молочная продукция", exists: true, parentId: null },
    { id: "p3", name: "Хлеб", detail: null, exists: false, parentId: null },
  ],
  staff: [{ id: "s1", name: "Иванова Мария", detail: "Повар", exists: false, parentId: null }],
  objects: [{ id: "o1", name: "Кафе", detail: null, exists: true, parentId: null }],
  equipment: [],
  journals: [],
  checklists: [],
};

test("transfer: everything available goes as «all», a part goes by id, empty lists are not sent", () => {
  const picked = { products: ["p1", "p2", "p3"], staff: ["s1"], objects: ["o1"], equipment: [], journals: [], checklists: [] };
  assert.deepEqual(transferSelection(items, ["products", "staff", "objects", "equipment"], picked), {
    products: "all",
    staff: "all",
  });
  assert.deepEqual(transferSelection(items, ["products", "staff"], { ...picked, products: ["p3"] }), {
    products: ["p3"],
    staff: "all",
  });
  // Список не отмечен галочкой — его позиции не едут, даже если выбраны.
  assert.deepEqual(transferSelection(items, ["staff"], picked), { staff: "all" });
});

test("transfer: a record brings its parent, a parent takes its records along", () => {
  // Должность «Повар» уже есть у получателя, «Бармен» — нет.
  const staff: TransferItem[] = [
    { id: "cook", name: "Повар", detail: null, exists: true, parentId: null },
    { id: "ivanova", name: "Иванова", detail: "Повар", exists: false, parentId: "cook" },
    { id: "barman", name: "Бармен", detail: null, exists: false, parentId: null },
    { id: "petrov", name: "Петров", detail: "Бармен", exists: false, parentId: "barman" },
    { id: "sidorov", name: "Сидоров", detail: "Бармен", exists: true, parentId: "barman" },
  ];
  // Запись тянет родителя, которого ещё нет; существующий родитель не отмечается.
  assert.deepEqual(togglePicked(staff, [], "petrov"), ["barman", "petrov"]);
  assert.deepEqual(togglePicked(staff, [], "ivanova"), ["ivanova"]);
  // Родитель отмечает свои записи (кроме тех, что уже есть) и снимает их вместе с собой.
  assert.deepEqual(togglePicked(staff, ["ivanova"], "barman"), ["ivanova", "barman", "petrov"]);
  assert.deepEqual(togglePicked(staff, ["ivanova", "barman", "petrov"], "barman"), ["ivanova"]);
  // Снятая запись родителя не снимает: должность можно перенести и без людей.
  assert.deepEqual(togglePicked(staff, ["barman", "petrov"], "petrov"), ["barman"]);
  // То, что у получателя уже есть, и неизвестный id выбор не меняют.
  assert.deepEqual(togglePicked(staff, ["ivanova"], "cook"), ["ivanova"]);
  assert.deepEqual(togglePicked(staff, ["ivanova"], "missing"), ["ivanova"]);
});

test("responses are parsed defensively and totals are summed per organisation", () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState({ canManage: true }), null);
  const state = parseState({
    canManage: true,
    organization: { id: "new", name: "Новая" },
    counts: { products: 3, staff: "7", journals: 1, checklists: 4 },
    siblings: [{ id: "a", name: "Кафе", counts: { equipment: 2 }, locked: true }, { name: "без id" }],
    cabinet: null,
    members: [
      { organizationId: "a", name: "Кафе", kinds: ["staff", "unknown", "products"], lastSyncedAt: "2026-11-19T01:00:00.000Z" },
      { organizationId: "b", name: "Вышла", kinds: [] },
    ],
    lastSync: { organizations: [], notes: ["  ", "Заметка"] },
  });
  if (!state) throw new Error("a complete response must be parsed");
  assert.deepEqual(state.counts, { products: 3, staff: 0, objects: 0, equipment: 0, journals: 1, checklists: 4 });
  assert.deepEqual(state.siblings, [
    { id: "a", name: "Кафе", counts: { products: 0, staff: 0, objects: 0, equipment: 2, journals: 0, checklists: 0 }, locked: true },
  ]);
  assert.deepEqual(state.members[0].kinds, ["products", "staff"]);
  assert.deepEqual(exchangeParticipants(state).map((entry) => entry.organizationId), ["a"]);
  assert.deepEqual(state.lastSync, { organizations: [], notes: ["Заметка"] });

  const parsed = parseTransferItems({
    items: {
      staff: [
        { id: "cook", name: "Повар", detail: " ", exists: 1, entity: "position", parentId: null },
        { id: "s1", name: "Иванова", detail: "Повар", exists: true, entity: "staff", parentId: "cook" },
        { name: "без id" },
      ],
    },
  });
  assert.deepEqual(parsed, {
    products: [],
    staff: [
      { id: "cook", name: "Повар", detail: null, exists: false, parentId: null },
      { id: "s1", name: "Иванова", detail: "Повар", exists: true, parentId: "cook" },
    ],
    objects: [],
    equipment: [],
    journals: [],
    checklists: [],
  });

  const summary = parseSummary({
    organizations: [
      { organizationId: "a", name: "Кафе", kinds: { staff: { created: 2, updated: 1, skippedLimit: 3, skippedConflict: 0 } } },
      { organizationId: "new", name: "Новая", kinds: { products: { created: 5 }, objects: null } },
    ],
  });
  assert.deepEqual(summaryTotals(summary), { created: 7, updated: 1, skippedLimit: 3, skippedConflict: 0 });
  assert.deepEqual(summaryTotals(summary, "new"), { created: 5, updated: 0, skippedLimit: 0, skippedConflict: 0 });
  assert.equal(isEmptyResult(summaryTotals(summary, "missing")), true);
  assert.equal(isEmptyResult(summaryTotals(null)), true);
});

const outgoing = (id: string, status: ForeignRequest["status"]): ForeignRequest => ({
  id,
  cabinetName: "Кабинет",
  mode: "link",
  kinds: ["products"],
  status,
  expiresAt: null,
  createdAt: null,
});

test("foreign: requests, links, incoming requests and foreign members are parsed defensively", () => {
  assert.deepEqual(parseForeignState(null), { outgoing: [], foreignLinks: [], incoming: [], foreignMembers: [] });
  assert.deepEqual(parseForeignState({ outgoing: "нет", incoming: {} }), {
    outgoing: [],
    foreignLinks: [],
    incoming: [],
    foreignMembers: [],
  });

  const request = {
    id: "r1",
    cabinetName: "Сеть «Север»",
    mode: "transfer",
    kinds: ["staff", "unknown", "products"],
    status: "pending",
    expiresAt: "2026-11-26T09:00:00.000Z",
    createdAt: "2026-11-19T09:00:00.000Z",
    // Лишнее о чужой компании в разбор не попадает, даже если сервер его прислал.
    masterOrganizationId: "secret",
    ownerEmail: "owner@example.com",
  };
  assert.deepEqual(parseForeignRequest(request), {
    id: "r1",
    cabinetName: "Сеть «Север»",
    mode: "transfer",
    kinds: ["products", "staff"],
    status: "pending",
    expiresAt: "2026-11-26T09:00:00.000Z",
    createdAt: "2026-11-19T09:00:00.000Z",
  });
  // Без id, с неизвестным способом или статусом запрос не показываем.
  assert.equal(parseForeignRequest({ ...request, id: "" }), null);
  assert.equal(parseForeignRequest({ ...request, mode: "merge" }), null);
  assert.equal(parseForeignRequest({ ...request, status: "lost" }), null);
  assert.equal(parseForeignRequest("r1"), null);

  const state = parseForeignState({
    outgoing: [request, { id: "r2", mode: "link", status: "declined", kinds: [] }, { id: "r3", mode: "link" }],
    foreignLinks: [{ id: "l1", cabinetName: "Кабинет", kinds: ["equipment"], since: "2026-11-01T00:00:00.000Z" }, { cabinetName: "без id" }],
    incoming: [
      { id: "i1", requesterName: "ООО «Юг»", mode: "link", kinds: ["objects"], expiresAt: " ", createdAt: 5 },
      { id: "i2", requesterName: "без способа" },
    ],
    foreignMembers: [
      { organizationId: "org-1", name: "ООО «Юг»", kinds: ["products"], since: "2026-11-02T00:00:00.000Z" },
      { id: "req-9", organizationId: "org-2", name: "ИП Иванов", kinds: [] },
      { name: "без id" },
    ],
  });
  assert.deepEqual(state.outgoing.map((entry) => [entry.id, entry.status]), [["r1", "pending"], ["r2", "declined"]]);
  assert.deepEqual(pendingRequests(state).map((entry) => entry.id), ["r1"]);
  assert.deepEqual(state.foreignLinks, [
    { id: "l1", cabinetName: "Кабинет", kinds: ["equipment"], since: "2026-11-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(state.incoming, [
    { id: "i1", requesterName: "ООО «Юг»", mode: "link", kinds: ["objects"], expiresAt: null, createdAt: null },
  ]);
  // Ключ для «Отключить»: id из ответа, а без него — id организации.
  assert.deepEqual(state.foreignMembers, [
    { id: "org-1", organizationId: "org-1", name: "ООО «Юг»", kinds: ["products"], since: "2026-11-02T00:00:00.000Z" },
    { id: "req-9", organizationId: "org-2", name: "ИП Иванов", kinds: [], since: null },
  ]);
});

test("foreign: a sent request comes first, a removed record disappears, foreign members are not listed twice", () => {
  const state = parseForeignState({
    outgoing: [outgoing("r1", "pending")],
    foreignLinks: [{ id: "l1", cabinetName: "Кабинет", kinds: ["products"] }],
    foreignMembers: [{ organizationId: "org-1", name: "ООО «Юг»", kinds: ["products"] }],
  });
  const sent = withOutgoing(state, outgoing("r2", "pending"));
  assert.deepEqual(sent.outgoing.map((entry) => entry.id), ["r2", "r1"]);
  // Тот же запрос второй раз не добавляется.
  const renamed = withOutgoing(sent, { ...outgoing("r1", "pending"), cabinetName: "Новое имя" });
  assert.deepEqual(renamed.outgoing.map((entry) => [entry.id, entry.cabinetName]), [
    ["r1", "Новое имя"],
    ["r2", "Кабинет"],
  ]);
  assert.deepEqual(withoutForeign(sent, "r1").outgoing.map((entry) => entry.id), ["r2"]);
  assert.deepEqual(withoutForeign(sent, "l1").foreignLinks, []);
  assert.deepEqual(withoutForeign(sent, "org-1").foreignMembers, []);
  assert.equal(state.outgoing.length, 1, "the source state is not mutated");

  const members = [member("own", ["products"]), member("org-1", ["products"]), member("left", [])];
  assert.deepEqual(ownParticipants({ members }, state).map((entry) => entry.organizationId), ["own"]);
  assert.deepEqual(ownParticipants({ members }, null).map((entry) => entry.organizationId), ["own", "org-1"]);
});

test("decision: the token payload is parsed, the owner can only narrow the lists, transfer needs an own source", () => {
  assert.equal(parseDecisionState(null), null);
  assert.equal(parseDecisionState({ cabinet: { id: "c", name: "Кабинет" } }), null);
  assert.equal(parseDecisionState({ request: { id: "r1", mode: "link" } }), null);

  const state = parseDecisionState({
    request: {
      id: "r1",
      requesterName: "ООО «Юг»",
      requesterInn: " 7701234567 ",
      mode: "transfer",
      kinds: ["staff", "products"],
      status: "pending",
      expiresAt: "2026-11-26T09:00:00.000Z",
    },
    cabinet: { id: "c1", name: "Мастер-кабинет" },
    sources: [{ id: "o1", name: "Кафе" }, { name: "без id" }, { id: "o2" }],
  });
  if (!state) throw new Error("a complete payload must be parsed");
  assert.deepEqual(state, {
    request: {
      id: "r1",
      requesterName: "ООО «Юг»",
      requesterInn: "7701234567",
      mode: "transfer",
      kinds: ["products", "staff"],
      status: "pending",
      expiresAt: "2026-11-26T09:00:00.000Z",
      withPool: false,
    },
    cabinet: { id: "c1", name: "Мастер-кабинет" },
    sources: [
      { id: "o1", name: "Кафе" },
      { id: "o2", name: "" },
    ],
    linkedIds: [],
  });
  // ИНН нет — строки с ним не будет; кабинет и источники могут не прийти.
  const bare = parseDecisionState({ request: { id: "r2", mode: "link", status: "expired", requesterInn: null } });
  assert.deepEqual(bare?.request.requesterInn, null);
  assert.deepEqual(bare?.cabinet, { id: "", name: "" });
  assert.deepEqual(bare?.sources, []);

  // Разрешить можно только запрошенное: лишний список отбрасывается, порядок — как в окне.
  assert.deepEqual(narrowKinds(["products", "staff"], ["equipment", "staff", "products"]), ["products", "staff"]);
  assert.deepEqual(narrowKinds(["products", "staff"], ["objects"]), []);

  // Перенос: без своей организации-источника и без списков подтверждать нечего.
  assert.equal(approvalBody(state, ["products"], ""), null);
  assert.equal(approvalBody(state, ["products"], "foreign-org"), null);
  assert.equal(approvalBody(state, ["equipment"], "o1"), null);
  assert.deepEqual(approvalBody(state, ["staff", "equipment"], "o1"), {
    decision: "approve",
    allowedKinds: ["staff"],
    sourceOrganizationId: "o1",
  });
  // Связь: источник не нужен; нужны свои организации владельца — только из его списка.
  const link = { request: { mode: "link" as const, kinds: state.request.kinds }, sources: state.sources };
  assert.equal(approvalBody(link, ["products", "staff"], "o1"), null, "no own organization ticked");
  assert.equal(approvalBody(link, ["products"], "", ["foreign-org"]), null, "a foreign id is not one of the owner's");
  assert.deepEqual(approvalBody(link, ["products", "staff"], "", ["o2", "foreign-org", "o1"]), {
    decision: "approve",
    allowedKinds: ["products", "staff"],
    organizationIds: ["o1", "o2"],
  });
  assert.equal(approvalBody(link, [], "", ["o1"]), null);
  // Меню и сырьё (серия C1): уходят, только если компания их просила и владелец отметил их сам.
  const pooled = { ...link, request: { ...link.request, withPool: true } };
  assert.deepEqual(approvalBody(pooled, ["products"], "", ["o1"]), { decision: "approve", allowedKinds: ["products"], organizationIds: ["o1"] });
  assert.deepEqual(approvalBody(pooled, ["products"], "", ["o1"], true), {
    decision: "approve",
    allowedKinds: ["products"],
    organizationIds: ["o1"],
    allowPool: true,
  });
  assert.deepEqual(approvalBody(link, ["products"], "", ["o1"], true), { decision: "approve", allowedKinds: ["products"], organizationIds: ["o1"] }, "not asked — not sent");
  assert.equal(parseDecisionState({ request: { id: "r3", mode: "link", status: "pending", withPool: true } })?.request.withPool, true);
  assert.equal(parseDecisionState({ request: { id: "r4", mode: "transfer", status: "pending", withPool: true } })?.request.withPool, false);
  // По умолчанию отмечены уже обменивающиеся; их нет — единственная организация.
  assert.deepEqual(defaultOwnOrganizations({ sources: state.sources, linkedIds: ["o2"] }), ["o2"]);
  assert.deepEqual(defaultOwnOrganizations({ sources: [{ id: "o1", name: "Кафе" }], linkedIds: [] }), ["o1"]);
  assert.deepEqual(defaultOwnOrganizations({ sources: state.sources, linkedIds: [] }), []);
  // Чужой id в linkedIds отбрасывается разбором.
  assert.deepEqual(
    parseDecisionState({ request: { id: "r", mode: "link", status: "pending" }, sources: [{ id: "o1", name: "Кафе" }], linkedIds: ["o1", "x"] })?.linkedIds,
    ["o1"],
  );
});

test("decision: the answer keeps the server status, a summary belongs to an approval only", () => {
  const summary = { organizations: [{ organizationId: "a", name: "Кафе", kinds: { staff: { created: 2 } } }] };
  const approved = parseDecisionResult({ ok: true, status: "approved", summary }, "approve");
  assert.equal(approved.status, "approved");
  assert.deepEqual(summaryTotals(approved.summary), { created: 2, updated: 0, skippedLimit: 0, skippedConflict: 0 });
  assert.deepEqual(parseDecisionResult({ ok: true, status: "approved" }, "approve"), { status: "approved", summary: null, running: false });
  assert.deepEqual(parseDecisionResult({ ok: true, status: "declined", summary }, "decline"), { status: "declined", summary: null, running: false });
  // Статус не пришёл — он следует из самого решения.
  assert.deepEqual(parseDecisionResult({ ok: true }, "decline"), { status: "declined", summary: null, running: false });
  assert.deepEqual(parseDecisionResult(null, "approve"), { status: "approved", summary: null, running: false });
});

test("decision and save, series A Р5: a long first exchange is reported as running", () => {
  assert.deepEqual(parseDecisionResult({ ok: true, status: "approved", running: true }, "approve"), {
    status: "approved",
    summary: null,
    running: true,
  });
  // Отказ не бывает «в фоне», даже если сервер так сказал.
  assert.equal(parseDecisionResult({ ok: true, status: "declined", running: true }, "decline").running, false);
  assert.equal(isExchangeRunning({ ok: true, running: true }), true);
  assert.equal(isExchangeRunning({ ok: true, running: "true" }), false);
  assert.equal(isExchangeRunning({ ok: true, summary: { organizations: [] } }), false);
  assert.equal(isExchangeRunning(null), false);
});

test("dates: an unreadable moment is null, an unknown term is not treated as expired", () => {
  assert.equal(parseMoment(null), null);
  assert.equal(parseMoment(""), null);
  assert.equal(parseMoment("завтра"), null);
  assert.equal(parseMoment("2026-11-26T09:00:00.000Z")?.toISOString(), "2026-11-26T09:00:00.000Z");
  const now = Date.parse("2026-11-26T09:00:00.000Z");
  assert.equal(isExpired("2026-11-26T09:00:00.000Z", now), true);
  assert.equal(isExpired("2026-11-26T09:00:00.001Z", now), false);
  assert.equal(isExpired(null, now), false);
  assert.equal(isExpired("завтра", now), false);
});

test("decision page: the server answer picks the form, a refusal or the way the request ended", () => {
  const now = Date.parse("2026-11-20T09:00:00.000Z");
  const payload = (status: string, expiresAt = "2026-11-26T09:00:00.000Z") => ({
    request: { id: "r1", requesterName: "ООО «Юг»", mode: "link", kinds: ["products"], status, expiresAt },
    cabinet: { id: "c1", name: "Мастер-кабинет" },
    sources: [],
  });
  const answer = (status: number, json: Record<string, unknown> | null) => ({ ok: status >= 200 && status < 300, status, json });

  const form = decisionView(answer(200, payload("pending")), now);
  assert.equal(form.kind, "form");
  assert.equal(form.kind === "form" ? form.data.request.requesterName : "", "ООО «Юг»");

  // Решение уже принято, запрос отменён или просрочен — говорим, чем именно он закончился.
  assert.deepEqual(decisionView(answer(200, payload("approved")), now), { kind: "closed", status: "approved" });
  assert.deepEqual(decisionView(answer(200, payload("declined")), now), { kind: "closed", status: "declined" });
  assert.deepEqual(decisionView(answer(200, payload("cancelled")), now), { kind: "closed", status: "cancelled" });
  assert.deepEqual(decisionView(answer(200, payload("expired")), now), { kind: "closed", status: "expired" });
  // Срок вышел, а сервер ещё числит запрос ожидающим — подтверждать уже нечего.
  assert.deepEqual(decisionView(answer(200, payload("pending", "2026-11-20T08:59:59.000Z")), now), {
    kind: "closed",
    status: "expired",
  });

  assert.deepEqual(decisionView(answer(401, { error: "Не авторизован" }), now), { kind: "signedOut" });
  assert.deepEqual(decisionView(answer(403, { error: "Только владелец" }), now), { kind: "forbidden" });
  assert.deepEqual(decisionView(answer(404, { error: "Не найдено" }), now), { kind: "missing" });
  // 409 называет исход статусом, вложенным запросом или кодом причины; не называет — исход неизвестен.
  const closed = (json: Record<string, unknown>) => decisionView(answer(409, json), now);
  assert.deepEqual(closed({ error: "Срок истёк", status: "expired" }), { kind: "closed", status: "expired" });
  assert.deepEqual(closed({ error: "Уже решён", request: { status: "declined" } }), { kind: "closed", status: "declined" });
  assert.deepEqual(closed({ error: "Срок истёк", code: "request_expired" }), { kind: "closed", status: "expired" });
  assert.deepEqual(closed({ error: "Отменён", code: "request_cancelled" }), { kind: "closed", status: "cancelled" });
  assert.deepEqual(closed({ error: "Отменён", reason: "cancelled" }), { kind: "closed", status: "cancelled" });
  assert.deepEqual(closed({ error: "Решение принято", code: "request_decided" }), { kind: "closed", status: null });
  // Кабинет занят другим обменом — тоже 409, но запрос при этом ещё ждёт решения.
  assert.deepEqual(closed({ error: "Обмен уже идёт", code: "exchange_busy" }), { kind: "closed", status: null });
  assert.deepEqual(closed({ error: "Странно", status: "pending" }), { kind: "closed", status: null });
  // Сеть упала, сервер ответил ошибкой или прислал не то — показываем «не удалось загрузить».
  assert.deepEqual(decisionView(answer(0, null), now), { kind: "failed" });
  assert.deepEqual(decisionView(answer(500, { error: "Ошибка" }), now), { kind: "failed" });
  assert.deepEqual(decisionView(answer(200, { request: { id: "r1" } }), now), { kind: "failed" });
});

test("refusals: a busy cabinet and an unpaid requester keep the form, a recent decline stays in the block", () => {
  const answer = (status: number, json: Record<string, unknown> | null) => ({ ok: status >= 200 && status < 300, status, json });
  const now = Date.parse("2026-11-20T09:00:00.000Z");

  // Подтверждение: у заявителя нет платного тарифа (или прежняя версия сервера ответила, что к кабинету
  // уже подключена другая компания) — запрос по-прежнему ждёт решения, форму не закрываем и не перечитываем.
  const busy = answer(409, { error: "К кабинету уже подключена «Юг»", code: "request_cabinet_busy" });
  const unpaid = answer(409, { error: "У заявителя закончился тариф", code: "request_requester_not_paid" });
  assert.equal(keepsRequestOpen(busy), true);
  assert.equal(keepsRequestOpen(unpaid), true);
  // Сам по себе такой отказ исход запроса не называет.
  assert.deepEqual(decisionView(busy, now), { kind: "closed", status: null });
  // Запрос закрыт, код неизвестен или тот же код пришёл не с 409 — прежнее поведение.
  assert.equal(keepsRequestOpen(answer(409, { error: "Срок истёк", code: "request_expired" })), false);
  assert.equal(keepsRequestOpen(answer(409, { error: "Решение принято", code: "request_decided" })), false);
  assert.equal(keepsRequestOpen(answer(409, { error: "Обмен уже идёт", code: "exchange_busy" })), false);
  assert.equal(keepsRequestOpen(answer(409, { error: "Без кода" })), false);
  assert.equal(keepsRequestOpen(answer(400, { error: "Странно", code: "request_cabinet_busy" })), false);
  assert.equal(keepsRequestOpen(answer(0, null)), false);

  // Отправка запроса: тариф — со ссылкой на оплату, недавний отказ — строкой в блоке, остальное — уведомлением.
  assert.equal(creationRefusal(answer(402, { error: "Нужен платный тариф", payUrl: "/settings/subscription" })), "plan");
  assert.equal(creationRefusal(answer(402, { error: "Нужен платный тариф" })), "plan");
  assert.equal(creationRefusal(answer(409, { error: "Организация закрыта", code: "org_locked", payUrl: "/settings/subscription" })), "plan");
  assert.equal(creationRefusal(answer(409, { error: "Запрос отклонён, повторите через 7 дней", code: "request_declined_recently" })), "inline");
  assert.equal(creationRefusal(answer(409, { error: "Запрос уже отправлен", code: "request_open" })), "toast");
  assert.equal(creationRefusal(answer(409, { error: "Это ваш кабинет" })), "toast");
  assert.equal(creationRefusal(answer(404, { error: "Мастер-кабинет с таким кодом не найден" })), "toast");
  assert.equal(creationRefusal(answer(429, { error: "Не больше 5 запросов в сутки", code: "request_declined_recently" })), "toast");
  assert.equal(creationRefusal(answer(0, null)), "toast");
});
