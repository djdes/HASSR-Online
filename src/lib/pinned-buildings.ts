/**
 * Скрепка у объекта (владелец, 2026-11-23: «в списке объектов возможность
 * поставить кому-то скрепку, чтобы он закрепился сверху первым»). Закрепление
 * личное — у каждого свой список (`User.pinnedBuildingIds`); закреплённые идут
 * первыми в порядке закрепления — в шапке и на странице «Объекты». Модуль без
 * Prisma и React: его читают макет, страница объектов, API и тесты.
 */

/** Больше закреплённых не держим: старые уходят первыми. */
export const PINNED_BUILDINGS_MAX = 50;

/** Закреплённые — первыми (в порядке закрепления), остальные — в прежнем порядке. */
export function sortPinnedFirst<T extends { id: string }>(items: readonly T[], pinned: readonly string[]): T[] {
  if (pinned.length === 0) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  const head = pinned.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
  const headIds = new Set(head.map((item) => item.id));
  return [...head, ...items.filter((item) => !headIds.has(item.id))];
}

/** Список после нажатия на скрепку: закрепить — в конец, открепить — убрать. */
export function nextPinned(current: readonly string[], buildingId: string, pinned: boolean): string[] {
  const rest = current.filter((id) => id !== buildingId);
  if (!pinned) return rest;
  if (current.includes(buildingId)) return [...current];
  return [...rest, buildingId].slice(-PINNED_BUILDINGS_MAX);
}

/** Тело `POST /api/me/pinned-buildings`: `{ buildingId, pinned }`; иначе null. */
export function parsePinRequest(body: unknown): { buildingId: string; pinned: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const { buildingId, pinned } = body as { buildingId?: unknown; pinned?: unknown };
  if (typeof buildingId !== "string" || buildingId.length === 0 || buildingId.length > 64) return null;
  if (typeof pinned !== "boolean") return null;
  return { buildingId, pinned };
}
