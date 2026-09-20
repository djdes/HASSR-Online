import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { loadQrPoster } from "@/lib/qr-fill-poster";
import { resolveQrPosterOrigin } from "@/lib/qr-poster-origin";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QR одного объекта для превью в диалоге строки журнала (холодильник или
 * помещение). Тот же билдер, что у страницы плакатов; токен минтится
 * на сервере — секрет в клиент не уходит.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { kind, id } = await params;
  if (kind !== "equipment" && kind !== "room" && kind !== "journal") {
    return NextResponse.json({ error: "Неизвестный вид объекта" }, { status: 400 });
  }

  const origin = resolveQrPosterOrigin({
    configured: process.env.NEXTAUTH_URL || process.env.PUBLIC_URL,
    production: process.env.NODE_ENV === "production",
  });

  try {
    const poster = await loadQrPoster({
      organizationId: getActiveOrgId(session),
      kind,
      id,
      origin,
    });
    if (!poster) {
      return NextResponse.json({ error: "Объект не найден" }, { status: 404 });
    }
    return NextResponse.json({ poster });
  } catch (error) {
    console.error("qr-fill poster error:", error);
    return NextResponse.json({ error: "Не удалось собрать QR-код" }, { status: 500 });
  }
}
