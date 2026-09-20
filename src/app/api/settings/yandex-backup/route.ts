import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { pingDisk } from "@/lib/yandex-disk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutSchema = z.object({
  token: z.string().trim().min(10, "Токен слишком короткий"),
  folder: z.string().trim().optional(),
});

/**
 * GET — текущее состояние подключения (без раскрытия токена).
 */
export async function GET() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      yandexDiskFolder: true,
      yandexDiskLastBackupAt: true,
      yandexDiskToken: true,
    },
  });
  return NextResponse.json({
    connected: Boolean(org?.yandexDiskToken),
    folder: org?.yandexDiskFolder ?? "/WeSetup",
    lastBackupAt: org?.yandexDiskLastBackupAt
      ? org.yandexDiskLastBackupAt.toISOString()
      : null,
  });
}

/**
 * PUT — сохранить токен. Перед сохранением валидируем — пингуем
 * /v1/disk/, если токен невалидный — отдаём 400 с причиной.
 */
export async function PUT(request: Request) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const ping = await pingDisk(parsed.data.token);
  if (!ping.ok) {
    return NextResponse.json(
      { error: `Не удалось подключиться: ${ping.reason}` },
      { status: 400 }
    );
  }

  const folder = (parsed.data.folder ?? "/WeSetup").trim() || "/WeSetup";
  await db.organization.update({
    where: { id: orgId },
    data: {
      yandexDiskToken: parsed.data.token,
      yandexDiskFolder: folder.startsWith("/") ? folder : "/" + folder,
    },
  });

  return NextResponse.json({
    ok: true,
    userLogin: ping.userLogin ?? null,
  });
}

/**
 * DELETE — отключить интеграцию (очистить токен).
 */
export async function DELETE() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);
  await db.organization.update({
    where: { id: orgId },
    data: { yandexDiskToken: null },
  });
  return NextResponse.json({ ok: true });
}
