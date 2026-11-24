import { db } from "@/lib/db";
import { outgoingEmailRows, type OutgoingEmailInput } from "@/lib/outgoing-email";

/** Сколько дней хранится журнал исходящих писем (чистит purge-audit-log). */
export const OUTGOING_EMAIL_RETENTION_DAYS = 365;

/** Организация по почте получателя: сотрудник клиента (не платформы). */
async function organizationsFor(addresses: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const address of addresses) {
    const user = await db.user.findFirst({
      where: {
        isRoot: false,
        OR: [{ email: { equals: address, mode: "insensitive" } }, { contactEmail: { equals: address, mode: "insensitive" } }],
      },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      select: { organizationId: true },
    });
    if (user?.organizationId) found.set(address, user.organizationId);
  }
  return found;
}

/**
 * Записать отправленное (или не ушедшее) письмо в журнал `OutgoingEmail`.
 * Никогда не бросает: журнал не должен ломать отправку.
 */
export async function recordOutgoingEmail(input: OutgoingEmailInput): Promise<void> {
  try {
    const rows = outgoingEmailRows(input);
    if (!rows.length) return;
    const organizations = await organizationsFor(rows.map((row) => row.to)).catch(() => new Map<string, string>());
    await db.outgoingEmail.createMany({
      data: rows.map(({ attachmentsJson, ...row }) => ({
        ...row,
        organizationId: organizations.get(row.to) ?? null,
        ...(attachmentsJson ? { attachmentsJson } : {}),
      })),
    });
  } catch (error) {
    console.error("[outgoing-email] не удалось записать письмо в журнал", error instanceof Error ? error.message : error);
  }
}
