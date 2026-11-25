import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveMiniRole } from "@/lib/mini-role";
import { getUserPermissions } from "@/lib/permissions-server";
import { isManagerLikePermissions } from "@/lib/permissions";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const [perms, profile] = await Promise.all([
    getUserPermissions(session.user.id),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true, telegramChatId: true },
    }),
  ]);
  const isManagerLike =
    session.user.isRoot === true ||
    isManagerLikePermissions(perms, session.user.role);
  const resolved = resolveMiniRole(session.user, perms);

  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      isRoot: session.user.isRoot,
    },
    mode: isManagerLike ? "manager" : perms.has("journals.fill") ? "staff" : "readonly",
    permissions: Array.from(perms),
    roleKind: resolved.kind,
    roleGroup: resolved.group,
    homeHref: resolved.homeHref,
    phone: profile?.phone ?? null,
    telegramLinked: Boolean(profile?.telegramChatId),
  });
}
