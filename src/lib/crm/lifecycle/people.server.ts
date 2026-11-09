import { db } from "@/lib/db";

/**
 * Люди панели для автоворонки: кто ответственный по умолчанию, у кого какой
 * лимит скидки, кто согласует скидку сверх лимита.
 */

export type StaffPerson = {
  id: string;
  name: string;
  email: string;
  contactEmail: string | null;
  telegramChatId: string | null;
  isRoot: boolean;
  salesHead: boolean;
  roleKey: string | null;
  /** Скидка без согласования, %. */
  limit: number;
  createdAt: Date;
};

/** Владелец платформы — без ограничения. */
export const ROOT_DISCOUNT_LIMIT = 100;

export async function loadPlatformStaff(): Promise<StaffPerson[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      contactEmail: true,
      telegramChatId: true,
      isRoot: true,
      platformSalesHead: true,
      createdAt: true,
      platformRole: { select: { key: true, discountLimit: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    contactEmail: row.contactEmail,
    telegramChatId: row.telegramChatId,
    isRoot: row.isRoot,
    salesHead: row.platformSalesHead,
    roleKey: row.platformRole?.key ?? null,
    limit: row.isRoot ? ROOT_DISCOUNT_LIMIT : Math.max(0, Math.min(100, row.platformRole?.discountLimit ?? 0)),
    createdAt: row.createdAt,
  }));
}

export function limitOf(staff: readonly StaffPerson[], userId: string | null | undefined): number {
  if (!userId) return 0;
  return staff.find((person) => person.id === userId)?.limit ?? 0;
}

/**
 * Ответственный: закреплённый менеджер клиента → ответственный контакта →
 * ответственный по умолчанию (настройка) → первый РОП → никто (видят все РОП).
 */
export function pickAssignee(
  staff: readonly StaffPerson[],
  candidates: { dealOwnerId?: string | null; accountManagerId?: string | null; contactOwnerId?: string | null; defaultAssigneeId?: string | null },
): string | null {
  const active = new Set(staff.map((person) => person.id));
  for (const id of [candidates.dealOwnerId, candidates.accountManagerId, candidates.contactOwnerId, candidates.defaultAssigneeId]) {
    if (id && active.has(id)) return id;
  }
  return staff.find((person) => person.salesHead && !person.isRoot)?.id ?? staff.find((person) => person.salesHead)?.id ?? null;
}

/**
 * Кто согласует скидку `percent`: не сам просящий, лимит покрывает;
 * коммерческий директор — первым, затем самый большой лимит, владелец — последним.
 */
export function approverFor(staff: readonly StaffPerson[], percent: number, requesterId: string | null): StaffPerson | null {
  const able = staff.filter((person) => person.id !== requesterId && person.limit >= percent);
  const rank = (person: StaffPerson) => (person.roleKey === "commercial_director" ? 0 : person.isRoot ? 2 : 1);
  return [...able].sort((a, b) => rank(a) - rank(b) || b.limit - a.limit || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}
