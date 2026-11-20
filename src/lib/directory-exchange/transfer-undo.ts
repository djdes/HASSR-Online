import { EXCHANGE_ENTITIES, isExchangeEntity, type ExchangeEntity } from "@/lib/directory-exchange/kinds";
import { normalizePlaceName } from "@/lib/orphan-areas";

/**
 * Отмена разового переноса справочников (серия B, пункт 12, правила Р12.1 и
 * Р12.2) — чистая часть: что перенос создал (`DirectoryTransfer.createdJson`),
 * можно ли его ещё отменить и что делать с каждой созданной записью по тому,
 * что о ней известно сейчас.
 *
 * Отменяется только то, что перенос создал и что с тех пор не используется и
 * не правилось: продукты выключаются, сотрудники уходят в архив, оборудование,
 * помещения, цеха, объекты и должности удаляются. Остальное остаётся, и итог
 * называет причину. Работа с базой — `transfer-undo.server.ts`.
 */

/** Сколько дней после переноса его можно отменить. */
export const TRANSFER_UNDO_DAYS = 7;
export const TRANSFER_UNDO_MS = TRANSFER_UNDO_DAYS * 86_400_000;

export const TRANSFER_UNDONE_MESSAGE = "Этот перенос уже отменён";
export const TRANSFER_EXPIRED_MESSAGE = `Перенос можно отменить только в течение ${TRANSFER_UNDO_DAYS} дней`;

/** Созданные переносом записи по сущностям, включая помещения и цеха-зеркала, которые завело их создание. */
export type TransferCreated = Record<ExchangeEntity, string[]>;

export function emptyTransferCreated(): TransferCreated {
  return { position: [], staff: [], building: [], room: [], area: [], equipment: [], product: [] };
}

/** `createdJson` из базы: только строки-id, без повторов; мусор — пусто. */
export function parseTransferCreated(raw: unknown): TransferCreated {
  const created = emptyTransferCreated();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return created;
  for (const [entity, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!isExchangeEntity(entity) || !Array.isArray(ids)) continue;
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== "string" || id.trim() === "" || seen.has(id)) continue;
      seen.add(id);
      created[entity].push(id);
    }
  }
  return created;
}

export function transferCreatedCount(created: TransferCreated): number {
  return EXCHANGE_ENTITIES.reduce((sum, entity) => sum + created[entity].length, 0);
}

/**
 * Отпечатки созданных записей на конец переноса — `createdJson.hashes`:
 * `{ сущность: { id: отпечаток } }`. Отпечаток — `hash` строки обмена
 * (`loadEntityRows`): переносимые поля и родитель. По нему отмена видит
 * правку там, где у записи нет `updatedAt` (оборудование, цех). Старые
 * записи без отпечатков читаются как пустые: правка видна по прежним признакам.
 */
export type TransferHashes = Record<ExchangeEntity, Record<string, string>>;

export function emptyTransferHashes(): TransferHashes {
  return { position: {}, staff: {}, building: {}, room: {}, area: {}, equipment: {}, product: {} };
}

/** Отпечатки из `createdJson`: только строки по известным сущностям; нет или мусор — пусто. */
export function parseTransferHashes(raw: unknown): TransferHashes {
  const hashes = emptyTransferHashes();
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { hashes?: unknown }).hashes : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return hashes;
  for (const [entity, byId] of Object.entries(source as Record<string, unknown>)) {
    if (!isExchangeEntity(entity) || !byId || typeof byId !== "object" || Array.isArray(byId)) continue;
    for (const [id, hash] of Object.entries(byId as Record<string, unknown>)) {
      if (id.trim() !== "" && typeof hash === "string" && hash !== "") hashes[entity][id] = hash;
    }
  }
  return hashes;
}

/** `createdJson` переноса: id по сущностям (как раньше) и их отпечатки. */
export function transferCreatedJson(created: TransferCreated, hashes: TransferHashes): TransferCreated & { hashes: TransferHashes } {
  return { ...created, hashes };
}

/**
 * Запись правили после переноса — по отпечатку: при переносе он снят, а
 * сейчас другой или его нет (запись выпала из обмена: сотруднику дали вход,
 * оборудование ушло в офис). Отпечатка с переноса нет (старая запись) — не
 * известно, решают прежние признаки.
 */
export function editedByHash(stored: TransferHashes, current: TransferHashes, entity: ExchangeEntity, id: string): boolean {
  if (!Object.hasOwn(stored[entity], id)) return false;
  return !Object.hasOwn(current[entity], id) || current[entity][id] !== stored[entity][id];
}

/** До какого момента перенос можно отменить. */
export function transferUndoDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRANSFER_UNDO_MS);
}

export type UndoAllowed =
  | { ok: true }
  | { ok: false; status: 409; reason: "undone" | "expired"; message: string };

/** Отменить можно один раз и только в течение 7 дней после переноса. */
export function canUndoTransfer(input: { createdAt: Date; undoneAt: Date | null; now: Date }): UndoAllowed {
  if (input.undoneAt) return { ok: false, status: 409, reason: "undone", message: TRANSFER_UNDONE_MESSAGE };
  if (input.now.getTime() > transferUndoDeadline(input.createdAt).getTime()) {
    return { ok: false, status: 409, reason: "expired", message: TRANSFER_EXPIRED_MESSAGE };
  }
  return { ok: true };
}

/** Запись правили после переноса: её `updatedAt` позже самого переноса. */
export function editedAfter(updatedAt: Date | null | undefined, transferAt: Date): boolean {
  return Boolean(updatedAt) && updatedAt!.getTime() > transferAt.getTime();
}

/* ───────────────────────── решение по записи ───────────────────────── */

/** Что делает отмена с записью своего вида: продукт выключается, сотрудник — в архив, остальное удаляется. */
export type UndoAction = "deactivated" | "archived" | "deleted";

export const UNDO_ACTION: Record<ExchangeEntity, UndoAction> = {
  product: "deactivated",
  staff: "archived",
  position: "deleted",
  building: "deleted",
  room: "deleted",
  area: "deleted",
  equipment: "deleted",
};

/**
 * Почему запись осталась:
 *   • `edited` — правилась после переноса (дали вход, назначили, переименовали);
 *   • `used` — используется: записи журналов, датчик, смены работы, назначения;
 *   • `not_empty` — внутри остались записи (помещения и цеха объекта, оборудование цеха);
 *   • `has_staff` — на должности есть действующие сотрудники;
 *   • `linked` — помещение и его цех-зеркало остаются вместе: второе из пары осталось.
 */
export type KeepReason = "edited" | "used" | "not_empty" | "has_staff" | "linked";

export const KEEP_REASONS: readonly KeepReason[] = ["edited", "used", "not_empty", "has_staff", "linked"];

/** Что известно о записи сейчас. */
export type UndoFacts = {
  /** Записи уже нет — удалили вручную. */
  missing?: boolean;
  /** Продукт уже выключен, сотрудник уже в архиве. */
  inactive?: boolean;
  /** Правилась после переноса. */
  edited?: boolean;
  /** Используется: журналы, датчики, смены, назначения, документы. */
  used?: boolean;
  /** Остались вложенные записи или (у должности) действующие сотрудники. */
  hasChildren?: boolean;
};

export type UndoDecision =
  | { kind: "undo"; action: UndoAction }
  | { kind: "keep"; reason: KeepReason }
  /** Делать нечего: записи нет или она уже выключена / в архиве. */
  | { kind: "skip" };

/**
 * Решение по одной записи. Порядок причин — от самой понятной человеку:
 * правили → используется → внутри что-то есть.
 */
export function decideUndo(entity: ExchangeEntity, facts: UndoFacts): UndoDecision {
  if (facts.missing || facts.inactive) return { kind: "skip" };
  if (facts.edited) return { kind: "keep", reason: "edited" };
  if (facts.used) return { kind: "keep", reason: "used" };
  if (facts.hasChildren) return { kind: "keep", reason: entity === "position" ? "has_staff" : "not_empty" };
  return { kind: "undo", action: UNDO_ACTION[entity] };
}

type Place = { id: string; name: string; buildingId: string | null };

/**
 * Пары «помещение ↔ цех-зеркало» среди созданного: одно название (без
 * регистра, ё/е и лишних пробелов) на одном объекте. Помещение заводит
 * цех-зеркало, цех — помещение-зеркало; каждое входит в одну пару.
 */
export function mirrorPairs(rooms: readonly Place[], areas: readonly Place[]): Array<{ roomId: string; areaId: string }> {
  const pairs: Array<{ roomId: string; areaId: string }> = [];
  const taken = new Set<string>();
  for (const room of rooms) {
    const key = normalizePlaceName(room.name);
    if (!key || !room.buildingId) continue;
    const area = areas.find(
      (candidate) => !taken.has(candidate.id) && candidate.buildingId === room.buildingId && normalizePlaceName(candidate.name) === key,
    );
    if (!area) continue;
    taken.add(area.id);
    pairs.push({ roomId: room.id, areaId: area.id });
  }
  return pairs;
}

/**
 * Помещение и его цех-зеркало остаются вместе: если одно из пары остаётся,
 * второе не удаляется (`linked`) — иначе помещение осталось бы без цеха или
 * цех без помещения. Возвращает новую карту решений.
 */
export function keepMirrorPartners(
  decisions: ReadonlyMap<string, UndoDecision>,
  pairs: ReadonlyArray<{ roomId: string; areaId: string }>,
): Map<string, UndoDecision> {
  const next = new Map(decisions);
  for (const { roomId, areaId } of pairs) {
    const room = next.get(roomId);
    const area = next.get(areaId);
    if (room?.kind === "keep" && area?.kind === "undo") next.set(areaId, { kind: "keep", reason: "linked" });
    else if (area?.kind === "keep" && room?.kind === "undo") next.set(roomId, { kind: "keep", reason: "linked" });
  }
  return next;
}

/* ───────────────────────── итог отмены ───────────────────────── */

export type UndoneItem = { entity: ExchangeEntity; id: string; name: string; action: UndoAction };
export type KeptItem = { entity: ExchangeEntity; id: string; name: string; reason: KeepReason };

/** `DirectoryTransfer.undoJson`: что отменено и что осталось и почему. */
export type TransferUndoResult = { undone: UndoneItem[]; kept: KeptItem[] };

const UNDO_ACTIONS: readonly UndoAction[] = ["deactivated", "archived", "deleted"];

/** Итог из базы; мусорные строки пропускаются, не объект — null. */
export function parseUndoResult(raw: unknown): TransferUndoResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as { undone?: unknown; kept?: unknown };
  const items = (value: unknown) =>
    (Array.isArray(value) ? value : []).filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && isExchangeEntity((entry as { entity?: unknown }).entity) &&
        typeof (entry as { id?: unknown }).id === "string",
    );
  const undone: UndoneItem[] = [];
  for (const entry of items(source.undone)) {
    const action = UNDO_ACTIONS.find((value) => value === entry.action);
    if (!action) continue;
    undone.push({ entity: entry.entity as ExchangeEntity, id: entry.id as string, name: typeof entry.name === "string" ? entry.name : "", action });
  }
  const kept: KeptItem[] = [];
  for (const entry of items(source.kept)) {
    const reason = KEEP_REASONS.find((value) => value === entry.reason);
    if (!reason) continue;
    kept.push({ entity: entry.entity as ExchangeEntity, id: entry.id as string, name: typeof entry.name === "string" ? entry.name : "", reason });
  }
  return { undone, kept };
}
