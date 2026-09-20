import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildingTargets } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ensureDocumentsFor } from "@/lib/journal-auto-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Запустить автосоздание сейчас» — создаёт документы по списку
 * `Organization.autoJournalCodes` для текущей организации. Используется
 * кнопкой на /settings/auto-journals + внутренним cron'ом (через другой
 * endpoint с secret-ключом).
 *
 *   POST /api/journal-documents/auto-create
 *   Auth: management session
 *
 * Response: { created, skipped, results: [{code, name, created, documentId, reason?}] }
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { autoJournalCodes: true },
  });
  const codes = Array.isArray(org?.autoJournalCodes)
    ? (org.autoJournalCodes as string[]).filter(
        (c): c is string => typeof c === "string"
      )
    : [];
  if (codes.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped: 0,
      results: [],
      message: "Список автосоздания пуст. Откройте /settings/auto-journals и выберите журналы.",
    });
  }
  const results = await ensureDocumentsFor(db, {
    organizationId,
    templateCodes: codes,
    // Точки: по документу на каждую точку организации.
    buildingIds: await buildingTargets(organizationId),
  });
  const created = results.filter((r) => r.created).length;
  const skipped = results.length - created;
  return NextResponse.json({ created, skipped, results });
}
