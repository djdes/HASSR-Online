import type { Session } from "next-auth";
import { getServerSession } from "@/lib/server-session";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasAnyUserRole } from "@/lib/user-roles";

type ApiAuthResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

export async function requireAuth() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireRole(roles: string[]) {
  const session = await requireAuth();

  if (!hasAnyUserRole(session.user.role, roles)) {
    redirect("/dashboard");
  }

  return session;
}

export async function requireApiAuth(): Promise<ApiAuthResult> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }),
    };
  }

  return { ok: true, session };
}

export async function requireApiRole(
  roles: string[]
): Promise<ApiAuthResult> {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;

  if (!hasAnyUserRole(auth.session.user.role, roles)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Это действие доступно руководителю" },
        { status: 403 }
      ),
    };
  }

  return auth;
}

/**
 * Hard-404 for any non-root request. Use this on every `/root/*` page and
 * `/api/root/*` handler — NOT `redirect()`, because a 302 back to /dashboard
 * (or a 307 to /login) would tell a probe that the URL exists. A plain
 * `notFound()` keeps root endpoints invisible to customer users.
 *
 * We deliberately do NOT go through `requireAuth()` here: that helper
 * redirects to /login when there's no session, and the redirect itself leaks
 * the section's existence to anonymous probers. Next.js 16's middleware
 * matcher misses the bare `/root` URL for reasons we can't fully pin down,
 * so we make the page-layer guard the authoritative one — identical 404
 * regardless of whether the caller is anonymous or a signed-in non-root.
 */
export async function requireRoot() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.isRoot) {
    notFound();
  }
  return session;
}

/**
 * Read the organisation the caller is currently **looking at**, not the one
 * they own. For every non-root user this is identical to
 * `session.user.organizationId`. For a root user who clicked "View as <org>"
 * this returns the impersonation target instead, keeping tenant scoping
 * correct on every query that used to say `{ organizationId: session.user.organizationId }`.
 *
 * Always use this in server components and API handlers before filtering DB
 * queries — otherwise root users would see cross-tenant data during
 * impersonation, or leak platform-org rows into customer dashboards.
 */
export function getActiveOrgId(session: Session): string {
  if (
    session.user.isRoot &&
    typeof session.user.actingAsOrganizationId === "string" &&
    session.user.actingAsOrganizationId.length > 0
  ) {
    return session.user.actingAsOrganizationId;
  }
  // Активная организация — для владельцев и руководителей, у которых их
  // несколько. У линейного сотрудника её нет, и он всегда в домашней.
  if (
    typeof session.user.activeOrganizationId === "string" &&
    session.user.activeOrganizationId.length > 0
  ) {
    return session.user.activeOrganizationId;
  }
  return session.user.organizationId;
}

/**
 * True if the caller is root AND currently impersonating some customer org.
 * UI guards can use this to show a persistent banner + "Stop impersonating"
 * button on every page while view-as is active.
 */
export function isImpersonating(session: Session): boolean {
  return (
    session.user.isRoot === true &&
    typeof session.user.actingAsOrganizationId === "string" &&
    session.user.actingAsOrganizationId.length > 0
  );
}
