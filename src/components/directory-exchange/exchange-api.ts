/**
 * Клиентская часть обмена справочниками между организациями аккаунта (спека
 * org-exchange-2026-11-19): формы ответов `/api/settings/directory-exchange`
 * и их разбор. Разбор терпит неполный ответ — окно и карточка показывают
 * то, что пришло, и не падают на пропущенном поле.
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

/** Запрос к API обмена; сеть упала или ответ не JSON — `ok: false`, без исключения. */
export async function exchangeRequest(
  path = "",
  init?: { method: "PUT" | "POST"; body?: unknown },
): Promise<ExchangeResponse> {
  const response = await fetch(`${EXCHANGE_ENDPOINT}${path}`, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  const json = response ? asObject(await response.json().catch(() => null)) : null;
  return { ok: Boolean(response?.ok), status: response?.status ?? 0, json };
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
