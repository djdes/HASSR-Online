import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { DEFAULT_ORG_NAME } from "@/lib/org-profile";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { PAID_ORDER_STATUSES } from "@/lib/promo/service";
import { isEmptySnapshot, readSignupSnapshot, signupChannel } from "@/lib/signup-channel";
import { FUNNEL_WEEKS, buildFunnel, funnelWindowStart, type Funnel, type FunnelOrg } from "@/lib/signup-funnel";

/** Пополнение баланса — не оплата тарифа. */
const BALANCE_TOPUP_TARIFF = "balance_topup";
/** Предохранитель: столько регистраций за 12 недель с запасом. */
const MAX_ORGS = 5000;

/**
 * Факты для воронки /root/funnel по организациям, созданным за окно.
 * Без демо, платформенной и справочных организаций. Анкета — как у
 * кабинета (`needsProfileCompletion`): у первого пользователя есть телефон
 * и название не «Моя организация».
 */
export async function loadSignupFunnel(now = new Date(), weeks = FUNNEL_WEEKS): Promise<Funnel> {
  const organizations = await db.organization.findMany({
    where: {
      ...NOT_DIRECTORY_ORG_WHERE,
      isDemo: false,
      id: { not: platformOrgId() },
      createdAt: { gte: funnelWindowStart(now, weeks), lte: now },
    },
    select: { id: true, name: true, createdAt: true, signupSourceJson: true, referredByOrganizationId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ORGS,
  });
  if (organizations.length === 0) return buildFunnel([], now, weeks);

  const ids = organizations.map((org) => org.id);
  const [users, partnerClients, entryGroups, documentEntryOrgs, paidGroups] = await Promise.all([
    db.user.findMany({
      where: { organizationId: { in: ids }, isRoot: false },
      select: { organizationId: true, phone: true, createdAt: true, isActive: true, archivedAt: true },
    }),
    // «converted» — владелец сам перевёл свою организацию к партнёру: это не
    // привлечение партнёром.
    db.partnerClient.findMany({
      where: { organizationId: { in: ids }, source: { not: "converted" } },
      select: { organizationId: true },
    }),
    db.journalEntry.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids } } }),
    db.$queryRaw<Array<{ organizationId: string }>>`
      SELECT DISTINCT d."organizationId"
      FROM "JournalDocumentEntry" e
      JOIN "JournalDocument" d ON d."id" = e."documentId"
      WHERE d."organizationId" IN (${Prisma.join(ids)})
    `,
    db.paymentOrder.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: { in: ids },
        status: { in: [...PAID_ORDER_STATUSES] },
        isTest: false,
        refundedAt: null,
        tariffKey: { not: BALANCE_TOPUP_TARIFF },
      },
    }),
  ]);

  const firstUser = new Map<string, { phone: string | null; createdAt: Date }>();
  const activeUsers = new Map<string, number>();
  for (const user of users) {
    const orgId = user.organizationId;
    const first = firstUser.get(orgId);
    if (!first || user.createdAt < first.createdAt) firstUser.set(orgId, { phone: user.phone, createdAt: user.createdAt });
    if (user.isActive && !user.archivedAt) activeUsers.set(orgId, (activeUsers.get(orgId) ?? 0) + 1);
  }
  const withPartner = new Set(partnerClients.map((row) => row.organizationId));
  const withEntries = new Set<string>([
    ...entryGroups.map((row) => row.organizationId),
    ...documentEntryOrgs.map((row) => row.organizationId),
  ]);
  const paid = new Set(paidGroups.map((row) => row.organizationId).filter((id): id is string => Boolean(id)));

  const facts: FunnelOrg[] = organizations.map((org) => {
    const snapshot = readSignupSnapshot(org.signupSourceJson);
    return {
      createdAt: org.createdAt,
      channel: signupChannel(isEmptySnapshot(snapshot) ? null : snapshot, {
        partner: withPartner.has(org.id),
        clientReferral: Boolean(org.referredByOrganizationId),
      }),
      profileDone: Boolean(firstUser.get(org.id)?.phone) && org.name !== DEFAULT_ORG_NAME,
      hasEntry: withEntries.has(org.id),
      activeUsers: activeUsers.get(org.id) ?? 0,
      paid: paid.has(org.id),
    };
  });
  return buildFunnel(facts, now, weeks);
}
