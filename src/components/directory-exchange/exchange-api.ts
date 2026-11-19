/**
 * Клиентская часть обмена справочниками между организациями аккаунта (спека
 * org-exchange-2026-11-19): формы ответов `/api/settings/directory-exchange`
 * и их разбор. Разбор терпит неполный ответ — окно и карточка показывают
 * то, что пришло, и не падают на пропущенном поле.
 *
 * Здесь же — запросы на обмен с чужим аккаунтом по коду мастер-кабинета
 * (спека org-exchange-foreign-2026-11-19): `…/requests` для заявителя и
 * владельца кабинета, `/api/exchange-requests/<токен>` для страницы решения.
 *
 * Чистый модуль: без React, с тестами (`exchange-api.test.ts`).
 */

export const EXCHANGE_ENDPOINT = "/api/settings/directory-exchange";

/** Четыре списка — в порядке показа в окне и в карточке. */
export const EXCHANGE_KINDS = ["products", "staff", "objects", "equipment"] as const;

export type ExchangeKind = (typeof EXCHANGE_KINDS)[number];

/** Связь через мастер-кабинет или разовый перенос. */
export type ExchangeMode = "link" | "transfer";

export type ExchangeCounts = Record<ExchangeKind, number>;

export type ExchangeKindResult = {
  created: number;
  updated: number;
  skippedLimit: number;
  skippedConflict: number;
};

export type ExchangeSummary = {
  organizations: Array<{
    organizationId: string;
    name: string;
    kinds: Partial<Record<ExchangeKind, ExchangeKindResult>>;
  }>;
  notes: string[];
};

export type ExchangeMember = {
  organizationId: string;
  name: string;
  kinds: ExchangeKind[];
  lastSyncedAt: string | null;
};

export type ExchangeSibling = {
  id: string;
  name: string;
  counts: ExchangeCounts;
  /** Закрыта после своих бесплатных дней: в обмене и переносе не участвует. */
  locked: boolean;
};

/** Ответ `GET /api/settings/directory-exchange`. */
export type ExchangeState = {
  canManage: boolean;
  organization: { id: string; name: string };
  counts: ExchangeCounts;
  siblings: ExchangeSibling[];
  cabinet: { id: string; name: string } | null;
  members: ExchangeMember[];
  lastSync: ExchangeSummary | null;
};

export type TransferItem = {
  id: string;
  name: string;
  detail: string | null;
  /** У получателя такая запись уже есть — перенос её пропустит. */
  exists: boolean;
  /**
   * Родитель в том же списке: должность сотрудника, объект помещения, цех
   * оборудования. Сервер ставит родителя перед его записями.
   */
  parentId: string | null;
};

/** `items` из `GET …/transfer?from=…`. */
export type TransferItems = Record<ExchangeKind, TransferItem[]>;

/** `selection` для `POST …/transfer`. */
export type TransferSelection = Partial<Record<ExchangeKind, string[] | "all">>;

export type ExchangeMemberInput = { organizationId: string; kinds: ExchangeKind[] };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function parseKinds(value: unknown): ExchangeKind[] {
  const list = asList(value);
  return EXCHANGE_KINDS.filter((kind) => list.includes(kind));
}

function parseCounts(value: unknown): ExchangeCounts {
  const source = asObject(value);
  return {
    products: asCount(source?.products),
    staff: asCount(source?.staff),
    objects: asCount(source?.objects),
    equipment: asCount(source?.equipment),
  };
}

export function parseSummary(value: unknown): ExchangeSummary | null {
  const source = asObject(value);
  if (!source) return null;
  const organizations: ExchangeSummary["organizations"] = [];
  for (const entry of asList(source.organizations)) {
    const row = asObject(entry);
    if (!row) continue;
    const byKind = asObject(row.kinds);
    const kinds: Partial<Record<ExchangeKind, ExchangeKindResult>> = {};
    for (const kind of EXCHANGE_KINDS) {
      const result = asObject(byKind?.[kind]);
      if (!result) continue;
      kinds[kind] = {
        created: asCount(result.created),
        updated: asCount(result.updated),
        skippedLimit: asCount(result.skippedLimit),
        skippedConflict: asCount(result.skippedConflict),
      };
    }
    organizations.push({ organizationId: asText(row.organizationId), name: asText(row.name), kinds });
  }
  const notes = asList(source.notes).filter((note): note is string => typeof note === "string" && note.trim() !== "");
  return { organizations, notes };
}

export function parseState(value: unknown): ExchangeState | null {
  const source = asObject(value);
  const organization = asObject(source?.organization);
  if (!source || !organization) return null;
  const cabinet = asObject(source.cabinet);
  const siblings: ExchangeSibling[] = [];
  for (const entry of asList(source.siblings)) {
    const row = asObject(entry);
    const id = asText(row?.id);
    if (row && id) {
      siblings.push({ id, name: asText(row.name), counts: parseCounts(row.counts), locked: row.locked === true });
    }
  }
  const members: ExchangeMember[] = [];
  for (const entry of asList(source.members)) {
    const row = asObject(entry);
    const organizationId = asText(row?.organizationId);
    if (!row || !organizationId) continue;
    members.push({
      organizationId,
      name: asText(row.name),
      kinds: parseKinds(row.kinds),
      lastSyncedAt: typeof row.lastSyncedAt === "string" ? row.lastSyncedAt : null,
    });
  }
  return {
    canManage: source.canManage === true,
    organization: { id: asText(organization.id), name: asText(organization.name) },
    counts: parseCounts(source.counts),
    siblings,
    cabinet: cabinet ? { id: asText(cabinet.id), name: asText(cabinet.name) } : null,
    members,
    lastSync: parseSummary(source.lastSync),
  };
}

export function parseTransferItems(value: unknown): TransferItems {
  const source = asObject(asObject(value)?.items);
  const list = (kind: ExchangeKind): TransferItem[] => {
    const items: TransferItem[] = [];
    for (const entry of asList(source?.[kind])) {
      const row = asObject(entry);
      const id = asText(row?.id);
      if (!row || !id) continue;
      items.push({
        id,
        name: asText(row.name),
        detail: typeof row.detail === "string" && row.detail.trim() !== "" ? row.detail : null,
        exists: row.exists === true,
        parentId: typeof row.parentId === "string" && row.parentId !== "" ? row.parentId : null,
      });
    }
    return items;
  };
  return { products: list("products"), staff: list("staff"), objects: list("objects"), equipment: list("equipment") };
}

/** Организации, которые сейчас в обмене (хотя бы один список). */
export function exchangeParticipants(state: Pick<ExchangeState, "members">): ExchangeMember[] {
  return state.members.filter((member) => member.kinds.length > 0);
}

/**
 * Участники для сохранения связи (`PUT`): текущая организация с отмеченными
 * списками и каждая отмеченная соседняя с ними же.
 *
 * - У соседней, которая уже в обмене, её прежние списки не убираем: иначе
 *   настройка из одной организации молча оборвала бы обмен между двумя
 *   другими.
 * - Список, у которого после сохранения остался бы один участник, с такой
 *   соседней снимаем — меняться ему не с кем (сняли «Сотрудников» у себя,
 *   и они не висят у единственной связанной организации).
 * - Ни одного списка — текущая организация выходит из обмена (пустые
 *   `kinds`), остальных не трогаем.
 */
export function linkMembers(
  state: Pick<ExchangeState, "organization" | "members">,
  selectedSiblingIds: readonly string[],
  kinds: readonly ExchangeKind[],
): ExchangeMemberInput[] {
  const selfId = state.organization.id;
  const chosen = EXCHANGE_KINDS.filter((kind) => kinds.includes(kind));
  if (chosen.length === 0) return [{ organizationId: selfId, kinds: [] }];

  const before = new Map<string, ExchangeKind[]>();
  for (const member of state.members) before.set(member.organizationId, member.kinds);
  const after = new Map(before);
  after.set(selfId, chosen);
  const siblingIds = [...new Set(selectedSiblingIds)].filter((id) => id !== selfId);
  for (const id of siblingIds) {
    const kept = before.get(id) ?? [];
    after.set(id, EXCHANGE_KINDS.filter((kind) => chosen.includes(kind) || kept.includes(kind)));
  }
  const participants = (kind: ExchangeKind) => [...after.values()].filter((list) => list.includes(kind)).length;
  return [selfId, ...siblingIds].map((organizationId) => ({
    organizationId,
    kinds: (after.get(organizationId) ?? []).filter((kind) => chosen.includes(kind) || participants(kind) > 1),
  }));
}

/** Позиции списка, которые можно перенести: тех, что уже есть у получателя, среди них нет. */
export function transferableIds(items: readonly TransferItem[]): string[] {
  return items.filter((item) => !item.exists).map((item) => item.id);
}

/**
 * Отметить или снять позицию разового переноса. Родителя (должность, объект,
 * цех) сервер подтянет к отмеченной записи сам, поэтому выбор держим честным:
 * отметили запись — отмечен и её родитель; сняли родителя — сняты его записи;
 * отметили родителя — отмечены и его записи (лишние снимаются по одной).
 * Родитель, который у получателя уже есть, не отмечается: записи лягут в него.
 */
export function togglePicked(items: readonly TransferItem[], picked: readonly string[], id: string): string[] {
  const item = items.find((entry) => entry.id === id);
  if (!item || item.exists) return [...picked];
  const marked = new Set(picked);
  const children = items.filter((entry) => entry.parentId === id && !entry.exists);
  if (marked.has(id)) {
    marked.delete(id);
    for (const child of children) marked.delete(child.id);
  } else {
    marked.add(id);
    for (const child of children) marked.add(child.id);
    const parent = item.parentId ? items.find((entry) => entry.id === item.parentId) : undefined;
    if (parent && !parent.exists) marked.add(parent.id);
  }
  // Порядок — как в списке.
  return transferableIds(items).filter((entry) => marked.has(entry));
}

/**
 * Что отправить в разовый перенос. Отмечено всё доступное в списке — `"all"`
 * (длинный справочник не едет в запросе по одной записи, дубли сервер
 * пропускает сам); отмечена часть — их id; пустой список не отправляем.
 */
export function transferSelection(
  items: TransferItems,
  kinds: readonly ExchangeKind[],
  picked: Record<ExchangeKind, readonly string[]>,
): TransferSelection {
  const selection: TransferSelection = {};
  for (const kind of EXCHANGE_KINDS) {
    if (!kinds.includes(kind)) continue;
    const available = transferableIds(items[kind]);
    const marked = new Set(picked[kind]);
    const ids = available.filter((id) => marked.has(id));
    if (ids.length === 0) continue;
    selection[kind] = ids.length === available.length ? "all" : ids;
  }
  return selection;
}

const NO_RESULT: ExchangeKindResult = { created: 0, updated: 0, skippedLimit: 0, skippedConflict: 0 };

/** Итог по всем спискам; с `organizationId` — только по этой организации. */
export function summaryTotals(summary: ExchangeSummary | null, organizationId?: string): ExchangeKindResult {
  const total = { ...NO_RESULT };
  for (const organization of summary?.organizations ?? []) {
    if (organizationId !== undefined && organization.organizationId !== organizationId) continue;
    for (const kind of EXCHANGE_KINDS) {
      const result = organization.kinds[kind];
      if (!result) continue;
      total.created += result.created;
      total.updated += result.updated;
      total.skippedLimit += result.skippedLimit;
      total.skippedConflict += result.skippedConflict;
    }
  }
  return total;
}

export function isEmptyResult(result: ExchangeKindResult): boolean {
  return result.created + result.updated + result.skippedLimit + result.skippedConflict === 0;
}

export type ExchangeResponse = { ok: boolean; status: number; json: Json | null };

type ExchangeRequestInit = { method: "PUT" | "POST" | "DELETE"; body?: unknown };

/** Сеть упала или ответ не JSON — `ok: false`, без исключения. */
async function requestJson(url: string, init?: ExchangeRequestInit): Promise<ExchangeResponse> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  const json = response ? asObject(await response.json().catch(() => null)) : null;
  return { ok: Boolean(response?.ok), status: response?.status ?? 0, json };
}

/** Запрос к API обмена; сеть упала или ответ не JSON — `ok: false`, без исключения. */
export async function exchangeRequest(path = "", init?: ExchangeRequestInit): Promise<ExchangeResponse> {
  return requestJson(`${EXCHANGE_ENDPOINT}${path}`, init);
}

/** Текст ошибки из ответа сервера; его нет — переведённый запасной. */
export function exchangeError(json: Json | null, fallback: string): string {
  const message = json?.error;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
}

/** Состояние обмена для активной организации; `null` — не удалось получить. */
export async function loadExchangeState(): Promise<ExchangeState | null> {
  const { ok, json } = await exchangeRequest();
  return ok ? parseState(json) : null;
}

/* ───────── Обмен с чужим аккаунтом (спека org-exchange-foreign-2026-11-19) ───────── */

/** `GET`/`POST …/requests`, `DELETE …/requests/<id>`. */
export const EXCHANGE_REQUESTS_PATH = "/requests";
/** Страница решения владельца кабинета: `GET`/`POST /api/exchange-requests/<токен>`. */
export const EXCHANGE_DECISION_ENDPOINT = "/api/exchange-requests";

export const FOREIGN_STATUSES = ["pending", "approved", "declined", "cancelled", "expired"] as const;

export type ForeignStatus = (typeof FOREIGN_STATUSES)[number];

/** Запрос заявителя в мастер-кабинет другого аккаунта. О той стороне известно только название кабинета. */
export type ForeignRequest = {
  id: string;
  cabinetName: string;
  mode: ExchangeMode;
  kinds: ExchangeKind[];
  status: ForeignStatus;
  expiresAt: string | null;
  createdAt: string | null;
};

/** Подтверждённая связь организации с мастер-кабинетом другого аккаунта. */
export type ForeignLink = { id: string; cabinetName: string; kinds: ExchangeKind[]; since: string | null };

/** Запрос, пришедший владельцу кабинета. Решение — только по ссылке из письма. */
export type IncomingRequest = {
  id: string;
  requesterName: string;
  mode: ExchangeMode;
  kinds: ExchangeKind[];
  expiresAt: string | null;
  createdAt: string | null;
};

/** Участник обмена кабинета из другого аккаунта. */
export type ForeignMember = {
  /** Что передать в `DELETE …/requests/<id>`: `id` из ответа, а без него — `organizationId`. */
  id: string;
  organizationId: string;
  name: string;
  kinds: ExchangeKind[];
  since: string | null;
};

/**
 * Ответ `GET …/requests`: `outgoing` и `foreignLinks` — активной организации,
 * `incoming` и `foreignMembers` — кабинету аккаунта, если человек его владелец.
 */
export type ForeignState = {
  outgoing: ForeignRequest[];
  foreignLinks: ForeignLink[];
  incoming: IncomingRequest[];
  foreignMembers: ForeignMember[];
};

export type DecisionRequest = {
  id: string;
  requesterName: string;
  requesterInn: string | null;
  mode: ExchangeMode;
  kinds: ExchangeKind[];
  status: ForeignStatus;
  expiresAt: string | null;
};

/** Ответ `GET /api/exchange-requests/<токен>`. */
export type DecisionState = {
  request: DecisionRequest;
  cabinet: { id: string; name: string };
  /** Свои организации владельца кабинета — откуда взять данные для разового переноса. */
  sources: Array<{ id: string; name: string }>;
};

/** Тело `POST /api/exchange-requests/<токен>`. */
export type DecisionBody =
  | { decision: "decline" }
  | { decision: "approve"; allowedKinds: ExchangeKind[]; sourceOrganizationId?: string };

export type DecisionResult = { status: "approved" | "declined"; summary: ExchangeSummary | null };

/**
 * Что показать странице решения по ответу сервера: форму, отказ по правам,
 * «ссылка недействительна» или то, чем запрос уже закончился (`status: null` —
 * сервер не сказал, чем именно).
 */
export type DecisionView =
  | { kind: "form"; data: DecisionState }
  | { kind: "closed"; status: Exclude<ForeignStatus, "pending"> | null }
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "signedOut" }
  | { kind: "failed" };

function parseMode(value: unknown): ExchangeMode | null {
  return value === "link" || value === "transfer" ? value : null;
}

function parseStatus(value: unknown): ForeignStatus | null {
  return FOREIGN_STATUSES.find((status) => status === value) ?? null;
}

function asMoment(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Запрос без id, способа или статуса не показываем: по нему нечего ни сказать, ни отменить. */
export function parseForeignRequest(value: unknown): ForeignRequest | null {
  const row = asObject(value);
  const id = asText(row?.id);
  const mode = parseMode(row?.mode);
  const status = parseStatus(row?.status);
  if (!row || !id || !mode || !status) return null;
  return {
    id,
    cabinetName: asText(row.cabinetName),
    mode,
    kinds: parseKinds(row.kinds),
    status,
    expiresAt: asMoment(row.expiresAt),
    createdAt: asMoment(row.createdAt),
  };
}

export function parseForeignState(value: unknown): ForeignState {
  const source = asObject(value);
  const outgoing: ForeignRequest[] = [];
  for (const entry of asList(source?.outgoing)) {
    const request = parseForeignRequest(entry);
    if (request) outgoing.push(request);
  }
  const foreignLinks: ForeignLink[] = [];
  for (const entry of asList(source?.foreignLinks)) {
    const row = asObject(entry);
    const id = asText(row?.id);
    if (!row || !id) continue;
    foreignLinks.push({
      id,
      cabinetName: asText(row.cabinetName),
      kinds: parseKinds(row.kinds),
      since: asMoment(row.since),
    });
  }
  const incoming: IncomingRequest[] = [];
  for (const entry of asList(source?.incoming)) {
    const row = asObject(entry);
    const id = asText(row?.id);
    const mode = parseMode(row?.mode);
    if (!row || !id || !mode) continue;
    incoming.push({
      id,
      requesterName: asText(row.requesterName),
      mode,
      kinds: parseKinds(row.kinds),
      expiresAt: asMoment(row.expiresAt),
      createdAt: asMoment(row.createdAt),
    });
  }
  const foreignMembers: ForeignMember[] = [];
  for (const entry of asList(source?.foreignMembers)) {
    const row = asObject(entry);
    const organizationId = asText(row?.organizationId);
    const id = asText(row?.id) || organizationId;
    if (!row || !id) continue;
    foreignMembers.push({
      id,
      organizationId: organizationId || id,
      name: asText(row.name),
      kinds: parseKinds(row.kinds),
      since: asMoment(row.since),
    });
  }
  return { outgoing, foreignLinks, incoming, foreignMembers };
}

/** Запрос по токену из письма; без самого запроса, способа или статуса показывать нечего. */
export function parseDecisionState(value: unknown): DecisionState | null {
  const source = asObject(value);
  const request = asObject(source?.request);
  const mode = parseMode(request?.mode);
  const status = parseStatus(request?.status);
  if (!source || !request || !mode || !status) return null;
  const cabinet = asObject(source.cabinet);
  const sources: DecisionState["sources"] = [];
  for (const entry of asList(source.sources)) {
    const row = asObject(entry);
    const id = asText(row?.id);
    if (row && id) sources.push({ id, name: asText(row.name) });
  }
  return {
    request: {
      id: asText(request.id),
      requesterName: asText(request.requesterName),
      requesterInn: asText(request.requesterInn).trim() || null,
      mode,
      kinds: parseKinds(request.kinds),
      status,
      expiresAt: asMoment(request.expiresAt),
    },
    cabinet: { id: asText(cabinet?.id), name: asText(cabinet?.name) },
    sources,
  };
}

/** Ответ на решение; статус не пришёл — он следует из самого решения. Итог обмена — только у подтверждения. */
export function parseDecisionResult(value: unknown, decision: DecisionBody["decision"]): DecisionResult {
  const source = asObject(value);
  const raw = source?.status;
  const status: DecisionResult["status"] =
    raw === "approved" || raw === "declined" ? raw : decision === "approve" ? "approved" : "declined";
  return { status, summary: status === "approved" ? parseSummary(source?.summary) : null };
}

/**
 * Чем закончился запрос, если отказ 409 это называет: статусом, вложенным
 * запросом или кодом причины (`request_expired`, `request_cancelled`).
 * «Решение уже принято» (`request_decided`) исход не называет — `null`.
 */
function closedStatus(json: Json | null): Exclude<ForeignStatus, "pending"> | null {
  const reason = (value: unknown) => parseStatus(asText(value).replace(/^request_/, ""));
  const status =
    parseStatus(json?.status) ??
    parseStatus(asObject(json?.request)?.status) ??
    reason(json?.code) ??
    reason(json?.reason);
  return status && status !== "pending" ? status : null;
}

/**
 * Разбор ответа `GET /api/exchange-requests/<токен>` (и отказов `POST`): 401 —
 * сессия кончилась, 403 — решает не владелец аккаунта кабинета, 404 — токен
 * неизвестен, 409 или не ждущий статус — запрос уже закрыт. Запрос, срок
 * которого вышел, закрыт, даже если сервер ещё числит его ожидающим.
 */
export function decisionView(response: ExchangeResponse, now: number): DecisionView {
  if (response.status === 401) return { kind: "signedOut" };
  if (response.status === 403) return { kind: "forbidden" };
  if (response.status === 404) return { kind: "missing" };
  if (response.status === 409) return { kind: "closed", status: closedStatus(response.json) };
  if (!response.ok) return { kind: "failed" };
  const data = parseDecisionState(response.json);
  if (!data) return { kind: "failed" };
  if (data.request.status !== "pending") return { kind: "closed", status: data.request.status };
  if (isExpired(data.request.expiresAt, now)) return { kind: "closed", status: "expired" };
  return { kind: "form", data };
}

/** Запросы, которые ещё ждут решения владельца кабинета. */
export function pendingRequests(state: Pick<ForeignState, "outgoing">): ForeignRequest[] {
  return state.outgoing.filter((request) => request.status === "pending");
}

/** Состояние с только что отправленным запросом — он встаёт первым, повтор по id заменяется. */
export function withOutgoing(state: ForeignState, request: ForeignRequest): ForeignState {
  return { ...state, outgoing: [request, ...state.outgoing.filter((entry) => entry.id !== request.id)] };
}

/** Состояние без записи, которую только что отменили, покинули или отключили (`DELETE …/requests/<id>`). */
export function withoutForeign(state: ForeignState, id: string): ForeignState {
  return {
    outgoing: state.outgoing.filter((entry) => entry.id !== id),
    foreignLinks: state.foreignLinks.filter((entry) => entry.id !== id),
    incoming: state.incoming.filter((entry) => entry.id !== id),
    foreignMembers: state.foreignMembers.filter((entry) => entry.id !== id),
  };
}

/**
 * Участники обмена из своего аккаунта. Тех, кто пришёл из другого аккаунта,
 * карточка показывает отдельно — с пометкой и кнопкой «Отключить», поэтому
 * из общего списка их убираем: одна организация не должна стоять дважды.
 */
export function ownParticipants(
  state: Pick<ExchangeState, "members">,
  foreign: Pick<ForeignState, "foreignMembers"> | null,
): ExchangeMember[] {
  const foreignIds = new Set((foreign?.foreignMembers ?? []).map((member) => member.organizationId));
  return exchangeParticipants(state).filter((member) => !foreignIds.has(member.organizationId));
}

/** Момент из ответа сервера; пусто или не дата — `null`. */
export function parseMoment(value: string | null): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Срок запроса вышел. Срок неизвестен — считаем запрос действующим: решает сервер. */
export function isExpired(expiresAt: string | null, now: number): boolean {
  const at = parseMoment(expiresAt);
  return at !== null && at.getTime() <= now;
}

/** Что владелец кабинета разрешает: отмеченное им из запрошенного, по порядку списков. Шире запрошенного не бывает. */
export function narrowKinds(requested: readonly ExchangeKind[], chosen: readonly ExchangeKind[]): ExchangeKind[] {
  return EXCHANGE_KINDS.filter((kind) => requested.includes(kind) && chosen.includes(kind));
}

/**
 * Тело подтверждения. `null` — подтверждать нечего: не отмечен ни один список
 * либо для разового переноса не выбрана своя организация-источник.
 */
export function approvalBody(
  state: { request: Pick<DecisionRequest, "mode" | "kinds">; sources: DecisionState["sources"] },
  chosen: readonly ExchangeKind[],
  sourceId: string,
): Extract<DecisionBody, { decision: "approve" }> | null {
  const allowedKinds = narrowKinds(state.request.kinds, chosen);
  if (allowedKinds.length === 0) return null;
  if (state.request.mode === "link") return { decision: "approve", allowedKinds };
  if (!state.sources.some((source) => source.id === sourceId)) return null;
  return { decision: "approve", allowedKinds, sourceOrganizationId: sourceId };
}

/** Запросы и связи с чужими аккаунтами; `null` — не удалось получить. */
export async function loadForeignState(): Promise<ForeignState | null> {
  const { ok, json } = await exchangeRequest(EXCHANGE_REQUESTS_PATH);
  return ok ? parseForeignState(json) : null;
}

/** Отменить свой запрос, выйти из связи или отключить участника из другого аккаунта. */
export async function removeForeign(id: string): Promise<ExchangeResponse> {
  return exchangeRequest(`${EXCHANGE_REQUESTS_PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Страница решения: прочитать запрос по токену из письма (`body` нет) или отправить решение. */
export async function decisionRequest(token: string, body?: DecisionBody): Promise<ExchangeResponse> {
  return requestJson(
    `${EXCHANGE_DECISION_ENDPOINT}/${encodeURIComponent(token)}`,
    body ? { method: "POST", body } : undefined,
  );
}
