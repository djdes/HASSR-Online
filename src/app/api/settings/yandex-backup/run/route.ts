import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { buildOrgBackup } from "@/lib/org-backup";
import { uploadJson, YandexDiskError } from "@/lib/yandex-disk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/yandex-backup/run
 *
 * Ручной запуск бэкапа — кнопка «Сделать бэкап сейчас» в /settings/backup.
 * Удобно перед инспекцией / для проверки что токен живой.
 */
export async function POST() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      yandexDiskToken: true,
      yandexDiskFolder: true,
    },
  });
  if (!org?.yandexDiskToken) {
    return NextResponse.json(
      { error: "Я.Диск не подключён" },
      { status: 400 }
    );
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const data = await buildOrgBackup(orgId, weekAgo, now);
    const filename = `wesetup-backup-${now
      .toISOString()
      .slice(0, 10)}-manual.json`;
    const upload = await uploadJson(
      org.yandexDiskToken,
      org.yandexDiskFolder ?? "/WeSetup",
      filename,
      data
    );

    await db.organization.update({
      where: { id: orgId },
      data: { yandexDiskLastBackupAt: now },
    });

    await db.auditLog.create({
      data: {
        organizationId: orgId,
        userId: session.user.id,
        userName: session.user.name ?? null,
        action: "yandex_backup.manual",
        entity: "yandex_backup",
        details: {
          path: upload.path,
          sizeBytes: upload.sizeBytes,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      path: upload.path,
      sizeBytes: upload.sizeBytes,
    });
  } catch (err) {
    const reason =
      err instanceof YandexDiskError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Неизвестная ошибка";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
