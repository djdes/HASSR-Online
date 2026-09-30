import { db } from "@/lib/db";
import { resolveDishPoolOrgIds } from "@/lib/dish-pool";
import { hashInviteToken } from "@/lib/invite-tokens";
import { InviteAcceptClient } from "./invite-accept-client";

export const dynamic = "force-dynamic";

// Single-use token URL — никогда не должна быть в индексе. Если кто-то
// случайно поделится ссылкой в публичный канал, robots.txt уже стоит
// /invite/, но и HTML-meta тоже.
export const metadata = {
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

/**
 * Public landing page for email invite links. Validates the raw token
 * server-side by hashing + lookup, then passes the status down to a
 * client component that shows either the set-password form or a rejection
 * explanation. No session required.
 */
export default async function InviteAcceptPage({ params }: PageProps) {
  const { token } = await params;
  const raw = (token || "").trim();

  let status: "valid" | "expired" | "used" | "not_found" = "not_found";
  let invite: { userId: string; expiresAt: Date } | null = null;
  let user: {
    name: string;
    email: string;
    organization: { name: string; kind: string; poolObjects: number };
    /** Сотрудник организации, приглашённый в мастер-кабинет: после входа — сразу в кабинет. */
    masterCabinet: { id: string; name: string; poolObjects: number } | null;
  } | null = null;

  if (raw.length > 0) {
    const tokenHash = hashInviteToken(raw);
    const row = await db.inviteToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            lastActiveOrganizationId: true,
            organization: { select: { id: true, name: true, kind: true } },
            organizationMemberships: {
              where: { organization: { kind: "directory" } },
              select: { organization: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (!row) {
      status = "not_found";
    } else if (row.usedAt) {
      status = "used";
    } else if (row.expiresAt.getTime() < Date.now()) {
      status = "expired";
    } else {
      status = "valid";
      invite = { userId: row.userId, expiresAt: row.expiresAt };
      // Мастер-кабинет справочников: сотруднику бэк-офиса сразу объясняем,
      // скольким пищеблокам уходят его списки (пул служебного кода без самого кабинета).
      const org = row.user.organization;
      const poolObjects =
        org.kind === "directory" ? Math.max(0, (await resolveDishPoolOrgIds(org.id)).length - 1) : 0;
      // Приглашён в мастер-кабинет сотрудником организации (группа
      // «Мастер-кабинет»): кабинет — тот, куда звали (lastActiveOrganizationId).
      const cabinets = org.kind === "directory" ? [] : row.user.organizationMemberships.map((m) => m.organization);
      const cabinet =
        cabinets.find((item) => item.id === row.user.lastActiveOrganizationId) ?? cabinets[0] ?? null;
      const masterCabinet = cabinet
        ? {
            id: cabinet.id,
            name: cabinet.name,
            poolObjects: Math.max(0, (await resolveDishPoolOrgIds(cabinet.id)).length - 1),
          }
        : null;
      user = {
        name: row.user.name,
        email: row.user.email,
        organization: { name: org.name, kind: org.kind, poolObjects },
        masterCabinet,
      };
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5fb] px-4">
      <InviteAcceptClient
        status={status}
        token={raw}
        invite={invite}
        user={user}
      />
    </div>
  );
}
