import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { relativeRedirect } from "@/lib/relative-redirect";
import { rewriteSessionClaims } from "@/lib/session-token";
import { hasPlatformPanel, platformEntryHref, platformEntryTarget } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Панель платформы» from the cabinet, the mini app and the access e-mail.
 * Sections may have been granted after the person signed in, and the proxy
 * reads them from the session cookie — so refresh that claim from the DB here
 * and open the requested tab (`?next=`) or the first allowed one.
 *
 * Location is relative (`lib/relative-redirect`): an absolute one built from
 * `request.url` sent people to https://localhost:3002 in production
 * (2026-11-09).
 */
export async function GET(request: Request) {
  const next = new URL(request.url).searchParams.get("next");
  const session = await getServerSession(authOptions);
  if (!session) return relativeRedirect(`/login?next=${encodeURIComponent(platformEntryHref(next))}`);
  const viewer = await platformViewerForSession(session);
  if (!hasPlatformPanel(viewer)) return relativeRedirect("/dashboard");
  if (!viewer.superadmin) await rewriteSessionClaims({ platformSections: viewer.sections });
  return relativeRedirect(platformEntryTarget(viewer, next));
}
