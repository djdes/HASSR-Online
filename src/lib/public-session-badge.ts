import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";

import { pickSessionCookie } from "@/lib/auth-cookies";
import { canImpersonateFromToken } from "@/lib/platform-access";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Lightweight, 0-DB-SELECT session badge decoder for public promotional pages
 * (header «Открыть кабинет», landing CTA, `/partners` apply button).
 *
 * Why separate from `getServerSession(authOptions)`:
 * `getServerSession` + `authOptions.callbacks.session` query `User` and
 * `OrganizationMember` in PostgreSQL whenever a visitor carries a session
 * cookie — even on static knowledge-base or landing pages. On promo pages we
 * only render a navigation link/initials; real authorization is enforced by
 * `src/proxy.ts` and `getServerSession` inside `(dashboard)` / `/api/*`.
 */
export type PublicSessionBadge = {
  id: string;
  name: string | null;
  role: string;
  isRoot: boolean;
};

export async function decodePublicSessionBadgeFromCookie(
  getCookie: (name: string) => string | null | undefined,
  secret: string | undefined = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  nowMs: number = Date.now(),
): Promise<PublicSessionBadge | null> {
  if (!secret) return null;
  const rawToken = pickSessionCookie(getCookie)?.value;
  if (!rawToken) return null;

  const token = await decode({ token: rawToken, secret }).catch(() => null);
  if (!token) return null;

  if (typeof token.exp === "number" && token.exp * 1000 < nowMs) {
    return null;
  }

  if (token.kiosk === true) {
    const lockAt = typeof token.lockAt === "number" ? token.lockAt : 0;
    if (!lockAt || lockAt < nowMs) return null;
  }

  const id = typeof token.id === "string" ? token.id : typeof token.sub === "string" ? token.sub : "";
  if (!id) return null;

  const isRoot = token.isRoot === true;
  let role = typeof token.role === "string" ? token.role : "";
  if (
    !isRoot &&
    (token.canManageSettings === true ||
      (typeof token.actingAsOrganizationId === "string" &&
        token.actingAsOrganizationId.length > 0 &&
        canImpersonateFromToken(token))) &&
    !isManagementRole(role)
  ) {
    role = "owner";
  }

  return {
    id,
    name: typeof token.name === "string" ? token.name : null,
    role,
    isRoot,
  };
}

export async function readPublicSessionBadge(): Promise<PublicSessionBadge | null> {
  const cookieStore = await cookies().catch(() => null);
  if (!cookieStore) return null;
  return decodePublicSessionBadgeFromCookie((name) => cookieStore.get(name)?.value);
}
