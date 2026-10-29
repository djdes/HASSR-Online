import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { isTechnicalEmail } from "@/lib/technical-email";
import { mailSenderStatus, type MailSenderStatus } from "@/lib/platform-mail";
import { normalizePlatformSections, PLATFORM_SECTIONS, type PlatformSectionKey } from "@/lib/platform-access";

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
    grantedAt: row.platformGrantedAt?.toISOString() ?? null,
    mail: mailSenderStatus(row.platformMailSender),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export async function listPlatformTeam(): Promise<PlatformMember[]> {
  const rows = await db.user.findMany({
    where: { OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }], archivedAt: null },
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
      owner: member.owner,
    };
  });
}

export class TeamError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Grants (non-empty) or revokes (empty) delegated sections. */
export async function setPlatformSections(actor: Session, userId: string, requested: unknown): Promise<PlatformMember> {
  const sections = normalizePlatformSections(requested);
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, isRoot: true, archivedAt: true, platformSections: true, email: true } });
  if (!target || target.archivedAt) throw new TeamError("Пользователь не найден", 404);
  if (target.isRoot) throw new TeamError("У владельца платформы и так открыто всё");
  if (target.id === actor.user.id) throw new TeamError("Свой доступ менять нельзя");
  const before = normalizePlatformSections(target.platformSections);
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      platformSections: sections,
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
        details: { email: target.email, before, after: sections },
      },
    })
    .catch((error) => console.error("[platform-team] audit failed", error));
  return toMember(updated);
}
