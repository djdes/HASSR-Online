/**
 * Команда платформы для CRM (2026-11-10): кто ответственный по клиенту, у кого
 * какой лимит скидки в спец-КП, кто согласует скидку сверх лимита. Чистый
 * модуль — данные загружает `people.server.ts`, правила проверяет `staff.test.ts`.
 */

export type StaffPerson = {
  id: string;
  name: string;
  email: string | null;
  telegramChatId: string | null;
  isRoot: boolean;
  salesHead: boolean;
  roleKey: string | null;
  /** Скидка без согласования, %. */
  limit: number;
  createdAt: Date;
};

/** Владелец платформы — без ограничения. */
export const ROOT_DISCOUNT_LIMIT = 90;

/**
 * Лимит встроенной роли, если владелец не задал свой: администратор — как
 * владелец, коммерческий директор — 25 %, РОП — 15 %, менеджер — 10 %,
 * остальные — без скидки.
 */
export const ROLE_DISCOUNT_DEFAULTS: Readonly<Record<string, number>> = {
  // Администратор платформы — «всё как у владельца».
  admin: 90,
  commercial_director: 25,
  sales_head: 15,
  sales_manager: 10,
};

export function discountLimitFor(person: { isRoot: boolean; roleKey: string | null; roleLimit: number | null | undefined }): number {
  if (person.isRoot) return ROOT_DISCOUNT_LIMIT;
  const explicit = person.roleLimit;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return Math.max(0, Math.min(ROOT_DISCOUNT_LIMIT, Math.round(explicit)));
  return person.roleKey ? (ROLE_DISCOUNT_DEFAULTS[person.roleKey] ?? 0) : 0;
}

export function limitOf(staff: readonly StaffPerson[], userId: string | null | undefined): number {
  if (!userId) return 0;
  return staff.find((person) => person.id === userId)?.limit ?? 0;
}

/**
 * Ответственный: закреплённый менеджер клиента → ответственный по умолчанию
 * (настройка) → первый РОП (не владелец) → никто (видят все РОП).
 * Уволенных и людей вне команды платформы пропускаем.
 */
export function pickAssignee(staff: readonly StaffPerson[], candidates: readonly (string | null | undefined)[]): string | null {
  const active = new Set(staff.map((person) => person.id));
  for (const id of candidates) if (id && active.has(id)) return id;
  return staff.find((person) => person.salesHead && !person.isRoot)?.id ?? staff.find((person) => person.salesHead)?.id ?? null;
}

/**
 * Кто согласует скидку `percent`: не сам просящий и с лимитом не меньше.
 * Назначенный в настройках — первым, затем коммерческий директор, затем
 * самый большой лимит; владелец платформы — последним.
 */
export function approverFor(staff: readonly StaffPerson[], percent: number, requesterId: string | null, preferredId?: string | null): StaffPerson | null {
  const able = staff.filter((person) => person.id !== requesterId && person.limit >= percent);
  const rank = (person: StaffPerson) => (person.id === preferredId ? -1 : person.roleKey === "commercial_director" ? 0 : person.isRoot ? 2 : 1);
  return [...able].sort((a, b) => rank(a) - rank(b) || b.limit - a.limit || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

/**
 * Может ли человек решить согласование: не просил сам, решает не больше
 * запрошенного и в пределах лимита своей роли (владелец — 90 %).
 */
export function checkApproval(args: {
  actorId: string;
  actorLimit: number;
  requestedById: string | null;
  requestedPercent: number;
  percent: number;
  approve: boolean;
}): string | null {
  if (args.requestedById && args.requestedById === args.actorId) return "Свою заявку на скидку согласует другой сотрудник";
  if (!args.approve) return null;
  if (args.percent > args.requestedPercent) return `Запрошено ${args.requestedPercent} % — согласовать можно столько же или меньше`;
  if (args.percent > args.actorLimit) return `Ваш лимит скидки — ${args.actorLimit} %, это меньше ${args.percent} %`;
  return null;
}
