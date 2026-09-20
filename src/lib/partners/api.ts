import type { Session } from "next-auth";
import { NextResponse } from "next/server";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { partnerErrorResponse } from "./errors";
import { getPartnerMembership, requireActivePartner, type PartnerMembership } from "./service";

/**
 * Общие проверки для API партнёрки.
 *
 * Партнёрский кабинет (`/api/partner/*`) — только для участников активного
 * партнёра. Клиентская сторона (`/api/settings/consultant`,
 * `/api/partners/attach`) — только для руководства организации и НЕ из
 * режима партнёра: консультант не может сам себе выдать доступ.
 */

export type PartnerApiContext = { session: Session; membership: PartnerMembership };

export async function requirePartnerApi(): Promise<
  { ok: true; ctx: PartnerApiContext } | { ok: false; response: NextResponse }
> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  try {
    const membership = await requireActivePartner(auth.session.user.id);
    return { ok: true, ctx: { session: auth.session, membership } };
  } catch (error) {
    return { ok: false, response: partnerErrorResponse(error) };
  }
}

/** Участник партнёра любого статуса — для страницы статуса заявки. */
export async function optionalPartnerApi(): Promise<
  { ok: true; session: Session; membership: PartnerMembership | null } | { ok: false; response: NextResponse }
> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const membership = await getPartnerMembership(auth.session.user.id);
  return { ok: true, session: auth.session, membership };
}

export async function requireOrgAdminApi(): Promise<
  { ok: true; session: Session; organizationId: string } | { ok: false; response: NextResponse }
> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const { session } = auth;
  if (session.user.partnerAccess) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Настройки консультанта меняет только сам клиент", code: "partner_mode" },
        { status: 403 },
      ),
    };
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    return { ok: false, response: NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 }) };
  }
  return { ok: true, session, organizationId: getActiveOrgId(session) };
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const body = await request.json().catch(() => null);
  return (body && typeof body === "object" ? body : {}) as T;
}

export function actorName(session: Session): string {
  return session.user.name?.trim() || session.user.email || "Пользователь";
}
