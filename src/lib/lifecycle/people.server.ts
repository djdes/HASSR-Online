import { db } from "@/lib/db";
import { isTechnicalEmail } from "@/lib/technical-email";

import type { ManagerSignature } from "./emails";
import { discountLimitFor, type StaffPerson } from "./staff";

/**
 * Команда платформы из БД (2026-11-10): ответственные, лимиты скидок, подпись
 * письма клиенту. Только люди платформы — владелец и сотрудники организации
 * платформы с разделами панели: случайно выданный раздел клиентскому
 * пользователю не делает его получателем задач CRM.
 */

const PLATFORM_ORG_ID = () => process.env.PLATFORM_ORG_ID || "platform";

/** Условие «человек команды платформы» для запросов Prisma. */
export function platformStaffWhere() {
  return {
    isActive: true,
    archivedAt: null,
    OR: [{ isRoot: true }, { organizationId: PLATFORM_ORG_ID(), platformSections: { isEmpty: false } }],
  };
}

export async function loadPlatformStaff(): Promise<StaffPerson[]> {
  const rows = await db.user.findMany({
    where: platformStaffWhere(),
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
    email: [row.contactEmail, row.email].find((value) => value && value.includes("@") && !isTechnicalEmail(value)) ?? null,
    telegramChatId: row.telegramChatId,
    isRoot: row.isRoot,
    salesHead: row.platformSalesHead,
    roleKey: row.platformRole?.key ?? null,
    limit: discountLimitFor({ isRoot: row.isRoot, roleKey: row.platformRole?.key ?? null, roleLimit: row.platformRole?.discountLimit }),
    createdAt: row.createdAt,
  }));
}

/**
 * Подпись письма клиенту и адрес для ответа: имя, должность, телефон и почта
 * менеджера (как в КП — «Моя почта» → роль → профиль). Нет менеджера — null.
 */
export async function managerSignature(userId: string | null): Promise<(ManagerSignature & { replyTo: string | null }) | null> {
  if (!userId) return null;
  try {
    const { staffSender } = await import("@/lib/client-documents.server");
    const sender = await staffSender(userId);
    return { name: sender.name, position: sender.position, phone: sender.phone, email: sender.email, replyTo: sender.email };
  } catch (error) {
    console.error("[lifecycle] signature failed", { userId, error });
    return null;
  }
}
