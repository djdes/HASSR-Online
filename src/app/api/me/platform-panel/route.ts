import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rewriteSessionClaims } from "@/lib/session-token";
import { hasPlatformPanel, normalizePlatformSections, platformHomeHref } from "@/lib/platform-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Панель платформы» from the cabinet. Sections may have been granted after
 * the person signed in, and the proxy reads them from the session cookie —
 * so refresh that claim from the DB here and open the first allowed section.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { platformSections: true, isActive: true, archivedAt: true },
  });
  const sections = user && user.isActive && !user.archivedAt ? normalizePlatformSections(user.platformSections) : [];
  const viewer = { superadmin: session.user.isRoot === true, sections };
  if (!hasPlatformPanel(viewer)) return NextResponse.redirect(new URL("/dashboard", request.url));
  if (!viewer.superadmin) await rewriteSessionClaims({ platformSections: sections });
  return NextResponse.redirect(new URL(platformHomeHref(viewer), request.url));
}
