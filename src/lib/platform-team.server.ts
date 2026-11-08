import { db } from "@/lib/db";
import { isTechnicalEmail } from "@/lib/technical-email";
import { mailSenderStatus, type MailSenderStatus } from "@/lib/platform-mail";
import { normalizePlatformSections, PLATFORM_SECTIONS, type PlatformSectionKey } from "@/lib/platform-access";
import { notifyPlatformAccessGranted, type PlatformAccessNoticeResult } from "@/lib/platform-access-notice.server";
import { notifySalesHeadGranted } from "@/lib/crm/sales-head-notice.server";

/** People with access to the platform panel: owners and delegated staff. */

export type PlatformMember = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organizationId: string;
  organizationName: string;
  owner: boolean;
  sections: PlatformSectionKey[];
  /** РОП: получает все заявки и напоминания CRM. */
  salesHead: boolean;
  grantedAt: string | null;
  mail: MailSenderStatus;
  lastLoginAt: string | null;
};

const memberSelect = {
  id: true,
  name: true,
  email: true,
  contactEmail: true,
  phone: true,
  isRoot: true,
  organizationId: true,
  organization: { select: { name: true } },
  platformSections: true,
  platformSalesHead: true,
  platformGrantedAt: true,
  lastLoginAt: true,
  platformMailSender: { select: { enabled: true, verifiedAt: true, lastError: true } },
} as const;

type MemberRow = {
  id: string;
  name: string;
  email: string;
  contactEmail: string | null;
  phone: string | null;
  isRoot: boolean;
  organizationId: string;
  organization: { name: string };
  platformSections: string[];
  platformSalesHead: boolean;
  platformGrantedAt: Date | null;
  lastLoginAt: Date | null;
  platformMailSender: { enabled: boolean; verifiedAt: Date | null; lastError: string | null } | null;
};

/** A real address to show: personal contact first, never a synthetic login. */
export function visibleEmail(user: { email: string; contactEmail: string | null }): string | null {
  if (user.contactEmail) return user.contactEmail;
  return isTechnicalEmail(user.email) ? null : user.email;
}

function toMember(row: MemberRow): PlatformMember {
  return {
    id: row.id,
    name: row.name,
    email: visibleEmail(row),
    phone: row.phone,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    owner: row.isRoot,
    sections: row.isRoot ? [...PLATFORM_SECTIONS.map((section) => section.key)] : normalizePlatformSections(row.platformSections),
    salesHead: row.platformSalesHead,
    grantedAt: row.platformGrantedAt?.toISOString() ?? null,
    mail: mailSenderStatus(row.platformMailSender),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export async function listPlatformTeam(): Promise<PlatformMember[]> {
  const rows = await db.user.findMany({
    where: { OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }, { platformSalesHead: true }], archivedAt: null },
    orderBy: [{ isRoot: "desc" }, { name: "asc" }],
    select: memberSelect,
  });
  return rows.map(toMember);
}

export type TeamCandidate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organizationName: string;
  sections: PlatformSectionKey[];
  salesHead: boolean;
  owner: boolean;
};

/** Find a person to grant access to: by e-mail, name or phone. */
export async function searchTeamCandidates(query: string): Promise<TeamCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const rows = await db.user.findMany({
    where: {
      archivedAt: null,
      isActive: true,
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { contactEmail: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : []),
      ],
    },
    orderBy: [{ isRoot: "desc" }, { lastLoginAt: { sort: "desc", nulls: "last" } }],
    take: 10,
    select: memberSelect,
  });
  return rows.map((row) => {
    const member = toMember(row);
    return {
      id: member.id,
      name: member.name,
      email: member.email ?? row.email,
      phone: member.phone,
      organizationName: member.organizationName,
      sections: member.sections,
      salesHead: member.salesHead,
      owner: member.owner,
    };
  });
}

export class TeamError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Who changes access: the session user, or the platform owner in a deploy seed. */
export type PlatformActor = { user: { id: string; name?: string | null; organizationId: string } };

/**
 * Grants (non-empty) or revokes (empty) delegated sections. Newly opened
 * sections are announced to the person by e-mail and Telegram; the API does
 * not wait for that, a one-off script passes `waitForNotice` to log it.
 *
 * `salesHead` — роль РОП (CRM): не передана — остаётся как была. РОП
 * работает в разделе «Продажи», без него роль не выдаётся; снятие доступа
 * снимает и РОП.
 */
export async function setPlatformSections(
  actor: PlatformActor,
  userId: string,
  requested: unknown,
  options: { waitForNotice?: boolean; salesHead?: boolean } = {},
): Promise<PlatformMember & { notice?: PlatformAccessNoticeResult }> {
  const sections = normalizePlatformSections(requested);
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isRoot: true, archivedAt: true, platformSections: true, platformSalesHead: true, email: true },
  });
  if (!target || target.archivedAt) throw new TeamError("Пользователь не найден", 404);
  if (target.isRoot) {
    // Владельцу разделы не нужны (открыто всё), но РОП — отдельная роль: её
    // владелец может включить и себе, чтобы получать заявки и напоминания CRM.
    if (options.salesHead === undefined) throw new TeamError("У владельца платформы и так открыто всё");
    const updated = await db.user.update({ where: { id: userId }, data: { platformSalesHead: options.salesHead }, select: memberSelect });
    await db.auditLog
      .create({
        data: {
          organizationId: actor.user.organizationId,
          userId: actor.user.id,
          userName: actor.user.name ?? null,
          action: "platform.access.update",
          entity: "user",
          entityId: userId,
          details: { email: target.email, salesHeadBefore: target.platformSalesHead, salesHead: options.salesHead },
        },
      })
      .catch((error) => console.error("[platform-team] audit failed", error));
    if (options.salesHead && !target.platformSalesHead) {
      const headNotice = notifySalesHeadGranted({ userId, grantedBy: target.id === actor.user.id ? null : (actor.user.name ?? null) }).catch(() => false);
      if (options.waitForNotice) await headNotice;
    }
    return toMember(updated);
  }
  if (target.id === actor.user.id) throw new TeamError("Свой доступ менять нельзя");
  const salesHead = sections.length ? (options.salesHead ?? target.platformSalesHead) : false;
  if (salesHead && !sections.includes("sales")) throw new TeamError("РОП работает в разделе «Продажи» — отметьте его");
  const before = normalizePlatformSections(target.platformSections);
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      platformSections: sections,
      platformSalesHead: salesHead,
      platformGrantedAt: sections.length ? new Date() : null,
      platformGrantedById: sections.length ? actor.user.id : null,
    },
    select: memberSelect,
  });
  await db.auditLog
    .create({
      data: {
        organizationId: actor.user.organizationId,
        userId: actor.user.id,
        userName: actor.user.name ?? null,
        action: sections.length ? (before.length ? "platform.access.update" : "platform.access.grant") : "platform.access.revoke",
        entity: "user",
        entityId: userId,
        details: { email: target.email, before, after: sections, salesHeadBefore: target.platformSalesHead, salesHead },
      },
    })
    .catch((error) => console.error("[platform-team] audit failed", error));
  const notice = notifyPlatformAccessGranted({ userId, before, after: sections, grantedBy: actor.user.name ?? null }).catch((error) => {
    console.error("[platform-team] access notice failed", error);
    return { email: false, telegram: false } satisfies PlatformAccessNoticeResult;
  });
  if (salesHead && !target.platformSalesHead) {
    const headNotice = notifySalesHeadGranted({ userId, grantedBy: actor.user.name ?? null }).catch((error) => {
      console.error("[platform-team] sales head notice failed", error);
      return false;
    });
    if (options.waitForNotice) await headNotice;
  }
  if (options.waitForNotice) return { ...toMember(updated), notice: await notice };
  return toMember(updated);
}
