import { db } from "@/lib/db";
import { readLegalProfile } from "@/lib/org-legal-profile";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import type { DocumentOrgBlock } from "@/lib/document-org-block";
import { isTechnicalEmail } from "@/lib/technical-email";
import { normalizePlatformSections, type PlatformSectionKey } from "@/lib/platform-access";

/**
 * Everything the client card in the platform panel shows about how to reach
 * the client (owner's request 2026-10-29: «отображать телефон и телефоны
 * сотрудников, если есть, т. е. все контактные данные»).
 */

export type ClientPerson = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  phone: string | null;
  /** Real address to write to: contact e-mail, else a non-synthetic login. */
  email: string | null;
  /** Login when it differs from `email` (synthetic logins are hidden). */
  loginEmail: string | null;
  telegram: boolean;
  max: boolean;
  isActive: boolean;
  archived: boolean;
  isOwner: boolean;
  isRoot: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  registrationIp: string | null;
  journalAccessMigrated: boolean;
  platformSections: PlatformSectionKey[];
};

export type ClientCompanyContacts = {
  phones: string[];
  emails: string[];
  accountantEmail: string | null;
  website: string | null;
  address: string | null;
};

export type ClientContacts = {
  owner: ClientPerson | null;
  company: ClientCompanyContacts;
  requisites: DocumentOrgBlock["org"] | null;
  people: ClientPerson[];
};

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase().replace(/[\s()-]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export async function loadClientContacts(organizationId: string): Promise<ClientContacts | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      phone: true,
      accountantEmail: true,
      website: true,
      address: true,
      legalProfileJson: true,
      account: { select: { ownerUserId: true } },
      users: {
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          role: true,
          positionTitle: true,
          jobPosition: { select: { name: true } },
          phone: true,
          email: true,
          contactEmail: true,
          telegramChatId: true,
          maxIdentity: { select: { id: true } },
          isActive: true,
          archivedAt: true,
          isRoot: true,
          createdAt: true,
          lastLoginAt: true,
          lastLoginIp: true,
          registrationIp: true,
          journalAccessMigrated: true,
          platformSections: true,
        },
      },
    },
  });
  if (!org) return null;

  // Owner: the account owner when they work in this organization, else the
  // earliest user (the one who registered it).
  const ownerId =
    org.users.find((user) => user.id === org.account?.ownerUserId)?.id ??
    [...org.users].filter((user) => !user.isRoot).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.id ??
    null;

  const people: ClientPerson[] = org.users.map((user) => {
    const technical = isTechnicalEmail(user.email);
    const email = user.contactEmail?.trim() || (technical ? null : user.email);
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      position: user.jobPosition?.name ?? user.positionTitle ?? null,
      phone: user.phone?.trim() || null,
      email,
      loginEmail: !technical && user.email !== email ? user.email : null,
      telegram: Boolean(user.telegramChatId),
      max: Boolean(user.maxIdentity),
      isActive: user.isActive,
      archived: Boolean(user.archivedAt),
      isOwner: user.id === ownerId,
      isRoot: user.isRoot,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastLoginIp: user.lastLoginIp,
      registrationIp: user.registrationIp,
      journalAccessMigrated: user.journalAccessMigrated,
      platformSections: normalizePlatformSections(user.platformSections),
    };
  });
  // Owner first, then people with a phone, then the rest; archived last.
  people.sort((a, b) => {
    const rank = (person: ClientPerson) => (person.isOwner ? 0 : person.archived ? 3 : person.phone || person.email ? 1 : 2);
    return rank(a) - rank(b);
  });

  const profile = readLegalProfile(org.legalProfileJson);
  const requisites = (await loadDocumentOrgBlock(organizationId))?.org ?? null;
  return {
    owner: people.find((person) => person.isOwner) ?? null,
    company: {
      phones: uniq([org.phone, requisites?.phone, ...(profile?.phones ?? [])]),
      emails: uniq([...(profile?.emails ?? [])]),
      accountantEmail: org.accountantEmail?.trim() || null,
      website: org.website?.trim() || null,
      address: org.address?.trim() || requisites?.address || null,
    },
    requisites,
    people,
  };
}
